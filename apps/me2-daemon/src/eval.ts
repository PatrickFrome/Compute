/**
 * ME2 daemon — eval-харнесс / регресс-датасет (R26, пункт B1 из research/2026/R24-AUDIT-ROADMAP.md §7).
 *
 * Зачем: R24-критика — «ресёрч обязан закрываться измерениями», но ME-матрица считает
 * вердикты ad hoc, а регрессии между версиями никто не ловит: после каждого порта
 * мы проверяли руками. Это замкнутый контур:
 *
 *  - ДАТАСЕТ (versioned): N декларативных проверок золотого пути, каждая — read-only,
 *    быстрая (<20ms), идемпотентная, без сети и spawnSync (урок R25: сетевое — только async);
 *  - ХАРНЕСС: прогон всех чеков с таймингами, вердикт PASS/WARN/FAIL
 *    (FAIL = упал хотя бы один critical, WARN — только некритичные);
 *  - ИСТОРИЯ в SQLite (eval_runs, cap 100): регрессии видны в динамике между версиями;
 *  - АВТОПРОГОН при каждой инкарнации (boot+2.5s) — история накапливается сама;
 *  - REST: GET /eval (каталог + последний прогон + история), POST /eval/run (прогнать).
 *
 * Датасет — это КОНТРАКТ: bus=47 действий, MCP tools=7, пороги B3 и т.д. Если контракт
 * меняется осознанно — меняем датасет и поднимаем EVAL_DATASET_VERSION (история хранит
 * версию датасета, старые прогоны интерпретируются в контексте своей версии).
 *
 * REST вне шины (47/47 инвариант). Механика ME22.
 */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { db, emit } from "../store";
import { WS_PORT, CHAT_ROOT } from "./ports";
import { knownActions, actionCatalog } from "../commands";
import { lastSeq, lastEventHash, listAgents, listTasks, getMeta } from "../store";
import { memoryStatus, memWrite, memBlockEconomy, memEconCleanup } from "./memory";
import { fleetList, fleetOutcomeCount } from "./fleet";
import { verdictStats, fenceCheck } from "./effect";
import { obsvStatus } from "./obsv";
import { mcpStatus } from "./mcp";
import { benchSnapshot, BENCH_THRESHOLDS } from "./bench";
import { codegraphSummary } from "./codegraph";
import { otelStatus } from "./otel";
import { workGraph, OBJECTIVE_STATUSES } from "./objectives";
import { handoffList, handoffStats } from "./handoffs";
import { glmStatus, canonicalGlm, agentTag } from "./glm";
import { reviewStats } from "./reviewer";
import { approvalsStatus, gateCheck, APPROVAL_GATES } from "./approvals";
import { senseDiffs } from "./sense";
import { obsvPersistState } from "./obsv";
import { hygieneStatus } from "./dbhygiene";
import { evidenceStatus, verifyChain, recomputeHash } from "../evidence";
import { recordSpan } from "./otel";
import { poolStatus, poolScale, poolEvalLeaseCycle, POOL_MAX } from "./pool";
import { createTask, updateTask, rid } from "../store";
import {
  agentChatCreate, agentChatDelete, agentChatStatus, chatAppend, buildChatContext, agentChatClose, execChatToolSync,
  supervisorEnsure, interchatDeliver, unreadInterchat, agentChatGet, agentChatList, chatSetObjective, fleetDigest, normalizeChatModel,
  outcomeReport, outcomePending, meshHeartbeatApply,
} from "./agentchat";
import { capabilitiesJson, withContract, missionUiHtml, CONTRACT_VERSION } from "./contract";
import { livenessStatus, budgetStatus, nonBypassAudit, ENFORCED_WRITE_FAMILIES } from "./autonomy";
import { governorTestReset, governorInject429, governorBreakerState, governorStatus, governorCooldownForTest } from "./governor";
import { demandTick, demandStatus, demandConfig, demandConfigSet, demandTestReset, type DemandSnapshot } from "./demand";
import { policyAllows, policyCheckTool, tierForRole, policyReload, policyStatus, policyCaps } from "./policy";
import { cronAdd, cronList, cronTick, cronCancel, cronTestReset } from "./cron";
import { tokensEnsure, tokenSet, tokenGet, tokenDelete, tokenList, tokensStatus } from "./tokens";
import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const EVAL_DATASET_VERSION = 18;

db.exec(`
CREATE TABLE IF NOT EXISTS eval_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  passed INTEGER NOT NULL,
  warned INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  total INTEGER NOT NULL,
  version TEXT NOT NULL,
  dataset_version INTEGER NOT NULL,
  results TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_at ON eval_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_eval_runs_started ON eval_runs(started_at);
`);

export interface EvalCheckResult {
  id: string; plane: string; critical: boolean;
  ok: boolean; ms: number; evidence: string; expect: string;
}

export interface EvalReport {
  ok: true;
  dataset_version: number;
  run_id: string;
  started_at: string;
  duration_ms: number;
  verdict: "PASS" | "WARN" | "FAIL";
  passed: number; warned: number; failed: number; total: number;
  version: string;
  results: EvalCheckResult[];
}

export interface EvalCheck {
  id: string; plane: string; title: string;
  critical: boolean; expect: string;
  run: () => { ok: boolean; evidence: string };
}

const CANONICAL_EFFECT = new Set(["CONFIRMED", "NO_EFFECT_PROVEN", "FAILED_PRE_EFFECT", "FENCED", "AMBIGUOUS"]);

