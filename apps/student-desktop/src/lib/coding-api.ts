import type { LanguageId } from '@lplatform/language-config';
import { getApiBaseUrl, request } from './api';

export interface WorkspaceQuestion {
  id: string;
  title: string;
  description: string;
  input_format: string | null;
  output_format: string | null;
  constraints: string | null;
  examples: Array<{ input: string; output: string; explanation?: string }>;
  difficulty: string;
  topic: string;
  marks: number;
  starter_code: Partial<Record<LanguageId, string>>;
  time_limit_ms: number;
  memory_limit_mb: number;
  allowedLanguages: string[];
  assignmentId: string | null;
  visibleTests: Array<{ id: string; input: string; expectedOutput: string }>;
  hiddenTestCount: number;
}

export interface JobResult {
  ordinal: number;
  hidden: boolean;
  verdict: string;
  input?: string;
  expectedOutput?: string | null;
  stdout?: string;
  stderr?: string;
  timeMs?: number | null;
}

export interface Job {
  id: string;
  kind: 'RUN' | 'SUBMIT';
  language: LanguageId;
  status: 'QUEUED' | 'COMPILING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  verdict: string | null;
  compile_output: string | null;
  error: string | null;
  passed_tests: number;
  total_tests: number;
  max_time_ms: number | null;
  submission_id: string | null;
  created_at: string;
  results: JobResult[];
}

export interface HistoryItem {
  id: string;
  kind: 'RUN' | 'SUBMIT';
  language: string;
  status: string;
  verdict: string | null;
  passed_tests: number;
  total_tests: number;
  created_at: string;
  question_title: string;
  question_id: string;
  assignment_id: string | null;
}

export interface PracticeItem {
  id: string;
  title: string;
  difficulty: string;
  topic: string;
  supported_languages: string[];
  source_bank: string | null;
  review_status: string;
  solved: boolean;
  attempts: number;
}

export const fetchWorkspaceQuestion = (questionId: string, assignmentId?: string | null) =>
  request<WorkspaceQuestion>(`/api/coding/questions/${encodeURIComponent(questionId)}${assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : ''}`);

export const runCode = (body: { questionId: string; assignmentId?: string | null; language: LanguageId; code: string; customInput?: string | null }) =>
  request<{ jobId: string; status: string }>('/api/coding/run', { method: 'POST', body: JSON.stringify(body) });

export const submitCode = (body: { questionId: string; assignmentId: string; language: LanguageId; code: string; clientOperationId: string }) =>
  request<{ id: string; jobId: string | null; status: string; idempotentReplay?: boolean }>('/api/submissions', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const fetchJob = (jobId: string) => request<Job>(`/api/coding/jobs/${encodeURIComponent(jobId)}`);

/** Poll until the judge finishes. `onUpdate` receives intermediate QUEUED/COMPILING/RUNNING states. */
export async function waitForJob(jobId: string, onUpdate: (job: Job) => void, signal?: AbortSignal): Promise<Job> {
  let delay = 400;
  for (;;) {
    if (signal?.aborted) throw new Error('Cancelled');
    const job = await fetchJob(jobId);
    onUpdate(job);
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return job;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(2000, delay * 1.3);
  }
}

export const fetchHistory = (questionId?: string, assignmentId?: string | null) =>
  request<{ items: HistoryItem[] }>(
    `/api/coding/history?limit=30${questionId ? `&questionId=${encodeURIComponent(questionId)}` : ''}${assignmentId ? `&assignmentId=${encodeURIComponent(assignmentId)}` : ''}`,
  );

export const fetchPractice = (params: Record<string, string>) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return request<{ items: PracticeItem[]; total: number; page: number; pageSize: number; topics: string[] }>(`/api/coding/practice?${qs}`);
};

export const fetchServerDrafts = (questionId: string, assignmentId?: string | null) =>
  request<{ drafts: Array<{ language: LanguageId; content: string; client_updated_at: string }> }>(
    `/api/coding/drafts?questionId=${encodeURIComponent(questionId)}${assignmentId ? `&assignmentId=${encodeURIComponent(assignmentId)}` : ''}`,
  );

export const pushDraft = (body: { questionId: string; assignmentId?: string | null; language: LanguageId; content: string; clientUpdatedAt: string }) =>
  request<{ applied: boolean; stale: boolean }>('/api/coding/drafts', { method: 'PUT', body: JSON.stringify(body) });

export const postSnapshots = (snapshots: unknown[]) => request<{ accepted: number }>('/api/coding/snapshots', { method: 'POST', body: JSON.stringify({ snapshots }) });
export const postEvents = (events: unknown[]) => request<{ accepted: number }>('/api/activity/events', { method: 'POST', body: JSON.stringify({ events }) });

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
export const fetchNotifications = () => request<{ items: AppNotification[]; unread: number }>('/api/notifications');
export const markNotificationRead = (id: string) => request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
export const markAllNotificationsRead = () => request('/api/notifications/read-all', { method: 'POST' });

export interface DeviceSession {
  id: string;
  client_type: string;
  device_name: string | null;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
}
export const fetchSessions = () => request<{ sessions: DeviceSession[] }>('/api/auth/sessions');
export const revokeSession = (id: string) => request(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface StudentProfile {
  student: { firstName: string; lastName: string; email: string; organizationName: string | null };
  enrollments: Array<{ sectionId: string; sectionName: string; className: string; departmentName: string | null; programName: string | null; batchName: string | null; semesterName: string | null; semesterNumber: number | null; status: string }>;
  results: Array<{ id: string; assignmentTitle: string; questionTitle: string; language: string; verdict: string | null; score: number | null; maxMarks: number; passedTestCases: number; totalTestCases: number; submittedAt: string; teacherFeedback: string | null; courseTitle: string | null; feedbackReleasedAt: string | null }>;
  skills: Array<{ skill: string; status: string; score: number | null; evidenceCount: number }>;
  placement: Array<{ role: string; readiness: string; score: number | null; evidenceCoverage: number }>;
}
export const fetchMyProfile = (userId: string) => request<StudentProfile>(`/api/analytics/students/${encodeURIComponent(userId)}/profile`);

export interface PackageResource {
  fileId: string;
  path: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
}
export interface CoursePackage {
  available: boolean;
  packageId?: string;
  version?: number;
  manifest?: { courseId: string; courseTitle: string; packageVersion: number; requiredAppVersion: string; resources: PackageResource[] };
  downloads?: Record<string, string>;
}
export const fetchLatestPackage = (courseId: string) => request<CoursePackage>(`/api/courses/${encodeURIComponent(courseId)}/packages/latest`);

/** Download a signed resource URL as bytes (the URL carries its own short-lived token). */
export async function downloadSigned(relativeUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(`${getApiBaseUrl()}${relativeUrl}`);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.arrayBuffer();
}
