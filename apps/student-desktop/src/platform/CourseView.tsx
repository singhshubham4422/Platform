import { useEffect,useMemo,useState } from 'react';
import type { LanguageId } from '@lplatform/language-config';
import { packsGetQuestion,packsListQuestions,type PackInfo,type QuestionSummary,type QuestionView } from '../lib/packs';
import { runtimesList } from '../lib/runtimes';
import { RuntimeManager } from '../components/RuntimeManager';
import { LanguagePicker } from './LanguagePicker';
import { OfflineQuestionWorkspace } from './OfflineQuestionWorkspace';

export function CourseView({pack,onBack}:{pack:PackInfo;onBack:()=>void}){
 const [questions,setQuestions]=useState<QuestionSummary[]>([]);const [selected,setSelected]=useState<QuestionView|null>(null);const [language,setLanguage]=useState<LanguageId>((localStorage.getItem(`lp_platform_lang_${pack.packId}`)||pack.languages[0]||'PYTHON') as LanguageId);const [installed,setInstalled]=useState<string[]>([]);const [error,setError]=useState('');
 useEffect(()=>{void packsListQuestions(pack.packId).then(setQuestions).catch(e=>setError(String(e)));void runtimesList().then(x=>setInstalled(x.map(r=>r.language))).catch(()=>setInstalled([]))},[pack.packId]);
 const groups=useMemo(()=>{const m=new Map<string,QuestionSummary[]>();for(const q of questions){const topic=q.topics[0]||'General';m.set(topic,[...(m.get(topic)||[]),q])}return [...m.entries()]},[questions]);
 if(selected)return <OfflineQuestionWorkspace packId={pack.packId} question={selected} language={language} onBack={()=>setSelected(null)}/>;
 return <section className="platform-page"><header className="platform-head"><button className="btn" onClick={onBack}>← Platform</button><div><h1>{pack.title}</h1><p>Version {pack.version} · {pack.questionCount} questions</p></div></header>
 {error&&<p role="alert">{error}</p>}<LanguagePicker packId={pack.packId} languages={pack.languages} value={language} onChange={v=>{setLanguage(v);localStorage.setItem(`lp_platform_lang_${pack.packId}`,v)}}/>
 {!installed.includes(language)&&<div className="platform-runtime"><p>{language} runtime is not installed. Install it to run code offline.</p><RuntimeManager/></div>}
 {/* TODO(offline-integration): derive solved state from persisted attempts in phase 05. */}
 {groups.map(([topic,items])=><section key={topic} className="platform-topic"><h2>{topic}</h2><div className="platform-question-list">{items.map(q=><button className="platform-question" key={q.id} onClick={()=>void packsGetQuestion(pack.packId,q.id).then(setSelected).catch(e=>setError(String(e)))}><strong>{q.order}. {q.title}</strong><span>{q.difficulty} · {q.points} points</span><small>Not solved yet</small></button>)}</div></section>)}
 </section>;
}
