-- Oracle docs: "Call Web Services from Autonomous AI Database" and "SEND_REQUEST Function and Procedure".
-- Pages are fetched through PostgREST with one 1000-row Range window per request.
CREATE OR REPLACE PACKAGE lp_dims AUTHID DEFINER AS PROCEDURE refresh; END lp_dims;
/
CREATE OR REPLACE PACKAGE BODY lp_dims AS
  FUNCTION secret(p_name VARCHAR2) RETURN VARCHAR2 IS v VARCHAR2(4000);
  BEGIN SELECT DBMS_LOB.SUBSTR(value,4000,1) INTO v FROM lp_secrets WHERE name=p_name; RETURN v; END;
  PROCEDURE refresh IS
    v_base VARCHAR2(2000):=secret('SUPABASE_REST_URL'); v_key VARCHAR2(4000):=secret('SUPABASE_SERVICE_KEY');
    v_resp DBMS_CLOUD_TYPES.RESP; v_body CLOB; v_count NUMBER; v_from NUMBER; v_to NUMBER;
  BEGIN
    FOR tab IN (SELECT 'questions' table_name,'id,topics,points' columns FROM dual UNION ALL SELECT 'assessments','id,organization_id,question_ids' FROM dual) LOOP
      v_from:=0;
      LOOP
        v_to:=v_from+999;
        v_resp:=DBMS_CLOUD.SEND_REQUEST(credential_name=>NULL,uri=>v_base||'/'||tab.table_name||'?select='||tab.columns,method=>DBMS_CLOUD.METHOD_GET,
          headers=>JSON_OBJECT('apikey' VALUE v_key,'Authorization' VALUE 'Bearer '||v_key,'Range' VALUE v_from||'-'||v_to,'Range-Unit' VALUE 'items'));
        v_body:=DBMS_CLOUD.GET_RESPONSE_TEXT(v_resp);
        IF DBMS_CLOUD.GET_RESPONSE_STATUS_CODE(v_resp)<200 OR DBMS_CLOUD.GET_RESPONSE_STATUS_CODE(v_resp)>=300 THEN RAISE_APPLICATION_ERROR(-20041,'Supabase dimension fetch failed: HTTP '||DBMS_CLOUD.GET_RESPONSE_STATUS_CODE(v_resp)); END IF;
        IF tab.table_name='questions' THEN
          MERGE INTO lp_dim_question d USING (SELECT question_id,topics,points FROM JSON_TABLE(v_body,'$[*]' COLUMNS(question_id VARCHAR2(36) PATH '$.id',topics CLOB FORMAT JSON PATH '$.topics',points NUMBER PATH '$.points')) WHERE question_id IS NOT NULL) s ON(d.question_id=s.question_id)
          WHEN MATCHED THEN UPDATE SET d.topics=s.topics,d.points=s.points WHEN NOT MATCHED THEN INSERT(question_id,topics,points) VALUES(s.question_id,s.topics,s.points);
        ELSE
          MERGE INTO lp_dim_assessment d USING (SELECT assessment_id,organization_id,question_ids FROM JSON_TABLE(v_body,'$[*]' COLUMNS(assessment_id VARCHAR2(36) PATH '$.id',organization_id VARCHAR2(36) PATH '$.organization_id',question_ids CLOB FORMAT JSON PATH '$.question_ids')) WHERE assessment_id IS NOT NULL) s ON(d.assessment_id=s.assessment_id)
          WHEN MATCHED THEN UPDATE SET d.organization_id=s.organization_id,d.question_ids=s.question_ids WHEN NOT MATCHED THEN INSERT(assessment_id,organization_id,question_ids) VALUES(s.assessment_id,s.organization_id,s.question_ids);
        END IF;
        SELECT COUNT(*) INTO v_count FROM JSON_TABLE(v_body,'$[*]' COLUMNS(x NUMBER PATH '$.id' NULL ON ERROR));
        EXIT WHEN v_count<1000;v_from:=v_from+1000;
      END LOOP;
    END LOOP;
    COMMIT;
  END;
END lp_dims;
/
