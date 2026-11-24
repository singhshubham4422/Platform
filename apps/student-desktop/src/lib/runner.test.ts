import { describe, expect, it, vi } from 'vitest';
import { runCustom, verdictLabel } from './runner';

describe('desktop local runner bridge',()=>{
 it('reuses the shared verdict label',()=>expect(verdictLabel('ACCEPTED')).toBe('Accepted'));
 it('rejects execution outside Tauri',async()=>{vi.stubGlobal('window',{});await expect(runCustom('PYTHON','print(1)','',{timeLimitMs:100,memoryLimitMb:64,outputLimitKb:64})).rejects.toThrow('DESKTOP_ONLY');vi.unstubAllGlobals();});
});
