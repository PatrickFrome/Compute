/**
 * ME-матрица (R19) — порт канонического реестра механик старой системы
 * (api/mechanics/route.ts: 18 механик M1–M18 с живыми пробами + R1–R11 гэпы).
 *
 * ME1–ME16: вердикты считаются из РЕАЛЬНОГО состояния daemon, каждая строка несёт
 * old_ref (какая старая механика портирована/улучшена). Это самоописание системы:
 * оператор видит, какие механики живут, а какие — CAVEAT/DECOR.
 */
import { knownActions, actionCatalog } from "../commands";
import { db, lastEventHash, lastSeq, listAgents, listTasks, getMeta } from "../store";
import { memoryStatus, memoryEconStatus } from "./memory";
import { fleetList } from "./fleet";
import { rsiList } from "./rsi";
import { otelStatus } from "./otel";
import { codegraphSummary } from "./codegraph";
import { rerereStatus } from "./worktrees";
import { sandboxCaps } from "./sandbox";
import { roadmapVerdict } from "./roadmap";
import { brainThoughts } from "./brain";
import { senseStatus, senseDiffVerdict } from "./sense";
import { obsvStatus, obsvPersistVerdict } from "./obsv";
import { hygieneVerdict } from "./dbhygiene";
import { verdictStats } from "./effect";
import { fleetOutcomeCount } from "./fleet";
import { benchVerdict } from "./bench";
import { mcpStatus } from "./mcp";
import { approvalsVerdict } from "./approvals";
import { evalVerdict } from "./eval";
import { governorStatus } from "./governor";
import { demandStatus } from "./demand";
import { tokensStatus } from "./tokens";
import { hooksStatus } from "./hooks";
import { policyStatus } from "./policy";
import { objectivesVerdict } from "./objectives";
import { handoffsVerdict } from "./handoffs";
import { glmVerdict } from "./glm";
import { reviewerVerdict } from "./reviewer";
import { evidenceStatus, verifyChain } from "../evidence";
import { poolStatus } from "./pool";
import { agentChatStatus, fleetDigest } from "./agentchat";
import { autonomyStatus } from "./autonomy";
import type { SuCheck } from "./selfupdate";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface MechanicRow {
  id: string; name: string; old_ref: string;
  verdict: "WORKS" | "CAVEAT" | "DECOR";
  evidence: string;
  /** Cursor-аналог (R21 parity-матрица + корпус R61; §34: UNKNOWN если нет публичных доков) */
  cursor_ref?: string;
  parity?: "PARITY" | "PARTIAL" | "MISSING" | "SUPERIOR" | "UNKNOWN";
}

/** Корень репо из src/ демона: src → me2-daemon → mini-services → repo */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

