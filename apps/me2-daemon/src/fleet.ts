/**
 * ME6 FLEET (R19) — порт fleet-механик старой системы (M2 elastic governor, M3 task cycle,
 * M8 device identity/transport-proof, M10 keepalive).
 *
 * Локальный-first реестр нод (SQLite):
 *  - BOUND → ACTIVE только при наличии proof (порт M8 transport-proof: доказательство привязки
 *    до активации; «first proof is ADVISORY, never MUTATING» — proof не даёт authority);
 *  - freshness считается от last_seen, НЕ хранится: ACTIVE <45s (порт 45s-контракта),
 *    STALE <300s, LOST ≥300s (урок CP-W1: heartbeat ≠ liveness — считаем от факта);
 *  - self-node daemon бьётся каждые 15s (liveness-проекция);
 *  - capacity: active/ceiling 64 (порт A2_FLEET_TAB_CEILING, теперь ноды а не вкладки);
 *  - backlog: READY-задачи шины (fleet governor был backlog-driven).
 */
import { db, emit, nowIso } from "../store";
import { listTasks } from "../store";

db.exec(`
CREATE TABLE IF NOT EXISTS fleet_nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'agent',
  state TEXT NOT NULL DEFAULT 'BOUND',
  caps TEXT NOT NULL DEFAULT '{}',
  meta TEXT NOT NULL DEFAULT '{}',
  proof TEXT,
  beats INTEGER NOT NULL DEFAULT 1,
  joined_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fleet_seen ON fleet_nodes(last_seen);
`);

export type FleetState = "BOUND" | "ACTIVE" | "STALE" | "LOST";

export interface FleetNodeRow {
  id: string; kind: string; state: string; caps: string; meta: string;
  proof: string | null; beats: number; joined_at: number; last_seen: number;
}

export function fleetBeat(input: {
  id: string; kind?: string; caps?: Record<string, unknown>; meta?: Record<string, unknown>; proof?: string;
}): FleetNodeRow & { freshness: FleetState; verified: boolean } {
  const id = String(input.id ?? "").trim().slice(0, 80);
  if (!id) throw new Error("id_required");
  const kind = String(input.kind ?? "agent").slice(0, 24);
  const caps = JSON.stringify(input.caps ?? {}).slice(0, 1000);
  const meta = JSON.stringify(input.meta ?? {}).slice(0, 1000);
  const proof = input.proof ? String(input.proof).slice(0, 200) : null;
  const now = Date.now();
  const existing = db.query(`SELECT * FROM fleet_nodes WHERE id=?`).get(id) as FleetNodeRow | undefined;
  if (existing) {
    // BOUND → ACTIVE только через proof (M8); однажды ACTIVE сохраняет состояние
    const nextState = existing.state === "ACTIVE" || proof ? "ACTIVE" : existing.state;
    db.query(`UPDATE fleet_nodes SET kind=?, caps=?, meta=?, proof=COALESCE(?,proof), state=?, beats=beats+1, last_seen=? WHERE id=?`)
      .run(kind, caps, meta, proof, nextState, now, id);
  } else {
    db.query(`INSERT INTO fleet_nodes (id,kind,state,caps,meta,proof,beats,joined_at,last_seen) VALUES (?,?,?,?,?,?,1,?,?)`)
      .run(id, kind, proof ? "ACTIVE" : "BOUND", caps, meta, proof, now, now);
    emit("FLEET_JOINED", { id, kind, verified: Boolean(proof) });
  }
  const row = db.query(`SELECT * FROM fleet_nodes WHERE id=?`).get(id) as FleetNodeRow;
  return { ...row, freshness: freshnessOf(row.last_seen), verified: Boolean(row.proof) };
}

function freshnessOf(lastSeen: number): FleetState {
  const age = Date.now() - lastSeen;
  if (age < 45_000) return "ACTIVE";
  if (age < 300_000) return "STALE";
  return "LOST";
}

export function fleetList(): {
  ok: true; nodes: Array<FleetNodeRow & { freshness: FleetState; verified: boolean; age_s: number }>;
  capacity: { active: number; stale: number; lost: number; ceiling: number; verified: number };
  backlog: { ready: number; running: number };
  self: (FleetNodeRow & { freshness: FleetState }) | null;
} {
  const rows = db.query(`SELECT * FROM fleet_nodes ORDER BY joined_at`).all() as FleetNodeRow[];
  const nodes = rows.map((r) => ({
    ...r,
    freshness: freshnessOf(r.last_seen),
    verified: Boolean(r.proof),
    age_s: Math.round((Date.now() - r.last_seen) / 1000),
    reliability: reliabilityOf(r.id),
  }));
  const self = nodes.find((n) => n.kind === "daemon") ?? null;
  const ready = listTasks().filter((t) => t.status === "READY").length;
  const running = listTasks().filter((t) => t.status === "RUNNING").length;
  return {
    ok: true,
    nodes,
    capacity: {
      active: nodes.filter((n) => n.freshness === "ACTIVE").length,
      stale: nodes.filter((n) => n.freshness === "STALE").length,
      lost: nodes.filter((n) => n.freshness === "LOST").length,
      ceiling: 64,
      verified: nodes.filter((n) => n.verified).length,
    },
    backlog: { ready, running },
    self,
  };
}

/** Self-node: daemon сам в реестре — liveness-проекция (CP-W1). */
export function fleetSelfTick(version: string): void {
  try {
    fleetBeat({
      id: "node_daemon",
      kind: "daemon",
      proof: "self",
      caps: { version, lanes: 4 },
      meta: { pid: process.pid },
    });
  } catch { /* noop */ }
}

