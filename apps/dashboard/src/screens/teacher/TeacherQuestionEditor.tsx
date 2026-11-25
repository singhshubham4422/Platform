import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LanguageId } from '@lplatform/language-config';
import type { Question, QuestionTest } from '../../data/types';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import { Markdown } from '../../lib/markdown';
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  InlineSuccess,
  Loading,
  PageHeader,
} from '../../components/ui';

interface TestDraft {
  id?: string;
  input: string;
  expectedOutput: string;
}

interface FormState {
  title: string;
  statementMd: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  points: string;
  topics: string;
  timeLimitMs: string;
  memoryLimitMb: string;
  outputLimitKb: string;
  starterCode: Partial<Record<LanguageId, string>>;
}

export function TeacherQuestionEditor() {
  const { courseId = '', questionId = '' } = useParams<{ courseId: string; questionId: string }>();
  const source = useDataSource();
  const bundle = useAsync(() => source.courseBundle(courseId), [courseId]);
  if (bundle.loading) return <Loading text="Loading question…" />;
  if (bundle.error) return <ErrorState message={bundle.error.message} onRetry={bundle.reload} />;
  if (!bundle.data) return null;
  const question = bundle.data.questions.find((row) => row.id === questionId);
  if (!question) {
    return (
      <>
        <PageHeader eyebrow="Teacher · question" title="Question not found" />
        <Link className="btn" to={`/teacher/courses/${courseId}`}>
          Back to course
        </Link>
      </>
    );
  }
  const tests = bundle.data.tests.filter((test) => test.question_id === questionId);
  return (
    <QuestionEditor
      key={question.id}
      question={question}
      languages={bundle.data.course.languages}
      tests={tests}
      courseId={courseId}
      onSaved={() => bundle.reload()}
    />
  );
}

function toDrafts(tests: QuestionTest[], kind: 'VISIBLE' | 'HIDDEN'): TestDraft[] {
  return tests
    .filter((test) => test.kind === kind)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((test) => ({ id: test.id, input: test.input, expectedOutput: test.expected_output }));
}

