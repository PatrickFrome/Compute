// R83-AUTONOMY: the R82 "before / after" diff report — release-readiness
// material for R89 (backlog item from R83-VERIFY: «После закрытия R82:
// diff-отчёт "до/после" (cycle_seq, stale, версии) — материал для R89»).
//
// The report compares the POISONED state at the R82 diagnosis (live-verified
// 2026-09-26, worklog-documented — the same baselines the exit gate uses)
// against the LIVE current state, metric by metric, and lays out the key
// timeline moments from durable sources (journal milestones + GitHub
// check-runs completed_at). Every "after" value is read live at request time —
// the report never assumes a stage; it FILLS IN as R82 converges, so it is
// useful both mid-gate (progress delta) and after closure (the final diff).
import { eventsOfType } from "./eventlog";
import { supervisorSnapshot, type SupervisorSnapshot } from "./controlplane";
import { releaseCi, BASELINE, draftHistory, type ReleaseCi, type GateStage } from "./readback";
import { VERSION } from "./version";

// ---------------------------------------------------------------------------
// BEFORE — the poisoned state, live-verified at the R82 diagnosis
// (2026-09-26 ~07:00Z; R81-PHASE0 audit + R82 live probes, worklog-documented).
// These are HISTORICAL FACTS, not live reads: the exact values the exit gate
// was built to leave behind.
// ---------------------------------------------------------------------------
const BEFORE = {
  diagnosed_at: "2026-09-26T07:00:00Z",
  keepalive_state: "ROLLOVER_AMBIGUOUS",
  rollover_reason: "TYPE_EFFECT_AMBIGUOUS",
  cycle_seq: BASELINE.cycle_seq,
  last_completed_cycle_at: "2026-09-24T22:35:42Z",
  stale_completed_s_approx: 111_600, // >31h at diagnosis time
  ambiguous_history_count: 32,
  extension_version: BASELINE.extension_version,
  dev_plane_head: BASELINE.dev_plane_head,
  draft_chars_first_probe: 28_432, // first live READ-ONLY probe (R82-EXIT round)
  cognitive_state: "RESYNC_REQUIRED",
  resync_count_approx: 2_300,
  fix_state: "PR #981 open (not merged)",
} as const;

const BEFORE_PROVENANCE =
  "живые пробы R81-PHASE0/R82 (2026-09-26): Supabase control-plane readback + READ-ONLY draft probes; зафиксировано в worklog до merge PR #981";

export interface ReportMetric {
  name: string;
  before: string;
  after: string;
  status: "improved" | "pending" | "same" | "regressed";
  note: string;
}

export interface ReportTimelineItem {
  at: string | null;
  event: string;
  source: "github" | "journal" | "live" | "pending";
  detail?: string;
}

export interface R82Report {
  ok: true;
  schema: "metaengine.r82.report.v1";
  generated_at: string;
  daemon_version: string;
  gate: { current: GateStage; closed: boolean };
  before: typeof BEFORE & { provenance: string };
  after: {
    fetched_at: string;
    extension_version: string;
    dev_plane_head: string;
    keepalive_state: string;
    rollover_reason: string | null;
    cycle_seq: number;
    stale_completed_s: number | null;
    last_completed_cycle_at: string | null;
    ambiguous_history_count: number;
    draft: { canary: string | null; chars: number | null; max_chars: number | null; cleared: boolean };
    cognitive: { state: string; resync_count: number; sent_events: number; acked: number };
    fix_state: string;
  };
  metrics: ReportMetric[];
  timeline: ReportTimelineItem[];
  verdict: string;
}

function isCanaryReason(r: string | null | undefined): boolean {
  return (
    r === "ROOT_DRAFT_OVERSIZED" ||
    (typeof r === "string" && (r.startsWith("ROLLOVER_ERROR:") || r.startsWith("ROLLOVER_AMBIGUOUS_NO_PROGRESS")))
  );
}

