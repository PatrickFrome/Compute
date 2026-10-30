// Reconstructed regression coverage, not recovered original test bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPendingActivationHostPhases,createPendingActivationClientPhases,pendingActivationInput} from '../src/native-coding-pending-activation-phase.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture({callback,alterClient=v=>v,alterHost=v=>v,alterScope=v=>v}={}){
 const input={preparation_id:randomUUID(),configuration_sha256:'a'.repeat(64),request_id:randomUUID(),objective:'Implement saved goal',activation_id:randomUUID(),profile_id:randomUUID(),profile_sha256:'b'.repeat(64)};
 const binding={instance_id:randomUUID(),host_pid:1234,request_id:randomUUID(),action:'ACTIVATE_PREPARED_GOAL_V1',request_sha256:'c'.repeat(64),body_sha256:'d'.repeat(64)};
 const scope={schema:'metaengine.native-coding.pending-activation-scope.v1',input,scope:{device_id:randomUUID(),client_id:randomUUID(),project_id:randomUUID(),key_fingerprint_sha256:'e'.repeat(64),admin_grant_epoch:1,observed_at:new Date().toISOString()},artifact:{installed_exe_sha256:'1'.repeat(64),installed_asar_sha256:'2'.repeat(64),runtime_bundle_sha256:'3'.repeat(64),source_sha:'4'.repeat(40),cli_executable_sha256:'5'.repeat(64)}};
 const abort=new AbortController(),events=[];let verified=0,client;
 const host=createPendingActivationHostPhases({binding,signal:abort.signal,send:m=>{events.push(m);queueMicrotask(()=>client.receive(alterHost(structuredClone(m))));}});
 client=createPendingActivationClientPhases({binding,input,assertLifetime:()=>{if(abort.signal.aborted)throw Error('aborted');},send:m=>{events.push(m);queueMicrotask(()=>host.receive(alterClient(structuredClone(m))));},callback:callback|| (async tx=>{
  assert.equal(tx.prepareTransition,undefined);assert.equal(tx.unsafe,undefined);assert.deepEqual(tx.activation.input,input);
  await tx.readScope();await tx.verifyTransition({sealed_sha256:'f'.repeat(64)});return {private:'NOT_TRANSMITTED'};
 })});
 const run=async()=>{try{const proof=await host.authorize(scope,{readScope:async()=>alterScope(structuredClone(scope)),verifyTransition:async()=>{verified++;}});assert.equal(proof.sealed_sha256,'f'.repeat(64));return await client.finish({state:'OUTER_COMMITTED'});}finally{host.close();client.close();await client.drain();}};
 return {input,scope,abort,host,client,events,run,get verified(){return verified;}};
}
test('activation phase verifies read-only custody then returns outer commit result, not local callback value',async()=>{
 const f=fixture();assert.deepEqual(await f.run(),{state:'OUTER_COMMITTED'});assert.equal(f.verified,1);
 assert.equal(JSON.stringify(f.events).includes('NOT_TRANSMITTED'),false);
 assert.deepEqual(f.events.filter(m=>m.phase!=='ACK'&&m.phase!=='LOCKED').map(m=>m.phase),['RECHECK_SCOPE','VERIFY_TRANSITION','RELEASE']);
});
for(const key of ['instance_id','host_pid','action','request_sha256','body_sha256','sequence'])test('activation phase rejects mismatched '+key,async()=>{
 const f=fixture({alterClient:m=>({...m,[key]:key==='sequence'?m.sequence+1:'foreign'})});await assert.rejects(f.run());assert.equal(f.verified,0);
});
for(const key of ['input','artifact','scope'])test('activation phase refuses changed '+key+' before verification',async()=>{
 const f=fixture({alterScope:s=>{if(key==='input')s.input.activation_id=randomUUID();if(key==='artifact')s.artifact.source_sha='a'.repeat(40);if(key==='scope')s.scope.project_id=randomUUID();return s;}});
 await assert.rejects(f.run());assert.equal(f.verified,0);
});
test('phase abort joins main native callback before cleanup; no late verification',async()=>{
 const entered=deferred(),gate=deferred();let done=false;
 const f=fixture({callback:async tx=>{await tx.readScope();entered.resolve();await gate.promise;done=true;tx.assertOpen();return true;}});
 const work=f.run();work.catch(()=>{});await entered.promise;f.abort.abort();let finished=false;work.catch(()=>{finished=true;});await new Promise(r=>setImmediate(r));assert.equal(finished,false);gate.resolve();await assert.rejects(work);assert.equal(done,true);assert.equal(f.verified,0);
});
test('activation input has no renderer Owner, path, SQL, grant or synthetic authority fields',()=>{
 const f=fixture();for(const key of ['owner','path','sql','admin_grant_epoch','verified'])assert.throws(()=>pendingActivationInput({...f.input,[key]:true}));f.host.close();f.client.close();
});
