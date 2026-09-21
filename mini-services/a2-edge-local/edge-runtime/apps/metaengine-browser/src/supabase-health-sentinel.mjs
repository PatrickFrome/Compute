// Supabase health sentinel (Fallback Console, operator directive 2026-09-21).
//
// Pure, dependency-free, zero-authority observer. It periodically probes the
// pinned cloud supervisor edge and the local reserve supervisor edge with
// unauthenticated GET /health (the only signature-free route on both edges,
// per the deep audit §5) and maintains a hysteresis state machine:
//
//   CLOUD_AUTHORITY  — default. The pinned cloud edge is the control plane.
//   LOCAL_FALLBACK   — entered ONLY when the cloud has been unresponsive or
//                      degraded ("не отвечает или хуже справляется") for
//                      `degrade_streak` consecutive probes AND the local edge
//                      is reachable. Left when the cloud proves HEALTHY for
//                      `restore_streak` consecutive probes AND the fallback
//                      residency exceeded `min_fallback_residency_ms` (>= one
//                      lease timeout, so in-flight local leases are expired
//                      before authority hands back — no dual-authority race).
//
// The sentinel never writes, never retries with side effects, never issues
// commands, and never fabricates a healthy state: UNKNOWN until the first
// probe resolves. All snapshot surfaces are read-only and frozen.

export const SUPABASE_HEALTH_SENTINEL_SCHEMA = 'metaengine.supabase-health-sentinel.v1';

const HEALTH_STATES = Object.freeze(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'DOWN']);
const MODES = Object.freeze(['CLOUD_AUTHORITY', 'LOCAL_FALLBACK']);

function ringPush(array, limit, item) {
  array.push(item);
  if (array.length > limit) array.splice(0, array.length - limit);
  return item;
}

function iso(value) {
  try { return new Date(Number(value)).toISOString(); } catch { return null; }
}

function defaultFetch() {
  return typeof fetch === 'function' ? fetch : null;
}

function finitePositive(value, fallback, { min = 0 } = {}) {
  const out = Math.floor(Number(value));
  if (!Number.isFinite(out) || out < min) return fallback;
  return out;
}

function classifyProbe(probe, previous, degradedLatencyMs) {
  if (!probe || probe.ok !== true) {
    const failStreak = (previous?.fail_streak || 0) + 1;
    const okStreak = 0;
    const notHealthyStreak = (previous?.not_healthy_streak || 0) + 1;
    return {
      fail_streak: failStreak,
      ok_streak: okStreak,
      not_healthy_streak: notHealthyStreak,
      state: failStreak >= 2 ? 'DOWN' : 'DEGRADED',
    };
  }
  const okStreak = (previous?.ok_streak || 0) + 1;
  // "Worse" counts too: a reachable-but-slow cloud (latency above the
  // degraded threshold) is DEGRADED and accumulates not_healthy_streak, so a
  // consistently underperforming Supabase unlocks the reserve exactly like an
  // unresponsive one. Only a genuinely HEALTHY probe resets the streak.
  const state = probe.latency_ms > degradedLatencyMs ? 'DEGRADED' : 'HEALTHY';
  return {
    fail_streak: 0,
    ok_streak: okStreak,
    not_healthy_streak: state === 'HEALTHY' ? 0 : (previous?.not_healthy_streak || 0) + 1,
    state,
  };
}

