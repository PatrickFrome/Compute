// Deep dive: browser supervisor command plane (bun fetch, WAF-safe).
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
const paths = spec.d?.paths ?? {};
const RPCS = [
  "h205f22_a2_browser_supervisor_lease_v3",
  "h205f22_a2_browser_supervisor_lease_emergency_v1",
  "h205f22_a2_browser_supervisor_complete_v5",
  "h205f22_a2_browser_supervisor_issue_mesh_v1",
  "h205f22_a2_browser_supervisor_bind_effect_v1",
  "h205f22_a2_browser_device_activate_approved_v1",
  "h205f22_a2_browser_device_consume_nonce_v2",
  "h205f22_a2_supervisor_mesh_sync_v1",
  "h205f22_heartbeat_v2",
  "h205f22_a2_chat_bridge_remote_transition_v3",
];
for (const r of RPCS) {
  const p = paths[`/rpc/${r}`];
  if (!p) { console.log(`rpc ${r}: MISSING`); continue; }
  const post = p.post ?? {};
  const params = (post.parameters ?? []).filter((x) => x.name && x.name !== "undefined");
  console.log(`rpc ${r}(${params.map((x) => x.name).join(", ")})`);
}

// supervisor_state last row: full browser overview
const st = await j(`${SB}/rest/v1/${T("compute_fabric_a2_browser_supervisor_state")}?select=*&order=last_seen_at.desc&limit=1`);
console.log("\nSTATE:", JSON.stringify(st.d)?.slice(0, 2200));

// recent commands
const cmd = await j(`${SB}/rest/v1/${T("compute_fabric_a2_browser_supervisor_command")}?select=*&order=created_at.desc&limit=5`);
console.log("\nCOMMANDS:", JSON.stringify(cmd.d)?.slice(0, 2400));

// actuation leases
const act = await j(`${SB}/rest/v1/${T("compute_fabric_a2_supervisor_actuation_lease")}?select=*&order=created_at.desc&limit=3`);
console.log("\nACTUATION:", JSON.stringify(act.d)?.slice(0, 1200));

// mesh instances
const mesh = await j(`${SB}/rest/v1/${T("compute_fabric_a2_supervisor_mesh_instance")}?select=*&order=created_at.desc&limit=3`);
console.log("\nMESH:", JSON.stringify(mesh.d)?.slice(0, 1200));

// cognitive cursor
const cur = await j(`${SB}/rest/v1/${T("compute_fabric_a2_browser_cognitive_cursor")}?select=*&order=created_at.desc&limit=2`);
console.log("\nCURSOR:", JSON.stringify(cur.d)?.slice(0, 900));

// devices
const dev = await j(`${SB}/rest/v1/${T("compute_fabric_a2_browser_device")}?select=*&limit=4`);
console.log("\nDEVICES:", JSON.stringify(dev.d)?.slice(0, 1400));
console.log("\nDONE");
