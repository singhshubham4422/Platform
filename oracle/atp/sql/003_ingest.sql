-- DBMS_CLOUD.COPY_DATA with JSON columnpath and compression=gzip; COPY_DATA streams one file
-- into a disposable per-file load table, then MERGE makes event_id idempotent.
-- Oracle docs: "Load Data into Autonomous AI Database from Oracle Cloud Infrastructure Object Storage"
-- and "DBMS_CLOUD Package Format Options" (JSON compression and columnpath).
CREATE OR REPLACE PACKAGE lp_ingest AUTHID DEFINER AS
  PROCEDURE load_new_files(p_prefix VARCHAR2 DEFAULT 'raw/activity/');
END lp_ingest;
/
CREATE OR REPLACE PACKAGE BODY lp_ingest AS
  FUNCTION secret(p_name VARCHAR2) RETURN VARCHAR2 IS v VARCHAR2(4000);
  BEGIN SELECT DBMS_LOB.SUBSTR(value,4000,1) INTO v FROM lp_secrets WHERE name=p_name; RETURN v; END;
  PROCEDURE load_new_files(p_prefix VARCHAR2 DEFAULT 'raw/activity/') IS
    v_uri VARCHAR2(4000):=secret('OCI_ACTIVITY_URI'); v_cred VARCHAR2(128):=secret('OCI_CREDENTIAL_NAME'); v_run NUMBER; v_rows NUMBER;
  BEGIN
    INSERT INTO lp_runs(started_at,status) VALUES(SYSTIMESTAMP,'RUNNING') RETURNING run_id INTO v_run;
    FOR o IN (SELECT object_name,etag FROM DBMS_CLOUD.LIST_OBJECTS(v_cred,v_uri) WHERE object_name LIKE p_prefix||'%') LOOP
      DECLARE v_object VARCHAR2(1024):=o.object_name; v_count NUMBER:=0;
      BEGIN
        SELECT COUNT(*) INTO v_count FROM lp_ingested_files WHERE object_name=v_object;
        IF v_count=0 THEN
          DELETE FROM lp_load_activity;
          DBMS_CLOUD.COPY_DATA(
            table_name=>'LP_LOAD_ACTIVITY', credential_name=>v_cred,
            file_uri_list=>v_uri||v_object,
            format=>JSON_OBJECT('type' VALUE 'json','compression' VALUE 'gzip',
              'columnpath' VALUE ' ["$.eventId","$.seq","$.eventType","$.clientTs","$.userId","$.organizationId","$.deviceId","$.packId","$.questionId","$.assessmentId","$.attemptId","$.language","$.metadata"] ')
          );
          MERGE INTO lp_stg_activity t USING (
            SELECT event_id,seq,event_type,TO_TIMESTAMP_TZ(client_ts,'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') client_ts,user_id,organization_id,device_id,pack_id,question_id,assessment_id,attempt_id,language,metadata
            FROM (SELECT s.*,ROW_NUMBER() OVER(PARTITION BY event_id ORDER BY seq) rn FROM lp_load_activity s
              WHERE event_id IS NOT NULL AND user_id IS NOT NULL AND event_type IS NOT NULL AND TRIM(event_type) IS NOT NULL AND seq IS NOT NULL
                AND VALIDATE_CONVERSION(client_ts AS TIMESTAMP WITH TIME ZONE,'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')=1)
            WHERE rn=1
          ) s ON(t.event_id=s.event_id)
          WHEN MATCHED THEN UPDATE SET t.seq=s.seq,t.event_type=s.event_type,t.client_ts=s.client_ts,t.user_id=s.user_id,t.organization_id=s.organization_id,t.device_id=s.device_id,t.pack_id=s.pack_id,t.question_id=s.question_id,t.assessment_id=s.assessment_id,t.attempt_id=s.attempt_id,t.language=s.language,t.metadata=s.metadata,t.object_name=v_object,t.loaded_at=SYSTIMESTAMP WHERE s.seq<t.seq
          WHEN NOT MATCHED THEN INSERT(event_id,seq,event_type,client_ts,user_id,organization_id,device_id,pack_id,question_id,assessment_id,attempt_id,language,metadata,object_name,loaded_at)
          VALUES(s.event_id,s.seq,s.event_type,s.client_ts,s.user_id,s.organization_id,s.device_id,s.pack_id,s.question_id,s.assessment_id,s.attempt_id,s.language,s.metadata,v_object,SYSTIMESTAMP);
          v_rows:=SQL%ROWCOUNT;
          INSERT INTO lp_ingested_files(object_name,etag,loaded_at,row_count) VALUES(v_object,o.etag,SYSTIMESTAMP,v_rows);
          UPDATE lp_runs SET files_loaded=files_loaded+1,events_loaded=events_loaded+v_rows WHERE run_id=v_run;
          COMMIT;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        ROLLBACK;
        INSERT INTO lp_runs(started_at,finished_at,status,error_text) VALUES(SYSTIMESTAMP,SYSTIMESTAMP,'ERROR',SUBSTR('Object '||v_object||': '||SQLERRM,1,4000));
        COMMIT;
      END;
    END LOOP;
    UPDATE lp_runs SET finished_at=SYSTIMESTAMP,status='OK' WHERE run_id=v_run;COMMIT;
  EXCEPTION WHEN OTHERS THEN ROLLBACK;RAISE;
  END;
END lp_ingest;
/
