import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reconcileAbandonedAttachedRuntimeLock, runtimeHostPidState, runtimeHostTcpPortState } from './runtime-host-orphan-reconciliation.mjs';

const SHA='a'.repeat(64);
const oldPid=19551001, apiPid=19551002, edgePid=19551003;
const lockName='runtime-host-lock.json',statusName='runtime-instance.json',gateName='runtime-host-recovery-gate.json';

async function fixture(t,options={}){
  const state=await mkdtemp(path.join(os.tmpdir(),'metaengine-orphan-reconcile-'));
  t.after(()=>rm(state,{recursive:true,force:true}));
  const config={postgres_mode:'attached',api_role_mode:'direct',state_directory:state,
    expected_bundle_sha256:SHA,api_port:25432,edge_port:25433,
    database_url:'postgresql://fixture:private@127.0.0.1:25434/fixture'};
  const lock={schema:'compute.runtime-host-lock.v1',pid:oldPid,owner_nonce:randomUUID()};
  const status={schema:'metaengine.client-state.runtime-status.v1',state:'READY',runtime_ready:true,
    state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,automatic_cloud_fallback:false,
    host_pid:oldPid,bundle_sha256:SHA,instance_id:randomUUID(),
    endpoint:'http://127.0.0.1:25433/a2-browser-native-supervisor-v1',
    postgres_mode:'attached',api_role_mode:'direct',
    children:[{name:'api',pid:apiPid},{name:'edge',pid:edgePid}],authority_effect:false};
  Object.assign(config,options.config);
  Object.assign(lock,options.lock);
  Object.assign(status,options.status);
  const lockPath=path.join(state,lockName),statusPath=path.join(state,statusName);
  const originalLock=JSON.stringify(lock)+'\n',originalStatus=JSON.stringify(status)+'\n';
  await writeFile(lockPath,originalLock,{flag:'wx'});
  await writeFile(statusPath,originalStatus,{flag:'wx'});
  const seen={pids:[],ports:[]};
  const dependencies={
    pidState:async pid=>{seen.pids.push(pid);return 'ABSENT';},
    portState:async port=>{seen.ports.push(port);return port===25434?'PRESENT':'ABSENT';},
    delay:async()=>{},
  };
  return {state,config,lock,status,lockPath,statusPath,originalLock,originalStatus,seen,dependencies};
}
const doRecover=(f,deps={})=>reconcileAbandonedAttachedRuntimeLock({config:f.config,...f.dependencies,...deps});
const expectedFailure=async(f,reason,deps={})=>{
  await assert.rejects(doRecover(f,deps),new RegExp(reason));
  assert.equal(await readFile(f.lockPath,'utf8'),f.originalLock);
  assert.equal(await readFile(f.statusPath,'utf8'),f.originalStatus);
  assert.deepEqual((await readdir(f.state)).sort(),[lockName,statusName].sort());
};

test('exact departed attached host moves lock to unique quarantine, preserves bytes and never alters status/DB',async t=>{
  const f=await fixture(t);
  const receipt=await doRecover(f);
  assert.equal(receipt.state,'ORPHAN_QUARANTINED');
  assert.equal(receipt.prior_host_pid,oldPid);
  assert.equal(receipt.old_lock_preserved,true);
  assert.equal(receipt.postgres_not_stopped,true);
  assert.equal(receipt.task_effect_replayed,false);
  assert.equal(receipt.automatic_effect_retry_allowed,false);
  assert.equal(receipt.authority_effect,false);
  assert.match(path.basename(receipt.quarantine_path),/^runtime-host-lock\.orphan-[a-f0-9-]+\.json$/);
  assert.equal(await readFile(receipt.quarantine_path,'utf8'),f.originalLock);
  assert.equal(await readFile(f.statusPath,'utf8'),f.originalStatus);
  await assert.rejects(lstat(f.lockPath),{code:'ENOENT'});
  await assert.rejects(lstat(path.join(f.state,gateName)),{code:'ENOENT'});
  assert.deepEqual(f.seen.pids,[oldPid,apiPid,edgePid,oldPid,apiPid,edgePid]);
  assert.deepEqual(f.seen.ports,[25432,25433,25434,25432,25433,25434]);
});

