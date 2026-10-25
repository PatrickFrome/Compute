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
