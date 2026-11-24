import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const url=process.env.SUPABASE_TEST_DATABASE_URL;
if(!url)throw new Error('SUPABASE_TEST_DATABASE_URL is required');
const pool=new pg.Pool({connectionString:url});
const uid=()=>crypto.randomUUID();
async function asUser(userId,fn,role='authenticated'){const c=await pool.connect();try{await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${role}`);await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:userId,role})]);return await fn(c)}finally{await c.query('ROLLBACK').catch(()=>{});c.release()}}
async function asService(fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE service_role');await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'service_role'})]);await fn(c);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}}

test('schema forces RLS on every C9 table',async()=>{const {rows}=await pool.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname");assert.equal(rows.length,19);for(const r of rows){assert.equal(r.relrowsecurity,true,r.relname);assert.equal(r.relforcerowsecurity,true,r.relname)}});

test('students see visible tests and own submissions only; inserts are pinned to auth.uid()',async(t)=>{
 const org=uid(),student=uid(),other=uid(),teacher=uid(),cls=uid(),course=uid(),question=uid(),device=uid();
 await pool.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)',[org,'Fixture Org',`t-${org.slice(0,8)}`]);
 for(const [id,email,role] of [[student,`${student}@fixture.invalid`,'STUDENT'],[other,`${other}@fixture.invalid`,'STUDENT'],[teacher,`${teacher}@fixture.invalid`,'TEACHER']]){await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,email]);await pool.query('INSERT INTO profiles(id,organization_id,role,full_name,email) VALUES($1,$2,$3,$4,$5)',[id,org,role,role,email])}
 await pool.query('INSERT INTO classes(id,organization_id,name,code) VALUES($1,$2,$3,$4)',[cls,org,'Fixture Class',`c-${cls.slice(0,8)}`]);await pool.query("INSERT INTO class_members(class_id,user_id,role) VALUES($1,$2,'STUDENT'),($1,$3,'STUDENT'),($1,$4,'TEACHER')",[cls,student,other,teacher]);
 await pool.query("INSERT INTO courses(id,organization_id,title,languages,status) VALUES($1,$2,'Fixture Course',ARRAY['PYTHON'],'PUBLISHED')",[course,org]);await pool.query('INSERT INTO class_courses(class_id,course_id) VALUES($1,$2)',[cls,course]);
 await pool.query("INSERT INTO questions(id,course_id,title,statement_md,difficulty) VALUES($1,$2,'Fixture Q','Statement','EASY')",[question,course]);await pool.query("INSERT INTO question_tests(question_id,kind,ordinal,input,expected_output) VALUES($1,'VISIBLE',1,'v-in','v-out'),($1,'HIDDEN',2,'secret-hidden-marker','secret-expected-marker')",[question]);
 t.after(async()=>{await pool.query('DELETE FROM submissions WHERE organization_id=$1',[org]);await pool.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])',[[student,other,teacher]]);await pool.query('DELETE FROM courses WHERE organization_id=$1',[org]);await pool.query('DELETE FROM classes WHERE organization_id=$1',[org]);await pool.query('DELETE FROM departments WHERE organization_id=$1',[org]);await pool.query('DELETE FROM organizations WHERE id=$1',[org])});
 const visible=await asUser(student,c=>c.query('SELECT kind,input,expected_output FROM question_tests WHERE question_id=$1 ORDER BY ordinal',[question]));assert.deepEqual(visible.rows,[{kind:'VISIBLE',input:'v-in',expected_output:'v-out'}]);
 const inserted=await asUser(student,c=>c.query(`INSERT INTO submissions(user_id,pack_id,course_id,question_id,language,source,source_sha256,verdict,passed,total,total_time_ms,results_json,started_at,finished_at,monotonic_seq,device_id)
 VALUES($1,'course@1',$2,$3,'PYTHON','print(1)','${'a'.repeat(64)}','ACCEPTED',1,1,1,'[]',now(),now(),1,$4) RETURNING user_id,organization_id`,[teacher,course,question,device]));assert.equal(inserted.rows[0].user_id,student);assert.equal(inserted.rows[0].organization_id,org);
 await asService(c=>c.query(`INSERT INTO submissions(user_id,organization_id,pack_id,course_id,question_id,language,source,source_sha256,verdict,passed,total,total_time_ms,results_json,started_at,finished_at,monotonic_seq,device_id) VALUES($1,$2,'course@1',$3,$4,'PYTHON','x','${'b'.repeat(64)}','ACCEPTED',1,1,1,'[]',now(),now(),2,$5)`,[other,org,course,question,uid()]));
 await asService(c=>c.query(`INSERT INTO submissions(user_id,organization_id,pack_id,course_id,question_id,language,source,source_sha256,verdict,passed,total,total_time_ms,results_json,started_at,finished_at,monotonic_seq,device_id) VALUES($1,$2,'course@1',$3,$4,'PYTHON','own','${'c'.repeat(64)}','ACCEPTED',1,1,1,'[]',now(),now(),3,$5)`,[student,org,course,question,uid()]));
 const mine=await asUser(student,c=>c.query('SELECT user_id FROM submissions'));assert.deepEqual(mine.rows.map(r=>r.user_id),[student]);
 const denied=await asUser(student,c=>c.query('UPDATE submissions SET source=source||\'y\' RETURNING id'));assert.equal(denied.rowCount,0);
 await assert.rejects(asUser(student,c=>c.query('SELECT * FROM assessment_keys')),e=>e.code==='42501');
 await assert.rejects(asUser(student,c=>c.query('SELECT * FROM organizations'), 'anon'),e=>e.code==='42501');
});

test('bootstrap refuses forbidden email domains before contacting the database',async()=>{
 const {spawnSync}=await import('node:child_process');const script=fileURLToPath(new URL('../../../supabase/scripts/bootstrap-owner.mjs',import.meta.url));const r=spawnSync(process.execPath,[script,'--database-url','postgresql://invalid','--email','owner@sample.test','--full-name','Owner'],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/Refusing a test, example, local or demo/);
});

test('local owner bootstrap creates one owner and refuses a second',async()=>{
 const {spawnSync}=await import('node:child_process');const script=fileURLToPath(new URL('../../../supabase/scripts/bootstrap-owner.mjs',import.meta.url));const email='owner@fixture.invalid';
 const run=()=>spawnSync(process.execPath,[script,'--database-url',url,'--email',email,'--full-name','Fixture Owner','--local-stub'],{encoding:'utf8'});
 const first=run();assert.equal(first.status,0,first.stderr);const owner=await pool.query("SELECT id FROM profiles WHERE role='PLATFORM_OWNER' AND email=$1",[email]);assert.equal(owner.rowCount,1);
 const second=run();assert.notEqual(second.status,0);assert.match(second.stderr,/A PLATFORM_OWNER already exists/);
 await pool.query('DELETE FROM profiles WHERE id=$1',[owner.rows[0].id]);await pool.query('DELETE FROM auth.users WHERE id=$1',[owner.rows[0].id]);
});

test.after(async()=>pool.end());
