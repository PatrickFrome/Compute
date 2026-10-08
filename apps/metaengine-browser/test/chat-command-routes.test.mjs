import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatCommandRoutes,CHAT_COMMAND_ACTIONS,normalizeChatCommand } from '../supabase/a2-browser-native-supervisor-v1/chat-command-routes.mjs';
import { controlActionDescriptor } from '../src/control-actions-manifest.mjs';
import { NativeSupervisorClient } from '../src/native-supervisor-client-base.mjs';
import { pairing,commandId } from './fixtures/github-chat-relay.mjs';

const body={request_id:commandId,relay_id:pairing.relay_id,operator_user_id:18,action:'NEW_TAB',payload:{url:'https://example.test'}};
const identity={ok:true,id:'client_fixture',admin_ready:true,admin_scopes:['CONTROL_PLANE']};
const input={req:{method:'POST'},path:'/v1/commands/issue-chat',body,identity};

test('local-only route refuses hosted mode and lacks no authenticated-admin bypass',async()=>{
  for(const [local,actor] of [[false,identity],[true,{ok:true,id:'client_fixture'}],[true,{...identity,admin_scopes:[]}]] ){
    let calls=0;
    const route=createChatCommandRoutes({local,json:(status,value)=>({status,value}),rpc:async()=>{calls++;},lookup:async()=>{calls++;}});
    const response=await route({...input,identity:actor});assert.ok([401,403].includes(response.status));assert.equal(calls,0);
  }
});

test('issuer action catalog describes real client implementations and cannot expose arbitrary shell',()=>{
  for(const action of CHAT_COMMAND_ACTIONS)assert.equal(controlActionDescriptor(action)?.browser_implemented,true,action);
  for(const action of ['RUN_SHELL','EVAL','RESOLVE_PROMPT','SET_MODE'])assert.throws(()=>normalizeChatCommand({...body,action}),/chat_command_invalid/);
});

test('admission returns only approved identifiers and sanitizes private database errors',async()=>{
  const route=createChatCommandRoutes({local:true,json:(status,value)=>({status,value}),lookup:async()=>null,
    rpc:async()=>{throw new Error('postgres://owner:private-password@127.0.0.1/private');}});
  const response=await route(input);assert.equal(response.status,409);assert.equal(JSON.stringify(response).includes('private-password'),false);
});

test('lookup scopes the immutable idempotency key to the authenticated local device',async()=>{
  let actual;
  const route=createChatCommandRoutes({local:true,json:(status,value)=>({status,value}),rpc:async()=>assert.fail('lookup dispatched an effect'),
    lookup:async value=>{actual=value;return{command_id:commandId,status:'LEASED'};}});
  const result=await route({...input,path:'/v1/commands/chat-lookup',body:{request_id:commandId,relay_id:pairing.relay_id}});
  assert.deepEqual(actual,{clientId:identity.id,idempotencyKey:`chat:${pairing.relay_id}:${commandId}`});
  assert.equal(result.value.execution_authority,false);assert.equal(result.value.status,'LEASED');
});

test('NativeSupervisorClient signs chat admission, lookup and receipt and never calls its OS executor',async()=>{
  const signed=[],sent=[];
  const client=new NativeSupervisorClient({identity:{snapshot:()=>({}),deviceHeaders:async(...args)=>{signed.push(args);return{'x-a2-device-signature':'fixture'};}},
    getState:async()=>({}),executeCommand:async()=>assert.fail('remote transport executed locally'),
    fetchImpl:async(url,init)=>{sent.push({url,init});return Response.json({accepted:true,command_id:commandId});}});
  await client.chatCommandSubmit(body);await client.chatCommandLookup({request_id:commandId,relay_id:pairing.relay_id});
  await client.chatCommandReceipt({command_id:commandId});
  assert.equal(signed.length,3);assert.equal(signed[0][0],'POST');assert.ok(signed[0][1].endsWith('/commands/issue-chat'));
  assert.equal(signed[2][0],'GET');assert.equal(signed[2][2],'');assert.ok(sent.every(call=>call.init.headers['x-a2-device-signature']==='fixture'));
  await assert.rejects(client.chatCommandReceipt({command_id:'../../secret'}),/command_id_invalid/);
});
