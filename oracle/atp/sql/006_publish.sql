-- Oracle docs: "Call Web Services from Autonomous AI Database" / "SEND_REQUEST Function and Procedure".
-- Supabase's service-role bearer and apikey headers are read only from lp_secrets in this definer-rights package.
CREATE OR REPLACE PACKAGE lp_publish AUTHID DEFINER AS PROCEDURE push_changed; END lp_publish;
/
CREATE OR REPLACE PACKAGE BODY lp_publish AS
  FUNCTION secret(p_name VARCHAR2) RETURN VARCHAR2 IS v VARCHAR2(4000); BEGIN SELECT DBMS_LOB.SUBSTR(value,4000,1) INTO v FROM lp_secrets WHERE name=p_name; RETURN v; END;
  FUNCTION blob_of(p_text CLOB) RETURN BLOB IS b BLOB; d INTEGER:=1;s INTEGER:=1;c INTEGER;ctx INTEGER:=DBMS_LOB.DEFAULT_LANG_CTX; BEGIN DBMS_LOB.CREATETEMPORARY(b,TRUE);DBMS_LOB.CONVERTTOBLOB(b,p_text,DBMS_LOB.LOBMAXSIZE,d,s,0,ctx,c);RETURN b;END;
  PROCEDURE send_batch(p_table VARCHAR2,p_conflict VARCHAR2,p_body CLOB,p_key VARCHAR2,p_base VARCHAR2,p_run NUMBER,p_count NUMBER) IS
    v_resp DBMS_CLOUD_TYPES.RESP;v_status NUMBER;v_text CLOB;v_uri VARCHAR2(3000);
  BEGIN
    v_uri:=p_base||'/'||p_table||'?on_conflict='||p_conflict;
    v_resp:=DBMS_CLOUD.SEND_REQUEST(credential_name=>NULL,uri=>v_uri,method=>DBMS_CLOUD.METHOD_POST,
      headers=>JSON_OBJECT('apikey' VALUE p_key,'Authorization' VALUE 'Bearer '||p_key,'Content-Type' VALUE 'application/json','Prefer' VALUE 'resolution=merge-duplicates,return=minimal'),body=>blob_of(p_body));
    v_status:=DBMS_CLOUD.GET_RESPONSE_STATUS_CODE(v_resp);
    IF v_status<200 OR v_status>=300 THEN
      v_text:=DBMS_CLOUD.GET_RESPONSE_TEXT(v_resp);
      UPDATE lp_runs SET status='ERROR',error_text=SUBSTR('PostgREST '||p_table||' HTTP '||v_status||': '||REPLACE(DBMS_LOB.SUBSTR(v_text,500,1),p_key,'[REDACTED]'),1,4000),finished_at=SYSTIMESTAMP WHERE run_id=p_run;
      COMMIT;RAISE_APPLICATION_ERROR(-20061,'PostgREST publication failed for '||p_table||' with HTTP '||v_status);
    END IF;
    IF p_table='kpi_student_daily' THEN
      UPDATE lp_kpi_student_daily t SET published_at=SYSTIMESTAMP WHERE (t.user_id,t.day) IN (SELECT user_id,TO_DATE(day_text,'YYYY-MM-DD') FROM JSON_TABLE(p_body,'$[*]' COLUMNS(user_id VARCHAR2(36) PATH '$.user_id',day_text VARCHAR2(10) PATH '$.day')));
    ELSIF p_table='kpi_student_topic' THEN
      UPDATE lp_kpi_student_topic t SET published_at=SYSTIMESTAMP WHERE (t.user_id,t.topic) IN (SELECT user_id,topic FROM JSON_TABLE(p_body,'$[*]' COLUMNS(user_id VARCHAR2(36) PATH '$.user_id',topic VARCHAR2(128) PATH '$.topic')));
    ELSE
      UPDATE lp_kpi_assessment t SET published_at=SYSTIMESTAMP WHERE (t.assessment_id,t.user_id) IN (SELECT assessment_id,user_id FROM JSON_TABLE(p_body,'$[*]' COLUMNS(assessment_id VARCHAR2(36) PATH '$.assessment_id',user_id VARCHAR2(36) PATH '$.user_id')));
    END IF;
    UPDATE lp_runs SET rows_published=rows_published+p_count WHERE run_id=p_run;COMMIT;
  END;
  PROCEDURE push_table(p_table VARCHAR2,p_conflict VARCHAR2,p_query VARCHAR2,p_key VARCHAR2,p_base VARCHAR2,p_run NUMBER,p_key_kind NUMBER) IS
    v_body CLOB;v_count NUMBER;
  BEGIN
    LOOP
      EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM (SELECT 1 FROM '||p_table||' WHERE (published_at IS NULL OR changed_at>published_at) AND ROWNUM<=500)' INTO v_count;
      IF v_count=0 THEN EXIT;END IF;
      EXECUTE IMMEDIATE p_query INTO v_body;
      IF v_body IS NULL OR DBMS_LOB.GETLENGTH(v_body)=0 THEN EXIT;END IF;
      SELECT COUNT(*) INTO v_count FROM JSON_TABLE(v_body,'$[*]' COLUMNS(x NUMBER PATH '$.score' NULL ON ERROR));
      -- For daily/topic rows score is absent; JSON_TABLE row count is used by the batch publication update.
      IF v_count=0 THEN SELECT COUNT(*) INTO v_count FROM JSON_TABLE(v_body,'$[*]' COLUMNS(x VARCHAR2(36) PATH '$.user_id')); END IF;
      send_batch(p_table,p_conflict,v_body,p_key,p_base,p_run,v_count);
    END LOOP;
  END;
  PROCEDURE push_changed IS v_key VARCHAR2(4000):=secret('SUPABASE_SERVICE_KEY');v_base VARCHAR2(2000):=secret('SUPABASE_REST_URL');v_run NUMBER;
  BEGIN
    INSERT INTO lp_runs(started_at,status) VALUES(SYSTIMESTAMP,'RUNNING') RETURNING run_id INTO v_run;COMMIT;
    push_table('kpi_student_daily','user_id,day',
      q'[SELECT JSON_ARRAYAGG(row_json FORMAT JSON RETURNING CLOB) FROM (SELECT row_json FROM (SELECT JSON_OBJECT('organization_id' VALUE organization_id,'user_id' VALUE user_id,'day' VALUE TO_CHAR(day,'YYYY-MM-DD'),'active_minutes' VALUE active_minutes,'questions_attempted' VALUE questions_attempted,'questions_solved' VALUE questions_solved,'runs' VALUE runs,'submits' VALUE submits,'accepted_submits' VALUE accepted_submits,'typed_chars' VALUE typed_chars,'paste_chars' VALUE paste_chars,'paste_ratio' VALUE paste_ratio,'focus_lost_count' VALUE focus_lost_count,'idle_minutes' VALUE idle_minutes,'computed_at' VALUE TO_CHAR(computed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') RETURNING CLOB) row_json,changed_at FROM lp_kpi_student_daily WHERE published_at IS NULL OR changed_at>published_at ORDER BY changed_at) WHERE ROWNUM<=500)]',v_key,v_base,v_run,1);
    push_table('kpi_student_topic','user_id,topic',
      q'[SELECT JSON_ARRAYAGG(row_json FORMAT JSON RETURNING CLOB) FROM (SELECT row_json FROM (SELECT JSON_OBJECT('organization_id' VALUE organization_id,'user_id' VALUE user_id,'topic' VALUE topic,'attempted' VALUE attempted,'solved' VALUE solved,'mastery' VALUE mastery,'computed_at' VALUE TO_CHAR(computed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') RETURNING CLOB) row_json,changed_at FROM lp_kpi_student_topic WHERE published_at IS NULL OR changed_at>published_at ORDER BY changed_at) WHERE ROWNUM<=500)]',v_key,v_base,v_run,2);
    push_table('kpi_assessment','assessment_id,user_id',
      q'[SELECT JSON_ARRAYAGG(row_json FORMAT JSON RETURNING CLOB) FROM (SELECT row_json FROM (SELECT JSON_OBJECT('organization_id' VALUE organization_id,'assessment_id' VALUE assessment_id,'user_id' VALUE user_id,'score' VALUE score,'solved' VALUE solved,'total_questions' VALUE total_questions,'time_minutes' VALUE time_minutes,'flags' VALUE flags FORMAT JSON,'computed_at' VALUE TO_CHAR(computed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') RETURNING CLOB) row_json,changed_at FROM lp_kpi_assessment WHERE published_at IS NULL OR changed_at>published_at ORDER BY changed_at) WHERE ROWNUM<=500)]',v_key,v_base,v_run,3);
    UPDATE lp_runs SET finished_at=SYSTIMESTAMP,status='OK' WHERE run_id=v_run;COMMIT;
  EXCEPTION WHEN OTHERS THEN DECLARE v_err VARCHAR2(4000):=SUBSTR(SQLERRM,1,4000); BEGIN UPDATE lp_runs SET finished_at=SYSTIMESTAMP,status='ERROR',error_text=v_err WHERE run_id=v_run;COMMIT; END; RAISE;
  END;
END lp_publish;
/
