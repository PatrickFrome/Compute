/**
 * ME2 Daemon — ядро METAENGINE 2 (M1).
 * API-native agent runtime: агенты = контексты + инструменты, НЕ вкладки браузера.
 * Горячий путь: локальный SQLite + command bus (single-writer).
 *
 * Порты (через gateway XTransformPort):
 *   :3040 — socket.io, path '/' (WS-канал: snapshot push + события + команды)
 *   :3041 — REST API (health/state/commands/tasks/agents/workers/budget/reset)
 *
 * Запуск long-run: setsid nohup bun index.ts > daemon.log 2>&1 &
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "socket.io";
import {
  listAgents, listTasks, getTask, tailEvents, eventsByTask, db, emit, snapshot,
  enqueueCommand, budgetWindow, listCommands, listWorkers, upsertWorker,
  getMeta, setMeta, reapStaleWorkers, lastSeq, onEvent,
  createAgent, createTask, nowIso, setTaskReflectionLlm,
} from "./store";
import { listProviders } from "./providers";
import { startMasterLoop, watchdogStaleTasks } from "./worker";
import { drainCommands, runOne, knownActions, actionCatalog, abGroupOf } from "./commands";
import { initEvidence, evidenceStatus } from "./evidence";
import { startScreencastServer } from "./src/screencast";
import { obsvStart, obsvSnapshot, obsvReset, obsvStop } from "./src/obsv";
import { fenceList, fenceClear, verdictStats } from "./src/effect";
import { codegraphSummary, codegraphImpact } from "./src/codegraph";
import { otelStatus, toOtlp, onDaemonEvent, recordSpan } from "./src/otel";
import { listWorktrees, repoHead, rerereStatus, rerereEnable, rerereRemaining } from "./src/worktrees";
import {
  listSandboxes, listSnapshots, createSandbox, execInSandbox, snapshotSandbox, restoreSnapshot, destroySandbox, sandboxCaps,
} from "./src/sandbox";
import { roadmapVerdict } from "./src/roadmap";
import {
  memSearch, memWrite, memDelete, memoryStatus, memBlock, onMemoryEvent,
} from "./src/memory";
import { brainThink, brainStatus } from "./src/brain";
import { fleetList, fleetBeat, fleetSelfTick, fleetGc, fleetTick } from "./src/fleet";
import { suCheckAsync, suApply, suCached, selfupdateStatus } from "./src/selfupdate";
import { rsiPropose, rsiAdopt, rsiReject, rsiRollback, rsiList } from "./src/rsi";
import { mechanicsMatrix } from "./src/mechanics";
import { senseNow, senseList, senseAct } from "./src/sense";
import { benchObserve, benchBootStart, benchBootDone, benchSnapshot, benchVerdict } from "./src/bench";
import { mcpHandle, mcpStatus } from "./src/mcp";
import { evalRun, evalStatus } from "./src/eval";
import { gateCheck, approvalsStatus, approvalRequest, approvalDecide, policySet } from "./src/approvals";
import { listObjectives, createObjective, setObjectiveStatus, deleteObjective, workGraph, OBJECTIVE_STATUSES } from "./src/objectives";
import { handoffList, handoffStats } from "./src/handoffs";
import { glmStatus, glmProbe, upgradeAgents, setLatestGlm, glmVerdict, agentTag } from "./src/glm";
import { reviewList, reviewStats, reviewTask, reviewerVerdict } from "./src/reviewer";

const WS_PORT = 3040;
const REST_PORT = 3041;
const VERSION = "0.28.0";
const BOOT_TS = nowIso();
const BOOT_T0 = Date.now();
benchBootStart(BOOT_T0); // B3: baseline boot-длительности стартует с началом процесса
setMeta("boot", BOOT_TS);
setMeta("version", VERSION);

// ── seed (однократно) ─────────────────────────────────────────────
function seed() {
  if (getMeta("seeded") === "1") return;
  const a1 = createAgent("IMPLEMENTER", "zai:default");
  const a2 = createAgent("RESEARCHER", "zai:default");
  emit("AGENT_CREATED", { role: "IMPLEMENTER", model: "zai:default", seed: true }, a1.id, null);
  emit("AGENT_CREATED", { role: "RESEARCHER", model: "zai:default", seed: true }, a2.id, null);

  const t1 = createTask({
    id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: "ME2 smoke: осмотреть workspace, создать hello.txt с версией daemon",
    spec: "Это smoke-задача рантайма ME2. Шаги: 1) list_dir . 2) write_file hello.txt с текстом 'ME2 daemon v0.3.0 live at <текущая дата>' 3) finish с результатом.",
    role: "IMPLEMENTER", max_steps: 4,
  });
  const t2 = createTask({
    id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: "Ресёрч: 3 ключевых тренда agent-runtime 2026",
    spec: "Используй web_search по запросу 'agent runtime trends 2026'. Сделай саммари из 3 пунктов (по 1-2 предложения). Заверши через finish.",
    role: "RESEARCHER", max_steps: 5,
  });
  const t3 = createTask({
    id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: "Создать структуру docs/: index.md и architecture.md (заглушки)",
    spec: "В workspace: write_file docs/index.md ('# ME2 Docs') и docs/architecture.md ('# Architecture: daemon + console'). finish после создания.",
    role: "IMPLEMENTER", max_steps: 4,
  });
  emit("TASK_QUEUED", { seed: true, title: t1.title }, null, t1.id);
  emit("TASK_QUEUED", { seed: true, title: t2.title }, null, t2.id);
  emit("TASK_QUEUED", { seed: true, title: t3.title }, null, t3.id);
  setMeta("seeded", "1");
  console.log("[seed] agents: 2, tasks: 3");
}
seed();
// R29: директива оператора «все агенты всегда на последней GLM» — при каждой инкарнации
// флот приводится к каноническому тегу; живая probe бэкенда — async (урок R25: сеть вне boot-пути).
try {
  const up = upgradeAgents();
  console.log(`[glm] canonical=${agentTag()} upgraded=${up.upgraded} already=${up.already}`);
} catch (e) { console.log(`[glm] upgrade failed: ${String(e).slice(0, 120)}`); }
setTimeout(() => { void glmProbe(); }, 3_000);

// ── REST API (:3041) ──────────────────────────────────────────────
function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { return {}; }
}

async function restHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${REST_PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  try {
    if (path === "/health") {
      return json(res, 200, {
        ok: true, service: "me2-daemon", version: VERSION, boot: BOOT_TS,
        last_seq: lastSeq(), actions: knownActions().length, ts: nowIso(),
      });
    }
    if (path === "/state" && req.method === "GET") return json(res, 200, snapshot());
    if (path === "/budget" && req.method === "GET") return json(res, 200, { ok: true, ...budgetWindow() });
    if (path === "/actions" && req.method === "GET") return json(res, 200, { ok: true, count: actionCatalog().length, total_target: 47, actions: actionCatalog() });
    if (path === "/evidence" && req.method === "GET") return json(res, 200, evidenceStatus());
    if (path === "/providers" && req.method === "GET") return json(res, 200, { ok: true, providers: await listProviders() });

    // ── R16: M2 Code Graph v1 (read-only, вне шины — скан не мутирует состояние) ──
    if (path === "/codegraph" && req.method === "GET") return json(res, 200, codegraphSummary(url.searchParams.get("force") === "1"));
    if (path === "/codegraph/scan" && req.method === "POST") return json(res, 200, codegraphSummary(true));
    if (path === "/codegraph/impact" && req.method === "GET") {
      const f = url.searchParams.get("file");
      if (!f) return json(res, 400, { ok: false, error: "file_required" });
      return json(res, 200, codegraphImpact(f));
    }

    // ── R16: M4 worktrees+rerere (GET read; enable — maintenance-эндпоинт, как /reflect) ──
    if (path === "/worktrees" && req.method === "GET") {
      return json(res, 200, { ok: true, ...repoHead(), worktrees: listWorktrees(), rerere: { ...rerereStatus(), ...rerereRemaining() } });
    }
    if (path === "/worktrees/rerere" && req.method === "POST") {
      try { return json(res, 200, { ok: true, rerere: { ...rerereEnable(), ...rerereRemaining() } }); }
      catch (e) { return json(res, 500, { ok: false, error: (e as Error).message }); }
    }

    // ── R16: M7 OTel-lite ──
    if (path === "/spans" && req.method === "GET") return json(res, 200, otelStatus());
    if (path === "/spans/otlp" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 200);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify(toOtlp(limit)));
    }

    // ── R17: M5 Sandbox Plane (create/exec/snapshot/restore/destroy — op-switch) ──
    if (path === "/sandboxes" && req.method === "GET") {
      return json(res, 200, { ok: true, ...listSandboxes(), snapshots: listSnapshots().snapshots });
    }
    if (path === "/sandbox" && req.method === "POST") {
      const body = await readBody(req);
      const op = String(body.op ?? "");
      try {
        if (op === "create") return json(res, 201, { ok: true, sandbox: createSandbox(String(body.id ?? "")) });
        if (op === "exec") return json(res, 200, { ok: true, run: execInSandbox(String(body.id ?? ""), String(body.cmd ?? ""), Number(body.timeoutSec ?? 30)) });
        if (op === "snapshot") return json(res, 200, { ok: true, snapshot: snapshotSandbox(String(body.id ?? "")) });
        if (op === "restore") return json(res, 201, { ok: true, sandbox: restoreSnapshot(String(body.snapshotFile ?? ""), body.newId ? String(body.newId) : undefined) });
        if (op === "destroy") return json(res, 200, { ok: true, ...destroySandbox(String(body.id ?? "")) });
        return json(res, 400, { ok: false, error: "op_required: create|exec|snapshot|restore|destroy" });
      } catch (e) {
        return json(res, 400, { ok: false, error: (e as Error).message });
      }
    }

    // ── R17: LIVE Roadmap M1–M7 (вердикт из реального состояния, evidence в каждой фазе) ──
    if (path === "/roadmap" && req.method === "GET") return json(res, 200, roadmapVerdict());

    // ── R18: reward-hacking вердикты (tier-1: finish без реальной работы) ──
    if (path === "/verdicts" && req.method === "GET") {
      const evs = tailEvents(0, 500).filter((e) => e.type === "TASK_REWARD_HACK");
      const verdicts = evs.slice(-50).map((e) => {
        try { return { seq: e.seq, task_id: e.task_id, at: e.ts, ...(JSON.parse(e.data) as Record<string, unknown>) }; }
        catch { return { seq: e.seq, task_id: e.task_id, at: e.ts, raw: e.data.slice(0, 200) }; }
      });
      return json(res, 200, { ok: true, count: verdicts.length, verdicts });
    }

    // ── R19: ME4 MEMORY (порт M13, теперь с persistence) ──
    if (path === "/memory" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? undefined;
      const kind = url.searchParams.get("kind") ?? undefined;
      const limit = Number(url.searchParams.get("limit") ?? 12);
      const rows = memSearch({ q, kind, limit });
      return json(res, 200, { ok: true, rows, status: memoryStatus() });
    }
    if (path === "/memory/block" && req.method === "GET") {
      const n = Number(url.searchParams.get("n") ?? 5);
      const budget = Number(url.searchParams.get("budget") ?? 1400);
      return json(res, 200, { ok: true, ...memBlock(n, budget) });
    }
    if (path === "/memory" && req.method === "POST") {
      const body = await readBody(req);
      const op = String(body.op ?? "write");
      try {
        if (op === "write") {
          const row = memWrite({
            kind: String(body.kind ?? "semantic") as "episodic" | "semantic" | "procedural",
            key: String(body.key ?? ""), content: String(body.content ?? ""),
            tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
            importance: body.importance !== undefined ? Number(body.importance) : undefined,
          });
          return json(res, 201, { ok: true, row });
        }
        if (op === "delete") return json(res, 200, { ok: true, deleted: memDelete(Number(body.id)) });
        return json(res, 400, { ok: false, error: "op_required: write|delete" });
      } catch (e) { return json(res, 400, { ok: false, error: (e as Error).message }); }
    }

    // ── R19: ME5 BRAIN ──
    if (path === "/brain" && req.method === "GET") return json(res, 200, brainStatus());
    if (path === "/brain/think" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const thought = await brainThink(String(body.goal ?? ""));
        return json(res, 200, { ok: true, thought });
      } catch (e) {
        return json(res, (e as Error).message === "goal_required" ? 400 : 502, { ok: false, error: (e as Error).message });
      }
    }

    // ── R19: ME6 FLEET ──
    if (path === "/fleet" && req.method === "GET") return json(res, 200, fleetList());
    if (path === "/fleet/beat" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const node = fleetBeat({
          id: String(body.id ?? ""), kind: body.kind ? String(body.kind) : undefined,
          caps: (body.caps ?? {}) as Record<string, unknown>, meta: (body.meta ?? {}) as Record<string, unknown>,
          proof: body.proof ? String(body.proof) : undefined,
        });
        return json(res, 200, { ok: true, node });
      } catch (e) { return json(res, 400, { ok: false, error: (e as Error).message }); }
    }

    // ── R19: ME7 SELF-UPDATE (барьеры: dirty/diverged → отказ, ff-only) ──
    if (path === "/selfupdate" && req.method === "GET") return json(res, 200, selfupdateStatus(VERSION));
    if (path === "/selfupdate" && req.method === "POST") {
      const body = await readBody(req);
      const op = String(body.op ?? "check");
      try {
        if (op === "check") return json(res, 200, { ok: true, check: await suCheckAsync(VERSION, true) });
        if (op === "apply") {
          // R30 C4: authority-гейт — selfupdate меняет живой код daemon (один approve = один apply)
          const g = gateCheck("authority_effect", "selfupdate:apply", "Self-update daemon (apply) — смена живого кода");
          if (!g.allowed) return json(res, 403, { ok: false, error: g.reason, gate: "authority_effect", approval_id: g.approval_id ?? null });
          return json(res, 200, suApply(VERSION));
        }
        return json(res, 400, { ok: false, error: "op_required: check|apply" });
      } catch (e) { return json(res, 500, { ok: false, error: (e as Error).message }); }
    }

    // ── R19: ME8 RSI (propose авто/оператор; adopt/reject/rollback — только оператор) ──
    if (path === "/rsi" && req.method === "GET") return json(res, 200, rsiList());
    if (path === "/rsi" && req.method === "POST") {
      const body = await readBody(req);
      const op = String(body.op ?? "propose");
      try {
        if (op === "propose") return json(res, 201, { ok: true, proposal: await rsiPropose({ auto: body.auto !== false, hint: body.hint ? String(body.hint) : undefined }) });
        if (op === "adopt") {
          // R30 C4: RSI-гейт — принятие предложения пишет артефакт в skills/ (один approve = один adopt)
          const pid = String(body.id ?? "");
          const g = gateCheck("rsi_adopt", `rsi:${pid}`, `RSI adopt ${pid}`);
          if (!g.allowed) return json(res, 403, { ok: false, error: g.reason, gate: "rsi_adopt", approval_id: g.approval_id ?? null });
          return json(res, 200, { ok: true, proposal: rsiAdopt(pid) });
        }
        if (op === "reject") return json(res, 200, { ok: true, proposal: rsiReject(String(body.id ?? "")) });
        if (op === "rollback") return json(res, 200, { ok: true, proposal: rsiRollback(String(body.id ?? "")) });
        return json(res, 400, { ok: false, error: "op_required: propose|adopt|reject|rollback" });
      } catch (e) {
        return json(res, 400, { ok: false, error: (e as Error).message });
      }
    }

    // ── R19: ME-матрица (порт реестра механик M1–M18 старой системы) ──
    if (path === "/mechanics" && req.method === "GET") {
      return json(res, 200, mechanicsMatrix(VERSION, suCached()));
    }

    // ── R20: BROWSER-SENSE (порт легаси semantic-perception, вне шины — 47/47 инвариант) ──
    if (path === "/browser/sense" && req.method === "GET") {
      const refresh = url.searchParams.get("refresh") === "1";
      const tab = url.searchParams.get("tab") ?? undefined;
      try {
        if (refresh) {
          const row = await senseNow(tab);
          return json(res, 200, { ok: true, ...row });
        }
        return json(res, 200, senseList());
      } catch (e) { return json(res, 502, { ok: false, error: (e as Error).message }); }
    }
    if (path === "/browser/sense/act" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const r = await senseAct({
          key: String(body.key ?? ""),
          action: (String(body.action ?? "click") as "click" | "type" | "press"),
          text: body.text ? String(body.text) : undefined,
          tab: body.tab ? String(body.tab) : undefined,
        });
        return json(res, 200, r);
      } catch (e) { return json(res, 400, { ok: false, error: (e as Error).message }); }
    }

    // ── R21: BROWSER-OBSV (S2: CDP network/console/exceptions сенсоры, вне шины — 47/47) ──
    if (path === "/browser/obsv" && req.method === "GET") {
      obsvStart(); // ленивый старт колектора (идемпотентно)
      const limit = parseInt(url.searchParams.get("limit") ?? "", 10);
      return json(res, 200, obsvSnapshot({
        limit: Number.isFinite(limit) ? limit : 40,
        level: url.searchParams.get("level") ?? undefined,
        filter: url.searchParams.get("filter") ?? undefined,
      }));
    }
    if (path === "/browser/obsv" && req.method === "POST") {
      const body = await readBody(req);
      const op = String(body.op ?? "");
      if (op === "reset") { obsvReset(); return json(res, 200, { ok: true, op: "reset" }); }
      if (op === "stop") { obsvStop(); return json(res, 200, { ok: true, op: "stop" }); }
      if (op === "attach") { obsvStart(); return json(res, 200, { ok: true, op: "attach" }); }
      return json(res, 400, { ok: false, error: "op_required: attach|reset|stop" });
    }

    // ── R23: EFFECT-плоскость (5 статусов + durable fences, вне шины — 47/47) ──
    if (path === "/browser/effect" && req.method === "GET") {
      return json(res, 200, { ok: true, fences: fenceList(60), stats: verdictStats() });
    }
    if (path === "/browser/effect" && req.method === "POST") {
      const body = await readBody(req);
      const op = String(body.op ?? "");
      if (op === "clear") {
        const key = String(body.effect_key ?? "");
        if (!key) return json(res, 400, { ok: false, error: "effect_key_required" });
        // R30 C4: fence-гейт — снятие durable fence требует живого согласия (один approve = одно снятие)
        const g = gateCheck("fence_clear", `fence:${key}`, `Снятие fence ${key}`);
        if (!g.allowed) return json(res, 403, { ok: false, error: g.reason, gate: "fence_clear", approval_id: g.approval_id ?? null });
        const cleared = fenceClear(key, body.note ? String(body.note) : undefined);
        return json(res, cleared ? 200 : 404, { ok: cleared, op: "clear", effect_key: key });
      }
      return json(res, 400, { ok: false, error: "op_required: clear" });
    }

    // ── R30 C4: APPROVAL-ПОЛИТИКИ (гейты мутирующих операций в одном месте, вне шины — 47/47) ──
    if (path === "/approvals" && req.method === "GET") return json(res, 200, approvalsStatus());
    if (path === "/approvals" && req.method === "POST") {
      const body = await readBody(req);
      const op = String(body.op ?? "");
      try {
        if (op === "request") return json(res, 201, { ok: true, approval: approvalRequest(String(body.gate ?? ""), String(body.subject ?? ""), String(body.label ?? body.subject ?? "")) });
        if (op === "approve") return json(res, 200, { ok: true, approval: approvalDecide(String(body.id ?? ""), "APPROVED", body.note ? String(body.note) : undefined) });
        if (op === "deny") return json(res, 200, { ok: true, approval: approvalDecide(String(body.id ?? ""), "DENIED", body.note ? String(body.note) : undefined) });
        if (op === "policy") return json(res, 200, { ok: true, policy: policySet(String(body.gate ?? ""), String(body.mode ?? "")) });
        return json(res, 400, { ok: false, error: "op_required: request|approve|deny|policy" });
      } catch (e) {
        return json(res, 400, { ok: false, error: (e as Error).message });
      }
    }

    // ── command bus: единственная точка мутаций ──
    if (path === "/commands" && req.method === "POST") {
      const body = await readBody(req);
      const r = enqueueCommand({
        action: String(body.action ?? ""),
        lane: body.lane ? String(body.lane) : undefined,
        payload: (body.payload ?? {}) as Record<string, unknown>,
        idempotency_key: body.idempotency_key ? String(body.idempotency_key) : null,
        cost: body.cost !== undefined ? Number(body.cost) : undefined,
        run_after: body.run_after !== undefined ? Number(body.run_after) : undefined,
      });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      // отложенная команда не исполняется синхронно — её подберёт дренаж, когда время придёт
      const cmd = (r.deduped || (r.command.run_after && r.command.run_after > Date.now())) ? r.command : await runOne(r.command);
      let result: unknown = null;
      try { result = cmd.result ? JSON.parse(cmd.result) : null; } catch { result = cmd.result; }
      return json(res, r.deduped ? 200 : 201, { ok: true, deduped: r.deduped, command: cmd, result });
    }
    if (path === "/commands" && req.method === "GET") return json(res, 200, { ok: true, commands: listCommands(100) });

    // ── workers ──
    if (path === "/workers" && req.method === "GET") return json(res, 200, { ok: true, workers: listWorkers() });
    if (path === "/workers/heartbeat" && req.method === "POST") {
      const body = await readBody(req);
      const w = upsertWorker({
        id: body.id ? String(body.id) : undefined,
        role: String(body.role ?? "console"),
        kind: String(body.kind ?? "API"),
        state: body.state ? String(body.state) : undefined,
      });
      return json(res, 200, { ok: true, worker: w });
    }

    // ── удобные обёртки (внутри всё равно command bus) ──
    if (path === "/agents" && req.method === "GET") return json(res, 200, { ok: true, agents: listAgents() });
    if (path === "/agents" && req.method === "POST") {
      const body = await readBody(req);
      const r = enqueueCommand({ action: "AGENT_SPAWN", payload: { role: body.role, model: body.model }, idempotency_key: body.idempotency_key ? String(body.idempotency_key) : null });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      const cmd = await runOne(r.command);
      return json(res, 201, { ok: true, result: cmd.result ? JSON.parse(cmd.result) : null });
    }
    if (path.startsWith("/agents/") && req.method === "DELETE") {
      const id = path.split("/")[2];
      const r = enqueueCommand({ action: "AGENT_RETIRE", lane: "CONTROL", payload: { id } });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      await runOne(r.command);
      return json(res, 200, { ok: true });
    }
    if (path === "/tasks" && req.method === "GET") return json(res, 200, { ok: true, tasks: listTasks() });
    // ── R28 C2: handoffs — передача задач между агентами (протокол Codex handoffs) ──
    if (path === "/handoffs" && req.method === "GET") {
      return json(res, 200, { ok: true, handoffs: handoffList(20), stats: handoffStats() });
    }
    // ── R29: GLM currency plane (директива «агенты всегда на последней версии») ──
    if (path === "/glm" && req.method === "GET") return json(res, 200, glmStatus());
    if (path === "/glm" && req.method === "POST") {
      const body = await readBody(req);
      const op = String(body.op ?? "");
      try {
        if (op === "probe") return json(res, 200, { ok: true, probe: await glmProbe() });
        if (op === "upgrade") return json(res, 200, { ok: true, ...upgradeAgents() });
        if (op === "set_latest") return json(res, 200, { ok: true, result: setLatestGlm(String(body.model ?? "")) });
        return json(res, 400, { ok: false, error: "op_required: probe|upgrade|set_latest" });
      } catch (e) {
        return json(res, 400, { ok: false, error: (e as Error).message });
      }
    }
    // ── R29 C3: reviewer-agent (антифальшь-ревью результатов против спека) ──
    if (path === "/reviews" && req.method === "GET") {
      return json(res, 200, { ok: true, reviews: reviewList(20), stats: reviewStats() });
    }
    if (path === "/reviews/run" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.task_id ?? "").trim();
      if (!id) return json(res, 400, { ok: false, error: "task_id_required" });
      try {
        const r = reviewTask(id);
        return json(res, 202, { ok: true, scheduled: true, idempotent: r === null ? undefined : false, note: "ревью асинхронное — вердикт появится в TASK_REVIEWED и GET /reviews" });
      } catch (e) {
        return json(res, (e as Error).message === "task_not_found" ? 404 : 400, { ok: false, error: (e as Error).message });
      }
    }
    if (path.startsWith("/tasks/") && path.endsWith("/handoff") && req.method === "POST") {
      const id = path.split("/")[2];
      const body = await readBody(req);
      // Через шину (TASK_ENQUEUE+handoff) — 47/47 инвариант; ошибка шины доходит до оператора (fails-closed)
      const r = enqueueCommand({
        action: "TASK_ENQUEUE",
        payload: {
          handoff: {
            from_task: id,
            to_role: body.to_role ?? null,
            reason: body.reason,
            protocol: body.protocol ?? { next: body.next ?? "" },
            max_steps: body.max_steps,
            by: body.by ?? "operator",
          },
        },
        idempotency_key: body.idempotency_key ? String(body.idempotency_key) : null,
      });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      const cmd = await runOne(r.command);
      if (cmd.status === "FAILED") return json(res, 400, { ok: false, error: cmd.error ?? "handoff_command_failed", command: cmd.id });
      let parsed: { task?: unknown; handoff?: unknown } | null = null;
      try { parsed = cmd.result ? JSON.parse(cmd.result) as { task?: unknown; handoff?: unknown } : null; } catch { parsed = null; }
      return json(res, 201, { ok: true, task: parsed?.task ?? null, handoff: parsed?.handoff ?? null, command: cmd.id });
    }
    if (path === "/tasks" && req.method === "POST") {
      const body = await readBody(req);
      const r = enqueueCommand({
        action: "TASK_ENQUEUE",
        payload: { title: body.title, spec: body.spec, role: body.role, max_steps: body.max_steps, objective_id: body.objective_id ?? null },
        idempotency_key: body.idempotency_key ? String(body.idempotency_key) : null,
      });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      const cmd = await runOne(r.command);
      // fails-closed: ошибка шины (например objective_not_found) обязана дойти до оператора
      if (cmd.status === "FAILED") return json(res, 400, { ok: false, error: cmd.error ?? "task_command_failed", command: cmd.id });
      const parsed = cmd.result ? (JSON.parse(cmd.result) as { task?: unknown }) : null;
      return json(res, 201, { ok: true, task: parsed?.task ?? null, command: cmd.id });
    }
    if (path.startsWith("/tasks/") && path.endsWith("/cancel") && req.method === "POST") {
      const id = path.split("/")[2];
      const r = enqueueCommand({ action: "TASK_CANCEL", lane: "CONTROL", payload: { id } });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      await runOne(r.command);
      return json(res, 200, { ok: true });
    }
    if (path.startsWith("/tasks/") && path.endsWith("/reflect") && req.method === "POST") {
      // tier-2 LLM-рефлексия (enrichment): пишет llm-блок в tasks.reflection, событие TASK_REFLECTED
      const id = path.split("/")[2];
      const body = await readBody(req);
      const lesson = String(body.lesson ?? "").trim();
      if (!lesson) return json(res, 400, { ok: false, error: "lesson_required" });
      try {
        const ev = setTaskReflectionLlm(id, {
          lesson: lesson.slice(0, 2000),
          fix: body.fix ? String(body.fix).slice(0, 1000) : undefined,
          model: body.model ? String(body.model).slice(0, 64) : undefined,
          source: body.source ? String(body.source).slice(0, 32) : undefined,
        });
        return json(res, 200, { ok: true, id, seq: ev.seq });
      } catch (e) {
        return json(res, (e as Error).message === "task_not_found" ? 404 : 500, { ok: false, error: (e as Error).message });
      }
    }
    if (path.startsWith("/tasks/") && req.method === "GET") {
      const id = path.split("/")[2];
      const t = getTask(id);
      return t ? json(res, 200, { ok: true, task: t }) : json(res, 404, { ok: false, error: "not_found" });
    }
    if (path === "/metrics" && req.method === "GET") {
      // R11: pass-rate ретраев с LLM-уроком vs без — живое измерение Reflexion-эффекта.
      // R13: A/B intent-to-treat — назначение по abGroupOf(parent.id) (детерминированное),
      // сравнение групп независимо от факта генерации урока; control_crossover = control-родители,
      // получившие урок вручную (✦ оператора) — честная видимость загрязнения группы.
      const all = listTasks({ includeArchived: true });
      const byId = new Map(all.map((t) => [t.id, t] as const));
      let withN = 0, withOk = 0, withoutN = 0, withoutOk = 0;
      let tN = 0, tOk = 0, cN = 0, cOk = 0, cCross = 0;
      for (const t of all) {
        if (!t.parent_id) continue;
        const parent = byId.get(t.parent_id);
        if (!parent) continue;
        let hasLlm = false;
        if (parent.reflection) {
          try { hasLlm = Boolean((JSON.parse(parent.reflection) as { llm?: { lesson?: string } })?.llm?.lesson); } catch { hasLlm = false; }
        }
        const ok = t.status === "COMPLETED";
        if (hasLlm) { withN++; if (ok) withOk++; } else { withoutN++; if (ok) withoutOk++; }
        if (abGroupOf(parent.id) === "treatment") { tN++; if (ok) tOk++; }
        else { cN++; if (ok) cOk++; if (hasLlm) cCross++; }
      }
      return json(res, 200, {
        ok: true,
        retries: withN + withoutN,
        with_lesson: { n: withN, completed: withOk, rate: withN ? Math.round((withOk / withN) * 100) : null },
        without_lesson: { n: withoutN, completed: withoutOk, rate: withoutN ? Math.round((withoutOk / withoutN) * 100) : null },
        ab: {
          treatment: { n: tN, completed: tOk, rate: tN ? Math.round((tOk / tN) * 100) : null },
          control: { n: cN, completed: cOk, rate: cN ? Math.round((cOk / cN) * 100) : null },
          control_crossover: cCross,
        },
      });
    }
    if (path === "/events" && req.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);
      const task = url.searchParams.get("task");
      return json(res, 200, { ok: true, events: task ? eventsByTask(task, limit) : tailEvents(since, limit) });
    }
    if (path === "/reset" && req.method === "POST") {
      const r = enqueueCommand({ action: "ENVIRONMENT_RESET", lane: "EMERGENCY", payload: { by: "operator" } });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      await runOne(r.command);
      return json(res, 200, { ok: true });
    }
    // ── R25 B3: перф-бейслайны (GET /bench) + R25 A1: MCP-сервер (POST /mcp) ──
    if (path === "/bench" && req.method === "GET") return json(res, 200, benchSnapshot());
    // ── R26 B1: регресс-датасет + eval-харнесс (ME22) ──
    if (path === "/eval" && req.method === "GET") return json(res, 200, evalStatus(VERSION));
    if (path === "/eval/run" && req.method === "POST") {
      const report = evalRun(VERSION);
      return json(res, 200, report);
    }
    // ── R27 C1: Mission Control — objectives + work_graph (fails-closed, zero-authority) ──
    if (path === "/workgraph" && req.method === "GET") return json(res, 200, workGraph());
    if (path === "/objectives" && req.method === "GET") return json(res, 200, { ok: true, objectives: listObjectives() });
    if (path === "/objectives" && req.method === "POST") {
      const body = await readBody(req);
      const op = String(body.op ?? "create");
      if (op === "create") {
        try {
          const obj = createObjective(String(body.title ?? ""), String(body.spec ?? ""), Number(body.priority ?? 0));
          return json(res, 201, { ok: true, objective: obj });
        } catch (e) { return json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }); }
      }
      if (op === "status") {
        try {
          const obj = setObjectiveStatus(String(body.id ?? ""), String(body.status ?? "") as never, body.result ? String(body.result) : undefined);
          return json(res, 200, { ok: true, objective: obj });
        } catch (e) { return json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }); }
      }
      if (op === "delete") {
        const ok = deleteObjective(String(body.id ?? ""));
        return ok ? json(res, 200, { ok: true }) : json(res, 404, { ok: false, error: "objective_not_found" });
      }
      return json(res, 400, { ok: false, error: `unknown op ${op} (create|status|delete); статусы: ${OBJECTIVE_STATUSES.join("/")} — только оператор` });
    }
    if (path === "/mcp" && req.method === "POST") {
      const body = await readBody(req);
      const out = await mcpHandle(body);
      if (!out) { res.writeHead(202, { "Access-Control-Allow-Origin": "*" }); return res.end(); }
      return json(res, out.status, out.json);
    }
    if (path === "/mcp" && req.method === "GET")
      return json(res, 405, { ok: false, error: "MCP: POST /mcp (Streamable HTTP JSON-RPC); stdio: bun mcp-stdio.ts" });
    return json(res, 404, { ok: false, error: `no route ${req.method} ${path}` });
  } catch (e) {
    return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

// B3: каждый REST-запрос — наблюдение в гистограмму. Классы: hot-path (порог p95<50ms)
// vs admin-эндпоинты (тяжёлые сканы SQLite, без порога — операторские, не горячий путь).
const BENCH_ADMIN_PREFIXES = ["/mechanics", "/codegraph", "/memory", "/rsi", "/roadmap", "/selfupdate", "/spans", "/mcp", "/metrics", "/commands", "/state", "/events", "/eval", "/workgraph", "/objectives", "/handoffs", "/glm", "/reviews", "/approvals"];
const BENCH_BROWSER_PREFIXES = ["/browser", "/screencast"];
function benchClassOf(p: string): BenchProbeName {
  if (BENCH_ADMIN_PREFIXES.some((a) => p === a || p.startsWith(`${a}/`))) return "rest_admin";
  if (BENCH_BROWSER_PREFIXES.some((a) => p === a || p.startsWith(`${a}/`))) return "rest_browser";
  return "rest";
}
type BenchProbeName = Parameters<typeof benchObserve>[0];
const restServer = createServer(async (req, res) => {
  const t0 = Date.now();
  try { await restHandler(req, res); } finally {
    benchObserve(benchClassOf((req.url ?? "/").split("?")[0]), Date.now() - t0);
  }
});

// ── socket.io (:3040, path '/' — требование gateway) ──────────────
const wsHttpServer = createServer();
const io = new Server(wsHttpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

onEvent((e) => {
  io.emit("event", e);
  try { onDaemonEvent(e.type, e.data ? (JSON.parse(e.data) as Record<string, unknown>) : {}, e.task_id); } catch { /* телеметрия не ломает шину */ }
  // R19: авто-материализация памяти из шины (TASK_DONE/FAILED/REWARD_HACK/REFLECTED)
  try {
    onMemoryEvent(e.type, e.data ? (JSON.parse(e.data) as Record<string, unknown>) : {}, e.task_id, {
      title: (id) => getTask(id)?.title ?? null,
      lesson: (id) => {
        const t = getTask(id);
        if (!t?.reflection) return null;
        try { return (JSON.parse(t.reflection) as { llm?: { lesson?: string } })?.llm?.lesson ?? null; }
        catch { return null; }
      },
    });
  } catch (me) { console.error(`[memory-hook] ${e.type}: ${String(me)}`); }
});

