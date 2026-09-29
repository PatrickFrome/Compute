// R419718-1711: organic executor E2E probe (read-only, SELECT only)
// Tick 419718-1711: swarm (1645) migrated worker.ts → fleetAskHistory and enqueued
// "Fleet-e2e-2: файл-маячок". This probe verifies the ORGANIC run state: task row,
// lease, step events, fleet-channel usage, beacon file. No mutations.
import { Database } from "bun:sqlite";

const db = new Database("/home/z/my-project/mini-services/me2-daemon/data/me2.db", { readonly: true });
const BOOT = "2026-09-28T09:13"; // daemon incarnation boot 09:13:59Z

// 1) tasks table shape + the Fleet-e2e task
try {
  const cols = db.prepare("PRAGMA table_info(tasks)").all().map((c: any) => c.name);
  console.log(`tasks cols: ${cols.join(",")}`);
  const rows = db.prepare(
    `SELECT * FROM tasks WHERE title LIKE '%Fleet-e2e%' OR created_at >= '${BOOT}' ORDER BY rowid DESC LIMIT 6`
  ).all();
  console.log(`\n=== tasks (Fleet-e2e* or since boot): ${rows.length} ===`);
  for (const r of rows) console.log(JSON.stringify(r).slice(0, 420));
} catch (e) { console.log("tasks failed:", (e as Error).message); }

// 2) worker lifecycle events since boot
try {
  const rows = db.prepare(
    `SELECT ts, type AS kind, substr(data,1,300) AS p FROM events
     WHERE ts >= '${BOOT}' AND (type LIKE 'TASK_%' OR type LIKE 'STEP_%' OR type LIKE 'FLEET_%' OR data LIKE '%fleet%' OR data LIKE '%FleetChannel%')
     ORDER BY ts DESC LIMIT 40`
  ).all();
  console.log(`\n=== TASK/STEP/FLEET events since boot: ${rows.length} ===`);
  for (const r of rows) console.log(`${r.ts} | ${r.kind} | ${r.p}`);
} catch (e) { console.log("events failed:", (e as Error).message); }

// 3) pool agents status
try {
  const rows = db.prepare(`SELECT * FROM agents ORDER BY rowid DESC LIMIT 6`).all();
  console.log(`\n=== agents (latest 6): ${rows.length} ===`);
  for (const r of rows) console.log(JSON.stringify(r).slice(0, 300));
} catch (e) { console.log("agents failed:", (e as Error).message); }

// 4) spans mentioning fleetAskHistory / fleet_chat since boot
try {
  const rows = db.prepare(
    `SELECT ts, substr(data,1,260) AS p FROM spans
     WHERE ts >= '${BOOT}' AND (data LIKE '%fleet%' OR name LIKE '%fleet%' OR name LIKE '%chat%')
     ORDER BY ts DESC LIMIT 15`
  ).all();
  console.log(`\n=== fleet spans since boot: ${rows.length} ===`);
  for (const r of rows) console.log(`${r.ts} | ${r.p}`);
} catch (e) { console.log("spans failed:", (e as Error).message); }

db.close();
