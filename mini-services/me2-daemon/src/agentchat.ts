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
 * G2 (R36, флот-ядро по операторской задаче):
 *   6. ВЕЧНО-ЖИВУЩИЕ чаты-супервизоры: supervisorEnsure() гарантирует живого SUPERVISOR
 *      (закрыли/умер → пересоздан при следующем тике — «перезапускающиеся»), тик каждые 60с:
 *      автономный ход «обзор флота → координация» по расписанию ИЛИ немедленно при входящем
 *      межчатовом сообщении (unreadInterchat).
 *   7. МЕЖЧАТОВАЯ СВЯЗЬ: chat_send доставляет сообщение в историю другого чата (meta.from_chat),
 *      чаты координируются, специализируются (роли агентов) и видят друг друга (list_chats).
 *   8. ПОЛНЫЙ ОБЗОР: супервизор в system-prompt получает живой дайджест системы (флот, пул,
 *      задачи, eval) + инструменты list_chats/chat_send/create_chat/create_task.
 *   9. REAL-TIME: каждый шаг хода (мысль/инструмент/ответ) = событие AGENT_CHAT_STEP в шину —
 *      браузер и супервизоры видят рассуждение всех чатов ОДНОВРЕМЕННО (socket.io :3040).
 *  10. ЭЛАСТИЧНОСТЬ: чаты не ограничены пулом (turn-based, конкурентные THINKING по сессиям),
 *      само-создание чатов агентами ограничено потолком ME2_CHAT_CEILING (env-bounded,
 *      наследие FLEET_TAB_CEILING старого браузера); оператор через REST — без потолка.
 *
 * REST (вне шины 47/47): GET /agentchat, POST /agentchat {op:create|turn|compact|close|tick},
 * GET /agentchat/:id, GET /agentchat/:id/status. Механика ME35.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, normalize, resolve } from "node:path";
import { db, emit, nowIso, createAgent, createTask, type AgentRow } from "../store";
import { chat } from "../providers";
import { laneForRole } from "./governor";
import { agentTag, canonicalGlm } from "./glm";
import { memBlockEconomy } from "./memory";
import { poolStatus } from "./pool";
import { livenessBrief } from "./autonomy";

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
export const SUPERVISOR_TICK_MS = 60_000;   // период тика супервизора (интервал в index.ts)
const SUPERVISOR_IDLE_MS = 300_000;  // автономный ход супервизора не реже, чем раз в 5 минут
const SUPERVISOR_TITLE = "Супервизор флота";
const CHAT_CEILING = Number(process.env.ME2_CHAT_CEILING ?? 24); // эластичный потолок само-создания
const CHAT_MAX_INFLIGHT = 8;         // глобальный конкурентный предел ходов (бережём LLM-слот)
const OBJECTIVE_MAX_CHARS = 600;     // долгоживущая цель чата (G5)

/** Нормализация модели: однократный префикс zai: (лечит zai:zai:… — R37, хил сессий R36 был неполный). */
export function normalizeChatModel(m: string): string {
  const s = String(m ?? "").trim();
  return s ? s.replace(/^(zai:)+/, "zai:") : s;
}

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
      objective TEXT NOT NULL DEFAULT '',
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
  // миграция существующей БД (G5, R37): колонка objective
  try { db.query("ALTER TABLE agent_sessions ADD COLUMN objective TEXT NOT NULL DEFAULT ''").run(); } catch { /* уже есть */ }
  // хил двойного префикса в СЕССИЯХ (R37: R36 вылечил реестр, но не персистентные session-строки)
  try { db.query("UPDATE agent_sessions SET model=? WHERE model LIKE 'zai:zai:%'").run("zai:" + canonicalGlm()); } catch { /* noop */ }
  schemaReady = true;
}

// ── типы ──────────────────────────────────────────────────────────
export interface AgentChatSession {
  id: string; agent_id: string; title: string; status: "ACTIVE" | "CLOSED";
  state: "IDLE" | "THINKING"; summary: string; compactions: number;
  turns_ok: number; turns_fail: number; fail_streak: number;
  last_error: string | null; model: string; objective: string; created_at: string; updated_at: string;
  role: string; // роль флота (из агента реестра): CHAT/SUPERVISOR/EXECUTOR/…
}
export interface AgentChatMessage {
  id: number; session_id: string; role: "user" | "assistant" | "tool" | "system";
  content: string; meta: Record<string, unknown>; at: string;
}

