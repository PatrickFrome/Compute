import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {nativePhysicalTaskFixture} from './test/fixtures/native-coding-physical-task-fixture.mjs';

// The override is test-only: the same regressions also run against a preserved
// earlier module to record the authority failure before the guard was added.
const target=process.env.METAENGINE_PHYSICAL_AUTHORITY_TEST_MODULE
 ?pathToFileURL(process.env.METAENGINE_PHYSICAL_AUTHORITY_TEST_MODULE)
 :new URL('./native-coding-physical-custody.mjs',import.meta.url);
const {createNativeCodingPhysicalCustody,verifyNativePhysicalTask}=await import(target);

function fixture(){
 const graph=nativePhysicalTaskFixture(),root=graph.publication.root;
 const calls={begin:0,query:0,cache:0,native:0,host:0,receipt:0,journal:0};
 const sentinel=kind=>(...args)=>{
  calls[kind]++;
  if(kind==='query'&&/native_coding_physical_resolution_h205f22/i.test(String(args[0])))calls.cache++;
  throw Error('generated_authority_sentinel_'+kind);
 };
 const tx={unsafe:sentinel('query')};
 const service=createNativeCodingPhysicalCustody({sql:{begin:sentinel('begin'),unsafe:sentinel('query')},
  hostInstanceId:root.host_instance_id,hostPid:root.host_pid,
  postgresIdentity:{...root.pg_identity,started_at:root.pg_identity.started_at},
  readNativeScope:sentinel('native'),readPublicationHost:sentinel('host'),
  readProtectedReceipt:sentinel('receipt'),readCallbackClosure:sentinel('journal')});
 const actor={device_id:root.device_id,client_id:root.client_id,admin_grant_epoch:root.admin_grant_epoch,key_fingerprint_sha256:root.key_sha256};
 const evidence={host_instance_id:root.host_instance_id,generation:1,observed_at:'2026-11-01T01:01:00.000Z',
  postgres_scope_sha256:'a'.repeat(64),resolved:[{kind:'TASK',key:root.scope.task_id+':'+root.scope.lease_generation,durable_sha256:'b'.repeat(64)}]};
 return {graph,calls,tx,service,actor,evidence};
}
const zero={begin:0,query:0,cache:0,native:0,host:0,receipt:0,journal:0};
const held=service=>{
 const value=service.snapshot();assert.equal(value.historical_resolution,'HOLD');
 assert.equal(value.full_scope_qualification,'UNAVAILABLE');assert.equal(value.readiness,false);assert.equal(value.authority_effect,false);
};

test('complete generated source graph remains audit data and grants no observation authority',async()=>{
 const f=fixture(),before=structuredClone(f.graph);
 assert.match(verifyNativePhysicalTask(f.graph),/^[a-f0-9]{64}$/);
 held(f.service);
 assert.equal(await f.service.verifyObservation({tx:f.tx,actor:f.actor,evidence:f.evidence,...f.graph}),0);
 assert.deepEqual(f.graph,before);assert.deepEqual(f.calls,zero);held(f.service);
 f.service.close();await f.service.drain();assert.deepEqual(f.calls,zero);
});

for(const [name,claims] of [
 ['JSON verification flags',{verified:true,cleanup_confirmed:true,all_effects_cleanup:'CONFIRMED',readiness:true}],
 ['claimed full-scope source',{schema:'metaengine.native-coding.full-scope-proof.v1',scope:'FULL_SCOPE',qualified:true,
  host_callbacks:'ATTESTED',broker_drain:'ATTESTED',source:'LOCAL_HOST_OWNER'}],
 ['fabricated private capability',{fullScopeCapability:Object.freeze({}),nativeQualification:Object.freeze({verified:true}),
  ownerCapability:{authority_effect:true},proof_sha256:'c'.repeat(64)}],
 ['serialized capability',{capability:JSON.parse('{"native_qualified":true,"full_scope":true,"cleanup_confirmed":true}') }],
])test(name+' cannot enable historical release or cause native/cache reads',async()=>{
 const f=fixture(),input={tx:f.tx,actor:{...f.actor,...claims},evidence:{...f.evidence,...claims},...claims,...f.graph};
 assert.equal(await f.service.verifyObservation(input),0);assert.deepEqual(f.calls,zero);held(f.service);
 f.service.close();await f.service.drain();assert.deepEqual(f.calls,zero);
});

test('no transaction or claimed proof object is needed to retain fail-closed observation authority',async()=>{
 const f=fixture();
 for(const value of [undefined,null,true,{},Object.freeze({verified:true}),Object.create({full_scope:true})]){
  assert.equal(await f.service.verifyObservation(value),0);held(f.service);
 }
 assert.deepEqual(f.calls,zero);f.service.close();await f.service.drain();
});

test('serialized SETUP scope and fabricated drain tokens are refused before SQL or native observations',async()=>{
 const f=fixture(),scope=f.graph.publication.root.scope;
 const source={operationId:scope.task_id,custodyId:scope.reservation_id,actor:f.actor,
  request:{requestId:f.graph.reserve.request.frame.request_id,requestDigest:f.graph.reserve.request.request_sha256},
  operation:{state:'STOPPED',cleanup_state:'DRAINED'},cleanup_confirmed:true,job_joined:true,readiness:true};
 const values=[undefined,null,true,{},source,structuredClone(source),JSON.parse(JSON.stringify(source)),
  Object.freeze({...source}),Object.create(source),Object.create(null),
  Object.freeze({token:Object.freeze({}),drain:Promise.resolve({cleanup_confirmed:true}),verified:true}),
  {get cleanup_confirmed(){throw Error('generated_token_property_must_not_be_read');}}];
 for(const value of values){
  await assert.rejects(Promise.resolve().then(()=>f.service.sealSetup(value)),/native_setup_original_job_drain_required/);
  assert.deepEqual(f.calls,zero);held(f.service);
 }
 f.service.close();await f.service.drain();assert.deepEqual(f.calls,zero);
});

test('a closed consumer cannot be reopened by supplying a claimed qualification',async()=>{
 const f=fixture();f.service.close();
 await assert.rejects(f.service.verifyObservation({verified:true,readiness:true,fullScopeCapability:{}}),/native_physical_custody_closed/);
 await f.service.drain();assert.deepEqual(f.calls,zero);held(f.service);
});
