const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
const env = Object.fromEntries(envRaw.split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");
let k=l.slice(0,i).trim();if(k.startsWith("export "))k=k.slice(7).trim();return [k,l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const secRaw = await Bun.file("/home/z/.a2/agent-factory-secrets.env").text();
const sec = Object.fromEntries(secRaw.split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");
let k=l.slice(0,i).trim();if(k.startsWith("export "))k=k.slice(7).trim();return [k,l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const WS = sec.AGENT_FACTORY_WORKSPACE_ID;
const URL=env.SUPABASE_URL, JWT=env.SUPABASE_SERVICE_ROLE_JWT;
const H={apikey:JWT,Authorization:`Bearer ${JWT}`,"Content-Type":"application/json"} as const;
const r = await fetch(`${URL}/rest/v1/rpc/devos_fleet_snapshot_v1`, {method:"POST",headers:H,body:JSON.stringify({p_workspace:WS})});
const j = await r.json();
const tasks: Array<{task_id:string;state:string;role:string;updated_at:string;lease_expires_at?:string|null}> = j.active_tasks ?? [];
const byState: Record<string, number> = {};
for (const t of tasks) byState[t.state] = (byState[t.state] ?? 0) + 1;
console.log("total tasks in snapshot:", tasks.length);
console.log("by state:", JSON.stringify(byState));
const now = Date.now();
const leased = tasks.filter(t => ["LEASED","RUNNING"].includes(t.state));
for (const t of leased.slice(0, 12)) {
  const exp = t.lease_expires_at ? Date.parse(t.lease_expires_at) : NaN;
  console.log(`  ${t.state} ${t.task_id.slice(0,8)} role=${t.role} lease_exp=${t.lease_expires_at ?? "null"} ${Number.isNaN(exp)?"":`(expire ${Math.round((exp-now)/1000)}s)`} upd=${t.updated_at}`);
}
console.log("snapshot keys:", Object.keys(j).join(", "));
