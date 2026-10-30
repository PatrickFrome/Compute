// Generated source fixtures only. Real PostgreSQL/control locks have separate coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createNativeRunOwnerReader,RUN_OWNER_CONTROL_SQL,RUN_OWNER_ANCHOR_SQL} from './native-coding-run-owner-read.mjs';
import {generatedRunOwnerRead} from '../../apps/metaengine-browser/test/fixtures/native-run-owner-read.mjs';
import {nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';

function fixture(){
 const f=generatedRunOwnerRead(),s=f.scope,d=s.device;
 const permit={permit_id:f.binding.request_id,project_id:s.project_id,goal_id:s.root_task_id,goal_sha256:'a'.repeat(64),artifact:s.artifact,postgres:{system_identifier:'123'}};
 const native={host_process:{pid:f.evidence.sealed_record.pid,created_at:f.evidence.sealed_record.created_at,process_incarnation_id:s.execution.host_incarnation},postgres:permit.postgres};
 const pending={request_id:s.root_task_id},activation={...pending,activation_id:s.activation_id};
 const seed={project_id:s.project_id,goal_id:permit.goal_id,goal_sha256:permit.goal_sha256};
 const row={execution:{...s.execution,state:'RESERVED'},pending_input:pending,configuration:{artifact:s.artifact,postgres:permit.postgres},preparation:{state:'PREPARED'},admission:{root_task_id:s.root_task_id},activation_input:activation,
  activation_id:s.activation_id,sealed_owner_sha256:s.sealed_owner_sha256,activation_receipt:{state:'ACTIVATED',project_id:s.project_id,root_task_id:s.root_task_id,input:activation},
  seed_receipt:seed,current_seed_receipt:structuredClone(seed),observation:native,permit_ids:[permit.permit_id],root_task_id:s.root_task_id,observed_at:s.observed_at};
 const fixed={preparation_sha256:sha(row.preparation),admission_sha256:sha(row.admission),...d,host_instance_id:f.binding.instance_id,host_pid:f.binding.host_pid};
 const intents={
  'native-coding-pending-owner-intent-v1.json':{binding:{schema:'metaengine.native-coding.pending-owner-intent.v1',input:pending,...fixed},origin:{action:'ESTABLISH_PENDING_OWNER_V1',request_id:f.binding.request_id,request_sha256:'a'.repeat(64),body_sha256:'b'.repeat(64)},transition:{previous_sha256:null,next_sha256:s.sealed_owner_sha256}},
  'native-coding-pending-activation-intent-v1.json':{binding:{schema:'metaengine.native-coding.pending-activation-intent.v1',input:activation,...fixed},sealed_owner_sha256:s.sealed_owner_sha256},
 };
 const calls=[],state={control:structuredClone(s.control),grant:true,environment:true,hook:()=>{},scopedHook:()=>{}};
 const tx={assertOpen(){},unsafe:async(q,args)=>{
  calls.push(q);if(q===RUN_OWNER_CONTROL_SQL)return[structuredClone(state.control)];
  if(q===RUN_OWNER_ANCHOR_SQL)return[structuredClone({...row,observed_at:new Date().toISOString()})];
  if(q.includes('join public.compute_fabric_a2_chat_bridge_remote_pairing'))return state.grant?[{key_fingerprint_sha256:d.key_fingerprint_sha256}]:[];
  if(q.startsWith('select public.devos_environment_state'))return[{value:{refill_enabled:state.environment,supervisor_admission_enabled:true,generation_floor:state.control.generation_floor}}];
  throw Error('unexpected SQL');
 }};
 const request={instanceId:f.binding.instance_id,hostPid:f.binding.host_pid,requestId:f.binding.request_id,
  signal:new AbortController().signal,deadlineAt:Date.now()+30000,runOwnerPhases:{close(){},async run(initial,handlers){
   assert.deepEqual(initial.execution,s.execution);await handlers.readScope();await state.hook();
   await handlers.readScope();await handlers.verifyOwner(f.evidence);await handlers.readScope();
   return{qualification:{production_qualified:false,loaded_runtime_code_attested:false}};
  }}};
 const reader=createNativeRunOwnerReader({sql:{unsafe:()=>{throw Error('root pool read forbidden');}},scoped:async(got,scope,live,req)=>{
  assert.equal(got,tx);assert.equal(req,request);assert.equal(live,true);assert.deepEqual(scope,s.execution);state.scopedHook();
  return{c:{permit,device:d},native};},owner:async got=>assert.equal(got,tx),open(){},identity:{hostInstanceId:request.instanceId,hostPid:request.hostPid},stateDirectory:path.resolve('generated-intents'),
  readProtectedJson:async file=>({value:structuredClone(intents[path.basename(file)])})});
 return{...f,reader,tx,request,permit,row,intents,state,calls,read:()=>reader.readOwnerControl({permit,scope:s.execution,tx,request})};
}
test('private reader joins exact activation/intents and retains original seal timestamp on same transaction',async()=>{
 const f=fixture(),r=await f.read();assert.equal(r.owner.observed_at,f.evidence.sealed_record.observed_at);assert.equal(r.observed_at,f.evidence.observed_at);
 assert.equal(r.sealed_owner_sha256,f.scope.sealed_owner_sha256);assert.equal(r.qualification.production_qualified,false);
 assert.equal(f.calls[0],RUN_OWNER_CONTROL_SQL);assert.ok(f.calls.every(q=>q.startsWith('select')));f.reader.close();await assert.rejects(f.read());
});
const changes={
 reservation:f=>f.row.execution.reservation_id=f.scope.activation_id,
 project:f=>f.row.activation_receipt.project_id=f.scope.root_task_id,
 host:f=>f.intents['native-coding-pending-owner-intent-v1.json'].binding.host_pid++,
 device:f=>f.intents['native-coding-pending-activation-intent-v1.json'].binding.device_id=f.scope.root_task_id,
 postgres:f=>f.row.observation={...f.row.observation,postgres:{system_identifier:'foreign'}},
 seal:f=>f.intents['native-coding-pending-activation-intent-v1.json'].sealed_owner_sha256='0'.repeat(64),
 revoked:f=>f.state.grant=false,
 stop:f=>f.state.control.refill_enabled=false,
 reset:f=>f.state.control.generation_floor++,
 updated:f=>f.state.control.updated_at=new Date(Date.now()+1000).toISOString(),
 environment:f=>f.state.environment=false,
 expiredEvidence:f=>f.evidence.observed_at='2020-01-01T00:00:00.000Z',
 refreshedSeal:f=>f.evidence.sealed_record.observed_at=new Date().toISOString(),
};
for(const [name,change] of Object.entries(changes))test('reader rejects '+name+' before releasing custody',async()=>{
 const f=fixture();f.state.hook=()=>change(f);await assert.rejects(f.read());f.reader.close();
});
test('two concurrent read invocations retain independent scope/intents',async()=>{
 const a=fixture(),b=fixture();b.state.hook=()=>{b.state.grant=false;};const result=await Promise.allSettled([a.read(),b.read()]);
 assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');a.reader.close();b.reader.close();
});
test('transaction loss during original phase closes it and never accepts late native evidence',async()=>{
 const f=fixture(),abort=new AbortController();f.tx.signal=abort.signal;let closed=false;
 f.request.runOwnerPhases.close=()=>{closed=true;};f.tx.assertOpen=()=>{if(abort.signal.aborted)throw Error('transaction ended');};
 f.state.hook=()=>abort.abort();await assert.rejects(f.read());assert.equal(closed,true);
});
