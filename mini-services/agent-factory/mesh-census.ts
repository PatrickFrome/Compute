const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
const env = Object.fromEntries(envRaw.split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");
let k=l.slice(0,i).trim();if(k.startsWith("export "))k=k.slice(7).trim();return [k,l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const URL=env.SUPABASE_URL, JWT=env.SUPABASE_SERVICE_ROLE_JWT;
const H={apikey:JWT,Authorization:`Bearer ${JWT}`} as const;
const r = await fetch(`${URL}/rest/v1/compute_fabric_a2_supervisor_mesh_instance_h205f22?order=last_seen_at.desc&limit=20&select=supervisor_instance_id,workspace_id,tab_id,status,priority,last_seen_at,retired_at`, {headers:H});
const rows = await r.json() as Array<Record<string,unknown>>;
const now = Date.now();
console.log("mesh rows:", rows.length);
for (const m of rows) {
  const age = Math.round((now - Date.parse(String(m.last_seen_at)))/1000);
  console.log(`  ${String(m.status)} age=${age}s tab=${String(m.tab_id??"-").slice(0,16)} ws=${String(m.workspace_id).slice(0,8)} retired=${m.retired_at??"-"}`);
}
// claims через снапшот
const secRaw = await Bun.file("/home/z/.a2/agent-factory-secrets.env").text();
const sec = Object.fromEntries(secRaw.split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");
let k=l.slice(0,i).trim();if(k.startsWith("export "))k=k.slice(7).trim();return [k,l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const r2 = await fetch(`${URL}/rest/v1/rpc/devos_fleet_snapshot_v1`, {method:"POST",headers:{...H,"Content-Type":"application/json"},body:JSON.stringify({p_workspace:sec.AGENT_FACTORY_WORKSPACE_ID})});
const j = await r2.json();
console.log("active_claims:", JSON.stringify(j.active_claims ?? []).slice(0, 400));
