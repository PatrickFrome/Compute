import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunOwnerHostPhases,createRunOwnerClientPhases,runOwnerEvidence,runOwnerScope,runOwnerReadResult} from '../src/native-coding-run-owner-phase.mjs';
import {generatedRunOwnerRead} from './fixtures/native-run-owner-read.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function pair({callback,readScope,verifyOwner,clientSend,hostSend}={}){
  const f=generatedRunOwnerRead(),abort=new AbortController();let client,reads=0,verified=0;
  const host=createRunOwnerHostPhases({binding:f.binding,signal:abort.signal,send:m=>queueMicrotask(()=>client.receive(hostSend?hostSend(m):m))});
  client=createRunOwnerClientPhases({binding:f.binding,input:f.input,assertLifetime(){},
    send:m=>queueMicrotask(()=>host.receive(clientSend?clientSend(m):m)),
    callback:callback?tx=>callback(tx,f):async tx=>{await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;}});
  const promise=host.run(f.scope,{readScope:async()=>{reads++;return readScope?readScope(f,reads):f.scope;},verifyOwner:async e=>{verified++;await verifyOwner?.(e);}});promise.catch(()=>{});
  return {...f,abort,host,client,promise,get reads(){return reads;},get verified(){return verified;}};
}
test('fixed phase binds full original seal and returns source-only digest projection',async()=>{
  const p=pair(),result=await p.promise;assert.deepEqual(await p.client.finish(result),runOwnerReadResult(p.evidence,p.scope));
  assert.equal(p.reads,3);assert.equal(p.verified,1);assert.equal(result.send_capability,false);
  assert.equal(result.qualification.loaded_runtime_code_attested,false);assert.equal(result.qualification.execution_ready,false);
  assert.ok(!JSON.stringify(result).includes('sealed_record'));
});
test('full seal hash rejects changed generation, fields and refreshed original timestamp',()=>{
  const f=generatedRunOwnerRead();for(const mutate of [o=>o.generation++,o=>o.observed_at=new Date().toISOString(),o=>o.hidden='value',o=>o.pending_custody.proof_identity='f'.repeat(64)]){
    const e=structuredClone(f.evidence);mutate(e.sealed_record);assert.throws(()=>runOwnerEvidence(e,f.scope),/phase_invalid/);
  }
  const e=structuredClone(f.evidence);e.source.loaded_runtime_code_attested=true;assert.throws(()=>runOwnerEvidence(e,f.scope),/phase_invalid/);
});
for(const key of ['generation_floor','updated_at','refill_enabled','supervisor_admission_enabled'])test('current control change aborts phase: '+key,async()=>{
  const p=pair({readScope:(f,n)=>{const s=structuredClone(f.scope);if(n>=2)s.control[key]=key==='generation_floor'?9:key==='updated_at'?'2026-10-29T01:01:01.000Z':false;return s;}});
  await assert.rejects(p.promise,/phase_invalid/);p.client.close();await p.client.drain();assert.equal(p.verified,0);
});
test('two simultaneous phases retain separate proof/callback ownership',async()=>{
  let release;const held=new Promise(r=>{release=r;});
  const first=pair({callback:async(tx,f)=>{await held;await tx.readScope();await tx.verifyOwnerRecord(f.evidence);return f.evidence;}}),second=pair();
  const value=await second.promise;await second.client.finish(value);assert.equal(first.reads,0);
  release();await first.client.finish(await first.promise);
});
test('Host abort fences phase but callback drain waits original native callback',async()=>{
  let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  const p=pair({callback:async(tx,f)=>{entered();await held;tx.assertOpen();return f.evidence;}});await started;
  p.abort.abort();p.client.close();await assert.rejects(p.promise,/closed/);let drained=false;p.client.drain().then(()=>{drained=true;});
  await tick();assert.equal(drained,false);release();await p.client.drain();assert.equal(drained,true);
});
for(const field of ['request_id','request_sha256','instance_id','host_pid','body_sha256'])test('foreign phase '+field+' cannot verify Owner',async()=>{
  const p=pair({clientSend:m=>({...m,[field]:field==='host_pid'?9999:field.endsWith('sha256')?'a'.repeat(64):'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})});
  await tick();assert.equal(p.verified,0);p.abort.abort();p.client.close();await assert.rejects(p.promise);await p.client.drain();
});
test('duplicate phase and forged final response never become accepted readback',async()=>{
  const p=pair();const result=await p.promise;await assert.rejects(p.client.finish({...result,send_capability:true}),/phase_invalid/);p.client.close();
  const q=pair();await q.promise;assert.equal(q.host.receive({schema:'metaengine.native-coding.run-owner-phase.v1',...q.binding,sequence:3,phase:'RELEASE',value:{}}),true);
  q.client.close();await q.client.drain();
});
test('input and current scope reject forged project/control shape and stale generation',()=>{
  const f=generatedRunOwnerRead();for(const edit of [s=>s.control.extra=true,s=>s.execution.agent_generation_epoch=1,s=>s.artifact.source_sha='a'.repeat(64),s=>s.device.client_id='bad']){
    const s=structuredClone(f.scope);edit(s);assert.throws(()=>runOwnerScope(s),/phase_invalid/);
  }
});
