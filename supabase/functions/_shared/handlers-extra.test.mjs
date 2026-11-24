import test from 'node:test';
import assert from 'node:assert/strict';
import { publishPack } from './handlers.js';
test('publish checks course permission before privileged content reads or OCI writes', async()=>{
  let serviceReads=0,uploads=0;
  const createClient=(_url,key)=>key==='anon'?{auth:{getUser:async()=>({data:{user:{id:'u'}},error:null})},rpc:async()=>({data:false,error:null})}:{from:()=>{serviceReads++;throw new Error('must not read')}};
  const env={get:k=>({SUPABASE_URL:'x',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}[k])};
  await assert.rejects(publishPack({request:new Request('http://x',{headers:{authorization:'Bearer token'}}),body:{courseId:'0b53aa8c-f104-48a6-a9d2-a879abc564ce'},env,createClient,oci:{putObject:async()=>uploads++},packFormat:{}}),{status:403});
  assert.equal(serviceReads,0);assert.equal(uploads,0);
});
