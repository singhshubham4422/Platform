CREATE TABLE public.kpi_student_daily(
 organization_id uuid NOT NULL,user_id uuid NOT NULL,day date NOT NULL,active_minutes numeric(8,1) NOT NULL,questions_attempted int NOT NULL,questions_solved int NOT NULL,
 runs int NOT NULL,submits int NOT NULL,accepted_submits int NOT NULL,typed_chars bigint NOT NULL,paste_chars bigint NOT NULL,paste_ratio numeric(4,3) NOT NULL,
 focus_lost_count int NOT NULL,idle_minutes numeric(8,1) NOT NULL,computed_at timestamptz NOT NULL,PRIMARY KEY(user_id,day)
);
CREATE TABLE public.kpi_student_topic(
 organization_id uuid NOT NULL,user_id uuid NOT NULL,topic text NOT NULL,attempted int NOT NULL,solved int NOT NULL,mastery int NOT NULL CHECK(mastery BETWEEN 0 AND 100),computed_at timestamptz NOT NULL,PRIMARY KEY(user_id,topic)
);
CREATE TABLE public.kpi_assessment(
 organization_id uuid NOT NULL,assessment_id uuid NOT NULL,user_id uuid NOT NULL,score numeric NOT NULL,solved int NOT NULL,total_questions int NOT NULL,time_minutes numeric(8,1) NOT NULL,flags text[] NOT NULL DEFAULT '{}',computed_at timestamptz NOT NULL,PRIMARY KEY(assessment_id,user_id)
);
CREATE VIEW public.kpi_class_daily WITH (security_invoker=true) AS
 SELECT cm.class_id,k.day,count(*) FILTER(WHERE k.active_minutes>0)::int AS active_students,
        coalesce(avg(k.active_minutes),0)::numeric(8,1) AS avg_active_minutes,
        round(sum(k.questions_solved)::numeric/nullif(sum(k.questions_attempted),0),3) AS solve_rate
 FROM public.class_members cm JOIN public.kpi_student_daily k ON k.user_id=cm.user_id
 WHERE cm.role='STUDENT' GROUP BY cm.class_id,k.day;
