/**
 * ME2 AgentChat (G1, R36) — флот из ПОЛНОЦЕННЫХ АГЕНТНЫХ ЧАТОВ.
 *
 * Анализ старого Electron-браузера (R22-аудит, apps/metaengine-browser/, жив у оператора):
 *   флот = вкладки chat.z.ai (GLM_CHAT ×3+), supervisor выдавал actuation_lease
 *   `fleet.transport-promotion:agent_*`, потолки env-bounded (FLEET_TAB_CEILING),
 *   Outcome River → reliability-ordered retirement, cognitive delta ring(64).
 *
 * Что было слабо: вкладка была ПОДПОРОГИЕМ живого чата на внешнем сайте — контекст
 * терялся при перезагрузке, история не принадлежала системе, доказательств не было.
 *
 * Новая сборка (улучшения против старого):
 *   1. Чат = ПЕРВИЧНЫЙ объект системы: постоянная сессия в SQLite (messages/summary),
 *      агент флота живёт ВНУТРИ daemon, а не во вкладке внешнего сайта.
 *   2. Полноценный tool-цикл как у этой платформы: list_dir/read_file/write_file/shell/
 *      web_search/daemon_status/create_task/reply — JSON-протокол шагов (как worker).
 *   3. Долгая жизнь: контекст = system + sticky-память (E5 economy) + rolling-summary +
 *      хвост истории в бюджете символов; компакция НЕ удаляет историю (audit-trail),
 *      только элиминирует её из контекста (progressive disclosure).
 *   4. Честность: каждый ход = событие AGENT_CHAT_TURN в hash-chain (evidence),
 *      stdout/шаги/телеметрия сохраняются в meta сообщения.
 *   5. Живость: state IDLE/THINKING (эксклюзивно, single-writer), восстановление
 *      зависших THINKING при рестарте (agentChatRestore), счётчики turns_ok/fail,
 *      деградация 3 подряд → событие AGENT_CHAT_DEGRADED (Outcome River v1).
 *
 * REST (вне шины 47/47): GET /agentchat, POST /agentchat {op:create|turn|compact|close},
 * GET /agentchat/:id, GET /agentchat/:id/status. Механика ME35.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, normalize, resolve } from "node:path";
import { db, emit, nowIso, createAgent, createTask, type AgentRow } from "../store";
import { chat } from "../providers";
import { agentTag } from "./glm";
import { memBlockEconomy } from "./memory";
import { poolStatus } from "./pool";

// ── константы ─────────────────────────────────────────────────────
const CHAT_ROOT = "/home/z/my-project/me2-workspace";
const MAX_STEPS = 8;                 // шагов tool-цикла на один ход (как max_steps задач)
const TURN_DEADLINE_MS = 150_000;    // стенные часы хода (LLM+инструменты)
const SHELL_TIMEOUT_MS = 30_000;
const MAX_TOOL_OUTPUT = 4000;
const HISTORY_BUDGET_CHARS = 9000;   // хвост истории в контексте
const COMPACT_THRESHOLD_CHARS = 20_000; // авто-компакция суммарного объёма сессии
const COMPACT_KEEP_LAST = 6;         // последние сообщения не суммаризируются
const DEGRADE_STREAK = 3;            // подряд fails → AGENT_CHAT_DEGRADED

// ── схема ─────────────────────────────────────────────────────────
let schemaReady = false;
function ensureSchema(): void {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      state TEXT NOT NULL DEFAULT 'IDLE',
      summary TEXT NOT NULL DEFAULT '',
      compactions INTEGER NOT NULL DEFAULT 0,
      turns_ok INTEGER NOT NULL DEFAULT 0,
      turns_fail INTEGER NOT NULL DEFAULT 0,
      fail_streak INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
    CREATE TABLE IF NOT EXISTS agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id);
  `);
  schemaReady = true;
}

// ── типы ──────────────────────────────────────────────────────────
export interface AgentChatSession {
  id: string; agent_id: string; title: string; status: "ACTIVE" | "CLOSED";
  state: "IDLE" | "THINKING"; summary: string; compactions: number;
  turns_ok: number; turns_fail: number; fail_streak: number;
  last_error: string | null; model: string; created_at: string; updated_at: string;
}
export interface AgentChatMessage {
  id: number; session_id: string; role: "user" | "assistant" | "tool" | "system";
  content: string; meta: Record<string, unknown>; at: string;
}

function rowToSession(r: Record<string, unknown>): AgentChatSession {
  return {
    id: String(r.id), agent_id: String(r.agent_id), title: String(r.title ?? ""),
    status: r.status === "CLOSED" ? "CLOSED" : "ACTIVE",
    state: r.state === "THINKING" ? "THINKING" : "IDLE",
    summary: String(r.summary ?? ""), compactions: Number(r.compactions ?? 0),
    turns_ok: Number(r.turns_ok ?? 0), turns_fail: Number(r.turns_fail ?? 0),
    fail_streak: Number(r.fail_streak ?? 0), last_error: (r.last_error as string) ?? null,
    model: String(r.model ?? ""), created_at: String(r.created_at), updated_at: String(r.updated_at),
  };
}
function rowToMessage(r: Record<string, unknown>): AgentChatMessage {
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(String(r.meta ?? "{}")) as Record<string, unknown>; } catch { /* держим пустой */ }
  return {
    id: Number(r.id), session_id: String(r.session_id),
    role: r.role as AgentChatMessage["role"], content: String(r.content ?? ""),
    meta, at: String(r.at),
  };
}

