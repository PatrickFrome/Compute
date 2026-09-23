/**
 * ME4 MEMORY (R19) — порт механики M13 старой системы (эпизодическая память → промпты),
 * которая была CAVEAT (in-process JSON, gap R6 «память без persistence-пруфа декоративна»).
 *
 * Улучшения против старой:
 *  - SQLite WAL (тот же файл me2.db): переживает рестарт — persistence by construction;
 *  - UNIQUE(kind,key) + ON CONFLICT = идемпотентная материализация (аналог terminal_task_immutable);
 *  - score-поиск: важность × свежесть (эксп. затухание 72ч) × hits × match;
 *  - авто-материализация из event-шины (TASK_DONE/FAILED/REWARD_HACK/REFLECTED) — см. onMemoryEvent;
 *  - persistence-пруф в status (rows/oldest/db_bytes).
 *
 * Слои: episodic (что случилось) / semantic (факты-уроки) / procedural (как делать).
 */
import { db, emit, nowIso } from "../store";
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type MemKind = "episodic" | "semantic" | "procedural";

db.exec(`
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  importance REAL NOT NULL DEFAULT 0.5,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(kind, key)
);
CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory(kind, updated_at);
`);

export interface MemRow {
  id: number; kind: string; key: string; content: string; tags: string;
  importance: number; hits: number; created_at: number; updated_at: number;
  score?: number;
}

/** Идемпотентная запись: повтор с тем же (kind,key) обновляет контент/важность, не плодит дубли. */
export function memWrite(input: {
  kind: MemKind; key: string; content: string; tags?: string[]; importance?: number;
}): MemRow & { created: boolean } {
  const kind = String(input.kind).slice(0, 16);
  const key = String(input.key).slice(0, 200);
  if (!kind || !key) throw new Error("kind_and_key_required");
  const content = String(input.content ?? "").slice(0, 4000);
  const tags = JSON.stringify((input.tags ?? []).slice(0, 8).map((t) => String(t).slice(0, 40)));
  const importance = Math.min(1, Math.max(0, input.importance ?? 0.5));
  const now = Date.now();
  const existing = db.query(`SELECT id FROM memory WHERE kind=? AND key=?`).get(kind, key) as { id: number } | undefined;
  db.query(
    `INSERT INTO memory (kind,key,content,tags,importance,hits,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)
     ON CONFLICT(kind,key) DO UPDATE SET content=excluded.content, tags=excluded.tags,
       importance=MAX(importance, excluded.importance), updated_at=excluded.updated_at`,
  ).run(kind, key, content, tags, importance, now, now);
  const row = db.query(`SELECT * FROM memory WHERE kind=? AND key=?`).get(kind, key) as MemRow;
  if (!existing) emit("MEMORY_WRITTEN", { kind, key, id: row.id, importance });
  return { ...row, created: !existing };
}

/** Score-поиск: 0.40 match + 0.30 свежесть(exp −возраст/72ч) + 0.20 важность + 0.10 hits. */
export function memSearch(opts: { q?: string; kind?: string; limit?: number } = {}): MemRow[] {
  const limit = Math.min(Math.max(1, Number(opts.limit ?? 10)), 50);
  const q = (opts.q ?? "").trim().toLowerCase();
  let rows: MemRow[];
  if (opts.kind && ["episodic", "semantic", "procedural"].includes(opts.kind)) {
    rows = db.query(`SELECT * FROM memory WHERE kind=? ORDER BY updated_at DESC LIMIT 400`).all(opts.kind) as MemRow[];
  } else {
    rows = db.query(`SELECT * FROM memory ORDER BY updated_at DESC LIMIT 400`).all() as MemRow[];
  }
  const now = Date.now();
  const scored = rows.map((r) => {
    const ageH = Math.max(0, (now - r.updated_at) / 3_600_000);
    const recency = Math.exp(-ageH / 72);
    const hitsNorm = Math.min(1, r.hits / 10);
    const importance = r.importance;
    let match = 0.5;
    if (q) {
      const hay = `${r.key} ${r.content} ${r.tags}`.toLowerCase();
      match = hay.includes(q) ? 1 : 0;
    }
    const score = 0.4 * match + 0.3 * recency + 0.2 * importance + 0.1 * hitsNorm;
    return { ...r, score: Math.round(score * 1000) / 1000 };
  });
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored.slice(0, limit);
}

