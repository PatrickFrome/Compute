const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
const env = Object.fromEntries(envRaw.split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");
let k=l.slice(0,i).trim();if(k.startsWith("export "))k=k.slice(7).trim();return [k,l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const secRaw = await Bun.file("/home/z/.a2/agent-factory-secrets.env").text();
const sec = Object.fromEntries(secRaw.split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");
let k=l.slice(0,i).trim();if(k.startsWith("export "))k=k.slice(7).trim();return [k,l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const WS = sec.AGENT_FACTORY_WORKSPACE_ID;
const URL=env.SUPABASE_URL, JWT=env.SUPABASE_SERVICE_ROLE_JWT;
const H={apikey:JWT,Authorization:`Bearer ${JWT}`,"Content-Type":"application/json"} as const;
for (const fn of ["devos_fleet_snapshot_v1","devos_fleet_capacity_snapshot_v1"]) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {method:"POST",headers:H,body:JSON.stringify({p_workspace:WS})});
  const t = await r.text();
  console.log(`${fn} → ${r.status}: ${t.slice(0,600)}`);
}