function rowToSession(r: Record<string, unknown>): AgentChatSession {
  let role = "CHAT";
  try {
    const a = db.query("SELECT role FROM agents WHERE id=?").get(String(r.agent_id)) as { role?: string } | null;
    if (a?.role) role = String(a.role);
  } catch { /* роль не блокирует чтение сессии */ }
  return {
    id: String(r.id), agent_id: String(r.agent_id), title: String(r.title ?? ""),
    status: r.status === "CLOSED" ? "CLOSED" : "ACTIVE",
    state: r.state === "THINKING" ? "THINKING" : "IDLE",
    summary: String(r.summary ?? ""), compactions: Number(r.compactions ?? 0),
    turns_ok: Number(r.turns_ok ?? 0), turns_fail: Number(r.turns_fail ?? 0),
    fail_streak: Number(r.fail_streak ?? 0), last_error: (r.last_error as string) ?? null,
    model: String(r.model ?? ""), objective: String(r.objective ?? ""), created_at: String(r.created_at), updated_at: String(r.updated_at),
    role,
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
const qSupervisors = () =>
  db.query(`SELECT s.* FROM agent_sessions s JOIN agents a ON a.id = s.agent_id
    WHERE s.status='ACTIVE' AND a.role='SUPERVISOR' ORDER BY s.updated_at DESC`).all() as Array<Record<string, unknown>>;
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
  | "daemon_status" | "create_task" | "list_chats" | "chat_send" | "create_chat" | "set_objective" | "reply";
const CHAT_TOOLS: Array<{ name: ChatToolName; description: string; args: Record<string, string> }> = [
  { name: "list_dir", description: "Список файлов workspace чата", args: { path: "string" } },
  { name: "read_file", description: "Прочитать файл из workspace чата", args: { path: "string" } },
  { name: "write_file", description: "Создать/перезаписать файл в workspace чата", args: { path: "string", content: "string" } },
  { name: "shell", description: "bash в workspace чата (timeout 30s)", args: { command: "string" } },
  { name: "web_search", description: "Веб-поиск: заголовки+сниппеты", args: { query: "string" } },
  { name: "daemon_status", description: "Живой статус daemon: pool/eval/evidence/память", args: {} },
  { name: "create_task", description: "Поставить задачу в workgraph daemon (title, spec)", args: { title: "string", spec: "string" } },
  { name: "list_chats", description: "Обзор ВСЕХ чатов флота: состояния, ходы, деградации, последние ошибки", args: {} },
  { name: "chat_send", description: "Отправить сообщение другому чату флота (межчатовая координация; супервизор увидит и отреагирует)", args: { session_id: "string", text: "string" } },
  { name: "create_chat", description: "Создать нового чата-агента флота (эластичное масштабирование, потолок 24)", args: { title: "string", role: "string" } },
  { name: "set_objective", description: "Долгоживущая ЦЕЛЬ чата: закрепить/обновить (супервизор может назначить другому, передав session_id)", args: { objective: "string", session_id: "string?" } },
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
    return `pool: live=${p.live}/${p.ceiling}, queue=${p.queue.ready}/${p.queue.running}, throughput 1ч=${p.throughput.done_1h}✓/${p.throughput.failed_1h}✗; eval: ${ev ? `${ev.verdict} (${ev.passed}/${ev.total})` : "не запускался"}; ${livenessBrief()}; время: ${nowIso()}`;
  } catch (e) {
    return `daemon_status failed: ${String(e).slice(0, 120)}`;
  }
}

/** Полный обзор флота для супервизоров (полная видимость системы, включая пул — G4). */
export function fleetDigest(): string {
  try {
    const rows = agentChatList().filter((s) => s.status === "ACTIVE").slice(0, 24);
    const lines = rows.map((s) =>
      `- ${s.id} «${s.title}» role=${s.role} ${s.state} ходы=${s.turns_ok}/${s.turns_fail} компакций=${s.compactions}${s.fail_streak >= 2 ? ` ⚠DEGRADED(${s.fail_streak})` : ""}${s.objective ? ` 🎯${s.objective.slice(0, 80)}` : ""}${s.last_error ? ` last_err=${s.last_error.slice(0, 60)}` : ""}`);
    // G4: пул исполнителей с ТЕКУЩИМИ задачами и последним шагом (супервизор видит ходы исполнителей шаг за шагом)
    const poolLines: string[] = [];
    try {
      const leases = db.query(`SELECT l.agent_id, l.slot, l.task_id, t.title, t.status FROM pool_leases l LEFT JOIN tasks t ON t.id = l.task_id ORDER BY l.slot`).all() as
        Array<{ agent_id: string; slot: number; task_id: string | null; title: string | null; status: string | null }>;
      for (const l of leases) {
        let lastStep = "";
        if (l.task_id) {
          const ev = db.query(`SELECT data FROM events WHERE type='FLEET_STEP' AND task_id=? ORDER BY seq DESC LIMIT 1`).get(l.task_id) as { data: string } | undefined;
          if (ev) { try { const d = JSON.parse(ev.data) as { kind?: string; tool?: string; preview?: string }; lastStep = `${d.kind === "tool" ? "🔧" : d.kind === "reply" ? "💬" : "💭"} ${d.tool ? `[${d.tool}] ` : ""}${String(d.preview ?? "").slice(0, 90)}`; } catch { /* без шага */ } }
        }
        poolLines.push(`- слот ${l.slot} [${l.agent_id.slice(0, 8)}] задача=${l.task_id ?? "—"} «${l.title ?? ""}» ${l.status ?? ""}${lastStep ? ` — последний шаг: ${lastStep}` : ""}`);
      }
    } catch { /* пул не блокирует дайджест */ }
    const tasks = db.query("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status ORDER BY n DESC").all() as Array<{ status: string; n: number }>;
    return `Флот (${rows.length} активных чатов):\n${lines.join("\n") || "(пусто)"}\nПул исполнителей:\n${poolLines.join("\n") || "(слотов без lease)"}\nЗадачи workgraph: ${tasks.map((t) => `${t.status}=${t.n}`).join(", ") || "нет"}\n${daemonStatus()}`;
  } catch (e) {
    return `fleetDigest failed: ${String(e).slice(0, 120)}`;
  }
}

/** G5: долгоживущая цель чата. Свою — любой; чужую — только SUPERVISOR (или оператор через REST). */
export function chatSetObjective(sessionId: string, objective: string, opts: { by?: string } = {}): { ok: boolean; error?: string; objective?: string } {
  ensureSchema();
  const r = qSession(sessionId);
  if (!r) return { ok: false, error: "session_not_found" };
  if (String(r.status) === "CLOSED") return { ok: false, error: "session_closed" };
  const obj = String(objective ?? "").trim().slice(0, OBJECTIVE_MAX_CHARS);
  const by = opts.by ? String(opts.by) : sessionId;
  if (by !== sessionId) {
    const caller = db.query("SELECT a.role FROM agent_sessions s JOIN agents a ON a.id = s.agent_id WHERE s.id=?").get(by) as { role?: string } | null;
    if (caller?.role !== "SUPERVISOR") return { ok: false, error: "not_permitted" };
  }
  db.query("UPDATE agent_sessions SET objective=?, updated_at=? WHERE id=?").run(obj, nowIso(), sessionId);
  emit("AGENT_CHAT_OBJECTIVE", { session_id: sessionId, by, chars: obj.length, preview: obj.slice(0, 100) }, String(r.agent_id), null);
  return { ok: true, objective: obj };
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
      case "list_chats":
        return fleetDigest();
      case "chat_send": {
        const r = interchatDeliver(sessionId, String(args.session_id ?? ""), String(args.text ?? ""));
        return r.ok ? `OK: сообщение доставлено в ${String(args.session_id)} (message_id=${r.message_id})` : `ERROR: ${r.error}`;
      }
      case "create_chat": {
        const active = agentChatList({ status: "ACTIVE" }).length;
        if (active >= CHAT_CEILING) return `ERROR: chat_ceiling_reached (${active}/${CHAT_CEILING}) — эластичный потолок, масштабируй существующих (chat_send), а не плодить`;
        const s = agentChatCreate({ title: String(args.title ?? "Новый чат флота").slice(0, 160), role: String(args.role ?? "CHAT").slice(0, 32) });
        return `OK: создан чат ${s.id} «${s.title}» role=${s.role} — отправь ему вводные через chat_send`;
      }
      case "set_objective": {
        const target = String(args.session_id ?? "") || sessionId;
        const r = chatSetObjective(target, String(args.objective ?? ""), { by: sessionId });
        return r.ok ? `OK: цель закреплена для ${target}: ${String(r.objective).slice(0, 80)}` : `ERROR: ${r.error}`;
      }
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

// ── межчатовая связь (G2): чаты координируются напрямую ──────────

// Автономная реакция на входящий межчат (полная автономия флота): получатель сам
// просыпается и отрабатывает сообщение. Cooldown 20с на сессию — защита от петель
// «A→B→A→…»; глобальный потолок CHAT_MAX_INFLIGHT — от шторма.
const AUTO_TURN_COOLDOWN_MS = 20_000;
const autoTurnLast = new Map<string, number>();
function scheduleAutoTurn(sessionId: string, reason: string): void {
  const now = Date.now();
  const last = autoTurnLast.get(sessionId) ?? 0;
  if (now - last < AUTO_TURN_COOLDOWN_MS) return;
  autoTurnLast.set(sessionId, now);
  setTimeout(() => {
    try {
      const s = qSession(sessionId);
      if (!s) return;
      const sess = rowToSession(s);
      if (sess.status !== "ACTIVE" || sess.state === "THINKING") return;
      if (chatInFlight >= CHAT_MAX_INFLIGHT) return;
      agentChatTurnAsync(sessionId, `Автономный ход по входящему межчатовому сообщению (${reason}). Прочитай последнее сообщение в истории и отреагируй: выполни просьбу инструментами или ответь chat_send'ом отправителю.`);
    } catch { /* авто-ход не критичен */ }
  }, 800); // небольшая задержка — дать сообщению доехать до истории
}

export function interchatDeliver(fromId: string, toId: string, text: string): { ok: boolean; error?: string; message_id?: number } {
  ensureSchema();
  const to = qSession(toId);
  if (!to) return { ok: false, error: "target_not_found" };
  if (String(to.status) === "CLOSED") return { ok: false, error: "target_closed" };
  const from = qSession(fromId);
  const fromTitle = from ? String(from.title) : fromId;
  const body = String(text ?? "").slice(0, 4000);
  if (!body) return { ok: false, error: "empty_text" };
  const m = chatAppend(toId, "user", `[сообщение от чата «${fromTitle}» (${fromId})] ${body}`, { kind: "interchat", from_chat: fromId, from_title: fromTitle });
  emit("AGENT_CHAT_MSG", { from: fromId, to: toId, chars: body.length, preview: body.slice(0, 100) }, String(to.agent_id), null);
  scheduleAutoTurn(toId, `от «${fromTitle}»`);
  return { ok: true, message_id: m.id };
}

/** Непрочитанные межчатовые сообщения сессии (после последнего assistant-сообщения). */
export function unreadInterchat(sessionId: string): number {
  const lastA = db.query("SELECT COALESCE(MAX(id),0) AS n FROM agent_messages WHERE session_id=? AND role='assistant'").get(sessionId) as { n: number };
  const r = db.query(`SELECT COUNT(*) AS n FROM agent_messages
    WHERE session_id=? AND role='user' AND id>? AND meta LIKE '%"kind":"interchat"%'`).get(sessionId, lastA.n) as { n: number };
  return Number(r.n);
}
export function chatAppend(sessionId: string, role: AgentChatMessage["role"], content: string, meta: Record<string, unknown> = {}): AgentChatMessage {
  const at = nowIso();
  const r = db.query("INSERT INTO agent_messages (session_id, role, content, meta, at) VALUES (?,?,?,?,?)")
    .run(sessionId, role, content, JSON.stringify(meta).slice(0, 4000), at);
  return { id: Number(r.lastInsertRowid), session_id: sessionId, role, content, meta, at };
}

function systemPrompt(sess: AgentChatSession, role: string): string {
  const tools = CHAT_TOOLS.map((t) => `- ${t.name}(${Object.keys(t.args).join(", ")}) — ${t.description}`).join("\n");
  const base = [
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
  ];
  if (sess.objective) base.push(``, `Твоя ДОЛГОЖИВУЩАЯ ЦЕЛЬ (objective) — держи её в голове, каждый ход приближает её:\n${sess.objective}`);
  if (role === "SUPERVISOR") {
    base.push(
      ``,
      `ТЫ — СУПЕРВИЗОР ФЛОТА (вечно-живущий координатор). Твои обязанности:`,
      `1. Полный обзор системы: регулярно вызывай list_chats и daemon_status — ты видишь ВСЕ чаты, пул исполнителей (слоты, текущие задачи, ПОСЛЕДНИЙ ШАГ каждого исполнителя), задачи, eval.`,
      `2. Координация: деградировавшим чатам (fail_streak>=2) — разберись в причине (chat_send с вопросом), при системной проблеме ставь задачу (create_task).`,
      `3. Специализация: если разработке не хватает экспертизы — create_chat с ясной ролью (например CODE, RESEARCH, DEBUG) и передай вводные chat_send'ом.`,
      `4. ЦЕЛИ (G5): каждый чат живёт ради своей цели — назначай долгоживущие цели через set_objective (свою или чужую по session_id); цель видна во всех обзорах, чат держит её в голове.`,
      `5. Автономность: ты получаешь системные тики без человека — работай по ним сам (обзор → выводы → действия → reply с кратким отчётом).`,
      `6. Экономия: не дублируй работу других чатов; если всё спокойно — короткий отчёт без действий.`,
    );
  }
  return base.join("\n");
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
    agent = createAgent(String(opts.role ?? "CHAT"), opts.model ? normalizeChatModel(`zai:${String(opts.model).replace(/^(zai:)+/, "")}`) : agentTag());
    emit("AGENT_CREATED", { role: agent.role, model: agent.model, by: "agentchat" }, agent.id, null);
  }
  const id = `ac_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const model = normalizeChatModel(opts.model ? `zai:${String(opts.model).replace(/^(zai:)+/, "")}` : String(agent.model || agentTag()));
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
  total: number; active: number; thinking: number; supervisors: number; turns_ok: number; turns_fail: number;
  compactions: number; last_turn_at: string | null; degraded: number; in_flight: number;
} {
  ensureSchema();
  const rows = qSessions().map(rowToSession);
  const lastTurn = db.query(`SELECT at FROM agent_messages WHERE role='assistant' ORDER BY id DESC LIMIT 1`).get() as { at: string } | null;
  return {
    total: rows.length,
    active: rows.filter((s) => s.status === "ACTIVE").length,
    thinking: rows.filter((s) => s.state === "THINKING").length,
    supervisors: rows.filter((s) => s.status === "ACTIVE" && s.role === "SUPERVISOR").length,
    turns_ok: rows.reduce((a, s) => a + s.turns_ok, 0),
    turns_fail: rows.reduce((a, s) => a + s.turns_fail, 0),
    compactions: rows.reduce((a, s) => a + s.compactions, 0),
    last_turn_at: lastTurn?.at ?? null,
    degraded: rows.filter((s) => s.fail_streak >= DEGRADE_STREAK).length,
    in_flight: chatInFlight,
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

/** Полное удаление (eval-самоочистка). Осиротевший агент чата удаляется — иначе stub-модели копятся в GLM-флоте (drift). */
export function agentChatDelete(id: string): void {
  ensureSchema();
  const r = qSession(id);
  db.query("DELETE FROM agent_messages WHERE session_id=?").run(id);
  db.query("DELETE FROM agent_sessions WHERE id=?").run(id);
  if (r) {
    const agentId = String(r.agent_id);
    const left = db.query("SELECT COUNT(*) AS n FROM agent_sessions WHERE agent_id=?").get(agentId) as { n: number };
    if (Number(left.n) === 0) {
      // агент создан чатом и больше нигде не используется (pool-агенты имеют другие роли и сессии)
      try { db.query("DELETE FROM agents WHERE id=? AND role IN ('CHAT','SUPERVISOR')").run(agentId); } catch { /* удаление агента не блокирует очистку сессии */ }
    }
  }
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
  const model = normalizeChatModel(sess.model) || `zai:${agentTag()}`;
  const raw = await chat(model, [
    { role: "system", content: "Ты — архивариус агентных чатов. Сожми диалог в плотную сводку: факты, решения, результаты инструментов, незакрытые вопросы. Без воды, до 1200 символов." },
    { role: "user", content: transcript },
  ], { temperature: 0.2, lane: "P2" }); // компакция — фон (G11)
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
    const model = normalizeChatModel(sess.model) || `zai:${agentTag()}`;
    const history = buildChatContext({ ...sess, state: "THINKING" }, role);
    for (let step = 0; step < MAX_STEPS; step++) {
      if (Date.now() - t0 > TURN_DEADLINE_MS) { hardError = "turn_deadline"; break; }
      const raw = await chat(model, history, { temperature: 0.4, lane: laneForRole(role) }); // SUPERVISOR→P0, остальные→P1 (G11)
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
      // G3 real-time: мысль шага — в шину (браузер и супервизоры видят рассуждение всех чатов одновременно)
      emit("AGENT_CHAT_STEP", { session_id: sessionId, step, kind: "thought", tool: null, preview: thought.slice(0, 140) }, sess.agent_id, null);
      history.push({ role: "assistant", content: raw.slice(0, 1200) });
      steps++;
      if (tool === "reply") {
        reply = String(parsed.action.args?.text ?? "");
        emit("AGENT_CHAT_STEP", { session_id: sessionId, step, kind: "reply", tool: "reply", preview: reply.slice(0, 140) }, sess.agent_id, null);
        break;
      }
      const tTool = Date.now();
      const observation = await execChatTool(tool, parsed.action.args ?? {}, sessionId);
      toolCalls.push({ tool, ms: Date.now() - tTool });
      chatAppend(sessionId, "tool", observation, { step, tool });
      emit("AGENT_CHAT_STEP", { session_id: sessionId, step, kind: "tool", tool, ms: Date.now() - tTool, preview: observation.slice(0, 140) }, sess.agent_id, null);
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
    if (total >= COMPACT_THRESHOLD_CHARS) void agentChatCompact(sessionId, {}).catch(() => { /* R38: отказ компакции (429-шторм) не должен ронять процесс — необработанный rejection в Bun = crash */ });
  } catch { /* компакция не ломает ход */ }

  return { session_id: sessionId, reply, steps, tool_calls: toolCalls, ok, error: hardError };
}

/** Запуск хода в фоне (REST возвращает 202 немедленно — долгий ход как этот чат). */
let chatInFlight = 0;
export function chatInFlightCount(): number { return chatInFlight; }
export function agentChatTurnAsync(sessionId: string, text: string, onDone?: (ok: boolean) => void): void {
  chatInFlight++;
  void agentChatTurn(sessionId, text)
    .then((r) => { onDone?.(r.ok); })
    .catch((e) => {
      console.error(`[agentchat] async turn failed: ${String(e).slice(0, 160)}`);
      try { db.query("UPDATE agent_sessions SET state='IDLE', last_error=?, updated_at=? WHERE id=?").run(String(e).slice(0, 200), nowIso(), sessionId); } catch { /* noop */ }
      onDone?.(false);
    })
    .finally(() => { chatInFlight = Math.max(0, chatInFlight - 1); });
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

// ── G2: вечно-живущие чаты-супервизоры (перезапускающиеся координаторы флота) ──

/** Гарантия живого супервизора: нет ACTIVE SUPERVISOR с таким title → создать (перерождение). */
export function supervisorEnsure(title: string = SUPERVISOR_TITLE): { created: boolean; id: string | null } {
  ensureSchema();
  const existing = db.query(
    `SELECT s.id FROM agent_sessions s JOIN agents a ON a.id = s.agent_id
     WHERE s.status='ACTIVE' AND a.role='SUPERVISOR' AND s.title=? LIMIT 1`).get(title) as { id: string } | undefined;
  if (existing) return { created: false, id: existing.id };
  const s = agentChatCreate({ role: "SUPERVISOR", title });
  return { created: true, id: s.id };
}

/** Тик супервизоров: перерождение мёртвых + автономные ходы (по расписанию или при входящем межчате). */
export function agentChatSupervisorTick(opts: { force?: boolean } = {}): { ensured: { created: boolean; id: string | null }; kicked: string[]; supervisors: number } {
  ensureSchema();
  const ensured = supervisorEnsure();
  const sups = qSupervisors().map(rowToSession);
  const kicked: string[] = [];
  for (const sup of sups) {
    if (sup.state === "THINKING") continue; // ход уже идёт (single-writer)
    if (!opts.force && chatInFlight >= CHAT_MAX_INFLIGHT) continue; // бережём LLM-слоты
    const unread = unreadInterchat(sup.id);
    const lastA = db.query("SELECT at FROM agent_messages WHERE session_id=? AND role='assistant' ORDER BY id DESC LIMIT 1").get(sup.id) as { at: string } | null;
    const idleMs = lastA ? Date.now() - Date.parse(lastA.at) : Number.POSITIVE_INFINITY;
    if (!opts.force && unread === 0 && idleMs < SUPERVISOR_IDLE_MS) continue;
    const text = unread > 0
      ? `Входящие межчатовые сообщения (${unread}). Прочитай их в истории и отреагируй: координация флота.`
      : `Автономный тик супервизора: обзор флота (list_chats, daemon_status) → выводы → при необходимости действия (chat_send/create_task/create_chat) → краткий отчёт reply.`;
    kicked.push(sup.id);
    agentChatTurnAsync(sup.id, text);
  }
  return { ensured, kicked, supervisors: sups.length };
}
