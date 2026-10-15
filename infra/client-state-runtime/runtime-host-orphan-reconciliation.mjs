// Safe, bounded recovery for an abandoned *attached* runtime host lock.
// Never deletes the prior lock or modifies PostgreSQL. An exclusive recovery
// gate serializes competing recovery attempts; an ambiguous gate remains for
// operator review rather than allowing a blind retry.
import { randomUUID } from 'node:crypto';
import { open, lstat, readFile, rename, unlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const fail = (code) => { const e = new Error('runtime_host_' + code); e.code = e.message; throw e; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const PID = n => Number.isSafeInteger(n) && n > 4 && n <= 0x7fffffff;
const RECOVERY_LOCK = 'runtime-host-recovery-gate.json';
const OWNER_LOCK = 'runtime-host-lock.json';
const STATUS_FILE = 'runtime-instance.json';

async function boundedFile(file, maximumBytes) {
  const before = await lstat(file).catch(e => { if(e?.code === 'ENOENT') fail('recovery_evidence_missing'); throw e; });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 2 || before.size > maximumBytes) {
    fail('recovery_evidence_not_canonical');
  }
  const bytes = await readFile(file);
  const after = await lstat(file);
  if (bytes.length > maximumBytes || before.size !== bytes.length || after.size !== before.size
    || before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs) {
    fail('recovery_evidence_changed');
  }
  return bytes;
}
const parse = bytes => {
  try { const value=JSON.parse(bytes.toString('utf8')); if(!value || typeof value !== 'object' || Array.isArray(value)) fail('recovery_evidence_invalid'); return value; }
  catch { fail('recovery_evidence_invalid'); }
};
function inspectLockAndStatus(config, lock, status) {
  // A crash before READY has no complete child-custody witness. Report this
  // incident separately, without inferring that its children or effects ended.
  // The category applies only to the same pinned attached owner, never an
  // unrelated/malformed status. The lock remains subject to manual review.
  if (config.postgres_mode === 'attached' && config.api_role_mode === 'direct'
    && SHA.test(config.expected_bundle_sha256||'')
    && PID(lock?.pid) && lock.schema === 'compute.runtime-host-lock.v1'
    && UUID.test(lock.owner_nonce||'') && Object.keys(lock).sort().join(',') === 'owner_nonce,pid,schema'
    && status?.schema === 'metaengine.client-state.runtime-status.v1'
    && status.state === 'STARTING' && status.runtime_ready === false && status.host_pid === lock.pid
    && status.bundle_sha256 === config.expected_bundle_sha256 && status.state_provider === 'LOCAL_POSTGRES'
    && status.hosted_supabase_required === false && status.automatic_cloud_fallback === false
    && status.authority_effect === false) fail('recovery_startup_custody_missing');
  if (config.postgres_mode !== 'attached' || config.api_role_mode !== 'direct'
    || !SHA.test(config.expected_bundle_sha256||'')
    || !PID(lock?.pid) || lock.schema !== 'compute.runtime-host-lock.v1'
    || !UUID.test(lock.owner_nonce||'') || Object.keys(lock).sort().join(',') !== 'owner_nonce,pid,schema'
    || !status || status.schema !== 'metaengine.client-state.runtime-status.v1'
    || status.state !== 'READY' || status.runtime_ready !== true || status.host_pid !== lock.pid
    || status.postgres_mode !== 'attached' || status.api_role_mode !== 'direct'
    || status.state_provider !== 'LOCAL_POSTGRES' || status.hosted_supabase_required !== false
    || status.automatic_cloud_fallback !== false || status.authority_effect !== false
    || status.bundle_sha256 !== config.expected_bundle_sha256
    || !UUID.test(status.instance_id||'') || status.endpoint !== 'http://127.0.0.1:' + config.edge_port + '/a2-browser-native-supervisor-v1'
    || !Array.isArray(status.children) || status.children.length !== 2
    || !status.children.every(c => c && typeof c === 'object' && !Array.isArray(c)
      && Object.keys(c).sort().join(',') === 'name,pid' && ['api','edge'].includes(c.name) && PID(c.pid))
    || new Set(status.children.map(c=>c.name)).size !== 2
    || new Set([lock.pid, ...status.children.map(c=>c.pid)]).size !== 3) {
    fail('recovery_lock_status_not_attested');
  }
  let databasePort;
  try {
    const url = new URL(config.database_url);
    databasePort=Number(url.port);
    if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
      || !Number.isSafeInteger(databasePort) || databasePort < 1024 || databasePort > 65535) fail('recovery_db_endpoint_invalid');
  } catch { fail('recovery_db_endpoint_invalid'); }
  if (![config.api_port,config.edge_port].every(port=>Number.isSafeInteger(port)&&port>=1024&&port<=65535)
    || new Set([databasePort,config.api_port,config.edge_port]).size!==3) fail('recovery_endpoint_ambiguous');
  return { orphanHostPid:lock.pid, childPids:status.children.map(c=>c.pid), databasePort };
}

