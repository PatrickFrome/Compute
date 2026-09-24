/**
 * ME-BROWSER-EFFECT (R23) — порт effect-эпистемологии легаси-браузера
 * (a2-capsule/browser_context_deep_analysis §7.1: CONFIRMED / NO_EFFECT_PROVEN /
 * FAILED_PRE_EFFECT / FENCED / AMBIGUOUS + one-attempt durable fences).
 *
 * Ключевые семантические правила легаси (сохранены дословно):
 *  - NO_EFFECT_PROVEN — это ДОКАЗАННОЕ отсутствие эффекта (ревизия не сменилась):
 *    повтор безопасен и легитимен → fence НЕ ставится;
 *  - FAILED_PRE_EFFECT — действие не ушло (ошибка до эффекта): повтор безопасен;
 *  - AMBIGUOUS — ревизия сменилась, но наша цель исчезла: неизвестно, наш ли это
 *    эффект; ПОВТОР МОЖЕТ УДВОИТЬ ЭФФЕКТ → durable one-attempt fence
 *    (аналог markAmbiguousContinuationAttempt: барьер ДО физического повтора);
 *  - FENCED — повтор отвергнут барьером; снимает только оператор (zero-authority).
 * «Никогда не разменивать exact identity / durable fence / AMBIGUOUS на liveness».
 */
import { db, emit } from "../store";
import { recordSpan } from "./otel";

db.exec(`
CREATE TABLE IF NOT EXISTS effect_fences (
  effect_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cleared_at INTEGER,
  cleared_note TEXT
);
CREATE TABLE IF NOT EXISTS effect_verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effect_key TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '{}',
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_effect_verdicts_at ON effect_verdicts(at);
`);

export type EffectStatus =
  | "CONFIRMED"
  | "NO_EFFECT_PROVEN"
  | "FAILED_PRE_EFFECT"
  | "FENCED"
  | "AMBIGUOUS";

export interface EffectVerdict {
  status: EffectStatus;
  fenced_now: boolean;
  evidence: Record<string, unknown>;
}

/** Durable fence жива? (не cleared). */
export function fenceCheck(effectKey: string): { fenced: boolean; reason: string | null; created_at: number | null } {
  const row = db
    .query(`SELECT reason, created_at FROM effect_fences WHERE effect_key=? AND cleared_at IS NULL`)
    .get(effectKey) as { reason: string; created_at: number } | undefined;
  return row ? { fenced: true, reason: row.reason, created_at: row.created_at } : { fenced: false, reason: null, created_at: null };
}

/** One-attempt durable fence (порт markAmbiguousContinuationAttempt): ставится ДО того,
 *  как эффект будет повторён; повтор того же effect_key отвергается (FENCED). */
export function fenceSet(effectKey: string, reason: string): void {
  db.query(`INSERT INTO effect_fences (effect_key, reason, created_at) VALUES (?,?,?)
    ON CONFLICT(effect_key) DO UPDATE SET reason=excluded.reason, created_at=excluded.created_at, cleared_at=NULL, cleared_note=NULL`)
    .run(effectKey, reason.slice(0, 200), Date.now());
  emit("EFFECT_FENCED", { effect_key: effectKey, reason }, null, null);
}

/** Снятие барьера — только оператор (zero-authority; из UI/REST оператором вручную). */
export function fenceClear(effectKey: string, note?: string): boolean {
  const r = db.query(`UPDATE effect_fences SET cleared_at=?, cleared_note=? WHERE effect_key=? AND cleared_at IS NULL`)
    .run(Date.now(), note ? String(note).slice(0, 200) : null, effectKey);
  const ok = Number(r.changes) > 0;
  if (ok) emit("EFFECT_UNFENCED", { effect_key: effectKey, note: note ?? null }, null, null);
  return ok;
}

