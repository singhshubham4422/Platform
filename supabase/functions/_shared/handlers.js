import { authenticated, requireHash, requireUuid, envOrThrow, uuid } from './http.js';
import { badRequest, forbidden, notFound, conflict, tooLarge } from './errors.js';
import { createOci } from './oci.js';
import { publishAssessment } from './assessments.js';

const nowIso = () => new Date().toISOString();
const failDb = (e) => { if (e) throw new Error('DATABASE_OPERATION_FAILED'); };
export async function activityUploadUrl({ request, body, env, createClient, oci = createOci({ env }), now = () => new Date() }) {
  const { userClient, user } = await authenticated({ request, env, createClient });
  const size = Number(body?.sizeBytes);
  if (!Number.isSafeInteger(size) || size < 1) throw badRequest('Invalid sizeBytes');
  if (size > 5 * 1024 * 1024) throw tooLarge('File exceeds 5 MB');
  const batchId = requireUuid(body?.batchId, 'batchId');
  const sha256 = requireHash(body?.sha256);
  const profile = await userClient.from('profiles').select('organization_id,status').eq('id', user.id).maybeSingle();
  failDb(profile.error); if (!profile.data || profile.data.status !== 'ACTIVE' || !profile.data.organization_id) throw forbidden();
  const date=now();const yyyy=String(date.getUTCFullYear()),mm=String(date.getUTCMonth()+1).padStart(2,'0'),dd=String(date.getUTCDate()).padStart(2,'0');
  const objectPath = `raw/activity/${profile.data.organization_id}/${yyyy}/${mm}/${dd}/${user.id}-${batchId}.jsonl.gz`;
  const expiresAt = new Date(date.getTime() + 15 * 60_000).toISOString();
  const url = await oci.createPar({ objectName: objectPath, accessType: 'ObjectWrite', expiresAt });
  return { uploadUrl: url, objectPath, expiresAt };
}

export async function packDownloadUrl({ request, body, env, createClient, oci = createOci({ env }), now = () => new Date() }) {
  const { userClient } = await authenticated({ request, env, createClient });
  const packId = body?.packId;
  if (typeof packId !== 'string' || packId.length > 200 || !/^[0-9a-f-]{36}@[1-9][0-9]*$/i.test(packId)) throw badRequest('Invalid packId');
  const row = await userClient.from('course_pack_versions').select('pack_id,object_path,sha256,size').eq('pack_id', packId).maybeSingle();
  if (row.error) throw new Error('DATABASE_OPERATION_FAILED');
  if (!row.data) throw notFound('Pack not found');
  const expiresAt = new Date(now().getTime() + 15 * 60_000).toISOString();
  const [url, signatureUrl] = await Promise.all([
    oci.createPar({ objectName: row.data.object_path, accessType: 'ObjectRead', expiresAt }),
    oci.createPar({ objectName: `${row.data.object_path}.sig`, accessType: 'ObjectRead', expiresAt }),
  ]);
  return { url, sigUrl:signatureUrl, sha256:row.data.sha256, size:row.data.size, expiresAt };
}

