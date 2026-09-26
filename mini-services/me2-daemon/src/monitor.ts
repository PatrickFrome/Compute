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
}

const SAMPLE_INTERVAL_MS = 15_000;
const MAX_SAMPLES = 240; // 1 hour at 15s

let samples: MonitorSample[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let lastError: string | null = null;
let startedAt: string | null = null;

function takeSample(): void {
  supervisorSnapshot(true)
    .then((s: SupervisorSnapshot) => {
      lastError = null;
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
      };
      samples.push(m);
      if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
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
