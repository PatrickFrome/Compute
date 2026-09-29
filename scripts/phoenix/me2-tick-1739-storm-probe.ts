// ME2-TICK-20260928-1739: NEW_TAB storm + task retry-loop diagnosis (read-only, SELECT only)
import { Database } from "bun:sqlite";

const db = new Database("/home/z/my-project/mini-services/me2-daemon/data/me2.db", { readonly: true });

// 1) TASK_* events since 09:32 — who re-leases failed tasks?
try {
  const rows = db.prepare(
    `SELECT ts, type AS kind, substr(data,1,200) AS p FROM events
     WHERE ts >= '2026-09-28T09:32' AND (type LIKE 'TASK_%' OR type LIKE 'STEP_%')
     ORDER BY ts ASC LIMIT 40`
  ).all();
  console.log(`=== TASK/STEP events since 09:32Z: ${rows.length} ===`);
  for (const r of rows) console.log(`${r.ts} | ${r.kind} | ${r.p}`);
} catch (e) { console.log("events failed:", (e as Error).message); }

// 2) fleet-e2e task states now
try {
  const rows = db.prepare(
    `SELECT id, title, status, substr(error,1,120) AS err, attempts FROM tasks WHERE title LIKE '%Fleet-e2e%' ORDER BY rowid DESC LIMIT 6`
  ).all();
  console.log(`\n=== fleet-e2e tasks: ${rows.length} ===`);
  for (const r of rows) console.log(JSON.stringify(r));
} catch (e) { console.log("e2e tasks failed:", (e as Error).message); }

// 3) all non-terminal tasks in queue
try {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS c FROM tasks WHERE status NOT IN ('done','failed','cancelled') GROUP BY status`
  ).all();
  console.log(`\n=== live task queue: ===`);
  for (const r of rows) console.log(`${r.status}: ${r.c}`);
  const rows2 = db.prepare(
    `SELECT id, title, status, attempts, substr(updated_at,1,19) AS upd FROM tasks WHERE status IN ('queued','ready','leased','running') ORDER BY updated_at DESC LIMIT 10`
  ).all();
  for (const r of rows2) console.log(JSON.stringify(r));
} catch (e) { console.log("queue failed:", (e as Error).message); }

// 4) TASK_FAILED with tab_capacity — frequency in last hour
try {
  const rows = db.prepare(
    `SELECT ts, substr(data,1,150) AS p FROM events
     WHERE ts >= '2026-09-28T09:00' AND type='TASK_FAILED' AND data LIKE '%tab_capacity%'
     ORDER BY ts ASC LIMIT 15`
  ).all();
  console.log(`\n=== TASK_FAILED tab_capacity since 09:00Z: ${rows.length} ===`);
  for (const r of rows) console.log(`${r.ts} | ${r.p}`);
} catch (e) { console.log("failed-cap failed:", (e as Error).message); }

db.close();
