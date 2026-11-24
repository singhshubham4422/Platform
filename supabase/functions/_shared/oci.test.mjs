import test from 'node:test';
import assert from 'node:assert/strict';
import { signRequest, OCI_SIGNING_HEADERS } from './oci.js';

test('OCI RSA request signature covers exact basic and JSON header sets', async () => {
  const pair = await crypto.subtle.generateKey({ name:'RSASSA-PKCS1-v1_5', modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256' }, true, ['sign','verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----`;
  for (const [method,names, headers, expected] of [
    ['GET',OCI_SIGNING_HEADERS.basic, {date:'Tue, 24 Nov 2026 00:00:00 GMT',host:'objectstorage.test.oraclecloud.com'}, '(request-target): get /n/ns/b/bucket/p/?x=1\ndate: Tue, 24 Nov 2026 00:00:00 GMT\nhost: objectstorage.test.oraclecloud.com'],
    ['PUT',OCI_SIGNING_HEADERS.basic, {date:'Tue, 24 Nov 2026 00:00:00 GMT',host:'objectstorage.test.oraclecloud.com','content-type':'application/octet-stream'}, '(request-target): put /n/ns/b/bucket/p/?x=1\ndate: Tue, 24 Nov 2026 00:00:00 GMT\nhost: objectstorage.test.oraclecloud.com'],
    ['POST',OCI_SIGNING_HEADERS.body, {date:'Tue, 24 Nov 2026 00:00:00 GMT',host:'objectstorage.test.oraclecloud.com','x-content-sha256':'abc','content-type':'application/json','content-length':'2'}, '(request-target): post /n/ns/b/bucket/p/?x=1\ndate: Tue, 24 Nov 2026 00:00:00 GMT\nx-content-sha256: abc\ncontent-type: application/json\ncontent-length: 2\nhost: objectstorage.test.oraclecloud.com'],
  ]) {
    const url = new URL('https://objectstorage.test.oraclecloud.com/n/ns/b/bucket/p/?x=1');
    const result = await signRequest({method,url,headers,keyId:'t/u/f',privateKeyPem:pem,signingHeaders:names});
    const sig = result.headers.authorization.match(/signature="([^"]+)"/)[1];
    assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(sig,'base64'),new TextEncoder().encode(result.signingString)),true);
    assert.equal(result.signedHeaders,names.join(' '));
    assert.equal(result.signingString,expected);
  }
});
