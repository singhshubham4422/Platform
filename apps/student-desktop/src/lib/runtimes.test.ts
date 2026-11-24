import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), tauri: false }));
const { invoke, listen } = mocks;
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args), isTauri: () => mocks.tauri }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => mocks.listen(...args) }));

describe('runtime commands', () => {
  afterEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.unstubAllEnvs(); mocks.tauri = false; });

  it('rejects every command outside Tauri', async () => {
    const api = await import('./runtimes');
    expect(() => api.runtimesList()).toThrow('DESKTOP_ONLY');
    expect(() => api.runtimesAvailable()).toThrow('DESKTOP_ONLY');
    expect(() => api.runtimesInstall('JAVA')).toThrow('DESKTOP_ONLY');
    await expect(api.runtimesRemove('JAVA', '21')).rejects.toThrow('DESKTOP_ONLY');
    await expect(api.onInstallProgress(() => {})).rejects.toThrow('DESKTOP_ONLY');
  });

  it('requires an explicit packs base URL', async () => {
    mocks.tauri = true;
    vi.stubEnv('VITE_LANG_PACKS_BASE_URL', '');
    const api = await import('./runtimes');
    expect(() => api.runtimesAvailable()).toThrow('VITE_LANG_PACKS_BASE_URL is not configured');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('guards event payloads and forwards valid progress', async () => {
    mocks.tauri = true;
    const unlisten = vi.fn(); listen.mockImplementation(async (_name, handler) => { handler({ payload: { language:'JAVA', stage:'download', receivedBytes:5, totalBytes:10, message:'Downloading' } }); handler({ payload:{ language:'JAVA', stage:'unsafe', receivedBytes:0, totalBytes:1, message:'bad' } }); return unlisten; });
    const api = await import('./runtimes'); const cb = vi.fn();
    expect(api.isRuntimeProgress({ language:'JAVA', stage:'done', receivedBytes:1, totalBytes:1, message:'ok' })).toBe(true);
    expect(api.isRuntimeProgress({ language:'BAD', stage:'done', receivedBytes:1, totalBytes:1, message:'ok' })).toBe(false);
    await expect(api.onInstallProgress(cb)).resolves.toBe(unlisten);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
