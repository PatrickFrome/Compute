import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createNativeCodingHostIpcClient } from '../src/native-coding-host-ipc-client.mjs';

const serverUrl=new URL('../../../infra/client-state-runtime/native-coding-host-ipc.mjs',import.meta.url).href;
const id=()=>randomUUID();
const scope=()=>({workspace_id:id(),task_id:id(),lease_generation:1,agent_id:'agent_native-test-1234',
  target_id:`codex-cli:${id()}`,agent_generation_epoch:1,host_incarnation:'pid:1234:created_100ns:134371917225776174',scope_sha256:'a'.repeat(64)});
const lease=()=>({workspace_id:id(),project_id:id(),task_id:id(),agent_id:'agent_native-test-1234',lease_generation:1,provider_id:id()});
const envelope=schema=>({algorithm:'ES256',issuer_key_fingerprint_sha256:'a'.repeat(64),payload:{schema},signature:'A'.repeat(86)});
const transition=(from,to)=>({from,to,evidence_sha256:'b'.repeat(64),critic_proof_sha256:null,checkpoint_sha256:null});
const agentRequest=(operation='CHECK')=>({operation,args:operation==='agent_send_message'?{request_id:id(),target_agent_id:'agent_native-peer123',message:'One message'}:{},
  binding:{run_id:id(),workspace_id:id(),project_id:id(),task_id:id(),lease_generation:1,agent_id:'agent_native-test-1234',agent_generation_epoch:1,provider_id:id(),role:'IMPLEMENTER'},
  job_binding:{job_id:id(),pid:1234,process_incarnation_id:'pid:1234:created_100ns:134371917225776174',executable_sha256:'a'.repeat(64)}});