io.on("connection", (socket) => {
  socket.emit("hello", { service: "me2-daemon", boot: BOOT_TS, last_seq: lastSeq() });
  socket.emit("snapshot", snapshot());

  // heartbeat консоли → workers
  socket.on("heartbeat", (p: { role?: string; state?: string } = {}, ack?: (r: unknown) => void) => {
    const w = upsertWorker({
      id: `wk_console_${socket.id.slice(0, 8)}`,
      role: String(p.role ?? "console"),
      kind: "API",
      state: p.state ?? "IDLE",
    });
    ack?.({ ok: true, worker: w });
  });

  // команды через WS (request/response семантика)
  socket.on("command", async (p: { action: string; payload?: Record<string, unknown>; idempotency_key?: string; lane?: string; run_after?: number }, ack?: (r: unknown) => void) => {
    try {
      const r = enqueueCommand({
        action: String(p?.action ?? ""),
        lane: p?.lane,
        payload: p?.payload ?? {},
        idempotency_key: p?.idempotency_key ?? null,
        run_after: p?.run_after,
      });
      if (!r.ok) { ack?.({ ok: false, error: r.error }); return; }
      const cmd = (r.deduped || (r.command.run_after && r.command.run_after > Date.now())) ? r.command : await runOne(r.command);
      let result: unknown = null;
      try { result = cmd.result ? JSON.parse(cmd.result) : null; } catch { result = cmd.result; }
      ack?.({ ok: true, deduped: r.deduped, command: cmd, result });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
});

// периодический snapshot push + дренаж команд + reaper
setInterval(() => {
  try { io.emit("snapshot", snapshot()); } catch { /* console может быть offline */ }
}, 2000);
setInterval(() => {
  try { void drainCommands(8); } catch (e) { console.error(`[drain] ${String(e)}`); }
}, 1000);
setInterval(() => {
  try { reapStaleWorkers(); } catch { /* noop */ }
  try { watchdogStaleTasks(); } catch { /* noop */ }
}, 30_000);
// R19: self-node в fleet (liveness-проекция, урок CP-W1) + GC LOST-нод раз в час
fleetSelfTick(VERSION);
setInterval(() => { try { fleetSelfTick(VERSION); } catch { /* noop */ } }, 15_000);
// R23: Outcome River (деградации freshness = исходы) + reliability-ordered retirement
setInterval(() => { try { fleetTick(); } catch { /* noop */ } }, 15_000);
setInterval(() => { try { fleetGc(); } catch { /* noop */ } }, 3_600_000);
// R19: фоновый selfupdate-check (чтобы /mechanics сразу видел вердикт, не блокируя REST)
setTimeout(() => { void suCheckAsync(VERSION).catch(() => { /* телеметрия не ломает старт */ }); }, 4_000);
// R26 B1: автопрогон регресс-датасета в каждой инкарнации — история копится сама
setTimeout(() => { try { evalRun(VERSION); } catch (e) { console.error(`[eval] boot run failed: ${String(e)}`); } }, 2_500);

startMasterLoop();
initEvidence();
// boot-span: телеметрия холодного старта (M7-проверка «ring живой» перестаёт быть ложной после рестарта)
try { recordSpan("daemon.boot", { "me2.version": VERSION, "service.name": "me2-daemon" }, BOOT_T0); } catch { /* телеметрия не ломает старт */ }
try { startScreencastServer(); } catch (e) { console.error(`[me2-daemon] screencast failed: ${String(e)}`); }
wsHttpServer.listen(WS_PORT, () => console.log(`[me2-daemon] v${VERSION} WS on :${WS_PORT} (path '/')`));
restServer.listen(REST_PORT, () => { benchBootDone(); console.log(`[me2-daemon] v${VERSION} REST on :${REST_PORT}`); });
console.log(`[me2-daemon] lanes: EMERGENCY/CONTROL/MUTATION/READ_ONLY, budget 24/60s, actions: ${knownActions().length} (boot ${BOOT_TS})`);
