const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
const env = Object.fromEntries(envRaw.split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");let k=l.slice(0,i).trim();if(k.startsWith("export "))k=k.slice(7).trim();return [k,l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const URL=env.SUPABASE_URL, JWT=env.SUPABASE_SERVICE_ROLE_JWT;
const H={apikey:JWT,Authorization:`Bearer ${JWT}`,"Content-Type":"application/json"} as const;
for (const fn of ["devos_environment_reset_v1","h205f22_a2_reap_stale_sessions_v1","devos_environment_reset_legacy_h205f22"]) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {method:"POST",headers:H,body:"{}"});
  console.log(`${fn} → ${r.status}: ${(await r.text()).slice(0,300).replace(/\n/g," ")}`);
}