async function setup(t,mode='normal',{timeoutMs=1000,maxInflight=16,serverMaxInflight=16,serverTimeoutMs=1000}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-private-ipc-'));
  const script=path.join(root,'child.mjs'),instanceId=id();
  await fs.writeFile(script,`
import {createNativeCodingHostIpcServer} from ${JSON.stringify(serverUrl)};
const mode=process.env.METAENGINE_IPC_TEST_MODE;let calls=0,protocolErrors=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const operations={
 READ_SCOPE:async (value,context)=>{const n=++calls;if(mode==='request-context')return {bindings:[],has_signal:context.signal instanceof AbortSignal,aborted:context.signal.aborted,deadline_at:context.deadlineAt,remaining_ms:context.deadlineAt-Date.now()};if(mode==='delayed-read')await delay(80);
  if(mode==='paged-scope'){
   const all=Array.from({length:160},(_,i)=>({permit_id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),permit:{padding:'x'.repeat(3000)}}));
   const rows=all.filter(r=>!value.after_permit_id||r.permit_id>value.after_permit_id),page=rows.slice(0,32);
   return {schema:'metaengine.native-coding.own-pg-scope.v1',source:'PRIVATE_RUNTIME_HOST_OWN_PG',postgres:{system_identifier:'1'},
    bindings:page,has_more:rows.length>32,next_after_permit_id:rows.length>32?page.at(-1).permit_id:null};
  }
  return {call_count:n,bindings:[]};},
 READ_LEASE:async value=>{++calls;if(mode==='out-of-order')await delay(value.lease_generation===1?80:5);return value;},
 REGISTER_PROVIDER:async value=>{++calls;if(mode==='throw-write')throw Error('postgresql://must-never-leak/private; raw SQL failure');return {registered:true,schema:value.descriptor.payload.schema};},
 READ_EXECUTION:async value=>({state:'RESERVED',scope:value.scope}),
 RESERVE_EXECUTION:async value=>{++calls;if(mode==='exit-write')process.exit(19);if(mode==='terminal-write'){process.send({schema:'compute.runtime-host-terminal.v1',invalid_payload:true});await delay(25);}if(mode==='slow-write')await delay(180);return {state:'RESERVED',scope:value.scope};},
 ADVANCE_EXECUTION:async value=>{++calls;return {state:value.transition.to,has_job_proof:!!value.transition.job_proof,has_result_receipt:!!value.transition.result_receipt};},
 RECONCILE_PROJECT:async value=>{++calls;if(mode==='throw-write')throw Error('checkpoint_unknown');return {project_id:value.project_id,state:'CHECKPOINTED_PENDING_COMMIT'};},
 READ_PROJECT_REJECTION:async value=>({schema:'metaengine.native-coding.project-rejection-readback.v1',state:'VERIFIED_REJECTION',...value,repair_authorized:false,checkpoint_created:false,authority_effect:false}),
 READ_PROJECT_CHECKPOINT:async value=>({project_id:value.project_id,state:'CHECKPOINTED_PENDING_COMMIT'}),
 AGENT_OPERATION:async value=>{++calls;if(mode==='slow-agent')await delay(180);return {operation:value.operation,run_id:value.binding.run_id};},
 FINISH_CHECKPOINT:async value=>{++calls;return {...value,state:'COMMITTED_NO_SUCCESSOR'};},
 READ_FINISH_CHECKPOINT:async value=>({...value,state:'PENDING_COMMIT'}),
 close:()=>{},
};
if(['reconciliation-mounted','slow-reconciliation','held-reconciliation','exit-reconciliation'].includes(mode))operations.RECONCILE_FINISH_CHECKPOINT=async value=>{
 ++calls;if(mode==='exit-reconciliation')process.exit(19);if(mode==='slow-reconciliation')await delay(180);
 if(mode==='held-reconciliation')await new Promise(resolve=>{
  const release=message=>{if(message?.schema==='test.native-coding.release-reconciliation'){process.off('message',release);resolve();}};
  process.on('message',release);process.send({schema:'test.native-coding.reconciliation-started'});
 });
 return {...value,state:'COMMITTED_NO_SUCCESSOR',automatic_retry_allowed:false};
};
if(mode==='seed-mounted'||mode==='slow-seed'||mode==='secret-preparation')for(const action of ['ADMIT_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1','PREPARE_WORKSPACE_V1','READ_WORKSPACE_PREPARATION_V1','SEED_GOAL','READ_SEED','LIST_SEEDS'])operations[action]=async request=>{
 if(action==='SEED_GOAL'||action==='PREPARE_WORKSPACE_V1'||action==='ADMIT_PREPARED_GOAL_V1'){calls++;if(mode==='slow-seed')await delay(180);}
 if(mode==='secret-preparation')throw Object.assign(Error('SENTINEL_PRIVATE_QUERY_PARAMETER'),{query:'SENTINEL_PRIVATE_QUERY_PARAMETER',parameters:['SENTINEL_PRIVATE_QUERY_PARAMETER'],args:['SENTINEL_PRIVATE_QUERY_PARAMETER']});
 return {fixture_transport_only:true,operation:action,input:request.body.input};
};
if(mode==='owner-mounted'||mode==='owner-timeout'||mode==='owner-lost-release')for(const action of ['ESTABLISH_PENDING_OWNER_V1','READ_PENDING_OWNER_V1'])operations[action]=async(request,context)=>{
 const scope={device_id:request.headers['x-a2-device-id'],client_id:request.headers['x-a2-chat-bridge-client'],key_fingerprint_sha256:'c'.repeat(64),
  admin_grant_epoch:1,project_id:request.body.input.request_id,observed_at:new Date().toISOString()};
 const released=await context.pendingOwnerPhases.run(scope,{readScope:async()=>({...scope,observed_at:new Date().toISOString()}),prepareTransition:async()=>{calls++;},verifyTransition:async()=>{}});
 if(mode==='owner-lost-release'&&action==='ESTABLISH_PENDING_OWNER_V1')await delay(180);return released;
};
if(mode==='prior-readback'||mode==='slow-prior')operations.READ_PRIOR_EXECUTION=async ({selector})=>{
 ++calls;if(mode==='slow-prior')await delay(180);
 return {fixture_transport_only:true,state:'HOLD',selector,physical_effect_replayed:false,automatic_retry_allowed:false,authority_effect:false};
};
const send=(frame,callback)=>{
 const copy=structuredClone(frame);
 if(mode==='wrong-action')copy.action='READ_LEASE';
 if(mode==='wrong-digest')copy.request_sha256='0'.repeat(64);
 if(mode==='wrong-instance')copy.instance_id='00000000-0000-4000-8000-000000000000';
 if(mode==='wrong-pid')copy.host_pid=process.pid+1;
 process.send(copy,callback);
};
const server=createNativeCodingHostIpcServer({instanceId:process.env.METAENGINE_IPC_TEST_INSTANCE,operations,send,
 maxInflight:Number(process.env.METAENGINE_IPC_TEST_SERVER_MAX),timeoutMs:Number(process.env.METAENGINE_IPC_TEST_SERVER_TIMEOUT),
 onProtocolError:reason=>protocolErrors.push(reason)});
process.on('message',(message,handle)=>{
 if(message?.schema==='test.native-coding.release-reconciliation')return;
 if(message?.schema==='test.native-coding.stats'){process.send({schema:'test.native-coding.stats',calls,protocolErrors,snapshot:server.snapshot()});return;}
 if(message?.schema==='test.native-coding.handle'){server.handleMessage(message.frame,{});return;}
 server.handleMessage(message,handle);
});
process.on('disconnect',()=>process.exit(0));
process.send({schema:'test.native-coding.ready'});
`);
  const child=fork(script,[],{execPath:process.execPath,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,
    METAENGINE_IPC_TEST_MODE:mode,METAENGINE_IPC_TEST_INSTANCE:instanceId,METAENGINE_IPC_TEST_SERVER_MAX:String(serverMaxInflight),
    METAENGINE_IPC_TEST_SERVER_TIMEOUT:String(serverTimeoutMs)}});
  let client;
  t.after(async()=>{
    client?.close();
    if(child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
    const actual=await fs.realpath(root),parent=await fs.realpath(os.tmpdir());
    assert.ok(actual.startsWith(parent+path.sep)&&path.basename(actual).startsWith('metaengine-private-ipc-'));
    await fs.rm(actual,{recursive:true,force:true});
  });
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('test_child_startup_timeout')),5000);
    const listener=message=>{if(message?.schema==='test.native-coding.ready'){clearTimeout(timer);child.off('message',listener);resolve();}};
    child.on('message',listener);child.once('error',()=>{clearTimeout(timer);reject(Error('test_child_startup_failed'));});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('test_child_exited_before_ready'));});
  });
  client=createNativeCodingHostIpcClient({child,instanceId,hostPid:child.pid,timeoutMs,maxInflight});
  const stats=()=>new Promise(resolve=>{const listener=message=>{if(message?.schema==='test.native-coding.stats'){child.off('message',listener);resolve(message);}};
    child.on('message',listener);child.send({schema:'test.native-coding.stats'});});
  return {child,client,instanceId,stats};
}

