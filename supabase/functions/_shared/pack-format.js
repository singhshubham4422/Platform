// GENERATED from packages/pack-format/index.js by pnpm check:edge-sync. Do not edit.
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';

const enc = new TextEncoder();
const dec = new TextDecoder();
const LANGUAGES = new Set(['PYTHON', 'C', 'CPP', 'JAVA']);
const OS = new Set(['windows', 'macos', 'linux']);
const ARCH = new Set(['x86_64', 'aarch64']);
const PLACEHOLDERS = new Set(['runtime', 'src', 'out', 'exe', 'memMb', 'main']);
const MAX_PACK = 200 * 1024 * 1024;
const MAX_ENTRY = 50 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const ZIP_OPTIONS = { level: 6, mtime: new Date('1980-01-01T00:00:00.000Z') };

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Expected bytes');
}
function toB64(value) {
  let binary = '';
  for (const b of bytes(value)) binary += String.fromCharCode(b);
  return btoa(binary);
}
function fromB64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function hex(value) { return [...bytes(value)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function jsonBytes(value) { return enc.encode(JSON.stringify(value)); }
function jsonPretty(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function uuid() { return globalThis.crypto.randomUUID(); }
function failure(...errors) { return { ok: false, errors }; }
function valid(ok, value, errors) { return ok ? { ok: true, value } : failure(...errors); }

export async function sha256Hex(data) { return hex(await crypto.subtle.digest('SHA-256', bytes(data))); }

// Ed25519 seeds are raw 32-byte values; Web Crypto imports them with this fixed PKCS#8 prefix.
const ED25519_PKCS8_PREFIX = Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
function privateDer(seed) { const raw = fromB64(seed); if (raw.length !== 32) throw new Error('INVALID_KEY'); const out = new Uint8Array(ED25519_PKCS8_PREFIX.length + raw.length); out.set(ED25519_PKCS8_PREFIX); out.set(raw, ED25519_PKCS8_PREFIX.length); return out; }
export async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const raw = pkcs8.slice(pkcs8.length - 32);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { seedB64: toB64(raw), publicKeyB64: toB64(pub) };
}
export async function signDetached(data, seedB64) {
  try {
    const key = await crypto.subtle.importKey('pkcs8', privateDer(seedB64), { name: 'Ed25519' }, false, ['sign']);
    return toB64(await crypto.subtle.sign({ name: 'Ed25519' }, key, bytes(data)));
  } catch { throw new Error('INVALID_KEY'); }
}
export async function verifyDetached(data, sigB64, publicKeyB64) {
  try {
    const sig = fromB64(sigB64); const raw = fromB64(publicKeyB64);
    if (sig.length !== 64 || raw.length !== 32) return false;
    const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, bytes(data));
  } catch { return false; }
}
export async function encryptHiddenTests(value, keyB64, keyId) {
  const keyBytes = fromB64(keyB64); if (keyBytes.length !== 32) throw new Error('INVALID_KEY');
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, jsonBytes(value));
  return { alg: 'A256GCM', keyId, nonce: toB64(nonce), ciphertext: toB64(ciphertext) };
}
export async function decryptHiddenTests(encFile, keyB64) {
  try {
    if (!encFile || encFile.alg !== 'A256GCM') throw new Error();
    const raw = fromB64(keyB64); if (raw.length !== 32 || fromB64(encFile.nonce).length !== 12) throw new Error();
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(encFile.nonce) }, key, fromB64(encFile.ciphertext));
    return JSON.parse(dec.decode(plain));
  } catch { throw new Error('DECRYPT_FAILED'); }
}

function checkString(v) { return typeof v === 'string' && v.length > 0; }
function placeholderErrors(value, where, errors) {
  for (const match of String(value).matchAll(/\{([^{}]+)\}/g)) if (!PLACEHOLDERS.has(match[1])) errors.push(`${where}: unknown placeholder {${match[1]}}`);
}
export function validateLangIndex(obj) {
  const errors = [];
  if (!obj || obj.schemaVersion !== 1 || !Array.isArray(obj.packs)) return failure('expected schemaVersion 1 and packs array');
  if (!checkString(obj.generatedAt) || Number.isNaN(Date.parse(obj.generatedAt))) errors.push('generatedAt must be a timestamp');
  obj.packs.forEach((p, i) => {
    const at = `packs[${i}]`;
    if (!p || !LANGUAGES.has(p.language)) errors.push(`${at}.language is invalid`);
    if (!OS.has(p?.os)) errors.push(`${at}.os is invalid`);
    if (!ARCH.has(p?.arch)) errors.push(`${at}.arch is invalid`);
    if (!checkString(p?.version)) errors.push(`${at}.version is required`);
    if (!Number.isSafeInteger(p?.size) || p.size < 0) errors.push(`${at}.size is invalid`);
    if (!/^[0-9a-f]{64}$/.test(p?.sha256 ?? '')) errors.push(`${at}.sha256 is invalid`);
    if (typeof p?.path !== 'string' || !p.path.startsWith('packs/lang/') || p.path.includes('..')) errors.push(`${at}.path is invalid`);
    if (p?.language === 'PYTHON' ? p.compile !== null : !Array.isArray(p?.compile)) errors.push(`${at}.compile does not match language`);
    if (!Array.isArray(p?.run) || !p.run.every((x) => typeof x === 'string')) errors.push(`${at}.run is invalid`);
    for (const [k, v] of Object.entries(p ?? {})) if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && placeholderErrors(x, `${at}.${k}`, errors));
    if (!checkString(p?.sourceFile) || !p?.smokeTest || !Array.isArray(p?.licenseFiles)) errors.push(`${at} is missing runtime metadata`);
  });
  return valid(errors.length === 0, obj, errors);
}

