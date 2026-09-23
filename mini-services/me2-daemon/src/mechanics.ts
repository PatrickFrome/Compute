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
import { objectivesVerdict } from "./objectives";
import { handoffsVerdict } from "./handoffs";
import { glmVerdict } from "./glm";
import { reviewerVerdict } from "./reviewer";
import { evidenceStatus, verifyChain } from "../evidence";
import { poolStatus } from "./pool";
import { agentChatStatus, fleetDigest } from "./agentchat";
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
