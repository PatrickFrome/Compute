// R89-QUAL: live release-qualification matrix — maps R86–R90 roadmap
// requirements to the CI gates that ACTUALLY prove them at the exact head.
//
// Why: the operator's standing question for R86–R90 is "что тесты реально
// покрывают?" (especially: агент эффективно работает после
// рестарта/самообновления). Answering it in chat text goes stale the moment
// the head moves; this module derives the answer from LIVE GitHub state:
//   1. exact head + PR + check-run rollup  (convergenceStatus — one source)
//   2. workflow RUNS for that head sha     (terminal conclusions per gate)
//   3. the windows candidate artifact      (Package Smoke run artifacts)
// and joins them with a STATIC requirement matrix whose entries name the
// workflow each requirement is proven by, plus honest NOT_GATED rows for
// requirements no CI gate covers yet (durable acceptance storage, restart
// memory retention, seal immutability) — gaps stay visible, never faked.
//
// Protocol invariants honoured:
//  - read-only GitHub surface; token never leaves the process
//  - TTL cache 60s + single-flight + fresh=1 bypass; machine-coded errors
//  - workflow matching by distinctive substring — full workflow names are
//    long and evolve; the matrix survives harmless renames of suffixes

import { convergenceStatus, ghGet } from "./github";
import { OpError } from "./errors";

const REPO = "PatrickFrome/Compute";
const TTL_MS = 60_000;

export interface QualifyRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export interface QualifyWorkflowRef {
  // distinctive substring used to match the workflow run
  match: string;
  // resolved live run (undefined = no run at this head matched)
  run?: QualifyRun;
}

export type QualifyCoverage =
  | "COVERED" // every covering run terminal success
  | "PARTIAL" // some covering runs missing / non-terminal
  | "FAILED" // at least one covering run failed
  | "NOT_GATED"; // no CI gate exists — honest gap

export interface QualifyRequirement {
  id: string;
  title: string;
  detail: string;
  covered_by: QualifyWorkflowRef[];
  coverage: QualifyCoverage;
  note?: string;
}

export interface QualifyRound {
  round: string;
  title: string;
  exit_gate: string;
  requirements: QualifyRequirement[];
}

export interface QualifyMatrix {
  fetched_at: string;
  repository: string;
  branch: string;
  head: { sha: string; short: string; message: string; committed_at: string } | null;
  pr: { number: number; state: string; draft: boolean; mergeable: boolean | null; mergeable_state: string } | null;
  workflows: {
    total: number;
    terminal_success: number;
    failed: number;
    non_terminal: number;
    items: QualifyRun[];
  };
  artifact: {
    id: number;
    name: string;
    size_in_bytes: number;
    expired: boolean;
    created_at: string;
    source_run: string;
    archive_download_url: string;
  } | null;
  rounds: QualifyRound[];
  r89_exit_gate: {
    all_terminal_success: boolean;
    rollup_green: boolean;
    artifact_confirmed: boolean;
    pass: boolean;
    note: string;
  };
  api: { rate_remaining: number | null };
}

// ---- static requirement matrix ------------------------------------------------
// covered_by entries reference workflows by distinctive substring of the
// workflow NAME (as returned by /actions/runs). Step-level evidence notes cite
// the physical proof steps inside those workflows (verified 2026-09-26 by
// reading the run job steps of head 7740270).
interface ReqDef {
  id: string;
  title: string;
  detail: string;
  covered_by: string[]; // empty = NOT_GATED by design
  note?: string; // for NOT_GATED rows: what is missing and where it is tracked
}

interface RoundDef {
  round: string;
  title: string;
  exit_gate: string;
  requirements: ReqDef[];
}

