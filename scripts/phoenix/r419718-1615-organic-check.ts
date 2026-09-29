// R419718-1615: organic reviewer-run probe via daemon DB (read-only)
// Job 419718 @16:15 tick, step R2 — no daemon mutations, SELECT only.
import { Database } from "bun:sqlite";

const db = new Database("/home/z/my-project/mini-services/me2-daemon/data/me2.db", { readonly: true });

// 1) reviewer / fleet-channel spans & events since 15:30 tick
const q1 = `
  SELECT ts, type AS kind, substr(data,1,300) AS payload_head
  FROM events
  WHERE (type LIKE '%REVIEW%' OR type LIKE '%CHANNEL%' OR data LIKE '%fleet_readback%' OR data LIKE '%channel_code%' OR data LIKE '%FleetChannelError%')
    AND ts >= '2026-09-28T15:30'
  ORDER BY ts DESC LIMIT 30`;
try {
  const rows = db.prepare(q1).all();
  console.log(`=== REVIEW/CHANNEL events since 15:30: ${rows.length} ===`);
  for (const r of rows) console.log(`${r.ts} | ${r.kind} | ${r.payload_head}`);
} catch (e) {
  console.log("events query failed:", (e as Error).message);
  const cols = db.prepare("PRAGMA table_info(events)").all();
  console.log("events cols:", JSON.stringify(cols));
}

// 2) reviewer-related spans in eval table (span store)
try {
  const rows2 = db.prepare(`
    SELECT ts, substr(data,1,260) AS p FROM events
    WHERE data LIKE '%review%' AND ts >= '2026-09-28T15:30'
    ORDER BY ts DESC LIMIT 20`).all();
  console.log(`\n=== review-mention events since 15:30: ${rows2.length} ===`);
  for (const r of rows2) console.log(`${r.ts} | ${r.p}`);
} catch (e) { console.log("review events failed:", (e as Error).message); }

// 3) latest TASK_REVIEWED / TASK_REVIEW_FAILED ever
try {
  const rows3 = db.prepare(`
    SELECT ts, type AS kind, substr(data,1,200) AS p FROM events
    WHERE type IN ('TASK_REVIEWED','TASK_REVIEW_FAILED')
    ORDER BY ts DESC LIMIT 8`).all();
  console.log(`\n=== latest TASK_REVIEW* (any time): ${rows3.length} ===`);
  for (const r of rows3) console.log(`${r.ts} | ${r.kind} | ${r.p}`);
} catch (e) { console.log("task review failed:", (e as Error).message); }

// 4) commands table: fleet channel usage
try {
  const cols4 = db.prepare("PRAGMA table_info(commands)").all().map((c: any) => c.name);
  console.log(`\ncommands cols: ${cols4.join(",")}`);
  const rows4 = db.prepare(`
    SELECT * FROM commands ORDER BY rowid DESC LIMIT 5`).all();
  console.log(`latest 5 commands:`);
  for (const r of rows4) console.log(JSON.stringify(r).slice(0, 260));
} catch (e) { console.log("commands failed:", (e as Error).message); }

// 5) daemon start & version from meta
try {
  const rows5 = db.prepare(`SELECT key, substr(value,1,120) AS v FROM meta ORDER BY key LIMIT 30`).all();
  console.log(`\n=== meta ===`);
  for (const r of rows5) console.log(`${r.key} = ${r.v}`);
} catch (e) { console.log("meta failed:", (e as Error).message); }

db.close();
