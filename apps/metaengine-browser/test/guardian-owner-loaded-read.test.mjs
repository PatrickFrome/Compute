import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPublicKey,verify} from 'node:crypto';
import {SupervisorDeviceIdentity,GUARDIAN_OWNER_CHALLENGE_PROFILE} from '../src/supervisor-device-identity.mjs';
import {requestGuardianOwnerReadPipe,requestGuardianUpdatePipe,BrowserGuardianUpdateActuatorClient,
  BROWSER_GUARDIAN_UPDATE_ACTUATOR_PIPE} from '../src/browser-guardian-update-actuator-client.mjs';

const command_id='11111111-1111-4111-8111-111111111111',request_nonce='a'.repeat(32);
const wire=['wire_schema=metaengine.browser-guardian.owner-challenge-request.v1',`command_id=${command_id}`,
  `request_nonce=${request_nonce}`,'public_jwk_x='+'A'.repeat(43),'public_jwk_y='+'B'.repeat(43),'signature='+'C'.repeat(86)].join('\n')+'\n';
const result={schema:'metaengine.browser-guardian.update-actuator-result.v1',state:'OWNER_BOUND',
  effect_absent_proven:true,owner_binding_proven:true,device_binding_proven:true,device_key_fingerprint_sha256:'d'.repeat(64),
  automatic_retry_allowed:false,caller_supplied_path_used:false,caller_supplied_url_used:false,caller_supplied_shell_used:false,authority_effect:false};
