import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import {
  Badge,
  Card,
  ErrorState,
  Field,
  InlineError,
  InlineInfo,
  InlineSuccess,
  Loading,
  PageHeader,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { fromLocalInput, toLocalInput } from './TeacherAssessments';

export function TeacherAssessmentEditor() {
  const { assessmentId = '' } = useParams<{ assessmentId: string }>();
  const { profile } = useAuth();
  const source = useDataSource();
  const detail = useAsync(() => source.getAssessment(assessmentId), [assessmentId]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (detail.loading) return <Loading text="Loading assessment…" />;
  if (detail.error) return <ErrorState message={detail.error.message} onRetry={detail.reload} />;
  if (!detail.data) return null;
  const { assessment, questions } = detail.data;

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      await source.saveAssessment({
        id: assessment.id,
        organizationId: assessment.organization_id,
        courseId: assessment.course_id,
        classId: assessment.class_id,
        title: String(form.get('title') ?? '').trim(),
        questionIds: questions.map((question) => question.id),
        opensAt: fromLocalInput(String(form.get('opensAt'))),
        closesAt: fromLocalInput(String(form.get('closesAt'))),
        durationMinutes: Number(form.get('duration')),
        attemptsAllowed: Number(form.get('attempts')),
        gracePeriodMinutes: Number(form.get('grace')),
        highStakes: form.get('highStakes') === 'on',
      });
      setNotice('Draft saved.');
      detail.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const onSchedule = async () => {
    setPublishing(true);
    setNotice(null);
    setError(null);
    try {
      const published = await source.publishAssessment(assessment.id);
      setNotice(`Pack v${published.version} scheduled.`);
      detail.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Teacher · assessment"
        title={assessment.title}
        description={`${assessment.status} · ${questions.length} questions · ${profile?.role === 'TEACHER' ? 'teacher' : 'staff'}`}
        actions={
          <div className="inline">
            <Link className="btn btn-small" to={`/teacher/assessments/${assessment.id}/results`}>
              Results
            </Link>
            <Link className="btn btn-small" to="/teacher/assessments">
              All assessments
            </Link>
          </div>
        }
      />
      <div aria-live="polite" className="stack">
        {error ? <InlineError>{error}</InlineError> : null}
        {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
      </div>
      <Card title="Draft settings" description="Only DRAFT assessments can be edited before they are scheduled.">
        <form className="form-stack" onSubmit={(event) => void onSave(event)}>
          <div className="form-grid">
            <Field label="Title" htmlFor="edit-assessment-title">
              <input id="edit-assessment-title" name="title" type="text" required defaultValue={assessment.title} />
            </Field>
            <Field label="Opens at" htmlFor="edit-assessment-opens">
              <input id="edit-assessment-opens" name="opensAt" type="datetime-local" required defaultValue={toLocalInput(assessment.opens_at)} />
            </Field>
            <Field label="Closes at" htmlFor="edit-assessment-closes">
              <input id="edit-assessment-closes" name="closesAt" type="datetime-local" required defaultValue={toLocalInput(assessment.closes_at)} />
            </Field>
            <Field label="Duration (minutes)" htmlFor="edit-assessment-duration">
              <input id="edit-assessment-duration" name="duration" type="number" min={5} max={600} defaultValue={assessment.duration_minutes} />
            </Field>
            <Field label="Attempts allowed" htmlFor="edit-assessment-attempts">
              <input id="edit-assessment-attempts" name="attempts" type="number" min={1} max={20} defaultValue={assessment.attempts_allowed} />
            </Field>
            <Field label="Grace period (minutes)" htmlFor="edit-assessment-grace">
              <input id="edit-assessment-grace" name="grace" type="number" min={0} defaultValue={assessment.grace_period_minutes} />
            </Field>
          </div>
          <div className="checkbox-row">
            <label>
              <input type="checkbox" name="highStakes" defaultChecked={assessment.high_stakes} />
              High-stakes (central re-check required)
            </label>
          </div>
          <div className="inline">
            <button type="submit" className="btn btn-primary" disabled={saving || assessment.status !== 'DRAFT'}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <Badge tone={assessment.status === 'DRAFT' ? 'amber' : assessment.status === 'SCHEDULED' ? 'green' : 'neutral'}>
              {assessment.status}
            </Badge>
          </div>
        </form>
      </Card>
      <Card
        title="Scheduling"
        description="Scheduling publishes an encrypted assessment pack and fixes the key until the assessment opens."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSchedule()}
            disabled={publishing || !['DRAFT', 'SCHEDULED'].includes(assessment.status)}
          >
            {publishing ? 'Scheduling�' : 'Schedule'}
          </button>
        }
      >
        {assessment.status === 'DRAFT' ? (
          <InlineInfo>A draft pack is built with encrypted hidden tests. Republish before opening to add questions; the key stays the same.</InlineInfo>
        ) : assessment.status === 'SCHEDULED' ? (
          <InlineInfo>Students can download the pack. Republishing before opening keeps the key; after opening it returns ASSESSMENT_STARTED.</InlineInfo>
        ) : (
          <InlineInfo>This assessment is closed.</InlineInfo>
        )}
      </Card>
      <Card title="Questions" description={`Opens ${formatDateTime(assessment.opens_at)} · closes ${formatDateTime(assessment.closes_at)}`}>
        {questions.length === 0 ? (
          <p className="muted">No questions selected.</p>
        ) : (
          <ol className="stack">
            {questions.map((question) => (
              <li key={question.id}>
                <span style={{ fontWeight: 600 }}>{question.title}</span>{' '}
                <span className="muted small">
                  {question.difficulty} · {question.points} pts
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
