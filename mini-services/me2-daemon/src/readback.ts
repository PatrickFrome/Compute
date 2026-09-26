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
import { appendEvent, eventsOfType, type Me2Event } from "./eventlog";
import { ghGet } from "./github";
import { monitorHistory, onRolloverAttempt, type MonitorSample } from "./monitor";
import { probeDraft, ROOT_DRAFT_MAX_CHARS, type DraftProbe } from "./r82";
import { supervisorSnapshot } from "./controlplane";
import { VERSION } from "./version";
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
// R82-STICKY: draft history is now DURABLE — every sample is appended to
// data/draft-history.jsonl and reloaded on boot, so the console keeps the
// long arc (24h) across daemon restarts instead of losing the in-memory ring
// (the R82-HARDEN backlog item: "длинная история draft size, ring 4h").
const DRAFT_MAX_SAMPLES = 288; // 24 hours at 5 min
const DRAFT_HISTORY_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "draft-history.jsonl");
const CI_TTL_MS = 60_000;
// R82-HARDEN: opportunistic probes are triggered by the monitor the moment a
// NEW rollover attempt opens a fresh tab (attempt tabs live ~2.5 min before
// D-C7 closes them — the periodic 5-min sampler usually finds a dead tab).
// Rate limit keeps fastlane use bounded: at most one opportunistic probe per
// minute even if attempts churn faster.
const OPPORTUNISTIC_MIN_INTERVAL_MS = 60_000;

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
// Draft history (READ-ONLY periodic + opportunistic sampler, durable milestones)
// ---------------------------------------------------------------------------

export interface DraftSample {
  ts: string;
  tab_id: string | null;
  chars: number | null;
  canary: DraftProbe["canary"];
  // R82-HARDEN: where this sample came from — "periodic" (5-min timer) or
  // "opportunistic" (fired the moment the monitor saw a fresh rollover tab)
  source: "periodic" | "opportunistic";
  error?: string;
}

let draftSamples: DraftSample[] = [];
let draftTimer: ReturnType<typeof setInterval> | null = null;
let draftInFlight = false;
let lastOppoAt = 0;
// R82-STICKY: canary-family reasons observed THIS process lifetime — makes
// the CANARY stage sticky within a session (the journal milestone below makes
// it durable across restarts)
let canaryReasonsSeen: string[] = [];

// R82-STICKY: load the durable draft history on module init — the ring starts
// warm (up to 24h), so a daemon restart no longer blanks the console chart.
// Malformed lines are skipped (fail-open: history is evidence, not a gate).
(function loadDraftHistory(): void {
  try {
    if (!existsSync(DRAFT_HISTORY_PATH)) return;
    const lines = readFileSync(DRAFT_HISTORY_PATH, "utf8").split("\n").filter((l) => l.trim());
    for (const line of lines.slice(-DRAFT_MAX_SAMPLES)) {
      try {
        const s = JSON.parse(line) as DraftSample;
        if (s && typeof s.ts === "string" && s.canary) draftSamples.push(s);
      } catch {
        /* skip malformed line */
      }
    }
    // rolling trim: keep the file bounded too (append-only between boots)
    if (lines.length > DRAFT_MAX_SAMPLES * 2) {
      writeFileSync(DRAFT_HISTORY_PATH, lines.slice(-DRAFT_MAX_SAMPLES).join("\n") + "\n");
    }
  } catch {
    /* history must never break the daemon */
  }
})();

// R82-HARDEN (QA bug): one-shot milestones deduped against the DURABLE event
// log, not in-process flags — a daemon restart used to re-fire
// R82_SELF_UPDATE_LANDED (seq 298 + 316 duplicate). The log is the dedupe.
function milestoneInLog(type: string): boolean {
  return eventsOfType(type).length > 0;
}

function recordDraft(p: DraftProbe, source: DraftSample["source"]): void {
  const sample: DraftSample = { ts: p.ts, tab_id: p.tab_id, chars: p.chars, canary: p.canary, source, error: p.error };
  draftSamples.push(sample);
  if (draftSamples.length > DRAFT_MAX_SAMPLES) draftSamples = draftSamples.slice(-DRAFT_MAX_SAMPLES);
  // R82-STICKY: durable append — the long arc survives restarts (best-effort;
  // a write failure must never break the sampler)
  try {
    mkdirSync(dirname(DRAFT_HISTORY_PATH), { recursive: true });
    appendFileSync(DRAFT_HISTORY_PATH, JSON.stringify(sample) + "\n");
  } catch {
    /* durable history is best-effort */
  }
  // one-shot milestone: a live composer reads ≤ threshold — the poisoned
  // account-draft is gone (the manual step the whole R82 exit gate waits for).
  // Durable dedupe: fires at most once EVER (log-gated), idempotent across
  // daemon restarts; if the daemon was down during the clear, the first OK
  // read after boot still records the observed fact.
  if (p.canary === "OK" && !milestoneInLog("R82_DRAFT_CLEARED")) {
    appendEvent("R82_DRAFT_CLEARED", "operator", p.tab_id, {
      chars: p.chars,
      canary: p.canary,
      source,
      note: "account-draft cleared (observed by the READ-ONLY readback sampler)",
      daemon_version: VERSION,
    });
  }
}

