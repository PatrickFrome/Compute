/** Сигнатуры RPC-функций, связанных с секретами/bootstrap. */
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

const targets = [
  "h205f22_aop1_consume_bootstrap_bundle_v1",
  "h205f22_aop1_vercel_gateway_runtime_secret_v1",
  "h205f22_aop1_vercel_gateway_bootstrap_input_v1",
  "devos_environment_state_v1",
  "meta_orchestrator_authoritative_inputs_v1",
  "h205f22_a2_browser_supervisor_lease_bootstrap_v3",
  "h205f22_a2_issue_runtime_access_token_v1",
  "h205f22_a2_browser_device_rotate_embedded_bootstrap_v1",
  "h205f22_aop1_store_vercel_gateway_key_v1",
];

for (const t of targets) {
  const post = spec.paths[`/rpc/${t}`]?.post;
  if (!post) {
    console.log(`✗ ${t}: НЕТ post`);
    continue;
  }
  const params = (post.parameters ?? [])
    .filter((p: { in: string }) => p.in === "body")
    .map((p: { name: string; required?: boolean; schema?: { type?: string; default?: unknown } }) => {
      const s = p.schema ?? {};
      const d = "default" in s ? ` default=${JSON.stringify(s.default)}` : "";
      return `${p.name}${p.required ? "*" : ""}:${s.type ?? "?"}${d}`;
    });
  console.log(`\n★ ${t}`);
  console.log(`   ${params.join("\n   ")}`);
}
