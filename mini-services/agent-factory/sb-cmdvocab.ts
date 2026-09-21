// Learn the typed command vocabulary from supervisor_command + lanes.
const SB = "https://xpeibufgzjknrhbhpffp.supabase.co";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZWlidWZnemprbnJoYmhwZmZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE5MDAxMiwiZXhwIjoyMTAyNzY2MDEyfQ.GwPUwfFLebOQFDKJWl_NmExp_Pgww4x8xsVsgxiO8Gc";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const T = (n) => `${n}_h205f22`;

async function j(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers ?? {}) } });
  const t = await r.text();
  try { return { s: r.status, d: JSON.parse(t) }; } catch { return { s: r.status, d: t.slice(0, 300) }; }
}

const spec = await j(`${SB}/rest/v1/`);
const defs = spec.d?.definitions ?? {};
for (const t of [
  T("compute_fabric_a2_browser_supervisor_command"),
  T("compute_fabric_a2_supervisor_actuation_lease"),
  T("compute_fabric_a2_supervisor_mesh_instance"),
  T("compute_fabric_a2_browser_cognitive_cursor"),
  T("compute_fabric_a2_chat_bridge_remote_command"),
]) {
  const cols = defs[t] ? Object.keys(defs[t].properties) : "NOT EXPOSED";
  console.log(`\n${t}:`, JSON.stringify(cols));
}

// recent commands — order by leased_at desc (created_at absent)
let cmd = await j(`${SB}/rest/v1/${T("compute_fabric_a2_browser_supervisor_command")}?select=*&order=leased_at.desc.nullslast&limit=6`);
console.log("\nRECENT COMMANDS:", JSON.stringify(cmd.d)?.slice(0, 3000));

// distinct command kinds
const kinds = await j(`${SB}/rest/v1/${T("compute_fabric_a2_browser_supervisor_command")}?select=command_type&limit=200`);
if (Array.isArray(kinds.d)) {
  const set = {};
  for (const k of kinds.d) set[k.command_type] = (set[k.command_type] ?? 0) + 1;
  console.log("\nCOMMAND TYPES (last 200):", JSON.stringify(set));
} else console.log("\ncommand_type probe:", JSON.stringify(kinds).slice(0, 200));
console.log("\nDONE");
