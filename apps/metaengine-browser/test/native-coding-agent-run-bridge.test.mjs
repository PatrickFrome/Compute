import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {admissionFixture} from './fixtures/native-coding-admission-fixture.mjs';
import {agentBridgePins} from './fixtures/native-coding-agent-bridge-pins.mjs';
import {prepareNativeCodingAgentRunBridge} from '../src/native-coding-agent-run-bridge.mjs';
import {connectNativeCodingAgentMcpBroker} from '../src/native-coding-agent-mcp-broker.mjs';
import {NATIVE_AGENT_MCP_ENV} from '../src/native-coding-agent-mcp-entry.mjs';

// The production per-run composition selects a Windows named pipe by default.
// Portable Unix-socket transport coverage lives in the low-level broker tests.
const namedPipeOnly={skip:process.platform!=='win32'?'Production per-run composition requires a Windows named pipe':false};
async function fixture(t,{role='IMPLEMENTER',unknown=false,prepare=true}={}){
  const f=admissionFixture(),permit=f.permit;permit.role=role;
  const runId=randomUUID(),binding={...f.binding,base_sha:permit.worktree.base_sha,role},calls=[];
  const authorization={...binding,authorized:true,trust_namespace:'LOCAL_OPERATOR_QA',permit_id:permit.permit_id,owner_epoch:permit.owner_epoch,workspace_id:permit.workspace_id,
    project_id:permit.project_id,user_sid:permit.user_sid,worktree_path:permit.worktree.path};
  let current=true,stored=null,writes=0;
  const ownPostgres={async agentOperation(value){
    calls.push(structuredClone(value));if(!current&&value.operation!=='READ_INTENT')throw Error('fixture_lease_revoked');
    if(value.operation==='CHECK')return {schema:'metaengine.native-coding.agent-authorized.v1',run_id:runId,authorized:true,authority_effect:false};
    if(value.operation==='READ_INTENT')return stored;
    if(value.operation==='agent_send_message'){writes++;if(unknown)throw Error('fixture_ack_unknown');return {stored:true,authority_effect:false};}
    return {project_id:permit.project_id,rows:[],authority_effect:false};
  }};
  const pins=await agentBridgePins(t),deadlineAt=new Date(Date.now()+60000).toISOString();
  if(!prepare)return {f,permit,runId,binding,authorization,calls,pins,ownPostgres,deadlineAt};
  const bridge=await prepareNativeCodingAgentRunBridge({ownPostgres,runId,binding,permit,authorization,deadlineAt,pins});t.after(()=>bridge.close());
  const environment=bridge.launch.createEnvironment({TEMP:'private-temp',CODEX_HOME:'preserved-auth'});
  const registration={endpoint:environment[NATIVE_AGENT_MCP_ENV.endpoint],capability:environment[NATIVE_AGENT_MCP_ENV.capability]};
  const proof={...f.jobPayload.worker_process,user_sid:permit.user_sid,job_id:randomUUID(),
    executable_sha256:permit.artifact.cli_executable_sha256,tree_control_bound:true,started_suspended:true,job_bound_before_resume:true};
  const connect=async()=>{const client=await connectNativeCodingAgentMcpBroker(registration);t.after(()=>client.close());return client;};
  return {f,permit,runId,binding,authorization,calls,pins,bridge,proof,registration,environment,ownPostgres,deadlineAt,connect,
    revoke:()=>{current=false;},setStored:value=>{stored=value;},get writes(){return writes;}};
}
test('per-run production composition is unusable until Host confirms the actual suspended job, checks every cached call, and revokes',namedPipeOnly,async t=>{
  const x=await fixture(t);await assert.rejects(x.connect(),/authentication_failed/);assert.equal(x.calls.length,0);
  await x.bridge.bindRun(x.proof);const client=await x.connect();
  await client.invoke('project_overview',{});
  const args={request_id:randomUUID(),target_agent_id:'agent_native-peer123',message:'Durable full message'};
  await client.invoke('agent_send_message',args);await client.invoke('agent_send_message',args);
  assert.equal(x.writes,1);assert.equal(x.calls.filter(row=>row.operation==='CHECK').length,4);
  assert.ok(x.calls.every(row=>row.binding.run_id===x.runId&&row.job_binding.job_id===x.proof.job_id));
  assert.equal(x.environment.TEMP,'private-temp');assert.equal(x.environment.CODEX_HOME,'preserved-auth');
  assert.equal(x.bridge.launch.argv.some(arg=>arg.includes(x.registration.capability)),false);
  assert.equal(JSON.stringify(x.bridge).includes(x.registration.capability),false);
  x.revoke();await assert.rejects(client.invoke('project_overview',{}));
  await x.bridge.close();await assert.rejects(x.connect(),/connect|authentication|channel|closed/i);
});
test('a hostile job proof or Host refusal cannot bind the token; critic cannot create children or request PC control',namedPipeOnly,async t=>{
  const x=await fixture(t,{role:'CRITIC'});
  await assert.rejects(x.bridge.bindRun({...x.proof,pid:x.proof.pid+1}));assert.equal(x.calls.length,0);
  x.revoke();await assert.rejects(x.bridge.bindRun(x.proof));await assert.rejects(x.connect(),/authentication_failed/);
  const y=await fixture(t,{role:'CRITIC'});await y.bridge.bindRun(y.proof);const client=await y.connect();
  assert.deepEqual(y.bridge.launch.metadata.allowed_tools,['project_overview','project_history_page','agent_send_message']);
  await assert.rejects(client.invoke('project_propose_children',{request_id:randomUUID(),children:[{role:'IMPLEMENTER',objective:'No'}]}),/tool_denied/);
  await assert.rejects(client.invoke('client_control_intent',{request_id:randomUUID(),action:'CLIENT_STATUS'}),/tool_denied/);
});
test('unknown write with another UUID remains fenced until exact private saved SQL body and receipt readback',namedPipeOnly,async t=>{
  const x=await fixture(t,{unknown:true});await x.bridge.bindRun(x.proof);const client=await x.connect();
  const args={request_id:randomUUID(),target_agent_id:'agent_native-peer123',message:'Do once'};
  await assert.rejects(client.invoke('agent_send_message',args));
  await assert.rejects(client.invoke('agent_send_message',{...args,request_id:randomUUID()}));assert.equal(x.writes,1);
  const body={target_agent_id:args.target_agent_id,message:args.message},text=JSON.stringify(body);
  const saved={schema:'metaengine.native-coding.agent-intent.v1',found:true,run_id:x.runId,request_id:args.request_id,original_request_id:args.request_id,
    operation:'MESSAGE',body,canonical_body_text:text,body_sha256:createHash('sha256').update(text).digest('hex'),
    receipt:{stored:true,authority_effect:false},readback_only:true,physical_effect_replayed:false,authority_effect:false};
  x.setStored({...saved,body_sha256:'0'.repeat(64)});await assert.rejects(x.bridge.reconcileIntent(args.request_id));
  x.setStored(saved);assert.equal((await x.bridge.reconcileIntent(args.request_id)).state,'CONFIRMED');
  assert.equal((await client.invoke('agent_send_message',args)).stored,true);assert.equal(x.writes,1);
});
test('changed protected permit/role/task cannot prepare a private bridge',async t=>{
  // Do not compose a platform transport before testing portable admission.
  const x=await fixture(t,{prepare:false});
  for(const overrides of [{permit:{...x.permit,revoked:true}},{binding:{...x.binding,agent_id:'agent_other-worker1'}},
    {authorization:{...x.authorization,project_id:randomUUID()}},{binding:{...x.binding,task_id:randomUUID()}},
    {authorization:{...x.authorization,authorized:false}},{deadlineAt:new Date(Date.now()-1).toISOString()}])
    await assert.rejects(prepareNativeCodingAgentRunBridge({ownPostgres:x.ownPostgres,runId:randomUUID(),binding:x.binding,permit:x.permit,
      authorization:x.authorization,deadlineAt:x.deadlineAt,pins:x.pins,...overrides}),
      {message:'native_coding_agent_run_bridge_denied'});
  assert.equal(x.calls.length,0);
});
test('non-Windows production composition refuses without a caller-selected Unix transport or Host effects',{
  skip:process.platform==='win32'?'Non-Windows refusal contract':false,
},async t=>{
  const x=await fixture(t,{prepare:false});
  await assert.rejects(prepareNativeCodingAgentRunBridge(x),{message:'native_agent_bridge_composition'});
  assert.equal(x.calls.length,0);
});
