const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
let url = "", jwt = "";
for (const line of envRaw.split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  const v = m[2].replace(/^["']|["']$/g, "");
  if (m[1] === "SUPABASE_URL") url = v;
  if (m[1] === "SUPABASE_SERVICE_ROLE_JWT") jwt = v;
}
const H = { apikey: jwt, Authorization: `Bearer ${jwt}` };
const r = await fetch(`${url}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?select=command_id,action,status,error,completed_at&order=issued_at.desc&limit=6`, { headers: H });
for (const row of await r.json()) console.log(row.status, row.action, row.error ?? "-", row.completed_at?.slice(11,19));
