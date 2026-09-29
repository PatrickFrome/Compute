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
const id = process.argv[2];
const r = await fetch(`${url}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?select=command_id,action,status,error,receipt,leased_by,completed_at&command_id=eq.${id}`, { headers: H });
console.log(JSON.stringify((await r.json())[0], null, 2).slice(0, 2500));
