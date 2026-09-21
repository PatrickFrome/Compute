const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
let url = "", jwt = "";
for (const line of envRaw.split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  const v = m[2].replace(/^["']|["']$/g, "");
  if (m[1] === "SUPABASE_URL") url = v;
  if (m[1] === "SUPABASE_SERVICE_ROLE_JWT") jwt = v;
}
const r = await fetch(`${url}/rest/v1/?apikey=${jwt}`, { headers: { apikey: jwt, Authorization: `Bearer ${jwt}`, Accept: "application/openapi+json" } });
const spec = await r.json();
for (const name of process.argv.slice(2)) {
  const def = (spec.paths as Record<string, { post?: { parameters?: { name: string; required?: boolean }[] } }>)[`/rpc/${name}`];
  const params = def?.post?.parameters?.map((p) => `${p.name}${p.required ? "*" : ""}`).join(", ") ?? "NO SIG";
  console.log(`${name}(${params})`);
}
