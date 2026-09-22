/** Дамп всех RPC-путей из OpenAPI спеки. */
const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      let k = l.slice(0, i).trim();
      if (k.startsWith("export ")) k = k.slice(7).trim();
      return [k, l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const URL = env.SUPABASE_URL;
const JWT = env.SUPABASE_SERVICE_ROLE_JWT;

const r = await fetch(`${URL}/rest/v1/`, {
  headers: { apikey: JWT, Authorization: `Bearer ${JWT}` },
});
const spec = await r.json();

const rpcs = Object.keys(spec.paths)
  .filter((p) => p.startsWith("/rpc/"))
  .map((p) => p.slice(5));

console.log(`ВСЕГО RPC: ${rpcs.length}\n`);
const pat = /secret|token|key|credential|vault|env|environment|bootstrap|config|input|context|memory|vercel|gateway|auth|login|session|identity/i;
for (const f of rpcs.filter((f) => pat.test(f))) console.log(`★ ${f}`);
console.log("\n--- остальные ---");
for (const f of rpcs.filter((f) => !pat.test(f))) console.log(`  ${f}`);
