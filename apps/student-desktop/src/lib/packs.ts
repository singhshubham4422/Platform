import { invoke, isTauri } from '@tauri-apps/api/core';
import type { RunResult, Limits } from './runner';

export type PackInfo={packId:string;kind:'COURSE'|'ASSESSMENT';courseId:string;assessmentId:string|null;version:number;title:string;languages:string[];questionCount:number;installedAt:string};
export type QuestionSummary={id:string;title:string;topics:string[];difficulty:string;points:number;order:number};
export type QuestionView=QuestionSummary&{statementMd:string;limits:Limits;starterCode:Partial<Record<string,string>>;visibleTests:Array<{id:string;input:string;expectedOutput:string}>};
const desktop=()=>{if(!isTauri())throw new Error('DESKTOP_ONLY')};
export async function packsInstallFromUrl(url:string,sigUrl:string,expectedSha256:string){desktop();return invoke<PackInfo>('packs_install_from_url',{url,sigUrl,expectedSha256});}
export async function packsImportFile(path:string){desktop();return invoke<PackInfo>('packs_import_file',{path});}
export async function packsList(){desktop();return invoke<PackInfo[]>('packs_list');}
export async function packsRemove(packId:string){desktop();return invoke<void>('packs_remove',{packId});}
export async function packsListQuestions(packId:string){desktop();return invoke<QuestionSummary[]>('packs_list_questions',{packId});}
export async function packsGetQuestion(packId:string,questionId:string){desktop();return invoke<QuestionView>('packs_get_question',{packId,questionId});}
export async function runQuestion(packId:string,questionId:string,language:string,source:string,mode:'RUN'|'SUBMIT'){desktop();return invoke<RunResult>('run_question',{packId,questionId,language,source,mode});}
export interface PackDownload { url: string; sigUrl: string; sha256: string; size: number; expiresAt: string }
/** Short-lived signed download links from the broker (C8 `pack-download-url`). RLS decides access. */
export async function getPackDownloadUrl(packId: string): Promise<PackDownload> {
  const { callBroker } = await import('./broker');
  return callBroker<PackDownload>('pack-download-url', { packId });
}
/** Downloads, verifies and installs a pack the student is allowed to read. */
export async function installPackFromBroker(packId: string): Promise<PackInfo> {
  const d = await getPackDownloadUrl(packId);
  return packsInstallFromUrl(d.url, d.sigUrl, d.sha256);
}
/** Published courses with their newest pack, marked installed / update available / not installed. */
export async function listCatalog() {
  const { fetchCatalog } = await import('./catalog');
  return fetchCatalog(await packsList());
}
