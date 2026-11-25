import type { Profile, Role } from '../data/types';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG_ID = '11111111-1111-4111-8111-111111111112';
export const CLASS_ID = '12121212-1212-4212-8212-121212121212';
export const OTHER_CLASS_ID = '12121212-1212-4212-8212-121212121213';
export const DEPARTMENT_ID = '13131313-1313-4313-8313-131313131313';
export const COURSE_ID = '77777777-7777-4777-8777-777777777777';
export const PLATFORM_COURSE_ID = '77777777-7777-4777-8777-777777777778';
export const QUESTION_ID = '88888888-8888-4888-8888-888888888881';
export const QUESTION_ID_2 = '88888888-8888-4888-8888-888888888882';
export const ASSESSMENT_ID = '99999999-9999-4999-8999-999999999991';
export const SUBMISSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
export const ASSESSMENT_SUBMISSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
export const TEACHER_ID = '33333333-3333-4333-8333-333333333331';

export const MOCK_EMAILS: Record<Role | 'DISABLED', string> = {
  STUDENT: 'student@dashboard.test',
  TEACHER: 'teacher@dashboard.test',
  COLLEGE_ADMIN: 'admin@dashboard.test',
  PLATFORM_OWNER: 'owner@dashboard.test',
  DISABLED: 'disabled@dashboard.test',
};

const now = '2026-11-24T10:00:00.000Z';

export const profiles: Profile[] = [
  {
    id: '22222222-2222-4222-8222-222222222221',
    organization_id: ORG_ID,
    role: 'STUDENT',
    full_name: 'Asha Student',
    email: MOCK_EMAILS.STUDENT,
    department_id: DEPARTMENT_ID,
    status: 'ACTIVE',
    created_at: now,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    organization_id: ORG_ID,
    role: 'STUDENT',
    full_name: 'Bilal Student',
    email: 'bilal@dashboard.test',
    department_id: DEPARTMENT_ID,
    status: 'ACTIVE',
    created_at: now,
  },
  {
    id: TEACHER_ID,
    organization_id: ORG_ID,
    role: 'TEACHER',
    full_name: 'Tara Teacher',
    email: MOCK_EMAILS.TEACHER,
    department_id: DEPARTMENT_ID,
    status: 'ACTIVE',
    created_at: now,
  },
  {
    id: '44444444-4444-4444-8444-444444444441',
    organization_id: ORG_ID,
    role: 'COLLEGE_ADMIN',
    full_name: 'Cara Admin',
    email: MOCK_EMAILS.COLLEGE_ADMIN,
    department_id: null,
    status: 'ACTIVE',
    created_at: now,
  },
  {
    id: '55555555-5555-4555-8555-555555555551',
    organization_id: null,
    role: 'PLATFORM_OWNER',
    full_name: 'Omar Owner',
    email: MOCK_EMAILS.PLATFORM_OWNER,
    department_id: null,
    status: 'ACTIVE',
    created_at: now,
  },
  {
    id: '66666666-6666-4666-8666-666666666661',
    organization_id: ORG_ID,
    role: 'STUDENT',
    full_name: 'Dana Disabled',
    email: MOCK_EMAILS.DISABLED,
    department_id: DEPARTMENT_ID,
    status: 'DISABLED',
    created_at: now,
  },
];