test('paged private scope crosses the per-message byte budget without truncating a 160-agent roster',async t=>{
 const {client,stats}=await setup(t,'paged-scope');
 const scope=await client.readScope();assert.equal(scope.bindings.length,160);
 assert.equal((await stats()).calls,5);assert.equal(scope.has_more,false);
 assert(Buffer.byteLength(JSON.stringify(scope))>256*1024);
});

test('real private parent/child IPC supports all fixed actions including transaction evidence',async t=>{
  const {client}=await setup(t);
  assert.equal((await client.readScope()).call_count,1);
  const query=lease();assert.deepEqual(await client.readLease(query),query);
  assert.equal((await client.registerProvider(envelope('metaengine.codex-cli.transport-proof.v1'))).registered,true);
  const binding=scope();assert.equal((await client.reserveExecution(binding)).state,'RESERVED');
  assert.deepEqual((await client.readExecution(binding)).scope,binding);
  const reserved={...binding,reservation_id:id()};
  assert.deepEqual(await client.advanceExecution(reserved,{...transition('RESERVED','ATTEMPTED'),job_proof:envelope('metaengine.codex-cli.job-proof.v1')}),
    {state:'ATTEMPTED',has_job_proof:true,has_result_receipt:false});
  assert.deepEqual(await client.advanceExecution(reserved,{...transition('ATTEMPTED','RESULT_READY'),result_receipt:{schema:'metaengine.codex-cli.run-receipt.v1',state:'RESULT_READY'}}),
    {state:'RESULT_READY',has_job_proof:false,has_result_receipt:true});
  const project=id();assert.deepEqual(await client.reconcileProject(project),{project_id:project,state:'CHECKPOINTED_PENDING_COMMIT'});
  assert.deepEqual(await client.readProjectCheckpoint(project),{project_id:project,state:'CHECKPOINTED_PENDING_COMMIT'});
});

test('real private IPC accepts lifecycle close without exposing it and carries only fixed agent/commit selectors',async t=>{
  const {client,stats}=await setup(t);const request=agentRequest();
  assert.deepEqual(await client.agentOperation(request),{operation:'CHECK',run_id:request.binding.run_id});
  const selector={project_id:id(),checkpoint_sha256:'a'.repeat(64)};
  assert.equal((await client.finishCheckpoint(selector)).state,'COMMITTED_NO_SUCCESSOR');
  assert.equal((await client.readFinishCheckpoint(selector)).state,'PENDING_COMMIT');
  await assert.rejects(client.finishCheckpoint({...selector,path:'C:/caller-receipt.json'}),e=>e.reason==='INVALID_PAYLOAD');
  await assert.rejects(client.agentOperation({...request,args:[]}),e=>e.reason==='INVALID_PAYLOAD');
  assert.equal((await stats()).calls,2);
});

test('optional reconciliation crosses real IPC with exact selectors and no caller evidence',async t=>{
  const {client,stats}=await setup(t,'reconciliation-mounted');
  const selector={project_id:id(),checkpoint_sha256:'a'.repeat(64)};
  assert.deepEqual(await client.reconcileFinishCheckpoint(selector),{...selector,state:'COMMITTED_NO_SUCCESSOR',automatic_retry_allowed:false});
  for(const extra of [{path:'C:/caller.json'},{receipt:{}},{git_head:'a'.repeat(40)},{sql_intent_absent:true}]){
    await assert.rejects(client.reconcileFinishCheckpoint({...selector,...extra}),e=>e.reason==='INVALID_PAYLOAD'&&e.effect_outcome==='NONE');
  }
  await assert.rejects(client.reconcileFinishCheckpoint({...selector,checkpoint_sha256:'bad'}),e=>e.reason==='INVALID_PAYLOAD');
  assert.equal((await stats()).calls,1);
});

test('server independently rejects reconciliation paths and forged evidence before dispatch',async t=>{
  const {child,instanceId,stats}=await setup(t,'reconciliation-mounted');
  const selector={project_id:id(),checkpoint_sha256:'a'.repeat(64)};
  for(const extra of [{path:'C:/caller.json'},{receipt:{}},{git_head:'a'.repeat(40)},{sql_intent_absent:true}]){
    child.send({schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:instanceId,host_pid:child.pid,
      request_id:id(),action:'RECONCILE_FINISH_CHECKPOINT',payload:{...selector,...extra}});
  }
  const state=await stats();assert.equal(state.calls,0);
  assert.deepEqual(state.protocolErrors,Array(4).fill('INVALID_PAYLOAD'));
});

test('absent optional reconciliation gives a correlated refusal with no attempted effect',async t=>{
  const {client,stats}=await setup(t);
  await assert.rejects(client.reconcileFinishCheckpoint({project_id:id(),checkpoint_sha256:'a'.repeat(64)}),
    e=>e.reason==='UNSUPPORTED_ACTION'&&e.effect_outcome==='NONE'&&e.automatic_retry_allowed===false&&e.readback_required===false);
  assert.equal((await stats()).calls,0);assert.equal(client.snapshot().inflight,0);
  assert.equal((await client.readScope()).call_count,1);
});

test('lost reconciliation ACK stays UNKNOWN after timeout without retransmission',async t=>{
  const {client,stats}=await setup(t,'slow-reconciliation',{timeoutMs:30,serverTimeoutMs:500});
  await assert.rejects(client.reconcileFinishCheckpoint({project_id:id(),checkpoint_sha256:'a'.repeat(64)}),
    e=>e.reason==='REQUEST_TIMEOUT'&&e.effect_outcome==='UNKNOWN'&&e.readback_required===true&&e.automatic_retry_allowed===false);
  await sleep(230);assert.equal((await stats()).calls,1);assert.equal(client.snapshot().inflight,0);
});

