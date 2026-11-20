// Development-only engineering-college demo data and the reviewed import of the J_Platform question bank.
// All demo records use the `demo-` id prefix, `.test` e-mail addresses and names containing "(Demo)",
// so they are always identifiable. Course shells are configuration only: they contain no fabricated
// teaching material.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type pg from 'pg';

const ORG = 'demo-org-engineering';
const SEMESTER_COURSES: Array<{ sem: number; code: string; title: string; language: string }> = [
  { sem: 1, code: 'CS101', title: 'Basic Programming (TPS)', language: 'C' },
  { sem: 2, code: 'CS201', title: 'Object Oriented Programming', language: 'CPP' },
  { sem: 3, code: 'CS301', title: 'Advanced Programming in Java', language: 'JAVA' },
  { sem: 4, code: 'CS401', title: 'Operating Systems', language: 'C' },
  { sem: 4, code: 'CS402', title: 'Computer Networks', language: 'PYTHON' },
  { sem: 5, code: 'CS501', title: 'Institutional Elective (configure)', language: 'PYTHON' },
  { sem: 6, code: 'CS601', title: 'Technical Development and Projects', language: 'PYTHON' },
  { sem: 7, code: 'CS701', title: 'Placement Preparation and Advanced Topics', language: 'JAVA' },
];

