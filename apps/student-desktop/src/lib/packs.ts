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
// TODO(offline-integration): connect through phase 07 broker and phase 05 auth/session.
export async function getPackDownloadUrl(_packId:string):Promise<never>{throw new Error('BROKER_NOT_CONNECTED');}
// TODO(offline-integration): populate from the phase 07 broker catalog.
export async function listCatalog():Promise<never>{throw new Error('BROKER_NOT_CONNECTED');}