const qSessions = () => db.query("SELECT * FROM agent_sessions ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
const qSession = (id: string) => db.query("SELECT * FROM agent_sessions WHERE id=?").get(id) as Record<string, unknown> | null;
const qMessages = (id: string, limit = 200) =>
  db.query("SELECT * FROM agent_messages WHERE session_id=? ORDER BY id DESC LIMIT ?").all(id, limit).reverse() as Array<Record<string, unknown>>;

// ── workspace чата (постоянный на жизнь сессии) ───────────────────
function chatDir(sessionId: string): string {
  const dir = join(CHAT_ROOT, `chat_${sessionId.slice(3, 11)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function safeJoin(cwd: string, p: string): string {
  const full = resolve(cwd, normalize(p || "."));
  if (!full.startsWith(resolve(cwd))) throw new Error("path_escape_blocked");
  return full;
}

// ── инструменты чата (JSON-протокол, как worker, + chat-специфика) ─
export type ChatToolName =
  | "list_dir" | "read_file" | "write_file" | "shell" | "web_search"
  | "daemon_status" | "create_task" | "reply";
const CHAT_TOOLS: Array<{ name: ChatToolName; description: string; args: Record<string, string> }> = [
  { name: "list_dir", description: "Список файлов workspace чата", args: { path: "string" } },
  { name: "read_file", description: "Прочитать файл из workspace чата", args: { path: "string" } },
  { name: "write_file", description: "Создать/перезаписать файл в workspace чата", args: { path: "string", content: "string" } },
  { name: "shell", description: "bash в workspace чата (timeout 30s)", args: { command: "string" } },
  { name: "web_search", description: "Веб-поиск: заголовки+сниппеты", args: { query: "string" } },
  { name: "daemon_status", description: "Живой статус daemon: pool/eval/evidence/память", args: {} },
  { name: "create_task", description: "Поставить задачу в workgraph daemon (title, spec)", args: { title: "string", spec: "string" } },
  { name: "reply", description: "ФИНАЛЬНЫЙ ответ пользователю (завершает ход)", args: { text: "string" } },
];

let zaiWeb: Awaited<import("z-ai-web-dev-sdk").default.create> | null = null;
async function webSearch(query: string): Promise<string> {
  if (!zaiWeb) {
    const mod = await import("z-ai-web-dev-sdk");
    zaiWeb = await mod.default.create();
  }
  const results = (await zaiWeb.functions.invoke("web_search", { query: query.slice(0, 400), num: 5 })) as
    Array<{ name?: string; snippet?: string; url?: string }>;
  return (results ?? []).map((r, i) => `${i + 1}. ${r.name}\n   ${String(r.snippet ?? "").slice(0, 200)}\n   ${r.url}`).join("\n") || "(no results)";
}

function daemonStatus(): string {
  try {
    const p = poolStatus();
    const ev = db.query("SELECT verdict, passed, total FROM eval_runs ORDER BY id DESC LIMIT 1").get() as { verdict: string; passed: number; total: number } | null;
    return `pool: live=${p.live}/${p.ceiling}, queue=${p.queue.ready}/${p.queue.running}, throughput 1ч=${p.throughput.done_1h}✓/${p.throughput.failed_1h}✗; eval: ${ev ? `${ev.verdict} (${ev.passed}/${ev.total})` : "не запускался"}; время: ${nowIso()}`;
  } catch (e) {
    return `daemon_status failed: ${String(e).slice(0, 120)}`;
  }
}

/** Синхронные инструменты — переиспользуются eval-харнесом (без сети). */
export function execChatToolSync(name: ChatToolName, args: Record<string, unknown>, sessionId: string): string {
  const cwd = chatDir(sessionId);
  try {
    switch (name) {
      case "write_file": {
        const p = safeJoin(cwd, String(args.path ?? ""));
        const content = String(args.content ?? "");
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, content);
        return `OK: wrote ${p} (${content.length} bytes)`;
      }
      case "read_file": {
        const text = readFileSync(safeJoin(cwd, String(args.path ?? "")), "utf8");
        return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n...[truncated]` : text;
      }
      case "list_dir": {
        const p = safeJoin(cwd, String(args.path ?? "."));
        const items = readdirSync(p).map((f) => {
          try { const s = statSync(join(p, f)); return `${s.isDirectory() ? "d" : "-"} ${f}`; } catch { return `? ${f}`; }
        });
        return items.length ? items.join("\n") : "(empty)";
      }
      case "daemon_status":
        return daemonStatus();
      case "reply":
        return String(args.text ?? "");
      default:
        return `ERROR: tool "${name}" требует async-контекст хода (shell/web_search/create_task) или неизвестен`;
    }
  } catch (e) {
    return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Async-исполнение инструмента внутри хода. */
async function execChatTool(name: ChatToolName, args: Record<string, unknown>, sessionId: string): Promise<string> {
  const cwd = chatDir(sessionId);
  try {
    switch (name) {
      case "shell":
        return await new Promise<string>((res) => {
          const proc = spawn("bash", ["-lc", String(args.command ?? "")], { cwd, timeout: SHELL_TIMEOUT_MS });
          let out = "", err = "";
          proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
          proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
          proc.on("error", (e) => res(`ERROR: ${e.message}`));
          proc.on("close", (code) => {
            const text = `exit=${code}\nstdout:\n${out}\nstderr:\n${err}`.trim();
            res(text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n...[truncated]` : text);
          });
        });
      case "web_search":
        return await webSearch(String(args.query ?? ""));
      case "create_task": {
        const t = createTask({
          id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          title: String(args.title ?? "chat task").slice(0, 200),
          spec: String(args.spec ?? "").slice(0, 4000),
          role: "EXECUTOR", max_steps: 5,
        } as Parameters<typeof createTask>[0]);
        emit("TASK_QUEUED", { by: `chat:${sessionId}`, title: t.title }, null, t.id);
        return `OK: задача ${t.id} поставлена в workgraph (READY)`;
      }
      default:
        return execChatToolSync(name, args, sessionId);
    }
  } catch (e) {
    return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── сообщения/контекст ────────────────────────────────────────────
export function chatAppend(sessionId: string, role: AgentChatMessage["role"], content: string, meta: Record<string, unknown> = {}): AgentChatMessage {
  const at = nowIso();
  const r = db.query("INSERT INTO agent_messages (session_id, role, content, meta, at) VALUES (?,?,?,?,?)")
    .run(sessionId, role, content, JSON.stringify(meta).slice(0, 4000), at);
  return { id: Number(r.lastInsertRowid), session_id: sessionId, role, content, meta, at };
}

function systemPrompt(sess: AgentChatSession, role: string): string {
  const tools = CHAT_TOOLS.map((t) => `- ${t.name}(${Object.keys(t.args).join(", ")}) — ${t.description}`).join("\n");
  return [
    `Ты — постоянный агент-чат системы METAENGINE ME2 (флот). Роль флота: ${role}. Модель: ${sess.model}.`,
    `У тебя ПОСТОЯННАЯ сессия: история хранится системой, workspace чата сохраняется между ходами: ${chatDir(sess.id)}`,
    `Доступные инструменты:`,
    tools,
    ``,
    `ПРОТОКОЛ: отвечай РОВНО ОДНИМ JSON-объектом без markdown и прозы:`,
    `{"thought": "краткое рассуждение", "action": {"tool": "<имя>", "args": {...}}}`,
    `Финальный ответ пользователю — инструмент reply: {"thought":"...","action":{"tool":"reply","args":{"text":"..."}}}`,
    `Сообщение пользователя с ролью "tool" содержит результат предыдущего действия (observation).`,
    `Ты можешь выполнять реальную работу (файлы, shell, поиск) и ставить задачи в workgraph daemon'а (create_task).`,
  ].join("\n");
}

/** Сборка контекста хода: system + summary-заметка + хвост истории в бюджете символов. */
export function buildChatContext(sess: AgentChatSession, role: string): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const msgs = qMessages(sess.id, 400);
  const tail: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  let used = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = rowToMessage(msgs[i]);
    if (m.role === "tool") {
      const obs = `[observation] ${m.content}`;
      if (used + obs.length > HISTORY_BUDGET_CHARS) break;
      used += obs.length; tail.unshift({ role: "user", content: obs });
    } else if (m.role === "assistant") {
      if (used + m.content.length > HISTORY_BUDGET_CHARS) break;
      used += m.content.length; tail.unshift({ role: "assistant", content: m.content });
    } else if (m.role === "user") {
      if (used + m.content.length > HISTORY_BUDGET_CHARS) break;
      used += m.content.length; tail.unshift({ role: "user", content: m.content });
    }
    // system-сообщения (summary-заметки прошлых компакций) не дублируем в хвост
  }
  const head: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt(sess, role) },
  ];
  // E5: экономный блок памяти (sticky-ядро всегда, familiar-элиминация)
  try {
    const mem = memBlockEconomy(`chat:${sess.id}`, 5, 1200);
    if (mem.block) head.push({ role: "system", content: `Память системы (экономная доставка):\n${mem.block}` });
  } catch { /* память не блокирует чат */ }
  if (sess.summary) {
    head.push({ role: "system", content: `Сводка ранней истории сессии (компакций=${sess.compactions}):\n${sess.summary}` });
  }
  return [...head, ...tail];
}

function extractJson(text: string): { thought?: string; action?: { tool?: string; args?: Record<string, unknown> } } | null {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

// ── CRUD ──────────────────────────────────────────────────────────
export function agentChatCreate(opts: { agent_id?: string; role?: string; title?: string; model?: string } = {}): AgentChatSession {
  ensureSchema();
  let agent: AgentRow | null = null;
  if (opts.agent_id) {
    const r = db.query("SELECT * FROM agents WHERE id=?").get(opts.agent_id) as Record<string, unknown> | null;
    if (!r) throw new Error("agent_not_found");
    agent = r as unknown as AgentRow;
  } else {
    agent = createAgent(String(opts.role ?? "CHAT"), opts.model ? `zai:${opts.model}` : `zai:${agentTag()}`);
    emit("AGENT_CREATED", { role: agent.role, model: agent.model, by: "agentchat" }, agent.id, null);
  }
  const id = `ac_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const model = opts.model ? `zai:${opts.model}` : String(agent.model || `zai:${agentTag()}`);
  const now = nowIso();
  db.query(`INSERT INTO agent_sessions (id, agent_id, title, status, state, summary, compactions, turns_ok, turns_fail, fail_streak, model, created_at, updated_at)
    VALUES (?,?,?,'ACTIVE','IDLE','',0,0,0,0,?,?,?)`)
    .run(id, agent.id, String(opts.title ?? `Чат ${agent.role}`).slice(0, 160), model, now, now);
  chatDir(id); // workspace создаётся сразу
  const sess = rowToSession(qSession(id)!);
  emit("AGENT_CHAT_CREATED", { session_id: id, agent_id: agent.id, title: sess.title, model }, agent.id, null);
  return sess;
}

export function agentChatList(opts: { status?: "ACTIVE" | "CLOSED" } = {}): AgentChatSession[] {
  ensureSchema();
  const rows = qSessions().map(rowToSession);
  return opts.status ? rows.filter((s) => s.status === opts.status) : rows;
}

export function agentChatGet(id: string, limit = 200): { session: AgentChatSession; messages: AgentChatMessage[] } | null {
  ensureSchema();
  const r = qSession(id);
  if (!r) return null;
  return { session: rowToSession(r), messages: qMessages(id, limit).map(rowToMessage) };
}

export function agentChatStatus(): {
  total: number; active: number; thinking: number; turns_ok: number; turns_fail: number;
  compactions: number; last_turn_at: string | null; degraded: number;
} {
  ensureSchema();
  const rows = qSessions().map(rowToSession);
  const lastTurn = db.query(`SELECT at FROM agent_messages WHERE role='assistant' ORDER BY id DESC LIMIT 1`).get() as { at: string } | null;
  return {
    total: rows.length,
    active: rows.filter((s) => s.status === "ACTIVE").length,
    thinking: rows.filter((s) => s.state === "THINKING").length,
    turns_ok: rows.reduce((a, s) => a + s.turns_ok, 0),
    turns_fail: rows.reduce((a, s) => a + s.turns_fail, 0),
    compactions: rows.reduce((a, s) => a + s.compactions, 0),
    last_turn_at: lastTurn?.at ?? null,
    degraded: rows.filter((s) => s.fail_streak >= DEGRADE_STREAK).length,
  };
}

export function agentChatClose(id: string): boolean {
  ensureSchema();
  const r = qSession(id);
  if (!r) return false;
  db.query("UPDATE agent_sessions SET status='CLOSED', state='IDLE', updated_at=? WHERE id=?").run(nowIso(), id);
  emit("AGENT_CHAT_CLOSED", { session_id: id }, String(r.agent_id), null);
  return true;
}

/** Полное удаление (eval-самоочистка). */
export function agentChatDelete(id: string): void {
  ensureSchema();
  db.query("DELETE FROM agent_messages WHERE session_id=?").run(id);
  db.query("DELETE FROM agent_sessions WHERE id=?").run(id);
}

// ── компакция (progressive disclosure: история не удаляется) ──────
export async function agentChatCompact(id: string, opts: { force?: boolean } = {}): Promise<{ ok: boolean; compactions: number; summary_chars: number; reason?: string }> {
  ensureSchema();
  const r = qSession(id);
  if (!r) throw new Error("session_not_found");
  const sess = rowToSession(r);
  const msgs = qMessages(id, 500).map(rowToMessage);
  const totalChars = msgs.reduce((a, m) => a + m.content.length, 0);
  if (!opts.force && totalChars < COMPACT_THRESHOLD_CHARS) {
    return { ok: false, compactions: sess.compactions, summary_chars: sess.summary.length, reason: `below_threshold (${totalChars}<${COMPACT_THRESHOLD_CHARS})` };
  }
  if (msgs.length <= COMPACT_KEEP_LAST + 2) {
    return { ok: false, compactions: sess.compactions, summary_chars: sess.summary.length, reason: "too_few_messages" };
  }
  const older = msgs.slice(0, msgs.length - COMPACT_KEEP_LAST);
  const transcript = older.map((m) => `${m.role}: ${m.content.slice(0, 600)}`).join("\n").slice(0, 14000);
  const model = sess.model || `zai:${agentTag()}`;
  const raw = await chat(model, [
    { role: "system", content: "Ты — архивариус агентных чатов. Сожми диалог в плотную сводку: факты, решения, результаты инструментов, незакрытые вопросы. Без воды, до 1200 символов." },
    { role: "user", content: transcript },
  ], { temperature: 0.2 });
  const summary = raw.replace(/```/g, "").trim().slice(0, 1600);
  db.query("UPDATE agent_sessions SET summary=?, compactions=compactions+1, updated_at=? WHERE id=?").run(summary, nowIso(), id);
  chatAppend(id, "system", `[компакция #${sess.compactions + 1}] ранняя история (${older.length} сообщений, ${totalChars} симв.) сжата в сводку — контекст продолжается со свежего хвоста`, { compaction: true });
  emit("AGENT_CHAT_COMPACTED", { session_id: id, older: older.length, summary_chars: summary.length }, String(r.agent_id), null);
  return { ok: true, compactions: sess.compactions + 1, summary_chars: summary.length };
}

// ── ХОД (turn) — главный цикл, как этот чат: думает → инструменты → ответ ──
export interface TurnResult {
  session_id: string; reply: string; steps: number; tool_calls: Array<{ tool: string; ms: number }>;
  ok: boolean; error?: string;
}

export async function agentChatTurn(sessionId: string, userText: string): Promise<TurnResult> {
  ensureSchema();
  const r = qSession(sessionId);
  if (!r) throw new Error("session_not_found");
  const sess = rowToSession(r);
  if (sess.status !== "ACTIVE") throw new Error("session_closed");
  if (sess.state === "THINKING") throw new Error("session_busy");
  const agentRow = db.query("SELECT * FROM agents WHERE id=?").get(sess.agent_id) as Record<string, unknown> | null;
  const role = String(agentRow?.role ?? "CHAT");

  db.query("UPDATE agent_sessions SET state='THINKING', updated_at=? WHERE id=?").run(nowIso(), sessionId);
  chatAppend(sessionId, "user", String(userText ?? "").slice(0, 8000));
  const t0 = Date.now();
  const toolCalls: Array<{ tool: string; ms: number }> = [];
  let reply = "";
  let steps = 0;
  let hardError: string | undefined;

  try {
    const model = sess.model || `zai:${agentTag()}`;
    const history = buildChatContext({ ...sess, state: "THINKING" }, role);
    for (let step = 0; step < MAX_STEPS; step++) {
      if (Date.now() - t0 > TURN_DEADLINE_MS) { hardError = "turn_deadline"; break; }
      const raw = await chat(model, history, { temperature: 0.4 });
      const parsed = extractJson(raw);
      if (!parsed || !parsed.action?.tool) {
        // один честный ретрай на формат
        history.push({ role: "assistant", content: raw.slice(0, 1200) });
        history.push({ role: "user", content: "[observation] ФОРМАТ: ответ не JSON-протокол. Повтори РОВНО ОДНИМ JSON-объектом {thought, action}." });
        steps++;
        continue;
      }
      const tool = parsed.action.tool as ChatToolName;
      const thought = String(parsed.thought ?? "");
      chatAppend(sessionId, "assistant", JSON.stringify({ thought, action: parsed.action }), { step, kind: "step" });
      history.push({ role: "assistant", content: raw.slice(0, 1200) });
      steps++;
      if (tool === "reply") {
        reply = String(parsed.action.args?.text ?? "");
        break;
      }
      const tTool = Date.now();
      const observation = await execChatTool(tool, parsed.action.args ?? {}, sessionId);
      toolCalls.push({ tool, ms: Date.now() - tTool });
      chatAppend(sessionId, "tool", observation, { step, tool });
      history.push({ role: "user", content: `[observation] ${observation}` });
    }
    if (!reply && !hardError) reply = "(ход завершён без reply — см. шаги и observation в истории)";
  } catch (e) {
    hardError = e instanceof Error ? e.message : String(e);
  }

  const dtMs = Date.now() - t0;
  const ok = !hardError && !!reply;
  if (reply) chatAppend(sessionId, "assistant", reply, { kind: "reply", steps, ms: dtMs, tool_calls: toolCalls });
  const streak = ok ? 0 : sess.fail_streak + 1;
  db.query(`UPDATE agent_sessions SET state='IDLE', turns_ok=turns_ok+?, turns_fail=turns_fail+?, fail_streak=?, last_error=?, updated_at=? WHERE id=?`)
    .run(ok ? 1 : 0, ok ? 0 : 1, streak, hardError ?? null, nowIso(), sessionId);
  emit(ok ? "AGENT_CHAT_TURN" : "AGENT_CHAT_TURN_FAILED", {
    session_id: sessionId, steps, ms: dtMs, tools: toolCalls.map((t) => t.tool), chars: reply.length,
  }, sess.agent_id, null);
  if (streak >= DEGRADE_STREAK) emit("AGENT_CHAT_DEGRADED", { session_id: sessionId, fail_streak: streak }, sess.agent_id, null);

  // авто-компакция на пороге (не блокирует ответ — фоновая)
  try {
    const total = qMessages(sessionId, 500).reduce((a: number, m) => a + String(m.content).length, 0);
    if (total >= COMPACT_THRESHOLD_CHARS) void agentChatCompact(sessionId, {});
  } catch { /* компакция не ломает ход */ }

  return { session_id: sessionId, reply, steps, tool_calls: toolCalls, ok, error: hardError };
}

/** Запуск хода в фоне (REST возвращает 202 немедленно — долгий ход как этот чат). */
export function agentChatTurnAsync(sessionId: string, text: string): void {
  void agentChatTurn(sessionId, text).catch((e) => {
    console.error(`[agentchat] async turn failed: ${String(e).slice(0, 160)}`);
    try { db.query("UPDATE agent_sessions SET state='IDLE', last_error=?, updated_at=? WHERE id=?").run(String(e).slice(0, 200), nowIso(), sessionId); } catch { /* noop */ }
  });
}

// ── восстановление после рестарта (зависшие THINKING → IDLE) ──────
export function agentChatRestore(): { healed: number; sessions: number } {
  ensureSchema();
  const stuck = db.query("SELECT id FROM agent_sessions WHERE state='THINKING'").all() as Array<{ id: string }>;
  for (const s of stuck) {
    db.query("UPDATE agent_sessions SET state='IDLE', last_error='restored_after_restart', updated_at=? WHERE id=?").run(nowIso(), s.id);
  }
  return { healed: stuck.length, sessions: (db.query("SELECT COUNT(*) AS n FROM agent_sessions").get() as { n: number }).n };
}
