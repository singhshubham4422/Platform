-- Run as LPKPI. JSONL gzip is staged using DBMS_CLOUD.COPY_DATA; JSON CLOBs stay validated.
-- Oracle docs: "Oracle Database 23ai JSON Developer's Guide" (IS JSON constraints).
CREATE TABLE lp_ingested_files(object_name VARCHAR2(1024) PRIMARY KEY, etag VARCHAR2(256), loaded_at TIMESTAMP WITH TIME ZONE NOT NULL, row_count NUMBER NOT NULL);
CREATE TABLE lp_stg_activity(
 event_id VARCHAR2(36) PRIMARY KEY, seq NUMBER NOT NULL, event_type VARCHAR2(64) NOT NULL,
 client_ts TIMESTAMP WITH TIME ZONE NOT NULL, user_id VARCHAR2(36) NOT NULL, organization_id VARCHAR2(36),
 device_id VARCHAR2(36), pack_id VARCHAR2(256), question_id VARCHAR2(36), assessment_id VARCHAR2(36),
 attempt_id VARCHAR2(36), language VARCHAR2(16), metadata CLOB CHECK(metadata IS JSON),
 object_name VARCHAR2(1024), loaded_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX lp_stg_activity_loaded_ix ON lp_stg_activity(loaded_at,user_id,client_ts);
CREATE TABLE lp_load_activity(event_id VARCHAR2(36),seq NUMBER,event_type VARCHAR2(64),client_ts VARCHAR2(64),user_id VARCHAR2(36),organization_id VARCHAR2(36),device_id VARCHAR2(36),pack_id VARCHAR2(256),question_id VARCHAR2(36),assessment_id VARCHAR2(36),attempt_id VARCHAR2(36),language VARCHAR2(16),metadata CLOB CHECK(metadata IS JSON));
CREATE TABLE lp_dim_question(question_id VARCHAR2(36) PRIMARY KEY, topics CLOB CHECK(topics IS JSON), points NUMBER NOT NULL);
CREATE TABLE lp_dim_assessment(assessment_id VARCHAR2(36) PRIMARY KEY, organization_id VARCHAR2(36) NOT NULL, question_ids CLOB CHECK(question_ids IS JSON));
CREATE TABLE lp_kpi_student_daily(
 organization_id VARCHAR2(36) NOT NULL,user_id VARCHAR2(36) NOT NULL,day DATE NOT NULL,active_minutes NUMBER(8,1) NOT NULL,
 questions_attempted NUMBER NOT NULL,questions_solved NUMBER NOT NULL,runs NUMBER NOT NULL,submits NUMBER NOT NULL,accepted_submits NUMBER NOT NULL,
 typed_chars NUMBER(19) NOT NULL,paste_chars NUMBER(19) NOT NULL,paste_ratio NUMBER(4,3) NOT NULL,focus_lost_count NUMBER NOT NULL,idle_minutes NUMBER(8,1) NOT NULL,
 computed_at TIMESTAMP WITH TIME ZONE NOT NULL,published_at TIMESTAMP WITH TIME ZONE,changed_at TIMESTAMP WITH TIME ZONE NOT NULL,
 CONSTRAINT lp_kpi_daily_pk PRIMARY KEY(user_id,day));
CREATE TABLE lp_kpi_student_topic(organization_id VARCHAR2(36) NOT NULL,user_id VARCHAR2(36) NOT NULL,topic VARCHAR2(128) NOT NULL,attempted NUMBER NOT NULL,solved NUMBER NOT NULL,mastery NUMBER NOT NULL,computed_at TIMESTAMP WITH TIME ZONE NOT NULL,published_at TIMESTAMP WITH TIME ZONE,changed_at TIMESTAMP WITH TIME ZONE NOT NULL,CONSTRAINT lp_kpi_topic_pk PRIMARY KEY(user_id,topic));
CREATE TABLE lp_kpi_assessment(organization_id VARCHAR2(36) NOT NULL,assessment_id VARCHAR2(36) NOT NULL,user_id VARCHAR2(36) NOT NULL,score NUMBER NOT NULL,solved NUMBER NOT NULL,total_questions NUMBER NOT NULL,time_minutes NUMBER(8,1) NOT NULL,flags CLOB CHECK(flags IS JSON),computed_at TIMESTAMP WITH TIME ZONE NOT NULL,published_at TIMESTAMP WITH TIME ZONE,changed_at TIMESTAMP WITH TIME ZONE NOT NULL,CONSTRAINT lp_kpi_assessment_pk PRIMARY KEY(assessment_id,user_id));
CREATE TABLE lp_runs(run_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,started_at TIMESTAMP WITH TIME ZONE NOT NULL,finished_at TIMESTAMP WITH TIME ZONE,status VARCHAR2(16) NOT NULL,files_loaded NUMBER DEFAULT 0,events_loaded NUMBER DEFAULT 0,rows_published NUMBER DEFAULT 0,error_text VARCHAR2(4000));
CREATE TABLE lp_secrets(name VARCHAR2(128) PRIMARY KEY,value CLOB NOT NULL);
-- No direct grants on lp_secrets: only definer-rights packages lp_dims/lp_publish read their named values.
