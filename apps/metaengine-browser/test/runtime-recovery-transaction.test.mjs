import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createRuntimeRecoveryTransaction} from '../src/runtime-recovery-transaction.mjs';
import {createSameExecutableRuntimeRecoveryAdapter,readRuntimeRecoveryProcess} from '../src/runtime-recovery-process-adapter.mjs';

const {durableWriteJson}=createRequire(import.meta.url)('../src/durable-json-file.cjs');
const protectedFixture=async()=>({owner_dacl_verified:true});
const drainReceipt=()=>({schema:'metaengine.managed-runtime-drain.v1',cleanup_confirmed:true,
  interrupted_effects_reconciled:false,automatic_retry_allowed:false,authority_effect:false});
const hash=char=>char.repeat(64);
function generation() {
  const launch_nonce=randomUUID(),instance_id=randomUUID(),host_pid=321;
  return {schema:'metaengine.browser.runtime-host-generation.v1',launch_nonce,host_pid,instance_id,ever_ready:true,
    exited:false,stopping:false,terminal:null,terminal_rejected:false,transport_failed:false,cleanup_confirmed:false,health_witness:null,authority_effect:false};
}
function failed(before) {
  const {launch_nonce,host_pid,instance_id}=before;
  return {...before,exited:true,cleanup_confirmed:true,
    terminal:{schema:'compute.runtime-host-terminal.v1',launch_nonce,host_pid,instance_id,state:'STOPPED',children_stopped:true,
      ownership_released:true,reason:'runtime_health_failed',authority_effect:false},
    health_witness:{schema:'metaengine.browser.runtime-recovery-health-witness.v1',launch_nonce,host_pid,instance_id,
      bundle_sha256:hash('c'),status_sha256:hash('e'),stopped_at:new Date().toISOString(),
      failure:{schema:'metaengine.client-state.health-failure.v1',code:'health_timeout',component:'edge',consecutive_failures:3,http_status:null,authority_effect:false},authority_effect:false}};
}
async function fixture(t,{writeJson=durableWriteJson}={}) {
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-recovery-transaction-')));
  t.after(async()=>{assert.ok(directory.startsWith(await fs.realpath(os.tmpdir())));await fs.rm(directory,{recursive:true,force:true});});
  let observed=generation(),clock=Date.now(),gate={schema:'metaengine.browser.runtime-recovery-gate.v1',state:'OPEN',epoch:0},dispatches=0;
  let browser={schema:'metaengine.browser.runtime-recovery-browser.v1',pid:12345,created_100ns:'134000000000000000',
    executable:process.execPath,executable_sha256:hash('f'),authority_effect:false};
  let binding={schema:'metaengine.browser.runtime-recovery-binding.v1',package_version:'0.7.0-dev.1107139874588.1',
    owner_sha256:hash('a'),asar_sha256:hash('b'),bundle_sha256:hash('c'),bundle_manifest_sha256:hash('d'),pg_identity_sha256:hash('e'),
    normal_bootstrap_ready:true,host:{pid:observed.host_pid,instance_id:observed.instance_id,launch_nonce:observed.launch_nonce}};
  let drain=drainReceipt,request=async()=>{dispatches++;};
  const adapter={capture:async()=>structuredClone(browser),readProcess:async pid=>({schema:'metaengine.browser.runtime-recovery-process.v1',state:'ABSENT',pid,authority_effect:false}),
    requestRelaunch:async(...args)=>request(...args)};
  const app={getPath:kind=>{assert.equal(kind,'userData');return directory;}};
  const options=()=>({app,adapter,readGeneration:async()=>structuredClone(observed),readBinding:async()=>structuredClone(binding),
    readGate:async()=>({...gate}),drain:async()=>drain(),verifyStorage:protectedFixture,now:()=>clock,writeJson});
  const fresh=()=>createRuntimeRecoveryTransaction(options());
  const transaction=fresh();
  return {transaction,fresh,directory,adapter,options,app,
    get generation(){return observed;},set generation(value){observed=value;},get binding(){return binding;},set binding(value){binding=value;},
    get browser(){return browser;},set browser(value){browser=value;},get gate(){return gate;},set gate(value){gate=value;},
    set drain(value){drain=value;},set request(value){request=value;},get dispatches(){return dispatches;},
    advance:ms=>{clock+=ms;},fail:()=>{observed=failed(observed);binding.normal_bootstrap_ready=false;binding.host=null;},
    successor:()=>{browser={...browser,pid:browser.pid+1,created_100ns:String(BigInt(browser.created_100ns)+10000000n)};
      observed=generation();binding.normal_bootstrap_ready=true;binding.host={pid:observed.host_pid,instance_id:observed.instance_id,launch_nonce:observed.launch_nonce};},
  };
}

