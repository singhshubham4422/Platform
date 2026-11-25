import { authenticated, envOrThrow, requireUuid, uuid } from './http.js';
import { badRequest, conflict, denied, forbidden, notFound, tooLarge } from './errors.js';
import { createOci } from './oci.js';

const nowIso = () => new Date().toISOString();
const failDb = (e) => { if (e) throw new Error('DATABASE_OPERATION_FAILED'); };
const LANGUAGES = new Set(['PYTHON', 'C', 'CPP', 'JAVA']);
const VERDICTS = new Set(['ACCEPTED','WRONG_ANSWER','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT_EXCEEDED','MEMORY_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED','JUDGE_UNAVAILABLE','SUBMISSION_FAILED']);
const isB64Key = (v) => { if (typeof v !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(v)) return false; try { return atob(v).length === 32; } catch { return false; } };

async function activeProfile(userClient, userId, roles) {
  const res = await userClient.from('profiles').select('role,organization_id,status').eq('id', userId).maybeSingle();
  failDb(res.error);
  if (!res.data || res.data.status !== 'ACTIVE' || !roles.includes(res.data.role)) throw forbidden();
  return res.data;
}

async function ownAssessment(userClient, assessmentId) {
  const res = await userClient.from('assessments').select('id,organization_id,class_id,course_id,title,question_ids,opens_at,closes_at,duration_minutes,attempts_allowed,grace_period_minutes,high_stakes,status').eq('id', assessmentId).maybeSingle();
  failDb(res.error);
  if (!res.data) throw denied('ASSESSMENT_NOT_OPEN','The assessment is not open');
  return res.data;
}