export async function publishPack({ request, body, env, createClient, oci = createOci({ env }), packFormat, now }) {
  if (body?.assessmentId) return publishAssessment({ request, body, env, createClient, oci, packFormat, now });
  const { userClient, serviceClient, user } = await authenticated({ request, env, createClient });
  const courseId = requireUuid(body?.courseId, 'courseId');
  const permission = await userClient.rpc('rls_can_manage_course', { cid: courseId });
  if (permission.error) throw new Error('DATABASE_OPERATION_FAILED');
  if (permission.data !== true) throw forbidden();
  if (!packFormat?.buildPack || !packFormat?.signDetached) throw new Error('PACK_FORMAT_NOT_AVAILABLE');
  const [courseRes, questionRes] = await Promise.all([
    serviceClient.from('courses').select('*').eq('id', courseId).single(),
    serviceClient.from('questions').select('*').eq('course_id', courseId).order('order_index'),
  ]);
  if (courseRes.error || questionRes.error || !courseRes.data) throw notFound('Course content not found');
  if (courseRes.data.status === 'ARCHIVED' || !questionRes.data?.length) throw conflict('NOT_PUBLISHABLE','Course must have questions and cannot be archived');
  const ids = questionRes.data.map(q => q.id);
  const testsRes = await serviceClient.from('question_tests').select('question_id,kind,ordinal,input,expected_output').in('question_id', ids).order('ordinal');
  failDb(testsRes.error);
  const tests = new Map(ids.map(id => [id, []])); for (const t of testsRes.data) tests.get(t.question_id).push(t);
  const questions = questionRes.data.map((q, i) => {
    const all = tests.get(q.id); const visibleTests = all.filter(t => t.kind === 'VISIBLE').map(t => ({ input: t.input, expectedOutput: t.expected_output }));
    const hiddenTests = all.filter(t => t.kind === 'HIDDEN').map(t => ({ input: t.input, expectedOutput: t.expected_output }));
    if (!visibleTests.length) throw conflict('NOT_PUBLISHABLE','Every question needs at least one visible test');
    return { id:q.id, title:q.title, statementMd:q.statement_md, limits:{ timeLimitMs:q.time_limit_ms, memoryLimitMb:q.memory_limit_mb, outputLimitKb:q.output_limit_kb }, starterCode:q.starter_code, visibleTests, hiddenTests, topics:q.topics, difficulty:q.difficulty, points:q.points, order:q.order_index ?? i };
  });
  const latest = await serviceClient.from('course_pack_versions').select('version').eq('course_id',courseId).order('version',{ascending:false}).limit(1).maybeSingle(); failDb(latest.error);
  const version = (latest.data?.version ?? 0) + 1;
  const built = await packFormat.buildPack({ kind:'COURSE', courseId, version, title:courseRes.data.title, languages:courseRes.data.languages, minAppVersion:'0.1.0', questions });
  const sig = await packFormat.signDetached(built.bytes, envOrThrow(env, 'PACK_SIGNING_KEY'));
  const objectPath = `packs/course/${courseId}/${version}.lpack`;
  try {
    await oci.putObject({ objectName:objectPath, bytes:built.bytes, contentType:'application/vnd.lplatform.pack' });
    await oci.putObject({ objectName:`${objectPath}.sig`, bytes:new TextEncoder().encode(sig), contentType:'text/plain' });
  } catch { console.error('publish-pack OCI upload failed; any partial object is an orphan', courseId, version); throw new Error('PACK_UPLOAD_FAILED'); }
  const inserted = await serviceClient.from('course_pack_versions').insert({ pack_id:`${courseId}@${version}`, kind:'COURSE', course_id:courseId, version, object_path:objectPath, sha256:built.sha256, size:built.bytes.length, min_app_version:'0.1.0', published_by:user.id }).select('pack_id').single();
  if (inserted.error) { console.error('publish-pack metadata insert failed; uploaded objects are orphans', courseId, version); throw new Error('PACK_METADATA_INSERT_FAILED'); }
  const updated = await serviceClient.from('courses').update({ status:'PUBLISHED', updated_at:nowIso() }).eq('id',courseId);
  if (updated.error) { console.error('publish-pack could not update course status', courseId, version); throw new Error('COURSE_PUBLISH_UPDATE_FAILED'); }
  return { packId:inserted.data.pack_id, version, objectPath, sha256:built.sha256, size:built.bytes.length };
}

export async function inviteUser({ request, body, env, createClient }) {
  const { userClient, serviceClient, user } = await authenticated({ request, env, createClient });
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  const role = body?.role;
  const organizationId = requireUuid(body?.organizationId, 'organizationId');
  const classIds = body?.classIds ?? [];
  if (!Array.isArray(classIds) || classIds.length > 100 || classIds.some(id=>!uuid(id))) throw badRequest('Invalid classIds');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !fullName || fullName.length > 160 || !['STUDENT','TEACHER','COLLEGE_ADMIN'].includes(role)) throw badRequest('Invalid invite details');
  const { data: caller, error: callerError } = await userClient.from('profiles').select('organization_id,role,status').eq('id', user.id).maybeSingle();
  if (callerError) throw new Error('DATABASE_OPERATION_FAILED');
  if (!caller || caller.status !== 'ACTIVE' || !['COLLEGE_ADMIN','PLATFORM_OWNER'].includes(caller.role)) throw forbidden();
  if (caller.role === 'COLLEGE_ADMIN' && caller.organization_id !== organizationId) throw forbidden();
  if (classIds.length) {
    const classes=await userClient.from('classes').select('id,organization_id').in('id',classIds);
    if(classes.error) throw new Error('DATABASE_OPERATION_FAILED');
    if(classes.data.length!==classIds.length || classes.data.some(c=>c.organization_id!==organizationId)) throw badRequest('All classes must belong to the invited organization');
  }
  const created = await serviceClient.auth.admin.createUser({ email, email_confirm:true, user_metadata:{ full_name:fullName } });
  if (created.error) { if (/already|exists/i.test(created.error.message)) throw conflict('USER_EXISTS','An account with this email already exists'); throw new Error('INVITE_CREATE_FAILED'); }
  const id = created.data.user.id;
  const profile = await serviceClient.from('profiles').insert({ id, organization_id:organizationId, role, full_name:fullName, email, status:'ACTIVE' });
  if (profile.error) { try { await serviceClient.auth.admin.deleteUser(id); } catch {} throw new Error('INVITE_PROFILE_FAILED'); }
  if(classIds.length && role!=='COLLEGE_ADMIN') {
    const memberships=await serviceClient.from('class_members').insert(classIds.map(class_id=>({class_id,user_id:id,role:role==='COLLEGE_ADMIN'?'TEACHER':role})));
    if(memberships.error) { try { await serviceClient.auth.admin.deleteUser(id); } catch {} throw new Error('INVITE_MEMBERSHIP_FAILED'); }
  }
  return { userId:id, invited:true };
}
