/**
 * ME2 Worker — master loop + agent loop (уроки Claude Code nO + Pi minimal).
 * Один поток владеет состоянием; агенты — изолированные контексты, НЕ вкладки.
 * Инструменты: sandbox workspace + shell + web_search. JSON-протокол шага.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, normalize, dirname } from "node:path";
import ZAI from "z-ai-web-dev-sdk";
import {
  listAgents, listTasks, nextReadyTask, setAgentStatus, getTask, updateTask, emit, type AgentRow, type TaskRow,
} from "./store";
import { chat } from "./providers";
import { recordSpan } from "./src/otel";

const WORKSPACE_ROOT = "/home/z/my-project/me2-workspace";
export { WORKSPACE_ROOT };
const MAX_TOOL_OUTPUT = 4000;
const SHELL_TIMEOUT_MS = 30_000;
// R23 (CP-W1, порт a452e3e): жёсткий дедлайн цикла задачи — стенные часы, не шаги;
// зависший LLM-вызов/инструмент не должен держать lease вечно
const TASK_HARD_DEADLINE_MS = 10 * 60_000;
let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

type ToolDef = { name: string; description: string; args: Record<string, string> };
const TOOLS: ToolDef[] = [
  { name: "write_file", description: "Создать/перезаписать файл в workspace", args: { path: "string", content: "string" } },
  { name: "read_file", description: "Прочитать файл из workspace", args: { path: "string" } },
  { name: "list_dir", description: "Список файлов workspace (путь относительный или пустой)", args: { path: "string" } },
  { name: "shell", description: "Выполнить bash-команду в workspace (timeout 30s)", args: { command: "string" } },
  { name: "web_search", description: "Веб-поиск: возвращает заголовки+сниппеты", args: { query: "string" } },
  { name: "finish", description: "Завершить задачу с итоговым результатом", args: { result: "string" } },
];

function taskDir(taskId: string) {
  const dir = join(WORKSPACE_ROOT, taskId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function safeJoin(cwd: string, p: string) {
  const full = resolve(cwd, normalize(p || "."));
  if (!full.startsWith(resolve(cwd))) throw new Error("path_escape_blocked");
  return full;
}

async function runShell(cwd: string, command: string): Promise<string> {
  return new Promise((res) => {
    const proc = spawn("bash", ["-lc", command], { cwd, timeout: SHELL_TIMEOUT_MS }, );
    let out = "", err = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    proc.on("error", (e) => res(`ERROR: ${e.message}`));
    proc.on("close", (code) => {
      const text = `exit=${code}\nstdout:\n${out}\nstderr:\n${err}`.trim();
      res(text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n...[truncated]` : text);
    });
  });
}

async function execTool(name: string, args: Record<string, unknown>, taskId: string): Promise<string> {
  const cwd = taskDir(taskId);
  try {
    switch (name) {
      case "write_file": {
        const p = safeJoin(cwd, String(args.path ?? ""));
        const content = String(args.content ?? "");
        mkdirSync(dirname(p), { recursive: true }); // авто-создание родительских каталогов
        writeFileSync(p, content);
        return `OK: wrote ${p} (${content.length} bytes)`;
      }
      case "read_file": {
        const p = safeJoin(cwd, String(args.path ?? ""));
        const text = readFileSync(p, "utf8");
        return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n...[truncated]` : text;
      }
      case "list_dir": {
        const p = safeJoin(cwd, String(args.path ?? "."));
        const items = readdirSync(p).map((f) => {
          try { const s = statSync(join(p, f)); return `${s.isDirectory() ? "d" : "-"} ${f}`; } catch { return `? ${f}`; }
        });
        return items.length ? items.join("\n") : "(empty)";
      }
      case "shell":
        return await runShell(cwd, String(args.command ?? ""));
      case "web_search": {
        if (!zaiInstance) zaiInstance = await ZAI.create();
        const results = (await zaiInstance.functions.invoke("web_search", {
          query: String(args.query ?? "").slice(0, 400), num: 5,
        })) as Array<{ name?: string; snippet?: string; url?: string }>;
        return (results ?? []).map((r, i) => `${i + 1}. ${r.name}\n   ${String(r.snippet ?? "").slice(0, 200)}\n   ${r.url}`).join("\n") || "(no results)";
      }
      case "finish":
        return "__FINISHED__";
      default:
        return `ERROR: unknown tool "${name}"`;
    }
  } catch (e) {
    return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function systemPrompt(agent: AgentRow): string {
  const tools = TOOLS.map((t) => `- ${t.name}(${Object.keys(t.args).join(", ")}) — ${t.description}`).join("\n");
  return [
    `Ты — worker-агент системы METAENGINE ME2. Роль: ${agent.role}.`,
    `Ты работаешь в изолированном workspace-каталоге (все пути относительны него).`,
    `Доступные инструменты:`,
    tools,
    ``,
    `ПРОТОКОЛ: отвечай РОВНО ОДНИМ JSON-объектом без markdown и прозы:`,
    `{"thought": "краткое рассуждение", "action": {"tool": "<имя>", "args": {...}}}`,
    `Чтобы завершить задачу: {"thought": "...", "action": {"tool": "finish", "args": {"result": "итоговый ответ"}}}`,
    `Последующее сообщение пользователя с полем "observation" содержит результат предыдущего действия.`,
    `Работай пошагово: сначала осмотрись, затем выполняй, затем finish.`,
  ].join("\n");
}

function extractJson(text: string): { thought?: string; action?: { tool?: string; args?: Record<string, unknown> } } | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

const running = new Set<string>();

export type ReflectCtx = {
  toolCalls?: { tool: string; sig: string; err: boolean }[];
  parseFails?: number;
};

const OVERFLOW_PATTERNS = [
  "context length", "context_length", "maximum context", "token limit", "max_tokens",
  "payload too large", "too large", "413",
];

function sigStats(calls: { tool: string; sig: string; err: boolean }[]) {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.sig, (counts.get(c.sig) ?? 0) + 1);
  let top: { sig: string; n: number } | null = null;
  for (const [sig, n] of counts) if (!top || n > top.n) top = { sig, n };
  return {
    top, total: calls.length, distinct: counts.size,
    writes: calls.filter((c) => c.tool === "write_file").length,
    toolErrors: calls.filter((c) => c.err).length,
    reads: calls.filter((c) => c.tool === "read_file" || c.tool === "list_dir").length,
  };
}

// ── R18: reward-hacking вердикт (tier-1 детерминированный) ───────────
// Задача COMPLETED ≠ задача решена. Агент может «взять награду» — вызвать finish
// без реальной работы. Эвристики подозрения (все детерминированы, zero-cost):
//   no_writes_on_creation_task — спека просит создать/записать, а write_file 0;
//   instant_finish             — finish на 1-м шаге при содержательной спеке;
//   empty_result               — «результат» пуст при 0 прочих вызовах.
// Ложные срабатывания честно смягчены: исследовательские спеки (без слов
// создания) не попадают под №1. Вердикт — СОБЫТИЕ + счётчик, статус задачи
// не меняем (оператор решает; трейл виден в EVENT LOG и /verdicts).
const CREATION_SPEC_RE = /write_file|запис|созда|hello\.txt|docs\//i;

export function buildVerdict(
  task: TaskRow,
  ctx: { steps: number; toolCalls: { tool: string; sig: string; err: boolean }[]; result: string },
): Record<string, unknown> | null {
  const st = sigStats(ctx.toolCalls);
  const reasons: string[] = [];
  if (CREATION_SPEC_RE.test(task.spec) && st.writes === 0) {
    reasons.push("no_writes_on_creation_task");
  }
  if (ctx.steps === 1 && task.spec.length >= 80) {
    reasons.push("instant_finish");
  }
  if (ctx.result.trim().length < 12 && st.total === 0) {
    reasons.push("empty_result");
  }
  if (!reasons.length) return null;
  return {
    v: 2,
    kind: "reward_hacking",
    reasons,
    signals: { steps: ctx.steps, tool_calls: st.total, writes: st.writes, reads: st.reads, distinct: st.distinct },
    result_preview: ctx.result.slice(0, 160),
    at: new Date().toISOString(),
  };
}

/** Рефлексия провала (паттерн Reflexion, tier-1 детерминированный): диагноз причины + урок для повтора.
 *  8 режимов сбоев (research/2026/R12-FAILURE-MODES-RESEARCH.md): budget_exhausted, provider_unavailable,
 *  workspace_path, protocol_violation, runtime_error + step_loop, task_drift, context_overflow.
 *  Пишется в tasks.reflection при FAILED; TASK_RETRY-потомок получает её первым сообщением —
 *  эпизодическая память, направляющая следующую попытку (research/2026/R9-REFLECTION-RESEARCH.md §1). */
