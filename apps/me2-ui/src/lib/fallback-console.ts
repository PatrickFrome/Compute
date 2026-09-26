/**
 * Fallback Console sentinel — Mission Control mirror of the browser-side
 * `src/supabase-health-sentinel.mjs` (round FALLBACK-CONSOLE-010).
 *
 * Operator directive: the reserve console may be used ONLY while Supabase
 * is unresponsive or performing worse than the local reserve edge. This
 * module keeps the same hysteresis state machine (degrade_streak=2,
 * restore_streak=5, residency >= one lease timeout), probes the pinned cloud
 * edge and the local :3031 edge with unauthenticated GET /health, and
 * persists every mode transition to local Pigsty.
 *
 * QA honesty: the outage simulation forces cloud probes to fail but marks
 * every affected record with `simulated: true` — it never fabricates real
 * cloud telemetry.
 */
import { EDGE_BASE, edgeHealth } from "@/lib/edge";
import { query } from "@/lib/pg";

export const CLOUD_SUPERVISOR_BASE =
  "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1";

const DEGRADE_STREAK = 2;
const RESTORE_STREAK = 5;
const MIN_FALLBACK_RESIDENCY_MS = 120_000;
const DEGRADED_LATENCY_MS =
  Number(process.env.METAENGINE_FALLBACK_DEGRADED_LATENCY_MS || 0) || 1200;
const PROBE_TIMEOUT_MS = 2500;
const MIN_TICK_INTERVAL_MS = 4000;
const RING_LIMIT = 128;
const SIMULATION_DEFAULT_SECONDS = 300;

export type HealthState = "UNKNOWN" | "HEALTHY" | "DEGRADED" | "DOWN";
export type SentinelMode = "CLOUD_AUTHORITY" | "LOCAL_FALLBACK";

export interface TargetState {
  base: string;
  state: HealthState;
  okStreak: number;
  failStreak: number;
  notHealthyStreak: number;
  latencyMs: number | null;
  status: number | null;
  lastError: string | null;
  lastProbeAt: string | null;
}

export interface ProbeRecord {
  name: "cloud" | "local";
  ok: boolean;
  status: number;
  latencyMs: number;
  error: string | null;
  simulated: boolean;
  at: string;
}

export interface TransitionRecord {
  at: string;
  from: SentinelMode;
  to: SentinelMode;
  reason: string;
  simulated: boolean;
  cloudState: HealthState;
  localState: HealthState | "NOT_CONFIGURED";
}

export interface DrillRecord {
  ok: boolean;
  base: string;
  latencyMs: number;
  status: number;
  error: string | null;
  at: string;
}

export interface FallbackSnapshot {
  ok: boolean;
  schema: "metaengine.fallback-console.v1";
  mode: SentinelMode;
  modeReason: string;
  modeSince: string;
  gate: {
    locked: boolean;
    lockedReason: string;
    unlockCondition: string;
    lockCondition: string;
    reserveUsable: boolean;
  };
  failover: {
    enabled: boolean;
    cloudBase: string;
    localBase: string;
    degradeStreak: number;
    restoreStreak: number;
    degradedLatencyMs: number;
    minFallbackResidencyMs: number;
  };
  targets: { cloud: TargetState; local: TargetState };
  probes: ProbeRecord[];
  transitions: TransitionRecord[];
  drills: DrillRecord[];
  simulation: { active: boolean; until: string | null };
  counters: { probesTotal: number; transitionsTotal: number; drillsTotal: number };
  authorityEffect: false;
}

interface SentinelState {
  cloud: TargetState;
  local: TargetState;
  mode: SentinelMode;
  modeSince: number;
  modeReason: string;
  probes: ProbeRecord[];
  transitions: TransitionRecord[];
  drills: DrillRecord[];
  probesTotal: number;
  transitionsTotal: number;
  drillsTotal: number;
  simulateUntil: number;
  lastTickAt: number;
  tickInFlight: Promise<FallbackSnapshot> | null;
}

function iso(ms: number): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function classify(probe: { ok: boolean; latencyMs: number }, prev: TargetState): Pick<TargetState, "state" | "okStreak" | "failStreak" | "notHealthyStreak"> {
  if (!probe.ok) {
    const failStreak = prev.failStreak + 1;
    return {
      state: failStreak >= 2 ? "DOWN" : "DEGRADED",
      okStreak: 0,
      failStreak,
      notHealthyStreak: prev.notHealthyStreak + 1,
    };
  }
  // "Worse" counts too: reachable-but-slow (latency above threshold) is
  // DEGRADED and accumulates notHealthyStreak — a consistently
  // underperforming Supabase unlocks the reserve exactly like a dead one.
  const state: HealthState = probe.latencyMs > DEGRADED_LATENCY_MS ? "DEGRADED" : "HEALTHY";
  return {
    state,
    okStreak: prev.okStreak + 1,
    failStreak: 0,
    notHealthyStreak: state === "HEALTHY" ? 0 : prev.notHealthyStreak + 1,
  };
}

