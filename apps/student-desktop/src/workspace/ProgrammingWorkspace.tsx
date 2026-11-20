import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CloudOff,
  History,
  Loader2,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { LANGUAGES, getLanguage, type LanguageId } from '@lplatform/language-config';
import { monaco, registerCompletions } from './monaco-setup';
import {
  fetchHistory,
  fetchServerDrafts,
  fetchWorkspaceQuestion,
  runCode,
  submitCode,
  waitForJob,
  type HistoryItem,
  type Job,
  type WorkspaceQuestion,
} from '../lib/coding-api';
import {
  flushOutbox,
  getLocalDraft,
  queueSubmission,
  recordEvent,
  recordSnapshot,
  saveLocalDraft,
  uuid,
} from '../lib/outbox';
import { normalizeWhitespace } from '../lib/language-completions';
import { useEditorPreferences } from './preferences';
import { useResizable } from './useResizable';
import { verdictLabel } from './verdict-label';
import './workspace.css';

export interface WorkspaceProps {
  questionId: string;
  assignmentId?: string | null;
  courseId?: string | null;
  isOnline: boolean;
  onBack: () => void;
}

type ConsoleTab = 'tests' | 'custom' | 'output' | 'terminal';
type LeftTab = 'problem' | 'history';
type Phase = 'idle' | 'QUEUED' | 'COMPILING' | 'RUNNING' | 'done';

function VerdictPill({ verdict }: { verdict: string | null | undefined }) {
  const ok = verdict === 'ACCEPTED';
  const neutral = !verdict || verdict === 'JUDGE_UNAVAILABLE' || verdict === 'SUBMISSION_FAILED';
  return <span className={`ws-pill ${ok ? 'ws-pill-ok' : neutral ? 'ws-pill-neutral' : 'ws-pill-bad'}`}>{verdictLabel(verdict)}</span>;
}

const starterFor = (q: WorkspaceQuestion | null, lang: LanguageId) => q?.starter_code?.[lang] ?? getLanguage(lang)!.starterCode;