function fmtDur(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return "—";
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)} мин`;
  if (s < 172_800) return `${Math.round(s / 3600)} ч`;
  return `${Math.round(s / 86_400)} дн`;
}

export async function r82Report(fresh = false): Promise<R82Report> {
  const sup: SupervisorSnapshot = await supervisorSnapshot(fresh);
  let ci: ReleaseCi | null = null;
  let ciErr: string | null = null;
  try {
    ci = await releaseCi(fresh);
  } catch (e) {
    ciErr = String((e as Error)?.message ?? e).slice(0, 140);
  }

  // ---- live "after" values -------------------------------------------------
  const draftSamples = readbackDraftSamples();
  const lastDraft = draftSamples.length ? draftSamples[draftSamples.length - 1] : null;
  const maxChars = draftSamples.reduce((m, s) => (s.chars != null && s.chars > m ? s.chars : m), 0);
  const draftCleared =
    draftSamples.some((s) => s.canary === "OK") || eventsOfType("R82_DRAFT_CLEARED").length > 0;
  const cycleGrowth = sup.keepalive.cycle_seq - BASELINE.cycle_seq;
  const closed = cycleGrowth > 0 && (sup.keepalive.stale_completed_s ?? Infinity) < 3600;
  // R83-AUTONOMY (live finding 2026-09-26): the reason family is wider than
  // ROOT_DRAFT_OVERSIZED — live observed ROLLOVER_ERROR:* and
  // ROLLOVER_AMBIGUOUS_NO_PROGRESS_FRESH_TAB. The canary is a STICKY fact
  // (journal milestone R82_CANARY_CONFIRMED) — once machine-readable reasons
  // proved the new code executes, the metric stays improved even while the
  // current reason oscillates between family members.
  const canaryConfirmed = eventsOfType("R82_CANARY_CONFIRMED").length > 0;

  const after: R82Report["after"] = {
    fetched_at: sup.fetched_at,
    extension_version: sup.extension_version,
    dev_plane_head: sup.dev_plane.head.slice(0, 10),
    keepalive_state: sup.keepalive.state,
    rollover_reason: sup.keepalive.rollover_reason,
    cycle_seq: sup.keepalive.cycle_seq,
    stale_completed_s: sup.keepalive.stale_completed_s,
    last_completed_cycle_at: sup.keepalive.last_completed_cycle_at,
    ambiguous_history_count: sup.keepalive.ambiguous_history_count,
    draft: {
      canary: lastDraft?.canary ?? null,
      chars: lastDraft?.chars ?? null,
      max_chars: maxChars > 0 ? maxChars : null,
      cleared: draftCleared,
    },
    cognitive: {
      state: sup.cognitive.state,
      resync_count: sup.cognitive.resync_count,
      sent_events: sup.cognitive.sent_events,
      acked: sup.cognitive.acknowledged_through_sequence,
    },
    fix_state: ci?.head?.short === BASELINE.merge_head ? "PR #981 слит (merge head — release код)" : `release head ${ci?.head?.short ?? "?"}`,
  };

  // ---- metric-by-metric diff -----------------------------------------------
  const metrics: ReportMetric[] = [
    {
      name: "runtime версия",
      before: BEFORE.extension_version,
      after: after.extension_version,
      status: after.extension_version !== BEFORE.extension_version ? "improved" : "pending",
      note: "self-update rail: установленная сборка подхватила merge e7fccd08",
    },
    {
      name: "rollover_reason",
      before: BEFORE.rollover_reason,
      after: after.rollover_reason ?? "—",
      status: isCanaryReason(after.rollover_reason) || canaryConfirmed ? "improved" : "pending",
      note: "machine-readable причины = фиксы PR #981 физически исполняются (sticky: journal milestone R82_CANARY_CONFIRMED)",
    },
    {
      name: "cycle_seq",
      before: String(BEFORE.cycle_seq),
      after: `${after.cycle_seq}${cycleGrowth > 0 ? ` (+${cycleGrowth})` : ""}`,
      status: cycleGrowth > 0 ? "improved" : "pending",
      note: "полезный цикл супервизора: рост = rollover снова сходится",
    },
    {
      name: "stale полезного цикла",
      before: `>${fmtDur(BEFORE.stale_completed_s_approx)} (посл. ${BEFORE.last_completed_cycle_at})`,
      after: after.stale_completed_s != null ? fmtDur(after.stale_completed_s) : "—",
      status: (after.stale_completed_s ?? Infinity) < 3600 ? "improved" : cycleGrowth > 0 ? "pending" : "same",
      note: "свежесть последнего завершённого цикла (<1 ч = здоровый ритм)",
    },
    {
      name: "account-draft",
      before: `~${BEFORE.draft_chars_first_probe.toLocaleString("ru-RU")} chars (OVERSIZED)`,
      after: after.draft.chars != null ? `${after.draft.chars.toLocaleString("ru-RU")} chars (${after.draft.canary})` : `нет живой пробы (${after.draft.canary ?? "—"})`,
      status: after.draft.cleared ? "improved" : "pending",
      note: "очистка оператором (Ctrl+A+Delete) — единственное оставшееся действие",
    },
    {
      name: "keepalive state",
      before: BEFORE.keepalive_state,
      after: after.keepalive_state,
      status: after.keepalive_state === "ACTIVE" ? "improved" : cycleGrowth > 0 ? "pending" : "same",
      note: "ROLLOVER_AMBIGUOUS → ACTIVE когда rollover снова сходится",
    },
    {
      name: "ambiguous history",
      before: String(BEFORE.ambiguous_history_count),
      after: String(after.ambiguous_history_count),
      status: after.ambiguous_history_count < BEFORE.ambiguous_history_count ? "improved" : "same",
      note: "накопленная история неоднозначных rollover (монотонно растёт, не сбрасывается)",
    },
    {
      name: "cognitive transport",
      before: `${BEFORE.cognitive_state} (resync ~${BEFORE.resync_count_approx.toLocaleString("ru-RU")})`,
      after: `${after.cognitive.state} (resync ${after.cognitive.resync_count.toLocaleString("ru-RU")})`,
      status: after.cognitive.state === "CONVERGED" ? "improved" : "pending",
      note: "транспорт событий brain-потока — сойдётся за полезным циклом",
    },
  ];

  // ---- key moments (durable sources only) ----------------------------------
  const milestoneAt = (type: string): string | null => eventsOfType(type)[0]?.ts ?? null;
  const timeline: ReportTimelineItem[] = [
    {
      at: BEFORE.diagnosed_at,
      event: "Диагноз R82: отравленный account-draft + blank-zombie tabs + atomic-save race",
      source: "journal",
      detail: `${BEFORE.keepalive_state} · ${BEFORE.rollover_reason} · драфт ~${BEFORE.draft_chars_first_probe} chars`,
    },
    { at: ci?.head?.committed_at ?? null, event: `Merge PR #981 → ${BASELINE.merge_head} (release)`, source: ci ? "github" : "pending", detail: ci?.head?.message },
    { at: ci?.publish_manifest_completed_at ?? null, event: "publish-exact-verified-target SUCCESS — self-update rail жив", source: ci?.publish_manifest_completed_at ? "github" : "pending" },
    { at: milestoneAt("R82_SELF_UPDATE_LANDED"), event: "Установленный runtime обновился", source: milestoneAt("R82_SELF_UPDATE_LANDED") ? "journal" : "pending", detail: `baseline → ${after.extension_version}` },
    { at: milestoneAt("R82_CANARY_CONFIRMED"), event: "Канарей: новый код физически исполняется", source: milestoneAt("R82_CANARY_CONFIRMED") ? "journal" : "pending", detail: "machine-readable rollover_reason" },
    { at: milestoneAt("R82_DRAFT_CLEARED"), event: "Оператор очистил драфт", source: milestoneAt("R82_DRAFT_CLEARED") ? "journal" : "pending" },
    { at: milestoneAt("R82_CYCLE_RESUMED"), event: "cycle_seq пошёл — полезный цикл возобновился", source: milestoneAt("R82_CYCLE_RESUMED") ? "journal" : "pending", detail: `baseline ${BASELINE.cycle_seq} → ${after.cycle_seq}` },
  ];

  const improved = metrics.filter((m) => m.status === "improved").length;
  const verdict = closed
    ? `R82 ЗАКРЫТ: ${improved}/${metrics.length} метрик улучшено — цикл жив (stale ${fmtDur(after.stale_completed_s)}), рост cycle_seq +${cycleGrowth}. Материал для release-готовности R89.`
    : `Gate: ${gateFromCycle(sup, cycleGrowth)} — улучшено ${improved}/${metrics.length} метрик; осталось: очистка драфта оператором (Ctrl+A+Delete в new-chat композере chat.z.ai) → рост cycle_seq.`;

  return {
    ok: true,
    schema: "metaengine.r82.report.v1",
    generated_at: new Date().toISOString(),
    daemon_version: VERSION,
    gate: {
      current: gateFromCycle(sup, cycleGrowth),
      closed,
    },
    before: { ...BEFORE, provenance: BEFORE_PROVENANCE },
    after,
    metrics,
    timeline,
    verdict,
  };
}

function gateFromCycle(sup: SupervisorSnapshot, cycleGrowth: number): GateStage {
  if (cycleGrowth > 0 && (sup.keepalive.stale_completed_s ?? Infinity) < 3600) return "R82_CLOSED";
  if (cycleGrowth > 0) return "CYCLE_GROWTH";
  if (sup.extension_version !== BASELINE.extension_version) return "OPERATOR_CLEAR";
  return "SELF_UPDATE";
}

// The draft samples live in readback.ts module state (durable history warmed
// on boot). The report reuses the SAME in-memory history — no extra probe, no
// network: READ-ONLY discipline (probes are rate-limited and belong to the
// sampler alone).
function readbackDraftSamples(): { ts: string; chars: number | null; canary: string }[] {
  return draftHistory();
}
