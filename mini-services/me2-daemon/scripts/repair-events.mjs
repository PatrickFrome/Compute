// events.jsonl repair after the hot-reload orphan race (2026-09-26 R83-MIRROR).
// Evidence: bun --hot re-evaluated mirror.ts generations while their 15s
// boot-sync timers were pending → orphaned timers appended MIRROR_SYNC events
// from stale in-memory views → duplicate seq lines (399, 401).
// Canonical view = the running daemon's in-memory chain (mirrored to Supabase
// as rows 90013993..90014394 — bindings match this view).
// Repair: drop the 2 orphan lines, re-append them at the END with resequenced
// seq (403, 404) + recovery note (evidence preserved, chain stays hash-valid).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const FILE = new URL("../data/events.jsonl", import.meta.url).pathname;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function evHash(e) {
  return sha256(JSON.stringify({
    seq: e.seq, ts: e.ts, type: e.type, actor: e.actor, subject: e.subject,
    payload: e.payload, prev_hash: e.prev_hash, daemon_version: e.daemon_version,
  }));
}

const lines = readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim());
const events = lines.map((l) => JSON.parse(l));

// ---- 1. detect duplicate-seq orphan lines (chain breaks at them)
const seen = new Set();
const orphans = [];
const canonical = [];
for (const e of events) {
  if (seen.has(e.seq)) {
    orphans.push(e); // later line with already-used seq = orphan append
  } else {
    seen.add(e.seq);
    canonical.push(e);
  }
}
console.log(`lines=${lines.length} canonical=${canonical.length} orphans=${orphans.length}`);
if (orphans.length === 0) { console.log("nothing to repair"); process.exit(0); }

// ---- 2. validate canonical chain 1..N (hash + prev_hash + seq contiguity)
let prev = "0".repeat(64);
for (let i = 0; i < canonical.length; i++) {
  const e = canonical[i];
  if (e.seq !== i + 1) throw new Error(`canonical seq gap at ${i}: ${e.seq}`);
  if (e.prev_hash !== prev) throw new Error(`canonical prev_hash mismatch at ${e.seq}`);
  if (evHash(e) !== e.hash) throw new Error(`canonical hash mismatch at ${e.seq}`);
  prev = e.hash;
}
console.log(`canonical chain 1..${canonical.length} VALID (last hash ${prev.slice(0, 12)}…)`);

// ---- 3. re-append orphans resequenced at the end, evidence preserved
const out = canonical.map((e) => JSON.stringify(e));
let tailHash = canonical[canonical.length - 1].hash;
for (const o of orphans) {
  const ev = {
    seq: out.length + 1,
    ts: o.ts,
    type: o.type,
    actor: o.actor,
    subject: o.subject,
    payload: {
      ...o.payload,
      recovery_note: `resequenced after hot-reload orphan race (was duplicate seq ${o.seq}); original evidence preserved; see worklog R83-MIRROR`,
    },
    prev_hash: tailHash,
    daemon_version: o.daemon_version,
  };
  ev.hash = evHash(ev);
  out.push(JSON.stringify(ev));
  tailHash = ev.hash;
  console.log(`resequenced orphan (was #${o.seq} ${o.type} ts ${o.ts.slice(11, 19)}) → #${ev.seq}`);
}

// ---- 4. atomic write (tmp + rename), backup first
const backup = FILE + ".pre-repair.bak";
if (!existsSync(backup)) {
  writeFileSync(backup, lines.join("\n") + "\n");
}
const tmp = FILE + `.repair-${randomBytes(4).toString("hex")}.tmp`;
writeFileSync(tmp, out.join("\n") + "\n");
renameSync(tmp, FILE);
console.log(`repaired: ${out.length} lines; backup at ${backup.split("/").pop()}`);

// ---- 5. verify the repaired file
const check = readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
let p = "0".repeat(64);
let bad = 0;
for (let i = 0; i < check.length; i++) {
  const e = check[i];
  if (e.seq !== i + 1 || e.prev_hash !== p || evHash(e) !== e.hash) { bad++; console.log(`FAIL at #${e.seq}`); }
  p = e.hash;
}
console.log(bad === 0 ? `REPAIRED CHAIN VALID: 1..${check.length}` : `REPAIR FAILED: ${bad} violations`);
process.exit(bad === 0 ? 0 : 1);
