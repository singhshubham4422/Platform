CREATE OR REPLACE FUNCTION public.app_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() AND status='ACTIVE' $$;
CREATE OR REPLACE FUNCTION public.app_org() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT organization_id FROM public.profiles WHERE id=auth.uid() AND status='ACTIVE' $$;
CREATE OR REPLACE FUNCTION public.rls_is_class_teacher(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT public.app_role() IS NOT NULL AND EXISTS(SELECT 1 FROM public.class_members WHERE class_id=cid AND user_id=auth.uid() AND role='TEACHER') $$;
CREATE OR REPLACE FUNCTION public.rls_is_class_member(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT public.app_role() IS NOT NULL AND EXISTS(SELECT 1 FROM public.class_members WHERE class_id=cid AND user_id=auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.rls_can_read_course(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.courses c WHERE c.id=cid AND (public.app_role()<>'STUDENT' OR c.status='PUBLISHED') AND (
  (c.organization_id IS NULL AND c.status='PUBLISHED' AND public.app_role() IS NOT NULL) OR
  public.app_role()='PLATFORM_OWNER' OR
  (c.organization_id=public.app_org() AND public.app_role()='COLLEGE_ADMIN') OR
  EXISTS(SELECT 1 FROM public.class_courses cc JOIN public.class_members cm ON cm.class_id=cc.class_id WHERE cc.course_id=c.id AND cm.user_id=auth.uid())
 )) $$;
CREATE OR REPLACE FUNCTION public.rls_can_read_pack(pid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.course_pack_versions p WHERE p.pack_id=pid AND (
   (p.kind='COURSE' AND public.rls_can_read_course(p.course_id))
   OR (p.kind='ASSESSMENT' AND EXISTS (
    SELECT 1 FROM public.assessments a WHERE a.id=p.assessment_id AND (
     public.rls_is_class_teacher(a.class_id)
     OR (a.organization_id=public.app_org() AND public.app_role()='COLLEGE_ADMIN')
     OR (public.rls_is_class_member(a.class_id) AND a.status IN ('SCHEDULED','CLOSED'))
    )
   ))
   OR public.app_role()='PLATFORM_OWNER'
  )
 ) $$;
CREATE OR REPLACE FUNCTION public.rls_can_manage_course(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.courses c WHERE c.id=cid AND (public.app_role()='PLATFORM_OWNER' OR (c.organization_id=public.app_org() AND public.app_role()='COLLEGE_ADMIN') OR EXISTS(SELECT 1 FROM public.class_courses cc WHERE cc.course_id=c.id AND public.rls_is_class_teacher(cc.class_id)))) $$;
REVOKE ALL ON FUNCTION public.app_role(),public.app_org(),public.rls_is_class_teacher(uuid),public.rls_is_class_member(uuid),public.rls_can_read_course(uuid),public.rls_can_read_pack(text),public.rls_can_manage_course(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.app_role(),public.app_org(),public.rls_is_class_teacher(uuid),public.rls_is_class_member(uuid),public.rls_can_read_course(uuid),public.rls_can_read_pack(text),public.rls_can_manage_course(uuid) TO authenticated;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY; ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_read ON organizations FOR SELECT TO authenticated USING(id=app_org() OR app_role()='PLATFORM_OWNER');
CREATE POLICY organizations_update ON organizations FOR UPDATE TO authenticated USING((id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER') WITH CHECK((id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER');
CREATE POLICY organizations_owner_insert ON organizations FOR INSERT TO authenticated WITH CHECK(app_role()='PLATFORM_OWNER');
CREATE POLICY organizations_owner_all ON organizations FOR ALL TO authenticated USING(app_role()='PLATFORM_OWNER') WITH CHECK(app_role()='PLATFORM_OWNER');

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_read ON profiles FOR SELECT TO authenticated USING(id=auth.uid() OR app_role()='PLATFORM_OWNER' OR (organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR EXISTS(SELECT 1 FROM class_members mine JOIN class_members theirs ON theirs.class_id=mine.class_id WHERE mine.user_id=auth.uid() AND mine.role='TEACHER' AND theirs.user_id=profiles.id));
CREATE POLICY profiles_admin_insert ON profiles FOR INSERT TO authenticated WITH CHECK(app_role()='PLATFORM_OWNER' OR (app_role()='COLLEGE_ADMIN' AND organization_id=app_org() AND role<>'PLATFORM_OWNER'));
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE TO authenticated USING(app_role()='PLATFORM_OWNER' OR (app_role()='COLLEGE_ADMIN' AND organization_id=app_org() AND role<>'PLATFORM_OWNER')) WITH CHECK(app_role()='PLATFORM_OWNER' OR (app_role()='COLLEGE_ADMIN' AND organization_id=app_org() AND role<>'PLATFORM_OWNER'));
CREATE POLICY profiles_owner_all ON profiles FOR ALL TO authenticated USING(app_role()='PLATFORM_OWNER') WITH CHECK(app_role()='PLATFORM_OWNER');

ALTER TABLE departments ENABLE ROW LEVEL SECURITY; ALTER TABLE departments FORCE ROW LEVEL SECURITY;
CREATE POLICY departments_read ON departments FOR SELECT TO authenticated USING(organization_id=app_org() OR app_role()='PLATFORM_OWNER');
CREATE POLICY departments_admin ON departments FOR ALL TO authenticated USING((organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER') WITH CHECK((organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER');
ALTER TABLE classes ENABLE ROW LEVEL SECURITY; ALTER TABLE classes FORCE ROW LEVEL SECURITY;
CREATE POLICY classes_read ON classes FOR SELECT TO authenticated USING(rls_is_class_member(id) OR rls_is_class_teacher(id) OR organization_id=app_org() AND app_role()='COLLEGE_ADMIN' OR app_role()='PLATFORM_OWNER');
CREATE POLICY classes_admin ON classes FOR ALL TO authenticated USING((organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER') WITH CHECK((organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER');
ALTER TABLE class_members ENABLE ROW LEVEL SECURITY; ALTER TABLE class_members FORCE ROW LEVEL SECURITY;
CREATE POLICY class_members_read ON class_members FOR SELECT TO authenticated USING(user_id=auth.uid() OR rls_is_class_teacher(class_id) OR EXISTS(SELECT 1 FROM classes c WHERE c.id=class_members.class_id AND c.organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER');
CREATE POLICY class_members_admin ON class_members FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM classes c WHERE c.id=class_members.class_id AND c.organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER')
 WITH CHECK(app_role()='PLATFORM_OWNER' OR (app_role()='COLLEGE_ADMIN' AND EXISTS(SELECT 1 FROM classes c JOIN profiles p ON p.id=class_members.user_id WHERE c.id=class_members.class_id AND c.organization_id=app_org() AND p.organization_id=c.organization_id AND p.role=class_members.role)));

ALTER TABLE courses ENABLE ROW LEVEL SECURITY; ALTER TABLE courses FORCE ROW LEVEL SECURITY;
CREATE POLICY courses_read ON courses FOR SELECT TO authenticated USING(rls_can_read_course(id) AND (app_role()<>'STUDENT' OR status='PUBLISHED'));
CREATE POLICY courses_teacher_write ON courses FOR INSERT TO authenticated WITH CHECK((app_role()='PLATFORM_OWNER' AND organization_id IS NULL) OR (organization_id=app_org() AND app_role() IN ('TEACHER','COLLEGE_ADMIN')));
CREATE POLICY courses_teacher_update ON courses FOR UPDATE TO authenticated USING(rls_can_manage_course(id)) WITH CHECK(rls_can_manage_course(id));
CREATE POLICY courses_owner_delete ON courses FOR DELETE TO authenticated USING(app_role()='PLATFORM_OWNER' OR (app_role()='COLLEGE_ADMIN' AND organization_id=app_org()));
ALTER TABLE questions ENABLE ROW LEVEL SECURITY; ALTER TABLE questions FORCE ROW LEVEL SECURITY;
CREATE POLICY questions_read ON questions FOR SELECT TO authenticated USING(rls_can_read_course(course_id));
CREATE POLICY questions_write ON questions FOR ALL TO authenticated USING(rls_can_manage_course(course_id)) WITH CHECK(rls_can_manage_course(course_id));
ALTER TABLE question_tests ENABLE ROW LEVEL SECURITY; ALTER TABLE question_tests FORCE ROW LEVEL SECURITY;
CREATE POLICY tests_visible_read ON question_tests FOR SELECT TO authenticated USING(kind='VISIBLE' AND EXISTS(SELECT 1 FROM questions q WHERE q.id=question_id AND rls_can_read_course(q.course_id)));
CREATE POLICY tests_manage ON question_tests FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM questions q WHERE q.id=question_id AND rls_can_manage_course(q.course_id))) WITH CHECK(EXISTS(SELECT 1 FROM questions q WHERE q.id=question_id AND rls_can_manage_course(q.course_id)));
ALTER TABLE class_courses ENABLE ROW LEVEL SECURITY; ALTER TABLE class_courses FORCE ROW LEVEL SECURITY;
CREATE POLICY class_courses_read ON class_courses FOR SELECT TO authenticated USING(rls_is_class_member(class_id) OR app_role()='COLLEGE_ADMIN' AND EXISTS(SELECT 1 FROM classes c WHERE c.id=class_id AND c.organization_id=app_org()) OR app_role()='PLATFORM_OWNER');
CREATE POLICY class_courses_teacher_write ON class_courses FOR ALL TO authenticated
 USING(app_role()='PLATFORM_OWNER' OR (rls_is_class_teacher(class_id) OR app_role()='COLLEGE_ADMIN' AND EXISTS(SELECT 1 FROM classes c WHERE c.id=class_id AND c.organization_id=app_org())) AND EXISTS(SELECT 1 FROM classes c JOIN courses co ON co.id=class_courses.course_id WHERE c.id=class_courses.class_id AND (co.organization_id=c.organization_id OR co.organization_id IS NULL AND co.status='PUBLISHED')))
 WITH CHECK(app_role()='PLATFORM_OWNER' OR (rls_is_class_teacher(class_id) OR app_role()='COLLEGE_ADMIN' AND EXISTS(SELECT 1 FROM classes c WHERE c.id=class_id AND c.organization_id=app_org())) AND EXISTS(SELECT 1 FROM classes c JOIN courses co ON co.id=class_courses.course_id WHERE c.id=class_courses.class_id AND (co.organization_id=c.organization_id OR co.organization_id IS NULL AND co.status='PUBLISHED')));

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY; ALTER TABLE assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY assessments_read ON assessments FOR SELECT TO authenticated USING((rls_is_class_member(class_id) AND status<>'DRAFT') OR rls_is_class_teacher(class_id) OR (organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER');
CREATE POLICY assessments_teacher_write ON assessments FOR ALL TO authenticated
 USING(rls_is_class_teacher(class_id) OR (organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR app_role()='PLATFORM_OWNER')
 WITH CHECK(app_role()='PLATFORM_OWNER' OR (organization_id=app_org() AND (rls_is_class_teacher(class_id) OR app_role()='COLLEGE_ADMIN') AND EXISTS(SELECT 1 FROM classes c JOIN courses co ON co.id=assessments.course_id WHERE c.id=assessments.class_id AND c.organization_id=assessments.organization_id AND (co.organization_id=assessments.organization_id OR co.organization_id IS NULL AND co.status='PUBLISHED'))));
ALTER TABLE assessment_keys ENABLE ROW LEVEL SECURITY; ALTER TABLE assessment_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE course_pack_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE course_pack_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY packs_read ON course_pack_versions FOR SELECT TO authenticated USING(rls_can_read_pack(pack_id));
CREATE POLICY packs_owner_all ON course_pack_versions FOR ALL TO authenticated USING(app_role()='PLATFORM_OWNER') WITH CHECK(app_role()='PLATFORM_OWNER');

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY; ALTER TABLE submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY submissions_read ON submissions FOR SELECT TO authenticated USING(user_id=auth.uid() OR app_role()='PLATFORM_OWNER' OR (organization_id=app_org() AND app_role()='COLLEGE_ADMIN') OR EXISTS(SELECT 1 FROM class_courses cc JOIN class_members cm ON cm.class_id=cc.class_id WHERE cc.course_id=submissions.course_id AND cm.user_id=auth.uid() AND cm.role='TEACHER'));
CREATE POLICY submissions_insert ON submissions FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND rls_can_read_course(course_id));
CREATE POLICY submissions_owner_all ON submissions FOR ALL TO authenticated USING(app_role()='PLATFORM_OWNER') WITH CHECK(app_role()='PLATFORM_OWNER');
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY; ALTER TABLE feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY feedback_read ON feedback FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM submissions s WHERE s.id=feedback.submission_id AND s.user_id=auth.uid() AND feedback.released)
 OR app_role()='PLATFORM_OWNER'
 OR (app_role()='COLLEGE_ADMIN' AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=feedback.submission_id AND s.organization_id=app_org()))
 OR EXISTS(SELECT 1 FROM submissions s JOIN class_courses cc ON cc.course_id=s.course_id WHERE s.id=feedback.submission_id AND rls_is_class_teacher(cc.class_id))
);
CREATE POLICY feedback_teacher_write ON feedback FOR ALL TO authenticated
 USING(app_role()='PLATFORM_OWNER' OR EXISTS(SELECT 1 FROM submissions s JOIN class_courses cc ON cc.course_id=s.course_id WHERE s.id=feedback.submission_id AND rls_is_class_teacher(cc.class_id)))
 WITH CHECK(app_role()='PLATFORM_OWNER' OR EXISTS(SELECT 1 FROM submissions s JOIN class_courses cc ON cc.course_id=s.course_id WHERE s.id=feedback.submission_id AND rls_is_class_teacher(cc.class_id)));
ALTER TABLE devices ENABLE ROW LEVEL SECURITY; ALTER TABLE devices FORCE ROW LEVEL SECURITY;
CREATE POLICY devices_own ON devices FOR ALL TO authenticated USING(user_id=auth.uid() OR app_role()='PLATFORM_OWNER') WITH CHECK(user_id=auth.uid() OR app_role()='PLATFORM_OWNER');
ALTER TABLE assessment_key_issues ENABLE ROW LEVEL SECURITY; ALTER TABLE assessment_key_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY key_issues_read ON assessment_key_issues FOR SELECT TO authenticated USING(user_id=auth.uid() OR app_role()='PLATFORM_OWNER' OR app_role()='COLLEGE_ADMIN' AND EXISTS(SELECT 1 FROM assessments a WHERE a.id=assessment_id AND a.organization_id=app_org()) OR EXISTS(SELECT 1 FROM assessments a WHERE a.id=assessment_id AND rls_is_class_teacher(a.class_id)));
CREATE POLICY key_issues_owner_all ON assessment_key_issues FOR ALL TO authenticated USING(app_role()='PLATFORM_OWNER') WITH CHECK(app_role()='PLATFORM_OWNER');
ALTER TABLE kpi_student_daily ENABLE ROW LEVEL SECURITY; ALTER TABLE kpi_student_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY kpi_daily_read ON kpi_student_daily FOR SELECT TO authenticated USING(user_id=auth.uid() OR app_role()='PLATFORM_OWNER' OR organization_id=app_org() AND app_role()='COLLEGE_ADMIN' OR EXISTS(SELECT 1 FROM class_members cm JOIN classes c ON c.id=cm.class_id WHERE cm.user_id=kpi_student_daily.user_id AND cm.role='STUDENT' AND c.organization_id=app_org() AND rls_is_class_teacher(c.id)));
CREATE POLICY kpi_daily_owner_all ON kpi_student_daily FOR ALL TO authenticated USING(app_role()='PLATFORM_OWNER') WITH CHECK(app_role()='PLATFORM_OWNER');
ALTER TABLE kpi_student_topic ENABLE ROW LEVEL SECURITY; ALTER TABLE kpi_student_topic FORCE ROW LEVEL SECURITY;
CREATE POLICY kpi_topic_read ON kpi_student_topic FOR SELECT TO authenticated USING(user_id=auth.uid() OR app_role()='PLATFORM_OWNER' OR organization_id=app_org() AND app_role()='COLLEGE_ADMIN' OR EXISTS(SELECT 1 FROM class_members cm JOIN classes c ON c.id=cm.class_id WHERE cm.user_id=kpi_student_topic.user_id AND cm.role='STUDENT' AND c.organization_id=app_org() AND rls_is_class_teacher(c.id)));
CREATE POLICY kpi_topic_owner_all ON kpi_student_topic FOR ALL TO authenticated USING(app_role()='PLATFORM_OWNER') WITH CHECK(app_role()='PLATFORM_OWNER');
ALTER TABLE kpi_assessment ENABLE ROW LEVEL SECURITY; ALTER TABLE kpi_assessment FORCE ROW LEVEL SECURITY;
CREATE POLICY kpi_assessment_read ON kpi_assessment FOR SELECT TO authenticated USING(user_id=auth.uid() OR app_role()='PLATFORM_OWNER' OR organization_id=app_org() AND app_role()='COLLEGE_ADMIN' OR EXISTS(SELECT 1 FROM assessments a WHERE a.id=assessment_id AND rls_is_class_teacher(a.class_id)));
CREATE POLICY kpi_assessment_owner_all ON kpi_assessment FOR ALL TO authenticated USING(app_role()='PLATFORM_OWNER') WITH CHECK(app_role()='PLATFORM_OWNER');

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON organizations,profiles,departments,classes,class_members,courses,questions,question_tests,class_courses,assessments,course_pack_versions,submissions,feedback,devices,assessment_key_issues,kpi_student_daily,kpi_student_topic,kpi_assessment TO authenticated;
GRANT SELECT ON kpi_class_daily TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
REVOKE ALL ON assessment_keys FROM anon,authenticated;
GRANT USAGE ON SCHEMA public TO authenticated,service_role;
GRANT USAGE ON SCHEMA public TO anon;
-- TODO(offline-integration): phase 10 late/recheck
