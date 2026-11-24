import {afterEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),tauri:false}));
vi.mock('@tauri-apps/api/core',()=>({invoke:(...a:unknown[])=>mocks.invoke(...a),isTauri:()=>mocks.tauri}));
describe('course pack command wrappers',()=>{afterEach(()=>{vi.clearAllMocks();vi.resetModules();mocks.tauri=false});
 it('rejects commands outside Tauri and leaves broker operations explicit',async()=>{const p=await import('./packs');await expect(p.packsList()).rejects.toThrow('DESKTOP_ONLY');await expect(p.getPackDownloadUrl('c@1')).rejects.toThrow('BROKER_NOT_CONNECTED');await expect(p.listCatalog()).rejects.toThrow('BROKER_NOT_CONNECTED')});
 it('uses the frozen C6 camelCase arguments',async()=>{mocks.tauri=true;mocks.invoke.mockResolvedValue([]);const p=await import('./packs');await p.packsInstallFromUrl('https://a','https://b','hash');await p.packsGetQuestion('c@1','q');await p.runQuestion('c@1','q','JAVA','code','SUBMIT');expect(mocks.invoke.mock.calls).toEqual([['packs_install_from_url',{url:'https://a',sigUrl:'https://b',expectedSha256:'hash'}],['packs_get_question',{packId:'c@1',questionId:'q'}],['run_question',{packId:'c@1',questionId:'q',language:'JAVA',source:'code',mode:'SUBMIT'}]])});
});
