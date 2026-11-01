import {randomUUID} from 'node:crypto';
import {nativeCodingCanonicalSha256 as sha} from '../../native-coding-task-context.mjs';
import {nativeCodingHostSettlement} from '../../../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
import {codexCliLocalOutputDrain} from '../../../../apps/metaengine-browser/src/codex-cli-physical-settlement.mjs';
import {joinedSettlementFixture} from '../../../../apps/metaengine-browser/test/fixtures/codex-cli-joined-settlement-fixture.mjs';

// Generated contract data only. No Windows process, ACL, directory durability,
// helper execution or installation qualification is supplied by this test.
const hash=letter=>letter.repeat(64),clone=value=>structuredClone(value);
function chain(f){
 let head='0'.repeat(64);
 f.journal.records.forEach((record,sequence)=>{record.sequence=sequence;record.previous_sha256=head;head=sha(record);});
 f.journal.projection.records=f.journal.records.length;f.journal.projection.head_sha256=head;
 return f;
}
function copyClosure(f){
 Object.assign(f.closure,{publication:clone(f.publication),receipt:clone(f.receipt),journal:clone(f.journal)});
 return f;
}
export function nativePhysicalTaskFixture({outcome='OK',unsent=false,postgres=null,host:hostInput=null,mainBirth=null}={}){
 const runId=randomUUID(),workspace=randomUUID(),project=randomUUID(),provider=randomUUID(),permitId=randomUUID();
 const instance=hostInput?.instance_id||randomUUID(),main=mainBirth||'pid:9000:created_100ns:133333333333333330';
 const createdAt=birth=>new Date(Number((BigInt(birth.split(':')[3])-116444736000000000n)/10000n)).toISOString();
 const scope={workspace_id:workspace,task_id:randomUUID(),lease_generation:2,agent_id:'agent_fixture-12345678',
  target_id:'codex-cli:'+provider,agent_generation_epoch:3,host_incarnation:main,scope_sha256:hash('a'),reservation_id:randomUUID()};
 const lease={task_id:scope.task_id,agent_id:scope.agent_id,base_sha:'e'.repeat(40),lease_generation:2,agent_generation_epoch:3,role:'IMPLEMENTER'};
 const agentBinding={run_id:runId,workspace_id:workspace,project_id:project,task_id:scope.task_id,lease_generation:2,
  agent_id:scope.agent_id,agent_generation_epoch:3,provider_id:provider,role:'IMPLEMENTER'};
 const g=joinedSettlementFixture({runId,binding:lease,promptSha256:hash('f'),expectedExecutableSha256:hash('9')});
 const processResult=g.complete(),host={pid:7000,created_at:createdAt('pid:7000:created_100ns:133333333333333331'),
  process_incarnation_id:'pid:7000:created_100ns:133333333333333331',instance_id:instance,...hostInput};
 const pg={system_identifier:'1234567890123456789',started_at:'2026-11-01T01:00:00.123456Z',pid:999,
  process_incarnation_id:'pid:999:created_100ns:134063460001234560',data_directory_identity_sha256:hash('8'),...postgres};
 const frame=(action,payload)=>({schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:instance,host_pid:host.pid,
  request_id:randomUUID(),action,payload});
 const request=wire=>{
  const q={schema:'metaengine.native-coding.physical-request.v1',frame:wire,request_sha256:sha(wire),host:clone(host),
   main_birth:main,postgres:clone(pg)};
  return {request:q,terminal:nativeCodingHostSettlement({instance_id:instance,host_pid:host.pid,request_id:wire.request_id,
   action:wire.action,request_sha256:q.request_sha256})};
 };
 const originalScope=clone(scope);delete originalScope.reservation_id;
 const reserve=request(frame('RESERVE_EXECUTION',{scope:originalScope}));
 const jobBinding={job_id:runId,pid:g.proof.pid,process_incarnation_id:g.proof.process_incarnation_id,executable_sha256:g.proof.executable_sha256};
 const callback=request(frame('AGENT_OPERATION',{binding:agentBinding,job_binding:jobBinding,operation:'CHECK',args:{}}));
 const job={algorithm:'ES256',issuer_key_fingerprint_sha256:hash('5'),signature:'A'.repeat(86),payload:{
  schema:'metaengine.codex-cli.job-proof.v1',...agentBinding,permit_id:permitId,device_id:randomUUID(),owner_epoch:4,
  user_sid:g.proof.user_sid,device_key_fingerprint_sha256:hash('5'),
  host_process:{pid:Number(main.split(':')[1]),created_at:createdAt(main),process_incarnation_id:main},prompt_sha256:hash('f'),
  worktree:{path:'/fixture/worktree',base_sha:lease.base_sha},job_id:runId,
  worker_process:{pid:g.proof.pid,created_at:g.proof.started_at,process_incarnation_id:g.proof.process_incarnation_id},
  artifact:{cli_executable_sha256:g.proof.executable_sha256}}};
 const permit={permit_id:permitId,workspace_id:workspace,project_id:project,provider_id:provider,agent_id:scope.agent_id,
  agent_generation_epoch:scope.agent_generation_epoch,role:lease.role,device_id:job.payload.device_id,owner_epoch:4,
  artifact:clone(job.payload.artifact),worktree:clone(job.payload.worktree),user_sid:g.proof.user_sid,device_key_fingerprint_sha256:hash('5')};
 const receipt={schema:'metaengine.codex-cli.run-receipt.v1',state:'RESULT_READY',provider:'CODEX_CLI',trust_namespace:'LOCAL_OPERATOR_QA',
  ...lease,run_id:runId,workspace_id:workspace,project_id:project,permit_id:permitId,owner_epoch:4,user_sid:g.proof.user_sid,
  executable_sha256:g.proof.executable_sha256,worktree_path:'/fixture/worktree',prompt_sha256:hash('f'),
  pid:g.proof.pid,process_incarnation_id:g.proof.process_incarnation_id,job_id:runId,launch_identity:g.proof.launch,
  process:clone(g.proof),process_result:processResult,physical_settlement:clone(processResult.joined_settlement),
  automatic_retry_allowed:false,authority_effect:false};
 receipt.local_output_drain=codexCliLocalOutputDrain(receipt.physical_settlement);
 const selected={request_id:callback.request.frame.request_id,request_sha256:callback.request.request_sha256};
 const events=[{kind:'HEADER',run_id:runId,lease_binding_sha256:sha(lease)},
  {kind:'BOUND',binding_sha256:sha(agentBinding),instance_id:instance,host_pid:host.pid},
  {kind:'INTENT',...selected,operation:'CHECK',job_binding_sha256:sha(jobBinding)},
  {kind:'CALLER',...selected,outcome},
  unsent?{kind:'UNSENT',...selected}:{kind:'TERMINAL',...selected,state:'SETTLED',terminal_sha256:sha(callback.terminal)},
  {kind:'FENCE'},{kind:'CALLBACKS_JOINED',callbacks:1},
  {kind:'CANDIDATE',state:'SCOPED_REQUESTS_JOINED',lineage:'LINEAGE_UNBOUND',all_effects_cleanup:'UNCONFIRMED',authority_effect:false}];
 const journal={records:events.map(event=>({schema:'metaengine.native-coding.run-callback-record.v1',event})),projection:{
  schema:'metaengine.native-coding.run-callback-journal.v1',durability_scope:'PROCESS_CRASH_ONLY',directory_durability:'DIRECTORY_DURABILITY_UNQUALIFIED',
  chain_root:'CHAIN_ROOT_UNANCHORED',state:'SCOPED_REQUESTS_JOINED',lineage:'LINEAGE_UNBOUND',all_effects_cleanup:'UNCONFIRMED',
  requests:1,caller_unknown:Number(outcome==='UNKNOWN'),unsent:Number(unsent),active:0,callbacks:1,dispatch_fenced:true,callbacks_joined:true,
  authority_effect:false,automatic_retry_allowed:false}};
 const root={run_id:runId,scope,permit_id:permitId,permit_sha256:sha(permit),device_id:job.payload.device_id,client_id:'fixture-client',
  admin_grant_epoch:1,key_sha256:hash('5'),owner_epoch:4,owner_sha256:hash('4'),host_instance_id:instance,host_pid:host.pid,
  host_birth:host.process_incarnation_id,main_birth:main,pg_identity:pg,prefix_identity_sha256:hash('3'),attempt_sha256:hash('2'),
  header_sha256:sha(events[0]),bound_sha256:null,lease_binding_sha256:sha(lease),reserve_request_id:reserve.request.frame.request_id,
  prompt_sha256:hash('f'),base_sha:lease.base_sha,role:'IMPLEMENTER'};
 const publication={schema:'metaengine.native-coding.callback-publication.v1',root,
  cursor:{revision:1,record_count:3,intent_count:1,head_sha256:null,dispatch_fenced:false},job_sha256:sha(job)};
 const f={publication,job,permit,receipt,journal,requests:unsent?[]:[callback],reserve,
  closure:{schema:'metaengine.native-coding.physical-task-closure.v1',reserve_request_sha256:reserve.request.request_sha256,
   automatic_retry_allowed:false,authority_effect:false}};
 chain(f);root.bound_sha256=sha(journal.records[1]);publication.cursor.head_sha256=sha(journal.records[2]);
 journal.prefix_identity_sha256=root.prefix_identity_sha256;journal.attempt_sha256=root.attempt_sha256;
 return copyClosure(f);
}
