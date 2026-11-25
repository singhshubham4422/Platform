-- C11 SQL mirrors packages/kpi-calc: UTC dates, seq ordering, 120-second cap, idle second-event exclusion,
-- one final ROUND, distinct questions and eventId primary-key de-duplication.
CREATE OR REPLACE PACKAGE lp_kpi AUTHID DEFINER AS PROCEDURE compute_changed(p_since TIMESTAMP WITH TIME ZONE); END lp_kpi;
/
CREATE OR REPLACE PACKAGE BODY lp_kpi AS
  PROCEDURE compute_changed(p_since TIMESTAMP WITH TIME ZONE) IS
  BEGIN
    FOR s IN (SELECT DISTINCT user_id,TRUNC(CAST(client_ts AT TIME ZONE 'UTC' AS DATE)) day FROM lp_stg_activity WHERE loaded_at>=p_since) LOOP
      DELETE FROM lp_kpi_student_daily WHERE user_id=s.user_id AND day=s.day;
      INSERT INTO lp_kpi_student_daily(organization_id,user_id,day,active_minutes,questions_attempted,questions_solved,runs,submits,accepted_submits,typed_chars,paste_chars,paste_ratio,focus_lost_count,idle_minutes,computed_at,changed_at)
      WITH e AS (SELECT a.*,TRUNC(CAST(client_ts AT TIME ZONE 'UTC' AS DATE)) utc_day,LAG(client_ts) OVER(PARTITION BY user_id,TRUNC(CAST(client_ts AT TIME ZONE 'UTC' AS DATE)) ORDER BY seq) prev_ts,LAG(event_type) OVER(PARTITION BY user_id,TRUNC(CAST(client_ts AT TIME ZONE 'UTC' AS DATE)) ORDER BY seq) prev_type FROM lp_stg_activity a WHERE user_id=s.user_id AND TRUNC(CAST(client_ts AT TIME ZONE 'UTC' AS DATE))=s.day)
      SELECT MIN(organization_id),user_id,utc_day,ROUND(SUM(CASE WHEN prev_ts IS NULL OR event_type='idle_period' THEN 0 ELSE LEAST(120,GREATEST(0,EXTRACT(DAY FROM(client_ts-prev_ts))*86400+EXTRACT(HOUR FROM(client_ts-prev_ts))*3600+EXTRACT(MINUTE FROM(client_ts-prev_ts))*60+EXTRACT(SECOND FROM(client_ts-prev_ts)))) END)/60,1),
        COUNT(DISTINCT CASE WHEN event_type='submission_created' THEN question_id END),COUNT(DISTINCT CASE WHEN event_type='submission_created' AND JSON_VALUE(metadata,'$.verdict')='ACCEPTED' THEN question_id END),
        SUM(CASE WHEN event_type='execution_completed' AND JSON_VALUE(metadata,'$.mode')='RUN' THEN 1 ELSE 0 END),SUM(CASE WHEN event_type='submission_created' THEN 1 ELSE 0 END),SUM(CASE WHEN event_type='submission_created' AND JSON_VALUE(metadata,'$.verdict')='ACCEPTED' THEN 1 ELSE 0 END),
        SUM(CASE WHEN event_type='code_changed' THEN NVL(JSON_VALUE(metadata,'$.insertedChars' RETURNING NUMBER),0) ELSE 0 END),SUM(CASE WHEN event_type='paste_detected' AND JSON_VALUE(metadata,'$.source')='external' THEN NVL(JSON_VALUE(metadata,'$.pastedChars' RETURNING NUMBER),0) ELSE 0 END),
        ROUND(NVL(SUM(CASE WHEN event_type='paste_detected' AND JSON_VALUE(metadata,'$.source')='external' THEN NVL(JSON_VALUE(metadata,'$.pastedChars' RETURNING NUMBER),0) ELSE 0 END)/NULLIF(SUM(CASE WHEN event_type='paste_detected' AND JSON_VALUE(metadata,'$.source')='external' THEN NVL(JSON_VALUE(metadata,'$.pastedChars' RETURNING NUMBER),0) ELSE 0 END)+SUM(CASE WHEN event_type='code_changed' THEN NVL(JSON_VALUE(metadata,'$.insertedChars' RETURNING NUMBER),0) ELSE 0 END),0),0),3),
        SUM(CASE WHEN event_type='window_focus_lost' THEN 1 ELSE 0 END),ROUND(SUM(CASE WHEN event_type='idle_period' THEN NVL(JSON_VALUE(metadata,'$.idleMs' RETURNING NUMBER),0) ELSE 0 END)/60000,1),SYSTIMESTAMP,SYSTIMESTAMP FROM e GROUP BY user_id,utc_day;
    END LOOP;
    FOR u IN (SELECT DISTINCT user_id FROM lp_stg_activity WHERE loaded_at>=p_since) LOOP
      DELETE FROM lp_kpi_student_topic WHERE user_id=u.user_id;
      INSERT INTO lp_kpi_student_topic(organization_id,user_id,topic,attempted,solved,mastery,computed_at,changed_at)
      WITH q AS (SELECT user_id,MIN(organization_id) organization_id,question_id,MAX(CASE WHEN JSON_VALUE(metadata,'$.verdict')='ACCEPTED' THEN 1 ELSE 0 END) solved FROM lp_stg_activity WHERE user_id=u.user_id AND event_type='submission_created' AND question_id IS NOT NULL GROUP BY user_id,question_id)
      SELECT MIN(q.organization_id),q.user_id,t.topic,COUNT(*),SUM(q.solved),LEAST(100,GREATEST(0,ROUND(100*(SUM(q.solved)+1)/(COUNT(*)+2)))),SYSTIMESTAMP,SYSTIMESTAMP FROM q JOIN lp_dim_question d ON d.question_id=q.question_id CROSS APPLY JSON_TABLE(d.topics,'$[*]' COLUMNS(topic VARCHAR2(128) PATH '$')) t GROUP BY q.user_id,t.topic;
    END LOOP;
    FOR a IN (SELECT DISTINCT user_id,assessment_id FROM lp_stg_activity WHERE loaded_at>=p_since AND assessment_id IS NOT NULL) LOOP
      DELETE FROM lp_kpi_assessment WHERE user_id=a.user_id AND assessment_id=a.assessment_id;
      INSERT INTO lp_kpi_assessment(organization_id,user_id,assessment_id,score,solved,total_questions,time_minutes,flags,computed_at,changed_at)
      WITH e AS (SELECT x.*,LAG(client_ts) OVER(ORDER BY seq) prev_ts FROM lp_stg_activity x WHERE user_id=a.user_id AND assessment_id=a.assessment_id),
        q AS (SELECT question_id,MAX(CASE WHEN JSON_VALUE(metadata,'$.verdict')='ACCEPTED' THEN 1 ELSE 0 END) solved FROM e WHERE event_type='submission_created' AND question_id IS NOT NULL GROUP BY question_id),
        active AS (SELECT ROUND(SUM(CASE WHEN prev_ts IS NULL OR event_type='idle_period' THEN 0 ELSE LEAST(120,GREATEST(0,EXTRACT(DAY FROM(client_ts-prev_ts))*86400+EXTRACT(HOUR FROM(client_ts-prev_ts))*3600+EXTRACT(MINUTE FROM(client_ts-prev_ts))*60+EXTRACT(SECOND FROM(client_ts-prev_ts)))) END)/60,1) minutes FROM e),
        flags AS (SELECT ROUND(NVL(SUM(CASE WHEN event_type='paste_detected' AND JSON_VALUE(metadata,'$.source')='external' THEN NVL(JSON_VALUE(metadata,'$.pastedChars' RETURNING NUMBER),0) ELSE 0 END)/NULLIF(SUM(CASE WHEN event_type='paste_detected' AND JSON_VALUE(metadata,'$.source')='external' THEN NVL(JSON_VALUE(metadata,'$.pastedChars' RETURNING NUMBER),0) ELSE 0 END)+SUM(CASE WHEN event_type='code_changed' THEN NVL(JSON_VALUE(metadata,'$.insertedChars' RETURNING NUMBER),0) ELSE 0 END),0),0),3) paste_ratio,
          SUM(CASE WHEN event_type='paste_detected' AND JSON_VALUE(metadata,'$.source')='external' THEN NVL(JSON_VALUE(metadata,'$.pastedChars' RETURNING NUMBER),0) ELSE 0 END) paste_chars,SUM(CASE WHEN event_type='window_focus_lost' THEN 1 ELSE 0 END) focus_lost FROM e),
        typed AS (SELECT question_id,SUM(NVL(JSON_VALUE(metadata,'$.insertedChars' RETURNING NUMBER),0)) typed_chars FROM e WHERE event_type='code_changed' GROUP BY question_id),
        opened AS (SELECT question_id,MIN(client_ts) KEEP (DENSE_RANK FIRST ORDER BY seq) client_ts FROM e WHERE event_type='question_opened' AND question_id IS NOT NULL GROUP BY question_id),
        -- FAST_SOLVE compares with the FIRST question_opened (by seq), matching packages/kpi-calc.
        fast AS (SELECT COUNT(*) n FROM e sub JOIN opened op ON op.question_id=sub.question_id LEFT JOIN typed t ON t.question_id=sub.question_id WHERE sub.event_type='submission_created' AND JSON_VALUE(sub.metadata,'$.verdict')='ACCEPTED' AND NVL(t.typed_chars,0)<50 AND sub.client_ts>=op.client_ts AND EXTRACT(DAY FROM(sub.client_ts-op.client_ts))*86400+EXTRACT(HOUR FROM(sub.client_ts-op.client_ts))*3600+EXTRACT(MINUTE FROM(sub.client_ts-op.client_ts))*60+EXTRACT(SECOND FROM(sub.client_ts-op.client_ts))<60),
        total AS (SELECT COUNT(*) n FROM lp_dim_assessment x CROSS APPLY JSON_TABLE(x.question_ids,'$[*]' COLUMNS(qid VARCHAR2(36) PATH '$')) WHERE x.assessment_id=a.assessment_id)
      SELECT d.organization_id,a.user_id,a.assessment_id,NVL(SUM(CASE WHEN q.solved=1 THEN dq.points ELSE 0 END),0),NVL(SUM(q.solved),0),t.n,active.minutes,
        JSON_ARRAY(CASE WHEN f.paste_ratio>.5 AND f.paste_chars>200 THEN 'HIGH_PASTE' END,CASE WHEN fast.n>0 THEN 'FAST_SOLVE' END,CASE WHEN f.focus_lost>20 THEN 'MANY_FOCUS_LOSS' END ABSENT ON NULL RETURNING CLOB),SYSTIMESTAMP,SYSTIMESTAMP
      FROM lp_dim_assessment d CROSS JOIN total t CROSS JOIN active CROSS JOIN flags f CROSS JOIN fast LEFT JOIN q ON 1=1 LEFT JOIN lp_dim_question dq ON dq.question_id=q.question_id
      WHERE d.assessment_id=a.assessment_id GROUP BY d.organization_id,t.n,active.minutes,f.paste_ratio,f.paste_chars,f.focus_lost,fast.n;
    END LOOP;
    COMMIT;
  END;
END lp_kpi;
/
