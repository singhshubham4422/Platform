import type {
  Assessment,
  AssessmentInput,
  AssessmentRow,
  TeacherAssessmentResults,
  ClassMemberRow,
  ClassRow,
  ClassStudentRow,
  Course,
  CourseBundle,
  CourseInput,
  Department,
  Feedback,
  FeedbackInput,
  InviteInput,
  KpiClassDaily,
  KpiStudentDaily,
  KpiStudentTopic,
  OrgOverviewPoint,
  Organization,
  Profile,
  PublishResult,
  Question,
  QuestionInput,
  StudentAssessmentResult,
  StudentDrilldown,
  StudentOverview,
  Submission,
  SubmissionDetail,
  TestInput,
} from './types';

/**
 * One method per dashboard query or mutation. The Supabase implementation is
 * the only one shipped; mocks exist under src/test and are reachable only from
 * the guarded test-mode runtime.
 */
export interface DataSource {
  studentOverview(userId: string): Promise<StudentOverview>;
  studentTopics(userId: string): Promise<KpiStudentTopic[]>;
  studentSubmissions(userId: string): Promise<Submission[]>;
  studentSubmission(userId: string, submissionId: string): Promise<SubmissionDetail>;
  studentAssessments(userId: string): Promise<StudentAssessmentResult[]>;

  teacherClasses(userId: string): Promise<ClassRow[]>;
  classDaily(classId: string): Promise<KpiClassDaily[]>;
  classStudents(classId: string): Promise<ClassStudentRow[]>;
  studentDrilldown(userId: string): Promise<StudentDrilldown>;
  reviewSubmission(submissionId: string): Promise<SubmissionDetail>;
  saveFeedback(input: FeedbackInput): Promise<Feedback>;

  teacherCourses(userId: string): Promise<Course[]>;
  courseBundle(courseId: string): Promise<CourseBundle>;
  saveCourse(input: CourseInput): Promise<Course>;
  saveQuestion(input: QuestionInput): Promise<Question>;
  reorderQuestions(courseId: string, orderedIds: string[]): Promise<void>;
  deleteQuestion(questionId: string): Promise<void>;
  saveTests(questionId: string, tests: TestInput[]): Promise<void>;
  linkClass(courseId: string, classId: string): Promise<void>;
  unlinkClass(courseId: string, classId: string): Promise<void>;
  publishCourse(courseId: string): Promise<PublishResult>;

  teacherAssessments(userId: string): Promise<AssessmentRow[]>;
  getAssessment(assessmentId: string): Promise<{ assessment: Assessment; questions: Question[] }>;
  saveAssessment(input: AssessmentInput): Promise<Assessment>;
  publishAssessment(assessmentId: string): Promise<PublishResult>;
  teacherAssessmentResults(assessmentId: string): Promise<TeacherAssessmentResults>;

  adminDepartments(): Promise<Department[]>;
  saveDepartment(input: { id?: string; organizationId: string; name: string; code: string }): Promise<Department>;
  deleteDepartment(departmentId: string): Promise<void>;
  adminClasses(): Promise<ClassRow[]>;
  saveClass(input: { id?: string; organizationId: string; departmentId: string | null; name: string; code: string; academicYear: string | null; semester: number | null }): Promise<ClassRow>;
  deleteClass(classId: string): Promise<void>;
  classMembers(classId: string): Promise<ClassMemberRow[]>;
  addClassMember(classId: string, userId: string, role: 'STUDENT' | 'TEACHER'): Promise<void>;
  removeClassMember(classId: string, userId: string): Promise<void>;
  orgProfiles(): Promise<Profile[]>;
  inviteUser(input: InviteInput): Promise<{ userId: string }>;
  orgOverview(): Promise<OrgOverviewPoint[]>;

  ownerOrganizations(): Promise<Organization[]>;
  createOrganization(input: { name: string; slug: string }): Promise<Organization>;
  ownerCourses(): Promise<Course[]>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type { KpiStudentDaily };
