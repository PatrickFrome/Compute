/**
 * ME2 G7 (R44) — cron-планировщик ИЗ ЧАТОВ: агент сам ставит себе повторяющиеся
 * задания, демон будит его по расписанию.
 *
 * Операторское «вся работа — в открытых чатах» (R44) требует, чтобы у чатов был
 * механизм времени: «проверяй бэклог каждые 10 минут», «запускай прогон раз в час».
 *
 * Механика:
 *   • таблица chat_crons в SQLite (переживает рестарт; overdue-задания честно
 *     срабатывают первым тиком после старта);
 *   • инструменты чата: schedule_cron {every_minutes|daily_time, text},
 *     list_crons, cancel_cron {id};
 *   • тик 30с (index.ts, каноническая инкарнация): due-задания → сообщение в
 *     историю чата + автономный ход (agentChatTurnAsync);
 *   • дисциплина: policy-гейт (tiers[tier].schedule, H2), капы crons_per_chat /
 *     crons_global / cron_min_minutes из policy.json — анти-шторм;
 *   • каждое срабатывание/отмена — событие AGENT_CHAT_CRON в hash-chain.
 *
 * REST: GET /cron (список + капы), POST /cron {op:"cancel"|"fire", id, kick?}.
 */
import { db, emit, nowIso } from "../store";
import { policyCaps, loadPolicy, type Tier } from "./policy";
import type { AgentChatMessage } from "./agentchat";

export interface ChatCron {
  id: number;
  session_id: string;
  kind: "every" | "daily";
  every_minutes: number | null;
  hhmm: string | null;
  text: string;
  status: "ACTIVE" | "CANCELLED";
  next_run_at: string;
  last_run_at: string | null;
  runs: number;
  created_at: string;
}

let schemaReady = false;
export const CRON_TICK_MS = 30_000; // период тика планировщика (index.ts, каноническая инкарнация)
function ensureSchema(): void {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_crons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      every_minutes INTEGER,
      hhmm TEXT,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      runs INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_crons_session ON chat_crons(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_crons_next ON chat_crons(status, next_run_at);
  `);
  schemaReady = true;
}

function rowToCron(r: Record<string, unknown>): ChatCron {
  return {
    id: Number(r.id), session_id: String(r.session_id),
    kind: r.kind === "daily" ? "daily" : "every",
    every_minutes: r.every_minutes == null ? null : Number(r.every_minutes),
    hhmm: (r.hhmm as string) ?? null,
    text: String(r.text ?? ""), status: r.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
    next_run_at: String(r.next_run_at ?? ""), last_run_at: (r.last_run_at as string) ?? null,
    runs: Number(r.runs ?? 0), created_at: String(r.created_at ?? ""),
  };
}

/** Мост в agentchat (разрываем цикл импорта: agentchat вызывает cron лениво). */
let bridge: {
  chatAppend: (sessionId: string, role: AgentChatMessage["role"], content: string, meta?: Record<string, unknown>) => AgentChatMessage;
  turnAsync: (sessionId: string, text: string) => void;
  sessionState: (sessionId: string) => "ACTIVE" | "CLOSED" | "THINKING" | "missing";
} | null = null;
export function cronBridge(b: NonNullable<typeof bridge>): void { bridge = b; }

function nextEvery(minutes: number, from = Date.now()): string {
  return new Date(from + minutes * 60_000).toISOString();
}
function nextDaily(hhmm: string, from = Date.now()): string {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export interface CronAddResult { ok: boolean; error?: string; cron?: ChatCron }

/** Создание cron-задания чатом (или оператором через REST — tier T0). */
export function cronAdd(sessionId: string, spec: { every_minutes?: number; daily_time?: string }, text: string, opts: { tier?: Tier } = {}): CronAddResult {
  ensureSchema();
  const caps = policyCaps();
  const tier: Tier = opts.tier ?? "T2";
  if (!loadPolicy().tiers[tier]?.schedule) {
    try { emit("POLICY_DENIED", { tier, subject: sessionId.slice(0, 64), tool: "schedule_cron", reason: `policy_denied: ярус ${tier} без права расписания`, verdict: "deny" }, null, null); } catch { /* chain не критичен */ }
    return { ok: false, error: `policy_denied: tier ${tier} без schedule` };
  }
  const body = String(text ?? "").trim().slice(0, 1000);
  if (!body) return { ok: false, error: "text_required" };
  let kind: "every" | "daily";
  let every: number | null = null;
  let hhmm: string | null = null;
  let next: string;
  if (spec.daily_time != null) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(spec.daily_time));
    if (!m) return { ok: false, error: "daily_time_format_HHMM" };
    kind = "daily"; hhmm = String(spec.daily_time).padStart(5, "0");
    next = nextDaily(hhmm);
  } else {
    every = Math.floor(Number(spec.every_minutes ?? 0));
    if (!Number.isFinite(every) || every < caps.cron_min_minutes) return { ok: false, error: `every_minutes >= ${caps.cron_min_minutes} (анти-шторм)` };
    kind = "every";
    next = nextEvery(every);
  }
  const perChat = (db.query(`SELECT COUNT(*) AS n FROM chat_crons WHERE session_id=? AND status='ACTIVE'`).get(sessionId) as { n: number }).n;
  if (perChat >= caps.crons_per_chat) return { ok: false, error: `cap_crons_per_chat (${perChat}/${caps.crons_per_chat})` };
  const globalN = (db.query(`SELECT COUNT(*) AS n FROM chat_crons WHERE status='ACTIVE'`).get() as { n: number }).n;
  if (globalN >= caps.crons_global) return { ok: false, error: `cap_crons_global (${globalN}/${caps.crons_global})` };
  const r = db.query(`INSERT INTO chat_crons (session_id, kind, every_minutes, hhmm, text, status, next_run_at, runs, created_at)
    VALUES (?,?,?,?,?,'ACTIVE',?,0,?)`)
    .run(sessionId, kind, every, hhmm, body, next, nowIso());
  const cron = cronGet(Number(r.lastInsertRowid));
  if (!cron) return { ok: false, error: "insert_failed" };
  emit("AGENT_CHAT_CRON", { action: "scheduled", cron_id: cron.id, session_id: sessionId, kind, every_minutes: every, hhmm, next_run_at: next, text_preview: body.slice(0, 100) }, null, null);
  return { ok: true, cron };
}

export function cronGet(id: number): ChatCron | null {
  const r = db.query(`SELECT * FROM chat_crons WHERE id=?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToCron(r) : null;
}

export function cronList(sessionId?: string): ChatCron[] {
  ensureSchema();
  const rows = sessionId
    ? db.query(`SELECT * FROM chat_crons WHERE session_id=? ORDER BY next_run_at`).all(sessionId) as Array<Record<string, unknown>>
    : db.query(`SELECT * FROM chat_crons ORDER BY status, next_run_at LIMIT 200`).all() as Array<Record<string, unknown>>;
  return rows.map(rowToCron);
}

export function cronCountBySession(): Record<string, number> {
  ensureSchema();
  const rows = db.query(`SELECT session_id, COUNT(*) AS n FROM chat_crons WHERE status='ACTIVE' GROUP BY session_id`).all() as Array<{ session_id: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.session_id, Number(r.n)]));
}

