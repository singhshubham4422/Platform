#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, lstat, chmod } from 'node:fs/promises';
import { existsSync, globSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { buildPack, buildLangIndexEntry, buildLangIndex, generateKeyPair, signDetached, verifyDetached, readPack, validateLangIndex, isSafeArchivePath } from '../index.js';

const ns = 'cc68c2ab-4a45-5e20-9a77-6f2e66e3e6a1';
function args(argv) { const [cmd, ...rest] = argv; const out = { _:cmd }; for (let i=0;i<rest.length;i++) { if (rest[i].startsWith('--')) out[rest[i].slice(2)] = rest[i+1]?.startsWith('--') ? true : rest[++i]; } return out; }
function need(a, ...keys) { for (const k of keys) if (!a[k]) throw new Error(`Missing --${k}`); }
function decode(s) { return new Uint8Array(Buffer.from(s.trim(), 'base64')); }
async function keyText(value) { try { return (await readFile(value, 'utf8')).trim(); } catch { return value; } }
async function writeNew(file, data, force) { await mkdir(path.dirname(file), { recursive:true }); await writeFile(file, data, { flag:force?'w':'wx' }); }
function defaults(lang) {
  const src = { JAVA:'{main}.java', PYTHON:'main.py', C:'main.c', CPP:'main.cpp' }[lang];
  const compile = { JAVA:['{runtime}/bin/javac','-encoding','UTF-8','-d','{out}','{src}'], PYTHON:null,
    C:['{runtime}/bin/gcc','-std=c11','-O2','-o','{exe}','{src}'], CPP:['{runtime}/bin/g++','-std=c++17','-O2','-o','{exe}','{src}'] }[lang];
  const run = { JAVA:['{runtime}/bin/java','-Xmx{memMb}m','-Xss64m','-cp','{out}','{main}'], PYTHON:['{runtime}/python.exe','{src}'],
    C:['{exe}'], CPP:['{exe}'] }[lang];
  const smokeSource = {
    JAVA:'public class Main { public static void main(String[] args) { System.out.print("ok"); } }',
    PYTHON:'print("ok")', C:'#include <stdio.h>\nint main(void) { puts("ok"); return 0; }',
    CPP:'#include <iostream>\nint main() { std::cout << "ok"; return 0; }',
  }[lang];
  return { sourceFile:src, compile, run, smokeTest:{ source:smokeSource, expectedOutput:'ok' }, licenseFiles:['LICENSE','THIRD_PARTY_NOTICES'] };
}
async function walk(root, rel='') { const rows=[]; for (const ent of await readdir(path.join(root,rel), {withFileTypes:true})) { const r=path.posix.join(rel,ent.name); const st=await lstat(path.join(root,r)); if (st.isSymbolicLink()) throw new Error(`Symlink rejected: ${r}`); if (ent.isDirectory()) rows.push(...await walk(root,r)); else if (ent.isFile()) { if (!isSafeArchivePath(r)) throw new Error(`Unsafe path: ${r}`); rows.push(r); } } return rows; }
async function main() {
  const a = args(process.argv.slice(2));
  if (a._ === 'keygen') {
    need(a,'role','out'); if (!['release','pack'].includes(a.role)) throw new Error('--role must be release or pack');
    const kp=await generateKeyPair(); const dir=path.resolve(a.out); await mkdir(dir,{recursive:true});
    if(!a.force && (existsSync(path.join(dir,`${a.role}.seed`)) || existsSync(path.join(dir,`${a.role}.pub`)))) throw new Error(`Key files already exist in ${dir}`);
    await writeNew(path.join(dir,`${a.role}.seed`),`${kp.seedB64}\n`,Boolean(a.force)); await chmod(path.join(dir,`${a.role}.seed`),0o600).catch(()=>{});
    await writeNew(path.join(dir,`${a.role}.pub`),`${kp.publicKeyB64}\n`,Boolean(a.force)); console.log(`Wrote ${path.join(dir,a.role+'.seed')} and ${path.join(dir,a.role+'.pub')}`); console.log(`Public key: ${kp.publicKeyB64}`); return;
  }
  if (a._ === 'import-jplatform') {
    need(a,'in','out','course-id','version','title'); const bank=JSON.parse(await readFile(a.in,'utf8')); const warnings=[];
    const questions=bank.questions.map((q,i)=>{
      const idBytes=createHash('sha1').update(Buffer.from(ns.replaceAll('-',''),'hex')).update(q.slug).digest(); idBytes[6]=(idBytes[6]&0x0f)|0x50; idBytes[8]=(idBytes[8]&0x3f)|0x80;
      const id=[...idBytes.subarray(0,16)].map((b)=>b.toString(16).padStart(2,'0')).join(''); const uuid=`${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
      const visible=q.testCases.filter(t=>!t.isHidden).map((t,j)=>({id:`v${j+1}`,input:t.input,expectedOutput:t.expectedOutput}));
      const hidden=q.testCases.filter(t=>t.isHidden).map((t,j)=>({id:`h${j+1}`,input:t.input,expectedOutput:t.expectedOutput}));
      if (!visible.length && hidden.length) { visible.push({...hidden.shift(),id:'v1'}); warnings.push(q.slug); }
      const difficulty=({Beginner:'EASY',Easy:'EASY',Medium:'MEDIUM',Hard:'HARD'})[q.difficulty];
      return { id:uuid,title:q.title,topics:[q.category.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')],difficulty,points:difficulty==='EASY'?10:difficulty==='MEDIUM'?20:30,order:i+1,
        statementMd:q.description+(q.constraints?`\n\n**Constraints:** ${q.constraints}`:''),limits:{timeLimitMs:2000,memoryLimitMb:256,outputLimitKb:64},starterCode:{JAVA:q.starterCode},visibleTests:visible,hiddenTests:hidden };
    });
    const source={kind:'COURSE',courseId:a['course-id'],assessmentId:null,organizationId:null,version:Number(a.version),minAppVersion:'0.5.0',title:a.title,languages:['JAVA'],questions,assessment:null,encryption:null,status:bank.meta.status};
    source.assetsNotice=(await readFile('content/j-platform-question-bank/J_PLATFORM_THIRD_PARTY_NOTICES.md','utf8'));
    await mkdir(path.dirname(path.resolve(a.out)),{recursive:true}); await writeFile(a.out,JSON.stringify(source,null,2)+'\n');
    if(warnings.length) console.warn(`Questions moved from hidden to visible (${warnings.length}): ${warnings.join(', ')}`); console.log(`Wrote ${a.out} (${questions.length} questions)`); return;
  }
  if (a._ === 'course-pack') {
    need(a,'source','out','seed'); const source=JSON.parse(await readFile(a.source,'utf8')); const seed=await keyText(a.seed);
    if(a['encrypt-key']) { need(a,'key-id'); source.encryption={keyB64:await keyText(a['encrypt-key']),keyId:a['key-id']}; }
    const {bytes,manifest}=await buildPack(source); const sig=await signDetached(bytes,seed); const dir=path.resolve(a.out,manifest.courseId);
    await mkdir(dir,{recursive:true}); await writeFile(path.join(dir,`${manifest.version}.lpack`),bytes); await writeFile(path.join(dir,`${manifest.version}.lpack.sig`),sig+'\n');
    console.log(`Wrote ${path.join(dir,`${manifest.version}.lpack`)}`); return;
  }
  if (a._ === 'lang-pack') {
    need(a,'language','version','os','arch','dir','out','seed'); const lang=a.language.toUpperCase(); const folder=path.resolve(a.dir); const files={};
    for(const rel of await walk(folder)){ const content=new Uint8Array(await readFile(path.join(folder,rel))); files[rel]=content; }
    const zip=zipSync(files,{level:6,mtime:new Date('1980-01-01T00:00:00.000Z')}); const out=path.resolve(a.out); await mkdir(out,{recursive:true});
    const archiveName=`${a.os}-${a.arch}.zip`; await writeFile(path.join(out,archiveName),zip); await writeFile(path.join(out,archiveName+'.sig'),await signDetached(zip,await keyText(a.seed))+'\n');
    const d=defaults(lang); const compileJson=a['compile-json']?JSON.parse(await readFile(a['compile-json'],'utf8')):d.compile; const runJson=a['run-json']?JSON.parse(await readFile(a['run-json'],'utf8')):d.run;
    const entry=await buildLangIndexEntry({language:lang,version:a.version,os:a.os,arch:a.arch,zipBytes:zip,path:`packs/lang/${lang.toLowerCase()}/${a.version}/${archiveName}`,sourceFile:d.sourceFile,compile:compileJson,run:runJson,smokeTest:d.smokeTest,licenseFiles:d.licenseFiles});
    await writeFile(path.join(out,'entry.json'),JSON.stringify(entry,null,2)+'\n'); console.log(`Wrote ${path.join(out,archiveName)}, signature and entry.json`); return;
  }
  if (a._ === 'lang-index') {
    need(a,'entries','out','seed'); const dir=path.resolve(a.entries); const ents=[];
    let paths=[];
    if (/[*?[]{}]/.test(a.entries)) paths=globSync(a.entries,{windowsPathsNoEscape:true});
    else { const stat=await lstat(dir); paths=stat.isDirectory()?(await readdir(dir)).filter(f=>f.endsWith('entry.json')).map(f=>path.join(dir,f)):[dir]; }
    for(const f of paths) if(f.endsWith('entry.json')) ents.push(JSON.parse(await readFile(f,'utf8')));
    const index=buildLangIndex(ents); const out=path.resolve(a.out); await mkdir(out,{recursive:true}); await writeFile(path.join(out,'index.json'),index.bytes); await writeFile(path.join(out,'index.json.sig'),await signDetached(index.bytes,await keyText(a.seed))+'\n'); console.log(`Wrote ${path.join(out,'index.json')} and signature`); return;
  }
  if (a._ === 'verify') {
    need(a,'file','sig','pub'); const data=new Uint8Array(await readFile(a.file)); const sig=await readFile(a.sig,'utf8'); const pub=await keyText(a.pub);
    try {
      if (a.kind === 'pack') await readPack(data,{publicKeyB64:pub,sigB64:sig});
      else if (a.kind === 'lang-index') {
        if (!await verifyDetached(data,sig,pub)) throw new Error('SIGNATURE_INVALID');
        const check=validateLangIndex(JSON.parse(Buffer.from(data).toString('utf8'))); if (!check.ok) throw new Error(`INVALID_MANIFEST: ${check.errors.join('; ')}`);
      } else if (!await verifyDetached(data,sig,pub)) throw new Error('SIGNATURE_INVALID');
      console.log('OK');
    } catch(e) { console.error(e.message); process.exitCode=1; } return;
  }
  throw new Error('Usage: lplatform-pack <keygen|lang-pack|lang-index|course-pack|verify|import-jplatform> [options]');
}
main().catch((e)=>{console.error(e.message);process.exitCode=1;});
