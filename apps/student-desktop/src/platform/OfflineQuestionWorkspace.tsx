import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { getLanguage, type LanguageId } from '@lplatform/language-config';
import { recordEvent, getLocalDraft, saveLocalDraft } from '../lib/outbox';
import { runCustom } from '../lib/runner';
import { runQuestion, type QuestionView } from '../lib/packs';
import { verdictLabel } from '../workspace/verdict-label';
import { registerCompletions } from '../workspace/monaco-setup';
import { useResizable } from '../workspace/useResizable';
import { useEditorPreferences } from '../workspace/preferences';

export function OfflineQuestionWorkspace({packId,question,language,onBack}:{packId:string;question:QuestionView;language:LanguageId;onBack:()=>void}) {
  const [code,setCode]=useState(question.starterCode[language]??getLanguage(language)!.starterCode);
  const [custom,setCustom]=useState(''); const [result,setResult]=useState<Awaited<ReturnType<typeof runQuestion>>|null>(null);
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const {prefs}=useEditorPreferences();
  const previous=useRef(code);const burst=useRef<{inserted:number;deleted:number;start:number}|null>(null);const burstTimer=useRef<number|undefined>(undefined);const idleAt=useRef(Date.now());
  const split=useResizable({initial:.42,min:.25,max:.65,axis:'x',storageKey:'lp_platform_split'});
  useEffect(()=>{registerCompletions();const d=getLocalDraft(question.id,null,language);setCode(d?.content??question.starterCode[language]??getLanguage(language)!.starterCode);recordEvent('question_opened',{questionId:question.id,assignmentId:null,packId},{language})},[packId,question.id,language]);
  useEffect(()=>{const t=window.setTimeout(()=>{saveLocalDraft({questionId:question.id,assignmentId:null,language,content:code});recordEvent('draft_saved',{questionId:question.id,assignmentId:null,packId},{chars:code.length})},600);return()=>window.clearTimeout(t)},[code,question.id,language]);
  useEffect(()=>{const lost=()=>recordEvent('window_focus_lost',{questionId:question.id,packId});let leftAt=0;const blur=()=>{leftAt=Date.now();lost()};const focus=()=>{if(leftAt)recordEvent('window_focus_gained',{questionId:question.id,packId},{awayMs:Date.now()-leftAt});leftAt=0};window.addEventListener('blur',blur);window.addEventListener('focus',focus);return()=>{window.removeEventListener('blur',blur);window.removeEventListener('focus',focus)}},[question.id,packId]);
  const activity=()=>{const now=Date.now();if(now-idleAt.current>=60000)recordEvent('idle_period',{questionId:question.id,packId},{idleMs:now-idleAt.current});idleAt.current=now};
  const changed=(value:string)=>{activity();const old=previous.current;const common=Math.min(old.length,value.length);const inserted=Math.max(0,value.length-common);const deleted=Math.max(0,old.length-common);previous.current=value;setCode(value);if(!burst.current)burst.current={inserted,deleted,start:Date.now()};else{burst.current.inserted+=inserted;burst.current.deleted+=deleted}window.clearTimeout(burstTimer.current);burstTimer.current=window.setTimeout(()=>{const b=burst.current;if(b)recordEvent('code_changed',{questionId:question.id,packId},{insertedChars:b.inserted,deletedChars:b.deleted,burstMs:Date.now()-b.start});burst.current=null},2000)};
  const run=async(mode:'RUN'|'SUBMIT')=>{setBusy(true);setError('');recordEvent('run_requested',{questionId:question.id,assignmentId:null,packId},{mode});try{const r=await runQuestion(packId,question.id,language,code,mode);setResult(r);recordEvent('execution_completed',{questionId:question.id,assignmentId:null,packId,attemptId:r.attemptId},{attemptId:r.attemptId,mode,verdict:r.verdict,passed:r.passed,total:r.total,totalTimeMs:r.totalTimeMs});if(mode==='SUBMIT'){recordEvent('submission_created',{questionId:question.id,assignmentId:null,packId,attemptId:r.attemptId},{attemptId:r.attemptId,verdict:r.verdict,passed:r.passed,total:r.total});if(r.verdict==='ACCEPTED')recordEvent('question_completed',{questionId:question.id,packId,attemptId:r.attemptId},{attemptId:r.attemptId})}}catch(e){setError(String(e))}finally{setBusy(false)}};
  const customRun=async()=>{recordEvent('run_requested',{questionId:question.id,packId},{mode:'CUSTOM'});setBusy(true);try{const r=await runCustom(language,code,custom,question.limits);setResult(r);recordEvent('execution_completed',{questionId:question.id,packId,attemptId:r.attemptId},{attemptId:r.attemptId,mode:'CUSTOM',verdict:r.verdict,passed:r.passed,total:r.total,totalTimeMs:r.totalTimeMs})}catch(e){setError(String(e))}finally{setBusy(false)}};
  return <section className="offline-question"><header><button className="btn" onClick={onBack}>← Questions</button><h1>{question.title}</h1><span>{question.difficulty} · {question.points} points</span></header>
    <div className="offline-split" ref={split.containerRef} style={{gridTemplateColumns:`${split.ratio}fr 8px ${1-split.ratio}fr`}}>
      <article className="offline-statement"><h2>Problem</h2><pre>{question.statementMd}</pre><h3>Visible examples</h3>{question.visibleTests.map(t=><pre key={t.id}>{`Input\n${t.input}\nExpected output\n${t.expectedOutput}`}</pre>)}</article>
      <div className="offline-divider" role="separator" tabIndex={0} aria-label="Resize problem and editor panes" onPointerDown={split.handleProps.onPointerDown} onKeyDown={split.handleProps.onKeyDown}/>
      <div className="offline-editor" onPaste={e=>{const text=e.clipboardData.getData('text');if(text)recordEvent('paste_detected',{questionId:question.id,packId},{pastedChars:text.length,source:'external'})}}><Editor height="100%" language={getLanguage(language)?.monaco} value={code} onChange={v=>changed(v??'')} theme={prefs.theme==='dark'?'vs-dark':'vs'} options={{fontSize:prefs.fontSize,minimap:{enabled:prefs.minimap},wordWrap:prefs.wordWrap?'on':'off',automaticLayout:true}}/>
        <div className="offline-controls"><button className="btn btn-primary" disabled={busy} onClick={()=>void run('RUN')}>Run</button><button className="btn" disabled={busy} onClick={()=>void customRun()}>Custom input</button><button className="btn btn-primary" disabled={busy} onClick={()=>void run('SUBMIT')}>Submit</button></div><textarea aria-label="Custom input" value={custom} onChange={e=>setCustom(e.target.value)} placeholder="Custom stdin"/>
        <div className="offline-results" aria-live="polite">{error&&<p role="alert">{error}</p>}{result&&<><strong>{verdictLabel(result.verdict)} · {result.passed}/{result.total}</strong>{result.tests.map((t,i)=><div key={`${t.testId}-${i}`}><b>{t.hidden?`Hidden test ${i+1}`:`Test ${t.testId}`}: {verdictLabel(t.verdict)}</b><small> · {t.timeMs} ms · {t.memoryKb} KB</small>{!t.hidden&&t.stdout!==null&&<pre>{t.stdout}</pre>}</div>)}</>}</div>
      </div>
    </div>
  </section>;
}
