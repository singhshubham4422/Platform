import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const value = (flag) => { const i=args.indexOf(flag); return i < 0 ? undefined : args[i+1]; };
const bank = path.resolve(value('--in') ?? '');
const db = value('--database-url');
const execute = args.includes('--i-understand-this-writes');
if (!value('--in')) { console.error('Usage: node supabase/scripts/import-jbank.mjs --in <bank.json> [--database-url <url> --i-understand-this-writes]'); process.exit(2); }
if (!execute || !db) { console.log(JSON.stringify({ plan:'Import J-platform bank as DRAFT / IMPORTED_UNREVIEWED; stable question IDs; no solution code.', input:bank, writes:false, command:'add --database-url <url> --i-understand-this-writes to execute' },null,2)); process.exit(1); }
const temp=await mkdtemp(path.join(os.tmpdir(),'lplatform-jbank-'));
try {
  const cli=path.join(root,'packages/pack-format/bin/pack-builder.mjs');
  const sourcePath=path.join(temp,'source.json');
  const converted=spawnSync(process.execPath,[cli,'import-jplatform','--in',bank,'--out',sourcePath,'--course-id','7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01','--version','1','--title','Java Practice (imported, unreviewed)'],{cwd:root,encoding:'utf8'});
  if(converted.status!==0) throw new Error(converted.stderr||converted.stdout||'Conversion failed');
  const pack=JSON.parse(await readFile(sourcePath,'utf8'));
  const requireFromTests=createRequire(path.join(root,'packages/supabase-tests/package.json'));
  const {Client}=requireFromTests('pg'); const client=new Client({connectionString:db}); await client.connect();
  try {
    await client.query('BEGIN');
    const course=pack.course ?? pack;
    const courseId=course.id ?? '7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01';
    await client.query(`INSERT INTO public.courses(id,organization_id,title,description,languages,status,content_status) VALUES($1,NULL,$2,$3,$4,'DRAFT','IMPORTED_UNREVIEWED') ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,languages=EXCLUDED.languages,status='DRAFT',content_status='IMPORTED_UNREVIEWED'`,[courseId,course.title??'J-platform imported bank',course.description??'',course.languages??['PYTHON','C','CPP','JAVA']]);
    for(const [i,q] of (pack.questions??[]).entries()) {
      const id=q.id;
      await client.query(`INSERT INTO public.questions(id,course_id,title,statement_md,difficulty,points,topics,time_limit_ms,memory_limit_mb,output_limit_kb,starter_code,order_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,statement_md=EXCLUDED.statement_md,starter_code=EXCLUDED.starter_code,order_index=EXCLUDED.order_index`,[id,courseId,q.title??`Question ${i+1}`,q.statementMd??q.statement??'',q.difficulty??'MEDIUM',q.points??10,q.topics??[],q.limits?.timeLimitMs??2000,q.limits?.memoryLimitMb??256,q.limits?.outputLimitKb??64,q.starterCode??{},i]);
      for(const [kind,items] of [['VISIBLE',q.visibleTests??[]],['HIDDEN',q.hiddenTests??[]]]) for(const [n,t] of items.entries()) await client.query(`INSERT INTO public.question_tests(question_id,kind,ordinal,input,expected_output) VALUES($1,$2,$3,$4,$5) ON CONFLICT(question_id,kind,ordinal) DO UPDATE SET input=EXCLUDED.input,expected_output=EXCLUDED.expected_output`,[id,kind,n,t.input??'',t.expectedOutput??t.expected_output??'']);
    }
    await client.query('COMMIT'); console.log(JSON.stringify({courseId,questions:pack.questions?.length??0,status:'DRAFT',contentStatus:'IMPORTED_UNREVIEWED'},null,2));
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { await client.end(); }
} finally { await rm(temp,{recursive:true,force:true}); }
