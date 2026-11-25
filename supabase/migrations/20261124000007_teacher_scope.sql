-- Teacher access to submissions and feedback is scoped to the students of their own classes.
--
-- Before: a teacher could read a submission when its COURSE was linked to one of their classes.
--   * Too narrow: practice work of the teacher's own students on platform-wide courses was hidden.
--   * Too broad: linking a platform-wide course to a class exposed that course's submissions from
--     every college.
-- After: a teacher reads (and gives feedback on) a submission only when the submitter is a STUDENT
-- member of a class the teacher teaches. Feedback is always written under the teacher's own id.

CREATE OR REPLACE FUNCTION public.rls_is_teacher_of_student(student uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.app_role() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.class_members s
    JOIN public.class_members t ON t.class_id = s.class_id
    WHERE s.user_id = student AND s.role = 'STUDENT'
      AND t.user_id = auth.uid() AND t.role = 'TEACHER'
  )
$$;
REVOKE ALL ON FUNCTION public.rls_is_teacher_of_student(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_is_teacher_of_student(uuid) TO authenticated;

DROP POLICY submissions_read ON public.submissions;
CREATE POLICY submissions_read ON public.submissions FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR public.app_role() = 'PLATFORM_OWNER'
  OR (organization_id = public.app_org() AND public.app_role() = 'COLLEGE_ADMIN')
  OR public.rls_is_teacher_of_student(user_id)
);

DROP POLICY feedback_read ON public.feedback;
CREATE POLICY feedback_read ON public.feedback FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.submissions s WHERE s.id = feedback.submission_id AND s.user_id = auth.uid() AND feedback.released)
  OR public.app_role() = 'PLATFORM_OWNER'
  OR (public.app_role() = 'COLLEGE_ADMIN' AND EXISTS (SELECT 1 FROM public.submissions s WHERE s.id = feedback.submission_id AND s.organization_id = public.app_org()))
  OR EXISTS (SELECT 1 FROM public.submissions s WHERE s.id = feedback.submission_id AND public.rls_is_teacher_of_student(s.user_id))
);

DROP POLICY feedback_teacher_write ON public.feedback;
CREATE POLICY feedback_teacher_write ON public.feedback FOR ALL TO authenticated
  USING (
    public.app_role() = 'PLATFORM_OWNER'
    OR EXISTS (SELECT 1 FROM public.submissions s WHERE s.id = feedback.submission_id AND public.rls_is_teacher_of_student(s.user_id))
  )
  WITH CHECK (
    public.app_role() = 'PLATFORM_OWNER'
    OR (
      teacher_id = auth.uid()
      AND EXISTS (SELECT 1 FROM public.submissions s WHERE s.id = feedback.submission_id AND public.rls_is_teacher_of_student(s.user_id))
    )
  );
