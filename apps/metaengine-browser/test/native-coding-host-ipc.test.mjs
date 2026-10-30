import {createNativeRunCallbackJournal,readNativeRunCallbackJournal} from '../src/native-coding-run-callback-journal.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';
import {inMemoryNativeBroker} from './fixtures/native-coding-in-memory-broker.mjs';
import {nativeCodingAgentMcpIntentBodySha256} from '../src/native-coding-agent-mcp-broker.mjs';
import {validateNativeCodingAgentHostRequest} from '../src/native-coding-agent-host-contract.mjs';
import {nativeCodingCanonicalJson} from '../src/native-coding-task-context.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createNativeCodingHostIpcClient } from '../src/native-coding-host-ipc-client.mjs';

const transactionUrl=new URL('../../../infra/client-state-runtime/native-coding-preparation-transaction.mjs',import.meta.url).href;
const serverUrl=new URL('../../../infra/client-state-runtime/native-coding-host-ipc.mjs',import.meta.url).href;
const protectedReaderUrl=new URL('../src/native-coding-host-observers.mjs',import.meta.url).href;
const id=()=>randomUUID();
const scope=()=>({workspace_id:id(),task_id:id(),lease_generation:1,agent_id:'agent_native-test-1234',
  target_id:`codex-cli:${id()}`,agent_generation_epoch:1,host_incarnation:'pid:1234:created_100ns:134371917225776174',scope_sha256:'a'.repeat(64)});
const lease=()=>({workspace_id:id(),project_id:id(),task_id:id(),agent_id:'agent_native-test-1234',lease_generation:1,provider_id:id()});
const envelope=schema=>({algorithm:'ES256',issuer_key_fingerprint_sha256:'a'.repeat(64),payload:{schema},signature:'A'.repeat(86)});
const transition=(from,to)=>({from,to,evidence_sha256:'b'.repeat(64),critic_proof_sha256:null,checkpoint_sha256:null});
const agentRequest=(operation='CHECK')=>({operation,args:operation==='agent_send_message'?{request_id:id(),target_agent_id:'agent_native-peer123',message:'One message'}:{},
  binding:{run_id:id(),workspace_id:id(),project_id:id(),task_id:id(),lease_generation:1,agent_id:'agent_native-test-1234',agent_generation_epoch:1,provider_id:id(),role:'IMPLEMENTER'},
  job_binding:{job_id:id(),pid:1234,process_incarnation_id:'pid:1234:created_100ns:134371917225776174',executable_sha256:'a'.repeat(64)}});

