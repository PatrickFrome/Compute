// Independent MIRROR CONTRACT v1 verifier — reads ALL our rows back from
// Supabase me2_event_mirror_h205f22 and verifies, without trusting the daemon:
//   1. seq contiguity from anchor.seq + 1
//   2. prev_hash chaining: first row → anchor.hash, each row → previous hash
//   3. row hash recomputation from the documented formula
//   4. cross-binding: payload.local_seq / local_hash match the local chain
//      events (hash + content equality)
// Exit code 0 = contract holds; 1 = violation (printed).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const ANCHOR_SEQ = 90013992;
const ANCHOR_HASH = "77330b9f779a4a60041cfe19d49b9f6b9a63952cf318693b34b062e18dcd8eb1";

const txt = readFileSync("/home/z/.a2/supabase-cloud.env", "utf8");
const url = /^SUPABASE_URL=(.+)$/m.exec(txt)[1].trim();
const key = /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(txt)[1].trim();

async function supa(path) {
  const res = await fetch(`${url}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// local chain (hash-chain verified separately by daemon /eventlog/verify;
// here we load raw for binding comparison)
const local = {};
for (const line of readFileSync(
  new URL("../data/events.jsonl", import.meta.url), "utf8"
).split("\n")) {
  const t = line.trim();
  if (!t) continue;
  const e = JSON.parse(t);
  local[e.seq] = e;
}

// fetch all our rows (paged, ascending)
const rows = [];
let from = ANCHOR_SEQ;
for (;;) {
  const page = await supa(
    `/rest/v1/me2_event_mirror_h205f22?select=seq,ts,type,actor,subject,payload,prev_hash,hash,daemon_version&seq=gt.${from}&order=seq.asc&limit=1000`
  );
  if (!Array.isArray(page) || page.length === 0) break;
  rows.push(...page);
  from = page[page.length - 1].seq;
  if (page.length < 1000) break;
}

console.log(`fetched ${rows.length} mirror rows`);
let fail = 0;
let prevHash = ANCHOR_HASH;
let prevSeq = ANCHOR_SEQ;
for (const r of rows) {
  const where = `#${r.seq}`;
  if (r.seq !== prevSeq + 1) { console.log(`FAIL seq-gap ${where}: expected ${prevSeq + 1}`); fail++; }
  if (r.prev_hash !== prevHash) { console.log(`FAIL prev_hash ${where}`); fail++; }
  // documented formula: ts canonicalized, payload is the exact string scalar
  const recomputed = sha256(JSON.stringify({
    seq: r.seq,
    ts: new Date(r.ts).toISOString(),
    type: r.type,
    actor: r.actor,
    subject: r.subject ?? null,
    payload: r.payload,
    prev_hash: r.prev_hash,
    daemon_version: r.daemon_version,
  }));
  if (recomputed !== r.hash) {
    console.log(`FAIL row-hash ${where}: stored ${r.hash.slice(0, 16)}… recomputed ${recomputed.slice(0, 16)}…`);
    fail++;
  }
  // cross-binding
  let binding = null;
  if (typeof r.payload === "string") {
    try {
      const obj = JSON.parse(r.payload);
      if (obj?.mirror === "me2-mirror-v1") binding = obj;
    } catch { /* not ours */ }
  }
  if (!binding) { console.log(`FAIL binding ${where}: no me2-mirror-v1 marker`); fail++; continue; }
  const le = local[binding.local_seq];
  if (!le) { console.log(`FAIL binding ${where}: local event #${binding.local_seq} missing`); fail++; continue; }
  if (le.hash !== binding.local_hash) { console.log(`FAIL binding ${where}: local_hash mismatch`); fail++; }
  if (le.type !== r.type || le.actor !== r.actor || (le.subject ?? null) !== (r.subject ?? null)) {
    console.log(`FAIL binding ${where}: type/actor/subject mismatch (${le.type}/${r.type})`); fail++;
  }
  if (JSON.stringify(le.payload ?? null) !== JSON.stringify(binding.event ?? null)) {
    console.log(`FAIL binding ${where}: payload content mismatch`); fail++;
  }
  if (new Date(r.ts).toISOString() !== new Date(le.ts).toISOString()) {
    console.log(`FAIL binding ${where}: ts mismatch`); fail++;
  }
  prevHash = r.hash;
  prevSeq = r.seq;
}

console.log(fail === 0
  ? `MIRROR CONTRACT HOLDS: ${rows.length} rows, chain #${ANCHOR_SEQ}(anchor) → #${prevSeq}, all hashes recomputed OK, all bindings == local chain`
  : `VIOLATIONS: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
