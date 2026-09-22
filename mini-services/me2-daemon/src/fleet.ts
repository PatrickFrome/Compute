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

/** GC: LOST-ноды старше 24ч удаляются (реестр не растёт бесконечно). */
export function fleetGc(): number {
  const cutoff = Date.now() - 24 * 3_600_000;
  const r = db.query(`DELETE FROM fleet_nodes WHERE last_seen<? AND id!='node_daemon'`).run(cutoff);
  return Number(r.changes);
}

export const FLEET_TS = nowIso;