export async function seedEngineeringCollege(client: pg.PoolClient, hashes: { orgAdmin: string; teacher: string; student: string }) {
  await client.query(
    `INSERT INTO organizations (id, name, slug, type, description, status, contact_name, contact_email, city, state, country)
     VALUES ($1, 'Demo Engineering College (Demo)', 'demo-engineering-college', 'COLLEGE',
             'Development demo tenant. Not a real institution.', 'ACTIVE', 'Demo Registrar', 'registrar@demo-college.test', 'Pune', 'MH', 'India')
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  const users: Array<[string, string, string, string, string, string]> = [
    ['demo-admin', 'Asha', 'Rao (Demo)', 'admin@demo-college.test', 'ORGANIZATION_ADMIN', hashes.orgAdmin],
    ['demo-hod-cse', 'Vikram', 'Iyer (Demo)', 'hod.cse@demo-college.test', 'TEACHER', hashes.teacher],
    ['demo-faculty-1', 'Meera', 'Nair (Demo)', 'faculty@demo-college.test', 'TEACHER', hashes.teacher],
    ['demo-student-1', 'Rohan', 'Kulkarni (Demo)', 'student1@demo-college.test', 'STUDENT', hashes.student],
    ['demo-student-2', 'Sneha', 'Patil (Demo)', 'student2@demo-college.test', 'STUDENT', hashes.student],
    ['demo-student-3', 'Arjun', 'Mehta (Demo)', 'student3@demo-college.test', 'STUDENT', hashes.student],
  ];
  for (const [id, first, last, email, role, hash] of users) {
    await client.query(
      `INSERT INTO users (id, organization_id, first_name, last_name, email, role, status) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE') ON CONFLICT (id) DO NOTHING`,
      [id, ORG, first, last, email, role],
    );
    await client.query(`INSERT INTO credentials (user_id, password_hash) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING`, [id, hash]);
  }

  await client.query(
    `INSERT INTO departments (id, organization_id, name, code, hod_user_id) VALUES
       ('demo-dept-cse', $1, 'Computer Science and Engineering', 'CSE', 'demo-hod-cse'),
       ('demo-dept-ece', $1, 'Electronics and Communication', 'ECE', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  await client.query(
    `INSERT INTO role_assignments (user_id, organization_id, role, scope_type, scope_id)
     SELECT 'demo-hod-cse', $1, 'HOD', 'DEPARTMENT', 'demo-dept-cse'
     WHERE NOT EXISTS (SELECT 1 FROM role_assignments WHERE user_id = 'demo-hod-cse' AND role = 'HOD' AND revoked_at IS NULL)`,
    [ORG],
  );
  await client.query(
    `INSERT INTO programs (id, organization_id, department_id, name, code, degree, duration_semesters)
     VALUES ('demo-prog-btech-cse', $1, 'demo-dept-cse', 'B.Tech Computer Science', 'BTCSE', 'B.Tech', 8) ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  await client.query(
    `INSERT INTO academic_years (id, organization_id, label, starts_on, ends_on)
     VALUES ('demo-ay-2026', $1, '2026-27', '2026-07-01', '2027-06-30') ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  await client.query(
    `INSERT INTO batches (id, organization_id, program_id, name, start_year, end_year)
     VALUES ('demo-batch-2025', $1, 'demo-prog-btech-cse', 'CSE 2025-29', 2025, 2029) ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  for (let n = 1; n <= 8; n++) {
    await client.query(
      `INSERT INTO semesters (id, organization_id, batch_id, academic_year_id, number, name, status)
       VALUES ($1, $2, 'demo-batch-2025', $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [`demo-sem-${n}`, ORG, n === 3 ? 'demo-ay-2026' : null, n, `Semester ${n}`, n < 3 ? 'COMPLETED' : n === 3 ? 'ACTIVE' : 'UPCOMING'],
    );
  }
  await client.query(
    `INSERT INTO classes (id, organization_id, name, grade, academic_year, description, status, department_id, program_id, batch_id, semester_id)
     VALUES ('demo-class-cse-s3', $1, 'CSE 2025 · Semester 3', 'S3', '2026-27', 'Demo cohort', 'ACTIVE',
             'demo-dept-cse', 'demo-prog-btech-cse', 'demo-batch-2025', 'demo-sem-3')
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  await client.query(
    `INSERT INTO sections (id, class_id, name, max_students, status) VALUES ('demo-sec-cse-s3-a', 'demo-class-cse-s3', 'Section A', 60, 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
  );
  for (const sid of ['demo-student-1', 'demo-student-2', 'demo-student-3']) {
    await client.query(
      `INSERT INTO student_section_memberships (id, student_id, section_id, status) VALUES ($1,$2,'demo-sec-cse-s3-a','ACTIVE') ON CONFLICT (id) DO NOTHING`,
      [`demo-ssm-${sid}`, sid],
    );
  }
  for (const tid of ['demo-faculty-1', 'demo-hod-cse']) {
    await client.query(
      `INSERT INTO teacher_section_memberships (id, teacher_id, section_id, status) VALUES ($1,$2,'demo-sec-cse-s3-a','ACTIVE') ON CONFLICT (id) DO NOTHING`,
      [`demo-tsm-${tid}`, tid],
    );
  }

  for (const c of SEMESTER_COURSES) {
    await client.query(
      `INSERT INTO courses (id, organization_id, created_by, title, description, category, language, difficulty, status, version,
                            semester_number, subject_code, department_id, access_model)
       VALUES ($1,$2,'demo-admin',$3,$4,'Engineering',$5,'BEGINNER','PUBLISHED','1.0.0',$6,$7,'demo-dept-cse','ORG_ALLOCATED')
       ON CONFLICT (id) DO NOTHING`,
      [`demo-course-${c.code.toLowerCase()}`, ORG, c.title, 'Course shell (demo). Faculty add approved material.', c.language, c.sem, c.code],
    );
  }
  await client.query(
    `INSERT INTO course_allocations (id, course_id, organization_id, class_id, section_id, scope, teacher_id, status, start_date)
     VALUES ('demo-alloc-cs301-a', 'demo-course-cs301', $1, 'demo-class-cse-s3', 'demo-sec-cse-s3-a', 'SECTION', 'demo-faculty-1', 'ACTIVE', NOW() - INTERVAL '30 days')
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );

  // A coding question with visible + hidden tests and starter code in all four languages.
  await client.query(
    `INSERT INTO questions (id, organization_id, course_id, created_by, title, description, input_format, output_format, constraints, examples,
                            difficulty, topic, topics, supported_languages, marks, question_type, status, starter_code, time_limit_ms, memory_limit_mb, skills)
     VALUES ('demo-q-sum-even', $1, 'demo-course-cs301', 'demo-faculty-1', 'Sum of Even Numbers (Demo)',
             'Read N followed by N integers. Print the sum of the even integers.',
             'First line: N. Second line: N space-separated integers.', 'A single integer.', '1 <= N <= 10^5, |a_i| <= 10^9',
             '[{"input":"5\\n1 2 3 4 5","output":"6"}]'::jsonb, 'EASY', 'Arrays', '["Arrays","Loops"]'::jsonb,
             '["PYTHON","C","CPP","JAVA"]'::jsonb, 10, 'CODE', 'PUBLISHED',
             $2::jsonb, 2000, 256, '["Programming fundamentals","Problem solving"]'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [ORG, JSON.stringify({
      PYTHON: 'import sys\n\ndata = sys.stdin.read().split()\n# n = int(data[0]); values = data[1:]\n',
      C: '#include <stdio.h>\n\nint main(void) {\n    int n;\n    if (scanf("%d", &n) != 1) return 0;\n    return 0;\n}\n',
      CPP: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    return 0;\n}\n',
      JAVA: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n    }\n}\n',
    })],
  );
  const tests: Array<[string, string, string, boolean, number]> = [
    ['demo-tc-se-1', '5\n1 2 3 4 5', '6', false, 1],
    ['demo-tc-se-2', '3\n7 9 11', '0', false, 2],
    ['demo-tc-se-3', '4\n-2 -4 1 3', '-6', true, 3],
    ['demo-tc-se-4', '6\n1000000000 1000000000 1000000000 2 2 1', '3000000004', true, 4],
  ];
  for (const [id, input, out, hidden, order] of tests) {
    await client.query(
      `INSERT INTO test_cases (id, question_id, input, expected_output, is_hidden, is_sample, order_num) VALUES ($1,'demo-q-sum-even',$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [id, input, out, hidden, !hidden, order],
    );
  }
  await client.query(
    `INSERT INTO assignments (id, organization_id, section_id, course_allocation_id, created_by, title, assignment_type, description, instructions,
                              total_marks, start_date, due_date, status, allow_resubmit, allowed_languages, version, published_at)
     VALUES ('demo-asg-arrays', $1, 'demo-sec-cse-s3-a', 'demo-alloc-cs301-a', 'demo-faculty-1', 'Arrays Lab 1 (Demo)', 'PROGRAMMING',
             'Warm-up array processing.', 'Solve in any allowed language. Hidden tests decide the final score.', 10,
             NOW() - INTERVAL '1 day', NOW() + INTERVAL '14 days', 'PUBLISHED', TRUE, '["PYTHON","C","CPP","JAVA"]'::jsonb, 1, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  await client.query(
    `INSERT INTO assignment_questions (id, assignment_id, question_id, marks, order_num) VALUES ('demo-aq-arrays-1','demo-asg-arrays','demo-q-sum-even',10,1)
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO assignment_versions (assignment_id, organization_id, version, snapshot)
     SELECT 'demo-asg-arrays', $1, 1, '{"title":"Arrays Lab 1 (Demo)","questions":[{"question_id":"demo-q-sum-even","marks":10}]}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM assignment_versions WHERE assignment_id = 'demo-asg-arrays')`,
    [ORG],
  );
  const plan = await client.query<{ id: string }>(`SELECT id FROM subscription_plans WHERE code = 'institution'`);
  if (plan.rows[0]) {
    await client.query(
      `INSERT INTO organization_subscriptions (organization_id, plan_id, seats, starts_at, renews_at, status, notes)
       SELECT $1, $2, 500, CURRENT_DATE - 30, CURRENT_DATE + 335, 'ACTIVE', 'Demo subscription'
       WHERE NOT EXISTS (SELECT 1 FROM organization_subscriptions WHERE organization_id = $1)`,
      [ORG, plan.rows[0].id],
    );
  }
}

const DIFFICULTY: Record<string, string> = { Beginner: 'EASY', Easy: 'EASY', Medium: 'MEDIUM', Hard: 'HARD' };

/**
 * Imports the recovered J_Platform Java bank as platform practice questions. They are marked
 * IMPORTED_UNREVIEWED so faculty can see they are not approved institutional material.
 */
export async function importJPlatformQuestionBank(client: pg.PoolClient): Promise<number> {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, '..', '..', '..', '..', 'content', 'j-platform-question-bank', 'questions.json');
  if (!existsSync(file)) return 0;
  const bank = JSON.parse(readFileSync(file, 'utf8')) as {
    questions: Array<{ slug: string; title: string; difficulty: string; category: string; description: string; constraints: string;
      starterCode: string; solutionCode: string | null; testCases: Array<{ input: string; expectedOutput: string; isHidden: boolean }> }>;
  };
  let n = 0;
  for (const q of bank.questions) {
    const id = `jbank-${q.slug}`.slice(0, 120);
    const res = await client.query(
      `INSERT INTO questions (id, organization_id, title, description, constraints, difficulty, topic, topics, supported_languages, marks,
                              question_type, status, starter_code, reference_solution, slug, source_bank, review_status, time_limit_ms, memory_limit_mb)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, '["JAVA"]'::jsonb, 10, 'CODE', 'PUBLISHED', $8, $9, $10, 'j-platform', 'IMPORTED_UNREVIEWED', 4000, 256)
       ON CONFLICT (id) DO NOTHING`,
      [id, q.title, q.description, q.constraints, DIFFICULTY[q.difficulty] ?? 'MEDIUM', q.category, JSON.stringify([q.category]),
        JSON.stringify({ JAVA: q.starterCode }), q.solutionCode ? JSON.stringify({ JAVA: q.solutionCode }) : null, q.slug],
    );
    if (!res.rowCount) continue;
    n++;
    let order = 0;
    for (const t of q.testCases) {
      order++;
      await client.query(
        `INSERT INTO test_cases (id, question_id, input, expected_output, is_hidden, is_sample, order_num) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [`${id}-tc${order}`, id, t.input, t.expectedOutput, t.isHidden, !t.isHidden, order],
      );
    }
  }
  return n;
}