export function createSupabaseHealthSentinel({
  cloud_base,
  local_base = null,
  interval_ms = 5000,
  timeout_ms = 2500,
  degraded_latency_ms = 1200,
  degrade_streak = 2,
  restore_streak = 5,
  min_fallback_residency_ms = 120000,
  failover_enabled = true,
  probes_ring_limit = 128,
  transitions_ring_limit = 64,
  now = () => Date.now(),
  fetch_impl = defaultFetch(),
} = {}) {
  const cloudBase = String(cloud_base || '').trim();
  const localBase = local_base ? String(local_base).trim() : null;
  if (!cloudBase) throw new Error('supabase_health_sentinel_cloud_base_required');
  if (localBase && !/^https?:\/\//.test(localBase)) throw new Error('supabase_health_sentinel_local_base_invalid');
  if (typeof fetch_impl !== 'function') throw new Error('supabase_health_sentinel_fetch_unavailable');

  const intervalMs = finitePositive(interval_ms, 5000, { min: 500 });
  const timeoutMs = finitePositive(timeout_ms, 2500, { min: 250 });
  const degradedLatencyMs = finitePositive(degraded_latency_ms, 1200, { min: 1 });
  const degradeStreak = finitePositive(degrade_streak, 2, { min: 1 });
  const restoreStreak = finitePositive(restore_streak, 5, { min: 1 });
  const minFallbackResidencyMs = finitePositive(min_fallback_residency_ms, 120000, { min: 0 });

  const probes = [];
  const transitions = [];

  let startedAt = null;
  let timer = null;
  let probing = false;
  let probesTotal = 0;
  let transitionsTotal = 0;

  let mode = 'CLOUD_AUTHORITY';
  let modeSince = now();
  let modeReason = 'BOOT_DEFAULT_CLOUD_PINNED';

  const targets = {
    cloud: { base: cloudBase, state: 'UNKNOWN', ok_streak: 0, fail_streak: 0, not_healthy_streak: 0, latency_ms: null, status: null, last_ok_at: null, last_error: null, last_probe_at: null },
    local: localBase ? { base: localBase, state: 'UNKNOWN', ok_streak: 0, fail_streak: 0, not_healthy_streak: 0, latency_ms: null, status: null, last_ok_at: null, last_error: null, last_probe_at: null } : null,
  };

  function targetSnapshot(target) {
    if (!target) return null;
    return {
      base: target.base,
      state: target.state,
      ok_streak: target.ok_streak,
      fail_streak: target.fail_streak,
      not_healthy_streak: target.not_healthy_streak,
      latency_ms: target.latency_ms,
      status: target.status,
      last_ok_at: target.last_ok_at,
      last_error: target.last_error,
      last_probe_at: target.last_probe_at,
    };
  }

  async function probeTarget(name, base) {
    const startedAtProbe = now();
    const url = `${base}/health`;
    try {
      const controller = new AbortController();
      const timerHandle = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch_impl(url, { method: 'GET', signal: controller.signal, cache: 'no-store' });
      } finally {
        clearTimeout(timerHandle);
      }
      const latencyMs = now() - startedAtProbe;
      const ok = response && response.status >= 200 && response.status < 300;
      return {
        name, base, url, ok,
        status: response ? response.status : 0,
        latency_ms: latencyMs,
        error: ok ? null : `http_${response ? response.status : 'no_response'}`,
        at: iso(now()),
      };
    } catch (error) {
      return {
        name, base, url, ok: false,
        status: 0,
        latency_ms: now() - startedAtProbe,
        error: String(error?.message || error || 'probe_failed').slice(0, 120),
        at: iso(now()),
      };
    }
  }

  function recordTransition(from, to, reason) {
    transitionsTotal += 1;
    return ringPush(transitions, transitions_ring_limit, {
      at: iso(now()),
      from, to, reason,
      cloud_state: targets.cloud.state,
      local_state: targets.local ? targets.local.state : 'NOT_CONFIGURED',
    });
  }

  function resolveMode() {
    const cloud = targets.cloud;
    const local = targets.local;
    const localUsable = !!local && (local.state === 'HEALTHY' || local.state === 'DEGRADED');

    if (mode === 'CLOUD_AUTHORITY') {
      const cloudNotHealthyStreak = cloud.not_healthy_streak;
      if (
        failover_enabled
        && localUsable
        && cloudNotHealthyStreak >= degradeStreak
        && (cloud.state === 'DOWN' || cloud.state === 'DEGRADED')
      ) {
        mode = 'LOCAL_FALLBACK';
        modeSince = now();
        modeReason = cloud.state === 'DOWN'
          ? 'CLOUD_UNRESPONSIVE_LOCAL_RESERVE_AVAILABLE'
          : 'CLOUD_DEGRADED_LOCAL_RESERVE_AVAILABLE';
        recordTransition('CLOUD_AUTHORITY', mode, modeReason);
        return;
      }
      return;
    }

    // mode === 'LOCAL_FALLBACK'
    const localDead = !localUsable;
    const cloudStable = cloud.state === 'HEALTHY' && cloud.ok_streak >= restoreStreak;
    const residencySatisfied = (now() - modeSince) >= minFallbackResidencyMs;
    if (localDead && (cloud.state === 'HEALTHY' || cloud.state === 'DEGRADED')) {
      mode = 'CLOUD_AUTHORITY';
      modeSince = now();
      modeReason = 'LOCAL_RESERVE_UNAVAILABLE_CLOUD_BOUNDED_RESTORE';
      recordTransition('LOCAL_FALLBACK', mode, modeReason);
      return;
    }
    if (cloudStable && residencySatisfied) {
      const residencyMs = now() - modeSince;
      mode = 'CLOUD_AUTHORITY';
      modeSince = now();
      modeReason = `CLOUD_RESTORED_STABLE_${cloud.ok_streak}_PROBES_RESIDENCY_${Math.floor(residencyMs / 1000)}S`;
      recordTransition('LOCAL_FALLBACK', mode, modeReason);
    }
  }

  async function tick() {
    if (probing) return snapshot();
    probing = true;
    try {
      const jobs = [probeTarget('cloud', targets.cloud.base)];
      if (targets.local) jobs.push(probeTarget('local', targets.local.base));
      const results = await Promise.all(jobs);
      for (const probe of results) {
        probesTotal += 1;
        ringPush(probes, probes_ring_limit, probe);
        const target = probe.name === 'cloud' ? targets.cloud : targets.local;
        if (!target) continue;
        const classified = classifyProbe(probe, target, degradedLatencyMs);
        target.state = classified.state;
        target.ok_streak = classified.ok_streak;
        target.fail_streak = classified.fail_streak;
        target.not_healthy_streak = classified.not_healthy_streak;
        target.latency_ms = probe.latency_ms;
        target.status = probe.status;
        target.last_probe_at = probe.at;
        if (probe.ok) { target.last_ok_at = probe.at; target.last_error = null; }
        else target.last_error = probe.error;
      }
      const before = mode;
      resolveMode();
      if (mode !== before) modeSince = now();
      return snapshot();
    } finally {
      probing = false;
    }
  }

  function snapshot() {
    const localUsable = !!targets.local && (targets.local.state === 'HEALTHY' || targets.local.state === 'DEGRADED');
    const locked = mode !== 'LOCAL_FALLBACK';
    return Object.freeze({
      schema: SUPABASE_HEALTH_SENTINEL_SCHEMA,
      state: 'OK',
      mode,
      mode_since: iso(modeSince),
      mode_reason: modeReason,
      gate: Object.freeze({
        locked,
        locked_reason: locked
          ? (mode === 'CLOUD_AUTHORITY' ? 'CLOUD_SUPERVISOR_HEALTHY_OR_NOT_YET_DEGRADED' : 'TRANSITIONING')
          : 'RESERVE_MODE_ACTIVE',
        unlock_condition: 'cloud unresponsive/degraded for degrade_streak probes while local reserve edge is reachable',
        lock_condition: `cloud HEALTHY for restore_streak=${restoreStreak} probes and fallback residency >= ${minFallbackResidencyMs}ms`,
      }),
      failover: Object.freeze({
        enabled: !!targets.local && failover_enabled,
        local_configured: !!targets.local,
        interval_ms: intervalMs,
        timeout_ms: timeoutMs,
        degraded_latency_ms: degradedLatencyMs,
        degrade_streak: degradeStreak,
        restore_streak: restoreStreak,
        min_fallback_residency_ms: minFallbackResidencyMs,
      }),
      targets: Object.freeze({
        cloud: Object.freeze(targetSnapshot(targets.cloud)),
        local: targets.local ? Object.freeze(targetSnapshot(targets.local)) : null,
        local_usable: localUsable,
      }),
      probes: Object.freeze(probes.slice(-24).map((probe) => Object.freeze({ ...probe }))),
      transitions: Object.freeze(transitions.slice().map((row) => Object.freeze({ ...row }))),
      counters: Object.freeze({
        probes_total: probesTotal,
        transitions_total: transitionsTotal,
      }),
      started_at: startedAt ? iso(startedAt) : null,
      authority_effect: false,
    });
  }

  function start({ on_tick = null, on_mode_change = null } = {}) {
    if (timer) return;
    startedAt = startedAt || now();
    const schedule = () => {
      const jitter = Math.floor(intervalMs * 0.1 * Math.random());
      timer = setTimeout(async () => {
        timer = null;
        try {
          const snap = await tick();
          if (typeof on_tick === 'function') { try { on_tick(snap); } catch { /* observer must never break the loop */ } }
          if (typeof on_mode_change === 'function') {
            try { on_mode_change(snap); } catch { /* observer must never break the loop */ }
          }
        } catch { /* never break the probe loop */ }
        schedule();
      }, intervalMs + jitter);
      if (typeof timer.unref === 'function') timer.unref();
    };
    schedule();
  }

  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  return {
    snapshot,
    tick,
    start,
    stop,
    get mode() { return mode; },
    MODES,
    HEALTH_STATES,
  };
}