// ── ДАТАСЕТ: золотой путь daemon (read-only, без сети, без spawn) ──
// v1 (R26) — 20 чеков; v2 (R27) — +mc.workgraph_shape, mc.statuses_canonical = 22;
// v3 (R28) — рёбра task_handoff в workgraph_shape, +mc.tasks_statuses_canonical (HANDED_OFF),
//            +handoff.table_api = 24. Осознанное изменение контракта → версия поднята.
// v4 (R29) — +glm.currency (канон+drift флота), +reviewer.api (колонка/статистика) = 26.
// v5 (R30) — +approval.policies_canonical, +approval.gate_api (живой гейт-цикл с самоочисткой) = 28.
// v6 (R31) — +sense.diff_api, +obsv.persist_ttl, +db.hygiene = 31.
// v7 (R32) — +evidence.remote (доставка в облако: LIVE/LIVE-STORAGE или healer активен + outbox ограничен) = 32.
// v8 (R33) — +evidence.verify (hash-chain на живых данных + тампер-детект на чистой функции, critical) = 33.
// v9 (R34) — +pool.executors (E3: эксклюзивные lease, reap мёртвого lease, канон-модель воркеров, потолок scale; critical) = 34.
// v10 (R35) — +memory.economy (E5: экономная доставка — sticky-ядро, familiar-элиминация, тампер контента возвращает запись в свежие; critical) = 35.
// v11 (R36) — +agentchat.sessions (G1: сессия/история/контекст-бюджет/счётчики/закрытие; critical),
//             +agentchat.tools (G1: write→read→list roundtrip в workspace чата + path-escape заблокирован; critical) = 37.
//             Живой GLM-ход — НЕ в sync-харнесе (урок R25: сеть только async): доказывается живым REST-ходом в раунде (worklog).
// v12 (R36) — +agentchat.supervisor (G2: вечно-живущий супервизор — идемпотентный ensure, перерождение после смерти с новым id, роль SUPERVISOR; critical),
//             +agentchat.interchat (G2: межчатовая связь — доставка в историю цели с meta.from_chat, unread-счётчик, честные ошибки цели; critical) = 39.
// v13 (R37) — +agentchat.objective (G5: долгоживущая цель чата — set/обновление, чужая цель только для SUPERVISOR, цель в system-prompt хода и в дайджесте флота; critical),
//             +agentchat.pool_digest (G4: дайджест супервизора видит пул — слоты/lease/последний шаг FLEET_STEP исполнителя) = 41.
// v14 (R38) — +autonomy.liveness (P2+P3: синтетический RUNNING-перерасход + цикл handoff-графа детектятся; verdict STALLED пока синтетика жива; полный cleanup; critical),
//             +autonomy.budget (P7: взвешенный blast-radius — синтетические деструктивные события дают точный вклад; critical),
//             +autonomy.nonbypass (P1: все POST-маршруты из исходника index.ts покрыты enforcement-семействами В ОБЕ стороны; reviewer не пишет статусы; critical) = 44.
export const EVAL_DATASET: EvalCheck[] = [
  // — шина —
  {
    id: "bus.actions_contract", plane: "bus", title: "Контракт шины: 47 действий",
    critical: true, expect: "knownActions().length === 47 (контракт M1)",
    run: () => {
      const n = knownActions().length;
      return { ok: n === 47, evidence: `actions=${n}/47` };
    },
  },
  {
    id: "bus.lanes", plane: "bus", title: "4 полосы представлены в каталоге",
    critical: true, expect: "EMERGENCY/CONTROL/MUTATION/READ_ONLY ∈ actionCatalog()",
    run: () => {
      const lanes = new Set(actionCatalog().map((a) => a.lane));
      const need = ["EMERGENCY", "CONTROL", "MUTATION", "READ_ONLY"];
      const missing = need.filter((l) => !lanes.has(l));
      return { ok: missing.length === 0, evidence: missing.length ? `missing=${missing.join(",")}` : `lanes=${[...lanes].join("/")}` };
    },
  },
  // — state —
  {
    id: "events.hashchain", plane: "state", title: "Event-log hash-chain жив",
    critical: true, expect: "seq>0 и hash непуст",
    run: () => {
      const seq = lastSeq(); const h = lastEventHash();
      return { ok: seq > 0 && !!h, evidence: `seq=${seq}, hash=${h ? h.slice(0, 12) + "…" : "null"}` };
    },
  },
  {
    id: "meta.boot_version", plane: "state", title: "meta: boot+version записаны",
    critical: true, expect: "getMeta('boot') и getMeta('version') непусты",
    run: () => {
      const b = getMeta("boot"); const v = getMeta("version");
      return { ok: !!b && !!v, evidence: `boot=${b ?? "null"}, version=${v ?? "null"}` };
    },
  },
  // — агенты/задачи —
  {
    id: "agents.schema", plane: "agents", title: "Схема агентов/задач читаема",
    critical: true, expect: "listAgents()/listTasks() массивы, у задач строковый статус",
    run: () => {
      const ag = listAgents(); const tk = listTasks();
      const badStatus = tk.filter((t) => typeof t.status !== "string" || !t.status).length;
      return { ok: Array.isArray(ag) && Array.isArray(tk) && badStatus === 0, evidence: `agents=${ag.length}, tasks=${tk.length}, bad_status=${badStatus}` };
    },
  },
  // — память —
  {
    id: "memory.rows", plane: "memory", title: "Память непуста (persistence-пруф)",
    critical: true, expect: "memoryStatus().rows > 0",
    run: () => {
      const m = memoryStatus();
      return { ok: m.rows > 0, evidence: `rows=${m.rows} (episodic=${m.by_kind.episodic ?? 0})` };
    },
  },
  {
    id: "memory.db_file", plane: "memory", title: "SQLite-файл жив и растёт",
    critical: true, expect: "db_bytes > 1KB",
    run: () => {
      const m = memoryStatus();
      return { ok: m.db_bytes > 1024, evidence: `db=${Math.round(m.db_bytes / 1024)}KB` };
    },
  },
  {
    id: "memory.economy", plane: "memory",
    title: "Token-economy памяти (E5): sticky-ядро не элиминируется, familiar-элиминация экономит байты, тампер контента возвращает запись",
    critical: true,
    expect: "1-я доставка = полная (saved 0); 2-я неизменная = элиминация familiar (saved>0); изменение контента = запись снова свежая; журнал честный [0..1]",
    run: () => {
      const C = "eval:econ";
      try {
        // seed: sticky (0.9) + две не-sticky записи с длинным контентом (элиминация заметна)
        const a = memWrite({ kind: "semantic", key: "eval-econ-a", content: "STICKY урок: падение шины лечится рестартом демона.".repeat(3), importance: 0.9 });
        const b = memWrite({ kind: "semantic", key: "eval-econ-b", content: `eval econ filler B ${Date.now()} — текст для экономии байтов экономики памяти.`.repeat(4), importance: 0.4 });
        const c = memWrite({ kind: "semantic", key: "eval-econ-c", content: `eval econ filler C ${Date.now()} — второй филлер для familiar-элиминации.`.repeat(4), importance: 0.4 });
        const ids = [a.id, b.id, c.id];
        // 1-я доставка: sticky(a) остаётся сама, b,c свежие, знакомых нет → saved_pct = 0 (честный базлайн)
        const d1 = memBlockEconomy(C, 5, 8000, { ids });
        const firstOk = d1.metrics.sticky_n === 1 && d1.metrics.fresh_n === 2 && d1.metrics.familiar_n === 0 && d1.metrics.saved_pct === 0 && d1.metrics.bytes_full > 0;
        // 2-я доставка без изменений: b,c знакомы → элиминация, sticky остаётся
        const d2 = memBlockEconomy(C, 5, 8000, { ids });
        const secondOk = d2.metrics.familiar_n === 2 && d2.metrics.sticky_n === 1 && d2.metrics.saved_pct > 0 && d2.metrics.bytes_compact < d2.metrics.bytes_full;
        // 3-я: тампер контента b → b снова свежая (hash-изменение не теряется)
        memWrite({ kind: "semantic", key: "eval-econ-b", content: `eval econ filler B TAMPERED ${Date.now()} — контент изменён, запись обязана вернуться.`.repeat(4), importance: 0.4 });
        const d3 = memBlockEconomy(C, 5, 8000, { ids });
        const tamperOk = d3.metrics.fresh_n === 1 && d3.metrics.familiar_n === 1 && d3.block.includes("eval-econ-b");
        const ok = firstOk && secondOk && tamperOk;
        return { ok, evidence: `d1 fresh=${d1.metrics.fresh_n} saved=${d1.metrics.saved_pct} (${d1.metrics.bytes_full}b); d2 familiar=${d2.metrics.familiar_n} sticky=${d2.metrics.sticky_n} saved=${d2.metrics.saved_pct} (${d2.metrics.bytes_full}→${d2.metrics.bytes_compact}b); d3 после тампера b: fresh=${d3.metrics.fresh_n} familiar=${d3.metrics.familiar_n}` };
      } finally {
        // самоочистка: синтетические записи + следы consumer'а
        for (const k of ["eval-econ-a", "eval-econ-b", "eval-econ-c"]) {
          try { const r = db.query(`DELETE FROM memory WHERE key=?`).run(k); void r; } catch { /* noop */ }
        }
        try { memEconCleanup(C); } catch { /* noop */ }
      }
    },
  },
  // — флот —
  {
    id: "fleet.self_alive", plane: "fleet", title: "Self-нода флота жива (не LOST)",
    critical: true, expect: "self ≠ null и freshness ∈ {ACTIVE, STALE}",
    run: () => {
      const f = fleetList();
      const s = f.self;
      const ok = !!s && (s.freshness === "ACTIVE" || s.freshness === "STALE");
      const selfAge = f.nodes.find((n) => n.id === s?.id)?.age_s;
      return { ok, evidence: s ? `self=${s.freshness}, age=${selfAge ?? "?"}s, nodes=${f.nodes.length}` : "self=null" };
    },
  },
  {
    id: "fleet.outcome_api", plane: "fleet", title: "Outcome River API (ME6) валиден",
    critical: true, expect: "fleetOutcomeCount(): total≥0, fails≥0, fails≤total",
    run: () => {
      const c = fleetOutcomeCount();
      const ok = Number.isFinite(c.total) && Number.isFinite(c.fails) && c.total >= 0 && c.fails >= 0 && c.fails <= c.total;
      return { ok, evidence: `outcomes=${c.total}, fails=${c.fails}` };
    },
  },
  // — effect-эпистемология —
  {
    id: "effect.stats_shape", plane: "effect", title: "Эпистемология (ME19): статусы каноничны",
    critical: true, expect: "by_status ⊆ {CONFIRMED,NO_EFFECT_PROVEN,FAILED_PRE_EFFECT,FENCED,AMBIGUOUS}",
    run: () => {
      const s = verdictStats();
      const foreign = Object.keys(s.by_status).filter((k) => !CANONICAL_EFFECT.has(k));
      return { ok: foreign.length === 0, evidence: `verdicts=${s.total}, statuses=${Object.keys(s.by_status).join("+") || "—"}, fences_active=${s.fences_active}${foreign.length ? `, FOREIGN=${foreign.join(",")}` : ""}` };
    },
  },
  {
    id: "effect.fence_api", plane: "effect", title: "Fence API (ME19) читаем, таблица жива",
    critical: true, expect: "fenceCheck('…') → {fenced:boolean}; таблица effect_fences в SQLite",
    run: () => {
      const t = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='effect_fences'`).get();
      const probe = fenceCheck("__eval_probe_nonexistent__");
      const ok = !!t && typeof probe.fenced === "boolean" && probe.fenced === false;
      return { ok, evidence: `table=${t ? "yes" : "no"}, probe.fenced=${probe.fenced}` };
    },
  },
  // — obsv —
  {
    id: "obsv.status_shape", plane: "browser", title: "OBSV (ME18) статус-форма валидна",
    critical: false, expect: "obsvStatus(): attached:boolean, captured≥0 (atтач — факультативен)",
    run: () => {
      const s = obsvStatus();
      const ok = typeof s.attached === "boolean" && s.captured >= 0;
      return { ok, evidence: `attached=${s.attached}, captured=${s.captured}, gen=${s.generation}` };
    },
  },
  // — MCP —
  {
    id: "mcp.tools_contract", plane: "mcp", title: "Контракт MCP (ME21): 7 инструментов",
    critical: true, expect: "mcpStatus().tools === 7",
    run: () => {
      const s = mcpStatus();
      return { ok: s.tools === 7, evidence: `tools=${s.tools}, calls=${s.calls}, errors=${s.errors}, last=${s.lastTool || "—"}` };
    },
  },
  // — перф-бейслайны —
  {
    id: "perf.rest_p95", plane: "perf", title: "B3: REST hot p95 в пороге",
    critical: true, expect: `rest p95 ≤ ${BENCH_THRESHOLDS.rest_p95_ms}ms при n≥${BENCH_THRESHOLDS.min_samples} (иначе WARMUP-ok)`,
    run: () => {
      const b = benchSnapshot();
      const r = b.probes.rest;
      if (r.n < BENCH_THRESHOLDS.min_samples) return { ok: true, evidence: `WARMUP: rest n=${r.n}<${BENCH_THRESHOLDS.min_samples}` };
      const ok = (r.p95 ?? 0) <= BENCH_THRESHOLDS.rest_p95_ms;
      return { ok, evidence: `rest p95=${r.p95}ms ≤ ${BENCH_THRESHOLDS.rest_p95_ms} (n=${r.n})` };
    },
  },
  {
    id: "perf.boot", plane: "perf", title: "B3: boot в пороге",
    critical: true, expect: `boot_ms ≤ ${BENCH_THRESHOLDS.boot_max_ms} (null = ещё не замерен)`,
    run: () => {
      const b = benchSnapshot();
      const ok = b.boot_ms === null || b.boot_ms <= BENCH_THRESHOLDS.boot_max_ms;
      return { ok, evidence: `boot=${b.boot_ms ?? "null"}ms` };
    },
  },
  {
    id: "perf.obsv_mem", plane: "perf", title: "B3: obsv-буферы в бюджете памяти",
    critical: true, expect: `obsv_est ≤ ${BENCH_THRESHOLDS.obsv_max_mb}MB`,
    run: () => {
      const b = benchSnapshot();
      const ok = b.memory.obsv_est_mb <= BENCH_THRESHOLDS.obsv_max_mb;
      return { ok, evidence: `obsv_est=${b.memory.obsv_est_mb}MB, rss=${b.memory.rss_mb}MB` };
    },
  },
  {
    id: "perf.rss_guard", plane: "perf", title: "Страж RSS процесса",
    critical: false, expect: "rss < 500MB (некритично, сигнал для Track D)",
    run: () => {
      const b = benchSnapshot();
      return { ok: b.memory.rss_mb < 500, evidence: `rss=${b.memory.rss_mb}MB, heap=${b.memory.heap_mb}MB, sqlite=${b.memory.sqlite_mb}MB` };
    },
  },
  // — вспомогательные модули —
  {
    id: "codegraph.callable", plane: "meta", title: "Code Graph (ME9) читаем",
    critical: false, expect: "codegraphSummary(): files≥0, edges≥0",
    run: () => {
      const c = codegraphSummary();
      return { ok: c.files >= 0 && c.edges >= 0, evidence: `files=${c.files}, edges=${c.edges}` };
    },
  },
  {
    id: "spans.otel_ring", plane: "meta", title: "OTel-lite ring (ME12) жив",
    critical: false, expect: "otelStatus(): spans≥0 (наполнение — вопрос времени инкарнации)",
    run: () => {
      const s = otelStatus();
      return { ok: s.spans >= 0 && Array.isArray(s.stats), evidence: `spans=${s.spans}, stats=${s.stats.length}` };
    },
  },
  {
    id: "selfupdate.journal", plane: "meta", title: "Self-update журнал (ME7) в схеме",
    critical: false, expect: "таблица selfupdate_journal существует; verdict кэша — в evidence",
    run: () => {
      const t = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='selfupdate_journal'`).get();
      const rows = t ? (db.query(`SELECT COUNT(*) AS n FROM selfupdate_journal`).get() as { n: number }).n : -1;
      return { ok: !!t, evidence: `table=${t ? "yes" : "no"}, journal_rows=${rows}` };
    },
  },
  // — Mission Control (R27 C1) —
  {
    id: "mc.workgraph_shape", plane: "mc", title: "Work_graph (ME23) форма валидна",
    critical: true, expect: "workGraph(): fails_closed=true, статистика полная, рёбра только objective_task/task_agent/task_handoff (v3: +handoff)",
    run: () => {
      const g = workGraph();
      const kinds = new Set(g.edges.map((e) => e.kind));
      const foreign = [...kinds].filter((k) => k !== "objective_task" && k !== "task_agent" && k !== "task_handoff");
      const ok = g.fails_closed === true
        && typeof g.stats.objectives_total === "number"
        && typeof g.stats.tasks_orphan === "number"
        && typeof g.stats.handoffs === "number"
        && foreign.length === 0;
      return { ok, evidence: `objectives=${g.stats.objectives_total}, tasks_linked=${g.stats.tasks_linked}, orphan=${g.stats.tasks_orphan}, handoffs=${g.stats.handoffs}, edges=${g.stats.edges}${foreign.length ? `, FOREIGN=${foreign.join(",")}` : ""}` };
    },
  },
  {
    id: "mc.statuses_canonical", plane: "mc", title: "Статусы целей (ME23) каноничны",
    critical: true, expect: "status ∈ {ACTIVE,ACHIEVED,FAILED,PARKED}; derived ∈ {on_track,stalled,empty,achieved,failed,parked}",
    run: () => {
      const g = workGraph();
      const DERIVED = new Set(["on_track", "stalled", "empty", "achieved", "failed", "parked"]);
      const badStatus = g.objectives.filter((o) => !(OBJECTIVE_STATUSES as readonly string[]).includes(o.status));
      const badDerived = g.objectives.filter((o) => !DERIVED.has(o.derived_state));
      return { ok: badStatus.length === 0 && badDerived.length === 0, evidence: g.objectives.length ? `objectives=${g.objectives.length}, bad_status=${badStatus.length}, bad_derived=${badDerived.length}` : "objectives=0 (пусто — каноничность тривиальна)" };
    },
  },
  // — Handoffs (R28 C2) —
  {
    id: "mc.tasks_statuses_canonical", plane: "mc", title: "Статусы задач каноничны (v3: +HANDED_OFF)",
    critical: true, expect: "task.status ∈ {READY,RUNNING,COMPLETED,FAILED,REJECTED,CANCELLED,ARCHIVED,HANDED_OFF}",
    run: () => {
      const CANON = new Set(["READY", "RUNNING", "COMPLETED", "FAILED", "REJECTED", "CANCELLED", "ARCHIVED", "HANDED_OFF"]);
      const tk = listTasks({ includeArchived: true });
      const foreign = tk.filter((t) => !CANON.has(t.status));
      const byStatus: Record<string, number> = {};
      for (const t of tk) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      return { ok: foreign.length === 0, evidence: `tasks=${tk.length}, foreign=${foreign.length}, statuses=${JSON.stringify(byStatus)}` };
    },
  },
  {
    id: "handoff.table_api", plane: "handoff", title: "Handoff API (ME24) жив, таблица в схеме",
    critical: true, expect: "таблица handoffs; handoffList() массив с protocol_parsed.next; handoffStats(): total≥0, last_24h≥0",
    run: () => {
      const t = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='handoffs'`).get();
      const rows = handoffList(5);
      const s = handoffStats();
      const badProto = rows.filter((r) => !r.protocol_parsed || typeof r.protocol_parsed.next !== "string").length;
      const ok = !!t && Array.isArray(rows) && badProto === 0 && Number.isFinite(s.total) && s.total >= 0 && s.last_24h >= 0;
      return { ok, evidence: `table=${t ? "yes" : "no"}, rows=${rows.length}, total=${s.total}, 24h=${s.last_24h}, bad_proto=${badProto}` };
    },
  },
  // — GLM currency (R29, директива оператора) —
  {
    id: "glm.currency", plane: "glm", title: "GLM currency (ME25): весь флот на каноническом теге",
    critical: true, expect: `meta.glm_canonical непуст; все агенты на теге zai:<canonical> (drift=0); таблица glm_probes в схеме`,
    run: () => {
      const s = glmStatus();
      const t = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='glm_probes'`).get();
      const ok = !!canonicalGlm() && s.agents.total >= 0 && s.agents.drift === 0 && !!t;
      return { ok, evidence: `canonical=${s.canonical}, agents=${s.agents.total}, drift=${s.agents.drift}, tag=${s.agent_tag}, probes=${s.probes_total}, honoring=${s.platform_honoring}` };
    },
  },
  {
    id: "reviewer.api", plane: "review", title: "Reviewer API (ME26): колонка и статистика живы",
    critical: true, expect: "колонка tasks.review; reviewStats(): total≥0, by_verdict ⊆ {real,suspect,empty}",
    run: () => {
      const col = db.query(`SELECT name FROM pragma_table_info('tasks') WHERE name='review'`).get();
      const s = reviewStats();
      const bad = Object.keys(s.by_verdict).filter((k) => !["real", "suspect", "empty"].includes(k));
      const ok = !!col && Number.isFinite(s.total) && s.total >= 0 && bad.length === 0;
      return { ok, evidence: `column=${col ? "yes" : "no"}, reviews=${s.total}, by=${JSON.stringify(s.by_verdict)}` };
    },
  },
  // — Approval-политики (R30 C4) —
  {
    id: "approval.policies_canonical", plane: "approval", title: "Approval-политики (ME27): 3 гейта, режимы каноничны",
    critical: true, expect: `policies = ${APPROVAL_GATES.join(",")}; mode ∈ {require_approval, auto_approve}`,
    run: () => {
      const s = approvalsStatus();
      const gates = new Set(s.policies.map((p) => p.gate));
      const missing = APPROVAL_GATES.filter((g) => !gates.has(g));
      const badModes = s.policies.filter((p) => p.mode !== "require_approval" && p.mode !== "auto_approve");
      const ok = s.policies.length === APPROVAL_GATES.length && missing.length === 0 && badModes.length === 0;
      return { ok, evidence: `policies=${s.policies.length}/${APPROVAL_GATES.length}${missing.length ? `, MISSING=${missing.join(",")}` : ""}${badModes.length ? `, BAD_MODE=${badModes.map((p) => p.gate).join(",")}` : ""}; approvals=${s.stats.total} (pending=${s.stats.pending})` };
    },
  },
  {
    id: "approval.gate_api", plane: "approval", title: "Гейт-цикл (ME27) жив: unknown→denied, request→approve→consume",
    critical: true, expect: "FAILS-CLOSED: неизвестный гейт запрещён; живой цикл на пробном subject с самоочисткой",
    run: () => {
      const unknown = gateCheck("__no_such_gate__", "x", "x");
      if (unknown.allowed || !unknown.reason.startsWith("unknown_gate")) {
        return { ok: false, evidence: `unknown gate не отклонён: ${JSON.stringify(unknown)}` };
      }
      // живой цикл: denied → approve → consume; строки пробного subject удаляем (самоочистка)
      const d1 = gateCheck("rsi_adopt", "__eval_probe__", "eval-probe");
      if (d1.allowed || d1.reason !== "approval_required" || !d1.approval_id) {
        return { ok: false, evidence: `первый вызов не denied: ${JSON.stringify(d1).slice(0, 160)}` };
      }
      const id = d1.approval_id;
      db.query(`UPDATE approvals SET status='APPROVED', decided_at=? WHERE id=?`).run(Date.now(), id);
      const d2 = gateCheck("rsi_adopt", "__eval_probe__", "eval-probe");
      const consumed = db.query(`SELECT status FROM approvals WHERE id=?`).get(id) as { status: string } | undefined;
      const d3 = gateCheck("rsi_adopt", "__eval_probe__", "eval-probe");
      db.query(`DELETE FROM approvals WHERE subject='__eval_probe__'`).run();
      const ok = d2.allowed && consumed?.status === "CONSUMED" && !d3.allowed && d3.reason === "approval_required";
      return { ok, evidence: `unknown→denied; цикл: denied→approved→allowed(token)→${consumed?.status}→повтор denied (one-attempt) — пробные строки удалены` };
    },
  },

  // ── R31 Track D (sense-diffing / obsv-TTL / db-hygiene) ─────────
  {
    id: "sense.diff_api",
    plane: "sense",
    title: "Sense-diffing: дифы ревизий вместо полных снапшотов (D1)",
    critical: false,
    expect: "browser_sense_diff жива; записи либо нет (WARMUP), либо форма честная (0≤saved_pct≤100, counts≥0)",
    run: () => {
      const d = senseDiffs(undefined, 1);
      if (!d.total) return { ok: true, evidence: "WARMUP: диф-записей ещё нет — ≥2 sense-снимка с изменением страницы (GET /browser/sense/diffs)" };
      const r = d.rows[0];
      const ok = r.saved_pct >= 0 && r.saved_pct <= 100 && r.added_n >= 0 && r.removed_n >= 0 && r.revision.length > 0;
      return { ok, evidence: `дифов=${d.total}, last: +${r.added_n}/−${r.removed_n}/~${r.moved_n}, экономия ${r.saved_pct}% (${r.chars_diff}B vs ${r.chars_full}B)` };
    },
  },
  {
    id: "obsv.persist_ttl",
    plane: "obsv",
    title: "Obsv→SQLite TTL: история сенсоров переживает кольца памяти (D2)",
    critical: false,
    expect: "ttl_min∈[1..1440], кап 5000; флешей либо нет (WARMUP), либо без ошибки и очередь не растёт",
    run: () => {
      const st = obsvPersistState();
      const ttlOk = st.ttl_min >= 1 && st.ttl_min <= 1440;
      if (st.flushed_total === 0) return { ok: ttlOk, evidence: `WARMUP: флешей не было (ttl=${st.ttl_min}м, queue=${st.queue}) — подожди трафик вкладки` };
      const ok = ttlOk && !st.last_error && st.queue < 800;
      return { ok, evidence: `rows=${st.rows} (TTL ${st.ttl_min}м, кап 5000), флешей=${st.flushed_total}, queue=${st.queue}${st.last_error ? `, err=${st.last_error}` : ""}` };
    },
  },
  {
    id: "evidence.remote",
    plane: "state",
    title: "Evidence-зеркало: доставка в Supabase жива или само-заживление активно (R32)",
    critical: false,
    expect: "mode LIVE/LIVE-STORAGE, ЛИБО честный DEGRADED с активным DDL-хилером и ограниченным outbox (<500)",
    run: () => {
      const st = evidenceStatus();
      if (st.mode === "LIVE" || st.mode === "LIVE-STORAGE") return { ok: true, evidence: `mode=${st.mode}, method=${st.method}, pending=${st.pending}, storage.objects=${st.storage.objects}` };
      // R51 WARMUP: mirror выключен конфигурацией (probe/CI без env Supabase) — доставлять нечему, проверять нечего
      if (st.mode === "OFF") return { ok: true, evidence: `WARMUP: mirror off (probe/CI без env Supabase), pending=${st.pending}` };
      const healing = st.mode === "DEGRADED" && st.pending < 500 && st.ddl.retry_every_min > 0;
      return { ok: healing, evidence: `mode=${st.mode}, pending=${st.pending}, ddl.last=${st.ddl.last_result ?? "—"}, healer=${st.ddl.retry_every_min}м${st.last_error ? ", err=" + String(st.last_error).slice(0, 80) : ""}` };
    },
  },
  {
    id: "evidence.verify",
    plane: "state",
    title: "Hash-chain верифицируем: живая цепь ok + подделка данных детектится (E2, IETF)",
    critical: true,
    expect: "verifyChain на живых 200 событиях ok=true; recomputeHash(tampered) != recomputeHash(honest) — тампер детектится без мутации БД",
    run: () => {
      const v = verifyChain(undefined, undefined, 200);
      if (!v.ok) return { ok: false, evidence: `chain BROKEN at seq=${v.broken_at}: ${v.reason}` };
      // тампер-негатив: один байт данных → другой хеш (чистая функция, БД не трогаем)
      const honest = recomputeHash(null, "2026-01-01T00:00:00Z", "TAMPER.TEST", null, null, '{"a":1}');
      const tampered = recomputeHash(null, "2026-01-01T00:00:00Z", "TAMPER.TEST", null, null, '{"a":2}');
      const link = recomputeHash("abc", "2026-01-01T00:00:00Z", "TAMPER.TEST", null, null, '{"a":1}') !== honest; // смена prev тоже меняет хеш
      const tamperDetected = honest !== tampered && link;
      return { ok: tamperDetected, evidence: `chain ok ${v.checked} событий (${v.from}..${v.to}) за ${v.ms}ms, scheme=${v.scheme.split(",")[0]}, тампер-детект=${tamperDetected ? "ok" : "FAIL"}` };
    },
  },
  {
    id: "pool.executors",
    plane: "state",
    title: "Executor-пул: эксклюзивные lease, reap мёртвого, канон-модель, потолок scale (E3)",
    critical: true,
    expect: "scale(2) создаёт живых воркеров на каноническом теге (идемпотентно); второй acquire той же задачи = null; просроченный lease → задача FAILED pool_lease_expired; scale ограничен POOL_MAX",
    run: () => {
      // 1) scale idempotent + канон-модель воркеров (живые агенты реестра, drift остаётся 0)
      poolScale(2, "eval");
      const again = poolScale(2, "eval");
      const st = poolStatus();
      const liveOk = st.live === 2 && again.created === 0;
      const canonOk = st.workers.every((w) => w.model === `zai:${st.canonical}`);
      // 2) lease-цикл на синтетической задаче (синхронно — master-loop не вклинится между шагами)
      const t = createTask({ id: rid("task"), title: "eval pool lease cycle", spec: "eval-only lease mechanics", role: "EXECUTOR", max_steps: 1 } as Parameters<typeof createTask>[0]);
      const agentId = st.workers.find((w) => w.state === "IDLE")?.agent_id ?? st.workers[0]?.agent_id ?? "";
      const c = agentId ? poolEvalLeaseCycle(t.id, agentId) : { acquired: false, second_attempt: false, reaped: false };
      updateTask(t.id, { status: "ARCHIVED" }); // самоочистка (listTasks ARCHIVED не показывает)
      // 3) потолок масштабирования + возврат к 2
      const sMax = poolScale(POOL_MAX + 9, "eval");
      poolScale(2, "eval");
      const boundOk = sMax.scale === POOL_MAX;
      const ok = liveOk && canonOk && c.acquired && c.second_attempt && c.reaped && boundOk;
      return { ok, evidence: `live=${st.live}/2 идемпотент=${again.created === 0}, канон=${canonOk ? "ok" : "FAIL"}, lease: acquired=${c.acquired} second=${c.second_attempt} reaped=${c.reaped}, потолок=${sMax.scale}/${POOL_MAX}` };
    },
  },
  {
    id: "db.hygiene",
    plane: "state",
    title: "DB-гигиена: WAL checkpoint + freelist + индексы горячих запросов (D4)",
    critical: false,
    expect: "journal_mode=wal, page_count>0, есть idx_eval_runs_started/idx_tasks_status/idx_browser_obsv_ts; freelist<60% (иначе WARN)",
    run: () => {
      const st = hygieneStatus();
      const idxOk = ["idx_eval_runs_started", "idx_tasks_status", "idx_browser_obsv_ts"].every((i) => st.indexes.includes(i));
      const wal = st.db.journal_mode === "wal";
      const fragOk = st.db.freelist_pct < 60;
      const ok = wal && st.db.page_count > 0 && idxOk && fragOk;
      return { ok, evidence: `journal=${st.db.journal_mode}, pages=${st.db.page_count}, freelist=${st.db.freelist_pct}%, db=${st.db.file_mb}MB, wal=${st.db.wal_mb}MB, индексов=${st.indexes.length}${idxOk ? "" : " (нет горячих idx)"}` };
    },
  },
  {
    id: "agentchat.sessions",
    plane: "agentchat",
    title: "AgentChat (G1): сессия флота — история, контекст-бюджет, счётчики, закрытие",
    critical: true,
    expect: "create→append(user/assistant/tool)→buildChatContext содержит system-промпт и хвост в бюджете; status считает сессии/ходы; close переводит статус",
    run: () => {
      let s: ReturnType<typeof agentChatCreate> | null = null;
      try {
        s = agentChatCreate({ role: "CHAT", title: "eval-chat", model: "glm-eval-stub" });
        chatAppend(s.id, "user", "привет, собери статус демона");
        chatAppend(s.id, "assistant", JSON.stringify({ thought: "посмотрю pool", action: { tool: "daemon_status", args: {} } }));
        chatAppend(s.id, "tool", "pool: live=2/4; eval: PASS (35/35)");
        const ctx = buildChatContext({ ...s, summary: "ранняя сводка", compactions: 1 }, "CHAT");
        const sys = ctx.filter((m) => m.role === "system").map((m) => m.content).join("\n");
        const sysOk = sys.includes("постоянный агент-чат") && sys.includes("ранняя сводка") && sys.includes("reply");
        const tailRoles = ctx.slice(2).map((m) => `${m.role}:${m.content.slice(0, 12)}`);
        const tailOk = ctx.some((m) => m.role === "user" && m.content.includes("привет")) && ctx.some((m) => m.content.includes("[observation]"));
        const before = agentChatStatus().total;
        const closed = agentChatClose(s.id);
        const after = agentChatList({ status: "ACTIVE" }).filter((x) => x.id === s!.id).length;
        const ok = sysOk && tailOk && closed && after === 0 && before >= 1;
        return { ok, evidence: `session=${s.id}, ctx_msgs=${ctx.length} (system ok=${sysOk}, tail ok=${tailOk}), tail=[${tailRoles.join(" | ").slice(0, 90)}], close=${closed}, активных после=${after}, всего=${before}` };
      } finally {
        if (s) agentChatDelete(s.id);
      }
    },
  },
  {
    id: "agentchat.tools",
    plane: "agentchat",
    title: "AgentChat (G1): workspace-инструменты чата — write→read→list roundtrip + path-escape заблокирован",
    critical: true,
    expect: "write_file создаёт файл, read_file возвращает контент, list_dir видит его, ../-выход за workspace = path_escape_blocked",
    run: () => {
      let s: ReturnType<typeof agentChatCreate> | null = null;
      try {
        s = agentChatCreate({ role: "CHAT", title: "eval-chat-tools", model: "glm-eval-stub" });
        const fn = `eval-chat-${Date.now().toString(36)}.txt`;
        const w = execChatToolSync("write_file", { path: fn, content: "ME2-CHAT-TOOL-OK" }, s.id);
        const r = execChatToolSync("read_file", { path: fn }, s.id);
        const l = execChatToolSync("list_dir", { path: "." }, s.id);
        const esc = execChatToolSync("read_file", { path: "../../../etc/hostname" }, s.id);
        const ok = w.startsWith("OK:") && r === "ME2-CHAT-TOOL-OK" && l.includes(fn) && esc.includes("path_escape_blocked");
        return { ok, evidence: `write=${w.slice(0, 40)}, read=${r.slice(0, 20)}, list ok=${l.includes(fn)}, escape=${esc.slice(0, 40)}` };
      } finally {
        if (s) {
          try { rmSync(join(CHAT_ROOT, `chat_${s.id.slice(3, 11)}`), { recursive: true, force: true }); } catch { /* noop */ }
          agentChatDelete(s.id);
        }
      }
    },
  },
  {
    id: "agentchat.supervisor",
    plane: "agentchat",
    title: "AgentChat (G2): вечно-живущий супервизор — идемпотентный ensure, перерождение после смерти",
    critical: true,
    expect: "supervisorEnsure(title) создаёт SUPERVISOR-сессию; повторный ensure не дублирует (тот же id); close → ensure рождает НОВОГО с другим id (перезапускающийся)",
    run: () => {
      const TITLE = "eval-super";
      const ids: string[] = [];
      try {
        const a = supervisorEnsure(TITLE);
        if (a.id) ids.push(a.id);
        const again = supervisorEnsure(TITLE);
        const idemOk = !again.created && again.id === a.id;
        const s1 = a.id ? agentChatGet(a.id, 1)?.session ?? null : null;
        const roleOk1 = s1?.role === "SUPERVISOR";
        if (s1) agentChatClose(s1.id); // смерть супервизора
        const reborn = supervisorEnsure(TITLE); // перерождение (вечно-живущий)
        if (reborn.id) ids.push(reborn.id);
        const s2 = reborn.id ? agentChatGet(reborn.id, 1)?.session ?? null : null;
        const roleOk2 = s2?.role === "SUPERVISOR";
        const ok = idemOk && roleOk1 && reborn.created && reborn.id !== a.id && roleOk2;
        return { ok, evidence: `idem=${idemOk}, role1=${roleOk1}, умер → перерождение created=${reborn.created}, id сменился=${reborn.id !== a.id}, role2=${roleOk2} (${a.id}→${reborn.id})` };
      } finally {
        for (const id of ids) { try { agentChatDelete(id); } catch { /* noop */ } }
      }
    },
  },
  {
    id: "agentchat.interchat",
    plane: "agentchat",
    title: "AgentChat (G2): межчатовая связь — доставка в историю цели, unread-счётчик, честные ошибки",
    critical: true,
    expect: "interchatDeliver(a→b) кладёт user-сообщение с meta.from_chat=a в историю b; unreadInterchat(b)=1; цель не существует → target_not_found; цель закрыта → target_closed",
    run: () => {
      let a: ReturnType<typeof agentChatCreate> | null = null;
      let b: ReturnType<typeof agentChatCreate> | null = null;
      try {
        a = agentChatCreate({ role: "CHAT", title: "eval-ic-a", model: "glm-eval-stub" });
        b = agentChatCreate({ role: "CHAT", title: "eval-ic-b", model: "glm-eval-stub" });
        const r = interchatDeliver(a.id, b.id, "координация: сверка канала флота");
        const got = agentChatGet(b.id, 50);
        const delivered = got?.messages.some((m) => m.role === "user" && m.meta.from_chat === a!.id && m.content.includes("координация")) ?? false;
        const unread = unreadInterchat(b.id);
        const nf = interchatDeliver(a.id, "ac_missing_target", "x");
        agentChatClose(b.id);
        const closedErr = interchatDeliver(a.id, b.id, "y");
        const ok = r.ok && delivered && unread === 1 && !nf.ok && nf.error === "target_not_found" && !closedErr.ok && closedErr.error === "target_closed";
        return { ok, evidence: `delivered=${delivered}, unread=${unread}, missing=${nf.error}, closed=${closedErr.error}` };
      } finally {
        if (a) agentChatDelete(a.id);
        if (b) agentChatDelete(b.id);
      }
    },
  },
  {
    id: "agentchat.objective",
    plane: "agentchat",
    title: "AgentChat (G5): долгоживущая цель чата — set/обновление, чужая цель только для SUPERVISOR, цель в промпте и дайджесте",
    critical: true,
    expect: "chatSetObjective(свой) ok и виден в сессии/дайджесте; чужая цель от CHAT-чата = not_permitted; от SUPERVISOR = ok; systemPrompt содержит цель; tool set_objective работает",
    run: () => {
      let chat: ReturnType<typeof agentChatCreate> | null = null;
      let sup: string | null = null;
      try {
        chat = agentChatCreate({ role: "CHAT", title: "eval-obj-chat", model: "glm-eval-stub" });
        const ensured = supervisorEnsure("eval-obj-super");
        sup = ensured.id;
        const s1 = chatSetObjective(chat.id, "довести экономию памяти до −30%", {});
        const after = agentChatGet(chat.id, 1)?.session.objective ?? "";
        // чужая цель: SUPERVISOR может назначить (ок), обычный CHAT — нет (not_permitted)
        const supAssign = chat ? chatSetObjective(chat.id, "цель от супервизора", { by: sup ?? "" }) : null;
        let notPermitted = "";
        const other = agentChatCreate({ role: "CHAT", title: "eval-obj-other", model: "glm-eval-stub" });
        try {
          const r2 = chatSetObjective(chat!.id, "попытка чужой цели", { by: other.id });
          notPermitted = r2.error ?? "";
        } catch (e) { notPermitted = String(e).slice(0, 40); }
        agentChatDelete(other.id);
        const ctx = chat ? buildChatContext({ ...agentChatGet(chat.id, 1)!.session }, "CHAT") : [];
        const sys = ctx.filter((m) => m.role === "system").map((m) => m.content).join("\n");
        const toolSet = chat ? execChatToolSync("set_objective", { objective: "цель через инструмент" }, chat.id) : "";
        const digest = fleetDigest();
        const inDigest = digest.includes("цель через инструмент");
        // R37: нормализация модели — двойной префикс из старых сессий не должен доживать до LLM
        const normOk = normalizeChatModel("zai:zai:glm-5.3") === "zai:glm-5.3" && normalizeChatModel("zai:glm-5.3") === "zai:glm-5.3";
        const supSess = sup ? agentChatGet(sup, 1)?.session.model ?? "" : "";
        const ok = s1.ok && after.includes("экономию памяти") && supAssign!.ok && notPermitted === "not_permitted" && sys.includes("ДОЛГОЖИВУЩАЯ ЦЕЛЬ") && toolSet.startsWith("OK:") && inDigest && normOk && !supSess.includes("zai:zai:");
        return { ok, evidence: `set=${s1.ok}, в_сессии=${after.slice(0, 24)}, sup-назначил=${supAssign!.ok}, not_permitted=${notPermitted}, в_промпте=${sys.includes("ДОЛГОЖИВУЩАЯ ЦЕЛЬ")}, tool=${toolSet.slice(0, 18)}, в_дайджесте=${inDigest}, норм-модели=${normOk}, сессия_супа_чиста=${supSess || "—"}` };
      } finally {
        if (chat) agentChatDelete(chat.id);
        if (sup) { try { agentChatDelete(sup); } catch { /* noop */ } }
      }
    },
  },
  {
    id: "agentchat.pool_digest",
    plane: "agentchat",
    title: "AgentChat (G4): дайджест супервизора видит пул — секция исполнителей с последним шагом FLEET_STEP",
    critical: true,
    expect: "fleetDigest содержит секцию «Пул исполнителей»; синтетический FLEET_STEP исполнителя под lease виден в дайджесте (супервизор видит ходы пул-исполнителей шаг за шагом); cleanup полный",
    run: () => {
      const tkId = `tk_evalfd${rid()}`;
      try {
        // синтетический lease-контур (паттерн pool.evalLeaseCycle, R34): lease + задача + FLEET_STEP
        createTask({ id: tkId, title: "eval-fleet-digest-smoke", spec: "синтетическая задача для дайджеста", role: "EXECUTOR", max_steps: 2 } as Parameters<typeof createTask>[0]);
        updateTask(tkId, { status: "RUNNING", agent_id: "eval-fd-agent" });
        db.query("INSERT OR REPLACE INTO pool_leases (task_id, agent_id, slot, acquired_at, expires_at, hb_at, done) VALUES (?,?,?,?,?,?,0)")
          .run(tkId, "eval-fd-agent", 4, new Date().toISOString(), Date.now() + 30_000, new Date().toISOString());
        emit("FLEET_STEP", { source: "pool", slot: 4, task_id: tkId, task_title: "eval-fleet-digest-smoke", step: 1, kind: "tool", tool: "write_file", preview: "OK: wrote eval-fd.txt" }, "eval-fd-agent", tkId);
        const digest = fleetDigest();
        const hasSection = digest.includes("Пул исполнителей");
        const hasTask = digest.includes("eval-fleet-digest-smoke");
        const hasStep = digest.includes("write_file") && digest.includes("eval-fd.txt");
        const ok = hasSection && hasTask && hasStep;
        return { ok, evidence: `секция_пула=${hasSection}, задача_видна=${hasTask}, последний_шаг_виден=${hasStep}, len=${digest.length}` };
      } finally {
        try { db.query("DELETE FROM pool_leases WHERE task_id=?").run(tkId); } catch { /* noop */ }
        try { db.query("DELETE FROM tasks WHERE id=?").run(tkId); } catch { /* noop */ }
      }
    },
  },
  {
    id: "autonomy.liveness",
    plane: "autonomy",
    title: "Autonomy v4 (P2+P3): liveness — RUNNING-перерасход + deadlock-цикл handoff-графа детектятся, verdict STALLED честен",
    critical: true,
    expect: "синтетический RUNNING (updated_at 15м назад) → running_overrun stall; handoff-цикл A→B→A → wait_cycles stall; пока синтетика жива verdict=STALLED; после cleanup — предикаты снова ок",
    run: () => {
      const tkOver = `tk_ovr${rid()}`;
      const tkA = `tk_cycA${rid()}`;
      const tkB = `tk_cycB${rid()}`;
      try {
        // синтетический перерасход: RUNNING, обновлён 15 минут назад
        db.query(`INSERT INTO tasks (id, title, spec, role, status, max_steps, steps, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(tkOver, "eval-liveness-overrun", "", "EXECUTOR", "RUNNING", 2, 0,
            new Date(Date.now() - 16 * 60_000).toISOString(), new Date(Date.now() - 15 * 60_000).toISOString());
        // синтетический deadlock-цикл передач A→B→A
        for (const id of [tkA, tkB]) {
          db.query(`INSERT INTO tasks (id, title, spec, role, status, max_steps, steps, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)`)
            .run(id, `eval-${id}`, "", "EXECUTOR", "COMPLETED", 1, 1,
              new Date().toISOString(), new Date().toISOString());
        }
        db.query(`INSERT INTO handoffs (id, from_task, to_task, reason, protocol, by, created_at) VALUES (?,?,?,?,?,?,?)`)
          .run(`ho_${rid()}`, tkA, tkB, "eval-cycle", "rerere", "eval", new Date().toISOString());
        db.query(`INSERT INTO handoffs (id, from_task, to_task, reason, protocol, by, created_at) VALUES (?,?,?,?,?,?,?)`)
          .run(`ho_${rid()}`, tkB, tkA, "eval-cycle", "rerere", "eval", new Date().toISOString());
        const l = livenessStatus();
        const overrun = l.checks.find((c) => c.id === "running_overrun");
        const cycles = l.checks.find((c) => c.id === "wait_cycles");
        const stalled = l.verdict === "STALLED" && l.stalled_reasons.length >= 2;
        return { ok: !!(overrun && !overrun.ok && cycles && !cycles.ok && stalled),
          evidence: `overrun_ok=${overrun?.ok}, цикл=${cycles?.detail.slice(0, 60)}, verdict=${l.verdict} (stall-причин=${l.stalled_reasons.length})` };
      } finally {
        for (const id of [tkOver, tkA, tkB]) {
          try { db.query("DELETE FROM tasks WHERE id=?").run(id); } catch { /* noop */ }
          try { db.query("DELETE FROM handoffs WHERE from_task=? OR to_task=?").run(id, id); } catch { /* noop */ }
        }
      }
    },
  },
  {
    id: "autonomy.budget",
    plane: "autonomy",
    title: "Autonomy v4 (P7): risk budget — синтетические деструктивные события дают точный взвешенный вклад",
    critical: true,
    expect: "emit TASK_FAILED(вес 1) + POOL_LEASE_REAPED(вес 2) → score вырос ≥3, contributors содержат оба типа, state ∈ OK/WARN/BREACH, пороги согласованы (warn<breach)",
    run: () => {
      const before = budgetStatus().score;
      emit("TASK_FAILED", { error: "eval-budget-synthetic", cause: "eval" }, "eval-budget", null);
      emit("POOL_LEASE_REAPED", { task_id: "tk_eval-budget", slot: 1, eval: true }, "eval-budget", null);
      const b = budgetStatus();
      const grew = b.score >= before + 3;
      const types = new Set(b.contributors.map((c) => c.type));
      const both = types.has("TASK_FAILED") && types.has("POOL_LEASE_REAPED");
      const stateOk = b.state === "OK" || b.state === "WARN" || b.state === "BREACH";
      return { ok: grew && both && stateOk && b.warn < b.breach,
        evidence: `score ${before}→${b.score} (+≥3), оба типа в вкладах=${both}, state=${b.state}, пороги ${b.warn}/${b.breach}` };
    },
  },
  {
    id: "autonomy.nonbypass",
    plane: "autonomy",
    title: "Autonomy v4 (P1+P8): non-bypass — все POST-маршруты исходника покрыты enforcement-семействами в ОБЕ стороны + reviewer zero-authority",
    critical: true,
    expect: "nonBypassAudit: verdict NO_BYPASS; множество маршрутов из исходника index.ts === множеству манифеста (и наоборот); ≥25 маршрутов; reviewer.ts не содержит UPDATE tasks SET status; independence.chain_ok",
    run: () => {
      const a = nonBypassAudit();
      const manifest = new Set(Object.keys(ENFORCED_WRITE_FAMILIES));
      const routes = new Set(a.post_routes);
      const exact = manifest.size === routes.size && [...manifest].every((r) => routes.has(r));
      const enough = a.post_routes.length >= 25;
      let reviewerClean = false;
      try {
        const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "reviewer.ts"), "utf8"); // R51: package-relative
        reviewerClean = !/UPDATE\s+tasks\s+SET\s+status/i.test(src) && src.includes("review IS NULL");
      } catch { /* source не читается — честный FAIL */ }
      const chain = verifyChain(undefined, undefined, 200);
      const ok = a.verdict === "NO_BYPASS" && exact && enough && reviewerClean && chain.ok;
      return { ok, evidence: `verdict=${a.verdict}, маршрутов=${a.post_routes.length}, манифест=${manifest.size}, точное_равенство=${exact}, reviewer_не_пишет_статусы=${reviewerClean}, chain=${chain.ok}(${chain.checked})` };
    },
  },
  {
    id: "governor.breaker",
    plane: "governor",
    title: "G11 LLM-Governor: circuit breaker открывается от шторма исчерпанных 429, fast-fail без сети, cooldown растёт",
    critical: true,
    expect: "3×governorInject429 → state OPEN + GOVERNOR_TRIP в шине; повторный шторм не сбрасывает; governorTestReset → CLOSED; статус-плоскость /governor отдаёт полосы P0/P1/P2",
    run: () => {
      const st0 = governorStatus();
      const lanesOk = ["P0", "P1", "P2"].every((l) => st0.lanes.some((b) => b.lane === l));
      governorTestReset();
      governorInject429("P1"); governorInject429("P1");
      const after2 = governorBreakerState(); // ещё CLOSED (2 < порога)
      governorInject429("P1");
      const after3 = governorBreakerState(); // OPEN
      const trips1 = governorStatus().breaker.trips;
      const cooldown1 = governorCooldownForTest();
      governorInject429("P1"); // в OPEN не триггерит повторный trip
      const trips2 = governorStatus().breaker.trips;
      const ev = db.query(`SELECT COUNT(*) c FROM events WHERE type='GOVERNOR_TRIP' AND ts>=?`).get(new Date(Date.now() - 60_000).toISOString()) as { c: number };
      governorTestReset();
      const closed = governorBreakerState();
      const ok = after2 === "CLOSED" && after3 === "OPEN" && trips1 === 1 && trips2 === 1 && ev.c >= 1 && closed === "CLOSED" && lanesOk;
      return { ok, evidence: `2×429→${after2}, 3×429→${after3} (trips=${trips1}, повтор не триггерит=${trips2 === 1}), GOVERNOR_TRIP в шине=${ev.c}, cooldown=${cooldown1}мс, reset→${closed}, полосы P0/P1/P2=${lanesOk}` };
    },
  },
  {
    id: "demand.autopilot",
    plane: "demand",
    title: "G10 автопилот спроса: гистерезис 2 тика, создание живого CODE-чата по сигналу, suppression по капам, cleanup",
    critical: true,
    expect: "1 тик → deferred (гистерезис); 2-й тик → created (реальный чат Demand·CODE с целью); max=0-кап подавляет; demandTestReset+cleanup чата",
    run: () => {
      demandTestReset();
      const prevMax = demandConfig().max; // читаем ДО изменения
      demandConfigSet({ max: 24 });
      const hot: DemandSnapshot = { ready_count: 6, ready_research: 0, pool_leases: 4, pool_max: 4, fails_15m: 0, active_chats: 1, breaker_open: false };
      const d1 = demandTick({ snapshot: hot });
      const d2 = demandTick({ snapshot: hot, kick: false }); // eval без реального LLM-хода
      const createdOk = d1.action === "deferred" && d1.detail.includes("гистерезис") && d2.action === "created" && !!d2.session_id;
      let objectiveOk = false;
      let chatClean = false;
      if (d2.session_id) {
        const g = agentChatGet(d2.session_id, 20);
        objectiveOk = !!g && g.session.objective.length > 10;
        if (g) { agentChatClose(d2.session_id); agentChatDelete(d2.session_id); chatClean = !agentChatGet(d2.session_id); }
      } else chatClean = true;
      // suppression капом: тик ×2 под капом=1 — гистерезис пройден, кап реально режет
      const st = demandStatus();
      demandConfigSet({ max: 1 }); // кап = числу реальных чатов → suppression
      const hotCapped: DemandSnapshot = { ...hot, active_chats: st.snapshot.active_chats };
      demandTick({ snapshot: hotCapped, kick: false });
      const d4 = demandTick({ snapshot: hotCapped, kick: false });
      const suppressOk = d4.action === "suppressed" && d4.detail.length > 5;
      demandConfigSet({ max: prevMax }); // восстановить исходный кап
      demandTestReset();
      const ok = createdOk && objectiveOk && chatClean && suppressOk;
      return { ok, evidence: `гистерезис: тик1=${d1.action}, тик2=${d2.action}; чат создан=${!!d2.session_id}, цель назначена=${objectiveOk}, cleanup=${chatClean}, кап-подавление=${d4.action} (${d4.detail.slice(0, 50)})` };
    },
  },
  {
    id: "policy.tiers",
    plane: "policy",
    title: "H2 policy-файл T0/T1/T2: tier-маппинг ролей, эластичность T2 сохранена, запрет не молчит (POLICY_DENIED в chain), reload работает",
    critical: true,
    expect: "SUPERVISOR→T1, CODE→T2; T2 сохраняет shell/create_chat (эластичность флота); policyCheckTool('T2','admin_shutdown')=false → POLICY_DENIED в шине с ledger-полями; policyReload перечитывает файл (version≥1)",
    run: () => {
      const tierOk = tierForRole("SUPERVISOR") === "T1" && tierForRole("CODE") === "T2" && tierForRole("CHAT") === "T2";
      const elastic = policyAllows("T2", "shell") && policyAllows("T2", "create_chat") && policyAllows("T1", "set_objective");
      const before = policyStatus().counters.denied;
      const denied = policyCheckTool("T2", "admin_shutdown", "eval-policy-probe");
      const after = policyStatus().counters.denied;
      const ev = db.query(`SELECT COUNT(*) AS c FROM events WHERE type='POLICY_DENIED' AND ts>=?`).get(new Date(Date.now() - 60_000).toISOString()) as { c: number };
      const p = policyReload();
      const reloadOk = p.version >= 1 && !!p.tiers.T1.tools.length && p.caps.crons_per_chat >= 1;
      const ok = tierOk && elastic && !denied.ok && after === before + 1 && ev.c >= 1 && reloadOk;
      return { ok, evidence: `tiers=${tierOk}, эластичность T2 (shell+create_chat)=${elastic}, запрет admin_shutdown=${denied.ok ? "ПРОПУЩЕН!" : "denied"} (счётчик ${before}→${after}, POLICY_DENIED в chain=${ev.c}), reload v${p.version}=${reloadOk}` };
    },
  },
  {
    id: "cron.schedule",
    plane: "fleet",
    title: "G7 cron из чатов: чат ставит задание, тик будит (сообщение в истории + AGENT_CHAT_CRON в chain), next уезжает вперёд, капы и cancel работают",
    critical: true,
    expect: "cronAdd каждые 5м → активное; cronTick(kick:false) по due → сообщение в истории чата + событие AGENT_CHAT_CRON(action=fired) + runs=1 + next в будущем; 9-е задание → cap_crons_per_chat; cancel → CANCELLED; изоляция прогонов cronTestReset",
    run: () => {
      cronTestReset();
      const s = agentChatCreate({ role: "CHAT", title: "eval-cron" });
      try {
        const a = cronAdd(s.id, { every_minutes: 5 }, "проверь бэклог и отчитайся", { tier: "T2" });
        const past = new Date(Date.now() - 60_000).toISOString();
        db.query(`UPDATE chat_crons SET next_run_at=? WHERE id=?`).run(past, a.cron!.id); // сделать due
        const t = cronTick({ kick: false }); // eval без LLM-хода: только сообщение+событие
        const msgs = db.query(`SELECT COUNT(*) AS n FROM agent_messages WHERE session_id=? AND meta LIKE '%"kind":"cron"%'`).get(s.id) as { n: number };
        const ev = db.query(`SELECT COUNT(*) AS c FROM events WHERE type='AGENT_CHAT_CRON' AND ts>=?`).get(new Date(Date.now() - 60_000).toISOString()) as { c: number };
        const after = cronList(s.id)[0];
        const nextOk = after.runs === 1 && after.next_run_at > new Date().toISOString();
        // кап per-chat: добить до cap и получить отказ на следующий
        const cap = policyCaps().crons_per_chat;
        let capErr = "";
        for (let i = 0; i < cap + 1; i++) {
          const r = cronAdd(s.id, { every_minutes: 5 }, `задание ${i}`, { tier: "T2" });
          if (!r.ok) { capErr = r.error ?? ""; break; }
        }
        const cancelOk = cronCancel(a.cron!.id) && cronList(s.id).find((c) => c.id === a.cron!.id)?.status === "CANCELLED";
        const ok = a.ok && t.fired >= 1 && Number(msgs.n) >= 1 && ev.c >= 1 && nextOk && capErr.startsWith("cap_crons_per_chat") && cancelOk;
        return { ok, evidence: `add=${a.ok}, tick fired=${t.fired}, сообщений в истории=${msgs.n}, AGENT_CHAT_CRON=${ev.c}, runs=${after.runs}/next→${nextOk ? "будущее" : "ПРОШЛОЕ"}, кап=${capErr}, cancel=${cancelOk}` };
      } finally {
        cronTestReset();
        agentChatDelete(s.id);
      }
    },
  },
  {
    id: "demand.outcome",
    plane: "fleet",
    title: "R44 outcome-proof: report_outcome фиксирует исход с доказательством (AGENT_CHAT_OUTCOME в chain), успех-без-пруфа попадает в outcomePending, неверный статус отвергается",
    critical: true,
    expect: "reply «исправлено» без outcome → чат в outcomePending; outcomeReport(fixed, proof) → outcome_status=fixed + событие AGENT_CHAT_OUTCOME + чат покидает pending; status=bad → error; proof пустой → error; cleanup чата",
    run: () => {
      const s = agentChatCreate({ role: "CODE", title: "eval-outcome" });
      try {
        chatSetObjective(s.id, "разобрать отказы и исправить (eval)");
        chatAppend(s.id, "assistant", "все отказы исправлены, система готово", { kind: "reply" });
        const pendingBefore = outcomePending().some((p) => p.session_id === s.id);
        const badStatus = outcomeReport(s.id, "bad", "пруф");
        const noProof = outcomeReport(s.id, "fixed", "  ");
        const good = outcomeReport(s.id, "fixed", "eval: 3 отказа разобраны, тест зелёный (пруф eval-харнесса)");
        const g = agentChatGet(s.id, 5);
        const ev = db.query(`SELECT COUNT(*) AS c FROM events WHERE type='AGENT_CHAT_OUTCOME' AND ts>=?`).get(new Date(Date.now() - 60_000).toISOString()) as { c: number };
        const pendingAfter = outcomePending().some((p) => p.session_id === s.id);
        const ok = pendingBefore && !badStatus.ok && !noProof.ok && good.ok && g?.session.outcome_status === "fixed" && ev.c >= 1 && !pendingAfter;
        return { ok, evidence: `pending-до=${pendingBefore}, bad-status rejected=${!badStatus.ok}, без-пруфа rejected=${!noProof.ok}, fixed принят=${good.ok}, outcome_status=${g?.session.outcome_status}, AGENT_CHAT_OUTCOME=${ev.c}, pending-после=${pendingAfter}` };
      } finally {
        agentChatDelete(s.id);
      }
    },
  },
  {
    id: "tokens.in_db",
    plane: "vault",
    title: "R47 vault: все токены в БД — set/get/delete через SQLite, raw-значения наружу не выходят (только маска), bootstrap-миграция из /home/z/.a2 идемпотентна, known-ядро присутствует",
    critical: true,
    expect: "tokenSet → tokenGet возвращает значение; tokenList НЕ содержит raw-значение, но содержит имя+маску; tokenDelete → tokenGet=null; tokensEnsure второй вызов не дублирует (идемпотент); known_missing не содержит мигрированное ядро",
    run: () => {
      const probeName = "EVAL_TOKEN_PROBE";
      const secret = `probe_secret_${Date.now().toString(36)}_xyz`;
      // R51: пустота vault фиксируем ДО probe-токена (после set total уже ≥1)
      const vaultWasEmpty = tokensStatus().total === 0;
      try {
        const set1 = tokenSet(probeName, secret, "T2", "eval");
        const got = tokenGet(probeName);
        const list1 = tokenList();
        const listStr = JSON.stringify(list1);
        const row1 = list1.find((t) => t.name === probeName);
        const ensureA = tokensEnsure();
        const ensureB = tokensEnsure();
        const st = tokensStatus();
        const del = tokenDelete(probeName, "eval");
        const gotAfter = tokenGet(probeName);
        // known-ядро: GITHUB_TOKEN_ADMIN + SUPABASE_URL должны быть мигрированы (bootstrap из /home/z/.a2).
        // R51 WARMUP: если vault был пуст ДО probe-токена (CI/чистый инстанс) — known-ядро не проверяем,
        // механика set/get/mask/delete/идемпотентность проверена выше полностью.
        const coreOk = vaultWasEmpty || (!st.known_missing.includes("GITHUB_TOKEN_ADMIN") && !st.known_missing.includes("SUPABASE_URL"));
        const ok = set1.ok && got === secret && !listStr.includes(secret) && Boolean(row1?.masked) && row1?.masked !== secret
          && ensureA.present === ensureB.present && del.ok && gotAfter === null && coreOk;
        return { ok, evidence: `set=${set1.ok}, get=${got === secret}, raw-утечка=${listStr.includes(secret)}, маска=${row1?.masked ?? "—"}, идемпотент=${ensureA.present === ensureB.present} (${ensureB.present} строк), delete=${del.ok}, get-после=${gotAfter === null}, known_missing=${st.known_missing.join("|") || "—"}` };
      } finally {
        tokenDelete(probeName, "eval-cleanup");
      }
    },
  },
  {
    id: "contract.handshake",
    plane: "contract",
    title: "R49 фаза A: capabilities-handshake daemon⇄браузер — CONTRACT_VERSION, полный список ops (вкл. mesh_heartbeat), ui, memory-поверхность; withContract аддитивен",
    critical: true,
    expect: "capabilitiesJson: contract=CONTRACT_VERSION, ops содержит все 8 ops и mesh_heartbeat, ui=/ui, transport socket agentchat:op; withContract добавляет contract+capabilities, не трогая базовые поля",
    run: () => {
      const cap = capabilitiesJson();
      const needOps = ["create", "turn", "compact", "close", "tick", "send", "objective", "mesh_heartbeat"];
      const opsOk = needOps.every((o) => cap.ops.includes(o));
      const merged = withContract({ v: "probe", ts: 1 });
      const ok = cap.contract === CONTRACT_VERSION && opsOk && cap.ui === "/ui"
        && cap.transport.socket === "agentchat:op" && cap.transport.path === "/"
        && cap.memory.some((m) => m.includes("economy"))
        && (merged as Record<string, unknown>).v === "probe"
        && (merged as Record<string, unknown>).contract === CONTRACT_VERSION
        && Boolean((merged as Record<string, unknown>).capabilities);
      return { ok, evidence: `contract=${cap.contract}, ops=${cap.ops.length}/8 (mesh_heartbeat=${cap.ops.includes("mesh_heartbeat")}), ui=${cap.ui}, socket=${cap.transport.socket}, аддитивность v/ts=${(merged as Record<string, unknown>).v}/${(merged as Record<string, unknown>).ts}` };
    },
  },
  {
    id: "mission.ui_contract",
    plane: "mission",
    title: "R49 фаза A: GET /ui — самодостаточная Mission Control: 0 сборки, 0 внешних зависимостей, socket-клиент только с daemon'а, операции через agentchat:op",
    critical: true,
    expect: "HTML содержит fleet/river/toast-узлы и data-testid; fetch только относительных read-only путей (/agentchat,/events,/health,/state); операции — socket emit agentchat:op; никаких внешних http-ресурсов (кроме self-hosted socket.io с daemon'а); размер разумный (<64KB)",
    run: () => {
      const html = missionUiHtml();
      const markersOk = ['data-testid="mc-fleet"', 'data-testid="mc-river"', 'data-testid="mc-contract"', "agentchat:op", "/agentchat", "/events?limit=60", "/health", "/state"]
        .every((m) => html.includes(m));
      // самодостаточность: единственный абсолютный src — socket.io с самого daemon'а (:3040)
      const srcs = [...html.matchAll(/src="(https?:\/\/[^"\s]{6,})"/g)].map((m) => m[1]);
      const external = srcs.filter((s) => !s.includes(":"+WS_PORT+"/socket.io.js"));
      const noExternalAssets = external.length === 0 && !/href="https?:/.test(html);
      // честная проверка: страница не шлёт REST-POST/PUT (метод в fetch отсутствует)
      const noRestWrites = !/method\s*:\s*["'](POST|PUT)/.test(html);
      const fetchPaths = [...html.matchAll(/fetch\((?:api\()?"([^"?]+)/g)].map((m) => m[1]);
      const readOnly = fetchPaths.length >= 3 && fetchPaths.every((p) => p.startsWith("/"));
      const ok = markersOk && noExternalAssets && noRestWrites && readOnly && html.length < 64 * 1024 && html.includes("<!doctype html>");
      return { ok, evidence: `маркеры=${markersOk}, абсолютных-src=${srcs.length} внешних=${external.length} (socket self-hosted только), no-REST-write=${noRestWrites}, fetch-only-relative=${readOnly}, размер=${(html.length / 1024).toFixed(1)}KB` };
    },
  },
  {
    id: "mission.mesh_tick",
    plane: "mission",
    title: "R49 фаза A: op mesh_heartbeat — epoch-фенс, meta mesh_last_heartbeat персистентен, MESH_HEARTBEAT в hash-chain, в ответе последний supervisor_tick (честно null до тика)",
    critical: true,
    expect: "без mesh_epoch → honest error; с epoch → ok, meta mesh_last_heartbeat записан, событие MESH_HEARTBEAT в chain, смена epoch → mesh_epoch_advanced=true, supervisor_tick = null-или-объект; cleanup meta-хвостов",
    run: () => {
      const noEpoch = meshHeartbeatApply({});
      const e1 = `eval-mesh-${Date.now().toString(36)}`;
      try {
        // изоляция (урок №6): пред-состояние epoch-фенса не должно влиять на прогон
        db.query(`DELETE FROM meta WHERE key IN ('mesh_last_heartbeat','mesh_epoch_last')`).run();
        const r1 = meshHeartbeatApply({ mesh_epoch: e1, coordinator: "eval", supervisors: ["sup-1"] });
        const r2 = meshHeartbeatApply({ mesh_epoch: e1, coordinator: "eval", supervisors: ["sup-1"] });
        const r3 = meshHeartbeatApply({ mesh_epoch: e1 + "-v2", coordinator: "eval", supervisors: ["sup-1", "sup-2"] });
        const meta = JSON.parse(getMeta("mesh_last_heartbeat") ?? "{}");
        const ev = db.query(`SELECT COUNT(*) AS c FROM events WHERE type='MESH_HEARTBEAT' AND ts>=?`).get(new Date(Date.now() - 60_000).toISOString()) as { c: number };
        const ok = !noEpoch.ok && noEpoch.error === "mesh_epoch_required"
          && r1.ok && r2.ok && r1.mesh_epoch_advanced === false && r3.mesh_epoch_advanced === true
          && meta.mesh_epoch === e1 + "-v2" && meta.coordinator === "eval" && meta.supervisors_n === 2
          && ev.c >= 3
          && (r1.supervisor_tick === null || (typeof r1.supervisor_tick === "object" && r1.supervisor_tick !== null));
        return { ok, evidence: `no-epoch rejected=${!noEpoch.ok}, heartbeat ok=${r1.ok}/${r2.ok}/${r3.ok}, advanced=${r1.mesh_epoch_advanced}/${r3.mesh_epoch_advanced}, meta=${meta.mesh_epoch}, MESH_HEARTBEAT=${ev.c}, supervisor_tick=${r1.supervisor_tick === null ? "null(честно)" : "объект"}` };
      } finally {
        db.query(`DELETE FROM meta WHERE key IN ('mesh_last_heartbeat','mesh_epoch_last')`).run();
      }
    },
  },
];

// ── ХАРНЕСС ────────────────────────────────────────────────────────
export function evalRun(version: string): EvalReport {
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  const results: EvalCheckResult[] = [];

  for (const chk of EVAL_DATASET) {
    const ct0 = Date.now();
    let ok = false;
    let evidence = "";
    try {
      const r = chk.run();
      ok = r.ok; evidence = r.evidence;
    } catch (e) {
      ok = false;
      evidence = `exception: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
    results.push({
      id: chk.id, plane: chk.plane, critical: chk.critical, ok,
      ms: Date.now() - ct0, evidence, expect: chk.expect,
    });
  }

  const failed = results.filter((r) => !r.ok && r.critical).length;
  const warned = results.filter((r) => !r.ok && !r.critical).length;
  const passed = results.length - failed - warned;
  const verdict: EvalReport["verdict"] = failed > 0 ? "FAIL" : warned > 0 ? "WARN" : "PASS";
  const duration = Date.now() - t0;

  const report: EvalReport = {
    ok: true,
    dataset_version: EVAL_DATASET_VERSION,
    run_id: `ev_${t0.toString(36)}`,
    started_at: startedAt,
    duration_ms: duration,
    verdict, passed, warned, failed, total: results.length,
    version,
    results,
  };

  try {
    db.query(`INSERT INTO eval_runs (run_id, started_at, duration_ms, verdict, passed, warned, failed, total, version, dataset_version, results)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(report.run_id, startedAt, duration, verdict, passed, warned, failed, results.length, version, EVAL_DATASET_VERSION, JSON.stringify(results));
    db.query(`DELETE FROM eval_runs WHERE id NOT IN (SELECT id FROM eval_runs ORDER BY id DESC LIMIT 100)`).run();
  } catch { /* история не критична для вердикта */ }

  try { emit("EVAL_RUN", { run_id: report.run_id, verdict, passed, warned, failed, total: results.length, duration_ms: duration, dataset_version: EVAL_DATASET_VERSION }, null, null); } catch { /* шина не критична */ }
  recordSpan("eval.run", { "me2.verdict": verdict, "me2.failed": failed, "me2.warned": warned, "me2.total": results.length, "me2.ms": duration }, t0,
    verdict === "FAIL" ? { status: "ERROR", message: `critical failures: ${results.filter((r) => !r.ok && r.critical).map((r) => r.id).join(", ")}` } : {});
  return report;
}

export interface EvalHistoryRow {
  run_id: string; started_at: string; duration_ms: number;
  verdict: string; passed: number; warned: number; failed: number; total: number;
  version: string; dataset_version: number;
}

export function evalStatus(version: string): {
  ok: true; dataset_version: number;
  dataset: Array<{ id: string; plane: string; title: string; critical: boolean; expect: string }>;
  last: EvalReport | null; history: EvalHistoryRow[]; runs_total: number;
} {
  const rows = db.query(`SELECT run_id, started_at, duration_ms, verdict, passed, warned, failed, total, version, dataset_version FROM eval_runs ORDER BY id DESC LIMIT 10`)
    .all() as EvalHistoryRow[];
  const cnt = db.query(`SELECT COUNT(*) AS n FROM eval_runs`).get() as { n: number };
  let last: EvalReport | null = null;
  if (rows.length) {
    const full = db.query(`SELECT results FROM eval_runs WHERE run_id=?`).get(rows[0].run_id) as { results: string } | undefined;
    try {
      const results = full ? (JSON.parse(full.results) as EvalCheckResult[]) : [];
      last = {
        ok: true, dataset_version: rows[0].dataset_version, run_id: rows[0].run_id,
        started_at: rows[0].started_at, duration_ms: rows[0].duration_ms,
        verdict: rows[0].verdict as EvalReport["verdict"],
        passed: rows[0].passed, warned: rows[0].warned, failed: rows[0].failed, total: rows[0].total,
        version: rows[0].version, results,
      };
    } catch { last = null; }
  }
  return {
    ok: true,
    dataset_version: EVAL_DATASET_VERSION,
    dataset: EVAL_DATASET.map((c) => ({ id: c.id, plane: c.plane, title: c.title, critical: c.critical, expect: c.expect })),
    last, history: rows, runs_total: Number(cnt.n),
  };
}

/** Вердикт для механики ME22: WORKS только если последний прогон PASS. */
export function evalVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  const rows = db.query(`SELECT verdict, passed, warned, failed, total, duration_ms, started_at FROM eval_runs ORDER BY id DESC LIMIT 1`).all() as Array<{
    verdict: string; passed: number; warned: number; failed: number; total: number; duration_ms: number; started_at: string;
  }>;
  if (!rows.length) return { verdict: "CAVEAT", evidence: "не запускался (авто-прогон на boot+2.5s или POST /eval/run)" };
  const r = rows[0];
  if (r.verdict === "PASS") {
    return {
      verdict: "WORKS",
      evidence: `last=PASS ${r.passed}/${r.total} за ${r.duration_ms}ms (dataset v${EVAL_DATASET_VERSION})`,
    };
  }
  return {
    verdict: "CAVEAT",
    evidence: `last=${r.verdict}: passed=${r.passed}, warned=${r.warned}, failed=${r.failed}/${r.total} — POST /eval/run после починки`,
  };
}
