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
  listAgents, nextReadyTask, setAgentStatus, getTask, updateTask, emit, type AgentRow, type TaskRow,
} from "./store";
import { chat } from "./providers";

const WORKSPACE_ROOT = "/home/z/my-project/me2-workspace";
export { WORKSPACE_ROOT };
const MAX_TOOL_OUTPUT = 4000;
const SHELL_TIMEOUT_MS = 30_000;
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

/** Рефлексия провала (паттерн Reflexion, tier-1 детерминированный): диагноз причины + урок для повтора.
 *  Пишется в tasks.reflection при FAILED; TASK_RETRY-потомок получает её первым сообщением —
 *  эпизодическая память, направляющая следующую попытку (research/2026/R9-REFLECTION-RESEARCH.md §1). */
export function buildReflection(task: TaskRow, errMsg: string): string {
  const e = errMsg.toLowerCase();
  let cause = "runtime_error";
  let what = "Задача упала с исключением на шаге агента.";
  let hint = "Повторите задачу (TASK_RETRY добавляет +2 шага) — ретрай получит эту рефлексию как контекст.";
  if (errMsg.includes("max_steps_exhausted")) {
    cause = "budget_exhausted";
    what = `Агент израсходовал все ${task.max_steps} шагов, не вызвав finish.`;
    hint = "Раздробите спецификацию на подзадачи; ретрай даёт +2 шага — используйте их на finish, а не на новые изыскания.";
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
  }
  return JSON.stringify({
    v: 1, cause, what, hint,
    error: errMsg.slice(0, 300), steps: task.steps, max_steps: task.max_steps,
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

  try {
    let result: string | null = null;
    for (let step = 1; step <= task.max_steps; step++) {
      emit("STEP_START", { step, max_steps: task.max_steps }, agent.id, task.id);
      const reply = await chat(agent.model, messages, { temperature: 0.4 });
      const parsed = extractJson(reply);
      if (!parsed?.action?.tool) {
        emit("STEP_DONE", { step, parse: "retry", raw: reply.slice(0, 300) }, agent.id, task.id);
        messages.push({ role: "assistant", content: reply.slice(0, 2000) });
        messages.push({ role: "user", content: `observation: формат неверен. Ответь РОВНО ОДНИМ JSON-объектом вида {"thought":"...","action":{"tool":"...","args":{...}}}` });
        continue;
      }
      const tool = parsed.action.tool;
      const args = parsed.action.args ?? {};
      emit("TOOL_CALL", { step, tool, args: JSON.stringify(args).slice(0, 500), thought: parsed.thought ?? "" }, agent.id, task.id);

      if (tool === "finish") {
        result = String(args.result ?? "(empty result)");
        emit("TASK_DONE", { steps: step, result: result.slice(0, 1500) }, agent.id, task.id);
        updateTask(task.id, { status: "COMPLETED", result, steps: step });
        break;
      }

      const observation = await execTool(tool, args, task.id);
      emit("TOOL_RESULT", { step, tool, output: observation.slice(0, 1200) }, agent.id, task.id);
      messages.push({ role: "assistant", content: reply.slice(0, 2000) });
      messages.push({ role: "user", content: `observation (${tool}): ${observation}` });
      updateTask(task.id, { steps: step });
    }
    if (result === null) {
      const refl = buildReflection(task, "max_steps_exhausted");
      updateTask(task.id, { status: "FAILED", error: "max_steps_exhausted", reflection: refl });
      emit("TASK_FAILED", { error: "max_steps_exhausted", cause: "budget_exhausted" }, agent.id, task.id);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const refl = buildReflection(task, msg);
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