const tick=()=>new Promise(r=>setImmediate(r));
function transport(t){
  // Generated EventEmitter socket only. No OS pipe/network/Windows proof.
  const platform=Object.getOwnPropertyDescriptor(process,'platform');
  Object.defineProperty(process,'platform',{...platform,value:'win32'});t.after(()=>Object.defineProperty(process,'platform',platform));
  const socket=new EventEmitter();socket.destroyCalls=0;socket.writes=[];
  socket.destroy=()=>{socket.destroyCalls++;return socket;};socket.setTimeout=()=>socket;socket.write=value=>socket.writes.push(value);
  let opens=0;t.mock.method(net,'createConnection',pipe=>{assert.equal(pipe,BROWSER_GUARDIAN_UPDATE_ACTUATOR_PIPE);opens++;return socket;});
  return {socket,get opens(){return opens;}};
}
function tracked(promise){let settled=false;promise.then(()=>{settled=true;},()=>{settled=true;});return{promise,get settled(){return settled;}};}
test('loaded Guardian read owns original close after valid response; duplicate close cannot resend',async t=>{
  const f=transport(t),work=tracked(requestGuardianOwnerReadPipe(wire));f.socket.emit('connect');
  f.socket.emit('data',Buffer.from(JSON.stringify(result)+'\n'));await tick();assert.equal(work.settled,false);
  assert.equal(f.socket.destroyCalls,1);assert.deepEqual(f.socket.writes,[wire]);
  f.socket.emit('close');assert.equal((await work.promise).state,'OWNER_BOUND');f.socket.emit('close');
  assert.equal(f.opens,1);assert.equal(f.socket.destroyCalls,1);
});
for(const delayed of [false,true])test('loaded Guardian read error retains held close; delayed='+delayed,async t=>{
  const f=transport(t),work=tracked(requestGuardianOwnerReadPipe(wire));if(delayed){f.socket.emit('connect');await tick();}
  f.socket.emit('error',Object.assign(Error('generated'),{code:'ENOENT'}));await tick();assert.equal(work.settled,false);
  f.socket.emit('close');await assert.rejects(work.promise,e=>e.code===(delayed?'GUARDIAN_PIPE_IO_ERROR':'GUARDIAN_PIPE_NOT_FOUND'));
  assert.equal(f.opens,1);
});
test('absolute caller deadline is not cleanup while original socket close is withheld',async t=>{
  const f=transport(t);t.mock.timers.enable({apis:['setTimeout']});
  const work=tracked(requestGuardianOwnerReadPipe(wire));f.socket.emit('connect');t.mock.timers.tick(2000);
  await tick();assert.equal(work.settled,false);assert.equal(f.socket.destroyCalls,1);
  f.socket.emit('data',Buffer.from(JSON.stringify(result)+'\n'));assert.equal(work.settled,false);
  f.socket.emit('close');await assert.rejects(work.promise,/pipe_timeout/);assert.equal(f.opens,1);
});
test('cancellation fences send and retains exact original close',async t=>{
  const f=transport(t),abort=new AbortController(),work=tracked(requestGuardianOwnerReadPipe(wire,{signal:abort.signal}));
  abort.abort();f.socket.emit('connect');await tick();assert.equal(work.settled,false);assert.deepEqual(f.socket.writes,[]);
  f.socket.emit('close');await assert.rejects(work.promise,/cancelled/);assert.equal(f.opens,1);
});
test('already cancelled read opens no socket; alternate pipe/effect wire refused',async t=>{
  const f=transport(t),abort=new AbortController();abort.abort();
  await assert.rejects(requestGuardianOwnerReadPipe(wire,{signal:abort.signal}),/cancelled/);
  assert.throws(()=>requestGuardianOwnerReadPipe(wire,{pipeName:'different'}),/options_invalid/);
  for(const bad of [wire+'action=DISPATCH\n',wire.replace('owner-challenge-request','update-request'),wire.replace('command_id=','command=')])
    assert.throws(()=>requestGuardianOwnerReadPipe(bad),/wire_invalid/);
  assert.equal(f.opens,0);
});
test('original legacy transport still returns its result without new joined-close semantics',async t=>{
  const f=transport(t),work=requestGuardianUpdatePipe(wire);f.socket.emit('connect');
  f.socket.emit('data',Buffer.from(JSON.stringify(result)+'\n'));assert.equal((await work).state,'OWNER_BOUND');
  assert.equal(f.socket.destroyCalls,1);f.socket.emit('close');
});
test('default loaded observer uses joined fixed transport and never legacy signer/transport',async t=>{
  const f=transport(t);let reads=0;
  const client=new BrowserGuardianUpdateActuatorClient({identity:{
    guardianOwnerChallenge(){throw Error('ensure-capable signer forbidden');},guardianUpdateActuatorProof(){throw Error('effect forbidden');},
    guardianOwnerReadChallenge(input){reads++;assert.deepEqual(input,{command_id,request_nonce});return {public_jwk:{kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'B'.repeat(43)},signature:'C'.repeat(86),key_fingerprint_sha256:'d'.repeat(64)};},
  },transport(){throw Error('legacy transport forbidden');}});
  const work=tracked(client.observeOwnerLoaded({command_id,request_nonce}));f.socket.emit('connect');
  f.socket.emit('data',Buffer.from(JSON.stringify(result)+'\n'));await tick();assert.equal(work.settled,false);
  f.socket.emit('close');assert.equal((await work.promise).state,'OWNER_BOUND');assert.equal(reads,1);
});
test('loaded signer shares canonical bytes, never ensures/writes, and refuses ticket/unloaded identity',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'guardian-loaded-signing-')),statePath=path.join(dir,'identity.json');
  const secureStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  try{
    const identity=new SupervisorDeviceIdentity({statePath,secureStorage});
    assert.throws(()=>identity.guardianOwnerReadChallenge({command_id,request_nonce}),/not_loaded/);
    // Explicit fixture setup, not the production read path or native DPAPI proof.
    await identity.ensure();await identity.bindDevice('22222222-2222-4222-8222-222222222222');
    const before=await fs.readFile(statePath),legacy=await identity.guardianOwnerChallenge({command_id,request_nonce});let ensures=0;
    identity.ensure=()=>{ensures++;throw Error('ensure forbidden');};
    const loaded=identity.guardianOwnerReadChallenge({command_id,request_nonce});
    const bytes=Buffer.from([GUARDIAN_OWNER_CHALLENGE_PROFILE,`command_id:${command_id}`,`request_nonce:${request_nonce}`].join('\n'));
    for(const proof of [legacy,loaded])assert.equal(verify('sha256',bytes,{key:createPublicKey({key:proof.public_jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(proof.signature,'base64url')),true);
    assert.throws(()=>identity.guardianOwnerReadChallenge({command_id,request_nonce,enrollment_ticket_sha256:'a'.repeat(64)}),/input_invalid/);
    assert.deepEqual(await fs.readFile(statePath),before);assert.equal(ensures,0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
