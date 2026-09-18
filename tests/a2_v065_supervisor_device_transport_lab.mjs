import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('coordination/chat-control-plane/extension/supervisor-device-transport-v063.js','utf8');
const LEGACY='https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v3-canary';
const STABLE='https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4';
const secret='s'.repeat(48);
const client='client-device-auth-v065';
let enrolled=false,enrollCalls=0,clearCalls=0,signCalls=0,nativeMode='ok',recoverableSeen=false;
const nativeCalls=[],signedPaths=[];
const nativeFetch=async(input,init={})=>{
  const url=String(input);const headers=new Headers(init.headers||{});
  nativeCalls.push({url,headers:Object.fromEntries(headers.entries())});
  if(url.startsWith('https://example.com/')) return new Response(null,{status:204});
  assert.ok(url.startsWith(STABLE),`unstable supervisor wire URL: ${url}`);
  if(nativeMode==='invalid_signature') return new Response(JSON.stringify({reason:'INVALID_SIGNATURE'}),{status:401,headers:{'content-type':'application/json'}});
  if(nativeMode==='recover_once'&&!recoverableSeen){recoverableSeen=true;return new Response(JSON.stringify({reason:'DEVICE_NOT_FOUND'}),{status:401,headers:{'content-type':'application/json'}})}
  return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});
};
const context=vm.createContext({console,URL,Headers,Response,setTimeout,clearTimeout,fetch:nativeFetch});context.globalThis=context;
context.A2_DEVICE_STATUS=async()=>({enrolled,device_id:enrolled?'11111111-1111-4111-8111-111111111111':null});
context.A2_DEVICE_ENROLL=async(base,actualClient,actualSecret)=>{assert.equal(base,STABLE);assert.equal(actualClient,client);assert.equal(actualSecret,secret);enrollCalls++;enrolled=true;return{accepted:true}};
context.A2_DEVICE_CLEAR_ENROLLMENT=async()=>{clearCalls++;enrolled=false};
context.A2_DEVICE_SIGN_REQUEST=async(method,requestPath,body)=>{signCalls++;signedPaths.push(requestPath);assert.ok(requestPath.startsWith('/a2-browser-supervisor-v4/'));assert.ok(!requestPath.includes('v4-canary'));return{profile:'A2_DEVICE_HTTP_SIGNATURE_V1',device_id:'11111111-1111-4111-8111-111111111111',timestamp:'2026-08-27T14:50:00.000Z',nonce:`nonce_${String(signCalls).padStart(20,'0')}`,body_sha256:'a'.repeat(64),signature_b64url:'A'.repeat(86)}};
vm.runInContext(source,context,{filename:'supervisor-device-transport-v063.js'});

const headers={'content-type':'application/json','x-a2-chat-bridge-secret':secret,'x-a2-chat-bridge-client':client};
const first=await context.fetch(`${LEGACY}/v1/state`,{method:'POST',headers,body:'{}'});
assert.equal(first.status,200);assert.equal(enrollCalls,1);assert.equal(signCalls,1);assert.equal(signedPaths[0],'/a2-browser-supervisor-v4/v1/state');
const wire=nativeCalls.at(-1);assert.equal(wire.url,`${STABLE}/v1/state`);assert.equal(wire.headers['x-a2-chat-bridge-secret'],undefined);assert.ok(wire.headers['x-a2-device-signature']);

nativeMode='invalid_signature';const eb=enrollCalls,cb=clearCalls,sb=signCalls;const invalid=await context.fetch(`${LEGACY}/v1/status`,{method:'GET',headers});
assert.equal(invalid.status,401);assert.equal(enrollCalls,eb);assert.equal(clearCalls,cb);assert.equal(signCalls,sb+1);

nativeMode='recover_once';recoverableSeen=false;const e2=enrollCalls,c2=clearCalls,s2=signCalls;const recovered=await context.fetch(`${LEGACY}/v1/commands/next`,{method:'POST',headers,body:'{}'});
assert.equal(recovered.status,200);assert.equal(enrollCalls,e2+1);assert.equal(clearCalls,c2+1);assert.equal(signCalls,s2+2);
assert.match(source,/DEVICE_SIGNED_NO_BEARER_FALLBACK/);assert.doesNotMatch(source,/SIGNED_BASE = .*v4-canary/);
console.log('a2_v065_supervisor_device_transport_lab: PASS');
