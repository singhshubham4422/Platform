const BASIC=['(request-target)','date','host'];
const BODY=['(request-target)','date','x-content-sha256','content-type','content-length','host'];
const enc=new TextEncoder();
const b64=(bytes)=>{let s='';for(const x of bytes)s+=String.fromCharCode(x);return btoa(s)};
function pemBytes(pem){
  const normalized=pem.replace(/\\n/g,'\n');const pkcs1=/-----BEGIN RSA PRIVATE KEY-----/.test(normalized);
  // Decode only the body between the markers: keys downloaded from the OCI console carry an
  // extra "OCI_API_KEY" line after the END marker, which is not base64.
  const block=/-----BEGIN (?:RSA )?PRIVATE KEY-----([\s\S]*?)-----END (?:RSA )?PRIVATE KEY-----/.exec(normalized);
  if(!block)throw new Error('OCI_PRIVATE_KEY_INVALID');
  const raw=block[1].replace(/\s/g,'');
  const key=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));if(!pkcs1)return key;
  const len=(n)=>n<128?Uint8Array.of(n):Uint8Array.of(0x80+Math.ceil(Math.log2(n+1)/8),...Array.from({length:Math.ceil(Math.log2(n+1)/8)},(_,i)=>(n>>>(8*(Math.ceil(Math.log2(n+1)/8)-i-1)))&255));
  const octet=Uint8Array.of(4,...len(key.length),...key);const alg=Uint8Array.from([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);const body=Uint8Array.from([0x02,0x01,0x00,...alg,...octet]);return Uint8Array.from([0x30,...len(body.length),...body]);
}
function normalizedHeaders(input={}){const out={};for(const [k,v] of Object.entries(input))out[k.toLowerCase()]=String(v);return out}
export function requestTarget(url){return `${url.pathname||'/'}${url.search||''}`}
export function signingString(method,url,headers,headerNames){const h=normalizedHeaders(headers);return headerNames.map((name)=>name==='(request-target)'?`(request-target): ${method.toLowerCase()} ${requestTarget(url)}`:`${name}: ${h[name]??''}`).join('\n')}

export async function signRequest({method,url,headers={},keyId,privateKeyPem,signingHeaders,cryptoImpl=globalThis.crypto}){
  const target=url instanceof URL?url:new URL(url);const normalized=normalizedHeaders(headers);const names=signingHeaders;
  if(!Array.isArray(names)||!names.length||!names.includes('(request-target)')||!names.includes('date')||!names.includes('host'))throw new Error('OCI_SIGNING_HEADERS_INVALID');
  for(const n of names)if(n!=='(request-target)'&&normalized[n]===undefined)throw new Error(`OCI_SIGNING_HEADER_MISSING:${n}`);
  const text=signingString(method,target,normalized,names);const key=await cryptoImpl.subtle.importKey('pkcs8',pemBytes(privateKeyPem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);const signature=new Uint8Array(await cryptoImpl.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(text)));
  normalized.authorization=`Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${names.join(' ')}",signature="${b64(signature)}"`;
  return {headers:normalized,signingString:text,signedHeaders:names.join(' ')};
}

function config(env){const names=['OCI_TENANCY','OCI_USER','OCI_FINGERPRINT','OCI_REGION','OCI_NAMESPACE','OCI_BUCKET','OCI_PRIVATE_KEY'];const c=Object.fromEntries(names.map(n=>[n,env.get(n)]));if(names.some(n=>!c[n]))throw new Error('OCI_CONFIGURATION_MISSING');c.privateKey=c.OCI_PRIVATE_KEY.replace(/\\n/g,'\n');c.keyId=`${c.OCI_TENANCY}/${c.OCI_USER}/${c.OCI_FINGERPRINT}`;c.host=`objectstorage.${c.OCI_REGION}.oraclecloud.com`;c.origin=`https://${c.host}`;return c}
function pathSegment(s){return encodeURIComponent(String(s))}
function objectPath(c,name){return `/n/${pathSegment(c.OCI_NAMESPACE)}/b/${pathSegment(c.OCI_BUCKET)}/o/${name.split('/').map(pathSegment).join('/')}`}
function dateHeader(now){return now().toUTCString()}
async function signedFetch({method,url,headers,body,signingHeaders,keyId,privateKeyPem,fetchImpl,cryptoImpl}){const signed=await signRequest({method,url,headers,keyId,privateKeyPem,signingHeaders,cryptoImpl});return fetchImpl(url,{method,headers:signed.headers,body});}

export function createOci({env,fetchImpl=fetch,now=()=>new Date(),cryptoImpl=globalThis.crypto}){
  return {
    async createPar({objectName,accessType,expiresAt}){
      const c=config(env);if(!['ObjectRead','ObjectWrite'].includes(accessType))throw new Error('OCI_PAR_ACCESS_TYPE_INVALID');
      const url=new URL(`/n/${pathSegment(c.OCI_NAMESPACE)}/b/${pathSegment(c.OCI_BUCKET)}/p/`,c.origin);
      const body=enc.encode(JSON.stringify({name:`platform-${accessType.toLowerCase()}-${cryptoImpl.randomUUID()}`,accessType,timeExpires:expiresAt,objectName}));
      const headers={'date':dateHeader(now),'host':url.host,'content-type':'application/json','content-length':String(body.length),'x-content-sha256':b64(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',body)))};
      const r=await signedFetch({method:'POST',url,headers,body,signingHeaders:BODY,keyId:c.keyId,privateKeyPem:c.privateKey,fetchImpl,cryptoImpl});
      if(!r.ok)throw new Error(`OCI_PAR_FAILED:${r.status}`);let result;try{result=await r.json()}catch{throw new Error('OCI_PAR_INVALID_RESPONSE')}
      if(typeof result.accessUri!=='string'||!result.accessUri.startsWith('/p/'))throw new Error('OCI_PAR_INVALID_RESPONSE');
      return `${c.origin}${result.accessUri}`;
    },
    async putObject({objectName,bytes,contentType='application/octet-stream'}){
      const c=config(env);const url=new URL(objectPath(c,objectName),c.origin);const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
      const headers={'date':dateHeader(now),'host':url.host,'content-type':contentType};
      const r=await signedFetch({method:'PUT',url,headers,body:data,signingHeaders:BASIC,keyId:c.keyId,privateKeyPem:c.privateKey,fetchImpl,cryptoImpl});
      if(!r.ok)throw new Error(`OCI_PUT_FAILED:${r.status}`);return {etag:r.headers?.get?.('etag')??null};
    },
    async getObject({objectName}){
      const c=config(env);const url=new URL(objectPath(c,objectName),c.origin);const headers={'date':dateHeader(now),'host':url.host};
      const r=await signedFetch({method:'GET',url,headers,signingHeaders:BASIC,keyId:c.keyId,privateKeyPem:c.privateKey,fetchImpl,cryptoImpl});if(!r.ok)throw new Error(`OCI_GET_FAILED:${r.status}`);return new Uint8Array(await r.arrayBuffer());
    },
  };
}

export const OCI_SIGNING_HEADERS={basic:BASIC,body:BODY};
