import test from 'node:test';
import assert from 'node:assert/strict';
import { activityUploadUrl, packDownloadUrl } from './handlers.js';
const userId='0b53aa8c-f104-48a6-a9d2-a879abc564ce';
function env(){return {get:k=>({SUPABASE_URL:'http://local',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}[k])}}
function clientFactory({profile,pack}={}) { return (_url,key)=>({auth:{getUser:async()=>({data:{user:{id:userId}},error:null})},from:(table)=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:key==='anon'?(table==='profiles'?profile:pack):null,error:null})})})})}); }
test('activity upload URL scopes object path to authenticated active profile', async()=>{
  let par; const result=await activityUploadUrl({request:new Request('http://local',{headers:{authorization:'Bearer token'}}),body:{batchId:'bc645e47-7d33-4c08-9f68-589e3ddb97d4',sizeBytes:3,sha256:'a'.repeat(64)},env:env(),now:()=>new Date('2026-11-24T23:30:00.000Z'),createClient:clientFactory({profile:{organization_id:'org',status:'ACTIVE'}}),oci:{createPar:async x=>(par=x,'https://oci/p/token')}});
  assert.equal(result.objectPath,'raw/activity/org/2026/11/24/0b53aa8c-f104-48a6-a9d2-a879abc564ce-bc645e47-7d33-4c08-9f68-589e3ddb97d4.jsonl.gz'); assert.equal(par.accessType,'ObjectWrite'); assert.equal(par.objectName,result.objectPath); assert.equal(par.expiresAt,'2026-11-24T23:45:00.000Z'); assert.equal(result.uploadUrl,'https://oci/p/token');
});
test('pack download hides packs unavailable through user RLS', async()=>{
  let pars=0; await assert.rejects(packDownloadUrl({request:new Request('http://local',{headers:{authorization:'Bearer token'}}),body:{packId:`${userId}@1`},env:env(),createClient:clientFactory({pack:null}),oci:{createPar:async()=>{pars++;return 'url'}}}),{status:404}); assert.equal(pars,0);
});
test('activity upload rejects oversized file metadata', async()=>{
  await assert.rejects(activityUploadUrl({request:new Request('http://local',{headers:{authorization:'Bearer token'}}),body:{batchId:'bc645e47-7d33-4c08-9f68-589e3ddb97d4',sizeBytes:5*1024*1024+1,sha256:'a'.repeat(64)},env:env(),createClient:clientFactory()}),{status:413});
});
test('activity upload returns 401 without JWT, 400 for bad hash, and 403 without an organization',async()=>{
 const request=new Request('http://local',{headers:{authorization:'Bearer token'}});const base={request,body:{batchId:'bc645e47-7d33-4c08-9f68-589e3ddb97d4',sizeBytes:1,sha256:'a'.repeat(64)},env:env(),createClient:clientFactory({profile:{organization_id:null,status:'ACTIVE'}}),oci:{createPar:async()=> 'url'}};
 await assert.rejects(activityUploadUrl({...base,request:new Request('http://local')}),{status:401});
 await assert.rejects(activityUploadUrl({...base,body:{...base.body,sha256:'bad'}}),{status:400});
 await assert.rejects(activityUploadUrl(base),{status:403});
});
test('visible pack download returns read-only URLs and metadata',async()=>{
 const calls=[];const result=await packDownloadUrl({request:new Request('http://local',{headers:{authorization:'Bearer token'}}),body:{packId:`${userId}@1`},env:env(),createClient:clientFactory({pack:{pack_id:`${userId}@1`,object_path:'packs/course/a/1.lpack',sha256:'b'.repeat(64),size:42}}),now:()=>new Date('2026-11-24T00:00:00Z'),oci:{createPar:async x=>(calls.push(x),'par'+calls.length)}});
 assert.equal(calls.length,2);assert.deepEqual(calls.map(x=>x.accessType),['ObjectRead','ObjectRead']);assert.equal(result.url,'par1');assert.equal(result.sigUrl,'par2');assert.equal(result.sha256,'b'.repeat(64));assert.equal(result.size,42);
});