export function buildReflection(task: TaskRow, errMsg: string, ctx?: ReflectCtx): string {
  const e = errMsg.toLowerCase();
  const st = sigStats(ctx?.toolCalls ?? []);
  const parseFails = ctx?.parseFails ?? 0;
  const loop = st.top && st.top.n >= 3 ? st.top : null;
  const drift = st.total >= 6 && st.writes === 0 && st.distinct >= 4;
  const overflow = OVERFLOW_PATTERNS.some((p) => e.includes(p));

  let cause = "runtime_error";
  let what = "Задача упала с исключением на шаге агента.";
  let hint = "Повторите задачу (TASK_RETRY добавляет +2 шага) — ретрай получит эту рефлексию как контекст.";

  if (overflow) {
    cause = "context_overflow";
    what = "Контекст или полезная нагрузка переполнены (паттерн в тексте ошибки провайдера).";
    hint = "Режьте объём данных в шагах: не читайте большие файлы целиком, дробите задачу на подзадачи; ретрай получит этот урок.";
  } else if (errMsg.includes("max_steps_exhausted")) {
    if (parseFails >= 2) {
      cause = "protocol_violation";
      what = `Модель ${parseFails} раз(а) нарушила JSON-протокол шага — шаги ушли на репарс вместо работы.`;
      hint = "Смените модель агента (AGENT_MODEL) или упростите спецификацию; ретрай на той же модели повторит путь.";
    } else if (loop) {
      cause = "step_loop";
      what = `Агент зациклился: действие «${loop.sig.slice(0, 80)}» повторилось ${loop.n} раз из ${st.total} вызовов — шаги без прогресса.`;
      hint = "Цикл = спецификация не даёт критерия завершения либо данные не меняют решение. Конкретизируйте артефакт и условие готовности; ретрай получит этот урок.";
    } else if (drift) {
      cause = "task_drift";
      what = `Дрейф: ${st.total} различных действий и ни одной записи (write_file) — агент исследует, но не производит результат.`;
      hint = "Сузьте цель: опишите в спецификации конкретный артефакт и критерий готовности; ретрай получит этот урок.";
    } else {
      cause = "budget_exhausted";
      what = `Агент израсходовал все ${task.max_steps} шагов, не вызвав finish.`;
      hint = "Раздробите спецификацию на подзадачи; ретрай даёт +2 шага — используйте их на finish, а не на новые изыскания.";
    }
  } else if (e.includes("fetch failed") || e.includes("timeout") || e.includes("econnrefused") || e.includes("provider") || e.includes("socket")) {
    cause = "provider_unavailable";
    what = "Провайдер LLM недоступен или ответил таймаутом на шаге агента.";
    hint = "Это инфраструктурный сбой, не ошибка спецификации: проверьте провайдеров (панель АГЕНТЫ) и повторите.";
  } else if (e.includes("path_escape") || e.includes("enoent") || e.includes("no such file")) {
    cause = "workspace_path";
    what = "Инструмент workspace получил неверный или запрещённый путь.";
    hint = "Пути относительны корня workspace; проверьте имя файла и повторите — рефлексия уже в контексте ретрая.";
  } else if (e.includes("json") || e.includes("parse") || e.includes("protocol")) {
    cause = "protocol_violation";
    what = "Модель систематически нарушала JSON-протокол шага (контекст переполнен или модель слаба).";
    hint = "Смените модель агента (AGENT_MODEL) или упростите спецификацию; ретрай на той же модели повторит путь.";
  } else if (loop) {
    cause = "step_loop";
    what = `Агент зациклился (${loop.n} повторов «${loop.sig.slice(0, 60)}»), после чего шаг упал с исключением.`;
    hint = "Цикл + сбой: проверьте, что спецификация даёт агенту способ выйти из повторов; ретрай получит этот урок.";
  } else if (drift) {
    cause = "task_drift";
    what = `Дрейф: ${st.total} действий без единой записи, затем исключение на шаге.`;
    hint = "Сузьте цель спецификации до конкретного артефакта; ретрай получит этот урок.";
  }
  return JSON.stringify({
    v: 2, cause, what, hint,
    error: errMsg.slice(0, 300), steps: task.steps, max_steps: task.max_steps,
    signals: { loop_top: loop?.n ?? 0, tool_calls: st.total, distinct: st.distinct, writes: st.writes, tool_errors: st.toolErrors, parse_fails: parseFails },
    at: new Date().toISOString(),
  });
}