export function cronCancel(id: number, by = "operator"): boolean {
  ensureSchema();
  const c = cronGet(id);
  if (!c || c.status !== "ACTIVE") return false;
  db.query(`UPDATE chat_crons SET status='CANCELLED' WHERE id=?`).run(id);
  emit("AGENT_CHAT_CRON", { action: "cancelled", cron_id: id, session_id: c.session_id, by }, null, null);
  return true;
}

/** Ручное срабатывание (оператор, T0): не двигает расписание, просто будит чат. */
export function cronFire(id: number, kick = true): { ok: boolean; error?: string } {
  const c = cronGet(id);
  if (!c || c.status !== "ACTIVE") return { ok: false, error: "cron_not_active" };
  fireCron(c, { kick, manual: true });
  return { ok: true };
}

function fireCron(c: ChatCron, opts: { kick?: boolean; manual?: boolean } = {}): void {
  const state = bridge?.sessionState(c.session_id) ?? "missing";
  if (state === "missing" || state === "CLOSED") {
    db.query(`UPDATE chat_crons SET status='CANCELLED' WHERE id=?`).run(c.id); // чат мёртв — задание честно гасим
    emit("AGENT_CHAT_CRON", { action: "cancelled_orphan", cron_id: c.id, session_id: c.session_id }, null, null);
    return;
  }
  const label = c.kind === "daily" ? `ежедневно в ${c.hhmm}` : `каждые ${c.every_minutes}м`;
  const text = `⏰ Сработало расписание #${c.id} (${label})${opts.manual ? " [вручную оператором]" : ""}:\n${c.text}`;
  try { bridge?.chatAppend(c.session_id, "system", text, { cron_id: c.id, kind: "cron" }); } catch { /* история не блокирует */ }
  emit("AGENT_CHAT_CRON", { action: "fired", cron_id: c.id, session_id: c.session_id, manual: !!opts.manual, runs: c.runs + 1, text_preview: c.text.slice(0, 100) }, null, null);
  if (opts.kick !== false && state === "ACTIVE") {
    bridge?.turnAsync(c.session_id, `Сработало твоё расписание #${c.id} (${label}). Задание: ${c.text} — выполни его инструментами и отчитайся reply.`);
  }
}

/**
 * Тик планировщика (каждые 30с из index.ts). `nowMs` — инъекция для eval.
 * THINKING-чат откладывается (плюс 60с, без срабатывания) — single-writer хода.
 */
export function cronTick(opts: { nowMs?: number; kick?: boolean } = {}): { fired: number; postponed: number } {
  ensureSchema();
  const now = new Date(opts.nowMs ?? Date.now()).toISOString();
  const due = db.query(`SELECT * FROM chat_crons WHERE status='ACTIVE' AND next_run_at<=? ORDER BY next_run_at LIMIT 16`).all(now) as Array<Record<string, unknown>>;
  let fired = 0, postponed = 0;
  for (const row of due) {
    const c = rowToCron(row);
    if ((bridge?.sessionState(c.session_id) ?? "missing") === "THINKING") {
      db.query(`UPDATE chat_crons SET next_run_at=? WHERE id=?`).run(new Date((opts.nowMs ?? Date.now()) + 60_000).toISOString(), c.id);
      postponed++;
      continue;
    }
    fireCron(c, { kick: opts.kick });
    const next = c.kind === "daily" && c.hhmm ? nextDaily(c.hhmm, opts.nowMs ?? Date.now()) : nextEvery(c.every_minutes ?? capsMin(), opts.nowMs ?? Date.now());
    db.query(`UPDATE chat_crons SET last_run_at=?, runs=runs+1, next_run_at=? WHERE id=?`).run(nowIso(), next, c.id);
    fired++;
  }
  return { fired, postponed };
}

function capsMin(): number { return policyCaps().cron_min_minutes; }

/** Изоляция eval-прогонов: снести все задания (вызывается только из eval). */
export function cronTestReset(): void {
  ensureSchema();
  db.query(`DELETE FROM chat_crons`).run();
}

export function cronStatus(): { ok: true; crons: ChatCron[]; caps: ReturnType<typeof policyCaps>; per_session: Record<string, number> } {
  return { ok: true, crons: cronList(), caps: policyCaps(), per_session: cronCountBySession() };
}