async function sampleDraft(source: DraftSample["source"] = "periodic"): Promise<void> {
  if (draftInFlight) return;
  draftInFlight = true;
  try {
    recordDraft(await probeDraft(), source);
  } catch {
    // sampler never throws — errors land in the sample as probe.error
  } finally {
    draftInFlight = false;
  }
}

export function startReadbackWatch(): void {
  if (!draftTimer) {
    draftTimer = setInterval(() => void sampleDraft("periodic"), DRAFT_SAMPLE_MS);
    // first sample immediately (non-blocking)
    void sampleDraft("periodic");
  }
  // R82-HARDEN: opportunistic sampling — the monitor fires the hook the moment
  // a NEW rollover attempt starts. Live timeline (verified 2026-09-26):
  //   t+0s   attempt starts (no tab yet)
  //   t+15s  tab binds, account-draft hydrates into the composer
  //   t+15.3s canary aborts (ROOT_DRAFT_OVERSIZED) — poisoned case only
  //   t+15..55s D-C7 closes the aborted tab
  // A probe AT detection time races the tab binding (NO_TAB — observed live);
  // the probe is DELAYED +20s to hit the bound-tab window, with one +40s
  // retry if the tab was still not bound. In the cleared future the tab
  // survives as the conversation tab, so the OK read window is wide.
  onRolloverAttempt((_attemptId, _tabId) => {
    if (Date.now() - lastOppoAt < OPPORTUNISTIC_MIN_INTERVAL_MS) return;
    lastOppoAt = Date.now();
    setTimeout(() => {
      void sampleDraft("opportunistic").then(() => {
        // retry once if the tab wasn't bound yet at +20s
        const last = draftSamples[draftSamples.length - 1];
        if (last && last.source === "opportunistic" && last.canary === "NO_TAB") {
          setTimeout(() => void sampleDraft("opportunistic"), 20_000);
        }
      });
    }, 20_000);
  });
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
    new_code_active: boolean; // new machine-readable reasons observed → PR #981 code live
    // R82-STICKY: the canary is a HISTORICAL fact, not a current-state property
    // (same principle as draftCleared). Fields below expose the proof chain.
    observed_reasons: string[]; // deduped canary-family reasons ever observed
    confirmed_source: "live" | "monitor-history" | "journal" | null;
    confirmed_at: string | null;
  };
  draft: {
    samples: DraftSample[];
    last: DraftSample | null;
    max_chars: number | null;
    cleared: boolean;
    threshold: number;
  };
  // R82-HARDEN: rollover attempt churn within the monitor window — how many
  // fresh attempts the supervisor started (each opens a new tab, hydrates the
  // account draft, hits the oversized canary, aborts). The console charts
  // this as the live retry-loop heartbeat while the operator clear pends.
  attempts: {
    window_samples: number;
    distinct_attempts: number;
    current: { attempt_id: string; tab_id: string | null; started_at: string | null; ambiguous_reason: string | null } | null;
    rollover_reason: string | null;
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

// R82-HARDEN: reconstruct the self-update transition from the durable journal
// when the in-memory monitor ring buffer is empty (daemon restart) — the
// milestone event carries the exact from→to pair observed live. Deduped by
// from→to pair: the pre-hardening duplicate milestones (#298 + #316) describe
// the SAME transition and must render as one.
function reconstructTransition(events: Me2Event[]): { ts: string; from: string; to: string }[] {
  const out: { ts: string; from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const p = (e.payload ?? {}) as Any;
    if (typeof p.from === "string" && typeof p.to === "string") {
      const key = `${p.from}→${p.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ts: e.ts, from: p.from, to: p.to });
    }
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

  const liveTransitions = versionTransitions(history);
  const journalTransitions = liveTransitions.length > 0 ? [] : reconstructTransition(eventsOfType("R82_SELF_UPDATE_LANDED"));
  const transitions = [...liveTransitions, ...journalTransitions];
  const selfUpdateLanded = sup.extension_version !== BASELINE.extension_version || transitions.length > 0;
  // R82-STICKY (QA gate-flicker bug, observed live 2026-09-26): the canary
  // used to be recomputed from the CURRENT rollover_reason only — the reason
  // oscillates (ROOT_DRAFT_OVERSIZED ↔ ROLLOVER_ERROR:rollover_tab_never_committed
  // ↔ momentary gaps between attempts), so the gate flickered OPERATOR_CLEAR →
  // CANARY → OPERATOR_CLEAR between polls. A machine-readable reason once
  // observed is PROOF the new code physically executed — it can never un-happen.
  // Proof chain (any hit wins): live reason ∨ monitor-window history ∨ in-process
  // sticky set ∨ durable journal milestone (restart-safe).
  const isCanaryReason = (r: string | null | undefined): boolean =>
    r === "ROOT_DRAFT_OVERSIZED" || (typeof r === "string" && r.startsWith("ROLLOVER_ERROR:"));
  const reason = sup.keepalive.rollover_reason;
  const historyReasons = [...new Set(history.map((s) => s.rollover_reason).filter(isCanaryReason))];
  for (const r of historyReasons) if (!canaryReasonsSeen.includes(r)) canaryReasonsSeen.push(r);
  if (isCanaryReason(reason) && !canaryReasonsSeen.includes(reason)) canaryReasonsSeen.push(reason);
  const canaryInJournal = milestoneInLog("R82_CANARY_CONFIRMED");
  const newCodeActive = isCanaryReason(reason) || canaryReasonsSeen.length > 0 || canaryInJournal;
  const canarySource: "live" | "monitor-history" | "journal" | null = isCanaryReason(reason)
    ? "live"
    : canaryReasonsSeen.length > 0
      ? "monitor-history"
      : canaryInJournal
        ? "journal"
        : null;
  let canaryConfirmedAt: string | null = null;
  if (canarySource === "journal") {
    const ev = eventsOfType("R82_CANARY_CONFIRMED")[0];
    canaryConfirmedAt = ev?.ts ?? null;
  } else if (canarySource != null) {
    canaryConfirmedAt = sup.fetched_at;
  }

  const lastDraft = draftSamples.length > 0 ? draftSamples[draftSamples.length - 1] : null;
  const maxChars = draftSamples.reduce((m, s) => (s.chars != null && s.chars > m ? s.chars : m), 0);
  // R82-HARDEN: "cleared" is a HISTORICAL fact, not a current-state property —
  // once an OK canary read is observed (or the milestone is in the durable
  // log), the stage stays DONE even when later probes find no attempt tab
  // (after a successful rollover there are no more attempts to probe).
  const draftCleared =
    draftSamples.some((s) => s.canary === "OK") || milestoneInLog("R82_DRAFT_CLEARED");
  // R83-VERIFY: journal timestamp of the clear fact (live probe or inference)
  // — the DraftTimeline renders the milestone marker at exactly this moment.
  const draftClearedAt = draftCleared ? (eventsOfType("R82_DRAFT_CLEARED")[0]?.ts ?? null) : null;

  // attempt churn from the monitor window (live retry-loop heartbeat)
  const attemptIds = new Set(history.map((s) => s.attempt_id).filter((id): id is string => !!id));
  const currentAttempt = sup.keepalive.rollover_attempt;
  const attempts = {
    window_samples: history.filter((s) => s.attempt_id != null).length,
    distinct_attempts: attemptIds.size,
    current: currentAttempt
      ? {
          attempt_id: currentAttempt.attempt_id,
          tab_id: currentAttempt.tab_id,
          started_at: currentAttempt.started_at,
          ambiguous_reason: currentAttempt.ambiguous_reason,
        }
      : null,
    rollover_reason: sup.keepalive.rollover_reason,
  };

  const cycleGrowth = sup.keepalive.cycle_seq - BASELINE.cycle_seq;
  // monotonic growth: live-data-first (current cycle_seq above the poisoned
  // baseline is itself proof), with the monitor ring buffer as corroboration
  // for in-session transitions
  const seqs = history.map((s) => s.cycle_seq).filter((n) => Number.isFinite(n) && n > 0);
  let historyMonotonic = false;
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] > seqs[i - 1] && seqs[i] > BASELINE.cycle_seq) {
      historyMonotonic = true;
      break;
    }
  }
  const monotonic = sup.keepalive.cycle_seq > BASELINE.cycle_seq || historyMonotonic;

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
      title: "Новый код активен (machine-readable причины)",
      state: newCodeActive ? "DONE" : selfUpdateLanded ? "ACTIVE" : "PENDING",
      detail: newCodeActive
        ? `rollover_reason = ${reason ?? canaryReasonsSeen[canaryReasonsSeen.length - 1] ?? "?"}${canarySource === "live" ? " (live)" : canarySource ? ` (sticky: ${canarySource})` : ""} — фиксы PR #981 физически исполняются`
        : `rollover_reason = ${reason ?? "—"} (старый цикл)`,
    },
    {
      stage: "OPERATOR_CLEAR",
      title: "Оператор очистил драфт",
      state: draftCleared ? "DONE" : selfUpdateLanded ? "BLOCKED" : "PENDING",
      detail: draftCleared
        ? milestoneInLog("R82_DRAFT_CLEARED")
            ? `драфт ≤ ${ROOT_DRAFT_MAX_CHARS} chars — очистка зафиксирована в journal (milestone)`
            : `драфт ≤ ${ROOT_DRAFT_MAX_CHARS} chars (${lastDraft?.chars ?? "?"}) — живое чтение OK`
        : lastDraft?.canary === "OVERSIZED"
          ? `драфт ${lastDraft.chars} chars — ждём Ctrl+A+Delete от оператора (макс. наблюдённый: ${maxChars > 0 ? maxChars : "?"})`
          : lastDraft?.error
            ? `проба не удалась: ${lastDraft.error} — attempt-таб короткоживущ, oppo-сэмплер ловит новые попытки`
            : lastDraft
              ? `attempt-таб без композера (${lastDraft.canary}) — сэмплер повторит`
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
  // wording: стадия называется целью (прошедшее время), но summary обязано отражать СОСТОЯНИЕ,
  // а не цель — иначе ACTIVE-стадия читается как завершённая (QA-баг: «Runtime обновился — наблюдаем live»)
  const summary =
    currentGate === "R82_CLOSED"
      ? "R82 EXIT GATE ПРОЙДЕН: cycle_seq растёт, полезный цикл свежий"
      : activeStage
        ? activeStage.state === "BLOCKED"
          ? `gate: ${activeStage.stage} БЛОК: ${activeStage.title} — требует оператора`
          : `gate: ${activeStage.stage} в процессе: ждём «${activeStage.title}» (не завершено)`
        : `gate: ${currentGate}`;

  // one-shot milestones (durable evidence — deduped against the event log,
  // NOT in-process flags; restart-safe by construction)
  if (selfUpdateLanded && !milestoneInLog("R82_SELF_UPDATE_LANDED")) {
    appendEvent("R82_SELF_UPDATE_LANDED", "daemon", sup.client_id, {
      from: BASELINE.extension_version,
      to: sup.extension_version,
      dev_plane_head: sup.dev_plane.head,
      daemon_version: VERSION,
    });
  }
  // R82-STICKY: durable canary confirmation — makes the CANARY stage sticky
  // across daemon restarts (the observed reason family is proof the PR #981
  // fixes physically executed; it can never un-happen)
  if (newCodeActive && !milestoneInLog("R82_CANARY_CONFIRMED")) {
    appendEvent("R82_CANARY_CONFIRMED", "daemon", sup.client_id, {
      live_reason: isCanaryReason(reason) ? reason : null,
      observed_reasons: canaryReasonsSeen.length > 0 ? canaryReasonsSeen : isCanaryReason(reason) ? [reason] : [],
      source: canarySource,
      note: "machine-readable rollover reasons observed — PR #981 code physically executing",
      daemon_version: VERSION,
    });
  }
  // R82-HARDEN: a successful rollover REQUIRES a clean draft (the whole
  // causal chain) — cycle growth past the poisoned baseline is itself proof
  // the operator cleared the draft, even if no probe caught a live clean tab
  if (monotonic && !milestoneInLog("R82_DRAFT_CLEARED")) {
    appendEvent("R82_DRAFT_CLEARED", "daemon", sup.client_id, {
      chars: null,
      canary: "OK",
      source: "inference",
      note: "inferred from cycle_seq growth past the poisoned baseline — a successful rollover requires a clean draft",
      cycle_seq: sup.keepalive.cycle_seq,
      daemon_version: VERSION,
    });
  }
  if (monotonic && !milestoneInLog("R82_CYCLE_RESUMED")) {
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
    canary: {
      rollover_reason: sup.keepalive.rollover_reason,
      new_code_active: newCodeActive,
      observed_reasons: [...new Set([...canaryReasonsSeen, ...(isCanaryReason(reason) ? [reason] : [])])],
      confirmed_source: canarySource,
      confirmed_at: canaryConfirmedAt,
    },
    draft: {
      samples: [...draftSamples],
      last: lastDraft,
      max_chars: maxChars > 0 ? maxChars : null,
      cleared: draftCleared,
      cleared_at: draftClearedAt,
      threshold: ROOT_DRAFT_MAX_CHARS,
    },
    cycle: {
      baseline: BASELINE.cycle_seq,
      current: sup.keepalive.cycle_seq,
      growth: cycleGrowth,
      monotonic_growth_observed: monotonic,
      stale_completed_s: sup.keepalive.stale_completed_s,
    },
    attempts,
    stages,
    current_gate: currentGate,
    summary,
  };
}
