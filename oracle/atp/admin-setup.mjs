// One-time (re-runnable) setup of the KPI pipeline in an Autonomous Database, run by the owner.
//
//   node oracle/atp/admin-setup.mjs --connect "<walletless TLS connect string>" --supabase-host <ref>.supabase.co
//          --activity-uri https://objectstorage.<region>.oraclecloud.com/n/<ns>/b/<bucket>/o/
//
// The ADMIN password and the Supabase service-role key are typed at hidden prompts; they are never
// printed, logged or written to disk. Steps:
//   1. schema-only users LPKPI and LPKPI_VERIFY (NO AUTHENTICATION: nobody can log in as them)
//   2. resource principal for LPKPI (no OCI key stored; needs the IAM dynamic group + read policy)
//   3. outbound HTTPS ACL to the Supabase host only
//   4. tables and packages (sql/002-006) in LPKPI, nightly job LPKPI.LP_NIGHTLY (01:30 Asia/Kolkata)
//   5. verification: the same SQL in LPKPI_VERIFY against oracle/atp/fixtures, compared with packages/kpi-calc
//   6. lp_secrets values, then one live run (bucket listing, Supabase dimension fetch, publish)
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
for (const k of ['connect', 'supabase-host', 'activity-uri']) if (!args[k]) { console.error(`Missing --${k}`); process.exit(2); }
if (!/^[a-z0-9]+\.supabase\.co$/.test(args['supabase-host'])) { console.error('--supabase-host must look like <ref>.supabase.co'); process.exit(2); }
if (!/^https:\/\/objectstorage\.[a-z0-9-]+\.oraclecloud\.com\/n\/[^/]+\/b\/[^/]+\/o\/$/.test(args['activity-uri'])) { console.error('--activity-uri must be the bucket object base URL ending in /o/'); process.exit(2); }

const oracledb = (await import(pathToFileURL(path.join(here, 'node_modules/oracledb/index.js')).href)).default;
oracledb.fetchAsString = [oracledb.CLOB];

function hidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin; let value = '';
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode?.(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); resolve(value); return; }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1); else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** Splits a SQL file into statements: PL/SQL units end with a line holding only "/", others with ";". */
export function splitSql(text) {
  const out = []; let buf = []; let plsql = false;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const t = line.trim();
    if (!buf.length && (t === '' || t.startsWith('--'))) continue;
    if (!buf.length && /^(CREATE\s+OR\s+REPLACE\s+(PACKAGE|PROCEDURE|FUNCTION|TRIGGER)|BEGIN|DECLARE)\b/i.test(t)) plsql = true;
    if (plsql && t === '/') { out.push(buf.join('\n').trim()); buf = []; plsql = false; continue; }
    buf.push(line);
    if (!plsql && /;\s*(--.*)?$/.test(t)) { out.push(buf.join('\n').trim().replace(/;\s*(--.*)?$/, '')); buf = []; }
  }
  if (buf.join('').trim()) out.push(buf.join('\n').trim());
  return out;
}

const step = (msg) => console.log(`\n== ${msg}`);
const ok = (msg) => console.log(`   OK   ${msg}`);
const exists = async (c, sql, binds) => (await c.execute(sql, binds)).rows[0][0] > 0;
const ignore = (codes) => async (p) => { try { await p; } catch (e) { if (!codes.some((code) => String(e.message).includes(code))) throw e; } };

const password = await hidden('ADMIN password for the database (hidden): ');
const conn = await oracledb.getConnection({ user: 'ADMIN', password, connectString: args.connect });
ok('connected as ADMIN');

