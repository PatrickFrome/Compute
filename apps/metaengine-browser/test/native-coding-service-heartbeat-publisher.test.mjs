import {nativeCodingCanonicalSha256 as sha} from '../src/native-coding-task-context.mjs';
import {nativeCapacityPrincipal,nativeCapacityProjection} from '../src/native-coding-capacity-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,sign,verify} from 'node:crypto';
import {admissionFixture} from './fixtures/native-coding-admission-fixture.mjs';
import {nativeCodingCanonicalJson as json} from '../src/native-coding-task-context.mjs';
import {createNativeCodingServiceHeartbeatPublisher,createNativeCodingServiceHeartbeatPublisherV2} from '../src/native-coding-service-heartbeat-publisher.mjs';
import {NATIVE_CODING_DEVICE_PATHS} from '../src/native-coding-device-request.mjs';

// Real ES256 and production publisher/signing code; all Host/PG/OS admission
// responses below are explicit fixtures, never installed execution evidence.
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(version=1){
 const f=admissionFixture(),binding={instance_id:randomUUID(),host_pid:12345,...(version===2?{closed:false}:{})},calls=[];
 let clock=Date.now(),control={supervisor_mode:'CONTROL',armed:true,interrupted_setup_recovery_fenced:false,runtime_control_generation:0};
 const runtime={physical_slot_budget:2,occupied_slots:0,closed:false,shutdown_state:'OPEN',host_unavailable_reason:null,jobs:[]};
 const makeCapacity=(change={})=>{const census={schema:'metaengine.native-coding.capacity-census.v1',host_instance_id:binding.instance_id,host_pid:binding.host_pid,
  principal_sha256:nativeCapacityPrincipal(f.context().device),postgres_scope_sha256:'b'.repeat(64),generation:1,
  owned_tasks_sha256:sha(runtime.jobs.map(({task_id,lease_generation})=>({task_id,lease_generation}))),observed_at:new Date(clock).toISOString(),expires_at:new Date(clock+10000).toISOString(),census_sha256:'c'.repeat(64),
  complete:true,state:'CURRENT',counts:{task_slots:runtime.jobs.length,setup_slots:0,unrepresented_claims:0,represented_tasks:runtime.jobs.length,unresolved_slots:0},automatic_retry_allowed:false,authority_effect:false,...change};
  return {census,projection:nativeCapacityProjection({census,configuredCeiling:2,resourceCeiling:2,localTaskCount:runtime.jobs.length,localRevision:0})};};
 let capacity=makeCapacity();
 let descriptors=[f.provider],write=async packet=>ack(packet),read=async()=>null;
 const material=(path,headers)=>['A2_DEVICE_HTTP_SIGNATURE_V1',`device_id:${f.permit.device_id}`,'method:POST',`path:${path}`,
  `timestamp:${headers['x-a2-device-timestamp']}`,`nonce:${headers['x-a2-device-nonce']}`,`body_sha256:${headers['x-a2-device-body-sha256']}`].join('\n');
 const identity={snapshot:()=>({enrolled:true,device_id:f.permit.device_id,client_id:f.clientId,key_fingerprint_sha256:f.identity.key_fingerprint_sha256}),
  deviceHeaders:async(method,path,text)=>{
   assert.equal(method,'POST');const h={'content-type':'application/json','x-a2-chat-bridge-client':f.clientId,'x-a2-device-profile':'A2_DEVICE_HTTP_SIGNATURE_V1',
    'x-a2-device-id':f.permit.device_id,'x-a2-device-timestamp':new Date(clock).toISOString(),'x-a2-device-nonce':randomUUID().replaceAll('-',''),
    'x-a2-device-body-sha256':hash(text)};
   h['x-a2-device-signature']=sign('sha256',Buffer.from(material(path,h)),{key:f.pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');return h;
  }};
 function ack(packet,{readback=false,expiry=version===2?Date.parse(packet.body.input.capacity.census.expires_at):clock+30000}={}){return {schema:`metaengine.native-coding.service-heartbeat-ack.v${version}`,accepted:true,
  body_sha256:packet.headers['x-a2-device-body-sha256'],witness_sha256:hash(json(packet)),expires_at:new Date(expiry).toISOString(),readback_only:readback,authority_effect:false};}
 const ownPostgres={snapshot:()=>binding,serviceHeartbeatV2:async packet=>{calls.push({operation:'WRITE_V2',packet});return write(packet);},readServiceHeartbeatV2:async packet=>{calls.push({operation:'READ_V2',packet});return read(packet);},serviceHeartbeat:async packet=>{calls.push({operation:'WRITE',packet});return write(packet);},
  readServiceHeartbeat:async packet=>{calls.push({operation:'READ',packet});return read(packet);}};
 const publisher=(version===2?createNativeCodingServiceHeartbeatPublisherV2:createNativeCodingServiceHeartbeatPublisher)({identity,ownPostgres,readCapacity:()=>capacity,readControl:()=>control,readRuntime:()=>runtime,readProviders:()=>descriptors,now:()=>clock});
 return {f,publisher,calls,runtime,control,ack,ownPostgres,identity,material,binding,makeCapacity,get capacity(){return capacity;},setCapacity:value=>{capacity=value;},setControl:value=>{control=value;},setProviders:value=>{descriptors=value;},
  setWrite:value=>{write=value;},setRead:value=>{read=value;},advance:ms=>{clock+=ms;}};
}
const observe=async f=>{f.publisher.observe();await f.publisher.drain();};

test('a 700-provider roster rotates signed byte-bounded admission windows without a fleet ceiling',async()=>{
 const f=fixture(),rows=Array.from({length:700},()=>{
  const row=structuredClone(f.f.provider);row.payload.permit_id=randomUUID();row.payload.provider_id=randomUUID();
  row.payload.agent_id='agent_'+randomUUID();return row;
 });
 f.setProviders(rows);const seen=new Set();
 for(let i=0;i<12&&seen.size<rows.length;i++){
  await observe(f);
  const admitted=f.publisher.admittedProviders();assert(admitted.length>0);
  for(const row of admitted)seen.add(row.payload.permit_id);
  assert(Buffer.byteLength(json(f.calls.at(-1).packet.body))<65536);
 }
 assert.equal(seen.size,700);
});

test('existing heartbeat publishes actual purpose-bound signature and admits only exact acknowledged private providers',async()=>{
 const f=fixture();assert.deepEqual(f.publisher.admittedProviders(),[]);assert.equal(f.calls.length,0);
 await observe(f);assert.equal(f.calls.length,1);const {packet}=f.calls[0];
 assert.equal(verify('sha256',Buffer.from(f.material(NATIVE_CODING_DEVICE_PATHS.SERVICE_HEARTBEAT,packet.headers)),
  {key:f.f.pair.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(packet.headers['x-a2-device-signature'],'base64url')),true);
 assert.deepEqual(Object.keys(packet.body.input.runtime).sort(),['closed','host_unavailable_reason','jobs','occupied_slots','physical_slot_budget','schema','shutdown_state'].sort());
 assert.equal(new Set(Object.keys(packet.body.input.runtime)).size,7);assert.equal(packet.body.input.providers[0].envelope_sha256,hash(json(f.f.provider)));
 const exposed=f.publisher.admittedProviders();assert.equal(exposed.length,1);exposed[0].payload.agent_id='changed';
 assert.equal(f.publisher.admittedProviders()[0].payload.agent_id,f.f.permit.agent_id);
 for(let i=0;i<5;i++)await observe(f);assert.equal(f.calls.length,1);
});
test('actual control/pool transitions hold the roster until a fresh acknowledged observation, retaining UNKNOWN occupancy',async()=>{
 const f=fixture();f.control.armed=false;await observe(f);assert.equal(f.calls.length,0);
 f.control.armed=true;await observe(f);assert.equal(f.publisher.admittedProviders().length,1);
 f.runtime.occupied_slots=1;f.runtime.jobs=[{task_id:randomUUID(),lease_generation:1,state:'READBACK_REQUIRED'}];
 assert.equal(f.publisher.admittedProviders().length,0);await observe(f);assert.equal(f.calls.length,2);
 assert.deepEqual(f.calls[1].packet.body.input.runtime.jobs,f.runtime.jobs);assert.equal(f.publisher.admittedProviders().length,1);
 f.control.runtime_control_generation++;assert.equal(f.publisher.admittedProviders().length,0);
 await observe(f);assert.equal(f.calls[2].packet.body.input.control.runtime_control_generation,1);
 f.setControl(null);await observe(f);assert.equal(f.publisher.admittedProviders().length,0);assert.equal(f.calls.length,3);
});
test('lost write acknowledgement permits only exact signed reads, even after a new body or repeated heartbeats',async()=>{
 const f=fixture();let original;f.setWrite(async p=>{original=p;throw Error('fixture_COMMIT_ACK_UNKNOWN');});
 await observe(f);assert.equal(f.publisher.snapshot().unknown_write_retained,true);assert.equal(f.publisher.admittedProviders().length,0);
 f.control.runtime_control_generation=1;
 for(let i=0;i<4;i++)await observe(f);
 assert.deepEqual(f.calls.map(c=>c.operation),['WRITE','READ','READ','READ','READ']);
 for(const call of f.calls.slice(1))assert.deepEqual(call.packet.body.input,{workspace_id:f.f.permit.workspace_id,body_sha256:original.headers['x-a2-device-body-sha256']});
 f.setRead(async()=>f.ack(original,{readback:true}));await observe(f);
 assert.equal(f.publisher.snapshot().unknown_write_retained,false);assert.equal(f.publisher.admittedProviders().length,0);
 f.setWrite(async p=>f.ack(p));await observe(f);assert.equal(f.calls.at(-1).operation,'WRITE');assert.equal(f.publisher.admittedProviders().length,1);
});
test('known no-effect denial releases only the telemetry intent; next normal observation can publish',async()=>{
 const f=fixture();f.setWrite(async p=>({schema:'metaengine.native-coding.service-heartbeat-ack.v1',accepted:false,
  body_sha256:p.headers['x-a2-device-body-sha256'],write_effect:'ABSENT',automatic_retry_allowed:false,authority_effect:false}));
 await observe(f);assert.equal(f.publisher.snapshot().unknown_write_retained,false);assert.equal(f.publisher.snapshot().state,'ADMISSION_FENCED');
 assert.equal(f.publisher.admittedProviders().length,0);f.setWrite(async p=>f.ack(p));await observe(f);
 assert.deepEqual(f.calls.map(c=>c.operation),['WRITE','WRITE']);assert.equal(f.publisher.admittedProviders().length,1);
});
test('an altered acknowledgement is UNKNOWN, never proof of absence or a reason to re-publish',async()=>{
 const f=fixture();f.setWrite(async p=>({...f.ack(p),body_sha256:'0'.repeat(64)}));await observe(f);
 assert.equal(f.publisher.snapshot().unknown_write_retained,true);await observe(f);
 assert.deepEqual(f.calls.map(c=>c.operation),['WRITE','READ']);assert.equal(f.publisher.admittedProviders().length,0);
});
test('expiry causes HOLD and a new bounded observation; expired readback resolves uncertainty without admitting stale state',async()=>{
 const f=fixture();await observe(f);f.advance(30001);assert.equal(f.publisher.admittedProviders().length,0);
 await observe(f);assert.equal(f.calls.length,2);assert.equal(f.publisher.admittedProviders().length,1);
 const g=fixture();let original;g.setWrite(async p=>{original=p;throw Error('fixture_unknown');});await observe(g);g.advance(30001);
 g.setRead(async()=>g.ack(original,{readback:true,expiry:Date.now()-1}));await observe(g);
 assert.equal(g.publisher.snapshot().unknown_write_retained,false);assert.equal(g.publisher.admittedProviders().length,0);
});
test('inconsistent private provider scope is held rather than silently dropping a workspace or artifact',async()=>{
 const f=fixture();f.setProviders([f.f.provider,{...f.f.provider,payload:{...f.f.provider.payload,permit_id:randomUUID(),workspace_id:randomUUID()}}]);
 await observe(f);assert.equal(f.calls.length,0);assert.equal(f.publisher.admittedProviders().length,0);
});
test('close synchronously fences publication and joins a pending operation without accepting a late ACK',async()=>{
 const f=fixture();let release;const gate=new Promise(resolve=>{release=resolve;});
 f.setWrite(async p=>{await gate;return f.ack(p);});f.publisher.observe();
 for(let i=0;i<20&&!f.calls.length;i++)await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);
 f.publisher.close();assert.equal(f.publisher.admittedProviders().length,0);release();await f.publisher.drain();
 assert.equal(f.publisher.snapshot().state,'CLOSED');assert.equal(f.publisher.snapshot().unknown_write_retained,true);
 for(let i=0;i<3;i++)f.publisher.observe();assert.equal(f.calls.length,1);
});

test('additive Main capacity observation never widens the unchanged runtime.v1 signed wire shape',async()=>{
 const f=fixture();f.runtime.capacity_observation={projection:{free_slots:999},private_marker:'not-wire'};
 await observe(f);const input=f.calls[0].packet.body.input;
 assert.equal(input.schema,'metaengine.native-coding.service-heartbeat.v1');
 assert.deepEqual(Object.keys(input.runtime).sort(),['closed','host_unavailable_reason','jobs','occupied_slots','physical_slot_budget','schema','shutdown_state'].sort());
 assert.equal('capacity_observation' in input.runtime,false);assert.equal('capacity' in input,false);
 assert.equal(JSON.stringify(input).includes('not-wire'),false);assert.equal(f.publisher.admittedProviders().length,1);
});

test('v2 separately reports real setup occupancy without fake jobs, profile mutation or v1 fallback',async()=>{
 const f=fixture(2);f.setCapacity(f.makeCapacity({counts:{task_slots:0,setup_slots:1,unrepresented_claims:0,represented_tasks:0,unresolved_slots:0}}));
 await observe(f);assert.equal(f.calls.length,1);assert.equal(f.calls[0].operation,'WRITE_V2');const value=f.calls[0].packet.body.input;
 assert.equal(value.schema,'metaengine.native-coding.service-heartbeat.v2');assert.equal(value.capacity.projection.free_slots,1);
 assert.equal(value.runtime.physical_slot_budget,2);assert.deepEqual(value.runtime.jobs,[]);assert.equal(value.runtime.occupied_slots,0);
 assert.equal(f.publisher.admittedProviders().length,1);
});
test('v2 unknown publication only reads exact v2 digest; malformed/late ACK cannot upgrade readiness',async()=>{
 const f=fixture(2);let packet;f.setWrite(async p=>{packet=p;throw Error('lost ACK');});await observe(f);
 for(let i=0;i<3;i++)await observe(f);assert.deepEqual(f.calls.map(x=>x.operation),['WRITE_V2','READ_V2','READ_V2','READ_V2']);
 f.setRead(async()=>f.ack(packet,{readback:true,expiry:Date.parse(packet.body.input.capacity.census.expires_at)+1}));await observe(f);
 assert.equal(f.publisher.snapshot().unknown_write_retained,true);assert.equal(f.publisher.admittedProviders().length,0);
 f.setRead(async()=>f.ack(packet,{readback:true}));await observe(f);assert.equal(f.publisher.admittedProviders().length,1);
 f.advance(10000);assert.equal(f.publisher.admittedProviders().length,0);
});
for(const change of ['host','identity','observation'])test('v2 late ACK after '+change+' change cannot expose providers',async()=>{
 const f=fixture(2);let release,packet;const gate=new Promise(r=>{release=r;});f.setWrite(async p=>{packet=p;await gate;return f.ack(p);});
 f.publisher.observe();await new Promise(r=>setImmediate(r));
 if(change==='host')f.binding.instance_id=randomUUID();
 if(change==='identity')f.identity.snapshot=()=>({enrolled:false});
 if(change==='observation')f.setCapacity(f.makeCapacity({generation:2,census_sha256:'d'.repeat(64)}));
 release();await f.publisher.drain();assert.ok(packet);assert.equal(f.publisher.admittedProviders().length,0);
});
test('v2 missing/partial/stale census and mixed peer ACK fail closed without v1 publication',async()=>{
 const f=fixture(2);f.setCapacity(null);await observe(f);assert.equal(f.calls.length,0);
 f.setCapacity(f.makeCapacity());f.capacity.census.complete=false;await observe(f);assert.equal(f.calls.length,0);
 f.setCapacity(f.makeCapacity());f.advance(10000);await observe(f);assert.equal(f.calls.length,0);
 f.setCapacity(f.makeCapacity({generation:2}));f.setWrite(async p=>({...f.ack(p),schema:'metaengine.native-coding.service-heartbeat-ack.v1'}));await observe(f);
 assert.equal(f.calls[0].operation,'WRITE_V2');assert.equal(f.publisher.admittedProviders().length,0);assert.equal(f.publisher.snapshot().unknown_write_retained,true);
});