export async function publishAssessment({ request, body, env, createClient, oci = createOci({ env }), packFormat, now = () => new Date() }) {
  const { userClient, serviceClient, user } = await authenticated({ request, env, createClient });
  const assessmentId = requireUuid(body?.assessmentId, 'assessmentId');
  const assessment = await ownAssessment(userClient, assessmentId);
  const [teacherRes, profile] = await Promise.all([
    userClient.rpc('rls_is_class_teacher', { cid: assessment.class_id }),
    activeProfile(userClient, user.id, ['STUDENT','TEACHER','COLLEGE_ADMIN','PLATFORM_OWNER']),
  ]);
  failDb(teacherRes.error);
  const collegeAdmin = profile.role === 'COLLEGE_ADMIN' && profile.organization_id === assessment.organization_id;
  if (teacherRes.data !== true && !collegeAdmin) throw forbidden();
  if (!['DRAFT','SCHEDULED'].includes(assessment.status)) throw conflict('ASSESSMENT_NOT_SCHEDULABLE','Only draft or scheduled assessments can be published');
  if (now().getTime() >= Date.parse(assessment.opens_at)) throw conflict('ASSESSMENT_STARTED','The assessment has already started and can no longer be published');
  if (!Array.isArray(assessment.question_ids) || assessment.question_ids.length === 0) throw conflict('NOT_PUBLISHABLE','An assessment needs at least one question');
  if (!packFormat?.buildPack || !packFormat?.signDetached) throw new Error('PACK_FORMAT_NOT_AVAILABLE');

  const [courseRes, questionRes, keyRes, versionRes] = await Promise.all([
    serviceClient.from('courses').select('title,languages').eq('id', assessment.course_id).single(),
    serviceClient.from('questions').select('*').in('id', assessment.question_ids),
    serviceClient.from('assessment_keys').select('key_id,key_b64').eq('assessment_id', assessmentId).maybeSingle(),
    serviceClient.from('course_pack_versions').select('version').eq('assessment_id', assessmentId).order('version', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (courseRes.error || !courseRes.data) throw notFound('Assessment course not found');
  failDb(questionRes.error); failDb(keyRes.error); failDb(versionRes.error);
  if ((questionRes.data?.length ?? 0) !== assessment.question_ids.length) throw conflict('QUESTION_NOT_IN_ASSESSMENT','Every assessment question must exist');
  if (questionRes.data.some(q => q.course_id !== assessment.course_id)) throw conflict('QUESTION_COURSE_MISMATCH','Every assessment question must belong to the assessment course');
  const ordered = assessment.question_ids.map(id => questionRes.data.find(q => q.id === id));
  const ids = ordered.map(q => q.id);
  const testsRes = await serviceClient.from('question_tests').select('question_id,kind,ordinal,input,expected_output').in('question_id', ids).order('ordinal');
  failDb(testsRes.error);
  const tests = new Map(ids.map(id => [id, []])); for (const t of testsRes.data ?? []) tests.get(t.question_id)?.push(t);

  const questions = ordered.map((q, i) => {
    const all = tests.get(q.id) ?? [];
    const visibleTests = all.filter(t => t.kind === 'VISIBLE').map(t => ({ input: t.input, expectedOutput: t.expected_output }));
    const hiddenTests = all.filter(t => t.kind === 'HIDDEN').map(t => ({ input: t.input, expectedOutput: t.expected_output }));
    if (!hiddenTests.length) throw conflict('NOT_PUBLISHABLE','Every assessment question needs at least one hidden test');
    return { id:q.id, title:q.title, statementMd:q.statement_md, limits:{ timeLimitMs:q.time_limit_ms, memoryLimitMb:q.memory_limit_mb, outputLimitKb:q.output_limit_kb }, starterCode:q.starter_code, visibleTests, hiddenTests, topics:q.topics, difficulty:q.difficulty, points:q.points, order:i };
  });

  let key = keyRes.data;
  if (!key) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    let binary = ''; for (const b of raw) binary += String.fromCharCode(b);
    key = { key_id: crypto.randomUUID(), key_b64: btoa(binary) };
    const insertedKey = await serviceClient.from('assessment_keys').insert({ assessment_id:assessmentId, key_id:key.key_id, key_b64:key.key_b64 });
    failDb(insertedKey.error);
  }
  const version = (versionRes.data?.version ?? 0) + 1;
  const built = await packFormat.buildPack({
    kind:'ASSESSMENT', courseId:assessment.course_id, assessmentId, organizationId:assessment.organization_id,
    version, minAppVersion:'0.1.0', title:assessment.title, languages:courseRes.data.languages, questions,
    encryption:{ keyB64:key.key_b64, keyId:key.key_id },
    assessment:{ opensAt:assessment.opens_at, closesAt:assessment.closes_at, durationMinutes:assessment.duration_minutes,
      attemptsAllowed:assessment.attempts_allowed, gracePeriodMinutes:assessment.grace_period_minutes,
      keyId:key.key_id, highStakes:assessment.high_stakes },
  });
  const sig = await packFormat.signDetached(built.bytes, envOrThrow(env, 'PACK_SIGNING_KEY'));
  const objectPath = `packs/assessment/${assessmentId}/${version}.lpack`;
  try {
    await oci.putObject({ objectName:objectPath, bytes:built.bytes, contentType:'application/vnd.lplatform.pack' });
    await oci.putObject({ objectName:`${objectPath}.sig`, bytes:new TextEncoder().encode(sig), contentType:'text/plain' });
  } catch { console.error('publish-pack OCI upload failed; any partial object is an orphan', assessmentId, version); throw new Error('PACK_UPLOAD_FAILED'); }
  const inserted = await serviceClient.from('course_pack_versions').insert({
    pack_id:`${assessmentId}@${version}`, kind:'ASSESSMENT', assessment_id:assessmentId, version,
    object_path:objectPath, sha256:built.sha256, size:built.bytes.length, min_app_version:'0.1.0', published_by:user.id,
  }).select('pack_id').single();
  if (inserted.error) { console.error('publish-pack metadata insert failed; uploaded objects are orphans', assessmentId, version); throw new Error('PACK_METADATA_INSERT_FAILED'); }
  const scheduled = await serviceClient.from('assessments').update({ status:'SCHEDULED' }).eq('id',assessmentId);
  if (scheduled.error) throw new Error('ASSESSMENT_SCHEDULE_UPDATE_FAILED');
  return { packId:inserted.data.pack_id, version, objectPath, sha256:built.sha256, size:built.bytes.length };
}

export async function registerDevice({ request, body, env, createClient }) {
  const { userClient, user } = await authenticated({ request, env, createClient });
  await activeProfile(userClient, user.id, ['STUDENT','TEACHER','COLLEGE_ADMIN','PLATFORM_OWNER']);
  const deviceId = requireUuid(body?.deviceId, 'deviceId');
  const publicKey = body?.publicKey;
  if (!isB64Key(publicKey)) throw badRequest('Invalid publicKey');
  const existing = await userClient.from('devices').select('public_key,revoked_at').eq('user_id', user.id).eq('device_id', deviceId).maybeSingle();
  failDb(existing.error);
  if (existing.data && existing.data.revoked_at === null && existing.data.public_key !== publicKey) {
    throw conflict('DEVICE_KEY_MISMATCH','This device is already registered with a different key');
  }
  const write = existing.data
    ? await userClient.from('devices').update({ public_key:publicKey, revoked_at:null, registered_at:nowIso() }).eq('user_id',user.id).eq('device_id',deviceId)
    : await userClient.from('devices').insert({ user_id:user.id, device_id:deviceId, public_key:publicKey });
  failDb(write.error);
  return { ok:true };
}

export async function assessmentKey({ request, body, env, createClient, now = () => new Date() }) {
  const { userClient, serviceClient, user } = await authenticated({ request, env, createClient });
  await activeProfile(userClient, user.id, ['STUDENT']);
  const assessmentId = requireUuid(body?.assessmentId, 'assessmentId');
  const deviceId = requireUuid(body?.deviceId, 'deviceId');
  const [assessment, device] = await Promise.all([
    ownAssessment(userClient, assessmentId),
    userClient.from('devices').select('device_id,revoked_at').eq('user_id', user.id).eq('device_id', deviceId).maybeSingle(),
  ]);
  failDb(device.error);
  if (!device.data || device.data.revoked_at !== null) throw denied('DEVICE_NOT_REGISTERED','Register this device before starting the assessment');
  const membership = await userClient.from('class_members').select('role').eq('class_id', assessment.class_id).eq('user_id', user.id).maybeSingle();
  failDb(membership.error);
  if (!membership.data || membership.data.role !== 'STUDENT') throw denied('ASSESSMENT_NOT_OPEN','The assessment is not open');
  const at = now().getTime();
  if (assessment.status === 'CLOSED' || at > Date.parse(assessment.closes_at)) throw denied('ASSESSMENT_CLOSED','The assessment has closed');
  if (assessment.status !== 'SCHEDULED' || at < Date.parse(assessment.opens_at)) throw denied('ASSESSMENT_NOT_OPEN','The assessment is not open');
  const key = await serviceClient.from('assessment_keys').select('key_id,key_b64').eq('assessment_id', assessmentId).maybeSingle();
  failDb(key.error);
  if (!key.data) throw conflict('ASSESSMENT_KEY_UNAVAILABLE','This assessment has no pack key yet');
  const issue = await serviceClient.from('assessment_key_issues').insert({ assessment_id:assessmentId, user_id:user.id, key_id:key.data.key_id, device_id:deviceId });
  failDb(issue.error);
  return { keyId:key.data.key_id, keyB64:key.data.key_b64, closesAt:assessment.closes_at };
}

// The desktop signs this exact JSON string: the C7 fields in this fixed order.
export function canonicalAttemptJson(a) {
  return JSON.stringify({ attemptId:a.attemptId, packId:a.packId, questionId:a.questionId, assessmentId:a.assessmentId,
    language:a.language, mode:a.mode, sourceSha256:a.sourceSha256, verdict:a.verdict, passed:a.passed, total:a.total,
    totalTimeMs:a.totalTimeMs, startedAt:a.startedAt, finishedAt:a.finishedAt, monotonicSeq:a.monotonicSeq, deviceId:a.deviceId });
}

function normalizeAttempt(raw) {
  const pick = (...keys) => { for (const k of keys) if (raw?.[k] !== undefined) return raw[k]; return undefined; };
  return {
    attemptId:pick('attemptId','attempt_id','id'), packId:pick('packId','pack_id'), questionId:pick('questionId','question_id'),
    assessmentId:pick('assessmentId','assessment_id'), language:pick('language'), mode:pick('mode'),
    sourceSha256:String(pick('sourceSha256','source_sha256') ?? '').toLowerCase(), verdict:pick('verdict'),
    passed:pick('passed'), total:pick('total'), totalTimeMs:pick('totalTimeMs','total_time_ms'),
    resultsJson:pick('resultsJson','results_json'), source:pick('source'), startedAt:pick('startedAt','started_at'),
    finishedAt:pick('finishedAt','finished_at'), monotonicSeq:pick('monotonicSeq','monotonic_seq'),
    deviceId:pick('deviceId','device_id'), signature:pick('signature'),
  };
}

function attemptShapeError(a) {
  if (!uuid(a.attemptId) || !uuid(a.questionId) || !uuid(a.assessmentId) || !uuid(a.deviceId)) return 'INVALID_ATTEMPT';
  if (typeof a.packId !== 'string' || a.packId !== `${a.assessmentId}@${a.packId.split('@')[1]}` || !/^[0-9a-f-]{36}@[1-9][0-9]*$/i.test(a.packId)) return 'INVALID_ATTEMPT';
  if (a.mode !== 'SUBMIT' || !LANGUAGES.has(a.language) || !VERDICTS.has(a.verdict)) return 'INVALID_ATTEMPT';
  if (!Number.isInteger(a.passed) || !Number.isInteger(a.total) || a.passed < 0 || a.total < 0 || a.passed > a.total) return 'INVALID_ATTEMPT';
  if (!Number.isSafeInteger(a.totalTimeMs) || a.totalTimeMs < 0 || !Number.isSafeInteger(a.monotonicSeq) || a.monotonicSeq < 0) return 'INVALID_ATTEMPT';
  if (!/^[a-f0-9]{64}$/.test(a.sourceSha256)) return 'INVALID_ATTEMPT';
  if (typeof a.source !== 'string' || a.source.length === 0 || new TextEncoder().encode(a.source).length > 65536) return 'INVALID_ATTEMPT';
  if (typeof a.startedAt !== 'string' || Number.isNaN(Date.parse(a.startedAt))) return 'INVALID_ATTEMPT';
  if (typeof a.finishedAt !== 'string' || Number.isNaN(Date.parse(a.finishedAt))) return 'INVALID_ATTEMPT';
  if (!Array.isArray(a.resultsJson) || a.resultsJson.length > 200) return 'INVALID_ATTEMPT';
  if (typeof a.signature !== 'string' || a.signature.length > 200) return 'INVALID_ATTEMPT';
  return null;
}

export async function submitAssessmentAttempts({ request, body, env, createClient, packFormat, now = () => new Date() }) {
  const { userClient, serviceClient, user } = await authenticated({ request, env, createClient });
  await activeProfile(userClient, user.id, ['STUDENT']);
  if (!packFormat?.verifyDetached || !packFormat?.sha256Hex) throw new Error('PACK_FORMAT_NOT_AVAILABLE');
  if (!Array.isArray(body?.attempts)) throw badRequest('Expected an attempts array');
  if (body.attempts.length === 0) throw badRequest('At least one attempt is required');
  if (body.attempts.length > 20) throw tooLarge('At most 20 attempts per call');
  const attempts = body.attempts.map(normalizeAttempt);

  const assessmentIds = [...new Set(attempts.map(a => a.assessmentId).filter(uuid))];
  const [assessmentRes, deviceRes, packRes] = await Promise.all([
    serviceClient.from('assessments').select('id,class_id,course_id,question_ids,opens_at,closes_at,duration_minutes,attempts_allowed,grace_period_minutes,high_stakes,status').in('id', assessmentIds),
    serviceClient.from('devices').select('device_id,public_key,revoked_at').eq('user_id', user.id).in('device_id', [...new Set(attempts.map(a => a.deviceId).filter(uuid))]),
    serviceClient.from('assessment_key_issues').select('assessment_id,issued_at').eq('user_id', user.id).in('assessment_id', assessmentIds).order('issued_at'),
  ]);
  failDb(assessmentRes.error); failDb(deviceRes.error); failDb(packRes.error);
  const assessments = new Map((assessmentRes.data ?? []).map(a => [a.id, a]));
  const devices = new Map((deviceRes.data ?? []).map(d => [d.device_id, d]));
  const firstIssue = new Map(); for (const row of packRes.data ?? []) if (!firstIssue.has(row.assessment_id)) firstIssue.set(row.assessment_id, row.issued_at);

  const classIds = [...new Set([...assessments.values()].map(a => a.class_id))];
  const memberships = classIds.length ? await userClient.from('class_members').select('class_id').eq('user_id', user.id).in('class_id', classIds) : { data: [], error: null };
  failDb(memberships.error);
  const enrolled = new Set((memberships.data ?? []).filter(m => m.role === 'STUDENT' || m.role === undefined).map(m => m.class_id));

  const existingRes = await serviceClient.from('submissions').select('id').in('id', attempts.map(a => a.attemptId).filter(uuid));
  failDb(existingRes.error);
  const existing = new Set((existingRes.data ?? []).map(r => r.id));
  const counts = new Map();
  if (assessmentIds.length) {
    const countRes = await serviceClient.from('submissions').select('assessment_id,question_id').eq('user_id', user.id).in('assessment_id', assessmentIds);
    failDb(countRes.error);
    for (const row of countRes.data ?? []) counts.set(`${row.assessment_id}/${row.question_id}`, (counts.get(`${row.assessment_id}/${row.question_id}`) ?? 0) + 1);
  }

  const accepted = []; const duplicates = []; const rejected = [];
  for (const a of attempts) {
    const id = typeof a.attemptId === 'string' ? a.attemptId : null;
    if (existing.has(id)) { duplicates.push(id); continue; }
    const shapeError = attemptShapeError(a);
    if (shapeError) { rejected.push({ id, error:shapeError }); continue; }
    const assessment = assessments.get(a.assessmentId);
    if (!assessment) { rejected.push({ id, error:'ASSESSMENT_NOT_FOUND' }); continue; }
    if (!enrolled.has(assessment.class_id) || !['SCHEDULED','CLOSED'].includes(assessment.status)) { rejected.push({ id, error:'NOT_ENROLLED' }); continue; }
    const device = devices.get(a.deviceId);
    if (!device || device.revoked_at !== null) { rejected.push({ id, error:'DEVICE_NOT_REGISTERED' }); continue; }
    if (!await packFormat.verifyDetached(new TextEncoder().encode(canonicalAttemptJson(a)), a.signature, device.public_key)) { rejected.push({ id, error:'SIGNATURE_INVALID' }); continue; }
    if (await packFormat.sha256Hex(new TextEncoder().encode(a.source)) !== a.sourceSha256) { rejected.push({ id, error:'SOURCE_SHA256_MISMATCH' }); continue; }
    if (!Array.isArray(assessment.question_ids) || !assessment.question_ids.includes(a.questionId)) { rejected.push({ id, error:'QUESTION_NOT_IN_ASSESSMENT' }); continue; }
    const key = `${a.assessmentId}/${a.questionId}`;
    if ((counts.get(key) ?? 0) >= assessment.attempts_allowed) { rejected.push({ id, error:'ATTEMPTS_EXCEEDED' }); continue; }

    const at = now().getTime();
    const closesAt = Date.parse(assessment.closes_at);
    let lateStatus;
    if (at <= closesAt + assessment.grace_period_minutes * 60_000) lateStatus = 'ON_TIME';
    else {
      const issued = Date.parse(firstIssue.get(a.assessmentId) ?? assessment.opens_at);
      const finished = Date.parse(a.finishedAt); const started = Date.parse(a.startedAt);
      const prior = await serviceClient.from('submissions').select('monotonic_seq').eq('device_id', a.deviceId).lt('received_at', new Date(issued).toISOString()).order('monotonic_seq', { ascending:false }).limit(1).maybeSingle();
      failDb(prior.error);
      const priorMax = prior.data?.monotonic_seq ?? 0;
      const offlineFinished = finished <= closesAt && started >= issued && finished - started <= assessment.duration_minutes * 60_000;
      lateStatus = offlineFinished && a.monotonicSeq > priorMax ? 'FINISHED_OFFLINE_SYNCED_LATE' : 'LATE';
    }

    const row = { id:a.attemptId, user_id:user.id, pack_id:a.packId, course_id:assessment.course_id, question_id:a.questionId,
      assessment_id:a.assessmentId, language:a.language, source:a.source, source_sha256:a.sourceSha256, verdict:a.verdict,
      passed:a.passed, total:a.total, total_time_ms:a.totalTimeMs, results_json:a.resultsJson, started_at:a.startedAt,
      finished_at:a.finishedAt, monotonic_seq:a.monotonicSeq, device_id:a.deviceId, signature:a.signature,
      late_status:lateStatus, recheck_status:assessment.high_stakes ? 'QUEUED' : 'NOT_REQUIRED' };
    const inserted = await serviceClient.from('submissions').upsert(row, { onConflict:'id', ignoreDuplicates:true }).select('id');
    if (inserted.error) { rejected.push({ id, error:'INSERT_FAILED' }); continue; }
    if (!inserted.data?.length) { duplicates.push(id); continue; }
    accepted.push(id); counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { accepted, duplicates, rejected };
}
