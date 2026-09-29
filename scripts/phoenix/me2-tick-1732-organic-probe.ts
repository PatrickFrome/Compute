// ME2-TICK-1732: organic E2E-3 + tab_capacity analysis (read-only, SELECT only)
// Verifies swarm commit 034ff412 effects: did any executor task SUCCEED organically
// (beacon file criterion)? How severe is tab_capacity_exceeded (their documented blocker)?
import { Database } from "bun:sqlite";

const db = new Database("/home/z/my-project/mini-services/me2-daemon/data/me2.db", { readonly: true });
const BOOT = "2026-09-28T09:13";

// 1) task outcomes since swarm commit (09:32 UTC)
try {
  const rows = db.prepare(
    `SELECT ts, type AS kind, substr(data,1,220) AS p FROM events
     WHERE ts >= '2026-09-28T09:32' AND (type LIKE 'TASK_%' OR type LIKE 'FLEET_%' OR type LIKE 'STEP_%')
     ORDER BY ts ASC LIMIT 30`
  ).all();
  console.log(`=== TASK/FLEET events since swarm commit 09:32: ${rows.length} ===`);
  for (const r of rows) console.log(`${r.ts} | ${r.kind} | ${r.p}`);
} catch (e) { console.log("events failed:", (e as Error).message); }

// 2) tab_capacity_exceeded: frequency + first/last occurrence
try {
  const rows = db.prepare(
    `SELECT ts, substr(data,1,180) AS p FROM events
     WHERE data LIKE '%tab_capacity%' ORDER BY ts ASC LIMIT 10`
  ).all();
  console.log(`\n=== tab_capacity events (first 10): ${rows.length} ===`);
  for (const r of rows) console.log(`${r.ts} | ${r.p}`);
  const cnt = db.prepare(
    `SELECT COUNT(*) AS c FROM events WHERE data LIKE '%tab_capacity%'`
  ).get() as any;
  console.log(`total tab_capacity mentions: ${cnt.c}`);
} catch (e) { console.log("capacity failed:", (e as Error).message); }

// 3) NEW_TAB vs CLOSE_TAB command balance (leak check)
try {
  const rows = db.prepare(
    `SELECT action, status, COUNT(*) AS c FROM commands
     WHERE action IN ('NEW_TAB','CLOSE_TAB') GROUP BY action, status ORDER BY action`
  ).all();
  console.log(`\n=== NEW_TAB/CLOSE_TAB balance (all time): ===`);
  for (const r of rows) console.log(`${r.action} ${r.status}: ${r.c}`);
} catch (e) { console.log("tab balance failed:", (e as Error).message); }

// 4) fleet-e2e tasks state
try {
  const rows = db.prepare(
    `SELECT id, title, status, error, steps FROM tasks WHERE title LIKE '%Fleet-e2e%' ORDER BY rowid DESC LIMIT 5`
  ).all();
  console.log(`\n=== fleet-e2e tasks: ===`);
  for (const r of rows) console.log(JSON.stringify(r).slice(0, 260));
} catch (e) { console.log("e2e tasks failed:", (e as Error).message); }

db.close();
