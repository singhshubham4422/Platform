const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const number = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
export function roundHalfAway(value, places=0) {
  const scale=10**places, abs=Math.abs(value)*scale;
  return Math.sign(value)*Math.floor(abs+Number.EPSILON*Math.max(1,abs)+0.5)/scale;
}
export function normaliseEvents(events) {
  const rows=(Array.isArray(events)?events:[]).filter(e=>e&&typeof e.userId==='string'&&e.userId&&validDate(e.clientTs)&&typeof e.eventType==='string'&&e.eventType&&Number.isFinite(Number(e.seq)));
  rows.sort((a,b)=>Number(a.seq)-Number(b.seq));
  const seen=new Set(),out=[];
  for(const e of rows) { if(typeof e.eventId==='string'&&e.eventId) {if(seen.has(e.eventId))continue;seen.add(e.eventId)} out.push(e); }
  return out.sort((a,b)=>a.userId.localeCompare(b.userId)||Number(a.seq)-Number(b.seq));
}
const dayOf=(e)=>new Date(e.clientTs).toISOString().slice(0,10);
const group=(rows,keyFn)=>{const m=new Map();for(const r of rows){const k=keyFn(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return m};
function activeSeconds(rows) {
  const sorted=[...rows].sort((a,b)=>Number(a.seq)-Number(b.seq));let seconds=0;
  for(let i=1;i<sorted.length;i++) {
    const a=sorted[i-1],b=sorted[i];
    if(b.eventType==='idle_period'||sorted.some(e=>e.eventType==='idle_period'&&Date.parse(e.clientTs)>Date.parse(a.clientTs)&&Date.parse(e.clientTs)<=Date.parse(b.clientTs))) continue;
    const gap=(Date.parse(b.clientTs)-Date.parse(a.clientTs))/1000;
    seconds+=Math.min(120,Math.max(0,gap));
  }
  return seconds;
}
function submissionStats(rows) {
  const submissions=rows.filter(e=>e.eventType==='submission_created'&&e.questionId);
  const byQuestion=group(submissions,e=>e.questionId), solved=new Set();
  for(const [q,attempts] of byQuestion)if(attempts.some(e=>e.metadata?.verdict==='ACCEPTED'))solved.add(q);
  return {attempted:byQuestion.size,solved,submissions};
}
export function computeStudentDaily(events,{computedAt=new Date().toISOString()}={}) {
  const normalized=normaliseEvents(events),byDay=group(normalized,e=>`${e.userId}|${dayOf(e)}`),out=[];
  for(const rows of byDay.values()) {
    const [user_id,day]=`${rows[0].userId}|${dayOf(rows[0])}`.split('|'),stats=submissionStats(rows);
    const typed=rows.filter(e=>e.eventType==='code_changed').reduce((n,e)=>n+number(e.metadata?.insertedChars),0);
    const pasted=rows.filter(e=>e.eventType==='paste_detected'&&e.metadata?.source==='external').reduce((n,e)=>n+number(e.metadata?.pastedChars),0);
    const idle=rows.filter(e=>e.eventType==='idle_period').reduce((n,e)=>n+number(e.metadata?.idleMs),0)/60000;
    out.push({organization_id:rows[0].organizationId??null,user_id,day,active_minutes:roundHalfAway(activeSeconds(rows)/60,1),questions_attempted:stats.attempted,questions_solved:stats.solved.size,
      runs:rows.filter(e=>e.eventType==='execution_completed'&&e.metadata?.mode==='RUN').length,submits:stats.submissions.length,accepted_submits:stats.submissions.filter(e=>e.metadata?.verdict==='ACCEPTED').length,
      typed_chars:typed,paste_chars:pasted,paste_ratio:roundHalfAway(pasted+typed?pasted/(pasted+typed):0,3),focus_lost_count:rows.filter(e=>e.eventType==='window_focus_lost').length,idle_minutes:roundHalfAway(idle,1),computed_at:computedAt});
  }
  return out.sort((a,b)=>a.user_id.localeCompare(b.user_id)||a.day.localeCompare(b.day));
}
export function computeStudentTopic(events,questionMeta,{computedAt=new Date().toISOString()}={}) {
  const normalized=normaliseEvents(events),statsByUser=new Map();let skippedQuestions=0;
  const users=group(normalized.filter(e=>e.eventType==='submission_created'&&e.questionId),e=>e.userId);
  for(const [userId,rows] of users) {
    const stats=submissionStats(rows);const topics=new Map();
    for(const q of stats.submissions.map(e=>e.questionId).filter((x,i,a)=>a.indexOf(x)===i)) {
      const meta=questionMeta.get(q);if(!meta){skippedQuestions++;continue;}
      for(const topic of meta.topics??[]) {if(!topics.has(topic))topics.set(topic,{attempted:0,solved:0});const x=topics.get(topic);x.attempted++;if(stats.solved.has(q))x.solved++;}
    }
    statsByUser.set(userId,{topics,rows});
  }
  const out=[];
  for(const [userId,v] of statsByUser) {const org=v.rows[0]?.organizationId??null;for(const [topic,x] of v.topics)out.push({organization_id:org,user_id:userId,topic,attempted:x.attempted,solved:x.solved,mastery:Math.min(100,Math.max(0,roundHalfAway(100*(x.solved+1)/(x.attempted+2)))),computed_at:computedAt});}
  return {rows:out.sort((a,b)=>a.user_id.localeCompare(b.user_id)||a.topic.localeCompare(b.topic)),skippedQuestions};
}
export function computeAssessment(events,assessments,questionMeta,{computedAt=new Date().toISOString()}={}) {
  const normalized=normaliseEvents(events),eventRows=normalized.filter(e=>e.assessmentId),byUserAssessment=group(eventRows,e=>`${e.userId}|${e.assessmentId}`),out=[];
  for(const [key,rows] of byUserAssessment) {
    const [user_id,assessment_id]=key.split('|'),meta=assessments.get(assessment_id);if(!meta)continue;
    const submissions=rows.filter(e=>e.eventType==='submission_created'&&e.questionId),byQ=group(submissions,e=>e.questionId),solved=[...byQ].filter(([,ss])=>ss.some(e=>e.metadata?.verdict==='ACCEPTED')).map(([q])=>q);
    const typedByQuestion=new Map();for(const e of rows.filter(e=>e.eventType==='code_changed'))typedByQuestion.set(e.questionId,(typedByQuestion.get(e.questionId)??0)+number(e.metadata?.insertedChars));
    const typed=rows.filter(e=>e.eventType==='code_changed').reduce((n,e)=>n+number(e.metadata?.insertedChars),0),paste=rows.filter(e=>e.eventType==='paste_detected'&&e.metadata?.source==='external').reduce((n,e)=>n+number(e.metadata?.pastedChars),0);
    const ratio=paste+typed?paste/(paste+typed):0,focus=rows.filter(e=>e.eventType==='window_focus_lost').length,flags=[];
    if(ratio>0.5&&paste>200)flags.push('HIGH_PASTE');
    const questionOpen=group(rows.filter(e=>e.eventType==='question_opened'&&e.questionId),e=>e.questionId);
    const fast=solved.some(q=>{const opening=questionOpen.get(q)?.[0];const accepted=byQ.get(q)?.filter(e=>e.metadata?.verdict==='ACCEPTED')??[];return opening&&(typedByQuestion.get(q)??0)<50&&accepted.some(e=>Date.parse(e.clientTs)-Date.parse(opening.clientTs)<60000&&Date.parse(e.clientTs)>=Date.parse(opening.clientTs));});
    if(fast)flags.push('FAST_SOLVE');if(focus>20)flags.push('MANY_FOCUS_LOSS');
    const points=solved.reduce((n,q)=>n+number(questionMeta.get(q)?.points),0);
    out.push({organization_id:meta.organizationId,user_id,assessment_id,score:points,solved:solved.length,total_questions:(meta.questionIds??[]).length,time_minutes:roundHalfAway(activeSeconds(rows)/60,1),flags,computed_at:computedAt});
  }
  return out.sort((a,b)=>a.assessment_id.localeCompare(b.assessment_id)||a.user_id.localeCompare(b.user_id));
}
