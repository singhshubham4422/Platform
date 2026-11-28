import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { getLanguage, type LanguageId } from '@platform/language-config';
import {
  Play,
  RotateCcw,
  Wand2,
  Minus,
  Plus,
  Moon,
  Sun,
  WrapText,
  Map as MapIcon,
} from 'lucide-react';
import { monaco, registerCompletions } from '../workspace/monaco-setup';
import { useEditorPreferences } from '../workspace/preferences';
import { runCustom, type RunResult } from '../lib/runner';
import { runtimesList, type RuntimeInfo } from '../lib/runtimes';
import {
  PLAYGROUND_LANGUAGES,
  PLAYGROUND_LIMITS,
  PLAYGROUND_STARTERS,
  clearPlaygroundDraft,
  formatSource,
  loadPlaygroundDraft,
  parseDiagnostics,
  savePlaygroundDraft,
} from '../lib/playground';
import './playground.css';

const LANG_KEY = 'platform_playground_language';
let formattersRegistered = false;

/** Shift+Alt+F and the context menu's "Format Document" use the playground formatter. */
function registerFormatters(): void {
  if (formattersRegistered) return;
  formattersRegistered = true;
  for (const id of PLAYGROUND_LANGUAGES) {
    monaco.languages.registerDocumentFormattingEditProvider(getLanguage(id)!.monaco, {
      provideDocumentFormattingEdits(model, options) {
        return [
          {
            range: model.getFullModelRange(),
            text: formatSource(model.getValue(), options.tabSize),
          },
        ];
      },
    });
  }
}

function initialLanguage(): LanguageId {
  try {
    const saved = localStorage.getItem(LANG_KEY) as LanguageId | null;
    if (saved && PLAYGROUND_LANGUAGES.includes(saved)) return saved;
  } catch {
    /* ignore */
  }
  return 'PYTHON';
}

function friendlyError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (text.includes('DESKTOP_ONLY'))
    return 'The playground runs code on this computer, so it works in the installed desktop app only.';
  if (text.includes('RUNTIME_NOT_INSTALLED'))
    return 'This language is not included in this build of the app.';
  return text;
}

