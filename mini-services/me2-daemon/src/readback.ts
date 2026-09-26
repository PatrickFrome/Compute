// R82-EXIT: self-update readback watch — the deterministic exit-gate state
// machine for the supervisor liveness fix (PR #981, merged e7fccd08).
//
// The gate sequence (each stage is verified against LIVE data, never assumed):
//   1. RELEASE_CI    — release-branch CI on the merge head reaches terminal
//                      (all check-runs completed, zero failures)
//   2. MANIFEST      — publish-exact-verified-target completes successfully
//                      (the self-update manifest rail goes live)
//   3. SELF_UPDATE   — installed runtime version leaves the pre-update
//                      baseline (0.7.0-dev.36089462649.1) — observed through
//                      the supervisor heartbeat / monitor ring buffer
//   4. CANARY        — rollover attempts report ROOT_DRAFT_OVERSIZED instead
//                      of TYPE_EFFECT_AMBIGUOUS (new code provably installed)
//   5. OPERATOR      — the poisoned account-draft is cleared manually
//                      (draft canary flips OVERSIZED → OK; probes stay READ-ONLY)
//   6. CYCLE_GROWTH  — cycle_seq grows past the poisoned baseline 2109 and
//                      the stale-cycle timer collapses back to seconds
//   7. R82 CLOSED    — monotonic cycle growth sustained
//
// Protocol invariants honoured:
//  - draft sampling is READ-ONLY (CAPTURE via the command fastlane; the R82
//    lesson: every insert into the poisoned composer grows the shared draft)
//  - internal sampling is SILENT (no event-log writes per probe — R81-1);
//    only one-shot MILESTONE transitions are appended as durable evidence
//    (each fires exactly once per transition, deduped in-process)
//  - secrets stay server-side; the GitHub client is the daemon's single
//    read path (github.ts ghGet)
import { appendEvent } from "./eventlog";
import { ghGet } from "./github";
import { monitorHistory, type MonitorSample } from "./monitor";
import { probeDraft, ROOT_DRAFT_MAX_CHARS, type DraftProbe } from "./r82";
import { supervisorSnapshot } from "./controlplane";
import { VERSION } from "./version";

const REPO = "PatrickFrome/Compute";
const RELEASE_BRANCH = "release/self-update-ambiguity-live-v2";

// Live-verified baselines (R82 diagnosis, 2026-09-26): the poisoned state
// the exit gate must provably leave behind.
export const BASELINE = {
  extension_version: "0.7.0-dev.36089462649.1",
  dev_plane_head: "cf747798",
  merge_head: "e7fccd08",
  cycle_seq: 2109,
} as const;

const DRAFT_SAMPLE_MS = 5 * 60_000; // 5 min — READ-ONLY, bounded fastlane use
const DRAFT_MAX_SAMPLES = 48; // 4 hours of draft history
const CI_TTL_MS = 60_000;

type Any = Record<string, any>;

// ---------------------------------------------------------------------------
// Release-branch CI rollup (terminal detection on the merge head)
// ---------------------------------------------------------------------------

export interface ReleaseCi {
  head: { sha: string; short: string; message: string; committed_at: string } | null;
  checks: {
    total: number;
    success: number;
    failed: number;
    cancelled: number;
    skipped: number;
    pending: number;
    in_progress: number;
    publish_manifest: "SUCCESS" | "FAILED" | "PENDING" | "NOT_FOUND";
    failed_names: string[];
  };
  terminal: boolean; // every check-run completed (no pending/in_progress)
  green: boolean; // terminal AND zero failures AND zero cancellations
}

let ciCache: { at: number; data: ReleaseCi } | null = null;

