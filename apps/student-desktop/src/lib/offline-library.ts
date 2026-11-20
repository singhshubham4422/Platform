// Offline course library: versioned package manifests and resource blobs in IndexedDB.
// Every resource is verified against the manifest SHA-256 before it is stored.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { downloadSigned, fetchLatestPackage, type PackageResource } from './coding-api';

const DB_NAME = 'lp-offline-library';
const DB_VERSION = 1;

interface StoredManifest {
  courseId: string;
  courseTitle: string;
  version: number;
  resources: PackageResource[];
  downloadedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('manifests')) db.createObjectStore('manifests', { keyPath: 'courseId' });
      if (!db.objectStoreNames.contains('resources')) db.createObjectStore('resources');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Manifests (package versions and checksums) live in the native SQLite course_cache table in the
// desktop app; resource bytes stay in IndexedDB keyed by SHA-256.
export async function listStoredManifests(): Promise<StoredManifest[]> {
  if (isTauri()) return (await invoke<string[]>('store_list_courses')).map((m) => JSON.parse(m) as StoredManifest);
  return tx<StoredManifest[]>('manifests', 'readonly', (s) => s.getAll());
}
export async function getStoredManifest(courseId: string): Promise<StoredManifest | undefined> {
  if (isTauri()) return (await listStoredManifests()).find((m) => m.courseId === courseId);
  return tx<StoredManifest | undefined>('manifests', 'readonly', (s) => s.get(courseId));
}
async function putManifest(m: StoredManifest): Promise<void> {
  if (isTauri()) await invoke('store_put_course', { courseId: m.courseId, version: m.version, manifestJson: JSON.stringify(m) });
  else await tx('manifests', 'readwrite', (s) => s.put(m));
}

export interface PackageStatus {
  available: boolean;
  serverVersion: number | null;
  localVersion: number | null;
  updateAvailable: boolean;
  resourceCount: number;
  totalBytes: number;
}

export async function packageStatus(courseId: string): Promise<PackageStatus> {
  const [remote, local] = await Promise.all([fetchLatestPackage(courseId).catch(() => null), getStoredManifest(courseId)]);
  const serverVersion = remote?.available ? (remote.version ?? null) : null;
  return {
    available: Boolean(remote?.available),
    serverVersion,
    localVersion: local?.version ?? null,
    updateAvailable: serverVersion !== null && serverVersion !== (local?.version ?? null),
    resourceCount: remote?.manifest?.resources.length ?? local?.resources.length ?? 0,
    totalBytes: (remote?.manifest?.resources ?? local?.resources ?? []).reduce((a, r) => a + r.sizeBytes, 0),
  };
}

/**
 * Download (or incrementally update) a course package. Resources already stored with the same
 * checksum are reused; mismatching downloads are rejected and nothing partial is committed.
 */
export async function downloadCoursePackage(courseId: string, onProgress?: (done: number, total: number) => void): Promise<StoredManifest> {
  const pkg = await fetchLatestPackage(courseId);
  if (!pkg.available || !pkg.manifest || !pkg.downloads) throw new Error('No downloadable package has been published for this course yet.');
  const resources = pkg.manifest.resources;
  let done = 0;
  for (const res of resources) {
    const existing = await tx<ArrayBuffer | undefined>('resources', 'readonly', (s) => s.get(res.sha256));
    if (!existing) {
      const url = pkg.downloads[res.fileId];
      if (!url) throw new Error(`Missing download link for ${res.name}`);
      const bytes = await downloadSigned(url);
      const actual = await sha256Hex(bytes);
      if (actual !== res.sha256) throw new Error(`Checksum mismatch for ${res.name}; download discarded.`);
      await tx('resources', 'readwrite', (s) => s.put(bytes, res.sha256));
    }
    done += 1;
    onProgress?.(done, resources.length);
  }
  const manifest: StoredManifest = {
    courseId,
    courseTitle: pkg.manifest.courseTitle,
    version: pkg.manifest.packageVersion,
    resources,
    downloadedAt: new Date().toISOString(),
  };
  await putManifest(manifest);
  return manifest;
}

/** Object URL for an offline resource (revoke it when no longer displayed). */
export async function openOfflineResource(res: PackageResource): Promise<string> {
  const bytes = await tx<ArrayBuffer | undefined>('resources', 'readonly', (s) => s.get(res.sha256));
  if (!bytes) throw new Error('This resource is not downloaded.');
  return URL.createObjectURL(new Blob([bytes], { type: res.contentType }));
}

export async function removeCoursePackage(courseId: string): Promise<void> {
  if (isTauri()) await invoke('store_delete_course', { courseId });
  else await tx('manifests', 'readwrite', (s) => s.delete(courseId));
}
