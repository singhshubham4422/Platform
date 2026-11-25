import test from 'node:test';
import assert from 'node:assert/strict';
import * as packFormat from '../../../packages/pack-format/index.js';
import { publishPack } from './handlers.js';
import { registerDevice, assessmentKey, submitAssessmentAttempts, canonicalAttemptJson } from './assessments.js';

const { unzipSync } = await import('../../../packages/pack-format/node_modules/fflate/esm/index.mjs');

const ORG = 'f104e1d8-7e24-4e6f-8a3a-1e9c1a6d5b11';
const CLASS = '0f6e3d44-5a1b-4c54-8c9e-1a2b3c4d5e6f';
const COURSE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ASSESSMENT = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const QUESTION = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';
const USER = '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a';
const DEVICE = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const ATTEMPT = '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c';
const PACK_KEY = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

function state(overrides = {}) {
  const db = {
    organizations: [{ id: ORG, name: 'Northfield', slug: 'northfield' }],
    profiles: [{ id: USER, organization_id: ORG, role: 'STUDENT', status: 'ACTIVE' }],
    classes: [{ id: CLASS, organization_id: ORG, name: 'CSE 2026', code: 'CSE26' }],
    class_members: [{ class_id: CLASS, user_id: USER, role: 'STUDENT' }],
    courses: [{ id: COURSE, organization_id: ORG, title: 'Algorithms', languages: ['PYTHON'], status: 'PUBLISHED' }],
    assessments: [{ id: ASSESSMENT, organization_id: ORG, class_id: CLASS, course_id: COURSE, title: 'Midterm',
      question_ids: [QUESTION], opens_at: '2026-11-26T10:00:00.000Z', closes_at: '2026-11-26T11:00:00.000Z',
      duration_minutes: 60, attempts_allowed: 2, grace_period_minutes: 10, high_stakes: false, status: 'DRAFT' }],
    questions: [{ id: QUESTION, course_id: COURSE, title: 'Two Sum', statement_md: 'Add.', difficulty: 'EASY', points: 10,
      topics: ['arrays'], time_limit_ms: 2000, memory_limit_mb: 256, output_limit_kb: 64, starter_code: { PYTHON: '' }, order_index: 0 }],
    question_tests: [
      { question_id: QUESTION, kind: 'VISIBLE', ordinal: 1, input: '1 2', expected_output: '3' },
      { question_id: QUESTION, kind: 'HIDDEN', ordinal: 1, input: '2 2', expected_output: '4' },
    ],
    assessment_keys: [], assessment_key_issues: [], course_pack_versions: [],
    devices: [{ user_id: USER, device_id: DEVICE, public_key: '', revoked_at: null }],
    submissions: [],
  };
  Object.assign(db, overrides);
  return db;
}