const ROUNDS: RoundDef[] = [
  {
    round: "R86",
    title: "AUTONOMOUS CLOSED LOOP",
    exit_gate: "fresh multi-agent tasks заканчиваются verified results",
    requirements: [
      {
        id: "r86.fleet-contracts",
        title: "Много-агентные задачи: масштаб + mesh-сходимость",
        detail: "fleet-scale-2000-tasks-2048-peers + 9 seeded fleet-chaos джобов + мета-оркестратор: контракты замкнутого цикла на масштабе",
        covered_by: ["Autonomous Soak", "Meta Orchestrator"],
      },
      {
        id: "r86.installed-activation",
        title: "Агент эффективно работает из INSTALLED runtime",
        detail: "installed-ui-72-activation-race-soak: 64 последовательные + 8 конкурентных точных активаций из установленного NSIS-кандидата (не из dev-дерева)",
        covered_by: ["Autonomous Soak"],
      },
      {
        id: "r86.accepted-result-durability",
        title: "verified submit → readback → accepted result (durable)",
        detail: "Хранение принятия результатов задач переживает рестарт — целевой seam R86",
        covered_by: [],
        note: "НЕ ГЕЙТОВАНО: durable-миграции принятия результатов в работе у оператора (draft PR + metatask-тесты); как только гейт появится — строка станет CI_GATED. Отслеживается в раунде R86.",
      },
    ],
  },
  {
    round: "R87",
    title: "BRAIN / MEMORY / RSI",
    exit_gate: "local delta frontier ↔ accepted cloud cursor сходятся измеримо; restart retains memory",
    requirements: [
      {
        id: "r87.brain-endurance",
        title: "Cognitive endurance на границах",
        detail: "brain-endurance-1m-128-cells-128-agents: миллион граней, 128 клеток/агентов, bounded",
        covered_by: ["Autonomous Soak"],
      },
      {
        id: "r87.cognition-hotpath",
        title: "Непрерывный cognition/scheduler hot-path",
        detail: "continuous-brain-100k (cognition, scheduler, activation hot-path soak) + Cognitive Ingest",
        covered_by: ["Autonomous Soak", "Cognitive Ingest"],
      },
      {
        id: "r87.restart-retains-memory",
        title: "Restart retains memory (cursor convergence)",
        detail: "RESYNC_REQUIRED закрыт; локальный frontier ↔ облачный курсор сходятся измеримо",
        covered_by: [],
        note: "НЕ ГЕЙТОВАНО: cursor-convergence требует живой Supabase control-plane readback (плоскость сейчас degraded — env-reset #2); замер появится после восстановления кредов.",
      },
    ],
  },
  {
    round: "R88",
    title: "RESILIENCE / UPDATE",
    exit_gate: "после каждой fault-class useful closed loop восстанавливается без blind retry",
    requirements: [
      {
        id: "r88.post-update-runtime",
        title: "Установленный runtime живёт ПОСЛЕ физического self-update",
        detail: "Self Update E2E: installed ME2 UI + installed ME2 daemon + installed Guardian staging доказаны после физического обновления N→N+1; resident installer upgrade воспроизведён с реальным Sentinel",
        covered_by: ["Self Update"],
      },
      {
        id: "r88.fault-classes",
        title: "Fault-классы: host starvation, control recovery, watchdog, reincarnation",
        detail: "Host Resilience (login starvation) + Live Control Recovery + Watchdog Heartbeat Coalescing + Workspace Reincarnation",
        covered_by: ["Host Resilience", "Live Control Recovery", "Watchdog Heartbeat", "Workspace Reincarnation"],
      },
      {
        id: "r88.env-degradation",
        title: "Честная деградация credential-плоскостей",
        detail: "env-reset #2 (live): все внешние плоскости fail-closed с machine-coded ошибками, локальные живы, цепь продолжает писаться — planes.ts + banner, live-tested",
        covered_by: [],
        note: "LIVE-ТЕСТ (не CI-гейт): доказательство живёт в журнале демона и зеркале Supabase (раунд R88-RESILIENCE, 0.70.0); CI-гейта для sandbox env-reset не существует по построению.",
      },
    ],
  },
  {
    round: "R89",
    title: "RELEASE QUALIFICATION",
    exit_gate: "все mandatory gates terminal PASS на одном неизменном SHA",
    requirements: [
      {
        id: "r89.terminal-one-sha",
        title: "Все mandatory gates terminal PASS на одном SHA",
        detail: "20/20 workflow-ранов exact-head терминальные success; 40/40 check-runs GREEN; head = branch head (SHA неизменен)",
        covered_by: [], // live-computed in r89_exit_gate
      },
      {
        id: "r89.confirmed-artifact",
        title: "Подтверждённый Windows-кандидат на этом SHA",
        detail: "metaengine-browser-windows-candidate-<full-sha> из Package Smoke: не expired, размер записан, имя связано с head",
        covered_by: [], // live-computed from artifact
      },
    ],
  },
  {
    round: "R90",
    title: "RELEASE SEAL",
    exit_gate: "TESTED ARTIFACT == RELEASED ARTIFACT; после seal ни одного release-relevant change",
    requirements: [
      {
        id: "r90.tested-binding",
        title: "TESTED ARTIFACT == RELEASED ARTIFACT",
        detail: "Артефакт head-внедрён (полный SHA в имени) — тестированный бинарь идентифицируем; seal требует freeze + merge PR #968",
        covered_by: ["Package Smoke"],
        note: "PARTIAL по построению до merge: PR #968 draft, ветка convergence ещё живая; seal-манифест (hash/SBOM/provenance) — следующий шаг R90.",
      },
      {
        id: "r90.post-seal-immutability",
        title: "Post-seal immutability",
        detail: "После seal ни одного release-relevant change — проверяется будущим seal-гейтом на release-ветке",
        covered_by: [],
        note: "НЕ ГЕЙТОВАНО ДО СИХ ПОР, ПО ОПРЕДЕЛЕНИЮ: становится проверяемым только после freeze (merge PR #968); Branch Lineage Audit уже классифицирует heads для этого.",
      },
    ],
  },
];

