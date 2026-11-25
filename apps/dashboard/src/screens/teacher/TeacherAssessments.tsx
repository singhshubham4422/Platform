import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  Loading,
  PageHeader,
  TableWrap,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';

export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function defaultWindow() {
  const start = new Date(Date.now() + 60 * 60_000);
  const end = new Date(Date.now() + 3 * 60 * 60_000);
  return { opensAt: start.toISOString(), closesAt: end.toISOString() };
}

export function TeacherAssessments() {
  const { profile } = useAuth();
  const source = useDataSource();
  const navigate = useNavigate();
  const userId = profile?.id ?? '';
  const assessments = useAsync(() => source.teacherAssessments(userId), [userId]);
  const classes = useAsync(() => source.teacherClasses(userId), [userId]);
  const courses = useAsync(() => source.teacherCourses(userId), [userId]);
  const windowDefaults = defaultWindow();
  const [classId, setClassId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [opensAt, setOpensAt] = useState(toLocalInput(windowDefaults.opensAt));
  const [closesAt, setClosesAt] = useState(toLocalInput(windowDefaults.closesAt));
  const [duration, setDuration] = useState('90');
  const [attempts, setAttempts] = useState('1');
  const [grace, setGrace] = useState('10');
  const [highStakes, setHighStakes] = useState(false);
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = useAsync(
    () => (courseId ? source.courseBundle(courseId).then((bundle) => bundle.questions) : Promise.resolve([])),
    [courseId],
  );

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (!profile?.organization_id) throw new Error('Your profile has no organization');
      const created = await source.saveAssessment({
        organizationId: profile.organization_id,
        courseId,
        classId,
        title: title.trim(),
        questionIds,
        opensAt: fromLocalInput(opensAt),
        closesAt: fromLocalInput(closesAt),
        durationMinutes: Number(duration),
        attemptsAllowed: Number(attempts),
        gracePeriodMinutes: Number(grace),
        highStakes,
      });
      navigate(`/teacher/assessments/${created.id}`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Teacher" title="Assessments" description="Draft assessments with encrypted hidden tests and signed attempts." />
      <Card title="Existing assessments">
        {assessments.loading ? (
          <Loading />
        ) : assessments.error ? (
          <ErrorState message={assessments.error.message} onRetry={assessments.reload} />
        ) : !assessments.data?.length ? (
          <EmptyState title="No assessments yet" description="Create a draft below; scheduling is enabled in phase 10." />
        ) : (
          <TableWrap label="Assessments">
            <thead>
              <tr>
                <th>Title</th>
                <th>Class</th>
                <th>Course</th>
                <th>Status</th>
                <th>Window</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {assessments.data.map((assessment) => (
                <tr key={assessment.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{assessment.title}</div>
                    {assessment.high_stakes ? <Badge tone="amber">High stakes</Badge> : null}
                  </td>
                  <td>{assessment.class_name ?? '—'}</td>
                  <td>{assessment.course_title ?? '—'}</td>
                  <td>
                    <Badge tone={assessment.status === 'SCHEDULED' ? 'green' : assessment.status === 'CLOSED' ? 'neutral' : 'amber'}>
                      {assessment.status}
                    </Badge>
                  </td>
                  <td className="small">
                    {formatDateTime(assessment.opens_at)} → {formatDateTime(assessment.closes_at)}
                  </td>
                  <td>
                    <Link className="btn btn-small" to={`/teacher/assessments/${assessment.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card title="Create a draft" description="Students cannot see drafts. Publishing a pack happens on the assessment page.">
        <form className="form-stack" onSubmit={onCreate}>
          {error ? <InlineError>{error}</InlineError> : null}
          <div className="form-grid">
            <Field label="Title" htmlFor="assessment-title">
              <input id="assessment-title" type="text" required value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Class" htmlFor="assessment-class">
              <select id="assessment-class" required value={classId} onChange={(event) => setClassId(event.target.value)}>
                <option value="">Choose a class…</option>
                {(classes.data ?? []).map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Course" htmlFor="assessment-course">
              <select
                id="assessment-course"
                required
                value={courseId}
                onChange={(event) => {
                  setCourseId(event.target.value);
                  setQuestionIds([]);
                }}
              >
                <option value="">Choose a course…</option>
                {(courses.data ?? []).map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Opens at" htmlFor="assessment-opens">
              <input id="assessment-opens" type="datetime-local" required value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
            </Field>
            <Field label="Closes at" htmlFor="assessment-closes">
              <input id="assessment-closes" type="datetime-local" required value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
            </Field>
            <Field label="Duration (minutes)" htmlFor="assessment-duration">
              <input id="assessment-duration" type="number" min={5} max={600} value={duration} onChange={(event) => setDuration(event.target.value)} />
            </Field>
            <Field label="Attempts allowed" htmlFor="assessment-attempts">
              <input id="assessment-attempts" type="number" min={1} max={20} value={attempts} onChange={(event) => setAttempts(event.target.value)} />
            </Field>
            <Field label="Grace period (minutes)" htmlFor="assessment-grace">
              <input id="assessment-grace" type="number" min={0} value={grace} onChange={(event) => setGrace(event.target.value)} />
            </Field>
          </div>
          <div className="checkbox-row">
            <label>
              <input type="checkbox" checked={highStakes} onChange={(event) => setHighStakes(event.target.checked)} />
              High-stakes (central re-check required)
            </label>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">Questions</legend>
            {!courseId ? (
              <p className="muted small">Choose a course to select its questions.</p>
            ) : questions.loading ? (
              <p className="muted small">Loading questions…</p>
            ) : !questions.data?.length ? (
              <p className="muted small">This course has no questions.</p>
            ) : (
              <div className="checkbox-row">
                {questions.data.map((question) => (
                  <label key={question.id}>
                    <input
                      type="checkbox"
                      checked={questionIds.includes(question.id)}
                      onChange={(event) =>
                        setQuestionIds((current) =>
                          event.target.checked ? [...current, question.id] : current.filter((id) => id !== question.id),
                        )
                      }
                    />
                    {question.title}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div>
            <button type="submit" className="btn btn-primary" disabled={saving || !title.trim() || !classId || !courseId || questionIds.length === 0}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