async function probeHttp(base: string, name: "cloud" | "local", simulated: boolean): Promise<ProbeRecord> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal, cache: "no-store" });
    const ok = res.status >= 200 && res.status < 300;
    return {
      name,
      ok,
      status: res.status,
      latencyMs: Date.now() - started,
      error: ok ? null : `http_${res.status}`,
      simulated,
      at: iso(Date.now()),
    };
  } catch (e) {
    return {
      name,
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
      simulated,
      at: iso(Date.now()),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function persistTransition(t: TransitionRecord): Promise<void> {
  try {
    await query(
      `INSERT INTO destruktion_meta.fallback_console_transition_log_h205f22
         (at, from_mode, to_mode, reason, simulated, cloud_state, local_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [t.at, t.from, t.to, t.reason, t.simulated, t.cloudState, t.localState],
    );
  } catch {
    // fail-open: observation must never break the sentinel loop
  }
}

export async function ensureFallbackTables(): Promise<void> {
  await query(`CREATE SCHEMA IF NOT EXISTS destruktion_meta`);
  await query(`
    CREATE TABLE IF NOT EXISTS destruktion_meta.fallback_console_transition_log_h205f22 (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      from_mode text NOT NULL,
      to_mode text NOT NULL,
      reason text NOT NULL,
      simulated boolean NOT NULL DEFAULT false,
      cloud_state text,
      local_state text
    )`);
}

export async function recentTransitions(limit = 12): Promise<Record<string, unknown>[]> {
  try {
    const res = await query(
      `SELECT id, at, from_mode, to_mode, reason, simulated, cloud_state, local_state
         FROM destruktion_meta.fallback_console_transition_log_h205f22
        ORDER BY id DESC LIMIT $1`,
      [limit],
    );
    return res.rows;
  } catch {
    return [];
  }
}

async function tick(state: SentinelState): Promise<FallbackSnapshot> {
  const simulationActive = state.simulateUntil > Date.now();
  const [cloudProbe, localProbe] = await Promise.all([
    probeHttp(CLOUD_SUPERVISOR_BASE, "cloud", simulationActive),
    probeHttp(EDGE_BASE, "local", false),
  ]);

  // QA simulation: a forced outage overrides the real cloud result.
  const effectiveCloud = simulationActive && cloudProbe.ok
    ? { ...cloudProbe, ok: false, status: 0, error: `simulated_outage (${cloudProbe.error ?? "http_ok"})` }
    : cloudProbe;

  state.probesTotal += 1;
  state.probes.push(effectiveCloud, localProbe);
  if (state.probes.length > RING_LIMIT) state.probes.splice(0, state.probes.length - RING_LIMIT);

  const before = state.mode;
  state.cloud = { ...state.cloud, ...classify(effectiveCloud, state.cloud), latencyMs: effectiveCloud.latencyMs, status: effectiveCloud.status, lastError: effectiveCloud.error, lastProbeAt: effectiveCloud.at };
  state.local = { ...state.local, ...classify(localProbe, state.local), latencyMs: localProbe.latencyMs, status: localProbe.status, lastError: localProbe.error, lastProbeAt: localProbe.at };

  const localUsable = state.local.state === "HEALTHY" || state.local.state === "DEGRADED";
  if (state.mode === "CLOUD_AUTHORITY") {
    if (
      localUsable
      && state.cloud.notHealthyStreak >= DEGRADE_STREAK
      && (state.cloud.state === "DOWN" || state.cloud.state === "DEGRADED")
    ) {
      state.mode = "LOCAL_FALLBACK";
      state.modeSince = Date.now();
      state.modeReason = state.cloud.state === "DOWN"
        ? (simulationActive ? "SIMULATED_CLOUD_UNRESPONSIVE_LOCAL_RESERVE_AVAILABLE" : "CLOUD_UNRESPONSIVE_LOCAL_RESERVE_AVAILABLE")
        : (simulationActive ? "SIMULATED_CLOUD_DEGRADED_LOCAL_RESERVE_AVAILABLE" : "CLOUD_DEGRADED_LOCAL_RESERVE_AVAILABLE");
    }
  } else {
    const cloudStable = state.cloud.state === "HEALTHY" && state.cloud.okStreak >= RESTORE_STREAK && !simulationActive;
    const residencySatisfied = Date.now() - state.modeSince >= MIN_FALLBACK_RESIDENCY_MS;
    const localDead = !localUsable;
    if ((cloudStable && residencySatisfied) || (localDead && (state.cloud.state === "HEALTHY" || state.cloud.state === "DEGRADED"))) {
      state.mode = "CLOUD_AUTHORITY";
      state.modeSince = Date.now();
      state.modeReason = localDead ? "LOCAL_RESERVE_UNAVAILABLE_CLOUD_BOUNDED_RESTORE" : `CLOUD_RESTORED_STABLE_${state.cloud.okStreak}_PROBES`;
    }
  }

  if (state.mode !== before) {
    const record: TransitionRecord = {
      at: iso(Date.now()),
      from: before,
      to: state.mode,
      reason: state.modeReason,
      simulated: simulationActive,
      cloudState: state.cloud.state,
      localState: state.local.state,
    };
    state.transitionsTotal += 1;
    state.transitions.push(record);
    if (state.transitions.length > 64) state.transitions.splice(0, state.transitions.length - 64);
    void persistTransition(record);
  }
  state.lastTickAt = Date.now();
  return snapshot(state);
}

function snapshot(state: SentinelState): FallbackSnapshot {
  const simulationActive = state.simulateUntil > Date.now();
  const locked = state.mode !== "LOCAL_FALLBACK";
  const reserveUsable = state.local.state === "HEALTHY" || state.local.state === "DEGRADED";
  return {
    ok: true,
    schema: "metaengine.fallback-console.v1",
    mode: state.mode,
    modeReason: state.modeReason,
    modeSince: iso(state.modeSince),
    gate: {
      locked,
      lockedReason: locked ? "CLOUD_SUPERVISOR_HEALTHY_RESERVE_NOT_REQUIRED" : "RESERVE_MODE_ACTIVE_LOCAL_SUPERVISOR_EDGE_IS_AUTHORITY",
      unlockCondition: "cloud unresponsive/degraded for 2 consecutive probes while the local reserve edge (:3031) is reachable",
      lockCondition: `cloud HEALTHY for ${RESTORE_STREAK} probes and fallback residency >= ${MIN_FALLBACK_RESIDENCY_MS / 1000}s`,
      reserveUsable,
    },
    failover: {
      enabled: true,
      cloudBase: CLOUD_SUPERVISOR_BASE,
      localBase: EDGE_BASE,
      degradeStreak: DEGRADE_STREAK,
      restoreStreak: RESTORE_STREAK,
      degradedLatencyMs: DEGRADED_LATENCY_MS,
      minFallbackResidencyMs: MIN_FALLBACK_RESIDENCY_MS,
    },
    targets: { cloud: state.cloud, local: state.local },
    probes: state.probes.slice(-24),
    transitions: state.transitions.slice(-16),
    drills: state.drills.slice(-8),
    simulation: { active: simulationActive, until: simulationActive ? iso(state.simulateUntil) : null },
    counters: { probesTotal: state.probesTotal, transitionsTotal: state.transitionsTotal, drillsTotal: state.drillsTotal },
    authorityEffect: false,
  };
}

function freshState(): SentinelState {
  return {
    cloud: { base: CLOUD_SUPERVISOR_BASE, state: "UNKNOWN", okStreak: 0, failStreak: 0, notHealthyStreak: 0, latencyMs: null, status: null, lastError: null, lastProbeAt: null },
    local: { base: EDGE_BASE, state: "UNKNOWN", okStreak: 0, failStreak: 0, notHealthyStreak: 0, latencyMs: null, status: null, lastError: null, lastProbeAt: null },
    mode: "CLOUD_AUTHORITY",
    modeSince: Date.now(),
    modeReason: "BOOT_DEFAULT_CLOUD_PINNED",
    probes: [],
    transitions: [],
    drills: [],
    probesTotal: 0,
    transitionsTotal: 0,
    drillsTotal: 0,
    simulateUntil: 0,
    lastTickAt: 0,
    tickInFlight: null,
  };
}

export interface FallbackConsole {
  tickIfDue(): Promise<FallbackSnapshot>;
  forceTick(): Promise<FallbackSnapshot>;
  drill(): Promise<DrillRecord>;
  setSimulation(enabled: boolean, seconds?: number): Promise<FallbackSnapshot>;
}

export function getFallbackConsole(): FallbackConsole {
  const g = globalThis as unknown as { __metaengineFallbackConsole?: SentinelState };
  const state = g.__metaengineFallbackConsole ?? freshState();
  g.__metaengineFallbackConsole = state;

  return {
    async tickIfDue() {
      if (Date.now() - state.lastTickAt < MIN_TICK_INTERVAL_MS) return snapshot(state);
      if (!state.tickInFlight) {
        state.tickInFlight = tick(state).finally(() => {
          state.tickInFlight = null;
        });
      }
      await state.tickInFlight;
      return snapshot(state);
    },
    async forceTick() {
      await tick(state);
      return snapshot(state);
    },
    async drill() {
      const health = await edgeHealth(2500);
      const record: DrillRecord = {
        ok: health.ok,
        base: EDGE_BASE,
        latencyMs: health.ms,
        status: health.ok ? 200 : 0,
        error: health.error ?? (health.ok ? null : "health_not_ok"),
        at: iso(Date.now()),
      };
      state.drillsTotal += 1;
      state.drills.push(record);
      if (state.drills.length > 16) state.drills.splice(0, state.drills.length - 16);
      return record;
    },
    async setSimulation(enabled, seconds = SIMULATION_DEFAULT_SECONDS) {
      state.simulateUntil = enabled ? Date.now() + seconds * 1000 : 0;
      return this.forceTick();
    },
  };
}
