import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingProjectCheckpointObserver} from '../src/native-coding-project-checkpoints.mjs';
import {AutonomousProjectTaskRuntime} from '../src/autonomous-project-task-runtime.mjs';
const candidate=()=>({project_id:randomUUID(),writer_task_id:randomUUID(),writer_lease_generation:1,
  critic_task_id:randomUUID(),critic_lease_generation:2});
const receipt=row=>({schema:'metaengine.native-coding.project-checkpoint.v1',...row,state:'CHECKPOINTED_PENDING_COMMIT',
  checkpoint_sha256:'a'.repeat(64),successor_admitted:false,authority_effect:false});
const drain=async observer=>{for(let i=0;i<100&&observer.snapshot().running;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(observer.snapshot().running,false);};

test('slow private checkpoint verifier never blocks or duplicates the existing heartbeat',async()=>{
  let release,calls=0;const gate=new Promise(resolve=>{release=resolve;}),row=candidate();
  const observer=createNativeCodingProjectCheckpointObserver({ownPostgres:{readProjectCheckpoint:async()=>null,
    reconcileProject:async()=>{calls++;await gate;return receipt(row);}}});
  observer.observe([row]);for(let i=0;i<10;i++)observer.observe([row]);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(observer.snapshot().running,true);
  release();await drain(observer);assert.equal(observer.snapshot().checkpointed,1);observer.close();
});

test('lost checkpoint ACK only reads the exact pair; another historical checkpoint cannot clear its fence',async()=>{
  let writes=0,reads=0,current=null;const row=candidate();
  const observer=createNativeCodingProjectCheckpointObserver({ownPostgres:{
    readProjectCheckpoint:async()=>{reads++;return current;},reconcileProject:async()=>{writes++;throw Error('fixture_lost_commit_ack');}}});
  observer.observe([row]);await drain(observer);assert.equal(observer.snapshot().readback_required,1);
  current=receipt({...candidate(),project_id:row.project_id});observer.observe([row]);await drain(observer);
  assert.equal(observer.snapshot().readback_required,1);assert.equal(writes,1);
  current=receipt(row);observer.observe([]);await drain(observer);
  assert.equal(observer.snapshot().checkpointed,1);assert.equal(writes,1);assert.equal(reads,3);observer.close();
});

test('restarted observer reads an already committed pair without repeating its checkpoint write',async()=>{
  const row=candidate();let writes=0;
  const observer=createNativeCodingProjectCheckpointObserver({ownPostgres:{readProjectCheckpoint:async()=>receipt(row),
    reconcileProject:async()=>{writes++;throw Error('must_not_write');}}});
  observer.observe([row]);await drain(observer);assert.equal(observer.snapshot().checkpointed,1);assert.equal(writes,0);observer.close();
});

test('bounded local cache retires only durably acknowledged entries across further logical tasks',async()=>{
  let current;const observer=createNativeCodingProjectCheckpointObserver({maxEntries:2,ownPostgres:{
    readProjectCheckpoint:async()=>null,reconcileProject:async()=>receipt(current)}});
  for(let i=0;i<12;i++){current=candidate();observer.observe([current]);await drain(observer);}
  assert.equal(observer.snapshot().checkpointed,2);assert.equal(observer.snapshot().capacity_fenced,false);observer.close();
});

test('full unresolved cache preserves old ambiguity and still permits its readback',async()=>{
  const first=candidate(),second=candidate(),third=candidate();let current=null,writes=0;
  const observer=createNativeCodingProjectCheckpointObserver({maxEntries:2,ownPostgres:{
    readProjectCheckpoint:async()=>current,reconcileProject:async()=>{writes++;throw Error('fixture_unknown');}}});
  for(const row of [first,second]){observer.observe([row]);await drain(observer);}
  for(let i=0;i<4&&!observer.snapshot().capacity_fenced;i++){observer.observe([third]);await drain(observer);}
  assert.equal(writes,2);assert.equal(observer.snapshot().capacity_fenced,true);
  current=receipt(first);
  for(let i=0;i<4&&!observer.snapshot().checkpointed;i++){observer.observe([]);await drain(observer);}
  assert.equal(observer.snapshot().readback_required,1);assert.equal(observer.snapshot().checkpointed,1);
  current=null;
  for(let i=0;i<4&&writes<3;i++){observer.observe([third]);await drain(observer);}
  assert.equal(writes,3);observer.close();
});

test('closing before a delayed read settles prevents a late checkpoint write',async()=>{
  let release,writes=0;const gate=new Promise(resolve=>{release=resolve;}),row=candidate();
  const observer=createNativeCodingProjectCheckpointObserver({ownPostgres:{readProjectCheckpoint:async()=>{await gate;return null;},
    reconcileProject:async()=>{writes++;return receipt(row);}}});
  observer.observe([row]);await new Promise(resolve=>setImmediate(resolve));observer.close();release();await drain(observer);
  assert.equal(writes,0);assert.equal(observer.snapshot().closed,true);
});

test('project reconciliation forwards only bounded native pair selectors to its private runtime',async()=>{
  const row=candidate();let observed;
  const runtime=new AutonomousProjectTaskRuntime({journal:{find(){},begin(){},confirm(){}},materializeProject:async()=>{},
    request:async()=>({schema:'metaengine.devos.project-reconcile.v1',project_id:null,bounded_projects:4,
      projects:[{project_id:row.project_id,native_checkpoint_pending:true,
        native_checkpoint_candidate:Object.fromEntries(Object.entries(row).filter(([key])=>key!=='project_id'))}],authority_effect:false})});
  runtime.bindNativeCodingRuntime({observeProjectCheckpoints:candidates=>{observed=candidates;return {running:true};}});
  assert.deepEqual((await runtime.tick()).native_checkpoints,{running:true});assert.deepEqual(observed,[row]);await runtime.close();
});

test('rejection observer performs only bounded reads and never grants repair or loses an in-flight read on close',async()=>{
 const {createNativeCodingProjectRejectionObserver}=await import('../src/native-coding-project-checkpoints.mjs');
 let calls=0,release,now=Date.now();const gate=new Promise(resolve=>{release=resolve;});
 const reference={schema:'metaengine.native-coding.review-rejection.v1',...candidate(),result_sha256:'a'.repeat(64),verdict:'REJECT',automatic_retry_allowed:false,authority_effect:false};
 const response=query=>({schema:'metaengine.native-coding.project-rejection-readback.v1',state:'VERIFIED_REJECTION',...query,
  rejection_sha256:'b'.repeat(64),git_artifact_sha256:'c'.repeat(64),source_head:'d'.repeat(40),observed_at:new Date(now).toISOString(),
  repair_authorized:false,checkpoint_created:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false});
 const observer=createNativeCodingProjectRejectionObserver({clock:()=>now,ownPostgres:{readProjectRejection:async query=>{calls++;await gate;return response(query);}}});
 observer.observe(reference);observer.observe(reference);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 release();await observer.drain();assert.equal(observer.snapshot().observations[0].state,'VERIFIED_REJECTION');
 observer.observe(reference);await observer.drain();assert.equal(calls,1);
 now+=16000;observer.observe(reference);await observer.drain();assert.equal(calls,2);assert.equal(observer.snapshot().repair_authorized,false);
 observer.close();assert.equal(observer.snapshot().observations[0].state,'READBACK_REQUIRED');
});
test('rejection observer refuses wrong pair, stale proof and fabricated repair authorization',async()=>{
 const {createNativeCodingProjectRejectionObserver}=await import('../src/native-coding-project-checkpoints.mjs');
 const reference={schema:'metaengine.native-coding.review-rejection.v1',...candidate(),result_sha256:'a'.repeat(64),verdict:'REJECT',automatic_retry_allowed:false,authority_effect:false};
 for(const change of [{writer_task_id:'00000000-0000-4000-8000-000000000099'},{repair_authorized:true},{observed_at:'2000-01-01T00:00:00.000Z'}]){
  const observer=createNativeCodingProjectRejectionObserver({ownPostgres:{readProjectRejection:async query=>({schema:'metaengine.native-coding.project-rejection-readback.v1',state:'VERIFIED_REJECTION',...query,
   rejection_sha256:'b'.repeat(64),git_artifact_sha256:'c'.repeat(64),source_head:'d'.repeat(40),observed_at:new Date().toISOString(),
   repair_authorized:false,checkpoint_created:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false,...change})}});
  observer.observe(reference);await observer.drain();assert.equal(observer.snapshot().observations[0].state,'READBACK_REQUIRED');observer.close();
 }
});

test('cached verified rejection expires without a heartbeat and cannot survive a regressed clock',async()=>{
 const {createNativeCodingProjectRejectionObserver}=await import('../src/native-coding-project-checkpoints.mjs');
 let now=Date.now(),reads=0;
 const reference={schema:'metaengine.native-coding.review-rejection.v1',...candidate(),result_sha256:'a'.repeat(64),verdict:'REJECT',automatic_retry_allowed:false,authority_effect:false};
 const observer=createNativeCodingProjectRejectionObserver({clock:()=>now,ownPostgres:{readProjectRejection:async query=>{
  reads++;return {schema:'metaengine.native-coding.project-rejection-readback.v1',state:'VERIFIED_REJECTION',...query,
   rejection_sha256:'b'.repeat(64),git_artifact_sha256:'c'.repeat(64),source_head:'d'.repeat(40),observed_at:new Date(now).toISOString(),
   repair_authorized:false,checkpoint_created:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
 }}});
 observer.observe(reference);await observer.drain();const checked=now;
 assert.equal(observer.snapshot().observations[0].state,'VERIFIED_REJECTION');
 now+=30001;const stale=observer.snapshot().observations[0];
 assert.equal(stale.state,'READBACK_REQUIRED');assert.equal(stale.rejection_sha256,null);assert.equal(stale.observed_at,null);
 assert.equal(reads,1,'snapshot must not start a background reread');
 now=checked-6000;assert.equal(observer.snapshot().observations[0].state,'READBACK_REQUIRED');
 now=NaN;assert.equal(observer.snapshot().observations[0].state,'READBACK_REQUIRED');
 now=checked;assert.equal(observer.snapshot().observations[0].state,'READBACK_REQUIRED','clock reset cannot revive expired proof');
 now=checked+40000;observer.observe(reference);await observer.drain();
 assert.equal(reads,2);assert.equal(observer.snapshot().observations[0].state,'VERIFIED_REJECTION');
 observer.close();assert.equal(observer.snapshot().observations[0].observed_at,null);
});
