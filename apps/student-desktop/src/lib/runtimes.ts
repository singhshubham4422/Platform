import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type LanguageId = 'PYTHON' | 'C' | 'CPP' | 'JAVA';
export type RuntimeInfo = { language: LanguageId; version: string; path: string; installedAt: string };
export type IndexEntry = {
  language: LanguageId;
  version: string;
  os: 'windows' | 'macos' | 'linux';
  arch: 'x86_64' | 'aarch64';
  size: number;
  sha256: string;
  path: string;
  sourceFile: string;
  compile: string[] | null;
  run: string[];
  smokeTest: { source: string; expectedOutput: string };
  licenseFiles: string[];
};
export type RuntimeInstallProgress = {
  language: LanguageId;
  stage: 'download' | 'verify' | 'extract' | 'smoke' | 'done' | 'error';
  receivedBytes: number;
  totalBytes: number;
  message: string;
};

function desktopOnly(): void {
  if (!isTauri()) throw new Error('DESKTOP_ONLY');
}
function baseUrl(): string {
  const value = import.meta.env.VITE_LANG_PACKS_BASE_URL?.trim();
  if (!value) throw new Error('VITE_LANG_PACKS_BASE_URL is not configured');
  return value;
}
export function isRuntimeProgress(value: unknown): value is RuntimeInstallProgress {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['PYTHON', 'C', 'CPP', 'JAVA'].includes(String(item.language)) &&
    ['download', 'verify', 'extract', 'smoke', 'done', 'error'].includes(String(item.stage)) &&
    typeof item.receivedBytes === 'number' && Number.isFinite(item.receivedBytes) &&
    typeof item.totalBytes === 'number' && Number.isFinite(item.totalBytes) && typeof item.message === 'string';
}
export function runtimesList(): Promise<RuntimeInfo[]> {
  desktopOnly();
  return invoke<RuntimeInfo[]>('runtimes_list');
}
export function runtimesAvailable(): Promise<IndexEntry[]> {
  desktopOnly();
  return invoke<IndexEntry[]>('runtimes_available', { baseUrl: baseUrl() });
}
export function runtimesInstall(language: LanguageId): Promise<RuntimeInfo> {
  desktopOnly();
  return invoke<RuntimeInfo>('runtimes_install', { baseUrl: baseUrl(), language });
}
export async function runtimesRemove(language: LanguageId, version: string): Promise<void> {
  desktopOnly();
  await invoke('runtimes_remove', { language, version });
}
export async function onInstallProgress(callback: (progress: RuntimeInstallProgress) => void): Promise<UnlistenFn> {
  desktopOnly();
  return listen<unknown>('runtime-install-progress', (event) => {
    if (isRuntimeProgress(event.payload)) callback(event.payload);
  });
}
