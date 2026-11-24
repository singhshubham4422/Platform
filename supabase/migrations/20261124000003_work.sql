CREATE TABLE public.submissions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),organization_id uuid REFERENCES organizations(id),pack_id text NOT NULL,
 course_id uuid NOT NULL REFERENCES courses(id),question_id uuid NOT NULL REFERENCES questions(id),assessment_id uuid REFERENCES assessments(id),
 language text NOT NULL CHECK(language IN ('PYTHON','C','CPP','JAVA')),source text NOT NULL CHECK(octet_length(source)<=65536),source_sha256 text NOT NULL,
 verdict text NOT NULL CHECK(verdict IN ('ACCEPTED','WRONG_ANSWER','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT_EXCEEDED','MEMORY_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED','JUDGE_UNAVAILABLE','SUBMISSION_FAILED')),
 passed int NOT NULL,total int NOT NULL,total_time_ms int NOT NULL,results_json jsonb NOT NULL,started_at timestamptz NOT NULL,finished_at timestamptz NOT NULL,
 monotonic_seq bigint NOT NULL,device_id uuid NOT NULL,signature text,received_at timestamptz NOT NULL DEFAULT now(),late_status text CHECK(late_status IN ('ON_TIME','LATE','FINISHED_OFFLINE_SYNCED_LATE')),
 recheck_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK(recheck_status IN ('NOT_REQUIRED','QUEUED','RUNNING','DONE','FAILED')),
 recheck_verdict text CHECK(recheck_verdict IS NULL OR recheck_verdict IN ('ACCEPTED','WRONG_ANSWER','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT_EXCEEDED','MEMORY_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED','JUDGE_UNAVAILABLE','SUBMISSION_FAILED')),
 recheck_passed int,recheck_total int,recheck_at timestamptz
);
CREATE INDEX submissions_user_question_idx ON submissions(user_id,question_id);CREATE INDEX submissions_assessment_idx ON submissions(assessment_id);CREATE INDEX submissions_org_received_idx ON submissions(organization_id,received_at);
CREATE TABLE public.feedback(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,teacher_id uuid NOT NULL REFERENCES profiles(id),body text NOT NULL,score_override numeric,released boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.devices(user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,device_id uuid NOT NULL,public_key text NOT NULL,registered_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,PRIMARY KEY(user_id,device_id));
CREATE TABLE public.assessment_key_issues(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assessment_id uuid NOT NULL REFERENCES assessments(id),user_id uuid NOT NULL REFERENCES profiles(id),key_id uuid NOT NULL,device_id uuid,issued_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.submissions_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller_role text; org_id uuid; q_course uuid;
BEGIN
 caller_role:=coalesce(auth.role(),'');
 IF caller_role<>'service_role' THEN
   NEW.user_id:=auth.uid();
 END IF;
 SELECT p.organization_id INTO org_id FROM public.profiles p WHERE p.id=NEW.user_id AND p.status='ACTIVE';
 IF NOT FOUND AND caller_role<>'service_role' THEN RAISE EXCEPTION 'PROFILE_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT q.course_id INTO q_course FROM public.questions q WHERE q.id=NEW.question_id;
 IF q_course IS DISTINCT FROM NEW.course_id THEN RAISE EXCEPTION 'QUESTION_COURSE_MISMATCH' USING ERRCODE='23514'; END IF;
 IF org_id IS NULL THEN SELECT c.organization_id INTO org_id FROM public.courses c WHERE c.id=NEW.course_id; END IF;
 NEW.organization_id:=org_id;
 NEW.received_at:=now();NEW.late_status:=NULL;NEW.recheck_status:='NOT_REQUIRED';NEW.recheck_verdict:=NULL;NEW.recheck_passed:=NULL;NEW.recheck_total:=NULL;NEW.recheck_at:=NULL;
 IF NEW.assessment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.assessments a WHERE a.id=NEW.assessment_id AND a.course_id=NEW.course_id AND NEW.question_id=ANY(a.question_ids)) THEN RAISE EXCEPTION 'QUESTION_NOT_IN_ASSESSMENT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER submissions_guard BEFORE INSERT ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.submissions_guard();
