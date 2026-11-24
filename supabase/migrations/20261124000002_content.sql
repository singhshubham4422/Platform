CREATE TABLE public.courses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES organizations(id),title text NOT NULL,description text NOT NULL DEFAULT '',
 languages text[] NOT NULL CHECK(languages <@ ARRAY['PYTHON','C','CPP','JAVA']::text[] AND cardinality(languages)>0),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
 content_status text NOT NULL DEFAULT 'REVIEWED' CHECK(content_status IN ('REVIEWED','IMPORTED_UNREVIEWED')),
 created_by uuid REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.questions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,title text NOT NULL,statement_md text NOT NULL,
 difficulty text NOT NULL CHECK(difficulty IN ('EASY','MEDIUM','HARD')),points int NOT NULL DEFAULT 10 CHECK(points BETWEEN 0 AND 1000),topics text[] NOT NULL DEFAULT '{}',
 time_limit_ms int NOT NULL DEFAULT 2000 CHECK(time_limit_ms BETWEEN 100 AND 20000),memory_limit_mb int NOT NULL DEFAULT 256 CHECK(memory_limit_mb BETWEEN 16 AND 1024),
 output_limit_kb int NOT NULL DEFAULT 64 CHECK(output_limit_kb BETWEEN 1 AND 1024),starter_code jsonb NOT NULL DEFAULT '{}',order_index int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.question_tests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('VISIBLE','HIDDEN')),
 ordinal int NOT NULL,input text NOT NULL,expected_output text NOT NULL,UNIQUE(question_id,kind,ordinal)
);
CREATE TABLE public.class_courses(class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,PRIMARY KEY(class_id,course_id));
CREATE TABLE public.assessments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),course_id uuid NOT NULL REFERENCES courses(id),class_id uuid NOT NULL REFERENCES classes(id),
 title text NOT NULL,question_ids uuid[] NOT NULL,opens_at timestamptz NOT NULL,closes_at timestamptz NOT NULL CHECK(closes_at>opens_at),duration_minutes int NOT NULL CHECK(duration_minutes BETWEEN 5 AND 600),
 attempts_allowed int NOT NULL DEFAULT 1 CHECK(attempts_allowed BETWEEN 1 AND 20),grace_period_minutes int NOT NULL DEFAULT 10,high_stakes boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SCHEDULED','CLOSED')),created_by uuid REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.assessment_keys(assessment_id uuid PRIMARY KEY REFERENCES assessments(id) ON DELETE CASCADE,key_id uuid NOT NULL,key_b64 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.course_pack_versions(
 pack_id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('COURSE','ASSESSMENT')),course_id uuid REFERENCES courses(id),assessment_id uuid REFERENCES assessments(id),version int NOT NULL,
 object_path text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),size bigint NOT NULL CHECK(size>0),min_app_version text NOT NULL,published_by uuid REFERENCES profiles(id),published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(course_id,version),UNIQUE(assessment_id,version),CHECK((kind='COURSE' AND course_id IS NOT NULL AND assessment_id IS NULL) OR (kind='ASSESSMENT' AND assessment_id IS NOT NULL AND course_id IS NULL))
);
