import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import {
  generateKeyPair, signDetached, verifyDetached, encryptHiddenTests, decryptHiddenTests,
  validateLangIndex, validateManifest, validateQuestion, isSafeArchivePath, buildPack, readPack,
  buildLangIndexEntry, buildLangIndex,
} from '../index.js';

const fixture = (overrides={}) => ({ kind:'COURSE', courseId:'123e4567-e89b-42d3-a456-426614174000', assessmentId:null,
  organizationId:null, version:1, minAppVersion:'0.5.0', title:'Test course', languages:['JAVA'], assessment:null, encryption:null,
  questions:[{id:'123e4567-e89b-42d3-a456-426614174001',title:'Hello',topics:['basics'],difficulty:'EASY',points:10,order:1,
    statementMd:'Print hello',limits:{timeLimitMs:1000,memoryLimitMb:128,outputLimitKb:64},starterCode:{JAVA:'public class Main {}'},
    visibleTests:[{id:'v1',input:'',expectedOutput:'ok'}],hiddenTests:[{id:'h1',input:'',expectedOutput:'ok'}]}], ...overrides });

test('Ed25519 signing round trip, tampering and malformed values', async()=>{
  const kp=await generateKeyPair(); const data=new TextEncoder().encode('signed payload'); const sig=await signDetached(data,kp.seedB64);
  assert.equal(await verifyDetached(data,sig,kp.publicKeyB64),true);
  const changed=data.slice(); changed[0]^=1; assert.equal(await verifyDetached(changed,sig,kp.publicKeyB64),false);
  assert.equal(await verifyDetached(data,'bad','bad'),false);
});
test('AES-GCM round trip and wrong key error', async()=>{
  const key=Buffer.alloc(32,7).toString('base64'); const other=Buffer.alloc(32,8).toString('base64');
  const enc=await encryptHiddenTests({tests:[{id:'h1'}]},key,'key-id'); assert.deepEqual(await decryptHiddenTests(enc,key),{tests:[{id:'h1'}]});
  await assert.rejects(decryptHiddenTests(enc,other),{message:'DECRYPT_FAILED'});
});
test('language index validation rejects contract violations',()=>{
  const p={language:'JAVA',version:'21',os:'windows',arch:'x86_64',size:3,sha256:'a'.repeat(64),path:'packs/lang/java/21/windows-x86_64.zip',sourceFile:'{main}.java',compile:['{runtime}/javac','{src}'],run:['{runtime}/java','{main}'],smokeTest:{source:'x',expectedOutput:'ok'},licenseFiles:['LICENSE']};
  const index={schemaVersion:1,generatedAt:'2026-11-24T00:00:00.000Z',packs:[p]}; assert.equal(validateLangIndex(index).ok,true);
  for(const change of [{language:'RUST'},{sha256:'no'},{path:'packs/lang/../x'},{run:['{bad}']},{compile:null}]) assert.equal(validateLangIndex({...index,packs:[{...p,...change}]}).ok,false);
});
test('manifest and question validation',()=>{
  const src=fixture(); const q={id:'q',title:'q',statementMd:'x',timeLimitMs:1,memoryLimitMb:1,outputLimitKb:1,starterCode:{JAVA:'x'},visibleTests:[{id:'v',input:'',expectedOutput:''}]};
  assert.equal(validateQuestion(q).ok,true); for(const change of [{timeLimitMs:20001},{memoryLimitMb:1025},{outputLimitKb:1025},{starterCode:{BAD:'x'}},{visibleTests:[]}]) assert.equal(validateQuestion({...q,...change}).ok,false);
  const m={schemaVersion:1,packId:`${src.courseId}@1`,kind:'COURSE',courseId:src.courseId,assessmentId:null,organizationId:null,version:1,minAppVersion:'0.5.0',title:'x',languages:['JAVA'],createdAt:'2026-01-01T00:00:00Z',questions:[{id:'q',title:'q',path:'questions/q.json',hiddenTestsPath:'tests/q.hidden.json',topics:[],difficulty:'EASY',points:1,order:1}],files:[{path:'questions/q.json',sha256:'a'.repeat(64),size:1},{path:'tests/q.hidden.json',sha256:'b'.repeat(64),size:1}],assessment:null};
  assert.equal(validateManifest(m).ok,true); assert.equal(validateManifest({...m,questions:[...m.questions,...m.questions]}).ok,false);
});
test('archive paths reject unsafe and malformed paths',()=>{
  const good=['manifest.json','questions/a.json','assets/notice.txt']; const bad=['','/abs','\\abs','C:/x','a/../b','a/./b','a//b','a\\b','a'.repeat(201)];
  for(const x of good) assert.equal(isSafeArchivePath(x),true,x); for(const x of bad) assert.equal(isSafeArchivePath(x),false,x);
});
test('language index helpers hash bytes and sort entries with a trailing newline',async()=>{
  const data=strToU8('runtime archive'); const entry=await buildLangIndexEntry({language:'JAVA',version:'21',os:'windows',arch:'x86_64',zipBytes:data,
    path:'packs/lang/java/21/windows-x86_64.zip',sourceFile:'{main}.java',compile:['{src}'],run:['{main}'],smokeTest:{source:'ok',expectedOutput:'ok'},licenseFiles:['LICENSE']});
  assert.equal(entry.size,data.length); assert.match(entry.sha256,/^[0-9a-f]{64}$/);
  const built=buildLangIndex([entry,{...entry,language:'C'}]); assert.ok(built.json.endsWith('\n')); assert.deepEqual(built.bytes,new TextEncoder().encode(built.json));
  assert.deepEqual(JSON.parse(built.json).packs.map(x=>x.language),['C','JAVA']);
});
test('pack build is deterministic and reads signed hidden tests safely',async()=>{
  const kp=await generateKeyPair(); const a=await buildPack(fixture()); const b=await buildPack(fixture());
  assert.deepEqual(a.bytes,b.bytes); assert.equal(a.sha256,b.sha256);
  const sig=await signDetached(a.bytes,kp.seedB64); const parsed=await readPack(a.bytes,{publicKeyB64:kp.publicKeyB64,sigB64:sig});
  assert.equal(parsed.hidden.size,1); assert.ok(parsed.questions.has(fixture().questions[0].id));
  await assert.rejects(readPack(a.bytes,{publicKeyB64:(await generateKeyPair()).publicKeyB64,sigB64:sig}),{message:'SIGNATURE_INVALID'});
  const unpacked=unzipSync(a.bytes); const qPath=`questions/${fixture().questions[0].id}.json`; unpacked[qPath]=strToU8('tampered but correctly re-signed');
  const altered=zipSync(unpacked,{level:6,mtime:new Date('1980-01-01T00:00:00.000Z')});
  await assert.rejects(readPack(altered,{publicKeyB64:kp.publicKeyB64,sigB64:await signDetached(altered,kp.seedB64)}),{message:'HASH_MISMATCH'});
  const encrypted=await buildPack(fixture({kind:'ASSESSMENT',assessmentId:'123e4567-e89b-42d3-a456-426614174002',encryption:{keyB64:Buffer.alloc(32,1).toString('base64'),keyId:'key'},assessment:{opensAt:'2027-01-01T00:00:00.000Z',closesAt:'2027-01-01T01:00:00.000Z',durationMinutes:60,attemptsAllowed:1,gracePeriodMinutes:5,keyId:'key',highStakes:true}}));
  const esig=await signDetached(encrypted.bytes,kp.seedB64); const ep=await readPack(encrypted.bytes,{publicKeyB64:kp.publicKeyB64,sigB64:esig}); assert.equal(ep.hidden,null);
  await assert.rejects(buildPack(fixture({kind:'ASSESSMENT',assessmentId:'x',assessment:{keyId:'k'}})),/assessment encryption required/);
});
test('readPack rejects extra archive entries and oversized entries',async()=>{
  const kp=await generateKeyPair(); const good=await buildPack(fixture());
  const base=unzipSync(good.bytes);
  for(const extras of [{ 'extra.txt':strToU8('x') }, {'../x':strToU8('x')}, {'big.bin':new Uint8Array(50*1024*1024+1)}]) {
    const raw=zipSync({...base,...extras},{level:1,mtime:new Date('1980-01-01T00:00:00.000Z')});
    const sig=await signDetached(raw,kp.seedB64); await assert.rejects(readPack(raw,{publicKeyB64:kp.publicKeyB64,sigB64:sig}),/UNSAFE_ARCHIVE/);
  }
});
test('J-platform import CLI emits 240 deterministic questions without reference solutions',async()=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'pack-import-')); try {
    const root=path.resolve(import.meta.dirname,'../../..'); const out=path.join(tmp,'source.json'); const args=[path.join(root,'packages/pack-format/bin/pack-builder.mjs'),'import-jplatform','--in',path.join(root,'content/j-platform-question-bank/questions.json'),'--out',out,'--course-id','7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01','--version','1','--title','Practice'];
    assert.equal(spawnSync(process.execPath,args,{encoding:'utf8',cwd:root}).status,0); const one=await readFile(out,'utf8'); assert.equal(spawnSync(process.execPath,args,{encoding:'utf8',cwd:root}).status,0); const two=await readFile(out,'utf8'); assert.equal(one,two);
    const obj=JSON.parse(one); assert.equal(obj.questions.length,240); assert.ok(obj.questions.every(q=>q.visibleTests.length>0)); assert.ok(!one.includes('solutionCode')); assert.equal(typeof obj.assetsNotice,'string');
    const { publicKeyB64, seedB64 }=await generateKeyPair(); const source=JSON.parse(one); const built=await buildPack(source);
    assert.ok(built.manifest.files.some(f=>f.path==='assets/NOTICE.md'));
    assert.ok(!Object.keys(unzipSync(built.bytes)).some(f=>f.includes('solution')));
    const signed=await signDetached(built.bytes,seedB64); const parsed=await readPack(built.bytes,{publicKeyB64,sigB64:signed}); assert.equal(parsed.questions.size,240);
  } finally { await rm(tmp,{recursive:true,force:true}); }
});
test('CLI keygen, course-pack and verify detect tampering',async()=>{
  const root=path.resolve(import.meta.dirname,'../../..'); const tmp=await mkdtemp(path.join(os.tmpdir(),'pack-cli-'));
  try {
    const cli=path.join(root,'packages/pack-format/bin/pack-builder.mjs'); const run=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});
    const keyDir=path.join(tmp,'keys'); assert.equal(run('keygen','--role','pack','--out',keyDir).status,0);
    const sourcePath=path.join(tmp,'source.json'); await writeFile(sourcePath,JSON.stringify(fixture()));
    assert.equal(run('course-pack','--source',sourcePath,'--out',path.join(tmp,'packs'),'--seed',path.join(keyDir,'pack.seed')).status,0);
    const packPath=path.join(tmp,'packs',fixture().courseId,'1.lpack'); const sigPath=`${packPath}.sig`; const pubPath=path.join(keyDir,'pack.pub');
    assert.equal(run('verify','--file',packPath,'--sig',sigPath,'--pub',pubPath,'--kind','pack').status,0);
    const payload=await readFile(packPath); payload[0]^=1; await writeFile(packPath,payload);
    const tampered=run('verify','--file',packPath,'--sig',sigPath,'--pub',pubPath,'--kind','pack'); assert.equal(tampered.status,1); assert.match(tampered.stderr,/SIGNATURE_INVALID/);
  } finally { await rm(tmp,{recursive:true,force:true}); }
});