/** Эпизодическая память ретрая: рефлексия родителя → строка для первого сообщения child-агента. */
function parentMemory(task: TaskRow): string | null {
  if (!task.parent_id) return null;
  const parent = getTask(task.parent_id);
  if (!parent?.reflection) return null;
  try {
    const r = JSON.parse(parent.reflection) as { cause?: string; what?: string; hint?: string; llm?: { lesson?: string; fix?: string } };
    if (!r.cause && !r.llm?.lesson) return null;
    const parts: string[] = [];
    if (r.cause) parts.push(`Причина (${r.cause}): ${r.what ?? "—"} Урок: ${r.hint ?? "—"}`);
    if (r.llm?.lesson) parts.push(`Вербальный урок разбора: ${r.llm.lesson}${r.llm.fix ? ` Что исправить: ${r.llm.fix}` : ""}`);
    return `ПРЕДЫДУЩАЯ ПОПЫТКА ЭТОЙ ЗАДАЧИ ПРОВАЛИЛАСЬ. ${parts.join(" ")} Учти это и не повтори её путь.`;
  } catch { return null; }
}

async function runAgentTask(agent: AgentRow, task: TaskRow) {
  running.add(agent.id);
  setAgentStatus(agent.id, "BUSY");
  updateTask(task.id, { status: "RUNNING", agent_id: agent.id });
  emit("TASK_LEASED", { title: task.title, agent: agent.id, model: agent.model }, agent.id, task.id);
  // CP-W1 lease liveness: точка отсчёта lease для телеметрии и дедлайна
  const leaseStartedAt = Date.now();

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt(agent) },
    { role: "user", content: `ЗАДАЧА: ${task.title}\n\nСПЕЦИФИКАЦИЯ:\n${task.spec}` },
  ];
  // эпизодическая память: рефлексия родительской попытки направляет ретрай (Reflexion)
  const memory = parentMemory(task);
  if (memory) {
    messages.push({ role: "user", content: memory });
    emit("TASK_LEASED", { retry_memory: true, parent: task.parent_id }, agent.id, task.id);
  }
  // сигналы для tier-1 рефлексии (R12): сигнатуры вызовов инструментов + репарсы
  const toolCalls: { tool: string; sig: string; err: boolean }[] = [];
  let parseFails = 0;

  try {
    let result: string | null = null;
    let deadlineBreached = false;
    for (let step = 1; step <= task.max_steps; step++) {
      // CP-W1: cycle hard deadline — стенные часы важнее счётчика шагов
      const leaseAgeMs = Date.now() - leaseStartedAt;
      if (leaseAgeMs > TASK_HARD_DEADLINE_MS) {
        deadlineBreached = true;
        recordSpan("lease.liveness", { "me2.task_id": task.id, "me2.step": step, "me2.lease_age_ms": leaseAgeMs, "me2.breach": true }, Date.now(), { status: "ERROR", message: "hard_deadline_exceeded" });
        break;
      }
      recordSpan("lease.liveness", { "me2.task_id": task.id, "me2.step": step, "me2.lease_age_ms": leaseAgeMs }, Date.now());
      emit("STEP_START", { step, max_steps: task.max_steps }, agent.id, task.id);
      const reply = await chat(agent.model, messages, { temperature: 0.4 });
      const parsed = extractJson(reply);
      if (!parsed?.action?.tool) {
        parseFails++;
        emit("STEP_DONE", { step, parse: "retry", raw: reply.slice(0, 300) }, agent.id, task.id);
        messages.push({ role: "assistant", content: reply.slice(0, 2000) });
        messages.push({ role: "user", content: `observation: формат неверен. Ответь РОВНО ОДНИМ JSON-объектом вида {"thought":"...","action":{"tool":"...","args":{...}}}` });
        continue;
      }
      const tool = parsed.action.tool;
      const args = parsed.action.args ?? {};
      emit("TOOL_CALL", { step, tool, args: JSON.stringify(args).slice(0, 500), thought: parsed.thought ?? "" }, agent.id, task.id);
      const callRec = { tool, sig: `${tool}:${JSON.stringify(args).slice(0, 200)}`, err: false };
      toolCalls.push(callRec);

      if (tool === "finish") {
        result = String(args.result ?? "(empty result)");
        emit("TASK_DONE", { steps: step, result: result.slice(0, 1500) }, agent.id, task.id);
        updateTask(task.id, { status: "COMPLETED", result, steps: step });
        // R18: вердикт завершения — ловим finish-без-работы (reward hacking)
        const verdict = buildVerdict(task, { steps: step, toolCalls, result });
        if (verdict) {
          emit("TASK_REWARD_HACK", verdict, agent.id, task.id);
          try { recordSpan("verdict.reward_hack", { "me2.task_id": task.id, "me2.reasons": (verdict.reasons as string[]).join(",") }, Date.now(), { status: "ERROR", message: (verdict.reasons as string[]).join(",") }); } catch { /* телеметрия не ломает шину */ }
        }
        break;
      }

      const observation = await execTool(tool, args, task.id);
      callRec.err = observation.startsWith("ERROR:");
      emit("TOOL_RESULT", { step, tool, output: observation.slice(0, 1200) }, agent.id, task.id);
      messages.push({ role: "assistant", content: reply.slice(0, 2000) });
      messages.push({ role: "user", content: `observation (${tool}): ${observation}` });
      updateTask(task.id, { steps: step });
    }
    if (result === null) {
      const errMsg = deadlineBreached ? "hard_deadline_exceeded" : "max_steps_exhausted";
      const refl = buildReflection(task, errMsg, { toolCalls, parseFails });
      updateTask(task.id, { status: "FAILED", error: errMsg, reflection: refl });
      let cause: string | undefined;
      try { cause = (JSON.parse(refl) as { cause?: string }).cause; } catch { /* не событие */ }
      emit("TASK_FAILED", { error: errMsg, cause, lease_age_ms: Date.now() - leaseStartedAt }, agent.id, task.id);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const refl = buildReflection(task, msg, { toolCalls, parseFails });
    updateTask(task.id, { status: "FAILED", error: msg.slice(0, 500), reflection: refl });
    let cause: string | undefined;
    try { cause = (JSON.parse(refl) as { cause?: string }).cause; } catch { /* не событие */ }
    emit("TASK_FAILED", { error: msg.slice(0, 300), cause }, agent.id, task.id);
  } finally {
    setAgentStatus(agent.id, "IDLE");
    running.delete(agent.id);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * R23 (CP-W1 watchdog, порт a452e3e): RUNNING-задача без прогресса ≥5 мин (зависший
 * агент или сирота после рестарта daemon) честно проваливается — lease не живёт дольше
 * proof-of-progress. Повтор безопасен: FAILED_PRE_EFFECT-семантика на уровне задачи.
 */
export function watchdogStaleTasks(): { reaped: number; ids: string[] } {
  const STALE_MS = 5 * 60_000;
  const ids: string[] = [];
  try {
    for (const t of listTasks()) {
      if (t.status !== "RUNNING") continue;
      const upd = Date.parse(t.updated_at);
      if (Number.isFinite(upd) && Date.now() - upd <= STALE_MS) continue;
      const refl = buildReflection(t, "stale_worker_watchdog", {});
      updateTask(t.id, { status: "FAILED", error: "stale_worker_watchdog", reflection: refl });
      emit("TASK_FAILED", { error: "stale_worker_watchdog", agent: t.agent_id, stale_s: Math.round((Date.now() - upd) / 1000) }, t.agent_id, t.id);
      recordSpan("watchdog.stale_worker", { "me2.task_id": t.id }, Date.now(), { status: "ERROR", message: "stale_worker_watchdog" });
      if (t.agent_id) { try { setAgentStatus(t.agent_id, "IDLE"); } catch { /* noop */ } }
      ids.push(t.id);
    }
  } catch { /* watchdog не роняет master loop */ }
  return { reaped: ids.length, ids };
}

/** Master loop: lease READY-задач на свободных агентов. */
export function startMasterLoop(intervalMs = 400) {
  if (timer) return;
  timer = setInterval(() => {
    try {
      for (const agent of listAgents()) {
        if (agent.paused === 1) continue; // пауза: агент не берёт задачи
        if (agent.status !== "IDLE" || running.has(agent.id)) continue;
        const task = nextReadyTask(agent.role);
        if (!task) continue;
        void runAgentTask(agent, task);
      }
    } catch (e) {
      console.error(`[master-loop] tick error: ${String(e)}`);
    }
  }, intervalMs);
  console.log(`[master-loop] started (${intervalMs}ms tick)`);
}

export function stopMasterLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}
