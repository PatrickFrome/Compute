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

export const MEMORY_TS = nowIso;
