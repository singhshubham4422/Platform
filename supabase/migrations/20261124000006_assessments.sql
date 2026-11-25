-- Phase 10: assessments, encrypted hidden tests, signed attempts and central re-check.

-- Students may only create practice submissions directly. Assessment attempts arrive through
-- submit-assessment-attempts with the service role, which verifies device signatures first.
DROP POLICY submissions_insert ON public.submissions;
CREATE POLICY submissions_insert ON public.submissions FOR INSERT TO authenticated
 WITH CHECK(user_id=auth.uid() AND assessment_id IS NULL AND rls_can_read_course(course_id));

-- Service-role inserts (assessment attempts) carry the late/recheck labels decided by the edge
-- function; interactive inserts still cannot set them.
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
 NEW.received_at:=now();
 IF caller_role<>'service_role' THEN
   NEW.late_status:=NULL;NEW.recheck_status:='NOT_REQUIRED';NEW.recheck_verdict:=NULL;NEW.recheck_passed:=NULL;NEW.recheck_total:=NULL;NEW.recheck_at:=NULL;
 END IF;
 IF NEW.assessment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.assessments a WHERE a.id=NEW.assessment_id AND a.course_id=NEW.course_id AND NEW.question_id=ANY(a.question_ids)) THEN RAISE EXCEPTION 'QUESTION_NOT_IN_ASSESSMENT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE INDEX submissions_assessment_user_question_idx ON public.submissions(assessment_id,user_id,question_id);

-- One row per student, assessment and question. The best attempt is the latest ACCEPTED final
-- attempt, otherwise the latest attempt. A high-stakes attempt only produces its final verdict
-- after the central Judge0 re-check says DONE.
CREATE VIEW public.assessment_results WITH (security_invoker = true) AS
WITH attempts AS (
 SELECT s.id AS submission_id,s.user_id,s.assessment_id,s.question_id,s.late_status,s.recheck_status,
        s.recheck_verdict,s.verdict,s.received_at,s.passed,s.total,
        a.high_stakes,
        (CASE WHEN a.high_stakes AND s.recheck_status='DONE' THEN s.recheck_verdict ELSE s.verdict END) AS final_verdict
 FROM public.submissions s
 JOIN public.assessments a ON a.id=s.assessment_id
 WHERE s.assessment_id IS NOT NULL
), ranked AS (
 SELECT t.*,coalesce(q.points,0) AS question_points,
        count(*) OVER (PARTITION BY t.user_id,t.assessment_id,t.question_id)::int AS attempts_used,
        row_number() OVER (
          PARTITION BY t.user_id,t.assessment_id,t.question_id
          ORDER BY (t.final_verdict='ACCEPTED') DESC,t.received_at DESC,t.submission_id DESC
        )::int AS attempt_rank
 FROM attempts t
 LEFT JOIN public.questions q ON q.id=t.question_id
)
SELECT r.user_id,r.assessment_id,r.question_id,r.submission_id AS best_attempt_id,
       r.final_verdict,r.late_status,r.recheck_status,r.passed,r.total,r.attempts_used,
       r.question_points,r.received_at AS best_received_at,
       f.score_override,
       coalesce(f.score_override,
         CASE WHEN r.final_verdict='ACCEPTED' AND r.late_status IS DISTINCT FROM 'LATE'
                   AND (NOT r.high_stakes OR r.recheck_status='DONE')
              THEN r.question_points ELSE 0 END)::numeric AS points_earned
FROM ranked r
LEFT JOIN LATERAL (
 SELECT fb.score_override FROM public.feedback fb
 WHERE fb.submission_id=r.submission_id AND fb.score_override IS NOT NULL
 ORDER BY fb.created_at DESC LIMIT 1
) f ON true
WHERE r.attempt_rank=1;

CREATE VIEW public.assessment_user_results WITH (security_invoker = true) AS
SELECT user_id,assessment_id,count(*)::int AS questions,
       count(*) FILTER (WHERE final_verdict='ACCEPTED')::int AS solved,
       coalesce(sum(points_earned),0)::numeric AS score,
       count(*) FILTER (WHERE recheck_status IN ('QUEUED','RUNNING'))::int AS pending_rechecks,
       max(attempts_used)::int AS max_attempts_used
FROM public.assessment_results
GROUP BY user_id,assessment_id;

REVOKE ALL ON public.assessment_results,public.assessment_user_results FROM anon,authenticated;
GRANT SELECT ON public.assessment_results,public.assessment_user_results TO authenticated;
GRANT ALL ON public.assessment_results,public.assessment_user_results TO service_role;

-- Claim one queued high-stakes submission for the central re-check worker. Only the service role
-- may call this; SKIP LOCKED keeps concurrent workers from seeing the same row.
CREATE OR REPLACE FUNCTION public.claim_recheck() RETURNS public.submissions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE claimed public.submissions;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE='42501'; END IF;
 UPDATE public.submissions SET recheck_status='RUNNING'
 WHERE id=(SELECT id FROM public.submissions WHERE recheck_status='QUEUED' ORDER BY received_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING * INTO claimed;
 RETURN claimed;
END $$;
REVOKE ALL ON FUNCTION public.claim_recheck() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recheck() TO service_role;