/** Подъём hits при использовании в промптах (lease-deterministic кэш старой системы). */
export function memTouch(ids: number[]): void {
  for (const id of ids.slice(0, 20)) {
    try { db.query(`UPDATE memory SET hits=hits+1 WHERE id=?`).run(id); } catch { /* noop */ }
  }
}

/** TEAM MEMORY блок для промптов — порт #memoryBlockFor (≤5 эпизодов, бюджет символов). */
export function memBlock(n = 5, budgetChars = 1400): { block: string; used: MemRow[] } {
  const top = memSearch({ limit: Math.max(n, 6) });
  const lines: string[] = [];
  const used: MemRow[] = [];
  let total = 0;
  for (const m of top) {
    if (used.length >= n) break;
    const line = `- [${m.kind}] ${m.key}: ${m.content.slice(0, 240)}`;
    if (total + line.length > budgetChars) continue;
    lines.push(line);
    used.push(m);
    total += line.length;
  }
  memTouch(used.map((u) => u.id));
  return { block: lines.length ? `TEAM MEMORY:\n${lines.join("\n")}` : "", used };
}

export function memDelete(id: number): boolean {
  const r = db.query(`DELETE FROM memory WHERE id=?`).run(id);
  return Number(r.changes) > 0;
}

export function memoryStatus(): {
  ok: true; rows: number; by_kind: Record<string, number>; db_bytes: number;
  oldest: number | null; last_write: number | null; db_path: string;
} {
  const byKind: Record<string, number> = { episodic: 0, semantic: 0, procedural: 0 };
  const rows = db.query(`SELECT kind, COUNT(*) n, MIN(created_at) oldest, MAX(updated_at) last_write FROM memory GROUP BY kind`).all() as Array<{ kind: string; n: number; oldest: number; last_write: number }>;
  let total = 0;
  let oldest: number | null = null;
  let lastWrite: number | null = null;
  for (const r of rows) {
    byKind[r.kind] = r.n;
    total += r.n;
    oldest = oldest === null ? r.oldest : Math.min(oldest, r.oldest);
    lastWrite = lastWrite === null ? r.last_write : Math.max(lastWrite, r.last_write);
  }
  const dbPath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "me2.db");
  let dbBytes = 0;
  try { dbBytes = statSync(dbPath).size; } catch { /* noop */ }
  return { ok: true, rows: total, by_kind: byKind, db_bytes: dbBytes, oldest, last_write: lastWrite, db_path: "data/me2.db" };
}

