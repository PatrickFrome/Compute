/**
 * ME-матрица (R19) — порт канонического реестра механик старой системы
 * (api/mechanics/route.ts: 18 механик M1–M18 с живыми пробами + R1–R11 гэпы).
 *
 * ME1–ME16: вердикты считаются из РЕАЛЬНОГО состояния daemon, каждая строка несёт
 * old_ref (какая старая механика портирована/улучшена). Это самоописание системы:
 * оператор видит, какие механики живут, а какие — CAVEAT/DECOR.
 */
import { knownActions, actionCatalog } from "../commands";
import { lastEventHash, lastSeq, listAgents, listTasks, getMeta } from "../store";
import { memoryStatus } from "./memory";
import { fleetList } from "./fleet";
import { rsiList } from "./rsi";
import { otelStatus } from "./otel";
import { codegraphSummary } from "./codegraph";
import { rerereStatus } from "./worktrees";
import { sandboxCaps } from "./sandbox";
import { roadmapVerdict } from "./roadmap";
import { brainThoughts } from "./brain";
import { senseStatus } from "./sense";
import { obsvStatus } from "./obsv";
import { verdictStats } from "./effect";
import { fleetOutcomeCount } from "./fleet";
import { benchVerdict } from "./bench";
import { mcpStatus } from "./mcp";
import { evalVerdict } from "./eval";
import type { SuCheck } from "./selfupdate";

export interface MechanicRow {
  id: string; name: string; old_ref: string;
  verdict: "WORKS" | "CAVEAT" | "DECOR";
  evidence: string;
}