test('durable prepare/backoff/barrier makes one effect, and only a fresh normal bootstrap can confirm it',async t=>{
  const f=await fixture(t),tx=f.transaction;
  await tx.arm();f.fail();const prepared=await tx.prepare();
  assert.equal(prepared.state,'PREPARED');assert.equal(prepared.successor_confirmed,false);
  assert.equal((await tx.dispatch(prepared.ticket_id)).reason,'BACKOFF_PENDING');assert.equal(f.dispatches,0);
  f.advance(5000);
  // Await BOTH contenders before readback. Promise.all rejects as soon as the
  // loser sees the lock, while the winner can still legitimately own it.
  const contenders=await Promise.allSettled([tx.dispatch(prepared.ticket_id),f.fresh().dispatch(prepared.ticket_id)]);
  for(const result of contenders)if(result.status==='rejected')assert.match(result.reason.message,/transaction_locked/);
  const results=[...contenders.filter(result=>result.status==='fulfilled').map(result=>result.value),await tx.read()];
  assert.equal(f.dispatches,1);assert.ok(results.some(result=>['REQUESTED','DISPATCH_INTENT'].includes(result.state)));
  await assert.rejects(tx.acknowledgeSuccessor(prepared.ticket_id),/successor_bootstrap_unproven/);
  f.successor();const successor=f.fresh();const confirmed=await successor.acknowledgeSuccessor(prepared.ticket_id);
  assert.equal(confirmed.state,'CONFIRMED');assert.equal(confirmed.successor_confirmed,true);
  assert.notEqual(confirmed.old_instance_id,confirmed.new_instance_id);
  assert.equal((await successor.acknowledgeSuccessor(prepared.ticket_id)).reason,'ALREADY_RECORDED');assert.equal(f.dispatches,1);
});

test('a crash or lost durability acknowledgement at the effect barrier never permits blind dispatch again',async t=>{
  let lose=true;
  const f=await fixture(t,{writeJson:async(file,value,options)=>{
    const result=await durableWriteJson(file,value,options);
    if(lose&&value.active.state==='DISPATCH_INTENT'){lose=false;throw Error('fixture_lost_fsync_ack');}
    return result;
  }});
  await f.transaction.arm();f.fail();const prepared=await f.transaction.prepare();f.advance(5000);
  await assert.rejects(f.transaction.dispatch(prepared.ticket_id),/fixture_lost_fsync_ack/);
  assert.equal(f.dispatches,0);
  const restarted=f.fresh();assert.equal((await restarted.read()).state,'DISPATCH_INTENT');
  assert.equal((await restarted.dispatch(prepared.ticket_id)).reason,'EFFECT_ALREADY_ATTEMPTED');
  assert.equal((await restarted.prepare()).reason,'PRIOR_EFFECT_UNRESOLVED');assert.equal(f.dispatches,0);
});

test('unknown relaunch ACK survives a new coordinator and cannot be retried, but physical successor readback can confirm',async t=>{
  const f=await fixture(t);let calls=0;
  f.request=async()=>{calls++;throw Error('fixture_after_effect_ack_lost');};
  await f.transaction.arm();f.fail();const prepared=await f.transaction.prepare();f.advance(5000);
  assert.equal((await f.transaction.dispatch(prepared.ticket_id)).state,'AMBIGUOUS');assert.equal(calls,1);
  assert.equal((await f.fresh().dispatch(prepared.ticket_id)).reason,'EFFECT_ALREADY_ATTEMPTED');assert.equal(calls,1);
  f.successor();assert.equal((await f.fresh().acknowledgeSuccessor(prepared.ticket_id)).state,'CONFIRMED');assert.equal(calls,1);
});

