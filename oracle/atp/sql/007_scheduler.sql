-- Oracle docs: "DBMS_SCHEDULER" calendaring syntax; start date pins the daily job to Asia/Kolkata.
CREATE OR REPLACE PROCEDURE lp_run_now AUTHID DEFINER AS v_run NUMBER;v_since TIMESTAMP WITH TIME ZONE;
BEGIN
  INSERT INTO lp_runs(started_at,status) VALUES(SYSTIMESTAMP,'RUNNING') RETURNING run_id INTO v_run;COMMIT;
  SELECT NVL(MAX(started_at),TO_TIMESTAMP_TZ('1970-01-01 00:00:00 UTC','YYYY-MM-DD HH24:MI:SS TZR')) INTO v_since FROM lp_runs WHERE status='OK' AND run_id<v_run;
  lp_ingest.load_new_files('raw/activity/');
  lp_dims.refresh();
  lp_kpi.compute_changed(v_since);
  lp_publish.push_changed();
  UPDATE lp_runs SET finished_at=SYSTIMESTAMP,status='OK' WHERE run_id=v_run;COMMIT;
EXCEPTION WHEN OTHERS THEN UPDATE lp_runs SET finished_at=SYSTIMESTAMP,status='ERROR',error_text=SUBSTR(SQLERRM,1,4000) WHERE run_id=v_run;COMMIT;RAISE;
END;
/
BEGIN
  DBMS_SCHEDULER.CREATE_JOB(job_name=>'LP_NIGHTLY',job_type=>'STORED_PROCEDURE',job_action=>'LP_RUN_NOW',
    start_date=>FROM_TZ(TIMESTAMP '2026-11-24 01:30:00','Asia/Kolkata'),repeat_interval=>'FREQ=DAILY;BYHOUR=1;BYMINUTE=30;BYSECOND=0',enabled=>TRUE,comments=>'Nightly activity KPIs to Supabase');
END;
/