test('closing a reconciliation channel preserves the dispatched write ambiguity',async t=>{
  const {child,client,stats}=await setup(t,'held-reconciliation');
  const started=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.off('message',listener);reject(Error('test_reconciliation_start_missing'));},1000);
    const listener=message=>{if(message?.schema==='test.native-coding.reconciliation-started'){
      clearTimeout(timer);child.off('message',listener);resolve();
    }};
    child.on('message',listener);
  });
  const pending=client.reconcileFinishCheckpoint({project_id:id(),checkpoint_sha256:'a'.repeat(64)});
  const rejected=assert.rejects(pending,e=>e.reason==='CLIENT_CLOSED'&&e.effect_outcome==='UNKNOWN'
    &&e.readback_required===true&&e.automatic_retry_allowed===false);
  await started;assert.equal((await stats()).calls,1);client.close();await rejected;
  child.send({schema:'test.native-coding.release-reconciliation'});
  await sleep(210);assert.equal((await stats()).calls,1);assert.equal(client.snapshot().inflight,0);
});

test('Host exit during reconciliation cannot become a safe retry or success',async t=>{
  const {client}=await setup(t,'exit-reconciliation');
  await assert.rejects(client.reconcileFinishCheckpoint({project_id:id(),checkpoint_sha256:'a'.repeat(64)}),
    e=>['CHILD_EXIT','CHANNEL_CLOSED'].includes(e.reason)&&e.effect_outcome==='UNKNOWN'
      &&e.readback_required===true&&e.automatic_retry_allowed===false);
  assert.equal(client.snapshot().closed,true);assert.equal(client.snapshot().inflight,0);
});

function seedRequest(operation,instanceId,hostPid){
  const body={host_instance_id:instanceId,host_pid:hostPid,operation,input:['ESTABLISH_PENDING_OWNER_V1','READ_PENDING_OWNER_V1','ADMIT_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1'].includes(operation)?{preparation_id:id(),configuration_sha256:'b'.repeat(64),request_id:id(),objective:'Actual generated user objective'}:['PREPARE_WORKSPACE_V1','READ_WORKSPACE_PREPARATION_V1'].includes(operation)?{preparation_id:id(),configuration_sha256:'b'.repeat(64)}:operation==='LIST_SEEDS'?{after_seq:0,limit:16}:
    {request_id:id(),objective:'One native task'}};
  return {body,headers:{'content-type':'application/json','x-a2-chat-bridge-client':id(),
    'x-a2-device-profile':'A2_DEVICE_HTTP_SIGNATURE_V1','x-a2-device-id':id(),'x-a2-device-timestamp':new Date().toISOString(),
    'x-a2-device-nonce':'A'.repeat(32),'x-a2-device-body-sha256':'a'.repeat(64),'x-a2-device-signature':'A'.repeat(86)}};
}

test('real private IPC transports optional signed seed envelopes without exposing identity or SQL selectors',async t=>{
  const {client,instanceId,child,stats}=await setup(t,'seed-mounted');
  for(const [action,method] of [['ADMIT_PREPARED_GOAL_V1','admitPreparedGoal'],['READ_PREPARED_GOAL_V1','readPreparedGoal'],['PREPARE_WORKSPACE_V1','prepareWorkspace'],['READ_WORKSPACE_PREPARATION_V1','readWorkspacePreparation'],['SEED_GOAL','seedGoal'],['READ_SEED','readSeed'],['LIST_SEEDS','listSeeds']]){
    const request=seedRequest(action,instanceId,child.pid),reply=await client[method](request);
    assert.equal(reply.fixture_transport_only,true);assert.deepEqual(reply.input,request.body.input);
    await assert.rejects(client[method]({...request,path:'/arbitrary'}),e=>e.reason==='INVALID_PAYLOAD');
    await assert.rejects(client[method]({...request,body:{...request.body,device_id:id()}}),e=>e.reason==='INVALID_PAYLOAD');
  }
  assert.equal((await stats()).calls,3);
});

test('unmounted optional seed capability returns a correlated rejection without dispatch or write ambiguity',async t=>{
  const {client,instanceId,child,stats}=await setup(t);
  for(const [action,method] of [['ADMIT_PREPARED_GOAL_V1','admitPreparedGoal'],['READ_PREPARED_GOAL_V1','readPreparedGoal'],['PREPARE_WORKSPACE_V1','prepareWorkspace'],['READ_WORKSPACE_PREPARATION_V1','readWorkspacePreparation'],['LIST_SEEDS','listSeeds'],['READ_SEED','readSeed'],['SEED_GOAL','seedGoal']]){
    await assert.rejects(client[method](seedRequest(action,instanceId,child.pid)),error=>
      error.reason==='UNSUPPORTED_ACTION'&&error.action===action&&error.instance_id===instanceId
      &&error.effect_outcome==='NONE'&&error.readback_required===false&&error.automatic_retry_allowed===false);
  }
  assert.equal((await stats()).calls,0);
  assert.equal(client.snapshot().closed,false);
  assert.equal(client.snapshot().inflight,0);
  assert.equal((await client.readScope()).call_count,1);
});