function QuestionEditor({
  question,
  languages,
  tests,
  courseId,
  onSaved,
}: {
  question: Question;
  languages: LanguageId[];
  tests: QuestionTest[];
  courseId: string;
  onSaved: () => void;
}) {
  const source = useDataSource();
  const [form, setForm] = useState<FormState>({
    title: question.title,
    statementMd: question.statement_md,
    difficulty: question.difficulty,
    points: String(question.points),
    topics: question.topics.join(', '),
    timeLimitMs: String(question.time_limit_ms),
    memoryLimitMb: String(question.memory_limit_mb),
    outputLimitKb: String(question.output_limit_kb),
    starterCode: question.starter_code,
  });
  const [visible, setVisible] = useState<TestDraft[]>(toDrafts(tests, 'VISIBLE'));
  const [hidden, setHidden] = useState<TestDraft[]>(toDrafts(tests, 'HIDDEN'));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (visible.length === 0) throw new Error('At least one visible test is required');
      await source.saveQuestion({
        id: question.id,
        courseId,
        title: form.title.trim(),
        statementMd: form.statementMd,
        difficulty: form.difficulty,
        points: Number(form.points),
        topics: form.topics.split(',').map((topic) => topic.trim()).filter(Boolean),
        timeLimitMs: Number(form.timeLimitMs),
        memoryLimitMb: Number(form.memoryLimitMb),
        outputLimitKb: Number(form.outputLimitKb),
        starterCode: form.starterCode,
        orderIndex: question.order_index,
      });
      await source.saveTests(question.id, [
        ...visible.map((test, index) => ({ ...test, kind: 'VISIBLE' as const, ordinal: index })),
        ...hidden.map((test, index) => ({ ...test, kind: 'HIDDEN' as const, ordinal: index })),
      ]);
      setNotice('Question saved.');
      onSaved();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Teacher · question"
        title={form.title || 'Untitled question'}
        description="Statement, limits, starter code and visible/hidden tests."
        actions={
          <Link className="btn btn-small" to={`/teacher/courses/${courseId}`}>
            Back to course
          </Link>
        }
      />
      <form className="form-stack" onSubmit={onSubmit}>
        <div aria-live="polite" className="stack">
          {error ? <InlineError>{error}</InlineError> : null}
          {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
        </div>
        <Card title="Question">
          <div className="form-stack">
            <div className="form-grid">
              <Field label="Title" htmlFor="question-title">
                <input id="question-title" type="text" required value={form.title} onChange={(event) => update({ title: event.target.value })} />
              </Field>
              <Field label="Difficulty" htmlFor="question-difficulty">
                <select id="question-difficulty" value={form.difficulty} onChange={(event) => update({ difficulty: event.target.value as FormState['difficulty'] })}>
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </Field>
              <Field label="Points" htmlFor="question-points">
                <input id="question-points" type="number" min={0} max={1000} value={form.points} onChange={(event) => update({ points: event.target.value })} />
              </Field>
              <Field label="Topics" htmlFor="question-topics" hint="Comma separated">
                <input id="question-topics" type="text" value={form.topics} onChange={(event) => update({ topics: event.target.value })} />
              </Field>
              <Field label="Time limit (ms)" htmlFor="question-time">
                <input id="question-time" type="number" min={100} max={20000} value={form.timeLimitMs} onChange={(event) => update({ timeLimitMs: event.target.value })} />
              </Field>
              <Field label="Memory limit (MB)" htmlFor="question-memory">
                <input id="question-memory" type="number" min={16} max={1024} value={form.memoryLimitMb} onChange={(event) => update({ memoryLimitMb: event.target.value })} />
              </Field>
              <Field label="Output limit (KB)" htmlFor="question-output">
                <input id="question-output" type="number" min={1} max={1024} value={form.outputLimitKb} onChange={(event) => update({ outputLimitKb: event.target.value })} />
              </Field>
            </div>
            <div className="split">
              <Field label="Statement (Markdown)" htmlFor="question-statement" hint="HTML is never rendered; only the allow-list Markdown subset is.">
                <textarea
                  id="question-statement"
                  style={{ minHeight: 220, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
                  value={form.statementMd}
                  onChange={(event) => update({ statementMd: event.target.value })}
                />
              </Field>
              <div className="field">
                <span className="field-label">Preview</span>
                <div className="card" style={{ boxShadow: 'none', minHeight: 220 }}>
                  <Markdown source={form.statementMd} />
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Starter code" description="Shown in the desktop workspace for each selected language.">
          <div className="stack">
            {languages.length === 0 ? (
              <EmptyState title="The course has no languages" />
            ) : (
              languages.map((language) => (
                <Field key={language} label={language} htmlFor={`starter-${language}`}>
                  <textarea
                    id={`starter-${language}`}
                    style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
                    value={form.starterCode[language] ?? ''}
                    onChange={(event) => update({ starterCode: { ...form.starterCode, [language]: event.target.value } })}
                  />
                </Field>
              ))
            )}
          </div>
        </Card>

        <Card title="Visible tests" description="Students see these in the desktop app. At least one is required to publish.">
          <TestListEditor idPrefix="visible" tests={visible} onChange={setVisible} />
        </Card>

        <Card title="Hidden tests" description="Encrypted inside assessment packs. They never reach student client code.">
          <TestListEditor idPrefix="hidden" tests={hidden} onChange={setHidden} />
        </Card>

        <div>
          <button type="submit" className="btn btn-primary" disabled={saving || !form.title.trim()}>
            {saving ? 'Saving…' : 'Save question'}
          </button>
        </div>
      </form>
    </>
  );
}

function TestListEditor({ idPrefix, tests, onChange }: { idPrefix: string; tests: TestDraft[]; onChange: (tests: TestDraft[]) => void }) {
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= tests.length) return;
    const next = [...tests];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <div className="stack">
      {tests.length === 0 ? <p className="muted small">No tests yet.</p> : null}
      {tests.map((test, index) => (
        <div className="test-editor" key={test.id ?? `${idPrefix}-${index}`}>
          <div className="row-between">
            <span className="small muted">Test {index + 1}</span>
            <div className="btn-row">
              <button type="button" className="btn btn-small" disabled={index === 0} onClick={() => move(index, -1)}>
                Up
              </button>
              <button type="button" className="btn btn-small" disabled={index === tests.length - 1} onClick={() => move(index, 1)}>
                Down
              </button>
              <button type="button" className="btn btn-small btn-danger" onClick={() => onChange(tests.filter((_, i) => i !== index))}>
                Remove
              </button>
            </div>
          </div>
          <div className="test-grid">
            <Field label="Input" htmlFor={`${idPrefix}-${index}-input`}>
              <textarea
                id={`${idPrefix}-${index}-input`}
                style={{ minHeight: 70, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
                value={test.input}
                onChange={(event) => onChange(tests.map((row, i) => (i === index ? { ...row, input: event.target.value } : row)))}
              />
            </Field>
            <Field label="Expected output" htmlFor={`${idPrefix}-${index}-output`}>
              <textarea
                id={`${idPrefix}-${index}-output`}
                style={{ minHeight: 70, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
                value={test.expectedOutput}
                onChange={(event) => onChange(tests.map((row, i) => (i === index ? { ...row, expectedOutput: event.target.value } : row)))}
              />
            </Field>
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-small" onClick={() => onChange([...tests, { input: '', expectedOutput: '' }])}>
          Add test
        </button>
      </div>
    </div>
  );
}
