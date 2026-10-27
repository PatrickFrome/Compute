import assert from 'node:assert/strict';
import test from 'node:test';
import {BrowserGuardianUpdateActuatorClient,browserGuardianUpdateActuatorClientContract} from '../src/browser-guardian-update-actuator-client.mjs';
const COMMAND_ID='11111111-1111-4111-8111-111111111111',NONCE='abcdefghijklmnopqrstuvwxyzABCDEF123456',FINGERPRINT='a'.repeat(64);
const JWK={kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'B'.repeat(43)};
const result=(state,reason,extra={})=>({schema:'metaengine.browser-guardian.update-actuator-result.v1',state,reason,
  automatic_retry_allowed:false,caller_supplied_path_used:false,caller_supplied_url_used:false,caller_supplied_shell_used:false,authority_effect:false,...extra});
const bound=()=>result('OWNER_BOUND','DURABLE_OWNER_AND_DEVICE_CHALLENGE_EXACT',{
  effect_absent_proven:true,owner_binding_proven:true,device_binding_proven:true,device_key_fingerprint_sha256:FINGERPRINT});
function identity(){return {async guardianOwnerChallenge(input){
  assert.equal(input.enrollment_ticket_sha256,undefined);
  return {public_jwk:JWK,key_fingerprint_sha256:FINGERPRINT,signature:'A'.repeat(86)};
},async guardianUpdateActuatorProof(){throw Error('not_used');}};}

test('unbound owner holds before fetch or second native probe',async()=>{
  let fetches=0;const wires=[],deadlines=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{fetches++;throw Error('unexpected_network');};
  const client=new BrowserGuardianUpdateActuatorClient({identity:identity(),
    transport:async(wire,options)=>{wires.push(wire);deadlines.push(options.timeoutMs);
      return result('NO_EFFECT_PROVEN','OWNER_ENROLLMENT_TICKET_REQUIRED',{effect_absent_proven:true});}});
  try{await assert.rejects(client.ensureOwnerBound({command_id:COMMAND_ID,request_nonce:NONCE,timeoutMs:999999}),
    {code:'GUARDIAN_LOCAL_OWNER_BRIDGE_REQUIRED',message:'guardian_local_owner_bridge_required'});}
  finally{globalThis.fetch=originalFetch;}
  assert.equal(fetches,0);assert.equal(wires.length,1);assert.deepEqual(deadlines,[2000]);
  assert.doesNotMatch(wires[0],/enrollment_ticket|https?:|supabase/i);
});
test('already-bound owner retains exact independent read-only challenge and no new enrollment',async()=>{
  let calls=0;
  const options={identity:identity(),
    transport:async wire=>{calls++;assert.doesNotMatch(wire,/enrollment_ticket/);return bound();}};
  // A newly launched client can read the durable owner from an earlier run,
  // including an earlier lost acknowledgement, without reproducing its effect.
  for(let launch=0;launch<2;launch++)assert.equal((await new BrowserGuardianUpdateActuatorClient(options)
    .ensureOwnerBound({command_id:COMMAND_ID,request_nonce:NONCE})).state,'OWNER_BOUND');
  assert.equal(calls,2);
});
test('mismatched or incomplete durable owner evidence remains refused',async()=>{
  for(const change of [{device_key_fingerprint_sha256:'b'.repeat(64)},{effect_absent_proven:false},
    {owner_binding_proven:false},{device_binding_proven:false}]){
    const client=new BrowserGuardianUpdateActuatorClient({identity:identity(),transport:async()=>({...bound(),...change})});
    await assert.rejects(client.ensureOwnerBound({command_id:COMMAND_ID,request_nonce:NONCE}),/guardian_owner_probe_/);
  }
});
test('non-exact absence and ambiguous native observation never trigger enrollment',async()=>{
  for(const first of [result('NO_EFFECT_PROVEN','OWNER_SESSION_BINDING_UNPROVEN',{effect_absent_proven:true}),
    result('NO_EFFECT_PROVEN','OWNER_ENROLLMENT_TICKET_REQUIRED',{effect_absent_proven:false}),result('AMBIGUOUS','OWNER_READBACK_UNKNOWN')]){
    let calls=0;const client=new BrowserGuardianUpdateActuatorClient({identity:identity(),
      transport:async()=>{calls++;return first;}});
    await assert.rejects(client.ensureOwnerBound({command_id:COMMAND_ID,request_nonce:NONCE}),/guardian_owner_probe_unproven/);
    assert.equal(calls,1);
  }
});
test('lost read-only probe response never becomes enrollment or retries',async()=>{
  let calls=0;const client=new BrowserGuardianUpdateActuatorClient({identity:identity(),
    transport:async()=>{calls++;throw Error('readback_lost');}});
  await assert.rejects(client.ensureOwnerBound({command_id:COMMAND_ID,request_nonce:NONCE}),/readback_lost/);
  assert.equal(calls,1);
});
test('contract requires authenticated local bridge without weakening future issuer/device requirements',()=>{
  const row=browserGuardianUpdateActuatorClientContract();
  assert.equal(row.owner_enrollment_available,false);assert.equal(row.authenticated_local_owner_bridge_required,true);
  assert.equal(row.hosted_redemption_allowed,false);assert.equal(row.single_use_admin_ticket_required_for_first_binding,true);
  assert.equal(row.ticket_bound_device_signature_required,true);assert.equal(row.automatic_owner_enrollment_retry_allowed,false);
});

test('stale provider/fetch options are refused before calling any supplied producer or pipe',()=>{
  for(const field of ['enrollmentTicketProvider','fetchImpl']){
    let producers=0,pipes=0;
    assert.throws(()=>new BrowserGuardianUpdateActuatorClient({identity:identity(),transport:()=>{pipes++;},
      [field]:()=>{producers++;}}),/guardian_update_actuator_options_invalid/);
    assert.equal(producers,0);assert.equal(pipes,0);
  }
});