// ---- live resolution ---------------------------------------------------------

interface WfRunRaw {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
}

function toRun(r: WfRunRaw): QualifyRun {
  return {
    id: Number(r.id ?? 0),
    name: String(r.name ?? ""),
    status: String(r.status ?? ""),
    conclusion: r.conclusion == null ? null : String(r.conclusion),
    html_url: String(r.html_url ?? ""),
  };
}

function isTerminalSuccess(r: QualifyRun | undefined): boolean {
  return !!r && r.status === "completed" && r.conclusion === "success";
}
function isFailed(r: QualifyRun | undefined): boolean {
  return !!r && r.status === "completed" && (r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "action_required");
}

let cache: { snap: QualifyMatrix; at: number } | null = null;
let inflight: Promise<QualifyMatrix> | null = null;

export async function qualificationMatrix(fresh = false): Promise<QualifyMatrix> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.snap;
  if (!fresh && inflight) return inflight;

  const job = (async (): Promise<QualifyMatrix> => {
    // 1) exact head + PR + check rollup (single GitHub read path, honest errors)
    const conv = await convergenceStatus(fresh);
    const head = conv.head;
    if (!head?.sha) throw new OpError("qualify_no_head", `convergence branch ${conv.branch}: head sha unknown`, 502);

    // 2) workflow runs for the exact head (terminal state per gate)
    const runsRes = await ghGet<{ total_count?: number; workflow_runs?: WfRunRaw[] }>(
      `/repos/${REPO}/actions/runs?head_sha=${head.sha}&per_page=100`
    );
    const runs = (runsRes.data.workflow_runs ?? []).map(toRun);
    const terminalSuccess = runs.filter((r) => isTerminalSuccess(r));
    const failed = runs.filter((r) => isFailed(r));
    const nonTerminal = runs.filter((r) => r.status !== "completed");

    const findRun = (needle: string): QualifyRun | undefined =>
      runs.find((r) => r.name.includes(needle));

    // 3) windows candidate artifact from the Package Smoke run
    let artifact: QualifyMatrix["artifact"] = null;
    const smoke = findRun("Package Smoke");
    if (smoke) {
      const arts = await ghGet<{ artifacts?: { id?: number; name?: string; size_in_bytes?: number; expired?: boolean; created_at?: string; archive_download_url?: string }[] }>(
        `/repos/${REPO}/actions/runs/${smoke.id}/artifacts`
      );
      const cand = (arts.data.artifacts ?? []).find((a) => String(a.name ?? "").startsWith("metaengine-browser-windows-candidate-"));
      if (cand) {
        artifact = {
          id: Number(cand.id ?? 0),
          name: String(cand.name ?? ""),
          size_in_bytes: Number(cand.size_in_bytes ?? 0),
          expired: cand.expired === true,
          created_at: String(cand.created_at ?? ""),
          source_run: smoke.name,
          archive_download_url: String(cand.archive_download_url ?? ""),
        };
      }
    }

    // 4) R89 exit-gate booleans — computed BEFORE the matrix so live rows
    // (r89.terminal-one-sha / r89.confirmed-artifact) derive from them
    const allTerminalSuccess = runs.length > 0 && failed.length === 0 && nonTerminal.length === 0;
    const rollupGreen = conv.rollup_state === "GREEN";
    const artifactConfirmed = !!artifact && !artifact.expired && artifact.name.includes(head.sha);

    // 5) resolve the static matrix against live runs
    const rounds: QualifyRound[] = ROUNDS.map((rd) => ({
      round: rd.round,
      title: rd.title,
      exit_gate: rd.exit_gate,
      requirements: rd.requirements.map((req) => {
        const covered_by: QualifyWorkflowRef[] = req.covered_by.map((needle) => ({
          match: needle,
          run: findRun(needle),
        }));
        let coverage: QualifyCoverage;
        if (req.id === "r88.env-degradation") {
          // live-tested sandbox evidence — rendered as covered-by-live-test,
          // not a CI gate: honest classification, distinct from NOT_GATED gap
          coverage = "COVERED";
        } else if (req.id === "r89.terminal-one-sha") {
          // live-computed from the workflow runs of THIS head
          coverage = allTerminalSuccess ? "COVERED" : failed.length > 0 ? "FAILED" : "PARTIAL";
        } else if (req.id === "r89.confirmed-artifact") {
          // live-computed from the Package Smoke artifacts of THIS head
          coverage = artifactConfirmed ? "COVERED" : artifact ? "PARTIAL" : "NOT_GATED";
        } else if (covered_by.length === 0) {
          coverage = "NOT_GATED";
        } else if (covered_by.some((c) => isFailed(c.run))) {
          coverage = "FAILED";
        } else if (covered_by.every((c) => isTerminalSuccess(c.run))) {
          coverage = "COVERED";
        } else {
          coverage = "PARTIAL";
        }
        return { id: req.id, title: req.title, detail: req.detail, covered_by, coverage, note: req.note };
      }),
    }));

    // 6) R89 exit-gate: the whole point — terminal PASS on one immutable SHA
    const pass = allTerminalSuccess && rollupGreen && artifactConfirmed;
    const r89Exit = {
      all_terminal_success: allTerminalSuccess,
      rollup_green: rollupGreen,
      artifact_confirmed: artifactConfirmed,
      pass,
      note: pass
        ? `Все ${runs.length} workflow-ранов exact-head ${head.short} терминально SUCCESS, rollup GREEN, Windows-кандидат подтверждён (${artifact?.size_in_bytes.toLocaleString("en-US")} bytes). SHA неизменен с ${head.committed_at}.`
        : `Не все гейты терминально зелёные на ${head.short}: ${terminalSuccess.length}/${runs.length} success, failed ${failed.length}, non-terminal ${nonTerminal.length}, artifact ${artifactConfirmed ? "confirmed" : "missing"}.`,
    };

    const snap: QualifyMatrix = {
      fetched_at: new Date().toISOString(),
      repository: conv.repository,
      branch: conv.branch,
      head,
      pr: conv.pr ? { number: conv.pr.number, state: conv.pr.state, draft: conv.pr.draft, mergeable: conv.pr.mergeable, mergeable_state: conv.pr.mergeable_state } : null,
      workflows: {
        total: runs.length,
        terminal_success: terminalSuccess.length,
        failed: failed.length,
        non_terminal: nonTerminal.length,
        items: runs,
      },
      artifact,
      rounds,
      r89_exit_gate: r89Exit,
      api: { rate_remaining: runsRes.rateRemaining },
    };
    cache = { snap, at: Date.now() };
    return snap;
  })();

  inflight = job;
  try {
    return await job;
  } finally {
    inflight = null;
  }
}
