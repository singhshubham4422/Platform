import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseEvents, computeStudentDaily, computeStudentTopic, computeAssessment, roundHalfAway } from '../index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../oracle/atp/fixtures');
const computedAt='2026-11-24T00:00:00.000Z';
async function events(name){return (await readFile(path.join(root,name),'utf8')).trim().split(/\r?\n/).map(JSON.parse)}
const questions=new Map(JSON.parse(await readFile(path.join(root,'questions.json'),'utf8')).map(q=>[q.questionId,q]));
const assessments=new Map(JSON.parse(await readFile(path.join(root,'assessments.json'),'utf8')).map(a=>[a.assessmentId,a]));
test('hand-calculated normal day fixture matches daily and topic expected rows',async()=>{
 const ev=await events('events-normal.jsonl'),expected=JSON.parse(await readFile(path.join(root,'expected-normal.json'),'utf8'));
 assert.deepEqual(computeStudentDaily(ev,{computedAt}),expected.daily);assert.deepEqual(computeStudentTopic(ev,questions,{computedAt}),expected.topics);
});
test('hand-calculated assessment fixture matches C11 score, time and all three flags',async()=>{
 const ev=await events('events-assessment.jsonl'),expected=JSON.parse(await readFile(path.join(root,'expected-assessment.json'),'utf8'));
 assert.deepEqual(computeAssessment(ev,assessments,questions,{computedAt}),expected);
});
test('duplicate IDs keep the lowest sequence and fixture coverage includes midnight, idle, paste, missing metadata and two orgs',async()=>{
 const dup=await events('events-duplicates.jsonl');assert.equal(normaliseEvents(dup).length,1);assert.equal(normaliseEvents(dup)[0].metadata.insertedChars,9);
 assert.equal(normaliseEvents(await events('events-invalid.jsonl')).length,0);
 const midnight=computeStudentDaily(await events('events-midnight.jsonl'),{computedAt});assert.deepEqual(midnight.map(x=>[x.day,x.active_minutes]),[['2026-11-24',0.3],['2026-11-25',0]]);
 const idle=computeStudentDaily(await events('events-idle.jsonl'),{computedAt})[0];assert.equal(idle.active_minutes,2);assert.equal(idle.idle_minutes,1.5);
 const paste=computeStudentDaily(await events('events-paste.jsonl'),{computedAt})[0];assert.equal(paste.paste_chars,250);assert.equal(paste.typed_chars,250);assert.equal(paste.paste_ratio,0.5);
 const missing=computeStudentTopic(await events('events-missing-question.jsonl'),new Map(),{computedAt});assert.equal(missing.skippedQuestions,1);assert.deepEqual(missing.rows,[]);
 assert.equal(computeStudentDaily(await events('events-two-orgs.jsonl'),{computedAt}).length,2);
});
test('normalization and KPI invariants hold under input shuffle and duplicate replay',async()=>{
 const names=(await readdir(root)).filter(n=>n.startsWith('events-')&&n.endsWith('.jsonl'));
 for(const name of names){const ev=await events(name),baseline=computeStudentDaily(ev,{computedAt});
   assert.deepEqual(computeStudentDaily([...ev].reverse(),{computedAt}),baseline,name);
   assert.deepEqual(computeStudentDaily([...ev,...ev],{computedAt}),baseline,name);
   for(const row of baseline){assert.ok(row.paste_ratio>=0&&row.paste_ratio<=1);assert.ok(row.active_minutes<=24*60);}
 }
});
test('rounding is half away from zero at KPI precision',()=>{assert.equal(roundHalfAway(0.05,1),0.1);assert.equal(roundHalfAway(0.0005,3),0.001);assert.equal(roundHalfAway(-0.05,1),-0.1)});
test('FAST_SOLVE uses the first question_opened and treats no typing as zero typed chars',()=>{
 const base={userId:'00000000-0000-4000-8000-000000000001',organizationId:'00000000-0000-4000-8000-0000000000a1',assessmentId:'00000000-0000-4000-8000-0000000000e1',questionId:'00000000-0000-4000-8000-0000000000c1'};
 const ev=(seq,eventType,clientTs,metadata={})=>({...base,eventId:`00000000-0000-4000-8000-${String(seq).padStart(12,'0')}`,seq,eventType,clientTs,metadata});
 const am=new Map([[base.assessmentId,{organizationId:base.organizationId,questionIds:[base.questionId]}]]),qm=new Map([[base.questionId,{topics:['t'],points:10}]]);
 const noTyping=[ev(1,'question_opened','2026-11-24T10:00:00.000Z'),ev(2,'submission_created','2026-11-24T10:00:30.000Z',{verdict:'ACCEPTED'})];
 assert.deepEqual(computeAssessment(noTyping,am,qm,{computedAt})[0].flags,['FAST_SOLVE']);
 const reopened=[ev(1,'question_opened','2026-11-24T10:00:00.000Z'),ev(2,'question_opened','2026-11-24T10:09:50.000Z'),ev(3,'submission_created','2026-11-24T10:10:00.000Z',{verdict:'ACCEPTED'})];
 assert.deepEqual(computeAssessment(reopened,am,qm,{computedAt})[0].flags,[]);
});
