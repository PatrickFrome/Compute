// Fallback Console runtime (operator directive 2026-09-21): the console that
// lives INSIDE the browser and becomes usable only while Supabase is not
// responding or is performing worse than the local reserve edge.
//
// Contract with the operator requirement:
//   * The console is LOCKED while the cloud supervisor edge is healthy —
//     it is a reserve ("запасной вариант"), never a rival control plane.
//   * When the sentinel flips to LOCAL_FALLBACK, the runtime re-points the
//     live supervisor client at the local reserve edge (setNativeSupervisorBase)
//     so the existing device-signed command plane keeps working through local
//     PG without any code change, and the console unlocks.
//   * When the cloud proves stable again (restore_streak healthy probes AND
//     fallback residency >= one lease timeout so in-flight local leases are
//     expired), authority hands back to the cloud and the console re-locks.
//   * A read-only "drill" (GET /health against the reserve edge) is always
//     available so readiness can be verified without unlocking anything.
//
// If the operator pinned the base via METAENGINE_SUPERVISOR_BASE_URL, the
// runtime never swaps (fail_closed: explicit operator decision wins) and the
// console reports failover as disabled while still observing both targets.

import { NATIVE_SUPERVISOR_BASE, setNativeSupervisorBase } from './native-supervisor-endpoints.mjs';

export const FALLBACK_CONSOLE_SCHEMA = 'metaengine.fallback-console.v1';

function ringPush(array, limit, item) {
  array.push(item);
  if (array.length > limit) array.splice(0, array.length - limit);
  return item;
}

function iso(value) {
  try { return new Date(Number(value)).toISOString(); } catch { return null; }
}