// ── R23: Outcome River + reliability-ordered retirement (порт T3-9 легаси) ──
// Каждая нода пишет исходы (ok = беат в ACTIVE-окне, fail = деградация freshness).
// Retirement при давлении на ёмкость — по НАИХУДШЕЙ надёжности, с grace-окном после
// недавнего отказа (не казнить только что споткнувшегося: «grace before retire»).

db.exec(`
CREATE TABLE IF NOT EXISTS fleet_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  note TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fleet_outcomes_node ON fleet_outcomes(node_id, at);
`);

const OUTCOME_CAP = 4000;
const GRACE_AFTER_FAIL_MS = 120_000;

/** Записать исход ноды (ok/fail). Outcome River — только добавление, капится. */
export function fleetOutcome(nodeId: string, ok: boolean, note?: string): void {
  db.query(`INSERT INTO fleet_outcomes (node_id, outcome, note, at) VALUES (?,?,?,?)`)
    .run(nodeId, ok ? "ok" : "fail", note ? String(note).slice(0, 120) : null, Date.now());
  db.query(`DELETE FROM fleet_outcomes WHERE id <= (SELECT MAX(id) FROM fleet_outcomes) - ?`).run(OUTCOME_CAP);
}

export interface Reliability {
  ok: number; fail: number; ratio: number;
  consecutive_fails: number; last_fail_at: number | null;
  in_grace: boolean; grade: "solid" | "usable" | "shaky" | "poor" | "unknown";
}

/** Надёжность ноды по последним исходам ( Outcome River → score). */
export function reliabilityOf(nodeId: string, window = 50): Reliability {
  const rows = db.query(`SELECT outcome, at FROM fleet_outcomes WHERE node_id=? ORDER BY at DESC LIMIT ?`)
    .all(nodeId, window) as Array<{ outcome: string; at: number }>;
  if (!rows.length) return { ok: 0, fail: 0, ratio: 1, consecutive_fails: 0, last_fail_at: null, in_grace: false, grade: "unknown" };
  const ok = rows.filter((r) => r.outcome === "ok").length;
  const fail = rows.length - ok;
  let consecutive = 0;
  for (const r of rows) { if (r.outcome !== "ok") consecutive++; else break; }
  const lastFail = rows.find((r) => r.outcome === "fail")?.at ?? null;
  const ratio = rows.length ? ok / rows.length : 1;
  const inGrace = lastFail !== null && Date.now() - lastFail < GRACE_AFTER_FAIL_MS;
  const grade: Reliability["grade"] =
    rows.length < 3 ? "unknown" : ratio >= 0.95 ? "solid" : ratio >= 0.75 ? "usable" : ratio >= 0.5 ? "shaky" : "poor";
  return { ok, fail, ratio, consecutive_fails: consecutive, last_fail_at: lastFail, in_grace: inGrace, grade };
}

const _lastFreshness = new Map<string, FleetState>();

/** ТикOutcome River: деградация freshness = fail-исход; давление на ёмкость = retire worst-first. */
export function fleetTick(): { recorded: number; retired: Array<{ id: string; grade: string }> } {
  let recorded = 0;
  const nodes = db.query(`SELECT * FROM fleet_nodes`).all() as FleetNodeRow[];
  for (const n of nodes) {
    const fresh = freshnessOf(n.last_seen);
    const prev = _lastFreshness.get(n.id);
    if (prev && prev !== fresh && (fresh === "STALE" || fresh === "LOST")) {
      fleetOutcome(n.id, false, `freshness ${prev}→${fresh}`);
      recorded++;
    } else if (prev && prev !== "ACTIVE" && fresh === "ACTIVE") {
      fleetOutcome(n.id, true, `freshness ${prev}→ACTIVE`);
      recorded++;
    }
    _lastFreshness.set(n.id, fresh);
  }
  // давление на ёмкость: ACTIVE сверх потолка → уволить худших по надёжности (grace защищает)
  const active = nodes.filter((n) => freshnessOf(n.last_seen) === "ACTIVE" && n.kind !== "daemon");
  const ceiling = 64;
  const retired: Array<{ id: string; grade: string }> = [];
  if (active.length > ceiling) {
    const ordered = active
      .map((n) => ({ n, rel: reliabilityOf(n.id) }))
      .filter((x) => !x.rel.in_grace && x.rel.grade !== "unknown")
      .sort((a, b) => a.rel.ratio - b.rel.ratio);
    for (const x of ordered.slice(0, active.length - ceiling)) {
      db.query(`DELETE FROM fleet_nodes WHERE id=?`).run(x.n.id);
      emit("FLEET_RETIRED", { id: x.n.id, reason: "capacity_pressure_worst_reliability", grade: x.rel.grade, ratio: x.rel.ratio });
      retired.push({ id: x.n.id, grade: x.rel.grade });
    }
  }
  return { recorded, retired };
}

/** Счётчик исходов (для evidence-строк механик). */
export function fleetOutcomeCount(): { total: number; fails: number } {
  const t = db.query(`SELECT COUNT(*) AS n FROM fleet_outcomes`).get() as { n: number };
  const f = db.query(`SELECT COUNT(*) AS n FROM fleet_outcomes WHERE outcome='fail'`).get() as { n: number };
  return { total: Number(t.n), fails: Number(f.n) };
}

/** GC: LOST-ноды старше 24ч удаляются (реестр не растёт бесконечно). */
export function fleetGc(): number {
  const cutoff = Date.now() - 24 * 3_600_000;
  const r = db.query(`DELETE FROM fleet_nodes WHERE last_seen<? AND id!='node_daemon'`).run(cutoff);
  return Number(r.changes);
}

export const FLEET_TS = nowIso;