test('cross-generation storm budget persists, with 5s then 30s backoff and at most two attempts per ten minutes',async t=>{
  const f=await fixture(t);
  await f.transaction.arm();f.fail();const first=await f.transaction.prepare();f.advance(5000);await f.transaction.dispatch(first.ticket_id);
  f.successor();let tx=f.fresh();await tx.acknowledgeSuccessor(first.ticket_id);await tx.arm();f.fail();
  const second=await tx.prepare();
  assert.equal(second.not_before_ms-first.not_before_ms,30000);
  f.advance(29999);assert.equal((await tx.dispatch(second.ticket_id)).reason,'BACKOFF_PENDING');f.advance(1);await tx.dispatch(second.ticket_id);
  f.successor();tx=f.fresh();await tx.acknowledgeSuccessor(second.ticket_id);await tx.arm();f.fail();
  assert.equal((await tx.prepare()).reason,'STORM_BUDGET_EXHAUSTED');assert.equal(f.dispatches,2);
});

test('Owner/ASAR/PG drift, closed gate, missing worker drain and deliberate cancellation all deny the effect',async t=>{
  for(const key of ['owner_sha256','asar_sha256','bundle_sha256','bundle_manifest_sha256','pg_identity_sha256']){
    await t.test(key,async t=>{
      const f=await fixture(t);await f.transaction.arm();f.fail();const prepared=await f.transaction.prepare();f.advance(5000);
      f.binding={...f.binding,[key]:hash('9')};
      await assert.rejects(f.transaction.dispatch(prepared.ticket_id),/continuity_binding_changed/);assert.equal(f.dispatches,0);
    });
  }
  await t.test('gate epoch changes',async t=>{
    const f=await fixture(t);await f.transaction.arm();f.fail();const p=await f.transaction.prepare();f.advance(5000);f.gate={...f.gate,epoch:1};
    await assert.rejects(f.transaction.dispatch(p.ticket_id),/gate_closed/);assert.equal(f.dispatches,0);
  });
  await t.test('unconfirmed workers',async t=>{
    const f=await fixture(t);await f.transaction.arm();f.fail();f.drain=()=>({...drainReceipt(),cleanup_confirmed:false});
    await assert.rejects(f.transaction.prepare(),/worker_drain_unconfirmed/);assert.equal(f.dispatches,0);
  });
  await t.test('cancel after prepare',async t=>{
    const f=await fixture(t);await f.transaction.arm();f.fail();const p=await f.transaction.prepare();f.advance(5000);f.transaction.cancel();
    await assert.rejects(f.transaction.dispatch(p.ticket_id),/gate_closed/);assert.equal(f.dispatches,0);
  });
});

test('successor acknowledgement refuses a ticket that never crossed its effect barrier',async t=>{
  const f=await fixture(t);await f.transaction.arm();f.fail();const p=await f.transaction.prepare();f.successor();
  await assert.rejects(f.fresh().acknowledgeSuccessor(p.ticket_id),/effect_barrier_not_crossed/);
});

test('successor readback rejects a live old Browser, unchanged Host, altered PG and missing normal bootstrap',async t=>{
  const f=await fixture(t);await f.transaction.arm();f.fail();const prepared=await f.transaction.prepare();f.advance(5000);
  await f.transaction.dispatch(prepared.ticket_id);
  const oldBrowser={...f.browser},oldHost={...f.generation};f.successor();
  f.adapter.readProcess=async pid=>({schema:'metaengine.browser.runtime-recovery-process.v1',state:'PRESENT',pid,
    created_100ns:oldBrowser.created_100ns,executable:oldBrowser.executable,authority_effect:false});
  await assert.rejects(f.fresh().acknowledgeSuccessor(prepared.ticket_id),/old_browser_exit_unproven/);
  f.adapter.readProcess=async pid=>({schema:'metaengine.browser.runtime-recovery-process.v1',state:'ABSENT',pid,authority_effect:false});
  const goodBinding={...f.binding,host:{...f.binding.host}};
  for(const patch of [{host:{pid:oldHost.host_pid,instance_id:oldHost.instance_id,launch_nonce:oldHost.launch_nonce}},
    {pg_identity_sha256:hash('9')},{normal_bootstrap_ready:false}]){
    f.binding={...goodBinding,...patch};await assert.rejects(f.fresh().acknowledgeSuccessor(prepared.ticket_id),/successor_bootstrap_unproven/);
  }
  f.binding=goodBinding;assert.equal((await f.fresh().acknowledgeSuccessor(prepared.ticket_id)).state,'CONFIRMED');
});