export function createFallbackConsoleRuntime({
  sentinel,
  local_base = null,
  cloud_default_base,
  base_pinned_by_env = false,
  now = () => Date.now(),
  fetch_impl = (typeof fetch === 'function' ? fetch : null),
} = {}) {
  if (!sentinel || typeof sentinel.snapshot !== 'function' || typeof sentinel.tick !== 'function') {
    throw new Error('fallback_console_sentinel_required');
  }
  const cloudBase = String(cloud_default_base || '').trim();
  if (!cloudBase) throw new Error('fallback_console_cloud_base_required');
  if (typeof fetch_impl !== 'function') throw new Error('fallback_console_fetch_unavailable');
  const localBase = local_base ? String(local_base).trim() : null;

  let appliedMode = null;
  const baseSwaps = [];
  const drills = [];
  let lastDrill = null;

  function applyMode() {
    const snap = sentinel.snapshot();
    if (appliedMode === null) {
      // First observation after boot: the resolved startup base is already the
      // authority (env pin or pinned cloud). Record it, never swap on boot.
      appliedMode = snap.mode;
      return snap;
    }
    if (snap.mode === appliedMode || base_pinned_by_env) return snap;
    const targetBase = snap.mode === 'LOCAL_FALLBACK' ? localBase : cloudBase;
    if (!targetBase) {
      appliedMode = snap.mode;
      return snap;
    }
    try {
      const resolved = setNativeSupervisorBase(targetBase);
      ringPush(baseSwaps, 32, {
        at: iso(now()),
        mode: snap.mode,
        base: resolved,
        reason: snap.mode_reason,
      });
      appliedMode = snap.mode;
    } catch {
      // Refusal to set an invalid base must never crash the probe loop; the
      // console honestly reports the swap as pending/failed via swaps count.
      ringPush(baseSwaps, 32, {
        at: iso(now()),
        mode: snap.mode,
        base: null,
        reason: 'BASE_SWAP_REJECTED_INVALID_URL',
      });
    }
    return snap;
  }

  function runtimeSnapshot() {
    const sentinelSnap = sentinel.snapshot();
    const locked = sentinelSnap.mode !== 'LOCAL_FALLBACK' || base_pinned_by_env;
    return Object.freeze({
      schema: FALLBACK_CONSOLE_SCHEMA,
      state: 'OK',
      embedded: true,
      gate: Object.freeze({
        mode: sentinelSnap.mode,
        locked,
        locked_reason: locked
          ? (base_pinned_by_env
            ? 'BASE_PINNED_BY_OPERATOR_ENV_FAILOVER_DISABLED'
            : 'CLOUD_SUPERVISOR_HEALTHY_RESERVE_NOT_REQUIRED')
          : 'RESERVE_MODE_ACTIVE_LOCAL_SUPERVISOR_EDGE_IS_AUTHORITY',
        unlock_rule: 'sentinel mode becomes LOCAL_FALLBACK (cloud unresponsive/degraded sustained) while the local reserve edge is reachable',
        lock_rule: 'cloud proves stable for restore_streak probes after >= min_fallback_residency_ms of reserve operation',
        reserve_usable: sentinelSnap.targets.local_usable,
        drill_available: true,
      }),
      failover: Object.freeze({
        enabled: !base_pinned_by_env && !!localBase,
        base_pinned_by_env,
        local_base: localBase,
        cloud_default_base: cloudBase,
        active_base: NATIVE_SUPERVISOR_BASE,
        base_swaps: Object.freeze(baseSwaps.map((row) => Object.freeze({ ...row }))),
      }),
      sentinel: sentinelSnap,
      drill: Object.freeze({
        last: lastDrill ? Object.freeze({ ...lastDrill }) : null,
        history: Object.freeze(drills.slice().map((row) => Object.freeze({ ...row }))),
      }),
      counters: Object.freeze({
        base_swaps_total: baseSwaps.length,
        drills_total: drills.length,
      }),
      authority_effect: false,
    });
  }

  // Read-only readiness probe of the reserve path. Always allowed — this is
  // how the operator verifies the fallback WOULD work before it is needed.
  async function drill() {
    const startedAt = now();
    let result;
    if (!localBase) {
      result = { ok: false, reason: 'LOCAL_RESERVE_BASE_NOT_CONFIGURED', base: null, latency_ms: 0, status: 0, error: null, at: iso(now()) };
    } else {
      const url = `${localBase}/health`;
      try {
        const controller = new AbortController();
        const timerHandle = setTimeout(() => controller.abort(), 2500);
        let response;
        try {
          response = await fetch_impl(url, { method: 'GET', signal: controller.signal, cache: 'no-store' });
        } finally {
          clearTimeout(timerHandle);
        }
        const ok = response && response.status >= 200 && response.status < 300;
        result = {
          ok,
          reason: ok ? 'RESERVE_READY' : 'RESERVE_UNHEALTHY',
          base: localBase,
          latency_ms: now() - startedAt,
          status: response ? response.status : 0,
          error: ok ? null : `http_${response ? response.status : 'no_response'}`,
          at: iso(now()),
        };
      } catch (error) {
        result = {
          ok: false,
          reason: 'RESERVE_UNREACHABLE',
          base: localBase,
          latency_ms: now() - startedAt,
          status: 0,
          error: String(error?.message || error || 'drill_failed').slice(0, 120),
          at: iso(now()),
        };
      }
    }
    lastDrill = result;
    ringPush(drills, 16, result);
    return Object.freeze({ ...result, authority_effect: false });
  }

  async function probe() {
    await sentinel.tick();
    applyMode();
    return runtimeSnapshot();
  }

  function start({ on_mode_change = null } = {}) {
    sentinel.start({
      on_tick: () => {
        const before = sentinel.snapshot().mode;
        applyMode();
        const after = sentinel.snapshot().mode;
        if (typeof on_mode_change === 'function' && after !== before) {
          try { on_mode_change(runtimeSnapshot()); } catch { /* observer only */ }
        }
      },
    });
  }

  function stop() {
    sentinel.stop();
  }

  return {
    snapshot: runtimeSnapshot,
    probe,
    drill,
    start,
    stop,
    get applied_mode() { return appliedMode; },
  };
}
