import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientScopedQualificationForwarder,QUALIFIED_META_CANARY_BASE} from '../../../coordination/client-v1/edge/client-scoped-qualification-forwarder.mjs';
const client='2a60d6a2-c7c2-4dcc-b4c9-99de768443c9';
const req=(method='POST',headers={})=>new Request('https://example.test/v1/commands/next?q=1',{method,
 headers:{'x-a2-chat-bridge-client':client,'x-a2-device-signature':'signed-exact-bytes',...headers},
 ...(method==='GET'?{}:{body:'{"exact":"текст"}'})});
test('qualification forwarder preserves signed request bytes, path, query and status once',async()=>{
 let calls=0;const forward=createClientScopedQualificationForwarder({clientId:client,fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,QUALIFIED_META_CANARY_BASE+'/v1/commands/next?q=1');assert.equal(init.method,'POST');
  assert.equal(new TextDecoder().decode(init.body),'{"exact":"текст"}');assert.equal(init.headers.get('x-a2-device-signature'),'signed-exact-bytes');
  assert.equal(init.redirect,'error');return new Response('{"leased":false}',{status:409});
 }});
 const out=await forward(req(),'/v1/commands/next');assert.equal(out.status,409);assert.equal(calls,1);
});
test('forwarder never routes another client',async()=>{
 const f=createClientScopedQualificationForwarder({clientId:client,fetchImpl:()=>assert.fail('request sent')});
 assert.equal(await f(req('POST',{'x-a2-chat-bridge-client':'other'}),'/v1/state'),null);
});
test('loop and path traversal are rejected without network effects',async()=>{
 const f=createClientScopedQualificationForwarder({clientId:client,fetchImpl:()=>assert.fail('request sent')});
 assert.equal((await f(req('POST',{'x-metaengine-qualified-route-hop':'1'}),'/v1/state')).status,508);
 for(const path of ['/v1/a/../state','/v1//state','https://other.test/v1/state']) assert.equal((await f(req(),path)).status,400);
});
test('redirects and dropped outcomes never fall through or retry',async()=>{
 for(const action of [()=>new Response(null,{status:302}),()=>{throw new Error('outcome unknown');}]) {
  let calls=0;const f=createClientScopedQualificationForwarder({clientId:client,fetchImpl:async()=>{calls++;return action();}});
  const out=await f(req(),'/v1/state');assert.ok([502,503].includes(out.status));assert.equal(calls,1);
  assert.equal((await out.json()).automatic_effect_retry_allowed,false);
 }
});
test('forwarder target is pinned and GET never invents a body',async()=>{
 assert.throws(()=>createClientScopedQualificationForwarder({clientId:client,targetBase:'https://other.test'}),/destination_invalid/);
 const f=createClientScopedQualificationForwarder({clientId:client,fetchImpl:async(_,init)=>{assert.equal(init.body,undefined);return new Response('{}');}});
 assert.equal((await f(req('GET'),'/v1/status')).status,200);
});