export function fenceList(limit = 50): Array<{ effect_key: string; reason: string; created_at: number; cleared_at: number | null; cleared_note: string | null }> {
  return db.query(`SELECT effect_key, reason, created_at, cleared_at, cleared_note FROM effect_fences ORDER BY created_at DESC LIMIT ?`)
    .all(Math.min(Math.max(limit, 1), 200)) as never;
}

export function verdictStats(): { total: number; by_status: Record<string, number>; fences_active: number } {
  const rows = db.query(`SELECT status, COUNT(*) AS n FROM effect_verdicts GROUP BY status`).all() as Array<{ status: string; n: number }>;
  const by: Record<string, number> = {};
  let total = 0;
  for (const r of rows) { by[r.status] = Number(r.n); total += Number(r.n); }
  const f = db.query(`SELECT COUNT(*) AS n FROM effect_fences WHERE cleared_at IS NULL`).get() as { n: number };
  return { total, by_status: by, fences_active: Number(f.n) };
}

/**
 * Вердикт эффекта по доказательствам после действия:
 *  - preOk=false          → FAILED_PRE_EFFECT (действие не ушло);
 *  - revisionChanged && targetAlive → CONFIRMED;
 *  - revisionChanged && !targetAlive → AMBIGUOUS (+ durable fence на effectKey);
 *  - !revisionChanged     → NO_EFFECT_PROVEN (повтор безопасен).
 */
export function effectVerdict(input: {
  effectKey: string;
  preOk: boolean;
  revisionChanged: boolean;
  targetAlive: boolean;
  urlChanged?: boolean;
  hadTarget?: boolean;
  preError?: string;
  evidence?: Record<string, unknown>;
}): EffectVerdict {
  const t0 = Date.now();
  const urlChanged = Boolean(input.urlChanged);
  const hadTarget = Boolean(input.hadTarget);
  let status: EffectStatus;
  const ev: Record<string, unknown> = { ...(input.evidence ?? {}) };

  const pre = fenceCheck(input.effectKey);
  if (pre.fenced) {
    status = "FENCED";
    ev.fence_reason = pre.reason;
    ev.fenced_since = pre.created_at;
  } else if (!input.preOk) {
    status = "FAILED_PRE_EFFECT";
    ev.pre_error = (input.preError ?? "pre-effect failure").slice(0, 200);
  } else if (input.revisionChanged && (urlChanged || input.targetAlive || !hadTarget)) {
    // смена URL = доказанная навигация; живая цель = доказанный локальный эффект;
    // press/действие без цели + смена ревизии = эффект подтверждён
    status = "CONFIRMED";
  } else if (input.revisionChanged && hadTarget && !urlChanged) {
    // ревизия сменилась, но СВОЯ цель исчезла без навигации: неизвестно, наш ли
    // это эффект; ПОВТОР МОЖЕТ УДВОИТЬ → one-attempt durable fence
    status = "AMBIGUOUS";
    fenceSet(input.effectKey, "ambiguous_outcome_target_vanished");
  } else {
    status = "NO_EFFECT_PROVEN";
  }
  ev.status = status;

  try {
    db.query(`INSERT INTO effect_verdicts (effect_key, status, evidence, at) VALUES (?,?,?,?)`)
      .run(input.effectKey, status, JSON.stringify(ev).slice(0, 800), t0);
    db.query(`DELETE FROM effect_verdicts WHERE id NOT IN (SELECT id FROM effect_verdicts ORDER BY id DESC LIMIT 500)`).run();
  } catch { /* вердикт-лог не критичен */ }
  emit("EFFECT_VERDICTED", { effect_key: input.effectKey, status, revision_changed: input.revisionChanged, target_alive: input.targetAlive }, null, null);
  recordSpan("effect.verdict", { "me2.status": status, "me2.fenced": status === "FENCED" || status === "AMBIGUOUS" }, t0);
  return { status, fenced_now: status === "AMBIGUOUS", evidence: ev };
}