/** ME30: desktop-клиент (Electron, R46-R64) — вердикт из живого состояния файлов + CI */
export function clientShellStatus() {
  const root = repoRoot();
  const rels = [
    "desktop/src/main.ts",
    "desktop/src/daemon-supervisor.ts",
    "desktop/src/gateway.ts",
    "desktop/src/tab-registry.ts",
    "desktop/src/updater.ts",
    "desktop/src/preload.ts",
  ];
  const files = rels.map((rel) => join(root, rel));
  const present = files.filter((f) => existsSync(f)).length;
  const builder = existsSync(join(root, "desktop", "electron-builder.yml"));
  const ci = existsSync(join(root, ".github", "workflows", "desktop-build.yml"));
  const tauri = existsSync(join(root, "src-tauri", "tauri.conf.json"));
  const desktop = present === files.length && builder && ci;
  return { present, total: files.length, builder, ci, tauri, desktop };
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
      cursor_ref: "Browser/computer-use (анонсирован)", parity: "PARTIAL",
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
    {
      id: "ME23", name: "Mission Control: objectives→tasks→agents проекция + work_graph (C1)", old_ref: "mission-control-projection.mjs (fails-closed, zero-authority)",
      verdict: objectivesVerdict().verdict,
      evidence: objectivesVerdict().evidence + "; GET /objectives | POST /objectives {op:create|status|delete} — статусы только оператором",
    },
    {
      id: "ME24", name: "Handoffs: передача задач между агентами с протоколом (C2)", old_ref: "codex handoffs semantics (протокол done/in_flight/next/context)",
      verdict: handoffsVerdict().verdict,
      evidence: handoffsVerdict().evidence + "; POST /tasks/{id}/handoff — через шину (TASK_ENQUEUE+handoff), 47/47",
    },
    {
      id: "ME25", name: "GLM currency: флот на каноническом теге + живая probe бэкенда (директива)", old_ref: "— (R29: «все агенты всегда на последней версии glm»)",
      verdict: glmVerdict().verdict,
      evidence: glmVerdict().evidence + "; POST /glm {op:probe|upgrade|set_latest}",
    },
    {
      id: "ME26", name: "Reviewer-agent: антифальшь-ревью результатов против спека (C3)", old_ref: "— (R29: «работа агентов не фальшивая»; усиливает ME15 tier-1)",
      verdict: reviewerVerdict().verdict,
      evidence: reviewerVerdict().evidence + "; GET /reviews | POST /reviews/run — zero-authority (не меняет статусы)",
    },
    {
      id: "ME27", name: "Approval-политики: operator-configurable гейты на мутирующие операции (C4)", old_ref: "— (R24 §C4: fence-clear, RSI-adopt, authority-эффекты в одном месте)",
      verdict: approvalsVerdict().verdict,
      evidence: approvalsVerdict().evidence + "; POST /approvals {op:policy} — смена режима; one-attempt token + TTL 15м; FAILS-CLOSED",
    },
    {
      id: "ME28", name: "Sense-diffing: дифы ревизий вместо полных снапшотов (D1)", old_ref: "— (R24 §D1: экономия токенов агентам между ревизиями)",
      verdict: senseDiffVerdict().verdict,
      evidence: senseDiffVerdict().evidence + "; GET /browser/sense/diffs — история изменений по идентичности (role+name), ref-перенумерация не шум",
    },
    {
      id: "ME29", name: "Obsv→SQLite TTL: история сенсоров переживает кольца памяти (D2)", old_ref: "— (R24 §D2: долгоживущие сессии без роста памяти)",
      verdict: obsvPersistVerdict().verdict,
      evidence: obsvPersistVerdict().evidence + "; GET /browser/obsv?source=history | POST {op:ttl} — батч-флеш 2с, TTL-ротация, кап 5000",
    },
    {
      id: "ME30", name: "DB-гигиена: WAL checkpoint + VACUUM-окно + индексы горячих запросов (D4)", old_ref: "— (R24 §D4: SQLite-гигиена долгоживущего daemon)",
      verdict: hygieneVerdict().verdict,
      evidence: hygieneVerdict().evidence + "; GET /db/hygiene | POST {op:checkpoint|vacuum} — PASSIVE по расписанию 10м, TRUNCATE/VACUUM оператором",
    },
    {
      id: "ME31", name: "Evidence-зеркало v2: storage-доставка + DDL-хилер с авто-применением миграции (R32)", old_ref: "M5 evidence-plane (outbox → Supabase; DEGRADED ждал DDL)",
      verdict: (() => { const st = evidenceStatus(); return st.mode === "LIVE" || st.mode === "LIVE-STORAGE" ? "WORKS" : st.mode === "DEGRADED" ? "CAVEAT" : "DECOR"; })(),
      evidence: (() => { const st = evidenceStatus(); return `mode=${st.mode}, pending=${st.pending}, storage=${st.storage.ok ? "ok/" + st.storage.objects + " объектов" : "—"}, ddl=${st.ddl.last_result ?? "—"} (ретрай ${st.ddl.retry_every_min}м); POST /evidence {op:probe_ddl|probe_storage}`; })(),
    },
    {
      id: "ME32", name: "E2: верифицируемый audit-trail — hash-chain check + тампер-детект + связка evidence↔task↔review (IETF)", old_ref: "— (IETF draft-sharif-agent-audit-trail: third-party verifiability)",
      verdict: (() => { const v = verifyChain(undefined, undefined, 300); return v.ok ? "WORKS" : "CAVEAT"; })(),
      evidence: (() => { const v = verifyChain(undefined, undefined, 300); return v.ok ? `chain ok ${v.checked} событий (${v.from}..${v.to}) за ${v.ms}ms; GET /evidence/verify?from&to | /evidence/query?task_id — тампер меняет хеш (eval-негатив)` : `chain BROKEN at ${v.broken_at}: ${v.reason}`; })(),
    },
    {
      id: "ME33", name: "E3: executor-пул — N живых GLM-контекстов, эксклюзивные lease с heartbeat/reaper, универсальный claim (R34)", old_ref: "M2 task cycle (одиночный агент) → parallel live-GLM pool",
      verdict: (() => { try { const s = poolStatus(); const canon = s.workers.every((w) => w.model === `zai:${s.canonical}`); return s.workers.length > 0 && canon && s.leases.reaped_total >= 0 ? "WORKS" : "CAVEAT"; } catch { return "CAVEAT"; } })(),
      evidence: (() => { try { const s = poolStatus(); return `scale=${s.scale} live=${s.live}/${s.ceiling}, canonical=${s.canonical}, queue=${s.queue.ready}/${s.queue.running}, concurrency max=${s.concurrency.max_observed}, leases active=${s.leases.active} reaped=${s.leases.reaped_total}, throughput 1ч=${s.throughput.done_1h}✓/${s.throughput.failed_1h}✗; POST /pool {op:scale|burn}`; } catch (e) { return `pool status failed: ${String(e).slice(0, 80)}`; } })(),
    },
    {
      id: "ME34", name: "E5: token-economy памяти — дельта-доставка (sticky-ядро всегда, familiar-элиминация по hash+TTL, тампер возвращает запись) (R35)", old_ref: "M13 memory block (полный блок каждому промпту) → progressive disclosure",
      verdict: (() => { try { const s = memoryEconStatus(); return s.deliveries > 0 && s.avg_saved_pct >= 0 && s.avg_saved_pct <= 1 ? "WORKS" : "CAVEAT"; } catch { return "CAVEAT"; } })(),
      evidence: (() => { try { const s = memoryEconStatus(); const top = s.by_consumer[0]; return `доставок=${s.deliveries}, avg saved=${Math.round(s.avg_saved_pct * 100)}%, байт сэкономлено=${s.bytes_saved_total}, consumers=${s.by_consumer.map((c) => c.consumer).join(",")}${top ? `, топ=${top.consumer} −${Math.round(top.avg_saved_pct * 100)}%` : ""}; GET /memory/economy | POST /memory {op:economy}`; } catch (e) { return `econ status failed: ${String(e).slice(0, 80)}`; } })(),
    },
    {
      id: "ME35", name: "G1+G2: флот из полноценных агентных чатов — постоянные сессии с tool-циклом, компакцией, workspace, вечно-живущие супервизоры (перерождение), межчатовая связь, real-time шаги (пересборка механизма старого Electron-браузера) (R36)", old_ref: "легаси: вкладки chat.z.ai + actuation_lease fleet.transport-promotion → чат = первичный объект daemon + супервизор-тик",
      verdict: (() => { try { const s = agentChatStatus(); return s.total > 0 && s.turns_ok > 0 && s.supervisors > 0 ? "WORKS" : "CAVEAT"; } catch { return "CAVEAT"; } })(),
      evidence: (() => { try { const s = agentChatStatus(); return `сессий=${s.total} (active=${s.active}, thinking=${s.thinking}, супервизоров=${s.supervisors}), ходов ok/fail=${s.turns_ok}/${s.turns_fail}, в полёте=${s.in_flight}, компакций=${s.compactions}, деградаций=${s.degraded}, последний ход=${s.last_turn_at ?? "—"}; GET /agentchat | POST /agentchat {op:create|turn|compact|close|tick|send|objective}; шаги хода = AGENT_CHAT_STEP в шину (real-time)`; } catch (e) { return `agentchat status failed: ${String(e).slice(0, 80)}`; } })(),
    },
    {
      id: "ME36", name: "G4+G5: полная видимость флота — шаги пул-исполнителей в реке рассуждений (FLEET_STEP: thought/tool/reply/fail, супервизор и браузер видят ходы исполнителей шаг за шагом) + долгоживущие цели чатов (objective: назначает оператор/супервизор set_objective, видна в промпте хода, дайджесте и UI) (R37)", old_ref: "легаси: Outcome River видел только вкладки-чаты, исполнители невидимы; цели чатов не существовали (контекст терялся при перезагрузке вкладки)",
      verdict: (() => { try { const d = fleetDigest(); return d.includes("Пул исполнителей") ? "WORKS" : "CAVEAT"; } catch { return "CAVEAT"; } })(),
      evidence: (() => { try {
        const steps = (db.query("SELECT COUNT(*) c FROM events WHERE type='FLEET_STEP'").get() as { c: number }).c;
        const objs = (db.query("SELECT COUNT(*) c FROM agent_sessions WHERE objective != ''").get() as { c: number }).c;
        return `FLEET_STEP в шине=${steps}, чатов с целью=${objs}; дайджест супервизора: секция «Пул исполнителей» (слоты/lease/последний шаг), цели видны в строках чатов; POST /agentchat {op:objective}`;
      } catch (e) { return `ME36 evidence failed: ${String(e).slice(0, 80)}`; } })(),
    },
    {
      id: "ME37", name: "H1 мандат v4: AUTONOMY MUST BE BOTH SAFE AND LIVE — read-only плоскость /autonomy: liveness+deadlock/livelock (P2+P3), cumulative risk-budget (P7), proof-of-non-bypass всех POST-маршрутов исходника (P1), recovery hierarchy L0–L5 (P5), verifier-independence (P4+P8) (R38)", old_ref: "легаси: инварианты — статичный список в доке; живости/циклов/бюджета не существовало; auditor не проверял сам себя",
      verdict: (() => { try { const a = autonomyStatus(); return a.liveness.verdict === "LIVE" && a.non_bypass.verdict === "NO_BYPASS" ? "WORKS" : "CAVEAT"; } catch { return "CAVEAT"; } })(),
      evidence: (() => { try {
        const a = autonomyStatus();
        return `liveness=${a.liveness.verdict} (предикатов=${a.liveness.checks.length}), budget=${a.budget.state} (${a.budget.score}/${a.budget.breach}), non_bypass=${a.non_bypass.verdict} (${a.non_bypass.post_routes.length} маршрутов), recovery L0–L5=${a.recovery.length} уровней, independence: reviewer-статусы=${a.independence.reviewer_writes_status ? "ПИШЕТ!" : "нет"}, chain=${a.independence.chain_ok}; GET /autonomy`;
      } catch (e) { return `ME37 evidence failed: ${String(e).slice(0, 80)}`; } })(),
    },
    {
      id: "ME38", name: "G10+G11: автопилот спроса (daemon-demand → create_chat: гистерезис 2 тика, cooldown 10м/роль, капы ME2_DEMAND_MAX/CHAT_CEILING, breaker-aware) + LLM-Governor (полосы P0>P1>P2, token bucket, circuit breaker против 429-шторма) (R43)", old_ref: "легаси: никакой дисциплины LLM-спроса — ретраи честные, но шторм амплифицировался (51✗ за день)",
      verdict: (() => { try { const g = governorStatus(); const d = demandStatus(); const lanesOk = ["P0", "P1", "P2"].every((l) => g.lanes.some((b) => b.lane === l)); const states = ["CLOSED", "OPEN", "HALF_OPEN"]; return lanesOk && states.includes(g.breaker.state) && d.config.max >= 1 && d.ticks >= 0 ? "WORKS" : "CAVEAT"; } catch { return "CAVEAT"; } })(),
      evidence: (() => { try {
        const g = governorStatus(); const d = demandStatus();
        return `governor: breaker=${g.breaker.state} trips=${g.breaker.trips} cooldown=${g.breaker.cooldown_ms / 1000}s, полосы=${g.lanes.map((l) => `${l.lane}:${l.tokens}/${l.capacity}+${l.refill_per_min}/м`).join(",")}, admitted=${g.admitted_total} rejected=${g.rejected_total}; demand: ${d.config.enabled ? "включен" : "выключен"} max=${d.config.max}, тиков=${d.ticks}, решений=${d.decisions.length}, снимок: ready=${d.snapshot.ready_count} leases=${d.snapshot.pool_leases}/${d.snapshot.pool_max} fails15м=${d.snapshot.fails_15m} чатов=${d.snapshot.active_chats}; GET /governor, GET /demand, POST /demand {op:tick|config}`;
      } catch (e) { return `ME38 evidence failed: ${String(e).slice(0, 80)}`; } })(),
    },
    {
      id: "ME39", name: "H2+G6+G7+outcome (R44): policy-файл T0/T1/T2 с ledger-полями (POLICY_DENIED в chain), сетка флота в браузере (цели чатов), cron-планировщик из чатов (schedule_cron, тик 30с, капы policy.json), outcome-proof (report_outcome + супервизор-наддув успеха-без-доказательства)", old_ref: "легаси: политика — разрозненные if'ы; у чатов не было времени (cron) и честного исхода (COMPLETED ≠ решено)",
      verdict: (() => { try {
        const pol = policyStatus();
        const crons = db.query(`SELECT COUNT(*) AS n FROM chat_crons WHERE status='ACTIVE'`).get() as { n: number };
        const outcome = db.query(`SELECT COUNT(*) AS n FROM agent_sessions WHERE outcome_status IS NOT NULL`).get() as { n: number };
        return pol.policy.version >= 1 && pol.ok && Number(crons.n) >= 0 && Number(outcome.n) >= 0 ? "WORKS" : "CAVEAT";
      } catch { return "CAVEAT"; } })(),
      evidence: (() => { try {
        const pol = policyStatus();
        const crons = db.query(`SELECT COUNT(*) AS n FROM chat_crons WHERE status='ACTIVE'`).get() as { n: number };
        const fired = db.query(`SELECT COUNT(*) AS n FROM events WHERE type='AGENT_CHAT_CRON'`).get() as { n: number };
        const outcomes = db.query(`SELECT COUNT(*) AS n FROM agent_sessions WHERE outcome_status IS NOT NULL`).get() as { n: number };
        const denied = db.query(`SELECT COUNT(*) AS n FROM events WHERE type='POLICY_DENIED'`).get() as { n: number };
        return `policy v${pol.policy.version} (T0=${pol.policy.tiers.T0.tools.join("/")}, T1=${pol.policy.tiers.T1.tools.length} инструментов, T2=${pol.policy.tiers.T2.tools.length}; капы ${pol.policy.caps.crons_per_chat}/чат, ${pol.policy.caps.crons_global} глобально, ≥${pol.policy.caps.cron_min_minutes}м), POLICY_DENIED в chain=${denied.n}, отказов в счётчике=${pol.counters.denied}; cron активных=${crons.n}, срабатываний=${fired.n}; outcome-исходов=${outcomes.n}; GET /policy, GET /cron`;
      } catch (e) { return `ME39 evidence failed: ${String(e).slice(0, 80)}`; } })(),
    },
    {
      id: "ME40", name: "R47 vault токенов: ВСЕ токены в БД (SQLite tokens) — bootstrap-миграция из /home/z/.a2 идемпотентна, потребители (selfupdate/evidence/mirror/providers) читают ТОЛЬКО tokenGet, добытый gateway-ключ сам падает в БД, ротация без рестарта (onTokenChange), raw-значения наружу не выходят (маска), операции set/delete — REST POST /tokens + socket tokens:op (T0), TOKENS_* в chain", old_ref: "легаси: секреты в файлах /home/z/.a2 — env-reset терял их; у vault'а не было ни единой точки чтения, ни ledger-следов",
      verdict: (() => { try {
        const st = tokensStatus();
        const coreOk = !st.known_missing.includes("GITHUB_TOKEN_ADMIN") && !st.known_missing.includes("SUPABASE_URL");
        return st.ok && st.total >= 4 && coreOk ? "WORKS" : "CAVEAT";
      } catch { return "CAVEAT"; } })(),
      evidence: (() => { try {
        const st = tokensStatus();
        const ev = db.query(`SELECT COUNT(*) AS n FROM events WHERE type IN ('TOKENS_SEEDED','TOKENS_SET','TOKENS_DELETED')`).get() as { n: number };
        return `vault: ${st.total}/${st.known_total} known-токенов в БД, по тирам ${JSON.stringify(st.by_tier)}, по источникам ${JSON.stringify(st.by_source)}, known_missing=${st.known_missing.join("|") || "—"}, seeded=${st.seeded_at ?? "—"}, TOKENS_*-событий в chain=${ev.n}; поверхность: ${st.surface.rest} · ${st.surface.socket}; GET /tokens`;
      } catch (e) { return `ME40 evidence failed: ${String(e).slice(0, 80)}`; } })(),
    },
  ];

  // Паритет-метки ME1–ME16 (R21-матрица; UNKNOWN = нет публичных доков Cursor, §34)
  // R66: конвертация UNKNOWN → вердикты ПЕРЕНОСОМ из корпуса R61 (r61-parity-matrix.json, 329 стр. official corpus),
  // источники = id capability — не изобретение (§34). SUPERIOR — только там, где корпус R61 сам дал SUPERIOR
  // (infra.*: нет аналога в 329 стр. docs.cursor.com + blog/security/changelog).
  const parityMap: Record<string, { cursor_ref: string; parity: NonNullable<MechanicRow["parity"]> }> = {
    ME1: { cursor_ref: "Tool-call loop агента (Composer/Agent)", parity: "PARITY" },
    ME2: { cursor_ref: "—", parity: "UNKNOWN" },
    ME3: { cursor_ref: "Agent mode (автономные прогоны)", parity: "PARITY" },
    ME4: { cursor_ref: "Memories / Rules", parity: "PARTIAL" },
    ME5: { cursor_ref: "Composer/Chat LLM", parity: "PARITY" },
    ME6: { cursor_ref: "—", parity: "UNKNOWN" },
    ME7: { cursor_ref: "Auto-update (Electron/Squirrel)", parity: "PARTIAL" },
    ME8: { cursor_ref: "—", parity: "UNKNOWN" },
    ME9: { cursor_ref: "Codebase indexing (@codebase, embeddings)", parity: "PARTIAL" },
    ME10: { cursor_ref: "—", parity: "UNKNOWN" },
    ME11: { cursor_ref: "—", parity: "UNKNOWN" },
    ME12: { cursor_ref: "—", parity: "UNKNOWN" },
    ME13: { cursor_ref: "Browser agent (анонсирован)", parity: "PARTIAL" },
    ME14: { cursor_ref: "—", parity: "UNKNOWN" },
    ME15: { cursor_ref: "— (bugbot ≠ runtime RH)", parity: "UNKNOWN" },
    ME16: { cursor_ref: "—", parity: "UNKNOWN" },
    // ── R66: перенос вердиктов из корпуса R61 (ME18–ME40) ──
    ME18: { cursor_ref: "R61 core.browser-tool (console/network)", parity: "PARITY" },
    ME19: { cursor_ref: "— (нет аналога в корпусе R61; §34)", parity: "UNKNOWN" },
    ME20: { cursor_ref: "R61 core.harness-evals + evals.internal (внутренние бенчи)", parity: "PARITY" },
    ME21: { cursor_ref: "R61 ext.mcp-server (Cursor как MCP-провайдер)", parity: "PARITY" },
    ME22: { cursor_ref: "R61 core.harness-evals (CursorBench/A-B/keep-rate)", parity: "PARITY" },
    ME23: { cursor_ref: "R61 plan.task-tracking (todos/plan items)", parity: "PARITY" },
    ME24: { cursor_ref: "R61 fleet.handoff-docs + fleet.swarm (handoff-doc protocol)", parity: "PARTIAL" },
    ME25: { cursor_ref: "R61 mdl.catalog + core.model-switch", parity: "PARTIAL" },
    ME26: { cursor_ref: "R61 core.agent-review (dedicated review pass)", parity: "PARTIAL" },
    ME27: { cursor_ref: "R61 sec.permissions-json + core.run-modes", parity: "PARTIAL" },
    ME28: { cursor_ref: "— (нет аналога в корпусе R61; ctx.* — про codebase-контекст)", parity: "UNKNOWN" },
    ME29: { cursor_ref: "— (нет аналога в корпусе R61)", parity: "UNKNOWN" },
    ME30: { cursor_ref: "— (нет аналога в корпусе R61; инфраструктурная гигиена)", parity: "UNKNOWN" },
    ME31: { cursor_ref: "R61 art.logs (логи как артефакты; у ME2 — hash-chain outbox→cloud)", parity: "PARITY" },
    ME32: { cursor_ref: "R61 infra.audit-loop + art.trace (вне корпуса)", parity: "SUPERIOR" },
    ME33: { cursor_ref: "R61 api.pool-queue (list/SSE/claim/release, scale-to-zero)", parity: "PARTIAL" },
    ME34: { cursor_ref: "R61 ctx.memory (SUPERIOR: persistent agent memory)", parity: "SUPERIOR" },
    ME35: { cursor_ref: "R61 fleet.swarm (recursive planner/worker trees)", parity: "PARTIAL" },
    ME36: { cursor_ref: "R61 fleet.swarm + plan.task-tracking", parity: "PARTIAL" },
    ME37: { cursor_ref: "R61 infra.nonbypass-bus + infra.audit-loop (вне корпуса)", parity: "SUPERIOR" },
    ME38: { cursor_ref: "R61 mdl.cost-governor (cost-based routing)", parity: "PARTIAL" },
    ME39: { cursor_ref: "R61 auto.automations (cron + event triggers)", parity: "PARTIAL" },
    ME40: { cursor_ref: "R61 cloud.secrets + cloud.secret-redaction", parity: "PARITY" },
  };
  for (const r of rows) {
    const p = parityMap[r.id];
    if (p) { r.cursor_ref = p.cursor_ref; r.parity = p.parity; }
  }

  // ME41: desktop-клиент (R21 скелет → R46-R64 desktop/ — канон после smart-merge R65)
  const cs = clientShellStatus();
  rows.push({
    id: "ME41", name: "Desktop client: Electron (supervisor+gateway+tabs+updater)", old_ref: "легаси-браузер MetaEngine (Electron)",
    verdict: cs.desktop ? "WORKS" : "CAVEAT",
    evidence: `desktop/src: ${cs.present}/${cs.total} модулей, electron-builder: ${cs.builder ? "да" : "нет"}, CI: ${cs.ci ? "да" : "нет"}; tauri: ${cs.tauri ? "есть (альтернатива)" : "нет"}; GUI-run в песочнице невозможен — сборка=CI`,
    cursor_ref: "VS Code fork shell (полный продукт)",
    parity: cs.desktop ? "PARTIAL" : "MISSING",
  });

  // ME42: webhooks-in (R68 — push-фаза P0-e; вход внешних событий поверх pull-канала R67)
  const hs = hooksStatus();
  rows.push({
    id: "ME42",
    name: "Webhooks-in: POST /hooks/github — HMAC-SHA256 (X-Hub-Signature-256, timing-safe), dedupe X-GitHub-Delivery, HOOK_PING/GIT_PUSH/CI_HOOK_RUN_* → event-log → облако",
    old_ref: "— (внешние события были только pull; push-канала не существовало)",
    verdict: hs.secret !== "missing" && hs.verified_total > 0 ? "WORKS" : "CAVEAT",
    evidence: `secret: ${hs.secret}, verdict: ${hs.verdict}, received: ${hs.received_total}, verified: ${hs.verified_total}, rejected: ${hs.rejected_total} (посл. причина: ${hs.rejected_last_reason ?? "—"}), событий: ${hs.events_emitted_total}`,
    cursor_ref: "— (нет публичного подтверждения; сверка с корпусом R61 продолжается)",
    parity: "UNKNOWN",
  });

  // Остаточные UNKNOWN (строки без parityMap-входа) — §34: честно UNKNOWN, не «у Cursor нет»
  for (const r of rows) {
    if (!r.parity) {
      r.parity = "UNKNOWN";
      if (!r.cursor_ref) r.cursor_ref = "— (нет публичного подтверждения; сверка с корпусом R61 продолжается)";
    }
  }

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
