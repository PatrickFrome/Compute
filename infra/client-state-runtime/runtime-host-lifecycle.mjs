const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TERMINAL_REASONS = new Set([
  'requested', 'signal', 'parent_disconnect', 'startup_cancelled', 'runtime_ended',
  'runtime_health_failed', 'runtime_host_start_failed',
  'api_exited', 'edge_exited', 'postgres_exited',
  'api_spawn_failed', 'edge_spawn_failed', 'postgres_spawn_failed',
]);
const failure = code => Object.assign(new Error(code), { code });

export function requireRuntimeHostLaunchNonce(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw failure('runtime_host_launch_nonce_invalid');
  return value;
}

// This is a private producer, called only AFTER status persistence and exact
// ownership release. Process exit, a signal, and an exit code are not receipts.
export function runtimeHostTerminalMessage({ launchNonce, hostPid, outcome }) {
  requireRuntimeHostLaunchNonce(launchNonce);
  if (!Number.isSafeInteger(hostPid) || hostPid < 1 || outcome?.children_stopped !== true
    || outcome.ownership_released !== true || (outcome.instance_id !== null && !UUID.test(outcome.instance_id || ''))) {
    throw failure('runtime_host_terminal_outcome_unproven');
  }
  return Object.freeze({ schema: 'compute.runtime-host-terminal.v1', launch_nonce: launchNonce,
    host_pid: hostPid, instance_id: outcome.instance_id, state: 'STOPPED', children_stopped: true,
    ownership_released: true, reason: TERMINAL_REASONS.has(outcome.reason) ? outcome.reason : 'runtime_ended',
    authority_effect: false });
}

export function runtimeHostFailureMessage(error) {
  return Object.freeze({ schema: 'compute.runtime-host-failure.v1', state: 'FAILED',
    reason: error?.code === 'runtime_host_recovery_startup_custody_missing'
      ? 'runtime_host_recovery_startup_custody_missing' : 'runtime_host_start_failed', credentials_included: false });
}

// Await local IPC flush before disconnect. An absent/failed acknowledgement is
// UNKNOWN to the parent, and must never become an optimistic cleanup receipt.
export async function sendRuntimeHostLifecycleMessage(channel, message, { timeoutMs = 1000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1000) throw failure('runtime_host_lifecycle_timeout_invalid');
  if (typeof channel?.send !== 'function' || channel.connected !== true) return false;
  return new Promise(resolve => {
    let settled = false;
    const finish = sent => { if (settled) return; settled = true; clearTimeout(timer); resolve(sent); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try { channel.send(message, error => finish(!error)); } catch { finish(false); }
  });
}

// Private ordering for existing setup services, not a cleanup attestation.
// A query may require owned PostgreSQL shutdown to finish. Observe the original
// native-resource stage before child stop, then join the full operation AFTER
// child stop. A timeout is only PENDING here; it never means resources drained.
export function createRuntimeSetupDrain({timeoutMs=6500}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>6500)throw failure('runtime_setup_drain_timeout_invalid');
 const records=new Map();
 const observe=work=>{
  const row={settled:false,ok:false};
  row.promise=Promise.resolve().then(work).then(value=>{row.settled=true;row.ok=value===undefined;},()=>{row.settled=true;row.ok=false;});
  return row;
 };
 const record=service=>{
  if(!service)return null;
  if(typeof service.drainResources!=='function'||typeof service.drain!=='function')throw failure('runtime_setup_drain_service_invalid');
  let row=records.get(service);
  if(!row){row={service,resources:observe(()=>service.drainResources()),full:null};records.set(service,row);}
  return row;
 };
 const bounded=async rows=>{
  let timer;
  try{await Promise.race([Promise.all(rows.map(row=>row.promise)),new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);}
  finally{clearTimeout(timer);}
  return rows.every(row=>row.settled&&row.ok);
 };
 return Object.freeze({
  async beforeStop(service){const row=record(service);if(!row)return true;return bounded([row.resources]);},
  async finish(service){
   record(service);
   // Do not lose an earlier observed service merely because startup finished
   // or the caller supplied a different/current service at finalization.
   for(const row of records.values())row.full??=observe(()=>row.service.drain());
   return bounded([...records.values()].flatMap(row=>[row.resources,row.full]));
  },
 });
}
