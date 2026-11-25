import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import type { AuthService } from './auth/types';
import { AppShell } from './components/AppShell';
import { DataProvider } from './data/DataProvider';
import type { DataSource } from './data/source';
import { ThemeProvider } from './lib/theme';
import type { Role } from './data/types';
import { LoginScreen } from './screens/LoginScreen';
import { NotConfiguredScreen } from './screens/NotConfiguredScreen';
import { StudentOverview } from './screens/student/StudentOverview';
import { StudentTopics } from './screens/student/StudentTopics';
import { StudentSubmissions } from './screens/student/StudentSubmissions';
import { StudentSubmissionDetail } from './screens/student/StudentSubmissionDetail';
import { StudentAssessments } from './screens/student/StudentAssessments';
import { TeacherClasses } from './screens/teacher/TeacherClasses';
import { TeacherClassDetail } from './screens/teacher/TeacherClassDetail';
import { TeacherStudentDetail } from './screens/teacher/TeacherStudentDetail';
import { TeacherReview } from './screens/teacher/TeacherReview';
import { TeacherCourses } from './screens/teacher/TeacherCourses';
import { TeacherCourseEditor } from './screens/teacher/TeacherCourseEditor';
import { TeacherQuestionEditor } from './screens/teacher/TeacherQuestionEditor';
import { TeacherAssessments } from './screens/teacher/TeacherAssessments';
import { TeacherAssessmentEditor } from './screens/teacher/TeacherAssessmentEditor';
import { AdminOverview } from './screens/admin/AdminOverview';
import { AdminDepartments } from './screens/admin/AdminDepartments';
import { AdminClasses } from './screens/admin/AdminClasses';
import { AdminClassDetail } from './screens/admin/AdminClassDetail';
import { OwnerOrganizations } from './screens/owner/OwnerOrganizations';
import { OwnerCourses } from './screens/owner/OwnerCourses';

export function homeFor(role: Role): string {
  switch (role) {
    case 'STUDENT':
      return '/student';
    case 'TEACHER':
      return '/teacher';
    case 'COLLEGE_ADMIN':
      return '/admin';
    case 'PLATFORM_OWNER':
      return '/owner';
  }
}

function App() {
  const { state, profile } = useAuth();

  if (state === 'loading') {
    return (
      <div className="auth-screen" role="status" aria-busy="true">
        <p className="muted">Opening your workspace…</p>
      </div>
    );
  }
  if (state !== 'active' || !profile) return <LoginScreen />;

  return (
    <Routes>
      <Route element={<AppShell profile={profile} />}>
        {profile.role === 'STUDENT' ? (
          <Route path="/student">
            <Route index element={<StudentOverview />} />
            <Route path="topics" element={<StudentTopics />} />
            <Route path="submissions" element={<StudentSubmissions />} />
            <Route path="submissions/:id" element={<StudentSubmissionDetail />} />
            <Route path="assessments" element={<StudentAssessments />} />
          </Route>
        ) : null}
        {profile.role === 'TEACHER' ? (
          <Route path="/teacher">
            <Route index element={<TeacherClasses />} />
            <Route path="classes/:classId" element={<TeacherClassDetail />} />
            <Route path="classes/:classId/students/:studentId" element={<TeacherStudentDetail />} />
            <Route path="review/:submissionId" element={<TeacherReview />} />
            <Route path="courses" element={<TeacherCourses />} />
            <Route path="courses/:courseId" element={<TeacherCourseEditor />} />
            <Route path="courses/:courseId/questions/:questionId" element={<TeacherQuestionEditor />} />
            <Route path="assessments" element={<TeacherAssessments />} />
            <Route path="assessments/:assessmentId" element={<TeacherAssessmentEditor />} />
          </Route>
        ) : null}
        {profile.role === 'COLLEGE_ADMIN' ? (
          <Route path="/admin">
            <Route index element={<AdminOverview />} />
            <Route path="departments" element={<AdminDepartments />} />
            <Route path="classes" element={<AdminClasses />} />
            <Route path="classes/:classId" element={<AdminClassDetail />} />
          </Route>
        ) : null}
        {profile.role === 'PLATFORM_OWNER' ? (
          <Route path="/owner">
            <Route index element={<OwnerOrganizations />} />
            <Route path="courses" element={<OwnerCourses />} />
          </Route>
        ) : null}
        <Route path="*" element={<Navigate to={homeFor(profile.role)} replace />} />
      </Route>
    </Routes>
  );
}

export function Root({ runtime }: { runtime: { source: DataSource; auth: AuthService } }) {
  return (
    <ThemeProvider>
      <AuthProvider service={runtime.auth}>
        <DataProvider source={runtime.source}>
          <HashRouter>
            <App />
          </HashRouter>
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export { NotConfiguredScreen };