test('unmounted optional capability still rejects malformed and foreign envelopes before capability discovery',async t=>{
  const {child,instanceId,stats}=await setup(t);
  const replies=[];child.on('message',message=>{if(message?.schema==='metaengine.native-coding.host-ipc.response.v1')replies.push(message);});
  const frame={schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:instanceId,host_pid:child.pid,
    request_id:id(),action:'LIST_SEEDS',payload:seedRequest('LIST_SEEDS',instanceId,child.pid)};
  child.send({...frame,instance_id:id()});
  child.send({...frame,request_id:id(),payload:{...frame.payload,extra:true}});
  const state=await stats();
  assert.deepEqual(state.protocolErrors,['INSTANCE_MISMATCH','INVALID_PAYLOAD']);
  assert.equal(state.calls,0);assert.deepEqual(replies,[]);
});

test('optional discovery cannot downgrade an outstanding write by reusing its request UUID',async t=>{
  const {child,instanceId,stats}=await setup(t,'slow-write');
  const replies=[];child.on('message',message=>{if(message?.schema==='metaengine.native-coding.host-ipc.response.v1')replies.push(message);});
  const frame={schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:instanceId,host_pid:child.pid,
    request_id:id(),action:'RESERVE_EXECUTION',payload:{scope:scope()}};
  child.send(frame);
  child.send({...frame,action:'LIST_SEEDS',payload:seedRequest('LIST_SEEDS',instanceId,child.pid)});
  await sleep(220);
  assert.equal((await stats()).calls,1);
  const conflict=replies.find(reply=>reply.action==='LIST_SEEDS');
  assert.equal(conflict.outcome,'UNKNOWN');assert.equal(conflict.reason,'REQUEST_ID_REUSED');
  assert.equal(replies.find(reply=>reply.action==='RESERVE_EXECUTION').outcome,'OK');
});

test('seed timeout retains unknown mutation while read-only seed recovery cannot become another dispatch',async t=>{
  const {client,instanceId,child,stats}=await setup(t,'slow-seed',{timeoutMs:30,serverTimeoutMs:1000});
  const request=seedRequest('SEED_GOAL',instanceId,child.pid);
  await assert.rejects(client.seedGoal(request),e=>e.effect_outcome==='UNKNOWN'&&e.readback_required===true);
  const read=seedRequest('READ_SEED',instanceId,child.pid);read.body.input=request.body.input;
  assert.equal((await client.readSeed(read)).operation,'READ_SEED');await sleep(220);assert.equal((await stats()).calls,1);
});

test('private prior-execution IPC transports only typed selectors and rejects caller old scope, hashes, paths and model actions',async t=>{
  const {client,stats}=await setup(t,'prior-readback'),selector={...lease(),agent_generation_epoch:1};
  const result=await client.readPriorExecution(selector);assert.equal(result.state,'HOLD');assert.deepEqual(result.selector,selector);
  for(const extra of [{scope_sha256:'f'.repeat(64)},{host_incarnation:'pid:1:created_100ns:134000000000000000'},
    {path:'C:/caller/receipt.json'},{sql:'select 1'}])
    await assert.rejects(client.readPriorExecution({...selector,...extra}),error=>error.reason==='INVALID_PAYLOAD'&&error.effect_outcome==='NONE');
  await assert.rejects(client.agentOperation({...agentRequest(),operation:'READ_PRIOR_EXECUTION'}),error=>error.reason==='INVALID_PAYLOAD');
  assert.equal((await stats()).calls,1);
});

test('prior-execution read timeout is effect-free and never repeats a Host read or becomes an unknown write',async t=>{
  const {client,stats}=await setup(t,'slow-prior',{timeoutMs:30,serverTimeoutMs:1000});
  await assert.rejects(client.readPriorExecution({...lease(),agent_generation_epoch:1}),
    error=>error.effect_outcome==='NONE'&&error.automatic_retry_allowed===false);
  await sleep(220);assert.equal((await stats()).calls,1);
});

test('agent IPC timeout marks a write unknown and keeps a readonly CHECK effect-free without replay',async t=>{
  const {client,stats}=await setup(t,'slow-agent',{timeoutMs:30,serverTimeoutMs:1000});
  await assert.rejects(client.agentOperation(agentRequest()),e=>e.effect_outcome==='NONE'&&e.readback_required===true);
  await assert.rejects(client.agentOperation(agentRequest('agent_send_message')),e=>e.effect_outcome==='UNKNOWN'&&e.automatic_retry_allowed===false);
  await sleep(220);assert.equal((await stats()).calls,2);
});

test('out-of-order replies cannot swap concurrent lease requests',async t=>{
  const {client}=await setup(t,'out-of-order');const first=lease(),second={...first,lease_generation:2};
  const [a,b]=await Promise.all([client.readLease(first),client.readLease(second)]);
  assert.equal(a.lease_generation,1);assert.equal(b.lease_generation,2);assert.equal(client.snapshot().inflight,0);
});

for(const mode of ['wrong-action','wrong-digest','wrong-instance','wrong-pid'])test(`a ${mode} response cannot satisfy a pending request`,async t=>{
  const {client}=await setup(t,mode);
  await assert.rejects(client.readScope(),error=>error.reason==='RESPONSE_INVALID'&&error.automatic_retry_allowed===false);
});