export async function releaseCi(fresh = false): Promise<ReleaseCi> {
  if (!fresh && ciCache && Date.now() - ciCache.at < CI_TTL_MS) return ciCache.data;
  const br = await ghGet<{ commit?: { sha?: string; commit?: { message?: string; committer?: { date?: string } } } }>(
    `/repos/${REPO}/branches/${encodeURIComponent(RELEASE_BRANCH)}`
  );
  const c = br.data.commit;
  const head = c
    ? {
        sha: String(c.sha ?? ""),
        short: String(c.sha ?? "").slice(0, 10),
        message: (String(c.commit?.message ?? "").split("\n")[0] ?? "").slice(0, 140),
        committed_at: String(c.commit?.committer?.date ?? ""),
      }
    : null;
  const cr = await ghGet<{
    check_runs?: { name?: string; status?: string; conclusion?: string | null }[];
  }>(`/repos/${REPO}/commits/${head?.sha ?? ""}/check-runs?per_page=100`);
  const runs = cr.data.check_runs ?? [];
  const checks: ReleaseCi["checks"] = {
    total: runs.length,
    success: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    pending: 0,
    in_progress: 0,
    publish_manifest: "NOT_FOUND",
    failed_names: [],
  };
  for (const r of runs) {
    const name = String(r.name ?? "");
    const status = String(r.status ?? "");
    const conclusion = r.conclusion == null ? null : String(r.conclusion);
    if (status !== "completed") {
      checks.pending++;
      if (status === "in_progress") checks.in_progress++;
    } else if (conclusion === "success") checks.success++;
    else if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required") {
      checks.failed++;
      checks.failed_names.push(name);
    } else if (conclusion === "cancelled") checks.cancelled++;
    else checks.skipped++;
    if (/publish-exact-verified-target/i.test(name)) {
      checks.publish_manifest =
        status !== "completed" ? "PENDING" : conclusion === "success" ? "SUCCESS" : "FAILED";
    }
  }
  const out: ReleaseCi = {
    head,
    checks,
    terminal: checks.total > 0 && checks.pending === 0,
    green: checks.total > 0 && checks.pending === 0 && checks.failed === 0 && checks.cancelled === 0,
  };
  ciCache = { at: Date.now(), data: out };
  return out;
}

// ---------------------------------------------------------------------------
// Draft history (READ-ONLY periodic sampler + one-shot milestones)
// ---------------------------------------------------------------------------

export interface DraftSample {
  ts: string;
  tab_id: string | null;
  chars: number | null;
  canary: DraftProbe["canary"];
  error?: string;
}

let draftSamples: DraftSample[] = [];
let draftTimer: ReturnType<typeof setInterval> | null = null;
let draftInFlight = false;
let lastDraftCanary: DraftProbe["canary"] | null = null;

function recordDraft(p: DraftProbe): void {
  draftSamples.push({ ts: p.ts, tab_id: p.tab_id, chars: p.chars, canary: p.canary, error: p.error });
  if (draftSamples.length > DRAFT_MAX_SAMPLES) draftSamples = draftSamples.slice(-DRAFT_MAX_SAMPLES);
  // one-shot milestone: the operator clears the poisoned draft (durable
  // evidence — this is the manual step the whole R82 exit gate waits for)
  if (lastDraftCanary === "OVERSIZED" && p.canary === "OK") {
    appendEvent("R82_DRAFT_CLEARED", "operator", p.tab_id, {
      chars: p.chars,
      canary: p.canary,
      note: "account-draft cleared manually (observed by the READ-ONLY readback sampler)",
      daemon_version: VERSION,
    });
  }
  if (p.canary === "OVERSIZED" || p.canary === "OK") lastDraftCanary = p.canary;
}

async function sampleDraft(): Promise<void> {
  if (draftInFlight) return;
  draftInFlight = true;
  try {
    recordDraft(await probeDraft());
  } catch {
    // sampler never throws — errors land in the sample as probe.error
  } finally {
    draftInFlight = false;
  }
}

export function startReadbackWatch(): void {
  if (draftTimer) return;
  draftTimer = setInterval(sampleDraft, DRAFT_SAMPLE_MS);
  // first sample immediately (non-blocking)
  void sampleDraft();
}

// ---------------------------------------------------------------------------
// Exit-gate state machine (all stages verified against live data)
// ---------------------------------------------------------------------------

export type GateStage =
  | "RELEASE_CI"
  | "MANIFEST"
  | "SELF_UPDATE"
  | "CANARY"
  | "OPERATOR_CLEAR"
  | "CYCLE_GROWTH"
  | "R82_CLOSED";

export interface StageInfo {
  stage: GateStage;
  title: string;
  state: "DONE" | "ACTIVE" | "PENDING" | "BLOCKED";
  detail: string;
}

export interface ReadbackStatus {
  ok: true;
  schema: "metaengine.r82.readback.v1";
  fetched_at: string;
  daemon_version: string;
  baseline: { extension_version: string; dev_plane_head: string; merge_head: string; cycle_seq: number };
  release_ci: ReleaseCi | null;
  release_ci_error: string | null;
  runtime: {
    extension_version: string;
    dev_plane_head: string;
    self_update_landed: boolean;
    version_transitions: { ts: string; from: string; to: string }[];
  };
  canary: {
    rollover_reason: string | null;
    new_code_active: boolean; // ROOT_DRAFT_OVERSIZED observed → PR #981 code live
  };
  draft: {
    samples: DraftSample[];
    last: DraftSample | null;
    max_chars: number | null;
    cleared: boolean;
    threshold: number;
  };
  cycle: {
    baseline: number;
    current: number;
    growth: number;
    monotonic_growth_observed: boolean;
    stale_completed_s: number | null;
  };
  stages: StageInfo[];
  current_gate: GateStage;
  summary: string;
}

