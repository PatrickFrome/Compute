// Supabase browser-control tooling introspection (bun fetch — WAF-safe).
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_JWT } = await import(
  "/home/z/.a2/supabase-cloud.env.mjs"
).catch(() => ({ SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_JWT: process.env.SUPABASE_SERVICE_ROLE_JWT }));

const SB = SUPABASE_URL ?? "https://xpeibufgzjknrhbhpffp.supabase.co";
const KEY =
  SUPABASE_SERVICE_ROLE_JWT ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZWlidWZnemprbnJoYmhwZmZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE5MDAxMiwiZXhwIjoyMTAyNzY2MDEyfQ.GwPUwfFLebOQFDKJWl_NmExp_Pgww4x8xsVsgxiO8Gc";

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function j(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers ?? {}) } });
  const t = await r.text();
  try { return { s: r.status, d: JSON.parse(t) }; } catch { return { s: r.status, d: t.slice(0, 200) }; }
}

// 1) OpenAPI spec: all tables + columns + RPCs
const spec = await j(`${SB}/rest/v1/`);
const defs = spec.d?.definitions ?? {};
const paths = spec.d?.paths ?? {};
const tables = Object.keys(defs).sort();
const rpcs = Object.keys(paths).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5));

console.log("=== TABLES:", tables.length);
console.log(tables.join("\n"));
console.log("=== RPCs:", rpcs.length);
console.log(rpcs.join("\n"));

// 2) columns of the browser-control core tables
const CORE = ["supervisor_command", "supervisor_state", "supervisor_actuation", "supervisor_device", "supervisor_enrollment"];
for (const t of CORE) {
  if (!defs[t]) { console.log(`\n--- ${t}: NOT EXPOSED`); continue; }
  const cols = Object.entries(defs[t].properties).map(([k, v]) => `${k}:${v.type ?? "?"}${v.description ? "//" + String(v.description).slice(0, 60) : ""}`);
  console.log(`\n--- ${t} (${cols.length} cols):`, cols.join(", "));
}

// 3) RPC signatures (postgrest path params)
const RPC_CORE = ["issue_native_v1", "devos_fleet_snapshot_v1", "devos_fleet_enqueue_v1", "devos_fleet_lease_v1", "devos_fleet_complete_v1"];
for (const r of RPC_CORE) {
  const p = paths[`/rpc/${r}`];
  if (!p) { console.log(`\n--- rpc ${r}: MISSING`); continue; }
  const post = p.post ?? p.get ?? {};
  console.log(`\n--- rpc ${r}:`, JSON.stringify((post.parameters ?? []).map((x) => `${x.name}:${x.schema?.type ?? "?"}`).join(",")));
}

// 4) live data snapshots
const snap = async (t, order, lim = 3, sel = "*") => {
  const r = await j(`${SB}/rest/v1/${t}?select=${sel}&order=${order}&limit=${lim}`);
  console.log(`\n--- data ${t} [${r.s}]:`, JSON.stringify(r.d)?.slice(0, 1400));
};
await snap("supervisor_command", "created_at.desc", 4);
await snap("supervisor_state", "last_seen_at.desc", 2);
await snap("supervisor_actuation", "created_at.desc", 4);

console.log("\nDONE");