test('client rejects SQL, DSNs, unknown fields and missing evidence before any send',async t=>{
  const {client,stats}=await setup(t);
  await assert.rejects(client.readLease({...lease(),sql:'select 1'}),error=>error.reason==='INVALID_PAYLOAD');
  const descriptor=envelope('metaengine.codex-cli.transport-proof.v1');descriptor.payload.secret='postgresql://do-not-transport/credential';
  await assert.rejects(client.registerProvider(descriptor),error=>error.reason==='INVALID_PAYLOAD');
  await assert.rejects(client.advanceExecution({...scope(),reservation_id:id()},transition('RESERVED','ATTEMPTED')),error=>error.reason==='INVALID_PAYLOAD');
  await assert.rejects(client.reconcileProject({project_id:id(),checkpoint_sha256:'a'.repeat(64)}),error=>error.reason==='INVALID_PAYLOAD');
  assert.equal((await stats()).calls,0);
});

test('oversized JSON never enters the IPC channel',async t=>{
  const {client,stats}=await setup(t);const descriptor=envelope('metaengine.codex-cli.transport-proof.v1');
  descriptor.payload.padding=Array.from({length:6},()=> 'x'.repeat(60000));
  await assert.rejects(client.registerProvider(descriptor),error=>error.reason==='MESSAGE_TOO_LARGE');
  assert.equal((await stats()).calls,0);
});

test('the bounded client does not send a seventeenth concurrent request',async t=>{
  const {client,stats}=await setup(t,'delayed-read',{maxInflight:16});
  const requests=Array.from({length:16},()=>client.readScope());
  await assert.rejects(client.readScope(),error=>error.reason==='INFLIGHT_LIMIT'&&error.effect_outcome==='NONE');
  await Promise.all(requests);assert.equal((await stats()).calls,16);
});

test('timeout of a write means unknown effect and readback without automatic retransmission',async t=>{
  const {client,stats}=await setup(t,'slow-write',{timeoutMs:30,serverTimeoutMs:500});
  await assert.rejects(client.reserveExecution(scope()),error=>error.reason==='REQUEST_TIMEOUT'&&error.effect_outcome==='UNKNOWN'
    &&error.readback_required===true&&error.automatic_retry_allowed===false);
  await sleep(230);assert.equal((await stats()).calls,1);assert.equal(client.snapshot().inflight,0);
  assert.equal((await client.readScope()).call_count,2);
});

test('server timeout keeps a still-running physical operation in the inflight bound',async t=>{
  const {client,stats}=await setup(t,'slow-write',{timeoutMs:500,serverTimeoutMs:25,serverMaxInflight:1});
  await assert.rejects(client.reserveExecution(scope()),error=>error.reason==='REQUEST_TIMEOUT'&&error.effect_outcome==='UNKNOWN');
  assert.equal((await stats()).snapshot.inflight,1);
  await assert.rejects(client.readScope(),error=>error.reason==='INFLIGHT_LIMIT');
  await sleep(210);assert.equal((await client.readScope()).call_count,2);
});

test('child exit rejects an outstanding write as unknown and never respawns or retries',async t=>{
  const {client}=await setup(t,'exit-write');
  const unavailable=[];client.onUnavailable(value=>unavailable.push(value));
  await assert.rejects(client.reserveExecution(scope()),error=>['CHILD_EXIT','CHANNEL_CLOSED'].includes(error.reason)
    &&error.effect_outcome==='UNKNOWN'&&error.automatic_retry_allowed===false);
  assert.equal(client.snapshot().closed,true);assert.equal(client.snapshot().inflight,0);
  client.close();assert.equal(unavailable.length,1);
  assert.equal(unavailable[0].schema,'metaengine.native-coding.host-unavailable.v1');
  assert.equal(unavailable[0].automatic_retry_allowed,false);
});

test('unavailable subscribers are isolated, removable and synchronously informed after close',async t=>{
  const {client,child,instanceId}=await setup(t);const events=[];
  const cancel=client.onUnavailable(()=>assert.fail('removed subscriber invoked'));cancel();
  client.onUnavailable(()=>{throw Error('consumer_failure');});
  client.onUnavailable(async()=>{throw Error('asynchronous_consumer_failure');});
  client.onUnavailable(event=>events.push(event));
  client.close();client.close();child.emit('disconnect');
  assert.equal(events.length,1);assert.equal(events[0].reason,'CLIENT_CLOSED');
  assert.equal(events[0].instance_id,instanceId);assert.equal(events[0].host_pid,child.pid);
  assert(Object.isFrozen(events[0]));
  let late=null;client.onUnavailable(event=>{late=event;});assert.equal(late,events[0]);
  assert.throws(()=>client.onUnavailable(null),/listener_required/);
});

test('a real channel disconnect notifies the native subscriber exactly once',async t=>{
  const {client,child}=await setup(t);const events=[];
  const unavailable=new Promise(resolve=>client.onUnavailable(event=>{events.push(event);resolve();}));
  child.disconnect();await unavailable;client.close();
  assert.equal(events.length,1);assert.equal(events[0].reason,'CHANNEL_CLOSED');
  await assert.rejects(client.readScope(),error=>error.reason==='CHANNEL_CLOSED'&&error.effect_outcome==='NONE');
});

test('any terminal declaration fences before exit, rejects pending writes as unknown and ignores later replies',async t=>{
  const {client,child,stats}=await setup(t,'terminal-write');const events=[];
  client.onUnavailable(event=>events.push(event));
  await assert.rejects(client.reserveExecution(scope()),error=>error.reason==='HOST_TERMINATED'
    &&error.effect_outcome==='UNKNOWN'&&error.readback_required===true);
  assert.equal(child.connected,true);assert.equal(client.snapshot().closed,true);
  await sleep(60);await assert.rejects(client.readScope(),error=>error.reason==='CHANNEL_CLOSED');
  assert.equal((await stats()).calls,1);client.close();
  assert.equal(events.length,1);assert.equal(events[0].reason,'HOST_TERMINATED');
});

