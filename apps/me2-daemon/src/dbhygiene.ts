/**
 * ME2 daemon — DB hygiene (R31, пункт D4 из research/2026/R24-AUDIT-ROADMAP.md §7).
 *
 * Зачем: демо-БД растёт часами (events hash-chain, eval_runs, browser_obsv, spans),
 * но никто не следил за WAL-файлом, freelist и индексами горячих запросов. Классика
 * SQLite-гигиены, портированная в daemon:
 *
 *  - WAL checkpoint: PASSIVE по расписанию (каждые 10м — не блокирует писателей),
 *    TRUNCATE вручную оператором (обнуляет wal-файл на диске);
 *  - VACUUM: только осмысленно (freelist_pct ≥ 10) или force — оператор знает;
 *  - индексы горячих запросов: eval_runs(started_at), tasks(status), tasks(created_at);
 *    индексы browser_obsv/browser_sense_diff создаются в своих модулях (D1/D2);
 *  - журнал hygiene_runs (cap 50): каждый op с длительностью и деталями — честные
 *    измерения, а не «сделали гигиену» без пруфа;
 *  - REST GET/POST /db/hygiene вне шины (47/47 инвариант), класс rest_admin.
 *
 * Урок R30 (bun:sqlite второе соединение): используем ОСНОВНОЕ db-соединение из store
 * ({write:true} уже выставлено там) — никаких новых open'ов.
 */
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db, emit } from "../store";
import { recordSpan } from "./otel";

db.exec(`
CREATE TABLE IF NOT EXISTS hygiene_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ran_at INTEGER NOT NULL
);
`);

// D4: индексы горячих запросов (idempotent; отсутствие таблицы не валим — eval/run может быть до миграций)
for (const idx of [
  `CREATE INDEX IF NOT EXISTS idx_eval_runs_started ON eval_runs(started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)`,
]) {
  try { db.exec(idx); } catch { /* таблицы ещё нет — не критично для старта */ }
}

export interface HygieneStatus {
  ok: true;
  db: {
    file_mb: number; wal_mb: number; journal_mode: string;
    page_count: number; page_size: number; freelist_count: number; freelist_pct: number;
  };
  indexes: string[];
  last_runs: Array<{ op: string; duration_ms: number; ok: boolean; detail: string; ran_at: number; age_s: number }>;
  schedule_min: number;
}

function walFileMb(): number {
  try {
    const walPath = fileURLToPath(new URL("../data/me2.db-wal", import.meta.url));
    return Math.round((statSync(walPath).size / (1024 * 1024)) * 100) / 100;
  } catch { return 0; }
}

function dbFileMb(): number {
  try {
    const dbPath = fileURLToPath(new URL("../data/me2.db", import.meta.url));
    return Math.round((statSync(dbPath).size / (1024 * 1024)) * 100) / 100;
  } catch { return 0; }
}

function record(op: string, durationMs: number, ok: boolean, detail: string): void {
  try {
    db.query(`INSERT INTO hygiene_runs (op, duration_ms, ok, detail, ran_at) VALUES (?,?,?,?,?)`)
      .run(op, durationMs, ok ? 1 : 0, detail.slice(0, 200), Date.now());
    db.query(`DELETE FROM hygiene_runs WHERE id NOT IN (SELECT id FROM hygiene_runs ORDER BY id DESC LIMIT 50)`).run();
  } catch { /* журнал не критичен для результата операции */ }
}

