import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LanguageId } from '@lplatform/language-config';
import { LANGUAGES } from '@lplatform/language-config';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  InlineSuccess,
  Loading,
  PageHeader,
} from '../../components/ui';

export function TeacherCourseEditor() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const { profile } = useAuth();
  const source = useDataSource();
  const navigate = useNavigate();
  const bundle = useAsync(() => source.courseBundle(courseId), [courseId]);
  const classes = useAsync(() => source.teacherClasses(profile?.id ?? ''), [profile?.id]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (bundle.loading) return <Loading text="Loading course…" />;
  if (bundle.error) return <ErrorState message={bundle.error.message} onRetry={bundle.reload} />;
  if (!bundle.data) return null;
  const { course, questions, classIds } = bundle.data;

  const publish = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await source.publishCourse(course.id);
      setNotice(`Published pack ${result.packId} (version ${result.version}).`);
      bundle.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const addQuestion = async () => {
    setBusy(true);
    setError(null);
    try {
      const question = await source.saveQuestion({
        courseId: course.id,
        title: 'Untitled question',
        statementMd: '',
        difficulty: 'EASY',
        points: 10,
        topics: [],
        timeLimitMs: 2000,
        memoryLimitMb: 256,
        outputLimitKb: 64,
        starterCode: {},
        orderIndex: questions.length,
      });
      navigate(`/teacher/courses/${course.id}/questions/${question.id}`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (id: string, direction: -1 | 1) => {
    const index = questions.findIndex((question) => question.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= questions.length) return;
    const ids = questions.map((question) => question.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(target, 0, moved);
    setBusy(true);
    try {
      await source.reorderQuestions(course.id, ids);
      bundle.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeQuestion = async (id: string) => {
    setBusy(true);
    try {
      await source.deleteQuestion(id);
      setConfirmDelete(null);
      bundle.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleClass = async (classId: string, linked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (linked) await source.unlinkClass(course.id, classId);
      else await source.linkClass(course.id, classId);
      bundle.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Teacher · course"
        title={course.title}
        description={`${course.languages.join(' · ')} · ${questions.length} questions`}
        actions={
          <>
            <Link className="btn btn-small" to="/teacher/courses">
              All courses
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => void publish()} disabled={busy || questions.length === 0}>
              {busy ? 'Working…' : 'Publish pack'}
            </button>
          </>
        }
      />
      <div aria-live="polite" className="stack">
        {error ? <InlineError>{error}</InlineError> : null}
        {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
      </div>
      <CourseSettings course={course} />

      <Card
        title="Questions"
        description="Order is the order shown in the desktop app and used for pack signing."
        actions={
          <button type="button" className="btn btn-small" onClick={() => void addQuestion()} disabled={busy}>
            Add question
          </button>
        }
      >
        {questions.length === 0 ? (
          <EmptyState title="No questions yet" description="Add a question, then author visible and hidden tests." />
        ) : (
          <div className="stack">
            {questions.map((question, index) => (
              <div key={question.id} className="row-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {index + 1}. {question.title}
                  </div>
                  <div className="muted small">
                    {question.difficulty} · {question.points} points · {question.topics.join(', ') || 'no topics'}
                  </div>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn btn-small" disabled={busy || index === 0} onClick={() => void reorder(question.id, -1)}>
                    Up
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy || index === questions.length - 1}
                    onClick={() => void reorder(question.id, 1)}
                  >
                    Down
                  </button>
                  <Link className="btn btn-small" to={`/teacher/courses/${course.id}/questions/${question.id}`}>
                    Edit
                  </Link>
                  {confirmDelete === question.id ? (
                    <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => void removeQuestion(question.id)}>
                      Confirm delete
                    </button>
                  ) : (
                    <button type="button" className="btn btn-small btn-danger" onClick={() => setConfirmDelete(question.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Linked classes" description="Linking a class lets its students install the published course pack.">
        {classes.loading ? (
          <Loading />
        ) : classes.error ? (
          <ErrorState message={classes.error.message} onRetry={classes.reload} />
        ) : !classes.data?.length ? (
          <EmptyState title="No classes to link" />
        ) : (
          <div className="checkbox-row">
            {classes.data.map((klass) => {
              const linked = classIds.includes(klass.id);
              return (
                <label key={klass.id}>
                  <input type="checkbox" checked={linked} disabled={busy} onChange={() => void toggleClass(klass.id, linked)} />
                  {klass.name}
                </label>
              );
            })}
          </div>
        )}
      </Card>

      <div className="inline">
        <Badge tone={course.status === 'PUBLISHED' ? 'green' : 'amber'}>{course.status}</Badge>
        {course.content_status === 'IMPORTED_UNREVIEWED' ? <Badge tone="amber">Imported, unreviewed</Badge> : null}
      </div>
    </>
  );
}

function CourseSettings({ course }: { course: { id: string; title: string; description: string; languages: LanguageId[] } }) {
  const source = useDataSource();
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description);
  const [languages, setLanguages] = useState<LanguageId[]>(course.languages);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await source.saveCourse({ id: course.id, organizationId: null, title: title.trim(), description: description.trim(), languages });
      setNotice('Course details saved.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Course details">
      <form className="form-stack" onSubmit={onSubmit}>
        {error ? <InlineError>{error}</InlineError> : null}
        {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
        <div className="form-grid">
          <Field label="Title" htmlFor="edit-course-title">
            <input id="edit-course-title" type="text" required value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Description" htmlFor="edit-course-description">
            <textarea id="edit-course-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Languages</legend>
          <div className="checkbox-row">
            {LANGUAGES.map((language) => (
              <label key={language.id}>
                <input
                  type="checkbox"
                  checked={languages.includes(language.id)}
                  onChange={(event) =>
                    setLanguages((current) =>
                      event.target.checked ? [...current, language.id] : current.filter((id) => id !== language.id),
                    )
                  }
                />
                {language.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </form>
    </Card>
  );
}
