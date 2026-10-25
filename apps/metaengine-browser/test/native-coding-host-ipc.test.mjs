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

async function setup(t,mode='normal',{timeoutMs=1000,maxInflight=16,serverMaxInflight=16,serverTimeoutMs=1000}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-private-ipc-'));
  const script=path.join(root,'child.mjs'),instanceId=id();
  await fs.writeFile(script,`
import {createNativeCodingHostIpcServer} from ${JSON.stringify(serverUrl)};
const mode=process.env.METAENGINE_IPC_TEST_MODE;let calls=0,protocolErrors=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const operations={
 READ_SCOPE:async()=>{const n=++calls;if(mode==='delayed-read')await delay(80);return {call_count:n};},
 READ_LEASE:async value=>{++calls;if(mode==='out-of-order')await delay(value.lease_generation===1?80:5);return value;},
 REGISTER_PROVIDER:async value=>{++calls;if(mode==='throw-write')throw Error('postgresql://must-never-leak/private; raw SQL failure');return {registered:true,schema:value.descriptor.payload.schema};},
 READ_EXECUTION:async value=>({state:'RESERVED',scope:value.scope}),
 RESERVE_EXECUTION:async value=>{++calls;if(mode==='exit-write')process.exit(19);if(mode==='slow-write')await delay(180);return {state:'RESERVED',scope:value.scope};},
 ADVANCE_EXECUTION:async value=>{++calls;return {state:value.transition.to,has_job_proof:!!value.transition.job_proof,has_result_receipt:!!value.transition.result_receipt};},
 RECONCILE_PROJECT:async value=>{++calls;if(mode==='throw-write')throw Error('checkpoint_unknown');return {project_id:value.project_id,state:'CHECKPOINTED_PENDING_COMMIT'};},
 READ_PROJECT_CHECKPOINT:async value=>({project_id:value.project_id,state:'CHECKPOINTED_PENDING_COMMIT'}),
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
  await assert.rejects(client.reserveExecution(scope()),error=>['CHILD_EXIT','CHANNEL_CLOSED'].includes(error.reason)
    &&error.effect_outcome==='UNKNOWN'&&error.automatic_retry_allowed===false);
  assert.equal(client.snapshot().closed,true);assert.equal(client.snapshot().inflight,0);
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
