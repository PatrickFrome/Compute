/** Shared native process ownership for daemon and UI. Never owns adopted services. */
export function startOwned(host, bin, args, options) {
  if (host.child) return { ok: false, reason: 'owned_process_still_running' };
  host.processFailure = null;
  let child;
  try { child = host.spawnImpl(bin, args, options); }
  catch (error) {
    host.status = 'degraded';
    host.processFailure = String(error?.code ?? 'spawn_failed');
    return { ok: false, reason: host.processFailure };
  }
  host.child = child;
  // Unconsumed pipes eventually block the child; do not retain or log raw output.
  child.stdout?.resume?.();
  child.stderr?.resume?.();
  child.on('error', error => {
    if (host.child !== child) return;
    host.processFailure = String(error?.code ?? 'child_error');
    host.status = 'degraded';
    // An error on an existing PID (e.g. kill failure) does not prove termination.
    if (!child.pid) host.child = null;
  });
  child.once('exit', () => {
    if (host.child !== child) return;
    host.child = null;
    host.processFailure ??= 'child_exited';
    host.status = 'degraded';
  });
  return { ok: true, pid: child.pid };
}

export async function stopOwned(host, { timeoutMs = 2000 } = {}) {
  const child = host.child;
  if (!child) return { ok: true };
  if (child.exitCode != null || child.signalCode != null) {
    if (host.child === child) host.child = null;
    return { ok: true };
  }
  return new Promise(resolve => {
    let timer;
    const finish = ok => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('close', onExit);
      if (ok && host.child === child) host.child = null;
      resolve(ok ? { ok: true } : { ok: false, reason: 'owned_process_stop_unconfirmed' });
    };
    const onExit = () => finish(true);
    child.once('exit', onExit);
    child.once('close', onExit);
    timer = setTimeout(() => finish(false), timeoutMs);
    try { child.kill(); } catch { finish(false); }
  });
}
