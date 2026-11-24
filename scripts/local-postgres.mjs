#!/usr/bin/env node
// Local, disposable PostgreSQL for development and integration tests.
//
// Uses the PostgreSQL binaries on PATH (pg_ctl, initdb, psql). Data lives in
// .local/postgres (git-ignored). Never points at a remote or production server.
//
//   node scripts/local-postgres.mjs start        start (and initialise) the cluster, create dev + test DBs
//   node scripts/local-postgres.mjs stop         stop the cluster
//   node scripts/local-postgres.mjs status       show status
//   node scripts/local-postgres.mjs ensure-test  start + recreate the test DB, migrate and seed it
//   node scripts/local-postgres.mjs migrate-dev  migrate + seed the dev DB
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = resolve(process.env.LOCAL_PG_DATA_DIR || join(root, '.local', 'postgres'));
const dataDir = join(dataRoot, 'cluster');
const logFile = join(dataRoot, 'server.log');
export const PORT = Number(process.env.LOCAL_PG_PORT || 54330);
const SUPERUSER = 'postgres';
const APP_USER = 'lplatform';
const APP_PASSWORD = 'lplatform_dev';
export const DEV_DB = 'lplatform_dev';
export const TEST_DB = 'lplatform_test';
const SUPABASE_TEST_DB = 'lplatform_supabase_test';
export const devUrl = `postgresql://${APP_USER}:${APP_PASSWORD}@127.0.0.1:${PORT}/${DEV_DB}`;
export const testUrl = `postgresql://${APP_USER}:${APP_PASSWORD}@127.0.0.1:${PORT}/${TEST_DB}`;

const isWin = process.platform === 'win32';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function psql(sql, db = 'postgres') {
  const res = spawnSync(
    'psql',
    ['-h', '127.0.0.1', '-p', String(PORT), '-U', SUPERUSER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: '' } },
  );
  if (res.status !== 0) throw new Error(`psql failed: ${res.stderr || res.stdout}`);
  return res.stdout.trim();
}

function isRunning() {
  if (!existsSync(join(dataDir, 'PG_VERSION'))) return false;
  const res = spawnSync('pg_ctl', ['-D', dataDir, 'status'], { encoding: 'utf8' });
  return res.status === 0;
}

function init() {
  if (existsSync(join(dataDir, 'PG_VERSION'))) return;
  mkdirSync(dataDir, { recursive: true });
  console.log(`Initialising local PostgreSQL cluster in ${dataDir}`);
  // trust auth on loopback only: this cluster is a local, disposable dev/test database.
  run('initdb', ['-D', dataDir, '-U', SUPERUSER, '--auth=trust', '--encoding=UTF8', '--no-locale']);
  writeFileSync(
    join(dataDir, 'pg_hba.conf'),
    ['local all all trust', 'host all all 127.0.0.1/32 trust', 'host all all ::1/128 trust', ''].join('\n'),
  );
}

function start() {
  init();
  if (!isRunning()) {
    const args = ['-D', dataDir, '-l', logFile, '-w', '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`, 'start'];
    if (isWin) {
      // On Windows the postmaster must own a console that outlives this script; otherwise
      // new backends fail with 0xC0000142 once the launching terminal closes.
      // Start the postmaster directly in its own hidden console (no -Wait: it never exits).
      const pgArgs = ['-D', dataDir, '-p', String(PORT), '-c', 'listen_addresses=127.0.0.1', '-c', 'logging_collector=off'];
      const quoted = pgArgs.map((a) => `'"${a.replace(/'/g, "''")}"'`).join(',');
      run('powershell', [
        '-NoProfile', '-Command',
        `Start-Process -FilePath postgres -ArgumentList ${quoted} -WindowStyle Hidden -RedirectStandardError '${logFile}.stderr'`,
      ], { stdio: 'ignore' });
      for (let i = 0; i < 60; i++) {
        const r = spawnSync('pg_isready', ['-h', '127.0.0.1', '-p', String(PORT)], { stdio: 'ignore' });
        if (r.status === 0) break;
        execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']);
      }
    } else {
      run('pg_ctl', args, { stdio: 'ignore' });
    }
  }
  ensureRoleAndDb(DEV_DB);
  console.log(`PostgreSQL ready on 127.0.0.1:${PORT}\n  dev:  ${devUrl}\n  test: ${testUrl}`);
}

function ensureRoleAndDb(db) {
  const hasRole = psql(`SELECT 1 FROM pg_roles WHERE rolname='${APP_USER}'`);
  if (!hasRole) {
    psql(`CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER CREATEDB CREATEROLE BYPASSRLS`);
  }
  // Owner/migrator mirrors Supabase's postgres role (BYPASSRLS); API requests run as lplatform_app.
  psql(`ALTER ROLE ${APP_USER} BYPASSRLS`);
  const hasDb = psql(`SELECT 1 FROM pg_database WHERE datname='${db}'`);
  if (!hasDb) psql(`CREATE DATABASE ${db} OWNER ${APP_USER}`);
}

function apiScript(script, url) {
  run(isWin ? 'pnpm.cmd' : 'pnpm', ['--filter', '@lplatform/api', script], {
    cwd: root,
    shell: isWin,
    env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: 'false', NODE_ENV: 'test', ALLOW_DEV_SEED: 'true' },
  });
}

const cmd = process.argv[2] || 'status';
switch (cmd) {
  case 'start':
    start();
    break;
  case 'stop':
    if (isRunning()) run('pg_ctl', ['-D', dataDir, '-m', 'fast', 'stop']);
    break;
  case 'status':
    console.log(isRunning() ? `running on port ${PORT}` : 'stopped');
    break;
  case 'ensure-test': {
    start();
    psql(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    ensureRoleAndDb(TEST_DB);
    apiScript('db:migrate', testUrl);
    apiScript('db:seed', testUrl);
    console.log(`Test database ready: ${testUrl}`);
    break;
  }
  case 'integration': {
    start();
    psql(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    ensureRoleAndDb(TEST_DB);
    apiScript('db:migrate', testUrl);
    apiScript('db:seed', testUrl);
    apiScript('test:integration', testUrl);
    break;
  }
  case 'supabase-test': {
    start();
    if (psql(`SELECT 1 FROM pg_database WHERE datname='${SUPABASE_TEST_DB}'`)) {
      throw new Error(`${SUPABASE_TEST_DB} already exists; refusing to reset a database not created by this invocation.`);
    }
    psql(`CREATE DATABASE ${SUPABASE_TEST_DB} OWNER postgres`);
    const created = true;
    try {
      const url = `postgresql://postgres@127.0.0.1:${PORT}/${SUPABASE_TEST_DB}`;
      const applySql = (file) => run('psql', ['-h','127.0.0.1','-p',String(PORT),'-U','postgres','-d',SUPABASE_TEST_DB,'-v','ON_ERROR_STOP=1','-f',file], { stdio:'inherit' });
      applySql(join(root,'supabase','tests-support','auth-stub.sql'));
      for (const file of readdirSync(join(root,'supabase','migrations')).filter((n)=>n.endsWith('.sql')).sort()) applySql(join(root,'supabase','migrations',file));
      run(isWin?'pnpm.cmd':'pnpm',['--filter','@lplatform/supabase-tests','test'],{cwd:root,shell:isWin,env:{...process.env,SUPABASE_TEST_DATABASE_URL:url}});
    } finally {
      if (created) psql(`DROP DATABASE ${SUPABASE_TEST_DB} WITH (FORCE)`);
    }
    break;
  }
  case 'migrate-dev':
    start();
    apiScript('db:migrate', devUrl);
    apiScript('db:seed', devUrl);
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
}