test('real inert process handoff crosses the durable barrier once, survives lost spawn ACK and reconciles successor birth without replay',{
  skip:process.platform!=='win32'?'Physical handoff requires the Windows kernel birth reader':false,
},async t=>{
  const f=await fixture(t),children=[];
  async function inertBrowser() {
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true,shell:false});
    children.push(child);
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    return child;
  }
  t.after(async()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}});
  let active=await inertBrowser(),physicalDispatches=0;
  const hasher=createHash('sha256');for await(const chunk of createReadStream(process.execPath))hasher.update(chunk);
  const executable_sha256=hasher.digest('hex');
  f.adapter.capture=async()=>{
    const value=await readRuntimeRecoveryProcess(active.pid);assert.equal(value.state,'PRESENT');
    return {schema:'metaengine.browser.runtime-recovery-browser.v1',pid:value.pid,created_100ns:value.created_100ns,
      executable:value.executable,executable_sha256,authority_effect:false};
  };
  f.adapter.readProcess=readRuntimeRecoveryProcess;
  f.request=async ticket=>{
    assert.equal((await f.fresh().read()).state,'DISPATCH_INTENT','real spawn must follow independently read durable intent');
    assert.match(ticket,/^[a-f0-9-]{36}$/);physicalDispatches++;
    const previous=active;active=await inertBrowser();
    const ended=new Promise(resolve=>previous.once('exit',resolve));previous.kill();await ended;
    throw Error('fixture_process_spawned_ack_lost');
  };
  // Owner/artifact/PG/bootstrap callbacks and Host health here are generated
  // test fixtures. Browser-like children, birth/absence reads and spawn are real;
  // this is not an installed Electron/PG or useful-work qualification.
  await f.transaction.arm();f.fail();const prepared=await f.transaction.prepare();f.advance(5000);
  assert.equal((await f.transaction.dispatch(prepared.ticket_id)).state,'AMBIGUOUS');
  const restarted=f.fresh();assert.equal((await restarted.dispatch(prepared.ticket_id)).reason,'EFFECT_ALREADY_ATTEMPTED');
  f.successor();const confirmed=await restarted.acknowledgeSuccessor(prepared.ticket_id);
  assert.equal(confirmed.state,'CONFIRMED');assert.equal(physicalDispatches,1);
  const persisted=JSON.parse(await fs.readFile(path.join(f.directory,'runtime-recovery-v1','recovery-journal.json'),'utf8'));
  assert.notEqual(persisted.active.origin_browser.pid,persisted.active.new_browser.pid);
  assert.notEqual(persisted.active.origin_browser.created_100ns,persisted.active.new_browser.created_100ns);
  assert.equal(persisted.active.origin_browser.executable_sha256,persisted.active.new_browser.executable_sha256);
});

test('actual native kernel reader pins an inert child birth and proves its later absence; private Electron adapter binds own EXE and exact ticket args',{
  skip:process.platform!=='win32'?'Physical birth/absence qualification requires the Windows kernel reader':false,
},async t=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true,shell:false});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  const physical=await readRuntimeRecoveryProcess(child.pid);
  assert.equal(physical.state,'PRESENT');assert.equal(physical.pid,child.pid);
  assert.match(physical.created_100ns,/^[1-9][0-9]{16,18}$/);
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;
  assert.equal((await readRuntimeRecoveryProcess(child.pid)).state,'ABSENT');

  // Fake Electron app callbacks exercise the adapter contract without quitting
  // this test process; kernel read and executable hashing themselves are real.
  const calls=[];
  const adapter=createSameExecutableRuntimeRecoveryAdapter({beforeRelaunch:async value=>{assert.match(value,/^[a-f0-9-]{36}$/);},
    app:{isPackaged:true,getPath:kind=>{assert.equal(kind,'exe');return process.execPath;},
    relaunch:options=>calls.push(options),quit:()=>calls.push('quit')}});
  const own=await adapter.capture(),ticket=randomUUID();
  assert.equal(own.pid,process.pid);assert.match(own.executable_sha256,/^[a-f0-9]{64}$/);
  await adapter.requestRelaunch(ticket,own);
  assert.deepEqual(calls,[{execPath:own.executable,args:['--metaengine-runtime-recovery='+ticket]},'quit']);
  await assert.rejects(adapter.requestRelaunch(ticket,{...own,created_100ns:'134000000000000001'}),/relaunch_binding_changed/);
  assert.equal(calls.length,2);
});