test('interrupted startup reports missing custody without probing, moving or rewriting the old owner',async t=>{
  const f=await fixture(t,{status:{state:'STARTING',runtime_ready:false,children:undefined,
    instance_id:undefined,endpoint:undefined,postgres_mode:undefined,api_role_mode:undefined}});
  await expectedFailure(f,'recovery_startup_custody_missing');
  assert.deepEqual(f.seen,{pids:[],ports:[]});
});

test('STARTING with a mismatched host or bundle never receives an owner-specific recovery diagnosis',async t=>{
  for(const status of [{host_pid:20000111},{bundle_sha256:'b'.repeat(64)}]){
    const f=await fixture(t,{status:{state:'STARTING',runtime_ready:false,...status}});
    await expectedFailure(f,'recovery_lock_status_not_attested');
    assert.deepEqual(f.seen,{pids:[],ports:[]});
  }
});

test('never reclaims while old host, either child, or any API/edge endpoint might still exist',async t=>{
  for(const [kind,pid,port] of [
    ['host_alive',oldPid,null],['api_alive',apiPid,null],['edge_unknown',edgePid,null],
    ['api_port_busy',null,25432],['edge_port_unknown',null,25433],['pg_missing',null,25434],
  ]){
    await t.test(kind,async t=>{
      const f=await fixture(t);
      await expectedFailure(f,/pg_/.test(kind)?'attached_postgres_not_live':pid?'process_presence_unresolved':'api_edge_presence_unresolved',{
        pidState:async p=>p===pid?(kind==='edge_unknown'?'UNKNOWN':'PRESENT'):'ABSENT',
        portState:async p=>p===port?(kind==='edge_port_unknown'?'UNKNOWN':kind==='pg_missing'?'ABSENT':'PRESENT'):(p===25434?'PRESENT':'ABSENT'),
      });
    });
  }
});

test('never reclaims an owned cluster, incoherent lock/status, untrusted paths or malformed input',async t=>{
  for(const [name,updates,reason] of [
    ['owned',{config:{postgres_mode:'owned'}},'attached_mode_required'],
    ['status_mismatched_pid',{status:{host_pid:20000111}},'lock_status_not_attested'],
    ['status_wrong_bundle',{status:{bundle_sha256:'b'.repeat(64)}},'lock_status_not_attested'],
    ['status_not_ready',{status:{state:'FAILED',runtime_ready:false}},'lock_status_not_attested'],
    ['status_false_pg',{status:{postgres_mode:'owned'}},'lock_status_not_attested'],
    ['status_endpoint_mismatch',{status:{endpoint:'http://127.0.0.1:24444/a2-browser-native-supervisor-v1'}},'lock_status_not_attested'],
    ['children_duplicate',{status:{children:[{name:'api',pid:apiPid},{name:'api',pid:edgePid}]}},'lock_status_not_attested'],
    ['lock_unknown_schema',{lock:{schema:'unknown.lock.v1'}},'lock_status_not_attested'],
    ['lock_extra_field',{lock:{operator_grant:true}},'lock_status_not_attested'],
    ['config_db_endpoint',{config:{database_url:'postgres://fixture@remote.example:25434/fixture'}},'db_endpoint_invalid'],
  ]){
    await t.test(name,async t=>{
      const f=await fixture(t,updates);
      await expectedFailure(f,reason);
    });
  }
});

test('concurrent claimers never move lock twice; duplicate recovery gate blocks the second contender',async t=>{
  const f=await fixture(t);
  let releaseFirst;
  let entered;
  const enteredPromise=new Promise(resolve=>{entered=resolve});
  const wait=new Promise(resolve=>{releaseFirst=resolve});
  const first=doRecover(f,{delay:async()=>{entered();await wait;}});
  await enteredPromise;
  await assert.rejects(doRecover(f),/recovery_gate_already_exists/);
  assert.equal(await readFile(f.lockPath,'utf8'),f.originalLock);
  releaseFirst();
  const result=await first;
  assert.equal((await readdir(f.state)).filter(n=>n.startsWith('runtime-host-lock.orphan-')).length,1);
  assert.equal(await readFile(result.quarantine_path,'utf8'),f.originalLock);
});

