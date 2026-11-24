import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dbUrl = process.env.SUPABASE_TEST_DATABASE_URL;
test('J-bank importer is stable-ID idempotent and preserves review status without solution fields', {skip:!dbUrl}, async()=>{
  const script=path.join(root,'supabase/scripts/import-jbank.mjs'),bank=path.join(root,'content/j-platform-question-bank/questions.json');
  for(let i=0;i<2;i++) execFileSync(process.execPath,[script,'--in',bank,'--database-url',dbUrl,'--i-understand-this-writes'],{cwd:root,stdio:'pipe'});
  const client=new pg.Client({connectionString:dbUrl});await client.connect();
  try {
    const {rows:[course]}=await client.query("SELECT status,content_status FROM public.courses WHERE id='7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01'");assert.deepEqual(course,{status:'DRAFT',content_status:'IMPORTED_UNREVIEWED'});
    const {rows:[counts]}=await client.query("SELECT count(DISTINCT q.id)::int questions,count(t.id)::int tests FROM public.questions q LEFT JOIN public.question_tests t ON t.question_id=q.id WHERE q.course_id='7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01'");assert.equal(counts.questions,240);assert.ok(counts.tests>0);
    const {rows:[columns]}=await client.query("SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='questions' AND column_name ILIKE '%solution%'");assert.equal(columns.count,0);
    const student='dc2f2ce2-1e46-48fc-8448-78a767b95411',org='3cc3b3c4-e9bb-41f7-b3b6-9ab84fed095e';
    await client.query('BEGIN');
    await client.query('INSERT INTO public.organizations(id,name,slug) VALUES($1,$2,$3)',[org,'J-bank RLS fixture',`jb-${org.slice(0,8)}`]);
    await client.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[student,'jbank-student@fixture.invalid']);
    await client.query('INSERT INTO public.profiles(id,organization_id,role,full_name,email) VALUES($1,$2,\'STUDENT\',\'J-bank Student\',\'jbank-student@fixture.invalid\')',[student,org]);
    await client.query("UPDATE public.courses SET status='PUBLISHED' WHERE id='7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01'");
    await client.query('SET LOCAL ROLE authenticated');await client.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:student,role:'authenticated'})]);
    const visible=await client.query("SELECT t.kind,t.input FROM public.question_tests t JOIN public.questions q ON q.id=t.question_id WHERE q.course_id='7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01'");
    assert.ok(visible.rowCount>0);assert.ok(visible.rows.every(t=>t.kind==='VISIBLE'));await client.query('ROLLBACK');
  } finally { await client.end(); }
});