for(const mode of ['callback','throw'])test(`send ${mode} failure closes the capability and preserves pending write ambiguity`,async t=>{
  const {client,child}=await setup(t,'slow-write');const events=[];
  client.onUnavailable(event=>events.push(event));
  const pending=client.reserveExecution(scope());
  child.send=(_message,callback)=>{if(mode==='throw')throw Error('private transport detail');callback(Error('private transport detail'));};
  const results=await Promise.allSettled([pending,client.readScope()]);
  assert.equal(results[0].reason.reason,'SEND_FAILED');assert.equal(results[0].reason.effect_outcome,'UNKNOWN');
  assert.equal(results[1].reason.reason,'SEND_FAILED');assert.equal(results[1].reason.effect_outcome,'NONE');
  assert.equal(client.snapshot().closed,true);assert.equal(events.length,1);assert.equal(events[0].reason,'SEND_FAILED');
});

test('a child transport error fences without publishing raw error details',async t=>{
  const {client,child}=await setup(t);const events=[];client.onUnavailable(event=>events.push(event));
  child.emit('error',Error('private transport detail'));client.close();
  assert.equal(events.length,1);assert.equal(events[0].reason,'CHANNEL_CLOSED');
  assert.equal(JSON.stringify(events).includes('private transport detail'),false);
});

test('operation errors expose fixed reasons without raw SQL, DSNs or secret error text',async t=>{
  const {client}=await setup(t,'throw-write');
  await assert.rejects(client.registerProvider(envelope('metaengine.codex-cli.transport-proof.v1')),error=>error.reason==='WRITE_OUTCOME_UNKNOWN'
    &&error.effect_outcome==='UNKNOWN'&&!error.message.includes('postgres')&&!error.message.includes('SQL'));
});

test('server rejects foreign instances, unknown actions, extra fields and handle-bearing frames',async t=>{
  const {child,instanceId,stats}=await setup(t);
  const base={schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:instanceId,host_pid:child.pid,request_id:id(),action:'READ_SCOPE',payload:{}};
  child.send({...base,instance_id:id()});child.send({...base,request_id:id(),action:'RAW_SQL'});child.send({...base,request_id:id(),extra:true});
  child.send({schema:'test.native-coding.handle',frame:{...base,request_id:id()}});
  await sleep(20);const state=await stats();assert.equal(state.calls,0);
  assert.deepEqual(state.protocolErrors,['INSTANCE_MISMATCH','UNSUPPORTED_ACTION','INVALID_PAYLOAD','INVALID_FRAME']);
});

test('duplicate request UUIDs cannot execute a private write twice',async t=>{
  const {child,client,stats}=await setup(t,'slow-write');
  const original=child.send.bind(child);let captured=null;
  child.send=(message,...args)=>{
    if(message?.schema==='metaengine.native-coding.host-ipc.request.v1'&&message.action==='RESERVE_EXECUTION'&&!captured){
      captured=structuredClone(message);const result=original(message,...args);original(message);return result;
    }
    return original(message,...args);
  };
  const result=await Promise.allSettled([client.reserveExecution(scope())]);
  assert.ok(result[0].status==='fulfilled'||result[0].reason.reason==='REQUEST_ID_REUSED');
  await sleep(220);assert.equal((await stats()).calls,1);
  original({...captured,payload:{scope:{...captured.payload.scope,scope_sha256:'f'.repeat(64)}}});
  await sleep(20);assert.equal((await stats()).calls,1);
});

test('a JSON transport object cannot impersonate the private ChildProcess capability',()=>{
  assert.throws(()=>createNativeCodingHostIpcClient({child:{pid:1,connected:true,channel:{},send(){}},instanceId:id(),hostPid:1}),/CHANNEL_CLOSED/);
});


test('real private IPC supplies a bounded server-owned deadline and cancellation signal',async t=>{
 const {client}=await setup(t,'request-context',{serverTimeoutMs:1000});
 const result=await client.readScope();
 assert.equal(result.has_signal,true);assert.equal(result.aborted,false);
 assert.ok(Number.isSafeInteger(result.deadline_at));
 assert.ok(result.remaining_ms>0&&result.remaining_ms<=1000);
});

 test('private rejection reader crosses the fixed child IPC contract without caller paths or repair grants',async t=>{
  const {client}=await setup(t);
  const query={project_id:id(),writer_task_id:id(),writer_lease_generation:1,critic_task_id:id(),critic_lease_generation:1,result_sha256:'a'.repeat(64)};
  const result=await client.readProjectRejection(query);assert.equal(result.state,'VERIFIED_REJECTION');assert.equal(result.repair_authorized,false);
  assert.equal(result.writer_task_id,query.writer_task_id);
  for(const extra of [{path:'C:/caller-root'},{sql:'select 1'},{repair_authorized:true}])
    await assert.rejects(client.readProjectRejection({...query,...extra}),error=>error.reason==='INVALID_PAYLOAD'&&error.effect_outcome==='NONE');
 });