test('lock mutation between double-checks fails closed without moving altered lock',async t=>{
  const f=await fixture(t);
  const changed={...f.lock,owner_nonce:randomUUID()};
  const bytes=JSON.stringify(changed)+'\n';
  await assert.rejects(doRecover(f,{delay:()=>writeFile(f.lockPath,bytes)}),/recovery_evidence_changed/);
  assert.equal(await readFile(f.lockPath,'utf8'),bytes);
  assert.equal(await readFile(f.statusPath,'utf8'),f.originalStatus);
  await assert.rejects(lstat(path.join(f.state,gateName)),{code:'ENOENT'});
  assert.equal((await readdir(f.state)).filter(n=>n.startsWith('runtime-host-lock.orphan-')).length,0);
});

test('ambiguous rename result leaves recovery gate durable even after quarantine was physically moved', async t=>{
  const f=await fixture(t);
  let moved=false;
  const fs=await import('node:fs/promises');
  await assert.rejects(doRecover(f,{renameLock:async (oldPath,newPath)=>{
    await fs.rename(oldPath,newPath);
    moved=true;
    throw new Error('synthetic_after_rename_unknown_effect');
  }}),/synthetic_after_rename_unknown_effect/);
  assert.equal(moved,true);
  assert.equal(await readFile(f.statusPath,'utf8'),f.originalStatus);
  await assert.rejects(lstat(f.lockPath),{code:'ENOENT'});
  const names=await readdir(f.state);
  assert.ok(names.includes(gateName),'uncertain publication must retain gate');
  const archives=names.filter(name=>name.startsWith('runtime-host-lock.orphan-'));
  assert.equal(archives.length,1);
  assert.equal(await readFile(path.join(f.state,archives[0]),'utf8'),f.originalLock);
  await assert.rejects(doRecover(f),/recovery_gate_already_exists/);
});

test('preexisting recovery gate never overwritten; status symlinks and missing status fail closed',async t=>{
  await t.test('gate',async t=>{
    const f=await fixture(t);
    const gatePath=path.join(f.state,gateName);
    await writeFile(gatePath,'prior owner recovery');
    await assert.rejects(doRecover(f),/recovery_gate_already_exists/);
    assert.equal(await readFile(gatePath,'utf8'),'prior owner recovery');
    assert.equal(await readFile(f.lockPath,'utf8'),f.originalLock);
  });
  await t.test('missing_status',async t=>{
    const f=await fixture(t);
    await rm(f.statusPath);
    await assert.rejects(doRecover(f),/recovery_evidence_missing/);
    assert.equal(await readFile(f.lockPath,'utf8'),f.originalLock);
    await assert.rejects(lstat(path.join(f.state,gateName)),{code:'ENOENT'});
  });
  await t.test('hardlinked_status',async t=>{
    const f=await fixture(t);
    const external=path.join(f.state,'elsewhere.json');
    await writeFile(external,f.originalStatus);
    await rm(f.statusPath);
    await link(external,f.statusPath);
    await assert.rejects(doRecover(f),/recovery_evidence_not_canonical/);
    assert.equal(await readFile(f.lockPath,'utf8'),f.originalLock);
    await assert.rejects(lstat(path.join(f.state,gateName)),{code:'ENOENT'});
  });
});

test('real Windows PID observation distinguishes current process from absent PID',()=>{
  assert.equal(runtimeHostPidState(process.pid),'PRESENT');
  assert.equal(runtimeHostPidState(0),'UNKNOWN');
  assert.equal(runtimeHostPidState(-1),'UNKNOWN');
});

test('real loopback TCP observation differentiates live socket from absent endpoint',async t=>{
  const net=await import('node:net');
  const server=net.createServer(socket=>socket.end());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;
  assert.equal(await runtimeHostTcpPortState(port),'PRESENT');
  assert.equal(await runtimeHostTcpPortState(0),'UNKNOWN');
});
