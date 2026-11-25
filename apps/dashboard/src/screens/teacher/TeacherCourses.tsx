import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LANGUAGES } from '@lplatform/language-config';
import type { LanguageId } from '@lplatform/language-config';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import { Badge, Card, EmptyState, ErrorState, Field, InlineError, Loading, PageHeader, TableWrap } from '../../components/ui';
import { formatDate } from '../../lib/format';

export function TeacherCourses() {
  const { profile } = useAuth();
  const source = useDataSource();
  const navigate = useNavigate();
  const userId = profile?.id ?? '';
  const courses = useAsync(() => source.teacherCourses(userId), [userId]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [languages, setLanguages] = useState<LanguageId[]>(['PYTHON']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const course = await source.saveCourse({
        organizationId: profile?.organization_id ?? null,
        title: title.trim(),
        description: description.trim(),
        languages,
      });
      setTitle('');
      setDescription('');
      navigate(`/teacher/courses/${course.id}`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Teacher" title="Courses" description="Author question banks, link classes and publish signed course packs." />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="Your courses">
          {courses.loading ? (
            <Loading />
          ) : courses.error ? (
            <ErrorState message={courses.error.message} onRetry={courses.reload} />
          ) : !courses.data?.length ? (
            <EmptyState title="No courses yet" description="Create a course to add questions and publish packs." />
          ) : (
            <TableWrap label="Courses">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Languages</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {courses.data.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{course.title}</div>
                      <div className="muted small">{course.content_status === 'IMPORTED_UNREVIEWED' ? 'Imported, needs review' : 'Reviewed'}</div>
                    </td>
                    <td>
                      <Badge tone={course.status === 'PUBLISHED' ? 'green' : course.status === 'DRAFT' ? 'amber' : 'neutral'}>{course.status}</Badge>
                    </td>
                    <td className="small">{course.languages.join(', ')}</td>
                    <td className="small">{formatDate(course.updated_at)}</td>
                    <td>
                      <Link className="btn btn-small" to={`/teacher/courses/${course.id}`}>
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        <Card title="Create a course" description="Only your organization sees it until you publish packs to linked classes.">
          <form className="form-stack" onSubmit={onCreate}>
            {error ? <InlineError>{error}</InlineError> : null}
            <Field label="Title" htmlFor="course-title">
              <input id="course-title" type="text" required value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Description" htmlFor="course-description">
              <textarea id="course-description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </Field>
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
            <button type="submit" className="btn btn-primary" disabled={saving || !title.trim() || languages.length === 0}>
              {saving ? 'Creating…' : 'Create course'}
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
