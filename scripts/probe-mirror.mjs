// Probe the live me2_event_mirror_h205f22 table: tail, anchor-write presence,
// and OpenAPI schema (columns + constraints) — read-only, service-role server-side.
import { readFileSync } from "node:fs";

const txt = readFileSync("/home/z/.a2/supabase-cloud.env", "utf8");
const url = /^SUPABASE_URL=(.+)$/m.exec(txt)[1].trim();
const key = /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(txt)[1].trim();

async function supa(path, init) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.log(`ERR ${path} -> ${res.status}`, JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  return body;
}

// 1. Tail (last 8 rows, full columns)
const tail = await supa(
  "/rest/v1/me2_event_mirror_h205f22?select=*&order=seq.desc&limit=8"
);
console.log("TAIL (last 8 rows):");
for (const r of tail) {
  console.log(
    `  seq=${r.seq} type=${r.type} actor=${r.actor} daemon=${r.daemon_version} mirrored_at=${r.mirrored_at}`
  );
  console.log(`    prev_hash=${String(r.prev_hash).slice(0, 16)}… hash=${String(r.hash).slice(0, 16)}…`);
  console.log(`    payload=${String(r.payload).slice(0, 120)}`);
}

// 2. Count
const cnt = await supa("/rest/v1/me2_event_mirror_h205f22?select=seq&limit=1000");
console.log(`\nTOTAL rows (probe up to 1000): ${cnt.length}`);
if (cnt.length === 1000) console.log("(possibly more)");

// 3. OpenAPI schema for the table (columns)
const openapi = await supa("/rest/v1/");
const def = openapi?.definitions?.me2_event_mirror_h205f22;
if (def) {
  console.log("\nSCHEMA me2_event_mirror_h205f22:");
  console.log("  required:", JSON.stringify(def.required ?? []));
  for (const [k, v] of Object.entries(def.properties ?? {})) {
    console.log(`  - ${k}: ${v.type} ${v.format ?? ""} ${v.maxLength ? "max=" + v.maxLength : ""} ${v.description ? "// " + String(v.description).slice(0, 60) : ""}`);
  }
} else {
  console.log("\nSCHEMA: definition not found; keys:", Object.keys(openapi?.definitions ?? {}).filter((k) => k.includes("mirror")).join(", "));
}