export function runtimeHostPidState(pid) {
  if(!PID(pid)) return 'UNKNOWN';
  try { process.kill(pid, 0); return 'PRESENT'; }
  catch(e) { return e?.code === 'ESRCH' ? 'ABSENT' : 'UNKNOWN'; }
}
export function runtimeHostTcpPortState(port, timeoutMs=900) {
  if (!Number.isSafeInteger(port) || port<1024 || port>65535) return Promise.resolve('UNKNOWN');
  return new Promise(resolve=>{
    const socket=net.createConnection({host:'127.0.0.1',port});
    let settled=false;
    const complete = state => {
      if(settled)return;
      settled=true;
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(timeoutMs,()=>complete('UNKNOWN'));
    socket.once('connect',()=>complete('PRESENT'));
    socket.once('error',error=>complete(error?.code === 'ECONNREFUSED' ? 'ABSENT' : 'UNKNOWN'));
  });
}

async function verifyNoLiveOwner({ config, lock, status, pidState, portState, delay }) {
  const { orphanHostPid, childPids, databasePort } = inspectLockAndStatus(config, lock, status);
  for(let round=0;round<2;round++){
    for(const pid of [orphanHostPid,...childPids]){
      if(await pidState(pid)!=='ABSENT') fail('recovery_process_presence_unresolved');
    }
    for(const port of [config.api_port,config.edge_port]){
      if(await portState(port)!=='ABSENT') fail('recovery_api_edge_presence_unresolved');
    }
    if(await portState(databasePort)!=='PRESENT') fail('recovery_attached_postgres_not_live');
    if(round===0) await delay(120);
  }
}

// Called ONLY by an admitted, packaged primary's pinned runtime-host child
// after create('wx') reports EEXIST. Does not replay task effects or change
// PostgreSQL. A duplicate recovery gate is always a hard stop.
export async function reconcileAbandonedAttachedRuntimeLock({config,pidState=runtimeHostPidState,
  portState=runtimeHostTcpPortState,delay=pause,renameLock=rename}={}) {
  if(config?.postgres_mode!=='attached'||typeof config.state_directory!=='string'||!path.isAbsolute(config.state_directory)) {
    fail('recovery_attached_mode_required');
  }
  const state=config.state_directory;
  const gatePath=path.join(state,RECOVERY_LOCK);
  const lockPath=path.join(state,OWNER_LOCK);
  const statusPath=path.join(state,STATUS_FILE);
  const nonce=randomUUID();
  const gateBytes=Buffer.from(JSON.stringify({schema:'compute.runtime-host-recovery-gate.v1',pid:process.pid,nonce})+'\n');
  let gate;
  try { gate=await open(gatePath,'wx',0o600); }
  catch(e) { fail(e?.code==='EEXIST'?'recovery_gate_already_exists':'recovery_gate_unavailable'); }
  let publicationAttempted=false,quarantinePath=null,success=false;
  try {
    await gate.writeFile(gateBytes); await gate.sync(); await gate.close();gate=null;
    const lockBytes=await boundedFile(lockPath,512);
    const statusBytes=await boundedFile(statusPath,65536);
    const lock=parse(lockBytes),status=parse(statusBytes);
    await verifyNoLiveOwner({config,lock,status,pidState,portState,delay});
    if(!(await boundedFile(lockPath,512)).equals(lockBytes)
      ||!(await boundedFile(statusPath,65536)).equals(statusBytes)) fail('recovery_evidence_changed');
    // Atomic same-directory rename. Every new runtime owner still uses
    // open('wx') for the canonical lock, preventing two admitted owners.
    quarantinePath=path.join(state, 'runtime-host-lock.orphan-'+randomUUID()+'.json');
    try { await lstat(quarantinePath);fail('recovery_quarantine_exists'); }
    catch(e){if(e?.code!=='ENOENT') throw e;}
    // The OS may complete a rename before reporting an I/O error. Once the
    // syscall is attempted, its effect is potentially ambiguous: retain the
    // recovery gate unless an exact quarantine readback succeeds.
    publicationAttempted=true;
    await renameLock(lockPath,quarantinePath);
    if(!(await boundedFile(quarantinePath,512)).equals(lockBytes))fail('recovery_quarantine_mismatch');
    success=true;
    return Object.freeze({schema:'compute.runtime-host-lock-reconciliation.v1',
      state:'ORPHAN_QUARANTINED',prior_host_pid:lock.pid,
      quarantine_path:quarantinePath,old_lock_preserved:true,postgres_not_stopped:true,
      task_effect_replayed:false,automatic_effect_retry_allowed:false,authority_effect:false});
  } finally {
    if(gate)await gate.close().catch(()=>{});
    // If publication may have occurred but verification failed, preserve the
    // gate for operator review. Do not release ambiguous recovery authority.
    if(!publicationAttempted||success){
      const current=await boundedFile(gatePath,512).catch(()=>null);
      if(current?.equals(gateBytes))await unlink(gatePath);
      else fail('recovery_gate_changed');
    }
  }
}