function versionTransitions(samples: MonitorSample[]): { ts: string; from: string; to: string }[] {
  const out: { ts: string; from: string; to: string }[] = [];
  let prev: string | null = null;
  for (const s of samples) {
    if (prev != null && s.extension_version && s.extension_version !== prev) {
      out.push({ ts: s.ts, from: prev, to: s.extension_version });
    }
    if (s.extension_version) prev = s.extension_version;
  }
  return out;
}

export async function readbackStatus(fresh = false): Promise<ReadbackStatus> {
  const sup = await supervisorSnapshot(fresh);
  const history = monitorHistory().samples;

  let ciError: string | null = null;
  let ci: ReleaseCi | null = null;
  try {
    ci = await releaseCi(fresh);
  } catch (e: unknown) {
    ciError = String((e as Error)?.message ?? e).slice(0, 160);
  }

  const transitions = versionTransitions(history);
  const selfUpdateLanded = sup.extension_version !== BASELINE.extension_version || transitions.length > 0;
  const newCodeActive = sup.keepalive.rollover_reason === "ROOT_DRAFT_OVERSIZED";

  const lastDraft = draftSamples.length > 0 ? draftSamples[draftSamples.length - 1] : null;
  const maxChars = draftSamples.reduce((m, s) => (s.chars != null && s.chars > m ? s.chars : m), 0);
  const draftCleared =
    lastDraft?.canary === "OK" ||
    (newCodeActive && lastDraft?.canary !== "OVERSIZED" && lastDraft?.chars != null && lastDraft.chars <= ROOT_DRAFT_MAX_CHARS);

  const cycleGrowth = sup.keepalive.cycle_seq - BASELINE.cycle_seq;
  // monotonic growth: at least 2 distinct increasing cycle_seq values in history
  const seqs = history.map((s) => s.cycle_seq).filter((n) => Number.isFinite(n) && n > 0);
  let monotonic = false;
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] > seqs[i - 1] && seqs[i] > BASELINE.cycle_seq) {
      monotonic = true;
      break;
    }
  }

  // --- stage machine (each DONE requires live proof; BLOCKED = operator) ---
  const ciTerminal = ci?.terminal ?? false;
  const manifestPublished = ci?.checks.publish_manifest === "SUCCESS";
  const stages: StageInfo[] = [
    {
      stage: "RELEASE_CI",
      title: "Release CI terminal",
      state: ciTerminal ? (ci!.green ? "DONE" : "BLOCKED") : "ACTIVE",
      detail: ci
        ? ci.green
          ? `${ci.checks.success}/${ci.checks.total} SUCCESS на ${ci.head?.short ?? "?"}`
          : ciTerminal
            ? `терминален, но не зелёный: ${ci.checks.failed} failed, ${ci.checks.cancelled} cancelled`
            : `в процессе: ${ci.checks.success} success · ${ci.checks.pending} pending (${ci.checks.in_progress} in_progress)`
        : "GitHub недоступен",
    },
    {
      stage: "MANIFEST",
      title: "Self-update manifest опубликован",
      state: manifestPublished ? "DONE" : ciTerminal ? "BLOCKED" : "PENDING",
      detail: manifestPublished
        ? "publish-exact-verified-target SUCCESS — rail жив, runtime опрашивает hint каждые 5 мин"
        : `publish-exact-verified-target: ${ci?.checks.publish_manifest ?? "NOT_FOUND"}`,
    },
    {
      stage: "SELF_UPDATE",
      title: "Runtime обновился",
      state: selfUpdateLanded ? "DONE" : manifestPublished ? "ACTIVE" : "PENDING",
      detail: selfUpdateLanded
        ? `версия ушла с baseline: ${sup.extension_version} (dev_plane ${sup.dev_plane.head.slice(0, 10)})`
        : `runtime всё ещё ${BASELINE.extension_version} — ждём подхвата manifest (~5 мин после публикации)`,
    },
    {
      stage: "CANARY",
      title: "Новый код активен (ROOT_DRAFT_OVERSIZED)",
      state: newCodeActive ? "DONE" : selfUpdateLanded ? "ACTIVE" : "PENDING",
      detail: newCodeActive
        ? "rollover_reason = ROOT_DRAFT_OVERSIZED — фиксы PR #981 физически исполняются"
        : `rollover_reason = ${sup.keepalive.rollover_reason ?? "—"} (старый цикл)`,
    },
    {
      stage: "OPERATOR_CLEAR",
      title: "Оператор очистил драфт",
      state: draftCleared ? "DONE" : selfUpdateLanded ? "BLOCKED" : "PENDING",
      detail: draftCleared
        ? `драфт ≤ ${ROOT_DRAFT_MAX_CHARS} chars (${lastDraft?.chars ?? "?"}) — ручная очистка зафиксирована`
        : lastDraft?.canary === "OVERSIZED"
          ? `драфт ${lastDraft.chars} chars — ждём Ctrl+A+Delete от оператора (макс. наблюдённый: ${maxChars > 0 ? maxChars : "?"})`
          : lastDraft
            ? `attempt-таб без композера (${lastDraft.canary}) — сэмплер повторит через 5 мин`
            : "сэмплер драфта ещё не снял первый сэмпл",
    },
    {
      stage: "CYCLE_GROWTH",
      title: "cycle_seq растёт",
      state: monotonic ? "DONE" : draftCleared ? "ACTIVE" : "PENDING",
      detail: monotonic
        ? `рост зафиксирован: baseline ${BASELINE.cycle_seq} → ${sup.keepalive.cycle_seq} (+${cycleGrowth})`
        : `cycle_seq ${sup.keepalive.cycle_seq} = baseline ${BASELINE.cycle_seq} (роста нет)`,
    },
    {
      stage: "R82_CLOSED",
      title: "R82 закрыт",
      state: monotonic && (sup.keepalive.stale_completed_s ?? Infinity) < 3600 ? "DONE" : "PENDING",
      detail:
        monotonic && (sup.keepalive.stale_completed_s ?? Infinity) < 3600
          ? `полезный цикл свежий (${sup.keepalive.stale_completed_s}s) — exit gate пройден`
          : `stale cycle ${sup.keepalive.stale_completed_s ?? "?"}s — gate открыт`,
    },
  ];

  const currentGate = stages.find((s) => s.state !== "DONE")?.stage ?? "R82_CLOSED";
  const activeStage = stages.find((s) => s.state === "ACTIVE" || s.state === "BLOCKED");
  const summary =
    currentGate === "R82_CLOSED"
      ? "R82 EXIT GATE ПРОЙДЕН: cycle_seq растёт, полезный цикл свежий"
      : activeStage
        ? `gate: ${activeStage.title} — ${activeStage.state === "BLOCKED" ? "требует оператора" : "наблюдаем live"}`
        : `gate: ${currentGate}`;

  // one-shot milestones (durable evidence, deduped by current state)
  if (selfUpdateLanded && !milestoneFired.self_update) {
    milestoneFired.self_update = true;
    appendEvent("R82_SELF_UPDATE_LANDED", "daemon", sup.client_id, {
      from: BASELINE.extension_version,
      to: sup.extension_version,
      dev_plane_head: sup.dev_plane.head,
      daemon_version: VERSION,
    });
  }
  if (monotonic && !milestoneFired.cycle_resumed) {
    milestoneFired.cycle_resumed = true;
    appendEvent("R82_CYCLE_RESUMED", "daemon", sup.client_id, {
      baseline: BASELINE.cycle_seq,
      current: sup.keepalive.cycle_seq,
      daemon_version: VERSION,
    });
  }

  return {
    ok: true,
    schema: "metaengine.r82.readback.v1",
    fetched_at: new Date().toISOString(),
    daemon_version: VERSION,
    baseline: { ...BASELINE },
    release_ci: ci,
    release_ci_error: ciError,
    runtime: {
      extension_version: sup.extension_version,
      dev_plane_head: sup.dev_plane.head,
      self_update_landed: selfUpdateLanded,
      version_transitions: transitions,
    },
    canary: { rollover_reason: sup.keepalive.rollover_reason, new_code_active: newCodeActive },
    draft: {
      samples: [...draftSamples],
      last: lastDraft,
      max_chars: maxChars > 0 ? maxChars : null,
      cleared: draftCleared,
      threshold: ROOT_DRAFT_MAX_CHARS,
    },
    cycle: {
      baseline: BASELINE.cycle_seq,
      current: sup.keepalive.cycle_seq,
      growth: cycleGrowth,
      monotonic_growth_observed: monotonic,
      stale_completed_s: sup.keepalive.stale_completed_s,
    },
    stages,
    current_gate: currentGate,
    summary,
  };
}

const milestoneFired = { self_update: false, cycle_resumed: false };
