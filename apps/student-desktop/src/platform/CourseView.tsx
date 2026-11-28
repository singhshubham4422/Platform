import { useEffect,useMemo,useState } from 'react';
import type { LanguageId } from '@platform/language-config';
import { packsGetQuestion,packsListQuestions,type PackInfo,type QuestionSummary,type QuestionView } from '../lib/packs';
import { runtimesList } from '../lib/runtimes';
import { RuntimeManager } from '../components/RuntimeManager';
import { LanguagePicker } from './LanguagePicker';
import { OfflineQuestionWorkspace } from './OfflineQuestionWorkspace';
import { attemptsList } from '../lib/offline-store';

export function CourseView({pack,onBack}:{pack:PackInfo;onBack:()=>void}){
 const [questions,setQuestions]=useState<QuestionSummary[]>([]);const [selected,setSelected]=useState<QuestionView|null>(null);const [language,setLanguage]=useState<LanguageId>((localStorage.getItem(`lp_platform_lang_${pack.packId}`)||pack.languages[0]||'PYTHON') as LanguageId);const [installed,setInstalled]=useState<string[]>([]);const [error,setError]=useState('');const [solved,setSolved]=useState<Set<string>>(new Set());
 useEffect(()=>{void packsListQuestions(pack.packId).then(setQuestions).catch(e=>setError(String(e)));void runtimesList().then(x=>setInstalled(x.map(r=>r.language))).catch(()=>setInstalled([]))},[pack.packId]);
 // Solved = any local SUBMIT attempt for the question that was ACCEPTED (phase 05).
 useEffect(()=>{if(selected)return;void attemptsList(pack.packId).then(rows=>setSolved(new Set(rows.filter(a=>a.mode==='SUBMIT'&&a.verdict==='ACCEPTED').map(a=>a.questionId)))).catch(()=>setSolved(new Set()))},[pack.packId,selected]);
 const groups=useMemo(()=>{const m=new Map<string,QuestionSummary[]>();for(const q of questions){const topic=q.topics[0]||'General';m.set(topic,[...(m.get(topic)||[]),q])}return [...m.entries()]},[questions]);
 if(selected)return <OfflineQuestionWorkspace packId={pack.packId} assessmentId={pack.assessmentId} question={selected} language={language} onBack={()=>setSelected(null)}/>;
 return <section className="platform-page"><header className="platform-head"><button className="btn" onClick={onBack}>← Platform</button><div><h1>{pack.title}</h1><p>Version {pack.version} · {pack.questionCount} questions</p></div></header>
 {error&&<p role="alert">{error}</p>}<LanguagePicker packId={pack.packId} languages={pack.languages} value={language} onChange={v=>{setLanguage(v);localStorage.setItem(`lp_platform_lang_${pack.packId}`,v)}}/>
 {!installed.includes(language)&&<div className="platform-runtime"><p>{language} runtime is not installed. Install it to run code offline.</p><RuntimeManager/></div>}
 {groups.map(([topic,items])=><section key={topic} className="platform-topic"><h2>{topic}</h2><div className="platform-question-list">{items.map(q=><button className="platform-question" key={q.id} onClick={()=>void packsGetQuestion(pack.packId,q.id).then(setSelected).catch(e=>setError(String(e)))}><strong>{q.order}. {q.title}</strong><span>{q.difficulty} · {q.points} points</span><small>{solved.has(q.id)?'✓ Solved':'Not solved yet'}</small></button>)}</div></section>)}
 </section>;
}
