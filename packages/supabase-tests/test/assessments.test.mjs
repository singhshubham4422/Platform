import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';

const url = process.env.SUPABASE_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: url });
const uid = () => crypto.randomUUID();
async function asUser(userId, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated');
    await c.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    return await fn(c);
  } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}
async function asService(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE service_role');
    await c.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })]);
    const result = await fn(c); await c.query('COMMIT'); return result;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

test('assessment attempts cannot be inserted directly; practice submissions still work', { skip: !url }, async () => {
  const org = uid(), student = uid(), teacher = uid(), cls = uid(), course = uid(), question = uid(), assessment = uid();
  await pool.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)', [org, 'Attempt Guard Org', `ag-${org.slice(0, 8)}`]);
  for (const [id, role] of [[student, 'STUDENT'], [teacher, 'TEACHER']]) {
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@fixture.invalid`]);
    await pool.query('INSERT INTO profiles(id,organization_id,role,full_name,email) VALUES($1,$2,$3,$4,$5)', [id, org, role, role, `${id}@fixture.invalid`]);
  }
  await pool.query('INSERT INTO classes(id,organization_id,name,code) VALUES($1,$2,$3,$4)', [cls, org, 'Attempt Class', `ac-${cls.slice(0, 8)}`]);
  await pool.query("INSERT INTO class_members(class_id,user_id,role) VALUES($1,$2,'STUDENT'),($1,$3,'TEACHER')", [cls, student, teacher]);
  await pool.query("INSERT INTO courses(id,organization_id,title,languages,status) VALUES($1,$2,'Attempt Course',ARRAY['PYTHON'],'PUBLISHED')", [course, org]);
  await pool.query('INSERT INTO class_courses(class_id,course_id) VALUES($1,$2)', [cls, course]);
  await pool.query("INSERT INTO questions(id,course_id,title,statement_md,difficulty) VALUES($1,$2,'Attempt Q','Statement','EASY')", [question, course]);
  await pool.query("INSERT INTO assessments(id,organization_id,course_id,class_id,title,question_ids,opens_at,closes_at,duration_minutes,status) VALUES($1,$2,$3,$4,'Attempt Assessment',ARRAY[$5]::uuid[],now()-interval '1 hour',now()+interval '1 hour',60,'SCHEDULED')", [assessment, org, course, cls, question]);
  try {
    const insert = (assessmentId) => `INSERT INTO submissions(user_id,pack_id,course_id,question_id,assessment_id,language,source,source_sha256,verdict,passed,total,total_time_ms,results_json,started_at,finished_at,monotonic_seq,device_id)
      VALUES($1,'pack@1',$2,$3,${assessmentId ? `'${assessmentId}'` : 'NULL'},'PYTHON','print(1)','${'a'.repeat(64)}','ACCEPTED',1,1,1,'[]',now(),now(),1,$4) RETURNING assessment_id`;
    await assert.rejects(asUser(student, c => c.query(insert(assessment), [student, course, question, uid()])), e => e.code === '42501');
    const practice = await asUser(student, c => c.query(insert(null), [student, course, question, uid()]));
    assert.equal(practice.rows[0].assessment_id, null);
  } finally {
    await pool.query('DELETE FROM submissions WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [[student, teacher]]);
    await pool.query('DELETE FROM assessments WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM courses WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM classes WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM organizations WHERE id=$1', [org]);
  }
});

test('assessment_results uses the final verdict, late labels, attempts and overrides under RLS', { skip: !url }, async () => {
  const org = uid(), student = uid(), other = uid(), teacher = uid(), cls = uid(), course = uid(), question = uid();
  const high = uid(), normal = uid();
  await pool.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)', [org, 'Results Org', `rs-${org.slice(0, 8)}`]);
  for (const [id, role] of [[student, 'STUDENT'], [other, 'STUDENT'], [teacher, 'TEACHER']]) {
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@fixture.invalid`]);
    await pool.query('INSERT INTO profiles(id,organization_id,role,full_name,email) VALUES($1,$2,$3,$4,$5)', [id, org, role, role, `${id}@fixture.invalid`]);
  }
  await pool.query('INSERT INTO classes(id,organization_id,name,code) VALUES($1,$2,$3,$4)', [cls, org, 'Results Class', `rc-${cls.slice(0, 8)}`]);
  await pool.query("INSERT INTO class_members(class_id,user_id,role) VALUES($1,$2,'STUDENT'),($1,$3,'STUDENT'),($1,$4,'TEACHER')", [cls, student, other, teacher]);
  await pool.query("INSERT INTO courses(id,organization_id,title,languages,status) VALUES($1,$2,'Results Course',ARRAY['PYTHON'],'PUBLISHED')", [course, org]);
  await pool.query('INSERT INTO class_courses(class_id,course_id) VALUES($1,$2)', [cls, course]);
  await pool.query("INSERT INTO questions(id,course_id,title,statement_md,difficulty,points) VALUES($1,$2,'Results Q','Statement','EASY',10)", [question, course]);
  for (const [id, highStakes] of [[high, true], [normal, false]]) {
    await pool.query("INSERT INTO assessments(id,organization_id,course_id,class_id,title,question_ids,opens_at,closes_at,duration_minutes,high_stakes,status) VALUES($1,$2,$3,$4,'Assessment',ARRAY[$5]::uuid[],now()-interval '2 hours',now()-interval '1 hour',60,$6,'CLOSED')", [id, org, course, cls, question, highStakes]);
  }
  const submission = async (id, assessmentId, userId, fields) => asService(c => c.query(`INSERT INTO submissions(id,user_id,pack_id,course_id,question_id,assessment_id,language,source,source_sha256,verdict,passed,total,total_time_ms,results_json,started_at,finished_at,monotonic_seq,device_id,late_status,recheck_status,recheck_verdict)
    VALUES($1,$2,'pack@1',$3,$4,$5,'PYTHON','x','${'b'.repeat(64)}',$6,1,1,1,'[]',now(),now(),1,$7,$8,$9,$10)`,
    [id, userId, course, question, assessmentId, fields.verdict, uid(), fields.late, fields.recheck, fields.recheckVerdict ?? null]));
  const queued = uid(), checked = uid(), late = uid(), practice = uid();
  try {
    await submission(queued, high, student, { verdict: 'ACCEPTED', late: 'ON_TIME', recheck: 'QUEUED' });
    await submission(checked, high, other, { verdict: 'ACCEPTED', late: 'ON_TIME', recheck: 'DONE', recheckVerdict: 'WRONG_ANSWER' });
    await submission(late, normal, student, { verdict: 'ACCEPTED', late: 'LATE', recheck: 'NOT_REQUIRED' });
    await submission(practice, null, other, { verdict: 'ACCEPTED', late: null, recheck: 'NOT_REQUIRED' });
    await pool.query("INSERT INTO feedback(submission_id,teacher_id,body,score_override,released) VALUES($1,$2,'Late but correct',6,true)", [late, teacher]);

    const rows = await asUser(student, c => c.query('SELECT assessment_id,question_id,final_verdict,late_status,recheck_status,attempts_used,points_earned,score_override FROM assessment_results ORDER BY assessment_id'));
    assert.equal(rows.rowCount, 2);
    const byAssessment = new Map(rows.rows.map(r => [r.assessment_id, r]));
    assert.equal(rows.rows.filter(r => r.assessment_id === high).length, 1);
    const highRow = rows.rows.find(r => r.assessment_id === high);
    assert.equal(highRow.final_verdict, 'ACCEPTED');
    assert.equal(highRow.recheck_status, 'QUEUED');
    assert.equal(Number(highRow.points_earned), 0);
    assert.equal(Number(highRow.attempts_used), 1);
    assert.equal(byAssessment.get(normal).final_verdict, 'ACCEPTED');
    assert.equal(byAssessment.get(normal).late_status, 'LATE');
    assert.equal(Number(byAssessment.get(normal).points_earned), 6);
    assert.equal(Number(byAssessment.get(normal).score_override), 6);
    assert.ok(rows.rows.every(r => r.assessment_id !== null));

    const checkedRow = await asUser(teacher, c => c.query('SELECT final_verdict,recheck_status FROM assessment_results WHERE assessment_id=$1 AND user_id=$2', [high, other]));
    assert.equal(checkedRow.rows[0].final_verdict, 'WRONG_ANSWER');
    assert.equal(checkedRow.rows[0].recheck_status, 'DONE');

    const totals = await asUser(student, c => c.query('SELECT score,solved,pending_rechecks FROM assessment_user_results WHERE assessment_id=$1', [high]));
    assert.equal(Number(totals.rows[0].score), 0);
    assert.equal(Number(totals.rows[0].solved), 1);
    assert.equal(Number(totals.rows[0].pending_rechecks), 1);
  } finally {
    await pool.query('DELETE FROM submissions WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [[student, other, teacher]]);
    await pool.query('DELETE FROM assessments WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM courses WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM classes WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM organizations WHERE id=$1', [org]);
  }
});