/** Авто-материализация эпизодов из event-шины. Вызывается из onEvent-моста index.ts. */
export function onMemoryEvent(
  type: string,
  data: Record<string, unknown>,
  taskId: string | null,
  resolvers: { title: (id: string) => string | null; lesson: (id: string) => string | null },
): void {
  try {
    if (type === "TASK_DONE" && taskId) {
      memWrite({
        kind: "episodic", key: `task:${taskId}`,
        content: `[COMPLETED] ${resolvers.title(taskId) ?? taskId} → ${String(data.result ?? "").slice(0, 300)}`,
        tags: ["task", "completed"], importance: 0.7,
      });
    } else if (type === "TASK_FAILED" && taskId) {
      memWrite({
        kind: "episodic", key: `task:${taskId}`,
        content: `[FAILED] ${resolvers.title(taskId) ?? taskId} → ${String(data.error ?? "").slice(0, 200)} / ${String(data.cause ?? "").slice(0, 80)}`,
        tags: ["task", "failed", String(data.cause ?? "err").slice(0, 30)], importance: 0.85,
      });
    } else if (type === "TASK_REWARD_HACK" && taskId) {
      const reasons = Array.isArray(data.reasons) ? data.reasons.join(",") : String(data.reasons ?? "?");
      memWrite({
        kind: "semantic", key: `rh:${taskId}`,
        content: `[REWARD-HACK] ${String(taskId)}: ${reasons} (steps=${data.steps}, writes=${data.writes})`,
        tags: ["reward-hack", "verdict"], importance: 0.9,
      });
    } else if (type === "TASK_REFLECTED" && taskId) {
      // события TASK_REFLECTED не содержит текст урока — берём из tasks.reflection (watermark из БД, не из data)
      const lesson = String(resolvers.lesson(taskId) ?? "").trim();
      if (lesson) {
        memWrite({
          kind: "semantic", key: `reflect:${taskId}`,
          content: `[LESSON] ${lesson.slice(0, 400)}`,
          tags: ["lesson", "reflexion"], importance: 0.8,
        });
      }
    }
  } catch { /* память не ломает шину */ }
}

/** Урок tier-2 из tasks.reflection (для boot-подхвата без событий — рестарты не теряют уроки). */
export function importReflectionLesson(taskId: string, title: string, lesson: string): void {
  try {
    memWrite({
      kind: "semantic", key: `reflect:${taskId}`,
      content: `[LESSON] ${lesson.slice(0, 400)}`,
      tags: ["lesson", "reflexion"], importance: 0.8,
    });
  } catch { /* noop */ }
}

/**
 * E5 (R35) — MEMORY TOKEN ECONOMY: дельта-доставка памяти вместо полного блока
 * (расширение sense-diffing D1 на слой памяти; тренд 2026: progressive disclosure / context economy).
 *
 * Честность (без обмана LLM):
 *  - STICKY-ядро: критичные SEMANTIC-уроки (importance ≥ 0.85) НЕ элиминируются никогда;
 *  - элиминация только для записей, уже доставленных ЭТОМУ consumer'у БЕЗ ИЗМЕНЕНИЙ в окно TTL (30м)
 *    — у продолжающего контекста они уже в истории; элиминированные ключи видны одной строкой;
 *  - любое изменение контента (hash) возвращает запись в «свежие» — тампер памяти не теряется;
 *  - самодескриптивный заголовок блока + полная доставка при первом контакте consumer'а.
 * Метрики: bytes_full (канонический полный блок) vs bytes_compact, saved_pct ∈ [0..0.95], журнал 200.
 */
export const ECON_TTL_MS = 30 * 60_000;
export const STICKY_IMPORTANCE = 0.85;
const ECON_JOURNAL_CAP = 200;

db.exec(`
CREATE TABLE IF NOT EXISTS memory_delivery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consumer TEXT NOT NULL,
  mem_id INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  delivered_at INTEGER NOT NULL,
  UNIQUE(consumer, mem_id)
);
CREATE INDEX IF NOT EXISTS idx_memdel_consumer ON memory_delivery(consumer, delivered_at);
CREATE TABLE IF NOT EXISTS memory_economy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consumer TEXT NOT NULL,
  full_n INTEGER NOT NULL, compact_n INTEGER NOT NULL,
  sticky_n INTEGER NOT NULL, fresh_n INTEGER NOT NULL, familiar_n INTEGER NOT NULL,
  bytes_full INTEGER NOT NULL, bytes_compact INTEGER NOT NULL,
  saved_pct REAL NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memecon_at ON memory_economy(at);
`);

function memContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export interface MemEconMetrics {
  consumer: string; full_n: number; compact_n: number;
  sticky_n: number; fresh_n: number; familiar_n: number;
  bytes_full: number; bytes_compact: number; saved_pct: number;
}

export interface MemEconDelivery { block: string; used: MemRow[]; metrics: MemEconMetrics }

