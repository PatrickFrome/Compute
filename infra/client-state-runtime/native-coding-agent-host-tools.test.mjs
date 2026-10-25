import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {checkpointFixture} from './test/native-coding-checkpoint-fixture.mjs';
import {createNativeCodingAgentHostTools,validateNativeCodingAgentHostRequest} from './native-coding-agent-host-tools.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';

// Generated cryptographic, PG and OS values exercise the private Host boundary.
// They are not readback from installed METAENGINE or evidence of useful work.
function fixture(){
  const f=checkpointFixture(),w=f.writer,p=w.permit,j=w.registration.job_envelope;
  w.task.state='RUNNING';w.execution.state='ATTEMPTED';w.registration.result_receipt=null;
  const native={artifact:p.artifact,postgres:p.postgres,worktree:p.worktree,host_process:j.payload.host_process,user_sid:p.user_sid};
  const worker={...j.payload.worker_process,user_sid:p.user_sid,job_id:j.payload.job_id,run_id:j.payload.run_id,prompt_sha256:j.payload.prompt_sha256};
  const binding={run_id:j.payload.run_id,workspace_id:p.workspace_id,project_id:p.project_id,task_id:w.task.task_id,
    lease_generation:1,agent_id:p.agent_id,agent_generation_epoch:1,provider_id:p.provider_id,role:p.role};
  const job_binding={job_id:j.payload.job_id,pid:worker.pid,process_incarnation_id:worker.process_incarnation_id,executable_sha256:p.artifact.cli_executable_sha256};
  const context={run_id:binding.run_id,project_id:p.project_id,permit:p,task:w.task};
  const queries=[],staged=[];let committed=0,hook=null,role='state_owner',nativeReads=0,workerReads=0;
  const sql={async unsafe(q,a){
    queries.push({q,a});
    if(q.includes('current_user'))return [{current_user:role,session_user:role}];
    if(q.startsWith('set local'))return [];
    if(q.includes('native_coding_agent_context_v1'))return [{value:structuredClone(context)}];
    if(q.includes('from destruktion_meta.native_coding_job_registration'))return [{...structuredClone(w.registration),permit:structuredClone(p),execution:structuredClone(w.execution)}];
    if(q.includes('native_coding_agent_message_v1')){staged.push(a);await hook?.();return [{value:{stored:true,authority_effect:false}}];}
    if(q.includes('native_coding_agent_intent_read_v1'))return [{value:{schema:'metaengine.native-coding.agent-intent.v1',run_id:a[0],request_id:a[1],readback_only:true,physical_effect_replayed:false,found:false,authority_effect:false}}];
    if(q.includes('native_coding_agent_overview_v1')||q.includes('native_coding_agent_history_v1'))return [{value:{project_id:p.project_id,rows:[],authority_effect:false}}];
    throw Error('unexpected_fixture_query');
  },async begin(mode,cb){assert.equal(mode,'isolation level serializable');const n=staged.length;try{const result=await cb(sql);committed+=staged.length-n;return result;}catch(error){staged.length=n;throw error;}}};
  const tools=createNativeCodingAgentHostTools({sql,readNativeScope:async(permit,includeSandbox)=>{
    assert.equal(includeSandbox,false);assert.deepEqual(permit,p);nativeReads++;return structuredClone(native);},
    readNativeWorker:async()=>{workerReads++;return structuredClone(worker);}});
  const request=(operation='CHECK',args={})=>({binding:structuredClone(binding),job_binding:structuredClone(job_binding),operation,args});
  return {f,w,p,j,native,worker,context,queries,tools,request,setHook:x=>hook=x,setRole:x=>role=x,
    get committed(){return committed;},get nativeReads(){return nativeReads;},get workerReads(){return workerReads;}};
}
test('current protected canonical job, exact ledger scope and independent native reads qualify every tool',async()=>{
  const x=fixture();assert.equal((await x.tools.invoke(x.request())).authorized,true);
  await x.tools.invoke(x.request('project_overview',{after_seq:2,limit:4}));
  await x.tools.invoke(x.request('project_history_page',{after_seq:0,limit:16,through_seq:5}));
  await x.tools.invoke(x.request('agent_send_message',{request_id:randomUUID(),target_agent_id:'agent_native-peer123',message:'Full message'}));
  assert.equal(x.nativeReads,4);assert.equal(x.workerReads,4);assert.equal(x.committed,1);
  assert(x.queries.some(row=>row.q==='set local synchronous_commit=on'));
  assert(x.queries.some(row=>row.q.includes('native_coding_agent_history_v1($1::uuid,$2::bigint,$3::bigint,$4::integer)')));
});
for(const [name,mutate]of [
  ['project binding',x=>x.context.project_id=randomUUID()],
  ['canonical job bytes',x=>x.w.registration.canonical_job_envelope+=' '],
  ['ledger scope',x=>x.w.execution.scope_sha256='0'.repeat(64)],
  ['ledger state',x=>x.w.execution.state='RESULT_READY'],
  ['current PG birth',x=>x.native.postgres=structuredClone({...x.native.postgres,system_identifier:'different'})],
  ['physical Git HEAD',x=>x.native.worktree=structuredClone({...x.native.worktree,base_sha:'0'.repeat(40)})],
  ['current Host kernel birth',x=>x.native.host_process={...x.native.host_process,process_incarnation_id:'pid:9000:created_100ns:134000000000000000'}],
  ['worker prompt',x=>x.worker.prompt_sha256='0'.repeat(64)],
  ['worker PID birth',x=>x.worker.process_incarnation_id='pid:9001:created_100ns:134000000000000000'],
  ['worker SID',x=>x.worker.user_sid='S-1-5-21-999-1001'],
  ['session role',x=>x.setRole('service_role')],
])test(`${name} drift prevents tool execution before effects`,async()=>{
  const x=fixture();mutate(x);await assert.rejects(x.tools.invoke(x.request('agent_send_message',{
    request_id:randomUUID(),target_agent_id:'agent_native-peer123',message:'Never send'})));
  assert.equal(x.committed,0);assert.equal(x.queries.some(row=>row.q.includes('native_coding_agent_message_v1')),false);
});
test('same native birth with seven fractional Windows digits is accepted without weakening kernel identity',async()=>{
  const x=fixture();x.native.host_process={...x.native.host_process,created_at:x.native.host_process.created_at.replace('Z','0000Z')};
  x.worker.created_at=x.worker.created_at.replace('Z','0000Z');
  assert.equal((await x.tools.invoke(x.request())).authorized,true);
});
test('Host closure rolls back a write still waiting on its SQL receipt',async()=>{
  const x=fixture();x.setHook(()=>x.tools.close());
  await assert.rejects(x.tools.invoke(x.request('agent_send_message',{request_id:randomUUID(),target_agent_id:'agent_native-peer123',message:'Rollback'})),/closed/);
  assert.equal(x.committed,0);await assert.rejects(x.tools.invoke(x.request()),/closed/);
});
test('private historical intent readback cannot grant CHECK or another tool and uses no stale worker lookup',async()=>{
  const x=fixture();x.w.execution.state='RESULT_READY';
  const result=await x.tools.invoke(x.request('READ_INTENT',{request_id:randomUUID()}));
  assert.equal(result.readback_only,true);assert.equal(x.nativeReads,0);assert.equal(x.workerReads,0);
  await assert.rejects(x.tools.invoke(x.request()),/execution_changed/);
});
test('strict request schema rejects arrays, invalid UUID/PID mismatch, identities and critic child creation',()=>{
  const x=fixture();
  for(const change of [r=>r.args=[],r=>r.job_binding.job_id='-'.repeat(36),r=>r.job_binding.pid++,r=>r.binding.project_id='bad',
    r=>r.args={run_id:randomUUID()},r=>r.extra=true]){
    const r=x.request();change(r);assert.throws(()=>validateNativeCodingAgentHostRequest(r));
  }
  const r=x.request('project_propose_children',{request_id:randomUUID(),children:[{role:'IMPLEMENTER',objective:'child'}]});
  r.binding.role='CRITIC';assert.throws(()=>validateNativeCodingAgentHostRequest(r),/critic_spawn_denied/);
  assert.throws(()=>validateNativeCodingAgentHostRequest(x.request('client_control_intent',{request_id:randomUUID(),action:'CLIENT_STATUS'})),/operation_unbound/);
});