export function hygieneStatus(): HygieneStatus {
  const pc = db.query(`PRAGMA page_count`).get() as { page_count: number };
  const ps = db.query(`PRAGMA page_size`).get() as { page_size: number };
  const fl = db.query(`PRAGMA freelist_count`).get() as { freelist_count: number };
  const jm = db.query(`PRAGMA journal_mode`).get() as { journal_mode: string };
  const idxRows = db.query(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`).all() as Array<{ name: string }>;
  const runs = db.query(`SELECT op, duration_ms, ok, detail, ran_at FROM hygiene_runs ORDER BY id DESC LIMIT 5`).all() as Array<{
    op: string; duration_ms: number; ok: number; detail: string; ran_at: number;
  }>;
  const pageCount = Number(pc.page_count) || 0;
  const freelist = Number(fl.freelist_count) || 0;
  return {
    ok: true,
    db: {
      file_mb: dbFileMb(), wal_mb: walFileMb(), journal_mode: String(jm.journal_mode ?? "?"),
      page_count: pageCount, page_size: Number(ps.page_size) || 0,
      freelist_count: freelist,
      freelist_pct: pageCount > 0 ? Math.round((freelist / pageCount) * 1000) / 10 : 0,
    },
    indexes: idxRows.map((r) => r.name),
    last_runs: runs.map((r) => ({ ...r, ok: r.ok === 1, age_s: Math.round((Date.now() - r.ran_at) / 1000) })),
    schedule_min: HYGIENE_INTERVAL_MS / 60_000,
  };
}

/** WAL checkpoint: PASSIVE (расписание) или TRUNCATE (оператор, обнуляет wal-файл). */
export function hygieneCheckpoint(mode: "PASSIVE" | "TRUNCATE" = "PASSIVE"): { ok: boolean; detail: string; duration_ms: number } {
  const t0 = Date.now();
  try {
    const r = db.query(`PRAGMA wal_checkpoint(${mode})`).get() as { busy: number; log: number; checkpointed: number };
    const detail = `mode=${mode} busy=${r.busy} wal_pages=${r.log} checkpointed=${r.checkpointed}, wal_mb=${walFileMb()}`;
    const dur = Date.now() - t0;
    record("checkpoint", dur, r.busy === 0, detail);
    try { emit("DB_HYGIENE", { op: "checkpoint", mode, duration_ms: dur, detail }, null, null); } catch { /* шина не критична */ }
    try { recordSpan("db.hygiene", { "me2.op": "checkpoint", "me2.mode": mode, "me2.ms": dur }, t0); } catch { /* телеметрия */ }
    return { ok: r.busy === 0, detail, duration_ms: dur };
  } catch (e) {
    const dur = Date.now() - t0;
    record("checkpoint", dur, false, (e as Error).message);
    return { ok: false, detail: (e as Error).message, duration_ms: dur };
  }
}

/** VACUUM: осмысленно только при фрагментации (freelist_pct ≥ 10), иначе требуй force. */
export function hygieneVacuum(force = false): { ok: boolean; detail: string; duration_ms: number; skipped: boolean } {
  const t0 = Date.now();
  const st = hygieneStatus().db;
  if (!force && st.freelist_pct < 10) {
    const detail = `skipped: freelist_pct=${st.freelist_pct}% < 10 (нечего вакуумить; force=true чтобы всё равно)`;
    record("vacuum", Date.now() - t0, true, detail);
    return { ok: true, detail, duration_ms: Date.now() - t0, skipped: true };
  }
  try {
    db.exec(`VACUUM`);
    const dur = Date.now() - t0;
    const after = hygieneStatus().db;
    const detail = `freelist_pct ${st.freelist_pct}% → ${after.freelist_pct}%, file ${st.file_mb}MB → ${after.file_mb}MB`;
    record("vacuum", dur, true, detail);
    try { emit("DB_HYGIENE", { op: "vacuum", duration_ms: dur, detail }, null, null); } catch { /* шина не критична */ }
    try { recordSpan("db.hygiene", { "me2.op": "vacuum", "me2.ms": dur }, t0); } catch { /* телеметрия */ }
    return { ok: true, detail, duration_ms: dur, skipped: false };
  } catch (e) {
    const dur = Date.now() - t0;
    record("vacuum", dur, false, (e as Error).message);
    return { ok: false, detail: (e as Error).message, duration_ms: dur, skipped: false };
  }
}

const HYGIENE_INTERVAL_MS = 600_000; // 10 минут
let hygieneTimer: ReturnType<typeof setInterval> | null = null;

/** Расписание: PASSIVE-checkpoint каждые 10м (не блокирует писателей). Идемпотентно. */
export function startHygieneLoop(): void {
  if (hygieneTimer) return;
  try { hygieneCheckpoint("PASSIVE"); } catch { /* первый прогон не валим */ }
  hygieneTimer = setInterval(() => {
    try { hygieneCheckpoint("PASSIVE"); } catch { /* телеметрия не ломает цикл */ }
  }, HYGIENE_INTERVAL_MS);
}

/** Вердикт механики ME30 (D4): WORKS — checkpoint реально выполнялся и WAL под контролем. */
export function hygieneVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  const st = hygieneStatus();
  const ck = st.last_runs.find((r) => r.op === "checkpoint" && r.ok);
  if (!ck) return { verdict: "CAVEAT", evidence: "checkpoint ни разу не выполнялся (startHygieneLoop на boot или POST /db/hygiene {op:checkpoint})" };
  const wal = st.db.wal_mb;
  const frag = st.db.freelist_pct;
  return {
    verdict: "WORKS",
    evidence: `journal=${st.db.journal_mode}, wal=${wal}MB, freelist=${frag}%, db=${st.db.file_mb}MB, индексов=${st.indexes.length}, last checkpoint ${ck.duration_ms}ms (${ck.age_s}s назад); GET /db/hygiene`,
  };
}