async function setup(t,mode='normal',{timeoutMs=1000,maxInflight=16,serverMaxInflight=16,serverTimeoutMs=1000,readShutdownSettlement=null}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-private-ipc-'));
  const script=path.join(root,'child.mjs'),instanceId=id();
  await fs.writeFile(path.join(root,'private-fixture.json'),'{"schema":"generated"}');
  await fs.writeFile(script,`
import {createNativeCodingHostIpcServer} from ${JSON.stringify(serverUrl)};
import {readNativeCodingProtectedJson} from ${JSON.stringify(protectedReaderUrl)};
import {createNativePreparationTransactions} from ${JSON.stringify(transactionUrl)};
const mode=process.env.METAENGINE_IPC_TEST_MODE;let calls=0,protocolErrors=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const operations={
 READ_SCOPE:async (value,context)=>{const n=++calls;
  if(mode==='acl-rejection-held')return readNativeCodingProtectedJson(${JSON.stringify(path.join(root,'private-fixture.json'))},{signal:context.signal,verifyStorage:(_target,{operation,signal})=>{
   if(operation==='VERIFY_DIRECTORY')return Promise.reject(Error('generated_directory_denied'));
   return new Promise(resolve=>{const release=m=>{if(m?.schema==='test.release-acl'){process.off('message',release);resolve({owner_dacl_verified:true});}};
    process.on('message',release);signal.addEventListener('abort',()=>process.send({schema:'test.acl-aborted'}),{once:true});process.send({schema:'test.acl-started'});});
  }});
if(mode==='request-context')return {bindings:[],has_signal:context.signal instanceof AbortSignal,aborted:context.signal.aborted,deadline_at:context.deadlineAt,remaining_ms:context.deadlineAt-Date.now()};if(mode==='delayed-read')await delay(80);
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
 RESERVE_EXECUTION:async value=>{++calls;if(mode==='exit-write')process.exit(19);if(mode==='terminal-write'){process.send({schema:'compute.runtime-host-terminal.v1',invalid_payload:true});await delay(25);}if(mode==='slow-write')await delay(180);
  if(mode==='transaction-hold'||mode==='swallowed-transaction-hold'){
   const monitor=createNativePreparationTransactions();const pool={reserve:async()=>({unsafe:async q=>{monitor.debug(1,q);if(q==='rollback')throw Error('fixture rollback failed');return [];},release(){throw Error('dirty reservation released');}})};
   try{await monitor.transaction(pool,'isolation level serializable',async()=>{throw Error('fixture body rejected');});}catch(error){if(mode!=='swallowed-transaction-hold')throw error;}
  }
  if(mode==='held-physical')await new Promise(resolve=>{const release=m=>{if(m?.schema==='test.release-physical'){process.off('message',release);resolve();}};process.on('message',release);process.send({schema:'test.physical-started'});});return {state:'RESERVED',scope:value.scope};},
 ADVANCE_EXECUTION:async value=>{++calls;return {state:value.transition.to,has_job_proof:!!value.transition.job_proof,has_result_receipt:!!value.transition.result_receipt};},
 RECONCILE_PROJECT:async value=>{++calls;if(mode==='throw-write')throw Error('checkpoint_unknown');return {project_id:value.project_id,state:'CHECKPOINTED_PENDING_COMMIT'};},
 READ_PROJECT_REJECTION:async value=>({schema:'metaengine.native-coding.project-rejection-readback.v1',state:'VERIFIED_REJECTION',...value,repair_authorized:false,checkpoint_created:false,authority_effect:false}),
 READ_PROJECT_CHECKPOINT:async value=>({project_id:value.project_id,state:'CHECKPOINTED_PENDING_COMMIT'}),
 AGENT_OPERATION:async value=>{++calls;if(mode==='slow-agent')await delay(180);
  if(['held-agent','bridge-held'].includes(mode)&&value.operation!=='CHECK')await new Promise(resolve=>{const release=m=>{if(m?.schema==='test.release-agent'&&m.run_id===value.binding.run_id){process.off('message',release);resolve();}};process.on('message',release);process.send({schema:'test.agent-started',run_id:value.binding.run_id});});
  if(mode==='agent-rollback-poison'){
   const monitor=createNativePreparationTransactions(),pool={reserve:async()=>({unsafe:async q=>{monitor.debug(1,q);if(q==='rollback')throw Error('generated rollback failure');return [];},release(){}})};
   try{await monitor.transaction(pool,'isolation level serializable',async()=>{throw Error('generated body failure');});}catch{}
  }
  if(mode==='bridge-held'&&value.operation==='CHECK')return {schema:'metaengine.native-coding.agent-authorized.v1',run_id:value.binding.run_id,authorized:true,authority_effect:false};
  return {operation:value.operation,run_id:value.binding.run_id};},
 FINISH_CHECKPOINT:async value=>{++calls;return {...value,state:'COMMITTED_NO_SUCCESSOR'};},
 READ_FINISH_CHECKPOINT:async value=>({...value,state:'PENDING_COMMIT'}),
 close:()=>{},
};
if(mode==='capacity-minimal'){
 for(const key of Object.keys(operations))if(key!=='close')delete operations[key];
 for(const action of ['DISCOVER_NATIVE_SETUP_V1','BEGIN_NATIVE_SETUP_V1','READ_NATIVE_SETUP_V1','CANCEL_NATIVE_SETUP_V1','READ_NATIVE_SETUP_ROUTE_V1'])operations[action]=async()=>({fixture_transport_only:true});
 operations.READ_NATIVE_CAPACITY_V1=async request=>{calls++;return {fixture_transport_only:true,input:request.body.input};};
}
if(['reconciliation-mounted','slow-reconciliation','held-reconciliation','exit-reconciliation'].includes(mode))operations.RECONCILE_FINISH_CHECKPOINT=async value=>{
 ++calls;if(mode==='exit-reconciliation')process.exit(19);if(mode==='slow-reconciliation')await delay(180);
 if(mode==='held-reconciliation')await new Promise(resolve=>{
  const release=message=>{if(message?.schema==='test.native-coding.release-reconciliation'){process.off('message',release);resolve();}};
  process.on('message',release);process.send({schema:'test.native-coding.reconciliation-started'});
 });
 return {...value,state:'COMMITTED_NO_SUCCESSOR',automatic_retry_allowed:false};
};
if(mode==='service-v2-mounted')for(const action of ['SERVICE_HEARTBEAT_V2','READ_SERVICE_HEARTBEAT_V2'])operations[action]=async request=>{calls++;return {fixture_transport_only:true,operation:action,input:request.body.input};};
if(mode==='seed-mounted'||mode==='slow-seed'||mode==='secret-preparation')for(const action of ['ADMIT_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1','PREPARE_WORKSPACE_V1','READ_WORKSPACE_PREPARATION_V1','SEED_GOAL','READ_SEED','LIST_SEEDS'])operations[action]=async request=>{
 if(action==='SEED_GOAL'||action==='PREPARE_WORKSPACE_V1'||action==='ADMIT_PREPARED_GOAL_V1'){calls++;if(mode==='slow-seed')await delay(180);}
 if(mode==='secret-preparation')throw Object.assign(Error('SENTINEL_PRIVATE_QUERY_PARAMETER'),{query:'SENTINEL_PRIVATE_QUERY_PARAMETER',parameters:['SENTINEL_PRIVATE_QUERY_PARAMETER'],args:['SENTINEL_PRIVATE_QUERY_PARAMETER']});
 return {fixture_transport_only:true,operation:action,input:request.body.input};
};
if(mode==='owner-mounted'||mode==='owner-timeout'||mode==='owner-lost-release'||mode==='owner-held-commit')for(const action of ['ESTABLISH_PENDING_OWNER_V1','READ_PENDING_OWNER_V1'])operations[action]=async(request,context)=>{
 const scope={device_id:request.headers['x-a2-device-id'],client_id:request.headers['x-a2-chat-bridge-client'],key_fingerprint_sha256:'c'.repeat(64),
  admin_grant_epoch:1,project_id:request.body.input.request_id,observed_at:new Date().toISOString()};
 const released=await context.pendingOwnerPhases.run(scope,{readScope:async()=>({...scope,observed_at:new Date().toISOString()}),prepareTransition:async()=>{calls++;},verifyTransition:async()=>{}});
 if(mode==='owner-lost-release'&&action==='ESTABLISH_PENDING_OWNER_V1')await delay(180);
 if(mode==='owner-held-commit'){
  const monitor=createNativePreparationTransactions();const pool={reserve:async()=>({unsafe:async q=>{monitor.debug(1,q);if(q==='commit')await new Promise(resolve=>{
   const release=m=>{if(m?.schema==='test.release-physical'){process.off('message',release);resolve();}};process.on('message',release);process.send({schema:'test.commit-started'});
  });return [];},release(){process.send({schema:'test.reservation-released'});}})};
  await monitor.transaction(pool,'isolation level serializable',async()=>released);
 }
 return released;
};
if(mode==='activation-mounted'||mode==='activation-lost-ack'){
 operations.ACTIVATE_PREPARED_GOAL_V1=async(request,context)=>{
  const scope={schema:'metaengine.native-coding.pending-activation-scope.v1',input:request.body.input,
   scope:{device_id:request.headers['x-a2-device-id'],client_id:request.headers['x-a2-chat-bridge-client'],key_fingerprint_sha256:'c'.repeat(64),admin_grant_epoch:1,project_id:request.body.input.request_id,observed_at:new Date().toISOString()},
   artifact:{installed_exe_sha256:'1'.repeat(64),installed_asar_sha256:'2'.repeat(64),runtime_bundle_sha256:'3'.repeat(64),source_sha:'4'.repeat(40),cli_executable_sha256:'5'.repeat(64)}};
  const proof=await context.pendingActivationPhases.authorize(scope,{readScope:async()=>scope,verifyTransition:async()=>{}});calls++;
  if(mode==='activation-lost-ack')await delay(180);
  return {fixture_transport_only:true,state:'ACTIVATED',sealed_sha256:proof.sealed_sha256};
 };
 operations.READ_PREPARED_GOAL_ACTIVATION_V1=async request=>({fixture_transport_only:true,input:request.body.input});
}
if(mode==='prior-readback'||mode==='slow-prior')operations.READ_PRIOR_EXECUTION=async ({selector})=>{
 ++calls;if(mode==='slow-prior')await delay(180);
 return {fixture_transport_only:true,state:'HOLD',selector,physical_effect_replayed:false,automatic_retry_allowed:false,authority_effect:false};
};
const send=(frame,callback)=>{
 const copy=structuredClone(frame);
 if(frame.schema==='metaengine.native-coding.host-settlement.v1'){
  if(mode==='settlement-after-result'){setTimeout(()=>process.send(copy,callback),60);return;}
  if(mode==='duplicate-settlement'){process.send(copy);}
  if(mode.startsWith('settlement-wrong-'))copy[mode.slice('settlement-wrong-'.length)]=mode.endsWith('host_pid')?process.pid+1:'f'.repeat(64);
  if(mode==='settlement-missing')return;
  if(mode==='settlement-send-failed'){callback(Error('fixture channel write failed'));return;}
 }
 if((mode==='late-ok'||mode==='late-agent-ok'&&frame.value?.operation==='agent_send_message')&&frame.schema==='metaengine.native-coding.host-ipc.response.v1'){setTimeout(()=>process.send({...copy,outcome:'OK',reason:null,value:{late:true}},callback),100);return;}
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
 if(message?.schema==='test.close-server'){server.close();return;}
 if(message?.schema==='test.release-acl')return;
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
    if(child.exitCode===null&&child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
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
  client=createNativeCodingHostIpcClient({child,instanceId,hostPid:child.pid,timeoutMs,maxInflight,readShutdownSettlement});
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

function activationRequest(operation,instanceId,hostPid){
 const request=seedRequest('ESTABLISH_PENDING_OWNER_V1',instanceId,hostPid);request.body.operation=operation;
 Object.assign(request.body.input,{activation_id:id(),profile_id:id(),profile_sha256:'f'.repeat(64)});return request;
}
test('owned ChildProcess activation is READ_CUSTODY-only and returns outer committed result',async t=>{
 const {client,child,instanceId,stats}=await setup(t,'activation-mounted');
 const request=activationRequest('ACTIVATE_PREPARED_GOAL_V1',instanceId,child.pid);
 const value=await client.withPendingActivationScope(request,async tx=>{
  assert.equal(tx.prepareTransition,undefined);assert.equal(tx.unsafe,undefined);assert.deepEqual(tx.activation.input,request.body.input);
  await tx.readScope();await tx.verifyTransition({sealed_sha256:'f'.repeat(64)});return {native:'PRIVATE'};
 });
 assert.deepEqual(value,{fixture_transport_only:true,state:'ACTIVATED',sealed_sha256:'f'.repeat(64)});assert.equal((await stats()).calls,1);
});
test('owned ChildProcess lost activation ACK is unknown; exact readback never activates again',async t=>{
 const {client,child,instanceId,stats}=await setup(t,'activation-lost-ack',{timeoutMs:1000,serverTimeoutMs:80});
 const request=activationRequest('ACTIVATE_PREPARED_GOAL_V1',instanceId,child.pid);
 await assert.rejects(client.withPendingActivationScope(request,async tx=>{
  await tx.readScope();await tx.verifyTransition({sealed_sha256:'f'.repeat(64)});return true;
 }),e=>e.effect_outcome==='UNKNOWN'&&e.readback_required===true);
 const read=structuredClone(request);read.body.operation='READ_PREPARED_GOAL_ACTIVATION_V1';
 assert.deepEqual((await client.readPreparedGoalActivation(read)).input,request.body.input);assert.equal((await stats()).calls,1);
});

// Physical settlement evidence below is real owned ChildProcess IPC with inert
// operation/SQL-driver fixtures. Not installed Windows or real SQL authority.
const messageOnce=(child,schema)=>new Promise(resolve=>{const read=m=>{if(m?.schema===schema){child.off('message',read);resolve(m);}};child.on('message',read);});
test('caller timeout retains physical admission until actual operation finishes; no resend',async t=>{
 const f=await setup(t,'held-physical',{timeoutMs:1000,serverTimeoutMs:40,maxInflight:1});
 const entered=messageOnce(f.child,'test.physical-started');let error;
 const work=f.client.reserveExecution(scope()).catch(e=>{error=e;});await entered;await work;
 assert.equal(error.effect_outcome,'UNKNOWN');assert.equal(f.client.snapshot().inflight,0);assert.equal(f.client.snapshot().physical_inflight,1);
 assert.equal((await f.stats()).snapshot.inflight,1);await assert.rejects(f.client.readScope(),e=>e.reason==='INFLIGHT_LIMIT');
 let drained=false;const drain=f.client.drainPhysical().then(()=>{drained=true;});assert.equal(f.client.drainPhysical() instanceof Promise,true);
 await sleep(20);assert.equal(drained,false);f.child.send({schema:'test.release-physical'});await drain;
 assert.equal(f.client.snapshot().physical_inflight,0);assert.equal(error.effect_outcome,'UNKNOWN');assert.equal((await f.stats()).calls,1);
});
test('timeout during COMMIT after RELEASE keeps Main drain until commit acknowledgement and reservation release',async t=>{
 const f=await setup(t,'owner-held-commit',{timeoutMs:1000,serverTimeoutMs:50});
 const entered=messageOnce(f.child,'test.commit-started'),released=messageOnce(f.child,'test.reservation-released');let seals=0;
 const work=f.client.withPendingOwnerScope('ESTABLISH_PENDING_OWNER_V1',seedRequest('ESTABLISH_PENDING_OWNER_V1',f.instanceId,f.child.pid),async tx=>{
  await tx.readScope();await tx.prepareTransition({previous_sha256:null,next_sha256:'d'.repeat(64)});for(let i=0;i<3;i++)await tx.readScope();seals++;return true;
 });work.catch(()=>{});await entered;await assert.rejects(work,e=>e.effect_outcome==='UNKNOWN');let drained=false;
 const drain=f.client.drainPhysical().then(()=>{drained=true;});await sleep(20);assert.equal(drained,false);assert.equal(f.client.snapshot().physical_inflight,1);
 f.child.send({schema:'test.release-physical'});await released;await drain;assert.equal(seals,1);assert.equal((await f.stats()).calls,1);
});
for(const mode of ['normal','duplicate-settlement','settlement-after-result'])test(`physical ${mode} ordering drains exactly once, including client close`,async t=>{
 const {client}=await setup(t,mode);await client.reserveExecution(scope());client.close();const proof=await client.drainPhysical();assert.equal(proof.cleanup_confirmed,true);assert.equal(client.snapshot().physical_inflight,0);assert.deepEqual(await client.drainPhysical(),proof);
});
for(const key of ['instance_id','host_pid','action','request_sha256'])test('forged settlement '+key+' cannot release exact original request',async t=>{
 const {client}=await setup(t,'settlement-wrong-'+key);await assert.rejects(client.reserveExecution(scope()),e=>e.effect_outcome==='UNKNOWN');assert.equal(client.snapshot().physical_cleanup_state,'HOLD');
 await assert.rejects(client.drainPhysical(),e=>e.reason==='PHYSICAL_CLEANUP_UNCONFIRMED');assert.equal(client.snapshot().physical_inflight,1);
});
test('poisoned rollback remains held on both peers and repeated drains do not free capacity',async t=>{
 const f=await setup(t,'transaction-hold',{maxInflight:1});await assert.rejects(f.client.reserveExecution(scope()),e=>e.effect_outcome==='UNKNOWN');
 for(let i=0;i<3;i++)await assert.rejects(f.client.drainPhysical(),e=>e.reason==='PHYSICAL_CLEANUP_UNCONFIRMED');
 assert.equal(f.client.snapshot().physical_inflight,1);const stats=await f.stats();assert.equal(stats.snapshot.held,1);assert.equal(stats.snapshot.inflight,1);assert.equal(stats.calls,1);
 await assert.rejects(f.client.readScope(),e=>e.reason==='INFLIGHT_LIMIT');
});
for(const mode of ['exit-write','terminal-write'])test('child '+mode+' without verified controller terminal+exit leaves cleanup HOLD',async t=>{
 const {client}=await setup(t,mode);await assert.rejects(client.reserveExecution(scope()));await assert.rejects(client.drainPhysical(),e=>e.reason==='PHYSICAL_CLEANUP_UNCONFIRMED');assert.equal(client.snapshot().physical_inflight,1);
});
test('exact private controller shutdown witness alone may resolve disconnect HOLD, never effect outcome',async t=>{
 let witness=null,reads=0;const f=await setup(t,'exit-write',{readShutdownSettlement:async()=>{reads++;return witness;}});let error;
 await f.client.reserveExecution(scope()).catch(e=>{error=e;});
 for(const value of [null,{schema:'metaengine.native-coding.host-shutdown-settlement.v1',instance_id:id(),host_pid:f.child.pid,cleanup_confirmed:true,authority_effect:false}]){witness=value;await assert.rejects(f.client.drainPhysical());}
 witness={schema:'metaengine.native-coding.host-shutdown-settlement.v1',instance_id:f.instanceId,host_pid:f.child.pid,cleanup_confirmed:true,authority_effect:false};
 assert.equal((await f.client.drainPhysical()).cleanup_confirmed,true);assert.equal(error.effect_outcome,'UNKNOWN');assert.equal(reads,3);
});
test('late OK cannot upgrade caller timeout even after independent physical settlement',async t=>{
 const {client}=await setup(t,'late-ok',{timeoutMs:30,serverTimeoutMs:1000});let error;await client.reserveExecution(scope()).catch(e=>{error=e;});
 assert.equal(error.effect_outcome,'UNKNOWN');await client.drainPhysical();await sleep(130);assert.equal(error.effect_outcome,'UNKNOWN');assert.equal(client.snapshot().physical_inflight,0);
});
test('completed response retention is bounded and physical rows do not accumulate on normal reads',async t=>{
 const f=await setup(t);for(let i=0;i<300;i++)await f.client.readScope();await f.client.drainPhysical();const stats=await f.stats();assert.equal(stats.snapshot.completed,256);assert.equal(stats.snapshot.inflight,0);assert.equal(f.client.snapshot().physical_inflight,0);
});

test('activation timeout after RELEASE retains physical row after local callback drain',async t=>{
 const f=await setup(t,'activation-lost-ack',{timeoutMs:1000,serverTimeoutMs:60});const request=activationRequest('ACTIVATE_PREPARED_GOAL_V1',f.instanceId,f.child.pid);
 await assert.rejects(f.client.withPendingActivationScope(request,async tx=>{await tx.readScope();await tx.verifyTransition({sealed_sha256:'f'.repeat(64)});return true;}),e=>e.effect_outcome==='UNKNOWN');
 assert.equal(f.client.snapshot().physical_inflight,1);await assert.rejects(f.client.drainPhysical({wait:false}),e=>e.reason==='PHYSICAL_CLEANUP_UNCONFIRMED');
 assert.equal((await f.client.drainPhysical()).cleanup_confirmed,true);assert.equal((await f.stats()).calls,1);
});

test('Host cannot emit SETTLED when a domain recovery wrapper swallowed poisoned rollback',async t=>{
 const f=await setup(t,'swallowed-transaction-hold');const result=await f.client.reserveExecution(scope());assert.equal(result.state,'RESERVED');
 await assert.rejects(f.client.drainPhysical(),e=>e.reason==='PHYSICAL_CLEANUP_UNCONFIRMED');assert.equal(f.client.snapshot().physical_inflight,1);assert.equal((await f.stats()).snapshot.held,1);
});

for(const mode of ['settlement-missing','settlement-send-failed','settlement-wrong-request_id'])test(`missing exact settlement (${mode}) retains capacity despite caller OK and client close`,async t=>{
 const f=await setup(t,mode,{maxInflight:1});await f.client.reserveExecution(scope());
 assert.equal(f.client.snapshot().physical_inflight,1);await assert.rejects(f.client.readScope(),e=>e.reason==='INFLIGHT_LIMIT');
 await assert.rejects(f.client.drainPhysical({wait:false}),e=>e.reason==='PHYSICAL_CLEANUP_UNCONFIRMED');f.client.close();
 await assert.rejects(f.client.drainPhysical({wait:false}),e=>e.reason==='PHYSICAL_CLEANUP_UNCONFIRMED');assert.equal(f.client.snapshot().physical_inflight,1);
 const stats=await f.stats();assert.equal(stats.calls,1);if(mode==='settlement-send-failed')assert.deepEqual(stats.protocolErrors,['SEND_FAILED']);
});

test('minimal actual IPC mounts only setup plus signed capacity READ and never execution actions',async t=>{
 const {client,instanceId,child,stats}=await setup(t,'capacity-minimal');
 const packet=seedRequest('READ_NATIVE_CAPACITY_V1',instanceId,child.pid);packet.body.input={owned_tasks:[]};
 const result=await client.readNativeCapacity(packet);assert.deepEqual(result,{fixture_transport_only:true,input:{owned_tasks:[]}});
 for(const extra of [{resolved:[]},{capacity_evidence:{}},{command:'start'}])await assert.rejects(client.readNativeCapacity({...packet,body:{...packet.body,input:{owned_tasks:[],...extra}}}),e=>e.reason==='INVALID_PAYLOAD');
 await assert.rejects(client.readScope(),e=>e.reason==='UNSUPPORTED_ACTION'&&e.effect_outcome==='NONE');
 await assert.rejects(client.reserveExecution(scope()),e=>e.reason==='UNSUPPORTED_ACTION'&&e.effect_outcome==='NONE');
 assert.equal((await stats()).calls,1);
});


test('fixed v2 heartbeat and readback cross actual private IPC with no selector/evidence widening',async t=>{
 const {client,instanceId,child,stats}=await setup(t,'service-v2-mounted');
 for(const [action,method] of [['SERVICE_HEARTBEAT_V2','serviceHeartbeatV2'],['READ_SERVICE_HEARTBEAT_V2','readServiceHeartbeatV2']]){
  const packet=seedRequest(action,instanceId,child.pid);packet.body.input=action.startsWith('READ_')?{workspace_id:id(),body_sha256:'b'.repeat(64)}:{schema:'generated-transport-fixture-only'};
  const value=await client[method](packet);assert.equal(value.operation,action);assert.deepEqual(value.input,packet.body.input);
  await assert.rejects(client[method]({...packet,path:'/arbitrary'}),e=>e.reason==='INVALID_PAYLOAD');
  // Exact signed Host birth is verified by the mounted authenticated service,
  // not this transport-only echo fixture (real-PG foreign-Host test).
  await assert.rejects(client[method]({...packet,body:{...packet.body,host_instance_id:'malformed'}}),e=>e.reason==='INVALID_PAYLOAD');
  if(action.startsWith('READ_'))await assert.rejects(client[method]({...packet,body:{...packet.body,input:{...packet.body.input,capacity_evidence:{}}}}),e=>e.reason==='INVALID_PAYLOAD');
 }
 assert.equal((await stats()).calls,2);assert.equal((await client.drainPhysical()).cleanup_confirmed,true);
});
test('mixed-version and predescriptor IPC cannot silently fall back from v2 heartbeat to v1 or setup execution',async t=>{
 for(const mode of ['normal','capacity-minimal']){
  const {client,instanceId,child,stats}=await setup(t,mode);
  const packet=seedRequest('SERVICE_HEARTBEAT_V2',instanceId,child.pid);
  await assert.rejects(client.serviceHeartbeatV2(packet),e=>e.reason==='UNSUPPORTED_ACTION'&&e.effect_outcome==='NONE'&&e.automatic_retry_allowed===false);
  assert.equal((await stats()).calls,0);
 }
});

async function runCustody(t,client,{open=true}={}){
 const directory=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'native-ipc-run-custody-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const request=agentRequest(),binding={...request.binding,base_sha:'a'.repeat(40)};
 const journal=await createNativeRunCallbackJournal({directory,runId:request.binding.run_id,binding});
 const facet=open?await client.openAgentRunCustody({binding:request.binding,journal}):null;
 return{directory,request,facet,journal,write:()=>({...request,operation:'agent_send_message',args:{request_id:id(),target_agent_id:'agent_native-peer123',message:'SECRET_BODY_NOT_JOURNALED'}})};
}
async function waitAgent(child,runId){return new Promise(resolve=>{const listener=row=>{if(row?.schema==='test.agent-started'&&row.run_id===runId){child.off('message',listener);resolve();}};child.on('message',listener);});}
test('run facet includes initial CHECK, exact original job and validated settlement before response; no wire/body widening',async t=>{
 const {client,stats}=await setup(t),f=await runCustody(t,client);
 await assert.rejects(f.facet.agentOperation(f.write()),/INVALID_PAYLOAD/);assert.equal((await stats()).calls,0);
 await f.facet.agentOperation(f.request);
 await assert.rejects(f.facet.agentOperation({...f.request,job_binding:{...f.request.job_binding,job_id:id()}}),/INVALID_PAYLOAD/);
 await assert.rejects(f.facet.agentOperation({...f.request,binding:{...f.request.binding,run_id:id()}}),/INVALID_PAYLOAD/);
 await f.facet.agentOperation(f.write());const result=await f.facet.finish();
 assert.equal(result.state,'SCOPED_REQUESTS_JOINED');assert.equal(result.requests,2);assert.equal(result.all_effects_cleanup,'UNCONFIRMED');assert.equal(result.lineage,'LINEAGE_UNBOUND');
 assert.equal(client.snapshot().physical_inflight,0);assert.deepEqual(await readNativeRunCallbackJournal(f.directory),result);
 const records=[];for(const file of await fs.readdir(path.join(f.directory,'host-callback-custody')))records.push(await fs.readFile(path.join(f.directory,'host-callback-custody',file),'utf8'));
 assert.ok(records.every(text=>!text.includes('SECRET_BODY_NOT_JOURNALED')));assert.equal((await stats()).calls,2);
 await assert.rejects(f.facet.agentOperation(f.request));assert.equal((await stats()).calls,2);
});
test('two run facets share the original physical budget and one finishes without stealing the other request custody',async t=>{
 const {client,child,stats}=await setup(t,'held-agent',{maxInflight:2,timeoutMs:30,serverTimeoutMs:30}),a=await runCustody(t,client),b=await runCustody(t,client);
 await a.facet.agentOperation(a.request);await b.facet.agentOperation(b.request);await client.drainPhysical();
 const enteredA=waitAgent(child,a.request.binding.run_id),enteredB=waitAgent(child,b.request.binding.run_id);
 const wa=a.facet.agentOperation(a.write()),wb=b.facet.agentOperation(b.write());wa.catch(()=>{});wb.catch(()=>{});await Promise.all([enteredA,enteredB]);
 await assert.rejects(client.readLease(lease()),/INFLIGHT_LIMIT/);await assert.rejects(wa);await assert.rejects(wb);
 assert.equal(client.snapshot().physical_inflight,2);const doneA=a.facet.finish(),doneB=b.facet.finish();let bDone=false;doneB.then(()=>{bDone=true;});
 child.send({schema:'test.release-agent',run_id:a.request.binding.run_id});const result=await doneA;
 assert.equal(result.caller_unknown,1);assert.equal(bDone,false);assert.equal(client.snapshot().physical_inflight,1);
 child.send({schema:'test.release-agent',run_id:b.request.binding.run_id});assert.equal((await doneB).caller_unknown,1);assert.equal(client.snapshot().physical_inflight,0);assert.equal((await stats()).calls,4);
});
test('same-client reservation precedes durable fsync; a synchronous run fence proves UNSENT without replay',async t=>{
 const {client,stats}=await setup(t, 'normal',{maxInflight:1}),f=await runCustody(t,client);
 const target=path.join(f.directory,'host-callback-custody','0000000000000002.json'),gate=Promise.withResolvers(),entered=Promise.withResolvers(),original=fs.open;
 fs.open=async(...args)=>{const handle=await original(...args);if(args[0]===target){const sync=handle.sync.bind(handle);handle.sync=async()=>{entered.resolve();await gate.promise;return sync();};}return handle;};
 let pending;try{
  pending=f.facet.agentOperation(f.request);pending.catch(()=>{});await entered.promise;
  assert.equal(client.snapshot().physical_inflight,1);await assert.rejects(client.readLease(lease()),/INFLIGHT_LIMIT/);assert.equal((await stats()).calls,0);
  const fenced=f.facet.fence();gate.resolve();await fenced;await assert.rejects(pending,error=>error.effect_outcome==='NONE');
 }finally{gate.resolve();fs.open=original;await pending?.catch(()=>{});}
 const result=await f.facet.finish();assert.equal(result.unsent,1);assert.equal(result.requests,1);assert.equal((await stats()).calls,0);assert.equal(client.snapshot().physical_inflight,0);
});
test('intent write failure prevents send and retains HOLD without a fabricated candidate',async t=>{
 const {client,stats}=await setup(t),f=await runCustody(t,client);
 await fs.writeFile(path.join(f.directory,'host-callback-custody','0000000000000002.json'),'interrupted append');
 await assert.rejects(f.facet.agentOperation(f.request));assert.equal((await stats()).calls,0);assert.equal((await f.facet.finish()).state,'HOLD');
 assert.equal((await readNativeRunCallbackJournal(f.directory)).state,'HOLD');assert.equal(client.snapshot().physical_inflight,0);
});
test('a late OK cannot upgrade the persisted UNKNOWN caller after genuine earlier physical SETTLED',async t=>{
 const {client}=await setup(t,'late-agent-ok',{timeoutMs:30,serverTimeoutMs:1000}),f=await runCustody(t,client);
 await f.facet.agentOperation(f.request);await client.drainPhysical();
 await assert.rejects(f.facet.agentOperation(f.write()),error=>error.effect_outcome==='UNKNOWN');const result=await f.facet.finish();assert.equal(result.caller_unknown,1);
 await sleep(130);assert.deepEqual(await readNativeRunCallbackJournal(f.directory),result);assert.equal(result.state,'SCOPED_REQUESTS_JOINED');
});
test('actual callback promise remains owned after a public request settled and run dispatch was fenced',async t=>{
 const {client}=await setup(t),f=await runCustody(t,client),gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const callback=f.facet.trackCallback(async()=>{await f.facet.agentOperation(f.request);entered.resolve();await gate.promise;});await entered.promise;
 let done=false;const closing=f.facet.finish().then(value=>{done=true;return value;});await sleep(10);assert.equal(done,false);assert.equal(f.facet.snapshot().callbacks,1);
 gate.resolve();await callback;assert.equal((await closing).callbacks,1);await assert.rejects(f.facet.trackCallback(()=>{throw Error('must not execute');}),/CHANNEL_CLOSED/);
});

for(const mode of ['settlement-wrong-request_sha256','settlement-wrong-instance_id','settlement-wrong-host_pid',
 'settlement-wrong-request_id','settlement-missing','settlement-send-failed','agent-rollback-poison'])test(`run custody refuses durable release from ${mode}; existing shutdown can clean resources only`,async t=>{
 let witness=null;const f=await setup(t,mode,{timeoutMs:100,readShutdownSettlement:async()=>witness}),run=await runCustody(t,f.client);
 await run.facet.agentOperation(run.request).catch(()=>{});
 await assert.rejects(f.client.drainPhysical({wait:false}),/PHYSICAL_CLEANUP_UNCONFIRMED/);
 assert.equal(f.client.snapshot().physical_inflight,1);const finish=run.facet.finish();let done=false;finish.then(()=>{done=true;});await sleep(10);assert.equal(done,false);
 assert.notEqual((await readNativeRunCallbackJournal(run.directory)).state,'SCOPED_REQUESTS_JOINED');
 // Fixture's existing controller witness is intentionally cleanup-only. This
 // is NOT an OS-birth/PG/control proof and must never mint a scoped candidate.
 witness={schema:'metaengine.native-coding.host-shutdown-settlement.v1',instance_id:f.instanceId,host_pid:f.child.pid,cleanup_confirmed:true,authority_effect:false};
 const exited=new Promise(resolve=>f.child.once('exit',resolve));f.child.kill();await exited;await f.client.drainPhysical();
 const value=await finish;assert.equal(value.state,'HOLD');assert.equal(value.all_effects_cleanup,'UNCONFIRMED');assert.equal(value.lineage,'LINEAGE_UNBOUND');
 assert.equal(f.client.snapshot().physical_inflight,0);assert.equal((await readNativeRunCallbackJournal(run.directory)).state,'HOLD');
});
test('duplicate valid terminals are idempotent and sequential run history never truncates to response-cache size',async t=>{
 const f=await setup(t,'duplicate-settlement'),run=await runCustody(t,f.client);
 for(let n=0;n<280;n++){await run.facet.agentOperation(run.request);await f.client.drainPhysical();assert.equal(run.facet.snapshot().requests,0);}
 const value=await run.facet.finish();assert.equal(value.requests,280);assert.equal(value.records,845);assert.equal(value.state,'SCOPED_REQUESTS_JOINED');
 assert.deepEqual(await readNativeRunCallbackJournal(run.directory),value);assert.equal((await f.stats()).snapshot.completed,256);
});
test('failed child send is unknown-send, never UNSENT; no automatic repeat or late frame can mint release',async t=>{
 let witness=null;const f=await setup(t,'normal',{readShutdownSettlement:async()=>witness}),run=await runCustody(t,f.client),send=f.child.send;
 f.child.send=function(frame,...args){if(frame?.schema==='metaengine.native-coding.host-ipc.request.v1'){const callback=args.at(-1);queueMicrotask(()=>callback(Error('PRIVATE_SEND_SECRET')));return false;}return send.call(this,frame,...args);};
 await assert.rejects(run.facet.agentOperation(run.request),error=>error.reason==='SEND_FAILED'&&!error.message.includes('PRIVATE_SEND_SECRET'));
 f.child.send=send;assert.equal((await f.stats()).calls,0);assert.equal(f.client.snapshot().physical_inflight,1);
 const finish=run.facet.finish();witness={schema:'metaengine.native-coding.host-shutdown-settlement.v1',instance_id:f.instanceId,host_pid:f.child.pid,cleanup_confirmed:true,authority_effect:false};
 await f.client.drainPhysical();const value=await finish;assert.equal(value.unsent,0);assert.equal(value.state,'HOLD');
});
for(const failure of ['fsync-intent','fsync-terminal','fsync-candidate'])test(`actual per-run ${failure} failure is sanitized HOLD and does not resend`,async t=>{
 const f=await setup(t),run=await runCustody(t,f.client),original=fs.open;let failed=false;
 fs.open=async(...args)=>{const handle=await original(...args);if(String(args[0]).startsWith(path.join(run.directory,'host-callback-custody'))&&args[1]==='wx'){
  const write=handle.writeFile.bind(handle);let event;handle.writeFile=async bytes=>{event=JSON.parse(bytes).event;return write(bytes);};
  const sync=handle.sync.bind(handle);handle.sync=async()=>{if(event.kind===({'fsync-intent':'INTENT','fsync-terminal':'TERMINAL','fsync-candidate':'CANDIDATE'}[failure])){failed=true;throw Error('PRIVATE_DISK_SENTINEL');}return sync();};
 }return handle;};
 try{
  await run.facet.agentOperation(run.request).catch(error=>assert.ok(!error.message.includes('PRIVATE_DISK_SENTINEL')));
  const value=await run.facet.finish();assert.equal(failed,true);assert.equal(value.state,'HOLD');assert.equal(value.all_effects_cleanup,'UNCONFIRMED');
  assert.equal((await f.stats()).calls,failure==='fsync-intent'?0:1);assert.equal(f.client.snapshot().physical_inflight,0);
  // A read is structural only: even fully written bytes after a failed fsync
  // are NOT a final all-effects seal or evidence that a send did not occur.
  const read=await readNativeRunCallbackJournal(run.directory);assert.equal(read.all_effects_cleanup,'UNCONFIRMED');assert.equal(read.authority_effect,false);
 }finally{fs.open=original;}
});

test('underlying bridge counterfactual (publication unqualified) bindRun CHECK and broker callbacks join the same real IPC run facet after transport closes',async t=>{
 const f=await setup(t,'bridge-held',{timeoutMs:75}),run=await runCustody(t,f.client,{open:false}),brokerModule=await inMemoryNativeBroker(t);
 let registration,broker;
 const source=await fs.readFile(new URL('../src/native-coding-agent-run-bridge.mjs',import.meta.url),'utf8');
 const prepare=new Function('requireNativeRunCallbackPublication','createHash','createNativeCodingAgentMcpBroker','nativeCodingAgentMcpIntentBodySha256','createNativeCodingAgentMcpLaunch',
  'validateNativeCodingAgentHostRequest','canonical',source.replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')+'\nreturn prepareNativeCodingAgentRunBridge;')
  (()=>{},createHash,async options=>{broker=await brokerModule.createNativeCodingAgentMcpBroker({...options,endpoint:process.platform==='win32'?undefined:'/fixture/in-memory-only',timeoutMs:500});return broker;},
   nativeCodingAgentMcpIntentBodySha256,async options=>{registration=options.registration;return{fixture_only:true};},validateNativeCodingAgentHostRequest,nativeCodingCanonicalJson);
 const binding={...run.request.binding,base_sha:'a'.repeat(40)},expiry=new Date(Date.now()+60000).toISOString();
 const authorization={...binding,authorized:true,trust_namespace:'LOCAL_OPERATOR_QA',permit_id:id(),owner_epoch:1,user_sid:'S-1-5-21-111-1001',worktree_path:'/fixture/worktree'};
 const permit={...authorization,revoked:false,expires_at:expiry,worktree:{path:authorization.worktree_path,base_sha:binding.base_sha},artifact:{cli_executable_sha256:run.request.job_binding.executable_sha256}};
 const bridge=await prepare({ownPostgres:f.client,runId:binding.run_id,binding,permit,authorization,deadlineAt:expiry,pins:{},callbackJournal:run.journal});
 t.after(()=>bridge.close());
 await bridge.bindRun({...run.request.job_binding,user_sid:permit.user_sid,tree_control_bound:true,started_suspended:true,job_bound_before_resume:true});
 const tool=await brokerModule.connectNativeCodingAgentMcpBroker(registration);t.after(()=>tool.close());
 const entered=waitAgent(f.child,binding.run_id),write=tool.invoke('agent_send_message',run.write().args);write.catch(()=>{});await entered;
 assert.equal((await f.stats()).calls,3,'initial bind CHECK + invocation CHECK + actual operation');
 await bridge.close();await assert.rejects(write);assert.equal(broker.snapshot().retained_callbacks,1);
 const joined=bridge.drainCallbacks();assert.equal(bridge.drainCallbacks(),joined);let done=false;joined.then(()=>{done=true;});
 await sleep(100);assert.equal(done,false);assert.equal(broker.snapshot().retained_callbacks,0,'public IPC timeout joined JS handler only');
 assert.equal(f.client.snapshot().physical_inflight,1,'Host SQL still owned after broker callback returned');
 f.child.send({schema:'test.release-agent',run_id:binding.run_id});const value=await joined;
 assert.equal(value.state,'SCOPED_REQUESTS_JOINED');assert.equal(value.requests,3);assert.equal(value.caller_unknown,1);assert.equal(value.callbacks,2);
 assert.equal(value.all_effects_cleanup,'UNCONFIRMED');assert.deepEqual(await readNativeRunCallbackJournal(run.directory),value);
});

test('actual Host close aborts protected ACL observation before joining it; no pre-stop callback cycle',async t=>{
 const f=await setup(t,'acl-rejection-held',{timeoutMs:1000,serverTimeoutMs:1000});
 const event=schema=>new Promise(resolve=>{const listener=m=>{if(m?.schema===schema){f.child.off('message',listener);resolve();}};f.child.on('message',listener);});
 const started=event('test.acl-started'),aborted=event('test.acl-aborted'),read=f.client.readScope();read.catch(()=>{});await started;
 assert.equal((await f.stats()).snapshot.inflight,1);let drained=false;const physical=f.client.drainPhysical().then(()=>{drained=true;});
 f.child.send({schema:'test.close-server'});await aborted;await assert.rejects(read);assert.equal(drained,false);
 assert.equal((await f.stats()).snapshot.inflight,1,'original native observation still owned after public close');
 f.child.send({schema:'test.release-acl'});await physical;assert.equal((await f.stats()).snapshot.inflight,0);
});