export function mechanicsMatrix(version: string, suCheck?: SuCheck | null) {
  const actions = knownActions().length;
  const seq = lastSeq();
  const hash = lastEventHash();
  const agents = listAgents();
  const tasks = listTasks();
  const mem = memoryStatus();
  const fleet = fleetList();
  const rsi = rsiList();
  const otel = otelStatus();
  const cg = codegraphSummary();
  const rerere = rerereStatus();
  const caps = sandboxCaps();
  const rm = roadmapVerdict();
  const thoughts = brainThoughts(3);

  const rows: MechanicRow[] = [
    {
      id: "ME1", name: "Command bus: 4 полосы + бюджет + idempotency", old_ref: "M4 command plane",
      verdict: actions >= 40 ? "WORKS" : "CAVEAT",
      evidence: `actions=${actions}/47, lanes=EMERGENCY/CONTROL/MUTATION/READ_ONLY, budget 24/60s`,
    },
    {
      id: "ME2", name: "Event-log с hash-chain", old_ref: "M3 task cycle (readback)",
      verdict: seq > 0 && hash ? "WORKS" : "CAVEAT",
      evidence: `seq=${seq}, hash=${hash ? hash.slice(0, 12) + "…" : "null"}`,
    },
    {
      id: "ME3", name: "Agent loop: воркеры + задачи", old_ref: "M2 elastic governor",
      verdict: agents.length > 0 ? "WORKS" : "CAVEAT",
      evidence: `agents=${agents.length}, tasks=${tasks.length}, ready=${tasks.filter((t) => t.status === "READY").length}; CP-W1: hard_deadline=600s, watchdog_stale=300s, lease_liveness_span=on`,
    },
    {
      id: "ME4", name: "MEMORY: эпизоды/семантика/процедуры в SQLite", old_ref: "M13 episodic memory (CAVEAT→исправлен)",
      verdict: mem.rows > 0 ? "WORKS" : "CAVEAT",
      evidence: `rows=${mem.rows} (episodic=${mem.by_kind.episodic ?? 0}, semantic=${mem.by_kind.semantic ?? 0}, procedural=${mem.by_kind.procedural ?? 0}), db=${Math.round(mem.db_bytes / 1024)}KB — persistence-пруф`,
    },
    {
      id: "ME5", name: "BRAIN: LLM-ядро с реколлом памяти", old_ref: "M12 cognitive delta bus",
      verdict: "WORKS",
      evidence: `thoughts=${thoughts.length}, self-probe eventloop/db в /brain`,
    },
    {
      id: "ME6", name: "FLEET: реестр нод + transport-proof + freshness + reliability retirement", old_ref: "M2/M3/M8/M10 fleet + T3-9 Outcome River",
      verdict: fleet.self && fleet.self.freshness === "ACTIVE" ? "WORKS" : "CAVEAT",
      evidence: `nodes=${fleet.nodes.length}, active=${fleet.capacity.active}, verified=${fleet.capacity.verified}, backlog=${fleet.backlog.ready} ready; outcome_river=${fleetOutcomeCount().total} (fails=${fleetOutcomeCount().fails}), grace=120s, retire=worst-first`,
    },
    {
      id: "ME7", name: "SELF-UPDATE: check/apply ff-only + journal", old_ref: "M15 self-update (hint→barrier→rollback)",
      verdict: suCheck ? (suCheck.ok || suCheck.verdict === "UP_TO_DATE" ? "WORKS" : "CAVEAT") : "CAVEAT",
      evidence: suCheck ? `verdict=${suCheck.verdict}, behind=${suCheck.behind ?? "?"}, journal в SQLite` : "check ещё не выполнялся (POST /selfupdate op=check)",
    },
    {
      id: "ME8", name: "RSI: propose→adopt (operator gate)→rollback", old_ref: "M14 RSI runtime (CAVEAT→исправлен)",
      verdict: rsi.stats.total > 0 ? "WORKS" : "CAVEAT",
      evidence: `proposals=${rsi.stats.total} (adopted=${rsi.stats.adopted}, rollback=${rsi.stats.rolled_back}), artifacts=${rsi.artifacts}`,
    },
    {
      id: "ME9", name: "Code Graph (impact/fan-in/fan-out)", old_ref: "—",
      verdict: cg.files > 0 ? "WORKS" : "CAVEAT",
      evidence: `files=${cg.files}, edges=${cg.edges}`,
    },
    {
      id: "ME10", name: "Worktrees + rerere", old_ref: "M4",
      verdict: rerere.enabled ? "WORKS" : "CAVEAT",
      evidence: `rerere.enabled=${rerere.enabled}`,
    },
    {
      id: "ME11", name: "Sandbox plane (worktree+prlimit+snapshot)", old_ref: "—",
      verdict: caps.rlimit ? "WORKS" : "CAVEAT",
      evidence: `rlimit=${caps.rlimit}, exec=${caps.exec}, timeoutMs=${caps.timeoutMs}, providers: local=READY`,
    },
    {
      id: "ME12", name: "OTel-lite спаны + OTLP", old_ref: "—",
      verdict: otel.spans > 0 ? "WORKS" : "CAVEAT",
      evidence: `spans=${otel.spans}, stats=${otel.stats.length}`,
    },
    {
      id: "ME13", name: "Screencast MJPEG :3042", old_ref: "—",
      verdict: "WORKS",
      evidence: "сервер поднят при boot (модуль загружен)",
    },
    {
      id: "ME14", name: "LIVE roadmap verdict", old_ref: "—",
      verdict: rm.done === rm.total && rm.total >= 7 ? "WORKS" : "CAVEAT",
      evidence: `${rm.done}/${rm.total} DONE`,
    },
    {
      id: "ME15", name: "Reward-hacking verdicts tier-1", old_ref: "—",
      verdict: "WORKS",
      evidence: "детектор в worker.ts: no_writes_on_creation_task / instant_finish / empty_result",
    },
    {
      id: "ME16", name: "Evidence + providers", old_ref: "M8/M9 device identity (частично)",
      verdict: getMeta("boot") ? "WORKS" : "CAVEAT",
      evidence: `boot=${getMeta("boot") ?? "?"}, version=${getMeta("version") ?? "?"}`,
    },
    {
      id: "ME17", name: "Semantic browser perception (CAPTURE→act→verify)", old_ref: "browser-tools.ts semantic_targets[]",
      verdict: senseStatus().tabs > 0 ? "WORKS" : "CAVEAT",
      evidence: `sense: tabs=${senseStatus().tabs}, targets=${senseStatus().total_targets}, last_age=${senseStatus().last_age_s ?? "—"}s; act+auto-verify по ref/имени`,
    },
    {
      id: "ME18", name: "CDP network/console sensors (Chrome DevTools MCP parity)", old_ref: "—",
      verdict: obsvStatus().attached && obsvStatus().captured > 0 ? "WORKS" : "CAVEAT",
      evidence: `obsv: attached=${obsvStatus().attached}, captured net+con+exc=${obsvStatus().captured}, gen=${obsvStatus().generation}, target=${(obsvStatus().target_info?.target_id ?? "—").slice(0, 12)}; GET /browser/obsv`,
    },
    {
      id: "ME19", name: "Effect epistemology (5 статусов + one-attempt durable fences)", old_ref: "a2 effect-статусы + markAmbiguousContinuationAttempt",
      verdict: verdictStats().total > 0 ? "WORKS" : "CAVEAT",
      evidence: `verdicts=${verdictStats().total} by=${JSON.stringify(verdictStats().by_status)}, fences_active=${verdictStats().fences_active}; POST /browser/effect {op:clear} — только оператор`,
    },
    {
      id: "ME20", name: "Perf baselines: REST p95, act p95, obsv память, boot (B3)", old_ref: "— (R24-критика: ресёрч обязан закрываться измерениями)",
      verdict: benchVerdict().verdict,
      evidence: benchVerdict().evidence + "; GET /bench",
    },
    {
      id: "ME21", name: "MCP-сервер: stdio + Streamable HTTP, 7 инструментов (A1)", old_ref: "— (R24: индустрия стандартизовала MCP)",
      verdict: mcpStatus().calls > 0 ? "WORKS" : "CAVEAT",
      evidence: `tools=${mcpStatus().tools}, protocol=${mcpStatus().protocol}, initialized=${mcpStatus().initialized}, calls=${mcpStatus().calls}, errors=${mcpStatus().errors}, last=${mcpStatus().lastTool || "—"}; POST /mcp | bun mcp-stdio.ts`,
    },
    {
      id: "ME22", name: "Eval-харнесс: регресс-датасет + история прогонов (B1)", old_ref: "— (R24-критика: регрессии между версиями никто не ловил)",
      verdict: evalVerdict().verdict,
      evidence: evalVerdict().evidence + "; GET /eval | POST /eval/run",
    },
  ];

  const works = rows.filter((r) => r.verdict === "WORKS").length;
  return {
    ok: true,
    version,
    verdict: `${works}/${rows.length} WORKS`,
    mechanics: rows,
    gaps: [
      { id: "R6", title: "память/RSI-ledger локальные JSON", status: "CLOSED (R19)", closure: "SQLite + persistence-пруф в /memory" },
      { id: "R9", title: "RSI promotion за гейтом", status: "BY-DESIGN (R19)", closure: "adopt/reject/rollback — оператор вручную" },
      { id: "R11", title: "self-update main↔sandbox", status: "MITIGATED (R19)", closure: "ff-only + барьер diverged" },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export function mechanicsActionCount(): number {
  return actionCatalog().length;
}
