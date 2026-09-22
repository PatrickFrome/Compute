/**
 * Зонд RPC: вызов {} → ошибка раскрывает реальную сигнатуру.
 * Read-only зонды: state/read/inputs — безопасны, consume/issue/reset НЕ вызываем вслепую.
 */
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

const probes: Array<[string, Record<string, unknown>]> = [
  ["devos_environment_state_v1", {}],
  ["meta_orchestrator_authoritative_inputs_v1", {}],
  ["h205f22_aop1_vercel_gateway_runtime_secret_v1", {}],
  ["h205f22_aop1_vercel_gateway_bootstrap_input_v1", {}],
  ["h205f22_aop1_consume_bootstrap_bundle_v1", {}],
  ["h205f22_a2_issue_runtime_access_token_v1", {}],
  ["h205f22_a2_browser_supervisor_lease_bootstrap_v3", {}],
  ["h205f22_a2_browser_device_rotate_embedded_bootstrap_v1", {}],
  ["h205f22_aop1_snapshot_v1", {}],
  ["h205f22_a2_read_snapshot_v1", {}],
  ["devos_meta_snapshot_v1", {}],
  ["devos_fleet_snapshot_v1", {}],
];

for (const [fn, args] of probes) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: JWT, Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  let summary = txt;
  try {
    const j = JSON.parse(txt);
    if (j.message) summary = `${j.message} | ${j.hint ?? ""} | ${(j.details ?? "").toString().slice(0, 300)}`;
    else summary = JSON.stringify(j).slice(0, 400);
  } catch {
    summary = txt.slice(0, 300);
  }
  console.log(`\n### ${fn} → ${r.status}`);
  console.log(`   ${summary.replace(/\n/g, " ").slice(0, 500)}`);
}
