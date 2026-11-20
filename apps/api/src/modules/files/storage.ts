// Provider-independent private object storage.
//   STORAGE_PROVIDER=local  files under STORAGE_LOCAL_DIR (development / single-node installs)
//   STORAGE_PROVIDER=oci    OCI Object Storage via signed server-side requests (requires OCI_* variables)
// Objects are never public: clients receive short-lived, user-scoped download tokens from the API.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { authorizeOciObjectOperation, getOciStatus } from '../../integrations/oci.js';
import { getJwtSecret } from '../../lib/env.js';

export interface StorageProvider {
  readonly name: 'local' | 'oci';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalStorage implements StorageProvider {
  readonly name = 'local' as const;
  constructor(private readonly root: string) {}
  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root) + sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, body: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: 'wx' });
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
}

class OciStorage implements StorageProvider {
  readonly name = 'oci' as const;
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const signed = authorizeOciObjectOperation({ method: 'PUT', objectKey: key });
    const res = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: { ...signed.headers, 'content-type': contentType, 'content-length': String(body.length) },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`OCI upload failed (${res.status})`);
  }
  async get(key: string): Promise<Buffer> {
    const signed = authorizeOciObjectOperation({ method: 'GET', objectKey: key });
    const res = await fetch(signed.uploadUrl, { headers: signed.headers });
    if (!res.ok) throw new Error(`OCI download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}

let cached: StorageProvider | null | undefined;
export function getStorage(): StorageProvider | null {
  if (cached !== undefined) return cached;
  const kind = (process.env.STORAGE_PROVIDER || '').trim();
  if (kind === 'local') {
    const root = process.env.STORAGE_LOCAL_DIR || join(process.cwd(), '..', '..', '.local', 'storage');
    cached = new LocalStorage(root);
  } else if (kind === 'oci') {
    cached = getOciStatus().objectStorageConfigured ? new OciStorage() : null;
  } else {
    cached = null;
  }
  return cached;
}

export function storageStatus() {
  const s = getStorage();
  return {
    provider: s?.name ?? 'not-configured',
    configured: Boolean(s),
    maxUploadMb: maxUploadMb(),
    oci: getOciStatus(),
  };
}

export function maxUploadMb(): number {
  return Math.max(1, Number(process.env.STORAGE_MAX_UPLOAD_MB || 25));
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// ---------- content validation ----------
const EXT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
  txt: 'text/plain',
  md: 'text/markdown',
  py: 'text/x-python',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  java: 'text/x-java',
};

function sniff(buf: Buffer): 'pdf' | 'ole' | 'zip' | 'png' | 'jpeg' | 'gif' | 'webp' | 'text' | 'unknown' {
  const h = buf.subarray(0, 12);
  if (h.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (h.readUInt32BE(0) === 0xd0cf11e0) return 'ole';
  if (h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5)) return 'zip';
  if (h.readUInt32BE(0) === 0x89504e47) return 'png';
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'jpeg';
  if (h.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const sample = buf.subarray(0, 4096);
  if (!sample.includes(0) && Buffer.from(sample.toString('utf8'), 'utf8').equals(sample)) return 'text';
  return 'unknown';
}

const SNIFF_FOR_EXT: Record<string, string[]> = {
  pdf: ['pdf'], doc: ['ole'], ppt: ['ole'], docx: ['zip'], pptx: ['zip'], zip: ['zip'], png: ['png'], jpg: ['jpeg'], jpeg: ['jpeg'],
  gif: ['gif'], webp: ['webp'], txt: ['text'], md: ['text'], py: ['text'], c: ['text'], h: ['text'], cpp: ['text'], java: ['text'],
};

/** Returns the canonical content type, or throws when the bytes do not match an allowed type. */
export function validateUpload(fileName: string, body: Buffer): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const type = EXT_TYPES[ext];
  if (!type) throw new Error(`File type .${ext} is not allowed`);
  if (body.length === 0) throw new Error('File is empty');
  if (!SNIFF_FOR_EXT[ext].includes(sniff(body))) throw new Error(`File content does not match the .${ext} extension`);
  return type;
}

// ---------- short-lived download tokens ----------
export function signDownloadToken(fileId: string, userId: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${fileId}.${userId}.${exp}`;
  const sig = createHmac('sha256', Buffer.from(getJwtSecret())).update(`dl:${payload}`).digest('base64url');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyDownloadToken(token: string): { fileId: string; userId: string } | null {
  try {
    const [fileId, userId, exp, sig] = Buffer.from(token, 'base64url').toString('utf8').split('.');
    if (!fileId || !userId || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
    const expected = createHmac('sha256', Buffer.from(getJwtSecret())).update(`dl:${fileId}.${userId}.${exp}`).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b) ? { fileId, userId } : null;
  } catch {
    return null;
  }
}

