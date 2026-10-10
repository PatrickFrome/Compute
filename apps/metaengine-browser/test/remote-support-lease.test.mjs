import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteSupportMcp } from '../src/remote-support-mcp.mjs';

const rpc = (service,name,args={}) => service.request({jsonrpc:'2.0',id:3,method:'tools/call',params:{name,arguments:args}});
const act={action:'UIA_INVOKE',target:{process_id:42},args:{runtime_id:[9]},context:{command_id:'attacker-controlled'},agent_id:'agent_demo-v1',task_id:'task_demo-v1'};
const executor = () => {
  const calls=[];
  return {calls,observe:async()=>({result:{}}),act:async(value,context)=>{calls.push({value,context});return {outcome:'NO_EFFECT_PROVEN',authority_effect:false};}};
};
const trustedContext = {command_id:'22222222-2222-4222-8222-222222222222',effect_binding:{verified:true}};
const schema = 'metaengine.remote-support-control-lease.v1';

test('default CLI denies CONTROL without a trusted DB lease resolver',async()=>{
  const ex=executor();
  const service=createRemoteSupportMcp({platform:'win32',executor:ex,approve:async()=>true});
  await rpc(service,'support_start_session',{scope:'CONTROL'});
  const status=JSON.parse((await rpc(service,'support_status')).result.content[0].text);
  assert.equal(status.control_lease_resolver_configured,false);
  assert.equal(status.control_lease_resolution,'UNAVAILABLE_NO_TRUSTED_DB_ADAPTER');
  const denied=await rpc(service,'support_control',act);
  assert.equal(denied.result.content[0].text,'remote_support_trusted_control_lease_resolver_required');
  assert.equal(ex.calls.length,0);
  service.close();
});

test('CONTROL passes only resolver-verified context and ignores caller context',async()=>{
  const ex=executor(); let received;
  const service=createRemoteSupportMcp({platform:'win32',executor:ex,approve:async()=>true,
    resolveControlLease:async input=>{received=input;return {schema,verified:true,context:trustedContext,request_binding:input.request};}});
  await rpc(service,'support_start_session',{scope:'CONTROL'});
  const reply=await rpc(service,'support_control',act);
  assert.equal(reply.result.isError,false);
  assert.equal(received.untrusted_context.command_id,'attacker-controlled');
  assert.deepEqual(ex.calls[0].context,trustedContext);
  assert.deepEqual(ex.calls[0].value,received.request);
  service.close();
});

test('CONTROL rejects a resolver binding that does not match the frozen request',async()=>{
  const ex=executor();
  const service=createRemoteSupportMcp({platform:'win32',executor:ex,approve:async()=>true,
    resolveControlLease:async()=>({schema,verified:true,context:trustedContext,
      request_binding:{action:'UIA_INVOKE',args:{runtime_id:[999]},target:{process_id:42},agent_id:'agent_demo-v1',task_id:'task_demo-v1'}})});
  await rpc(service,'support_start_session',{scope:'CONTROL'});
  const reply=await rpc(service,'support_control',act);
  assert.equal(reply.result.content[0].text,'remote_support_control_lease_unverified');
  assert.equal(ex.calls.length,0);
  service.close();
});

test('invalid or failed lease resolution never dispatches and redacts resolver errors',async()=>{
  for(const make of [
    () => null,
    input => ({schema:'other',verified:true,context:trustedContext,request_binding:input.request}),
    input => ({schema,verified:false,context:trustedContext,request_binding:input.request}),
    input => ({schema,verified:true,context:[],request_binding:input.request}),
    () => {throw new Error('private_db_connection_details');},
  ]) {
    const ex=executor();
    const service=createRemoteSupportMcp({platform:'win32',executor:ex,approve:async()=>true,resolveControlLease:make});
    try {
      await rpc(service,'support_start_session',{scope:'CONTROL'});
      const reply=await rpc(service,'support_control',act);
      assert.equal(reply.result.isError,true);
      assert.match(reply.result.content[0].text,/^remote_support_control_lease_(unverified|resolution_failed)$/);
      assert.equal(JSON.stringify(reply).includes('private_db_connection_details'),false);
      assert.equal(ex.calls.length,0);
    } finally {service.close();}
  }
});

test('revocation or expiry while the resolver waits denies before any computer effect',async()=>{
  for(const reason of ['stop','expire']) {
    let finish,received,clock=0;
    const ex=executor();
    const service=createRemoteSupportMcp({platform:'win32',executor:ex,approve:async()=>true,now:()=>clock,
      resolveControlLease:input=>{received=input;return new Promise(resolve=>{finish=resolve;});}});
    try {
      await rpc(service,'support_start_session',{scope:'CONTROL'});
      const pending=rpc(service,'support_control',act);
      if(reason==='stop') await rpc(service,'support_stop');
      else clock+=3600000;
      finish({schema,verified:true,context:trustedContext,request_binding:received.request});
      const reply=await pending;
      assert.equal(reply.result.isError,true);
      assert.match(reply.result.content[0].text,/^remote_support_session_(revoked|not_active)$/);
      assert.equal(ex.calls.length,0);
    } finally {service.close();}
  }
});

test('lease checks and dispatch share the immutable request captured before await',async()=>{
  let finish,received;
  const ex=executor(),caller=structuredClone(act);
  const service=createRemoteSupportMcp({platform:'win32',executor:ex,approve:async()=>true,
    resolveControlLease:input=>{received=input;return new Promise(resolve=>{finish=resolve;});}});
  try {
    await rpc(service,'support_start_session',{scope:'CONTROL'});
    const pending=rpc(service,'support_control',caller);
    caller.target.process_id=9000;
    caller.args.runtime_id[0]=999;
    assert(Object.isFrozen(received.request));
    assert(Object.isFrozen(received.request.target));
    assert(Object.isFrozen(received.request.args.runtime_id));
    finish({schema,verified:true,context:trustedContext,request_binding:received.request});
    assert.equal((await pending).result.isError,false);
    assert.equal(ex.calls[0].value.target.process_id,42);
    assert.deepEqual(ex.calls[0].value.args.runtime_id,[9]);
  } finally {service.close();}
});
