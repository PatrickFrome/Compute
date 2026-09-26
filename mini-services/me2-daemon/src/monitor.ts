// Supervisor convergence monitor (R82 preparation).
// Samples the live supervisor snapshot every SAMPLE_INTERVAL_MS into a ring
// buffer so the console can chart convergence over time (heartbeat age,
// cycle_seq, stale completed cycle, cognitive resyncs).
// Protocol lessons honoured:
//  - sampling is SILENT: no event-log writes (R81-1: internal probes must not
//    pollute the evidence log)
//  - Supabase is polled at a bounded rate (1 request / 15s, well below the
//    live Browser's own heartbeat cadence)
import { supervisorSnapshot, SupervisorSnapshot } from "./controlplane";
import { STARTED_VERSION } from "./boot";

export interface MonitorSample {
  ts: string;
  uptime_ms: number;
  hb_age_s: number;
  cycle_seq: number;
  stale_completed_s: number | null;
  resync_count: number;
  ambiguous_history_count: number;
  keepalive_state: string;
  cognitive_state: string;
  compute_state: string;
  p0_count: number;
  // R82-EXIT: runtime identity per sample — the self-update landing shows up
  // here as an extension_version / dev_plane head transition, and the console
  // charts the exact moment the installed runtime picks up the merged release.
  extension_version: string;
  dev_plane_head: string;
  // R82-HARDEN: live rollover attempt identity per sample — the console charts
  // attempt churn (how many fresh rollover attempts the supervisor starts per
  // monitor window), and the attempt-change hook triggers opportunistic draft
  // probes while the fresh attempt tab is still alive.
  attempt_id: string | null;
  attempt_tab_id: string | null;
  rollover_reason: string | null;
}

const SAMPLE_INTERVAL_MS = 15_000;
const MAX_SAMPLES = 240; // 1 hour at 15s

let samples: MonitorSample[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let lastError: string | null = null;
let startedAt: string | null = null;

// R82-HARDEN: rollover-attempt change hook — fires when a NEW attempt_id
// appears in the live supervisor state (a fresh rollover tab just opened).
// The readback watch registers a callback that probes the draft canary
// immediately, while the attempt tab is still alive. Listener errors are
// swallowed (the monitor must never break on consumer bugs).
type AttemptHook = (attemptId: string, tabId: string | null) => void;
let attemptHook: AttemptHook | null = null;
let lastSeenAttemptId: string | null = null;

export function onRolloverAttempt(h: AttemptHook | null): void {
  attemptHook = h;
}

function takeSample(): void {
  supervisorSnapshot(true)
    .then((s: SupervisorSnapshot) => {
      lastError = null;
      const attempt = s.keepalive.rollover_attempt;
      const m: MonitorSample = {
        ts: s.fetched_at,
        uptime_ms: Date.now() - STARTED_VERSION.started_at_ms,
        hb_age_s: s.heartbeat_age_s,
        cycle_seq: s.keepalive.cycle_seq,
        stale_completed_s: s.keepalive.stale_completed_s,
        resync_count: s.cognitive.resync_count,
        ambiguous_history_count: s.keepalive.ambiguous_history_count,
        keepalive_state: s.keepalive.state,
        cognitive_state: s.cognitive.state,
        compute_state: s.compute_state,
        p0_count: s.p0_flags.length,
        extension_version: s.extension_version,
        dev_plane_head: (s.dev_plane.head ?? "").slice(0, 12),
        attempt_id: attempt?.attempt_id ?? null,
        attempt_tab_id: attempt?.tab_id ?? null,
        rollover_reason: s.keepalive.rollover_reason,
      };
      samples.push(m);
      if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
      // attempt-change detection: first observation seeds the baseline (a
      // stale pre-boot attempt must NOT fire the hook), later NEW ids fire
      if (m.attempt_id) {
        if (lastSeenAttemptId != null && m.attempt_id !== lastSeenAttemptId) {
          try {
            attemptHook?.(m.attempt_id, m.attempt_tab_id);
          } catch {
            /* hook errors must never break the sampler */
          }
        }
        lastSeenAttemptId = m.attempt_id;
      }
    })
    .catch((e: unknown) => {
      // bounded error surface: keep last error string for the console,
      // never throw from the sampler, keep the ring buffer intact
      lastError = String((e as Error)?.message ?? e).slice(0, 200);
    });
}

export function startMonitor(): void {
  if (timer) return;
  startedAt = new Date().toISOString();
  takeSample();
  timer = setInterval(takeSample, SAMPLE_INTERVAL_MS);
}

export function monitorStatus(): {
  running: boolean;
  started_at: string | null;
  interval_ms: number;
  capacity: number;
  sample_count: number;
  last_error: string | null;
} {
  return {
    running: !!timer,
    started_at: startedAt,
    interval_ms: SAMPLE_INTERVAL_MS,
    capacity: MAX_SAMPLES,
    sample_count: samples.length,
    last_error: lastError,
  };
}

export function monitorHistory(): { status: ReturnType<typeof monitorStatus>; samples: MonitorSample[] } {
  return { status: monitorStatus(), samples: [...samples] };
}
