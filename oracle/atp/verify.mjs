import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const missing=['ATP_USER','ATP_PASSWORD','ATP_CONNECT_STRING'].filter(k=>!process.env[k]);
if(missing.length){console.log(`SKIPPED: set ATP_* env (${missing.join(', ')}) to verify the isolated LPKPI_VERIFY schema.`);process.exit(0);}
if(process.env.ATP_USER.toUpperCase()!=='LPKPI_VERIFY') { console.error('Refusing to verify with a schema other than LPKPI_VERIFY; production LPKPI is never touched.');process.exit(2); }
const { readFile,readdir }=await import('node:fs/promises');const path=await import('node:path');const {fileURLToPath}=await import('node:url');
const {computeStudentDaily,computeStudentTopic,computeAssessment,normaliseEvents}=await import('../../packages/kpi-calc/index.js');
const fixtureRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'fixtures');
const driver=process.env.ATP_ORACLEDB_MODULE_DIR?await import(pathToFileURL(join(process.env.ATP_ORACLEDB_MODULE_DIR,'index.js')).href):await import('oracledb');
const oracledb=driver.default??driver;oracledb.fetchAsString=[oracledb.CLOB];
const fixtureFiles=(await readdir(fixtureRoot)).filter(n=>n.startsWith('events-')&&n.endsWith('.jsonl'));
const raw=[];for(const f of fixtureFiles)raw.push(...(await readFile(path.join(fixtureRoot,f),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)));
const events=normaliseEvents(raw),questions=JSON.parse(await readFile(path.join(fixtureRoot,'questions.json'),'utf8')),assessments=JSON.parse(await readFile(path.join(fixtureRoot,'assessments.json'),'utf8'));
const qmap=new Map(questions.map(x=>[x.questionId,x])),amap=new Map(assessments.map(x=>[x.assessmentId,x]));
const expected={daily:computeStudentDaily(events),topics:computeStudentTopic(events,qmap).rows,assessment:computeAssessment(events,amap,qmap)};
const conn=await oracledb.getConnection({user:process.env.ATP_USER,password:process.env.ATP_PASSWORD,connectString:process.env.ATP_CONNECT_STRING});
const fail=(name,actual,want)=>{const norm=x=>JSON.stringify(x);if(norm(actual)!==norm(want))throw new Error(`${name} KPI mismatch\nexpected=${norm(want)}\nactual=${norm(actual)}`)};
try {
  await conn.execute("DELETE FROM lp_stg_activity WHERE object_name='VERIFY_FIXTURE'");
  await conn.execute('DELETE FROM lp_dim_question');await conn.execute('DELETE FROM lp_dim_assessment');
  for(const q of questions)await conn.execute('INSERT INTO lp_dim_question(question_id,topics,points) VALUES(:id,:topics,:points)',{id:q.questionId,topics:JSON.stringify(q.topics),points:q.points});
  for(const a of assessments)await conn.execute('INSERT INTO lp_dim_assessment(assessment_id,organization_id,question_ids) VALUES(:id,:org,:ids)',{id:a.assessmentId,org:a.organizationId,ids:JSON.stringify(a.questionIds)});
  const insert=`MERGE INTO lp_stg_activity t USING (SELECT :event_id event_id,:seq seq,:event_type event_type,TO_TIMESTAMP_TZ(:client_ts,'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') client_ts,:user_id user_id,:organization_id organization_id,:device_id device_id,:pack_id pack_id,:question_id question_id,:assessment_id assessment_id,:attempt_id attempt_id,:language language,:metadata metadata FROM dual) s ON(t.event_id=s.event_id) WHEN NOT MATCHED THEN INSERT(event_id,seq,event_type,client_ts,user_id,organization_id,device_id,pack_id,question_id,assessment_id,attempt_id,language,metadata,object_name,loaded_at) VALUES(s.event_id,s.seq,s.event_type,s.client_ts,s.user_id,s.organization_id,s.device_id,s.pack_id,s.question_id,s.assessment_id,s.attempt_id,s.language,s.metadata,'VERIFY_FIXTURE',SYSTIMESTAMP)`;
  const loadable=raw.filter(e=>e.userId&&e.clientTs&&e.eventType).sort((a,b)=>Number(a.seq)-Number(b.seq));
  for(const e of loadable)await conn.execute(insert,{event_id:e.eventId??null,seq:Number(e.seq)||0,event_type:e.eventType,client_ts:e.clientTs,user_id:e.userId,organization_id:e.organizationId??null,device_id:e.deviceId??null,pack_id:e.packId??null,question_id:e.questionId??null,assessment_id:e.assessmentId??null,attempt_id:e.attemptId??null,language:e.language??null,metadata:JSON.stringify(e.metadata??{})});
  await conn.commit();await conn.execute("BEGIN lp_kpi.compute_changed(SYSTIMESTAMP - INTERVAL '1' DAY); END;");
  const daily=await conn.execute('SELECT organization_id,user_id,TO_CHAR(day,\'YYYY-MM-DD\') day,active_minutes,questions_attempted,questions_solved,runs,submits,accepted_submits,typed_chars,paste_chars,paste_ratio,focus_lost_count,idle_minutes FROM lp_kpi_student_daily WHERE user_id IN (SELECT DISTINCT user_id FROM lp_stg_activity WHERE object_name=\'VERIFY_FIXTURE\') ORDER BY user_id,day');
  const topics=await conn.execute('SELECT organization_id,user_id,topic,attempted,solved,mastery FROM lp_kpi_student_topic WHERE user_id IN (SELECT DISTINCT user_id FROM lp_stg_activity WHERE object_name=\'VERIFY_FIXTURE\') ORDER BY user_id,topic');
  const assessment=await conn.execute('SELECT organization_id,user_id,assessment_id,score,solved,total_questions,time_minutes,flags FROM lp_kpi_assessment WHERE assessment_id IN (SELECT DISTINCT assessment_id FROM lp_stg_activity WHERE object_name=\'VERIFY_FIXTURE\') ORDER BY assessment_id,user_id');
  const project=(rows,keys)=>rows.map(row=>Object.fromEntries(keys.map(k=>[k,typeof row[k.toUpperCase()]==='number'?row[k.toUpperCase()]:row[k.toUpperCase()]])));
  const dkeys=['organization_id','user_id','day','active_minutes','questions_attempted','questions_solved','runs','submits','accepted_submits','typed_chars','paste_chars','paste_ratio','focus_lost_count','idle_minutes'];
  const tkeys=['organization_id','user_id','topic','attempted','solved','mastery'];const akeys=['organization_id','user_id','assessment_id','score','solved','total_questions','time_minutes','flags'];
  const actualAssessment=project(assessment.rows,akeys).map(r=>({...r,flags:typeof r.flags==='string'?JSON.parse(r.flags):r.flags}));
  fail('daily',project(daily.rows,dkeys),expected.daily.map(({computed_at,...r})=>r));
  fail('topics',project(topics.rows,tkeys),expected.topics.map(({computed_at,...r})=>r));
  fail('assessment',actualAssessment,expected.assessment.map(({computed_at,...r})=>r));
  console.log(`ATP verification passed: ${events.length} normalized fixture events; daily=${daily.rows.length}, topic=${topics.rows.length}, assessment=${assessment.rows.length}.`);
} catch(e) {await conn.rollback();console.error(e.stack??e.message);process.exitCode=1;} finally {await conn.close();}