export function validateManifest(obj) {
  const errors = [];
  if (!obj || obj.schemaVersion !== 1) return failure('schemaVersion must be 1');
  if (!['COURSE', 'ASSESSMENT'].includes(obj.kind)) errors.push('kind is invalid');
  const expectedId = obj.kind === 'ASSESSMENT' ? obj.assessmentId : obj.courseId;
  if (obj.packId !== `${expectedId}@${obj.version}`) errors.push('packId does not match id and version');
  if (!Number.isSafeInteger(obj.version) || obj.version < 1) errors.push('version must be a positive integer');
  if (!Array.isArray(obj.languages) || obj.languages.length === 0 || obj.languages.some((x) => !LANGUAGES.has(x))) errors.push('languages are invalid');
  if (!Array.isArray(obj.questions) || !Array.isArray(obj.files)) errors.push('questions and files must be arrays');
  if (obj.kind === 'ASSESSMENT' ? !obj.assessment : obj.assessment !== null) errors.push('assessment block does not match kind');
  if (obj.kind === 'ASSESSMENT' && obj.assessment && !obj.assessment.keyId) errors.push('assessment.keyId is required');
  const ids = new Set(); const paths = new Set((obj.files ?? []).map((f) => f.path));
  for (const q of obj.questions ?? []) {
    if (ids.has(q.id)) errors.push(`duplicate question id ${q.id}`); ids.add(q.id);
    if (!paths.has(q.path)) errors.push(`question path missing from files: ${q.path}`);
    if (!paths.has(q.hiddenTestsPath)) errors.push(`hidden tests path missing from files: ${q.hiddenTestsPath}`);
    for (const p of [q.path, q.hiddenTestsPath]) if (!isSafeArchivePath(p)) errors.push(`unsafe question path: ${p}`);
    if (!['EASY', 'MEDIUM', 'HARD'].includes(q.difficulty)) errors.push(`invalid difficulty for ${q.id}`);
  }
  for (const f of obj.files ?? []) if (!isSafeArchivePath(f.path) || !/^[0-9a-f]{64}$/.test(f.sha256 ?? '') || !Number.isSafeInteger(f.size)) errors.push(`invalid file record: ${f.path}`);
  return valid(errors.length === 0, obj, errors);
}
export function validateQuestion(obj) {
  const errors = [];
  if (!obj || !checkString(obj.id) || !checkString(obj.title) || typeof obj.statementMd !== 'string') errors.push('question identity and statement are required');
  for (const [k, max] of [['timeLimitMs',20000],['memoryLimitMb',1024],['outputLimitKb',1024]]) if (!Number.isSafeInteger(obj?.[k]) || obj[k] <= 0 || obj[k] > max) errors.push(`${k} must be a positive integer no greater than ${max}`);
  if (!obj?.starterCode || typeof obj.starterCode !== 'object' || Object.keys(obj.starterCode).some((x) => !LANGUAGES.has(x))) errors.push('starterCode has invalid language');
  if (!Array.isArray(obj?.visibleTests) || obj.visibleTests.length === 0) errors.push('at least one visible test is required');
  return valid(errors.length === 0, obj, errors);
}
export function isSafeArchivePath(p) {
  if (typeof p !== 'string' || !p || p.length > 200 || p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p) || p.includes('\\')) return false;
  const parts = p.split('/');
  return parts.every((x) => x && x !== '.' && x !== '..');
}