/**
 * Экономная доставка памяти consumer'у.
 * opts.ids — детерминированная выборка (eval); по умолчанию глобальный score-топ (memSearch).
 */
export function memBlockEconomy(
  consumerRaw: string, n = 5, budgetChars = 1400, opts: { ids?: number[] } = {},
): MemEconDelivery {
  const consumer = String(consumerRaw ?? "").trim().slice(0, 64) || "default";
  const take = Math.max(1, Math.min(50, Math.floor(Number(n) || 5)));
  const budget = Math.max(200, Math.min(8000, Math.floor(Number(budgetChars) || 1400)));

  let sel: MemRow[];
  if (opts.ids && opts.ids.length) {
    sel = opts.ids
      .map((id) => db.query(`SELECT * FROM memory WHERE id=?`).get(Number(id)) as MemRow | undefined)
      .filter((r): r is MemRow => Boolean(r))
      .slice(0, take);
  } else {
    sel = memSearch({ limit: take }).slice(0, take);
  }

  const now = Date.now();
  const delivered = db.query(
    `SELECT mem_id, content_hash, delivered_at FROM memory_delivery WHERE consumer=?`,
  ).all(consumer) as Array<{ mem_id: number; content_hash: string; delivered_at: number }>;
  const delMap = new Map(delivered.map((d) => [d.mem_id, d]));

  const sticky: MemRow[] = [];
  const fresh: MemRow[] = [];
  const familiar: MemRow[] = [];
  for (const m of sel) {
    const h = memContentHash(m.content);
    const d = delMap.get(m.id);
    // STICKY = критичные SEMANTIC-уроки (review-вердикты, reward-hack, уроки ≥0.85) —
    // не элиминируются никогда. Эпизоды (kind=episodic, даже FAILED 0.85) — история:
    // их уроки уже извлечены в semantic-слой, эпизод честно элиминируем.
    if (m.kind === "semantic" && m.importance >= STICKY_IMPORTANCE) sticky.push(m);
    else if (d && d.content_hash === h && now - d.delivered_at < ECON_TTL_MS) familiar.push(m);
    else fresh.push(m);
  }

  // канонический ПОЛНЫЙ блок (тот же алгоритм, что memBlock) — база сравнения
  const fullLines: string[] = [];
  let fullTotal = 0;
  for (const m of sel) {
    const line = `- [${m.kind}] ${m.key}: ${m.content.slice(0, 240)}`;
    if (fullTotal + line.length > budget) continue;
    fullLines.push(line); fullTotal += line.length;
  }

  // КОМПАКТНЫЙ блок: sticky+fresh целиком, familiar — одной строкой ключей
  const compactLines: string[] = [];
  let compactTotal = 0;
  const used: MemRow[] = [];
  for (const m of [...sticky, ...fresh]) {
    const line = `- [${m.kind}] ${m.key}: ${m.content.slice(0, 240)}`;
    if (compactTotal + line.length > budget) continue;
    compactLines.push(line); compactTotal += line.length; used.push(m);
  }
  const header = compactLines.length
    ? `TEAM MEMORY (economy: ${fresh.length} новых/изменённых, ${familiar.length} знакомых элиминировано — детали по ключам: memory_search):`
    : "";
  if (familiar.length) {
    const elided = `- … уже знакомо (${familiar.length}): ${familiar.map((f) => f.key).join(", ")}`;
    if (compactTotal + elided.length <= budget + 80) compactLines.push(elided);
  }
  const compactBlock = compactLines.length ? `${header}\n${compactLines.join("\n")}` : "";

  // метрика — по СТРОКАМ памяти: заголовок есть у ОБОИХ схем (протокольный оверхед),
  // считать его «отрицательной экономией» базлайна — нечестно. Строки: полная выборка vs
  // sticky+fresh+элиминированная строка ключей → базлайн = 0 ровно, элиминация > 0.
  const bytesFull = fullLines.join("\n").length;
  const bytesCompact = compactLines.join("\n").length;
  const savedPct = bytesFull > 0 && bytesCompact < bytesFull
    ? Math.min(0.95, Math.round((1 - bytesCompact / bytesFull) * 1000) / 1000)
    : 0;

  // регистрация доставки (включая повторный touch familiar — продлевает окно честно)
  for (const m of sel) {
    db.query(
      `INSERT INTO memory_delivery (consumer, mem_id, content_hash, delivered_at) VALUES (?,?,?,?)
       ON CONFLICT(consumer, mem_id) DO UPDATE SET content_hash=excluded.content_hash, delivered_at=excluded.delivered_at`,
    ).run(consumer, m.id, memContentHash(m.content), now);
  }
  memTouch(used.map((u) => u.id));

  const metrics: MemEconMetrics = {
    consumer, full_n: sel.length, compact_n: used.length,
    sticky_n: sticky.length, fresh_n: fresh.length, familiar_n: familiar.length,
    bytes_full: bytesFull, bytes_compact: bytesCompact, saved_pct: savedPct,
  };
  db.query(
    `INSERT INTO memory_economy (consumer, full_n, compact_n, sticky_n, fresh_n, familiar_n, bytes_full, bytes_compact, saved_pct, at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(consumer, metrics.full_n, metrics.compact_n, metrics.sticky_n, metrics.fresh_n, metrics.familiar_n, bytesFull, bytesCompact, savedPct, now);
  db.query(
    `DELETE FROM memory_economy WHERE id NOT IN (SELECT id FROM memory_economy ORDER BY id DESC LIMIT ${ECON_JOURNAL_CAP})`,
  ).run();
  emit("MEMORY_ECONOMY", {
    consumer, saved_pct: savedPct, bytes_full: bytesFull, bytes_compact: bytesCompact,
    fresh: metrics.fresh_n, familiar: metrics.familiar_n,
  });
  return { block: compactBlock, used, metrics };
}

/** Агрегат экономики памяти: журнал + суммы по consumer'ам. */
export function memoryEconStatus(): {
  ok: true; deliveries: number; avg_saved_pct: number; bytes_saved_total: number;
  by_consumer: Array<{ consumer: string; deliveries: number; avg_saved_pct: number; bytes_saved: number; last_at: number }>;
  journal: Array<MemEconMetrics & { id: number; at: number }>;
} {
  const total = db.query(`SELECT COUNT(*) n, COALESCE(AVG(saved_pct),0) avg_saved, COALESCE(SUM(bytes_full - bytes_compact),0) bytes_saved FROM memory_economy`)
    .get() as { n: number; avg_saved: number; bytes_saved: number };
  const byConsumer = db.query(
    `SELECT consumer, COUNT(*) deliveries, AVG(saved_pct) avg_saved_pct, SUM(bytes_full - bytes_compact) bytes_saved, MAX(at) last_at
     FROM memory_economy GROUP BY consumer ORDER BY last_at DESC LIMIT 8`,
  ).all() as Array<{ consumer: string; deliveries: number; avg_saved_pct: number; bytes_saved: number; last_at: number }>;
  const journal = db.query(`SELECT * FROM memory_economy ORDER BY id DESC LIMIT 30`)
    .all() as Array<MemEconMetrics & { id: number; at: number }>;
  return {
    ok: true, deliveries: total.n, avg_saved_pct: Math.round(total.avg_saved * 1000) / 1000,
    bytes_saved_total: total.bytes_saved, by_consumer: byConsumer, journal,
  };
}

/** Очистка следов consumer'а (eval/самоочистка) — возвращает число удалённых строк. */
export function memEconCleanup(consumer: string): { delivery: number; journal: number } {
  const c = String(consumer).slice(0, 64);
  const d = db.query(`DELETE FROM memory_delivery WHERE consumer=?`).run(c);
  const j = db.query(`DELETE FROM memory_economy WHERE consumer=?`).run(c);
  return { delivery: Number(d.changes), journal: Number(j.changes) };
}

export const MEMORY_TS = nowIso;