export function Playground() {
  const [language, setLanguage] = useState<LanguageId>(initialLanguage);
  const [code, setCode] = useState(() => loadPlaygroundDraft(initialLanguage()));
  const [stdin, setStdin] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [runtimes, setRuntimes] = useState<RuntimeInfo[] | null>(null);
  const { prefs, setPrefs } = useEditorPreferences();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef<() => void>(() => undefined);
  const lang = getLanguage(language)!;

  useEffect(() => {
    registerCompletions();
    registerFormatters();
    // runtimesList throws synchronously outside the desktop app; keep that inside the promise.
    Promise.resolve()
      .then(runtimesList)
      .then(setRuntimes)
      .catch((e) => setError(friendlyError(e)));
  }, []);

  // Auto-save the draft for the current language.
  useEffect(() => {
    const t = window.setTimeout(() => savePlaygroundDraft(language, code), 400);
    return () => window.clearTimeout(t);
  }, [code, language]);

  // Ticking timer while a program runs (the first C/C++ compile can take a while).
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => window.clearInterval(t);
  }, [busy]);

  const setMarkers = useCallback(
    (output: string | null) => {
      const model = editorRef.current?.getModel();
      if (!model) return;
      monaco.editor.setModelMarkers(
        model,
        'playground',
        parseDiagnostics(language, output).map((d) => ({
          startLineNumber: d.line,
          startColumn: d.column,
          endLineNumber: d.line,
          endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())),
          message: d.message,
          severity:
            d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
        })),
      );
    },
    [language],
  );

  const run = useCallback(async () => {
    if (busy) return;
    const source = editorRef.current?.getValue() ?? code;
    savePlaygroundDraft(language, source);
    setBusy(true);
    setError('');
    setResult(null);
    setMarkers(null);
    try {
      const r = await runCustom(language, source, stdin, PLAYGROUND_LIMITS);
      setResult(r);
      setMarkers(r.compileOutput ?? r.tests[0]?.stderr ?? null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [busy, code, language, stdin, setMarkers]);
  runRef.current = () => void run();

  const switchLanguage = (next: LanguageId) => {
    savePlaygroundDraft(language, editorRef.current?.getValue() ?? code);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* ignore */
    }
    setLanguage(next);
    setCode(loadPlaygroundDraft(next));
    setResult(null);
    setError('');
  };

  const format = () => void editorRef.current?.getAction('editor.action.formatDocument')?.run();
  const reset = () => {
    if (
      !window.confirm('Replace your code with the example program? Your current code will be lost.')
    )
      return;
    clearPlaygroundDraft(language);
    setCode(PLAYGROUND_STARTERS[language]);
    setMarkers(null);
  };

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    const model = editor.getModel() as
      (monaco.editor.ITextModel & { __lpLanguage?: LanguageId }) | null;
    if (model) model.__lpLanguage = language;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
    editor.addCommand(monaco.KeyCode.F5, () => runRef.current());
    editor.onDidChangeCursorPosition((e) =>
      setCursor({ line: e.position.lineNumber, column: e.position.column }),
    );
    editor.focus();
  };

  useEffect(() => {
    const model = editorRef.current?.getModel() as
      (monaco.editor.ITextModel & { __lpLanguage?: LanguageId }) | null;
    if (model) model.__lpLanguage = language;
  }, [language]);

  const available = runtimes === null ? null : runtimes.some((r) => r.language === language);
  const runtime = runtimes?.find((r) => r.language === language);
  const test = result?.tests[0];
  const ok = result?.verdict === 'ACCEPTED';
  const status = !result
    ? null
    : ok
      ? `Finished in ${result.totalTimeMs} ms`
      : result.verdict === 'COMPILE_ERROR'
        ? 'Compile error'
        : result.verdict === 'TIME_LIMIT_EXCEEDED'
          ? `Stopped: took longer than ${PLAYGROUND_LIMITS.timeLimitMs / 1000} s`
          : result.verdict === 'MEMORY_LIMIT_EXCEEDED'
            ? `Stopped: used more than ${PLAYGROUND_LIMITS.memoryLimitMb} MB`
            : result.verdict === 'OUTPUT_LIMIT_EXCEEDED'
              ? 'Stopped: printed too much output'
              : 'Runtime error';

  return (
    <section className="playground" aria-label="Code playground">
      <header className="playground-toolbar">
        <div className="playground-title">
          <h1>Playground</h1>
          <span className="muted-text">Write and run code on this computer. Works offline.</span>
        </div>
        <label className="playground-lang">
          <span className="sr-only">Language</span>
          <select
            aria-label="Language"
            value={language}
            onChange={(e) => switchLanguage(e.target.value as LanguageId)}
            disabled={busy}
          >
            {PLAYGROUND_LANGUAGES.map((id) => (
              <option key={id} value={id}>
                {getLanguage(id)?.label ?? id}
              </option>
            ))}
          </select>
        </label>
        <div className="playground-tools" role="toolbar" aria-label="Editor tools">
          <button
            className="btn btn-icon"
            title="Format document (Shift+Alt+F)"
            aria-label="Format document"
            onClick={format}
          >
            <Wand2 size={15} />
          </button>
          <button
            className="btn btn-icon"
            title="Smaller text"
            aria-label="Smaller text"
            onClick={() => setPrefs({ fontSize: Math.max(10, prefs.fontSize - 1) })}
          >
            <Minus size={15} />
          </button>
          <span className="playground-font" aria-label="Font size">
            {prefs.fontSize}px
          </span>
          <button
            className="btn btn-icon"
            title="Larger text"
            aria-label="Larger text"
            onClick={() => setPrefs({ fontSize: Math.min(28, prefs.fontSize + 1) })}
          >
            <Plus size={15} />
          </button>
          <button
            className={`btn btn-icon ${prefs.wordWrap ? 'is-on' : ''}`}
            title="Word wrap"
            aria-label="Word wrap"
            aria-pressed={prefs.wordWrap}
            onClick={() => setPrefs({ wordWrap: !prefs.wordWrap })}
          >
            <WrapText size={15} />
          </button>
          <button
            className={`btn btn-icon ${prefs.minimap ? 'is-on' : ''}`}
            title="Minimap"
            aria-label="Minimap"
            aria-pressed={prefs.minimap}
            onClick={() => setPrefs({ minimap: !prefs.minimap })}
          >
            <MapIcon size={15} />
          </button>
          <button
            className="btn btn-icon"
            title="Light or dark theme"
            aria-label="Toggle theme"
            onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}
          >
            {prefs.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            className="btn btn-icon"
            title="Reset to example"
            aria-label="Reset to example"
            onClick={reset}
            disabled={busy}
          >
            <RotateCcw size={15} />
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={busy || available === false}
            title="Run (Ctrl+Enter or F5)"
          >
            <Play size={15} /> {busy ? `Running… ${elapsed}s` : 'Run'}
          </button>
        </div>
      </header>

      {available === false && (
        <div className="inline-banner danger" role="alert">
          {getLanguage(language)?.label} is not included in this build of the app.
        </div>
      )}

      <div className="playground-body">
        <div className="playground-editor">
          <Editor
            height="100%"
            path={`playground/${lang.fileName}`}
            language={lang.monaco}
            value={code}
            onChange={(v) => setCode(v ?? '')}
            onMount={onMount}
            theme={prefs.theme === 'dark' ? 'vs-dark' : 'vs'}
            options={{
              fontSize: prefs.fontSize,
              minimap: { enabled: prefs.minimap },
              wordWrap: prefs.wordWrap ? 'on' : 'off',
              automaticLayout: true,
              tabSize: 4,
              insertSpaces: true,
              autoIndent: 'full',
              autoClosingBrackets: 'always',
              autoClosingQuotes: 'always',
              autoSurround: 'languageDefined',
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              matchBrackets: 'always',
              folding: true,
              stickyScroll: { enabled: true },
              quickSuggestions: { other: true, comments: false, strings: false },
              suggestOnTriggerCharacters: true,
              snippetSuggestions: 'inline',
              renderWhitespace: 'selection',
              mouseWheelZoom: true,
              smoothScrolling: true,
              cursorSmoothCaretAnimation: 'on',
              scrollBeyondLastLine: false,
              fixedOverflowWidgets: true,
            }}
          />
          <footer className="playground-status" aria-label="Editor status">
            <span>
              Ln {cursor.line}, Col {cursor.column}
            </span>
            <span>{lang.label}</span>
            <span>
              {runtime
                ? `${runtime.installedAt === 'bundled' ? 'Built-in' : 'Installed'} ${runtime.version}`
                : available === null
                  ? error
                    ? 'Desktop app only'
                    : 'Checking compiler…'
                  : 'Compiler missing'}
            </span>
            <span className="playground-hint">
              Ctrl+Enter run · Ctrl+Space suggestions · Ctrl+F find · Ctrl+/ comment · Shift+Alt+F
              format
            </span>
          </footer>
        </div>

        <aside className="playground-side">
          <label className="playground-panel">
            <span className="playground-panel-title">Input (stdin)</span>
            <textarea
              aria-label="Program input"
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder="Type the input your program reads, for example your name"
              spellCheck={false}
            />
          </label>
          <div className="playground-panel playground-output" aria-live="polite">
            <span className="playground-panel-title">
              Output
              {status && (
                <span className={`playground-verdict ${ok ? 'ok' : 'bad'}`}>{status}</span>
              )}
              {test && ok && (
                <small>
                  {test.memoryKb > 0 ? ` · ${(test.memoryKb / 1024).toFixed(1)} MB` : ''}
                </small>
              )}
            </span>
            {busy && (
              <p className="muted-text">
                {language === 'C' || language === 'CPP'
                  ? 'Compiling and running… the very first C/C++ run prepares the compiler and can take a minute.'
                  : 'Running…'}
              </p>
            )}
            {error && (
              <p className="playground-error" role="alert">
                {error}
              </p>
            )}
            {result?.compileOutput && (
              <pre className="playground-stderr">{result.compileOutput}</pre>
            )}
            {test?.stdout ? (
              <pre className="playground-stdout">{test.stdout}</pre>
            ) : (
              result && !result.compileOutput && <p className="muted-text">(no output)</p>
            )}
            {test?.stderr && <pre className="playground-stderr">{test.stderr}</pre>}
          </div>
        </aside>
      </div>
    </section>
  );
}