function fakeClient(db, { user = USER, teacher = false, serviceReads = { count: 0 } } = {}) {
  function selectResult(rows) {
    const res = { then(resolve) { resolve({ data: rows, error: null }); } };
    res.select = () => res;
    res.single = async () => ({ data: rows[0] ?? null, error: rows.length ? null : { message: 'no rows' } });
    res.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    return res;
  }
  function writer(data) {
    return { then(resolve) { resolve({ data: null, error: null }); }, select: () => selectResult(data ?? []) };
  }
  function query(name) {
    let filters = []; let order; let limit;
    const rows = () => {
      let out = db[name].filter(row => filters.every(f => f(row)));
      if (order) out = [...out].sort((a, b) => (a[order.col] < b[order.col] ? -1 : a[order.col] > b[order.col] ? 1 : 0) * (order.ascending ? 1 : -1));
      if (limit !== undefined) out = out.slice(0, limit);
      return out;
    };
    const api = {
      select() { return api; },
      eq(col, val) { filters.push(r => r[col] === val); return api; },
      in(col, vals) { filters.push(r => vals.includes(r[col])); return api; },
      lt(col, val) { filters.push(r => r[col] < val); return api; },
      order(col, opts = {}) { order = { col, ascending: opts.ascending !== false }; return api; },
      limit(n) { limit = n; return api; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => { const r = rows(); return { data: r[0] ?? null, error: r.length ? null : { message: 'no rows' } }; },
      then(resolve) { resolve({ data: rows(), error: null }); },
      insert(value) {
        const values = (Array.isArray(value) ? value : [value]).map(v => ({ ...v }));
        db[name].push(...values);
        return writer(values);
      },
      update(patch) {
        return { eq(col, val) {
          const changed = rows().filter(row => row[col] === val);
          for (const row of changed) Object.assign(row, patch);
          return writer(changed);
        } };
      },
      upsert(value, opts = {}) {
        if (db[name].some(row => row.id === value.id)) return writer([]);
        const row = { ...value, received_at: '2026-11-26T11:20:00.000Z', organization_id: ORG };
        db[name].push(row);
        return writer([{ id: row.id }]);
      },
    };
    return api;
  }
  return (url, key) => ({
    auth: { getUser: async () => ({ data: { user: key === 'anon' ? { id: user } : { id: user } }, error: null }) },
    from(name) {
      if (key === 'service') serviceReads.count++;
      return query(name);
    },
    rpc: async (fn) => ({ data: fn === 'rls_is_class_teacher' ? teacher : false, error: null }),
  });
}

const env = (keySeed) => ({ get: k => ({ SUPABASE_URL: 'http://local', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', PACK_SIGNING_KEY: keySeed }[k]) });
const request = () => new Request('http://local', { headers: { authorization: 'Bearer token' } });

function packKeys() {
  return packFormat.generateKeyPair();
}

test('publish assessment encrypts hidden tests, reuses the key before open and refuses after open', async () => {
  const db = state();
  const signing = await packKeys();
  const uploads = [];
  const oci = { putObject: async o => uploads.push(o) };
  const base = { request: request(), env: env(signing.seedB64), createClient: fakeClient(db, { teacher: true }), oci, packFormat, now: () => new Date('2026-11-25T00:00:00.000Z') };
  const first = await publishPack({ ...base, body: { assessmentId: ASSESSMENT } });
  assert.equal(first.version, 1);
  assert.equal(db.assessments[0].status, 'SCHEDULED');
  assert.equal(db.assessment_keys.length, 1);
  const key = db.assessment_keys[0];
  const packObject = uploads.find(o => o.objectName === `packs/assessment/${ASSESSMENT}/1.lpack`);
  const sigObject = uploads.find(o => o.objectName.endsWith('.sig'));
  const read = await packFormat.readPack(packObject.bytes, { publicKeyB64: signing.publicKeyB64, sigB64: new TextDecoder().decode(sigObject.bytes) });
  assert.equal(read.hidden, null);
  assert.equal(read.manifest.kind, 'ASSESSMENT');
  const archive = unzipSync(packObject.bytes);
  const hiddenPath = Object.keys(archive).find(p => p.endsWith('.hidden.enc'));
  assert.ok(hiddenPath);
  assert.ok(!Object.keys(archive).some(p => p.endsWith('.hidden.json')));
  for (const [path, content] of Object.entries(archive)) {
    if (!path.endsWith('.hidden.enc')) assert.ok(!new TextDecoder().decode(content).includes('2 2'), `plain hidden test leaked into ${path}`);
  }
  const hidden = await packFormat.decryptHiddenTests(JSON.parse(new TextDecoder().decode(archive[hiddenPath])), key.key_b64);
  assert.deepEqual(hidden.tests, [{ input: '2 2', expectedOutput: '4' }]);

  const second = await publishPack({ ...base, body: { assessmentId: ASSESSMENT } });
  assert.equal(second.version, 2);
  assert.equal(db.assessment_keys.length, 1);
  assert.equal(db.assessment_keys[0].key_id, key.key_id);
  assert.equal(db.course_pack_versions[1].assessment_id, ASSESSMENT);
  assert.equal(db.course_pack_versions[1].course_id, undefined);

  await assert.rejects(publishPack({ ...base, body: { assessmentId: ASSESSMENT }, now: () => new Date('2026-11-26T10:00:00.000Z') }), { status: 409, code: 'ASSESSMENT_STARTED' });
});

test('publish assessment checks class teaching permission before privileged reads', async () => {
  const db = state();
  const reads = { count: 0 };
  await assert.rejects(publishPack({ request: request(), body: { assessmentId: ASSESSMENT }, env: env('x'), createClient: fakeClient(db, { teacher: false, serviceReads: reads }), packFormat: {}, oci: {} }), { status: 403 });
  assert.equal(reads.count, 0);
});

test('assessment key requires an enrolled student, a registered device and an open window', async () => {
  const db = state({ assessment_keys: [{ assessment_id: ASSESSMENT, key_id: PACK_KEY, key_b64: 'a'.repeat(43) + '=' }] });
  db.assessments[0].status = 'SCHEDULED';
  const client = fakeClient(db);
  const at = iso => () => new Date(iso);
  const args = { request: request(), env: env('x'), createClient: client, body: { assessmentId: ASSESSMENT, deviceId: DEVICE } };
  await assert.rejects(assessmentKey({ ...args, now: at('2026-11-26T09:00:00.000Z') }), { status: 403, code: 'ASSESSMENT_NOT_OPEN' });
  await assert.rejects(assessmentKey({ ...args, now: at('2026-11-26T12:00:00.000Z') }), { status: 403, code: 'ASSESSMENT_CLOSED' });
  db.class_members[0].role = 'TEACHER';
  await assert.rejects(assessmentKey({ ...args, now: at('2026-11-26T10:30:00.000Z') }), { status: 403 });
  db.class_members[0].role = 'STUDENT';
  const original = db.devices[0].public_key; db.devices[0].revoked_at = '2026-01-01T00:00:00.000Z';
  await assert.rejects(assessmentKey({ ...args, now: at('2026-11-26T10:30:00.000Z') }), { status: 403, code: 'DEVICE_NOT_REGISTERED' });
  db.devices[0].revoked_at = null; db.devices[0].public_key = original;
  const result = await assessmentKey({ ...args, now: at('2026-11-26T10:30:00.000Z') });
  assert.equal(result.keyId, PACK_KEY);
  assert.equal(result.closesAt, db.assessments[0].closes_at);
  assert.equal(db.assessment_key_issues.length, 1);
  assert.equal(db.assessment_key_issues[0].device_id, DEVICE);
});

test('register-device refuses to replace the key of an active device', async () => {
  const db = state();
  const pair = await packKeys();
  db.devices[0].public_key = pair.publicKeyB64;
  const client = fakeClient(db);
  await assert.rejects(registerDevice({ request: request(), env: env('x'), createClient: client, body: { deviceId: DEVICE, publicKey: (await packKeys()).publicKeyB64 } }), { status: 409, code: 'DEVICE_KEY_MISMATCH' });
});

function attemptFor(db, key, overrides = {}) {
  const base = {
    attemptId: ATTEMPT, packId: `${ASSESSMENT}@1`, questionId: QUESTION, assessmentId: ASSESSMENT, language: 'PYTHON', mode: 'SUBMIT',
    verdict: 'ACCEPTED', passed: 1, total: 1, totalTimeMs: 12, startedAt: '2026-11-26T10:05:00.000Z', finishedAt: '2026-11-26T10:10:00.000Z',
    monotonicSeq: 5, deviceId: DEVICE, signature: '',
  };
  return { ...base, ...overrides };
}

async function signedAttempt(db, seedB64, overrides = {}) {
  const source = overrides.source ?? 'print(3)';
  const sha = await packFormat.sha256Hex(new TextEncoder().encode(source));
  const attempt = attemptFor(db, null, { ...overrides, source, sourceSha256: overrides.sourceSha256 ?? sha, resultsJson: overrides.resultsJson ?? [] });
  delete attempt.source;
  attempt.signature = await packFormat.signDetached(new TextEncoder().encode(canonicalAttemptJson(attempt)), seedB64);
  return { ...attempt, source };
}

test('submit-assessment-attempts verifies signatures, hashes and attempts limits', async () => {
  const db = state();
  db.assessments[0].status = 'SCHEDULED';
  const pair = await packKeys();
  db.devices[0].public_key = pair.publicKeyB64;
  const client = fakeClient(db);
  const base = { request: request(), env: env('x'), createClient: client, packFormat, now: () => new Date('2026-11-26T10:30:00.000Z') };

  const bad = { ...await signedAttempt(db, pair.seedB64), signature: 'AAAA' };
  const badResult = await submitAssessmentAttempts({ ...base, body: { attempts: [bad] } });
  assert.deepEqual(badResult.rejected, [{ id: ATTEMPT, error: 'SIGNATURE_INVALID' }]);

  const good = await signedAttempt(db, pair.seedB64);
  const tampered = { ...good, source: 'print(4)', sourceSha256: good.sourceSha256 };
  const hashResult = await submitAssessmentAttempts({ ...base, body: { attempts: [tampered] } });
  assert.deepEqual(hashResult.rejected, [{ id: ATTEMPT, error: 'SOURCE_SHA256_MISMATCH' }]);

  db.assessments[0].attempts_allowed = 1;
  db.submissions.push({ id: 'abababab-1111-4222-8333-444444444444', assessment_id: ASSESSMENT, user_id: USER, question_id: QUESTION });
  const limited = await submitAssessmentAttempts({ ...base, body: { attempts: [good] } });
  assert.deepEqual(limited.rejected, [{ id: ATTEMPT, error: 'ATTEMPTS_EXCEEDED' }]);
  db.submissions.length = 0;

  const accepted = await submitAssessmentAttempts({ ...base, body: { attempts: [good] } });
  assert.deepEqual(accepted, { accepted: [ATTEMPT], duplicates: [], rejected: [] });
  assert.equal(db.submissions[0].late_status, 'ON_TIME');
  assert.equal(db.submissions[0].recheck_status, 'NOT_REQUIRED');
  const duplicate = await submitAssessmentAttempts({ ...base, body: { attempts: [good] } });
  assert.deepEqual(duplicate, { accepted: [], duplicates: [ATTEMPT], rejected: [] });
});

test('submit-assessment-attempts labels late attempts and queues high-stakes re-checks', async () => {
  const db = state();
  db.assessments[0].status = 'SCHEDULED';
  db.assessments[0].high_stakes = true;
  db.assessment_key_issues.push({ assessment_id: ASSESSMENT, user_id: USER, key_id: PACK_KEY, device_id: DEVICE, issued_at: '2026-11-26T10:00:30.000Z' });
  const pair = await packKeys();
  db.devices[0].public_key = pair.publicKeyB64;
  const late = () => new Date('2026-11-26T11:20:00.000Z');
  const client = fakeClient(db);

  const offline = await signedAttempt(db, pair.seedB64, { attemptId: '11111111-1111-4111-8111-111111111111', finishedAt: '2026-11-26T10:59:00.000Z', monotonicSeq: 9 });
  const offlineResult = await submitAssessmentAttempts({ request: request(), env: env('x'), createClient: client, packFormat, now: late, body: { attempts: [offline] } });
  assert.deepEqual(offlineResult.accepted, ['11111111-1111-4111-8111-111111111111']);
  assert.equal(db.submissions.at(-1).late_status, 'FINISHED_OFFLINE_SYNCED_LATE');
  assert.equal(db.submissions.at(-1).recheck_status, 'QUEUED');

  const tooLong = await signedAttempt(db, pair.seedB64, { attemptId: '22222222-2222-4222-8222-222222222222', startedAt: '2026-11-26T09:00:00.000Z', finishedAt: '2026-11-26T10:58:00.000Z', monotonicSeq: 10 });
  const tooLongResult = await submitAssessmentAttempts({ request: request(), env: env('x'), createClient: client, packFormat, now: late, body: { attempts: [tooLong] } });
  assert.deepEqual(tooLongResult.accepted, ['22222222-2222-4222-8222-222222222222']);
  assert.equal(db.submissions.at(-1).late_status, 'LATE');
  assert.equal(db.submissions.at(-1).recheck_status, 'QUEUED');
});

test('submit-assessment-attempts rejects more than twenty attempts', async () => {
  const db = state();
  const pair = await packKeys();
  db.devices[0].public_key = pair.publicKeyB64;
  const one = await signedAttempt(db, pair.seedB64);
  await assert.rejects(submitAssessmentAttempts({ request: request(), env: env('x'), createClient: fakeClient(db), packFormat, body: { attempts: Array.from({ length: 21 }, () => one) } }), { status: 413 });
});
