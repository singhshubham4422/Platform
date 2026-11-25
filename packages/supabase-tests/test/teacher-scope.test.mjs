import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const url=process.env.SUPABASE_TEST_DATABASE_URL;
const pool=new pg.Pool({connectionString:url});
const uid=()=>crypto.randomUUID();
async function asUser(userId,fn,role='authenticated'){const c=await pool.connect();try{await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${role}`);await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:userId,role})]);return await fn(c)}finally{await c.query('ROLLBACK').catch(()=>{});c.release()}}
async function asService(fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE service_role');await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'service_role'})]);await fn(c);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}}


// Like asUser, but commits (asUser always rolls back), for writes later steps must see.
async function asUserCommit(userId,fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:userId,role:'authenticated'})]);const r=await fn(c);await c.query('COMMIT');return r}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}}

// Migration 0007: teachers see (and give feedback on) only their own classes' students.
test('teacher access is scoped to students of their own classes, across colleges and platform-wide courses', { skip: !url }, async (t) => {
  const orgA = uid(), orgB = uid(), t1 = uid(), t2 = uid(), s1 = uid(), s2 = uid(), clsA = uid(), clsB = uid(), course = uid(), question = uid();
  for (const [id, slug] of [[orgA, `a-${orgA.slice(0, 8)}`], [orgB, `b-${orgB.slice(0, 8)}`]]) await pool.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)', [id, 'Fixture ' + slug, slug]);
  for (const [id, org, role] of [[t1, orgA, 'TEACHER'], [s1, orgA, 'STUDENT'], [t2, orgB, 'TEACHER'], [s2, orgB, 'STUDENT']]) {
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@fixture.invalid`]);
    await pool.query('INSERT INTO profiles(id,organization_id,role,full_name,email) VALUES($1,$2,$3,$4,$5)', [id, org, role, role, `${id}@fixture.invalid`]);
  }
  await pool.query('INSERT INTO classes(id,organization_id,name,code) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [clsA, orgA, 'A', `a-${clsA.slice(0, 8)}`, clsB, orgB, 'B', `b-${clsB.slice(0, 8)}`]);
  await pool.query("INSERT INTO class_members(class_id,user_id,role) VALUES($1,$2,'TEACHER'),($1,$3,'STUDENT'),($4,$5,'TEACHER'),($4,$6,'STUDENT')", [clsA, t1, s1, clsB, t2, s2]);
  // A platform-wide practice course, linked to BOTH colleges' classes.
  await pool.query("INSERT INTO courses(id,organization_id,title,languages,status) VALUES($1,NULL,'Platform practice',ARRAY['JAVA'],'PUBLISHED')", [course]);
  await pool.query('INSERT INTO class_courses(class_id,course_id) VALUES($1,$3),($2,$3)', [clsA, clsB, course]);
  await pool.query("INSERT INTO questions(id,course_id,title,statement_md,difficulty) VALUES($1,$2,'Q','S','EASY')", [question, course]);
  t.after(async () => {
    await pool.query('DELETE FROM feedback WHERE submission_id IN (SELECT id FROM submissions WHERE course_id=$1)', [course]);
    await pool.query('DELETE FROM submissions WHERE course_id=$1', [course]);
    await pool.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [[t1, t2, s1, s2]]);
    await pool.query('DELETE FROM courses WHERE id=$1', [course]);
    await pool.query('DELETE FROM classes WHERE id=ANY($1::uuid[])', [[clsA, clsB]]);
    await pool.query('DELETE FROM organizations WHERE id=ANY($1::uuid[])', [[orgA, orgB]]);
  });
  const submit = (student) => asUserCommit(student, (c) => c.query(`INSERT INTO submissions(pack_id,id,course_id,question_id,language,source,source_sha256,verdict,passed,total,total_time_ms,results_json,started_at,finished_at,monotonic_seq,device_id)
    VALUES('p@1',$1,$2,$3,'JAVA','class Main{}','${'a'.repeat(64)}','ACCEPTED',1,1,1,'[]',now(),now(),1,$4) RETURNING id`, [uid(), course, question, uid()]));
  const sub1 = (await submit(s1)).rows[0].id;
  const sub2 = (await submit(s2)).rows[0].id;

  const seen = await asUser(t1, (c) => c.query('SELECT id FROM submissions ORDER BY id'));
  assert.deepEqual(seen.rows.map((r) => r.id), [sub1], 'teacher A sees only their own student, not college B');

  await asUserCommit(t1, (c) => c.query("INSERT INTO feedback(submission_id,teacher_id,body,released) VALUES($1,$2,'good',true)", [sub1, t1]));
  await assert.rejects(asUser(t1, (c) => c.query("INSERT INTO feedback(submission_id,teacher_id,body,released) VALUES($1,$2,'x',true)", [sub2, t1])), (e) => e.code === '42501', 'no feedback on another college');
  await assert.rejects(asUser(t1, (c) => c.query("INSERT INTO feedback(submission_id,teacher_id,body,released) VALUES($1,$2,'x',true)", [sub1, t2])), (e) => e.code === '42501', 'no feedback under another teacher');

  const fb = await asUser(s1, (c) => c.query('SELECT body FROM feedback WHERE submission_id=$1', [sub1]));
  assert.deepEqual(fb.rows, [{ body: 'good' }], 'student sees released feedback');
  const other = await asUser(t2, (c) => c.query('SELECT id FROM feedback'));
  assert.equal(other.rowCount, 0, "teacher B cannot read teacher A's feedback");
});