test('claim_recheck is service-role only and concurrent claims never overlap', { skip: !url }, async () => {
  const org = uid(), student = uid(), cls = uid(), course = uid(), question = uid(), assessment = uid();
  await pool.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)', [org, 'Recheck Org', `rc-${org.slice(0, 8)}`]);
  await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [student, `${student}@fixture.invalid`]);
  await pool.query("INSERT INTO profiles(id,organization_id,role,full_name,email) VALUES($1,$2,'STUDENT','Student',$3)", [student, org, `${student}@fixture.invalid`]);
  await pool.query('INSERT INTO classes(id,organization_id,name,code) VALUES($1,$2,$3,$4)', [cls, org, 'Recheck Class', `rcc-${cls.slice(0, 8)}`]);
  await pool.query("INSERT INTO class_members(class_id,user_id,role) VALUES($1,$2,'STUDENT')", [cls, student]);
  await pool.query("INSERT INTO courses(id,organization_id,title,languages,status) VALUES($1,$2,'Recheck Course',ARRAY['PYTHON'],'PUBLISHED')", [course, org]);
  await pool.query('INSERT INTO class_courses(class_id,course_id) VALUES($1,$2)', [cls, course]);
  await pool.query("INSERT INTO questions(id,course_id,title,statement_md,difficulty) VALUES($1,$2,'Recheck Q','Statement','EASY')", [question, course]);
  await pool.query("INSERT INTO assessments(id,organization_id,course_id,class_id,title,question_ids,opens_at,closes_at,duration_minutes,high_stakes,status) VALUES($1,$2,$3,$4,'Recheck Assessment',ARRAY[$5]::uuid[],now()-interval '2 hours',now()-interval '1 hour',60,true,'CLOSED')", [assessment, org, course, cls, question]);
  const ids = [uid(), uid()];
  for (const id of ids) {
    await asService(c => c.query(`INSERT INTO submissions(id,user_id,pack_id,course_id,question_id,assessment_id,language,source,source_sha256,verdict,passed,total,total_time_ms,results_json,started_at,finished_at,monotonic_seq,device_id,late_status,recheck_status)
      VALUES($1,$2,'pack@1',$3,$4,$5,'PYTHON','x','${'c'.repeat(64)}','ACCEPTED',1,1,1,'[]',now(),now(),1,$6,'ON_TIME','QUEUED')`, [id, student, course, question, assessment, uid()]));
  }
  try {
    await assert.rejects(asUser(student, c => c.query('SELECT public.claim_recheck()')), e => e.code === '42501');
    const claim = async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN'); await c.query('SET LOCAL ROLE service_role');
        await c.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })]);
        const r = await c.query('SELECT id,recheck_status FROM public.claim_recheck()');
        await c.query('COMMIT'); return r.rows[0];
      } finally { c.release(); }
    };
    const [a, b] = await Promise.all([claim(), claim()]);
    assert.equal(a.recheck_status, 'RUNNING');
    assert.equal(b.recheck_status, 'RUNNING');
    assert.notEqual(a.id, b.id);
    assert.deepEqual([a.id, b.id].sort(), [...ids].sort());
    await pool.query("UPDATE submissions SET recheck_status='QUEUED' WHERE id=ANY($1::uuid[])", [ids]);
  } finally {
    await pool.query('DELETE FROM submissions WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM auth.users WHERE id=$1', [student]);
    await pool.query('DELETE FROM assessments WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM courses WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM classes WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM organizations WHERE id=$1', [org]);
  }
});

test.after(async () => pool.end());