export async function buildPack(source) {
  if (source.kind === 'ASSESSMENT' && !source.encryption) throw new Error('INVALID_MANIFEST: assessment encryption required');
  const files = {}; const questions = [];
  const entries = [...source.questions].sort((a,b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const q of entries) {
    const qPath = `questions/${q.id}.json`;
    const hiddenPath = `tests/${q.id}.hidden.${source.encryption ? 'enc' : 'json'}`;
    const question = { id:q.id, title:q.title, statementMd:q.statementMd, timeLimitMs:q.limits.timeLimitMs,
      memoryLimitMb:q.limits.memoryLimitMb, outputLimitKb:q.limits.outputLimitKb, starterCode:q.starterCode, visibleTests:q.visibleTests };
    const hidden = source.encryption ? await encryptHiddenTests({ tests:q.hiddenTests }, source.encryption.keyB64, source.encryption.keyId) : { tests:q.hiddenTests };
    files[qPath] = jsonBytes(question); files[hiddenPath] = jsonBytes(hidden);
    questions.push({ id:q.id, title:q.title, path:qPath, hiddenTestsPath:hiddenPath, topics:q.topics, difficulty:q.difficulty, points:q.points, order:q.order });
  }
  if (source.assetsNotice) files['assets/NOTICE.md'] = enc.encode(source.assetsNotice);
  const fileRows = await Promise.all(Object.entries(files).map(async ([path, content]) => ({ path, sha256:await sha256Hex(content), size:content.length })));
  const manifest = { schemaVersion:1, packId:`${source.kind === 'ASSESSMENT' ? source.assessmentId : source.courseId}@${source.version}`,
    kind:source.kind, courseId:source.courseId, assessmentId:source.assessmentId ?? null, organizationId:source.organizationId ?? null,
    version:source.version, minAppVersion:source.minAppVersion, title:source.title, languages:source.languages,
    createdAt:source.createdAt ?? '1980-01-01T00:00:00.000Z', questions, files:fileRows, assessment:source.assessment ?? null,
    ...(source.status ? { status:source.status } : {}) };
  const result = validateManifest(manifest); if (!result.ok) throw new Error(`INVALID_MANIFEST: ${result.errors.join('; ')}`);
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.json') && path.startsWith('questions/')) { const qv = validateQuestion(JSON.parse(dec.decode(content))); if (!qv.ok) throw new Error(`INVALID_MANIFEST: ${qv.errors.join('; ')}`); }
  }
  const zipped = zipSync({ ...files, 'manifest.json':jsonBytes(manifest) }, ZIP_OPTIONS);
  if (zipped.length > MAX_PACK) throw new Error('UNSAFE_ARCHIVE: pack too large');
  return { bytes:zipped, manifest, sha256:await sha256Hex(zipped) };
}
export async function readPack(data, { publicKeyB64, sigB64 } = {}) {
  const input = bytes(data);
  if (input.length > MAX_PACK) throw new Error('UNSAFE_ARCHIVE');
  if (!await verifyDetached(input, sigB64, publicKeyB64)) throw new Error('SIGNATURE_INVALID');
  let archive;
  try { archive = unzipSync(input); } catch { throw new Error('UNSAFE_ARCHIVE'); }
  const names = Object.keys(archive);
  if (names.length > MAX_ENTRIES || !archive['manifest.json']) throw new Error('UNSAFE_ARCHIVE');
  for (const [name, content] of Object.entries(archive)) if (!isSafeArchivePath(name) || content.length > MAX_ENTRY) throw new Error('UNSAFE_ARCHIVE');
  let manifest;
  try { manifest = JSON.parse(dec.decode(archive['manifest.json'])); } catch { throw new Error('INVALID_MANIFEST: malformed JSON'); }
  const mv = validateManifest(manifest); if (!mv.ok) throw new Error(`INVALID_MANIFEST: ${mv.errors.join('; ')}`);
  const expected = new Map(manifest.files.map((f) => [f.path, f]));
  for (const name of names) if (name !== 'manifest.json' && !expected.has(name)) throw new Error('UNSAFE_ARCHIVE');
  if (names.length !== expected.size + 1) throw new Error('UNSAFE_ARCHIVE');
  for (const [name, f] of expected) {
    const content = archive[name]; if (!content) throw new Error('UNSAFE_ARCHIVE');
    if (content.length !== f.size || await sha256Hex(content) !== f.sha256) throw new Error('HASH_MISMATCH');
  }
  const questions = new Map(); const hidden = manifest.kind === 'ASSESSMENT' ? null : new Map();
  for (const q of manifest.questions) {
    let qdata; try { qdata = JSON.parse(dec.decode(archive[q.path])); } catch { throw new Error('INVALID_MANIFEST: malformed question'); }
    const qv = validateQuestion(qdata); if (!qv.ok) throw new Error(`INVALID_MANIFEST: ${qv.errors.join('; ')}`);
    questions.set(q.id, qdata);
    if (hidden && q.hiddenTestsPath.endsWith('.json')) hidden.set(q.id, JSON.parse(dec.decode(archive[q.hiddenTestsPath])));
  }
  return { manifest, questions, hidden };
}
export async function buildLangIndexEntry(entry) {
  return { language:entry.language, version:entry.version, os:entry.os, arch:entry.arch, size:bytes(entry.zipBytes).length,
    sha256:await sha256Hex(entry.zipBytes), path:entry.path, sourceFile:entry.sourceFile, compile:entry.compile,
    run:entry.run, smokeTest:entry.smokeTest, licenseFiles:entry.licenseFiles };
}
export function buildLangIndex(entries) {
  const packs = [...entries].sort((a,b) => [a.language,a.version,a.os,a.arch].join('\0').localeCompare([b.language,b.version,b.os,b.arch].join('\0')));
  const value = { schemaVersion:1, generatedAt:new Date().toISOString(), packs };
  const json = jsonPretty(value); return { json, bytes:enc.encode(json) };
}

export const _packInternals = { toB64, fromB64, jsonBytes, MAX_PACK, MAX_ENTRY, MAX_ENTRIES };