test('the native recovery reader refuses invalid PIDs before querying a process on every platform',async()=>{
  for(const pid of [null,0,-1,1.5,'1',0x80000000,Number.NaN])
    await assert.rejects(readRuntimeRecoveryProcess(pid),{message:'runtime_recovery_process_query_invalid'});
});

test('non-Windows native recovery refuses even a valid current PID rather than fabricating Windows birth evidence',{
  skip:process.platform==='win32'?'Non-Windows refusal contract':false,
},async()=>{
  await assert.rejects(readRuntimeRecoveryProcess(process.pid),{message:'runtime_recovery_process_query_invalid'});
});

test('portable adapter contract binds private process readback and exact ticket args without qualifying a native kernel',async t=>{
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-recovery-adapter-')));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const executable=path.join(directory,'fixture-browser.exe');await fs.writeFile(executable,'generated adapter fixture');
  const calls=[],tickets=[],reads=[];
  let physical={schema:'metaengine.browser.runtime-recovery-process.v1',state:'PRESENT',pid:process.pid,
    created_100ns:'134000000000000000',executable,authority_effect:false};
  const adapter=createSameExecutableRuntimeRecoveryAdapter({
    app:{isPackaged:true,getPath:kind=>{assert.equal(kind,'exe');return executable;},
      relaunch:value=>calls.push(value),quit:()=>calls.push('quit')},
    beforeRelaunch:async ticket=>tickets.push(ticket),
    readProcess:async pid=>{reads.push(pid);return {...physical};},
  });
  const own=await adapter.capture(),ticket=randomUUID();
  assert.equal(own.executable_sha256,createHash('sha256').update('generated adapter fixture').digest('hex'));
  assert.equal(own.pid,process.pid);assert.equal(own.authority_effect,false);
  const requested=await adapter.requestRelaunch(ticket,own);
  assert.deepEqual(calls,[{execPath:executable,args:['--metaengine-runtime-recovery='+ticket]},'quit']);
  assert.deepEqual(tickets,[ticket]);assert.ok(reads.every(pid=>pid===process.pid));
  assert.equal(requested.successor_ready,false);assert.equal(requested.automatic_retry_allowed,false);assert.equal(requested.authority_effect,false);
  await assert.rejects(adapter.requestRelaunch('not-a-ticket',own),/relaunch_binding_changed/);
  await assert.rejects(adapter.requestRelaunch(ticket,{...own,created_100ns:'134000000000000001'}),/relaunch_binding_changed/);
  physical={...physical,pid:process.pid+1};await assert.rejects(adapter.capture(),/own_process_unbound/);
  assert.equal(calls.length,2);
});

for (const change of ['cancel', 'gate-epoch']) test(`successor confirmation rejects ${change} during physical predecessor readback`, async t => {
  const f = await fixture(t);
  await f.transaction.arm(); f.fail();
  const prepared = await f.transaction.prepare(); f.advance(5000);
  await f.transaction.dispatch(prepared.ticket_id);
  f.successor();
  const successor = f.fresh();
  f.adapter.readProcess = async pid => {
    if (change === 'cancel') successor.cancel();
    else f.gate = { ...f.gate, epoch: f.gate.epoch + 1 };
    return { schema: 'metaengine.browser.runtime-recovery-process.v1', state: 'ABSENT', pid, authority_effect: false };
  };
  await assert.rejects(successor.acknowledgeSuccessor(prepared.ticket_id), /gate_closed/);
  assert.equal((await f.fresh().read()).state, 'REQUESTED', 'invalidated readback cannot persist CONFIRMED');
  assert.equal(f.dispatches, 1, 'readback never replays the relaunch');
});