test('workspace preparation IPC strips enumerable driver query errors and preserves unknown write outcome',async t=>{
 const {client,instanceId,child}=await setup(t,'secret-preparation');
 for(const [action,method,reason] of [['ADMIT_PREPARED_GOAL_V1','admitPreparedGoal','WRITE_OUTCOME_UNKNOWN'],['READ_PREPARED_GOAL_V1','readPreparedGoal','OPERATION_FAILED'],['PREPARE_WORKSPACE_V1','prepareWorkspace','WRITE_OUTCOME_UNKNOWN'],['READ_WORKSPACE_PREPARATION_V1','readWorkspacePreparation','OPERATION_FAILED']])
  await assert.rejects(client[method](seedRequest(action,instanceId,child.pid)),error=>error.reason===reason&&!JSON.stringify(error).includes('SENTINEL')&&!String(error.stack).includes('SENTINEL'));
});

// Real owned ChildProcess transport only. Signature/SQL authority is exercised
// independently by native-coding-pending-goal.pg17.test.mjs, not these stubs.
test('owned ChildProcess transports fixed pending-owner scopes without exposing callback results in frames',async t=>{
 const {client,child,instanceId,stats}=await setup(t,'owner-mounted');
 const frames=[],observe=message=>frames.push(message);child.on('message',observe);t.after(()=>child.off('message',observe));
 const input=seedRequest('ESTABLISH_PENDING_OWNER_V1',instanceId,child.pid);
 const value=await client.withPendingOwnerScope('ESTABLISH_PENDING_OWNER_V1',input,async tx=>{
  assert.equal(tx.unsafe,undefined);assert.equal(tx.verifyTransition,undefined);
  const scope=await tx.readScope();assert.equal(scope.project_id,input.body.input.request_id);
  await tx.prepareTransition({previous_sha256:null,next_sha256:'d'.repeat(64)});
  for(let i=0;i<3;i++)await tx.readScope();
  return{privateCallbackValue:'NEVER_ON_WIRE'};
 });
 assert.deepEqual(value,{privateCallbackValue:'NEVER_ON_WIRE'});assert.equal((await stats()).calls,1);
 assert.equal(JSON.stringify(frames).includes('NEVER_ON_WIRE'),false);
 const read=seedRequest('READ_PENDING_OWNER_V1',instanceId,child.pid);read.body.input=input.body.input;
 assert.equal(await client.withPendingOwnerScope('READ_PENDING_OWNER_V1',read,async tx=>{
  assert.equal(tx.prepareTransition,undefined);await tx.readScope();await tx.verifyTransition({sealed_sha256:'d'.repeat(64)});return 'READ_ONLY';
 }),'READ_ONLY');
 assert.equal((await stats()).calls,1);
});

test('owned pending-owner timeout joins already-started native callback before reporting unknown',async t=>{
 const {client,child,instanceId,stats}=await setup(t,'owner-timeout',{timeoutMs:1000,serverTimeoutMs:60});
 let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let finished=false;
 const pending=client.withPendingOwnerScope('ESTABLISH_PENDING_OWNER_V1',seedRequest('ESTABLISH_PENDING_OWNER_V1',instanceId,child.pid),async tx=>{
  await tx.readScope();entered();await gate;finished=true;tx.assertOpen();return true;
 });
 pending.catch(()=>{});await ready;let settled=false;pending.catch(()=>{settled=true;});await sleep(120);
 assert.equal(settled,false);release();await assert.rejects(pending,error=>error.effect_outcome==='UNKNOWN');
 assert.equal(finished,true);assert.equal((await stats()).calls,0);
});

test('owned pending-owner disconnect joins the main native callback and never retries',async t=>{
 const {client,child,instanceId}=await setup(t,'owner-mounted');
 let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let callbacks=0;
 const pending=client.withPendingOwnerScope('ESTABLISH_PENDING_OWNER_V1',seedRequest('ESTABLISH_PENDING_OWNER_V1',instanceId,child.pid),async tx=>{
  callbacks++;await tx.readScope();entered();await gate;tx.assertOpen();return true;
 });
 pending.catch(()=>{});await ready;const exited=new Promise(r=>child.once('exit',r));child.disconnect();await exited;let settled=false;pending.catch(()=>{settled=true;});await sleep(40);
 assert.equal(settled,false);release();await assert.rejects(pending,error=>error.effect_outcome==='UNKNOWN');assert.equal(callbacks,1);
});

test('owned pending-owner lost RELEASE acknowledgement is unknown and read-only followup never reseals',async t=>{
 const {client,child,instanceId,stats}=await setup(t,'owner-lost-release',{timeoutMs:1000,serverTimeoutMs:80});let seals=0;
 const request=seedRequest('ESTABLISH_PENDING_OWNER_V1',instanceId,child.pid);
 await assert.rejects(client.withPendingOwnerScope('ESTABLISH_PENDING_OWNER_V1',request,async tx=>{
  await tx.readScope();await tx.prepareTransition({previous_sha256:null,next_sha256:'d'.repeat(64)});
  for(let i=0;i<3;i++)await tx.readScope();seals++;return true;
 }),error=>error.effect_outcome==='UNKNOWN'&&error.readback_required===true);
 const read=seedRequest('READ_PENDING_OWNER_V1',instanceId,child.pid);read.body.input=request.body.input;
 assert.equal(await client.withPendingOwnerScope('READ_PENDING_OWNER_V1',read,async tx=>{
  assert.equal(tx.prepareTransition,undefined);await tx.readScope();await tx.verifyTransition({sealed_sha256:'d'.repeat(64)});return true;
 }),true);
 assert.equal(seals,1);assert.equal((await stats()).calls,1);
});