try {
  step('1. schema-only users');
  for (const u of ['LPKPI', 'LPKPI_VERIFY']) {
    if (!(await exists(conn, 'SELECT COUNT(*) FROM dba_users WHERE username = :u', [u]))) { await conn.execute(`CREATE USER ${u} NO AUTHENTICATION`); ok(`created ${u}`); } else ok(`${u} exists`);
    await conn.execute(`ALTER USER ${u} QUOTA 2G ON DATA`);
    await conn.execute(`GRANT CREATE TABLE, CREATE PROCEDURE, CREATE VIEW, CREATE SEQUENCE TO ${u}`);
    await conn.execute(`GRANT EXECUTE ON DBMS_CLOUD TO ${u}`);
    await ignore(['ORA-04042', 'ORA-00942'])(conn.execute(`GRANT EXECUTE ON DBMS_CLOUD_TYPES TO ${u}`));
  }
  await conn.execute('GRANT CREATE JOB TO LPKPI');
  ok('privileges granted');

  step('2. resource principal (no stored OCI key)');
  await ignore(['ORA-20010', 'already'])(conn.execute('BEGIN DBMS_CLOUD_ADMIN.ENABLE_RESOURCE_PRINCIPAL(); END;'));
  await conn.execute("BEGIN DBMS_CLOUD_ADMIN.ENABLE_RESOURCE_PRINCIPAL(username => 'LPKPI'); END;");
  ok('OCI$RESOURCE_PRINCIPAL enabled for LPKPI');

  step('3. outbound HTTPS to Supabase only');
  await conn.execute(`BEGIN DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(host => :h, lower_port => 443, upper_port => 443,
    ace => XS$ACE_TYPE(privilege_list => XS$NAME_LIST('http'), principal_name => 'LPKPI', principal_type => XS_ACL.PTYPE_DB)); END;`, { h: args['supabase-host'] });
  ok(`ACL: LPKPI -> https://${args['supabase-host']}`);

  const sql = (f) => splitSql(readFileSync(path.join(here, 'sql', f), 'utf8'));
  const install = async (schema, files) => {
    await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${schema}`);
    for (const f of files) {
      if (f === '002_tables.sql' && (await exists(conn, "SELECT COUNT(*) FROM all_tables WHERE owner = :o AND table_name = 'LP_RUNS'", [schema]))) { ok(`${schema}: tables exist`); continue; }
      for (const s of sql(f)) await conn.execute(s);
      ok(`${schema}: ${f}`);
    }
    const bad = (await conn.execute("SELECT object_name || ' ' || object_type FROM all_objects WHERE owner = :o AND status <> 'VALID'", [schema])).rows.map((r) => r[0]);
    if (bad.length) {
      const errs = (await conn.execute('SELECT name, line, text FROM all_errors WHERE owner = :o ORDER BY name, sequence', [schema])).rows.slice(0, 10);
      throw new Error(`${schema}: invalid objects ${bad.join(', ')}\n${errs.map((e) => `   ${e[0]}:${e[1]} ${e[2]}`).join('\n')}`);
    }
    ok(`${schema}: all objects VALID`);
  };

  step('4. LPKPI tables, packages and nightly job');
  await install('LPKPI', ['002_tables.sql', '003_ingest.sql', '004_dimensions.sql', '005_kpi.sql', '006_publish.sql']);
  const sched = readFileSync(path.join(here, 'sql/007_scheduler.sql'), 'utf8');
  const [runNow] = splitSql(sched);
  await conn.execute(runNow);
  await ignore(['ORA-27475'])(conn.execute("BEGIN DBMS_SCHEDULER.DROP_JOB('LPKPI.LP_NIGHTLY'); END;"));
  await conn.execute(`BEGIN DBMS_SCHEDULER.CREATE_JOB(job_name => 'LPKPI.LP_NIGHTLY', job_type => 'STORED_PROCEDURE', job_action => 'LPKPI.LP_RUN_NOW',
    start_date => FROM_TZ(TIMESTAMP '2026-11-26 01:30:00', 'Asia/Kolkata'), repeat_interval => 'FREQ=DAILY;BYHOUR=1;BYMINUTE=30;BYSECOND=0',
    enabled => FALSE, comments => 'Nightly activity KPIs to Supabase'); END;`);
  ok('job LPKPI.LP_NIGHTLY created (enabled after the live run succeeds)');

  step('5. verify the KPI SQL against the reference calculator (LPKPI_VERIFY)');
  await install('LPKPI_VERIFY', ['002_tables.sql', '005_kpi.sql']);
  for (const t of ['lp_stg_activity', 'lp_dim_question', 'lp_dim_assessment', 'lp_kpi_student_daily', 'lp_kpi_student_topic', 'lp_kpi_assessment']) await conn.execute(`DELETE FROM ${t}`);
  const kpi = await import(pathToFileURL(path.join(here, '../../packages/kpi-calc/index.js')).href);
  const fx = path.join(here, 'fixtures');
  const raw = readdirSync(fx).filter((n) => n.startsWith('events-') && n.endsWith('.jsonl')).flatMap((f) => readFileSync(path.join(fx, f), 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)));
  const questions = JSON.parse(readFileSync(path.join(fx, 'questions.json'), 'utf8'));
  const assessments = JSON.parse(readFileSync(path.join(fx, 'assessments.json'), 'utf8'));
  for (const q of questions) await conn.execute('INSERT INTO lp_dim_question(question_id,topics,points) VALUES(:1,:2,:3)', [q.questionId, JSON.stringify(q.topics), q.points]);
  for (const a of assessments) await conn.execute('INSERT INTO lp_dim_assessment(assessment_id,organization_id,question_ids) VALUES(:1,:2,:3)', [a.assessmentId, a.organizationId, JSON.stringify(a.questionIds)]);
  for (const e of raw.filter((x) => x.userId && x.clientTs && x.eventType && x.eventId).sort((a, b) => a.seq - b.seq)) {
    await conn.execute(`MERGE INTO lp_stg_activity t USING (SELECT :id event_id FROM dual) s ON (t.event_id = s.event_id) WHEN NOT MATCHED THEN
      INSERT(event_id,seq,event_type,client_ts,user_id,organization_id,device_id,pack_id,question_id,assessment_id,attempt_id,language,metadata,object_name,loaded_at)
      VALUES(:id,:seq,:ty,FROM_TZ(TO_TIMESTAMP(:ts,'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),'UTC'),:u,:o,:d,:p,:q,:a,:at,:l,:m,'VERIFY_FIXTURE',SYSTIMESTAMP)`,
    { id: e.eventId, seq: Number(e.seq), ty: e.eventType, ts: e.clientTs, u: e.userId, o: e.organizationId ?? null, d: e.deviceId ?? null, p: e.packId ?? null, q: e.questionId ?? null, a: e.assessmentId ?? null, at: e.attemptId ?? null, l: e.language ?? null, m: JSON.stringify(e.metadata ?? {}) });
  }
  await conn.commit();
  await conn.execute("BEGIN lp_kpi.compute_changed(SYSTIMESTAMP - INTERVAL '1' DAY); END;");
  const events = kpi.normaliseEvents(raw);
  const qmap = new Map(questions.map((x) => [x.questionId, x])), amap = new Map(assessments.map((x) => [x.assessmentId, x]));
  const strip = (rows) => rows.map(({ computed_at, ...r }) => r);
  const want = { daily: strip(kpi.computeStudentDaily(events)), topic: strip(kpi.computeStudentTopic(events, qmap).rows), assessment: strip(kpi.computeAssessment(events, amap, qmap)) };
  const q = async (s) => (await conn.execute(s, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])));
  const got = {
    daily: await q("SELECT organization_id,user_id,TO_CHAR(day,'YYYY-MM-DD') day,active_minutes,questions_attempted,questions_solved,runs,submits,accepted_submits,typed_chars,paste_chars,paste_ratio,focus_lost_count,idle_minutes FROM lp_kpi_student_daily ORDER BY user_id,day"),
    topic: await q('SELECT organization_id,user_id,topic,attempted,solved,mastery FROM lp_kpi_student_topic ORDER BY user_id,topic'),
    assessment: (await q('SELECT organization_id,user_id,assessment_id,score,solved,total_questions,time_minutes,flags FROM lp_kpi_assessment ORDER BY assessment_id,user_id')).map((r) => ({ ...r, flags: JSON.parse(r.flags ?? '[]') })),
  };
  let mismatch = 0;
  for (const k of Object.keys(want)) {
    const a = JSON.stringify(got[k]), b = JSON.stringify(want[k]);
    if (a === b) ok(`${k}: ${got[k].length} rows identical to packages/kpi-calc`);
    else { mismatch++; console.log(`   FAIL ${k}\n     expected ${b}\n     actual   ${a}`); }
  }
  if (mismatch) throw new Error('KPI SQL does not match the reference calculator; the job stays disabled.');

  step('6. secrets and one live run (LPKPI)');
  await conn.execute('ALTER SESSION SET CURRENT_SCHEMA = LPKPI');
  const key = await hidden('Paste the Supabase service-role (secret) key (hidden): ');
  if (!key || key.length < 20) throw new Error('No key entered');
  const put = (name, value) => conn.execute('MERGE INTO lp_secrets t USING (SELECT :n name FROM dual) s ON (t.name = s.name) WHEN MATCHED THEN UPDATE SET value = :v WHEN NOT MATCHED THEN INSERT(name,value) VALUES(:n,:v)', { n: name, v: value });
  await put('OCI_CREDENTIAL_NAME', 'OCI$RESOURCE_PRINCIPAL');
  await put('OCI_ACTIVITY_URI', args['activity-uri']);
  await put('SUPABASE_REST_URL', `https://${args['supabase-host']}/rest/v1`);
  await put('SUPABASE_SERVICE_KEY', key);
  await conn.commit();
  ok('lp_secrets written (values not shown)');
  await conn.execute('BEGIN lp_run_now; END;');
  const runs = await q("SELECT run_id, status, files_loaded, events_loaded, rows_published, SUBSTR(error_text,1,300) error_text FROM lp_runs WHERE started_at > SYSTIMESTAMP - INTERVAL '10' MINUTE ORDER BY run_id");
  for (const r of runs) console.log(`   run ${r.run_id}: ${r.status} files=${r.files_loaded} events=${r.events_loaded} published=${r.rows_published}${r.error_text ? ' error=' + r.error_text : ''}`);
  if (runs.some((r) => r.status !== 'OK')) throw new Error('Live run did not finish OK; the job stays disabled.');
  const dims = (await conn.execute('SELECT (SELECT COUNT(*) FROM lp_dim_question), (SELECT COUNT(*) FROM lp_dim_assessment) FROM dual')).rows[0];
  ok(`live run OK: bucket listed via resource principal; ${dims[0]} questions and ${dims[1]} assessments fetched from Supabase`);
  await conn.execute("BEGIN DBMS_SCHEDULER.ENABLE('LPKPI.LP_NIGHTLY'); END;");
  const next = (await conn.execute("SELECT TO_CHAR(next_run_date,'YYYY-MM-DD HH24:MI TZR') FROM dba_scheduler_jobs WHERE owner='LPKPI' AND job_name='LP_NIGHTLY'")).rows[0][0];
  ok(`nightly job enabled; next run ${next}`);
  console.log('\nSETUP COMPLETE');
} catch (e) {
  console.error(`\nSETUP STOPPED: ${String(e.message).replaceAll(password, '***')}`);
  process.exitCode = 1;
} finally {
  await conn.close();
}