export const ProgrammingWorkspace: React.FC<WorkspaceProps> = ({ questionId, assignmentId = null, courseId = null, isOnline, onBack }) => {
  const [question, setQuestion] = useState<WorkspaceQuestion | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [language, setLanguage] = useState<LanguageId>('PYTHON');
  const [code, setCode] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [leftTab, setLeftTab] = useState<LeftTab>('problem');
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('tests');
  const [customInput, setCustomInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [activeKind, setActiveKind] = useState<'RUN' | 'SUBMIT' | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const { prefs, setPrefs } = useEditorPreferences();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const started = useRef(false);
  const lastInternalCopy = useRef<string>('');
  const snapshotTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const left = useResizable({ initial: 0.36, min: 0.24, max: 0.55, axis: 'x', storageKey: 'lp_ws_split_x' });
  const bottom = useResizable({ initial: 0.36, min: 0.18, max: 0.7, axis: 'y', storageKey: 'lp_ws_split_y' });
  const ctx = useMemo(() => ({ questionId, assignmentId, courseId }), [questionId, assignmentId, courseId]);
  const busy = phase !== 'idle' && phase !== 'done';
  const allowed = useMemo(
    () => (question?.allowedLanguages?.length ? LANGUAGES.filter((l) => question.allowedLanguages.map((x) => x.toUpperCase()).includes(l.id)) : LANGUAGES),
    [question],
  );

  // ---------- load question + drafts ----------
  useEffect(() => {
    let cancelled = false;
    registerCompletions();
    setLoadError(null);
    fetchWorkspaceQuestion(questionId, assignmentId)
      .then(async (q) => {
        if (cancelled) return;
        setQuestion(q);
        const preferred = (prefs.defaultLanguage && q.allowedLanguages.includes(prefs.defaultLanguage) ? prefs.defaultLanguage : q.allowedLanguages[0]?.toUpperCase()) as LanguageId;
        const lang = getLanguage(preferred) ? preferred : 'PYTHON';
        setLanguage(lang);
        // Server drafts are merged into the local store only when they are newer.
        try {
          const server = await fetchServerDrafts(questionId, assignmentId);
          for (const d of server.drafts) {
            const local = getLocalDraft(questionId, assignmentId, d.language);
            if (!local || new Date(local.updatedAt) < new Date(d.client_updated_at)) {
              saveLocalDraft({ questionId, assignmentId, language: d.language, content: d.content });
            }
          }
        } catch {
          /* offline: local drafts only */
        }
        const local = getLocalDraft(questionId, assignmentId, lang);
        const initial = local?.content ?? starterFor(q, lang);
        setCode(initial);
        recordEvent('question_opened', ctx, { language: lang });
        recordSnapshot({ ...ctx, language: lang, kind: 'CHECKPOINT', content: initial, metadata: { reason: 'open' } });
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [questionId, assignmentId]);

  const loadHistory = useCallback(() => {
    fetchHistory(questionId, assignmentId)
      .then((r) => setHistory(r.items))
      .catch(() => undefined);
  }, [questionId, assignmentId]);
  useEffect(loadHistory, [loadHistory]);

  // ---------- focus tracking (application window only, with a grace period) ----------
  useEffect(() => {
    let blurTimer: number | null = null;
    let lostAt: number | null = null;
    const onBlur = () => {
      blurTimer = window.setTimeout(() => {
        lostAt = Date.now();
        recordEvent('window_focus_lost', ctx);
      }, 3000);
    };
    const onFocus = () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      if (lostAt) recordEvent('window_focus_gained', ctx, { awayMs: Date.now() - lostAt });
      lostAt = null;
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      if (blurTimer) window.clearTimeout(blurTimer);
    };
  }, [ctx]);

  // ---------- drafts ----------
  const persistDraft = useCallback(
    (content: string, lang: LanguageId) => {
      saveLocalDraft({ questionId, assignmentId, language: lang, content });
      setSaveState('saved');
      void flushOutbox().catch(() => undefined);
    },
    [questionId, assignmentId],
  );

  const onChange = (value: string | undefined) => {
    const next = value ?? '';
    setCode(next);
    setSaveState('unsaved');
    if (!started.current) {
      started.current = true;
      recordEvent('editor_started', ctx, { language });
    }
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (prefs.autoSave) {
      saveTimer.current = window.setTimeout(() => {
        setSaveState('saving');
        persistDraft(next, language);
      }, 1200);
    }
    if (snapshotTimer.current) window.clearTimeout(snapshotTimer.current);
    snapshotTimer.current = window.setTimeout(() => {
      recordSnapshot({ ...ctx, language, kind: 'EDIT', content: next, metadata: {} });
      recordEvent('code_changed', ctx, { language, length: next.length });
    }, 4000);
  };

  const saveNow = useCallback(() => {
    let content = editorRef.current?.getValue() ?? code;
    if (prefs.formatOnSave) {
      content = normalizeWhitespace(content);
      if (content !== editorRef.current?.getValue()) editorRef.current?.setValue(content);
    }
    setSaveState('saving');
    persistDraft(content, language);
    recordEvent('draft_saved', ctx, { language });
  }, [code, ctx, language, persistDraft, prefs.formatOnSave]);

  const switchLanguage = (next: LanguageId) => {
    if (next === language) return;
    persistDraft(editorRef.current?.getValue() ?? code, language);
    const draft = getLocalDraft(questionId, assignmentId, next);
    const content = draft?.content ?? starterFor(question, next);
    setLanguage(next);
    setCode(content);
    setPrefs({ defaultLanguage: next });
    recordEvent('language_changed', ctx, { from: language, to: next });
  };

  const resetToStarter = () => {
    if (!window.confirm('Replace your code in this language with the starter code? Your current draft will be overwritten.')) return;
    const content = starterFor(question, language);
    setCode(content);
    editorRef.current?.setValue(content);
    persistDraft(content, language);
    recordSnapshot({ ...ctx, language, kind: 'RESET', content, metadata: {} });
    recordEvent('reset_to_starter', ctx, { language });
  };

  const formatDocument = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.setValue(normalizeWhitespace(ed.getValue()));
  };

  // ---------- execution ----------
  const execute = async (kind: 'RUN' | 'SUBMIT') => {
    const source = editorRef.current?.getValue() ?? code;
    setError(null);
    setQueuedNotice(null);
    persistDraft(source, language);
    recordSnapshot({ ...ctx, language, kind, content: source, metadata: {} });
    if (kind === 'SUBMIT' && !assignmentId) return;

    if (!isOnline) {
      if (kind === 'SUBMIT' && assignmentId) {
        queueSubmission({ questionId, assignmentId, language, code: source });
        recordEvent('submission_created', ctx, { language, offline: true });
        setQueuedNotice('You are offline. Your submission is saved and will be sent automatically when you reconnect. It has not been graded yet.');
      } else {
        setError('Running code needs a network connection: programs are executed on the college judge, not on this computer. Your draft is saved.');
      }
      return;
    }

    setActiveKind(kind);
    setPhase('QUEUED');
    setJob(null);
    setConsoleTab('tests');
    try {
      let jobId: string | null;
      if (kind === 'RUN') {
        recordEvent('run_requested', ctx, { language, customInput: Boolean(customInput.trim()) });
        jobId = (await runCode({ questionId, assignmentId, language, code: source, customInput: consoleTab === 'custom' || customInput.trim() ? customInput : null })).jobId;
      } else {
        const res = await submitCode({ questionId, assignmentId: assignmentId!, language, code: source, clientOperationId: uuid() });
        recordEvent('submission_created', ctx, { language });
        jobId = res.jobId;
        if (!jobId) {
          setPhase('done');
          setQueuedNotice('Submission saved for faculty review.');
          return;
        }
      }
      const final = await waitForJob(jobId, (j) => {
        setJob(j);
        if (j.status === 'QUEUED' || j.status === 'COMPILING' || j.status === 'RUNNING') setPhase(j.status);
      });
      setJob(final);
      setPhase('done');
      const passed = final.results.filter((r) => r.verdict === 'ACCEPTED').length;
      recordEvent('execution_completed', ctx, { kind, verdict: final.verdict ?? final.status, passed, total: final.total_tests });
      recordEvent(final.verdict === 'ACCEPTED' ? 'test_passed' : 'test_failed', ctx, { kind, passed, total: final.total_tests });
      if (kind === 'SUBMIT' && final.verdict === 'ACCEPTED') recordEvent('question_completed', ctx, { language });
      if (final.verdict === 'COMPILE_ERROR') setConsoleTab('output');
      loadHistory();
    } catch (e) {
      setPhase('done');
      setError(e instanceof Error ? e.message : 'The request failed');
    } finally {
      setActiveKind(null);
      void flushOutbox().catch(() => undefined);
    }
  };

  // ---------- editor wiring ----------
  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    const model = editor.getModel() as (monaco.editor.ITextModel & { __lpLanguage?: LanguageId }) | null;
    if (model) model.__lpLanguage = language;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveNow());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void execute('RUN'));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => void execute('SUBMIT'));
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => formatDocument());
    // Copy inside the editor is remembered so a later paste can be marked internal vs external.
    editor.onKeyDown((e) => {
      if ((e.ctrlKey || e.metaKey) && (e.keyCode === monaco.KeyCode.KeyC || e.keyCode === monaco.KeyCode.KeyX)) {
        const sel = editor.getSelection();
        const text = sel ? (editor.getModel()?.getValueInRange(sel) ?? '') : '';
        if (text) {
          lastInternalCopy.current = text;
          recordEvent('copy_inside_editor', ctx, { chars: text.length });
        }
      }
    });
    editor.onDidPaste((e) => {
      const pasted = editor.getModel()?.getValueInRange(e.range) ?? '';
      const internal = pasted.length > 0 && pasted === lastInternalCopy.current;
      recordEvent('paste_detected', ctx, { chars: pasted.length, lines: pasted.split('\n').length, source: internal ? 'editor' : 'external' });
      recordSnapshot({ ...ctx, language, kind: 'PASTE', content: editor.getValue(), metadata: { pastedChars: pasted.length, source: internal ? 'editor' : 'external' } });
    });
  };

  useEffect(() => {
    const model = editorRef.current?.getModel() as (monaco.editor.ITextModel & { __lpLanguage?: LanguageId }) | null;
    if (model) model.__lpLanguage = language;
  }, [language]);

  // Global shortcuts when focus is outside the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's') {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  if (loadError) {
    return (
      <div className="ws-error-screen">
        <XCircle size={28} />
        <h2>Could not open this question</h2>
        <p>{loadError}</p>
        <button className="btn" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
      </div>
    );
  }
  if (!question) {
    return (
      <div className="ws-error-screen">
        <Loader2 className="ws-spin" size={26} />
        <p>Opening workspace…</p>
      </div>
    );
  }

  const lang = getLanguage(language)!;
  const phaseLabel = phase === 'QUEUED' ? 'Queued' : phase === 'COMPILING' ? 'Compiling' : phase === 'RUNNING' ? 'Running' : '';

  return (
    <div className="ws-root" data-testid="programming-workspace">
      <header className="ws-toolbar">
        <button className="ws-icon-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="ws-title">
          <strong>{question.title}</strong>
          <span className={`ws-diff ws-diff-${question.difficulty.toLowerCase()}`}>{question.difficulty.toLowerCase()}</span>
          {assignmentId ? <span className="ws-tag">Assignment</span> : <span className="ws-tag">Practice</span>}
        </div>
        <div className="ws-toolbar-right">
          <label className="ws-select">
            <span className="sr-only">Language</span>
            <select aria-label="Language" value={language} onChange={(e) => switchLanguage(e.target.value as LanguageId)} disabled={busy}>
              {allowed.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ws-font" role="group" aria-label="Font size">
            <button className="ws-icon-btn" aria-label="Decrease font size" onClick={() => setPrefs({ fontSize: Math.max(11, prefs.fontSize - 1) })}>
              <Minus size={14} />
            </button>
            <span>{prefs.fontSize}px</span>
            <button className="ws-icon-btn" aria-label="Increase font size" onClick={() => setPrefs({ fontSize: Math.min(24, prefs.fontSize + 1) })}>
              <Plus size={14} />
            </button>
          </div>
          <span className={`ws-save ws-save-${saveState}`} aria-live="polite">
            {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Unsaved'}
          </span>
          <button className="ws-icon-btn" onClick={formatDocument} title="Tidy whitespace (Shift+Alt+F)" aria-label="Format document">
            <Sparkles size={16} />
          </button>
          <button className="ws-icon-btn" onClick={saveNow} title="Save draft (Ctrl+S)" aria-label="Save draft">
            <Save size={16} />
          </button>
          <button className="ws-icon-btn" onClick={resetToStarter} title="Reset to starter code" aria-label="Reset to starter code">
            <RotateCcw size={16} />
          </button>
          <button className="btn ws-run" onClick={() => void execute('RUN')} disabled={busy} title="Run visible tests (Ctrl+Enter)">
            {busy && activeKind === 'RUN' ? <Loader2 className="ws-spin" size={16} /> : <Play size={16} />} Run
          </button>
          {assignmentId && (
            <button className="btn btn-primary ws-submit" onClick={() => void execute('SUBMIT')} disabled={busy} title="Submit for grading (Ctrl+Shift+Enter)">
              {busy && activeKind === 'SUBMIT' ? <Loader2 className="ws-spin" size={16} /> : <Send size={16} />} Submit
            </button>
          )}
        </div>
      </header>

      {!isOnline && (
        <div className="ws-banner ws-banner-warn">
          <CloudOff size={15} /> Offline — you can keep editing; drafts are saved on this computer. Running and grading need a connection.
        </div>
      )}
      {queuedNotice && <div className="ws-banner ws-banner-info">{queuedNotice}</div>}
      {error && (
        <div className="ws-banner ws-banner-error" role="alert">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      <div className="ws-body" ref={left.containerRef}>
        <aside className="ws-left" style={{ width: `${left.ratio * 100}%` }}>
          <div className="ws-tabs" role="tablist">
            <button role="tab" aria-selected={leftTab === 'problem'} onClick={() => setLeftTab('problem')}>
              Problem
            </button>
            <button role="tab" aria-selected={leftTab === 'history'} onClick={() => setLeftTab('history')}>
              <History size={14} /> Attempts ({history.length})
            </button>
          </div>
          {leftTab === 'problem' ? (
            <div className="ws-problem">
              <p className="ws-meta">
                {question.topic} · {question.marks} marks · {question.time_limit_ms} ms · {question.memory_limit_mb} MB
              </p>
              <div className="ws-text">{question.description}</div>
              {question.input_format && (
                <>
                  <h4>Input</h4>
                  <div className="ws-text">{question.input_format}</div>
                </>
              )}
              {question.output_format && (
                <>
                  <h4>Output</h4>
                  <div className="ws-text">{question.output_format}</div>
                </>
              )}
              {question.constraints && (
                <>
                  <h4>Constraints</h4>
                  <pre className="ws-pre">{question.constraints}</pre>
                </>
              )}
              {question.visibleTests.length > 0 && <h4>Examples</h4>}
              {question.visibleTests.map((t, i) => (
                <div key={t.id} className="ws-example">
                  <span>Example {i + 1}</span>
                  <div>
                    <label>Input</label>
                    <pre className="ws-pre">{t.input || '(empty)'}</pre>
                  </div>
                  <div>
                    <label>Expected output</label>
                    <pre className="ws-pre">{t.expectedOutput}</pre>
                  </div>
                </div>
              ))}
              <p className="ws-note">
                {question.hiddenTestCount > 0
                  ? `${question.hiddenTestCount} hidden test case(s) are run only when you submit.`
                  : 'No hidden tests are configured for this question.'}
              </p>
            </div>
          ) : (
            <div className="ws-history">
              {history.length === 0 && <p className="ws-note">No runs or submissions yet.</p>}
              {history.map((h) => (
                <div key={h.id} className="ws-history-row">
                  <span className="ws-history-kind">{h.kind === 'SUBMIT' ? 'Submit' : 'Run'}</span>
                  <span>{getLanguage(h.language)?.label ?? h.language}</span>
                  <VerdictPill verdict={h.status === 'FAILED' && !h.verdict ? 'SUBMISSION_FAILED' : h.verdict} />
                  <span className="ws-muted">
                    {h.passed_tests}/{h.total_tests}
                  </span>
                  <span className="ws-muted">{new Date(h.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
        <div className="ws-gutter ws-gutter-x" role="separator" aria-orientation="vertical" aria-label="Resize problem panel" tabIndex={0} {...left.handleProps} />
        <section className="ws-right" ref={bottom.containerRef}>
          <div className="ws-editor" style={{ height: `${(1 - bottom.ratio) * 100}%` }}>
            <Editor
              height="100%"
              language={lang.monaco}
              path={`${questionId}/${assignmentId ?? 'practice'}/${lang.fileName}`}
              value={code}
              onChange={onChange}
              onMount={onMount}
              theme={prefs.theme === 'dark' ? 'vs-dark' : 'vs'}
              options={{
                fontSize: prefs.fontSize,
                fontFamily: "'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace",
                minimap: { enabled: prefs.minimap },
                wordWrap: prefs.wordWrap ? 'on' : 'off',
                tabSize: 4,
                insertSpaces: true,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                renderWhitespace: 'selection',
                bracketPairColorization: { enabled: true },
                quickSuggestions: true,
                suggestOnTriggerCharacters: true,
              }}
            />
          </div>
          <div className="ws-gutter ws-gutter-y" role="separator" aria-orientation="horizontal" aria-label="Resize console" tabIndex={0} {...bottom.handleProps} />
          <div className="ws-console" style={{ height: `${bottom.ratio * 100}%` }}>
            <div className="ws-tabs" role="tablist">
              <button role="tab" aria-selected={consoleTab === 'tests'} onClick={() => setConsoleTab('tests')}>
                Test results
              </button>
              <button role="tab" aria-selected={consoleTab === 'custom'} onClick={() => setConsoleTab('custom')}>
                Custom input
              </button>
              <button role="tab" aria-selected={consoleTab === 'output'} onClick={() => setConsoleTab('output')}>
                Compiler / errors
              </button>
              <button role="tab" aria-selected={consoleTab === 'terminal'} onClick={() => setConsoleTab('terminal')}>
                Terminal
              </button>
              <div className="ws-console-status">
                {busy && (
                  <span className="ws-status-running">
                    <Loader2 className="ws-spin" size={14} /> {phaseLabel}…
                  </span>
                )}
                {!busy && job && (
                  <>
                    {job.verdict === 'ACCEPTED' ? <CheckCircle2 size={15} className="ws-ok" /> : <XCircle size={15} className="ws-bad" />}
                    <VerdictPill verdict={job.verdict ?? (job.status === 'FAILED' ? 'SUBMISSION_FAILED' : null)} />
                    <span className="ws-muted">
                      {job.kind === 'SUBMIT' ? 'Submission' : 'Run'} · {job.passed_tests}/{job.total_tests} passed
                      {job.max_time_ms ? ` · ${job.max_time_ms} ms` : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="ws-console-body">
              {consoleTab === 'tests' &&
                (job ? (
                  <div className="ws-results">
                    {job.status === 'FAILED' && <p className="ws-banner ws-banner-error">{job.error ?? 'The judge could not process this request.'}</p>}
                    {job.results.map((r) => (
                      <details key={r.ordinal} className="ws-result" open={!r.hidden && r.verdict !== 'ACCEPTED'}>
                        <summary>
                          <VerdictPill verdict={r.verdict} />
                          <span>{r.hidden ? `Hidden test ${r.ordinal}` : r.expectedOutput === null ? 'Custom input' : `Test ${r.ordinal}`}</span>
                          {r.timeMs != null && <span className="ws-muted">{r.timeMs} ms</span>}
                        </summary>
                        {r.hidden ? (
                          <p className="ws-note">Hidden test details are not shown.</p>
                        ) : (
                          <div className="ws-io">
                            <div>
                              <label>Input</label>
                              <pre className="ws-pre">{r.input || '(empty)'}</pre>
                            </div>
                            {r.expectedOutput != null && (
                              <div>
                                <label>Expected</label>
                                <pre className="ws-pre">{r.expectedOutput}</pre>
                              </div>
                            )}
                            <div>
                              <label>Your output</label>
                              <pre className="ws-pre">{r.stdout || '(no output)'}</pre>
                            </div>
                            {r.stderr && (
                              <div>
                                <label>Error output</label>
                                <pre className="ws-pre ws-pre-err">{r.stderr}</pre>
                              </div>
                            )}
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="ws-note">
                    Run executes your {lang.label} code on the college judge against the visible examples{assignmentId ? '; Submit also runs the hidden tests and records your attempt' : ''}.
                  </p>
                ))}
              {consoleTab === 'custom' && (
                <div className="ws-custom">
                  <label htmlFor="ws-custom-input">Standard input for your next Run</label>
                  <textarea id="ws-custom-input" spellCheck={false} value={customInput} onChange={(e) => setCustomInput(e.target.value)} placeholder="Type input here, then press Run" />
                </div>
              )}
              {consoleTab === 'output' && (
                <pre className="ws-pre ws-pre-err ws-compile">{job?.compile_output || (job?.verdict === 'COMPILE_ERROR' ? 'Compilation failed.' : 'No compiler messages.')}</pre>
              )}
              {consoleTab === 'terminal' && (
                <div className="ws-note" role="status">
                  Remote terminal is unavailable. Interactive sessions will appear here after the isolated Linux session service is deployed.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
      <footer className="ws-statusbar">
        <span>
          {lang.label} · {lang.standard} · {lang.fileName}
        </span>
        <span>{isOnline ? 'Connected to judge' : 'Offline'}</span>
        <span>Ctrl+Enter run · Ctrl+Shift+Enter submit · Ctrl+S save</span>
      </footer>
    </div>
  );
};

export default ProgrammingWorkspace;
