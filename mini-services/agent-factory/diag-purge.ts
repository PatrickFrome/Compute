/** Диагностика: почему DELETE 403/409 и почему 3 CLOSE_TAB FAILED. */
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
const H = { apikey: JWT, Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" } as const;

// 1) тела ошибок DELETE
for (const [tbl, key] of [
  ["compute_fabric_a2_browser_supervisor_command_h205f22", "command_id"],
  ["compute_fabric_a2_supervisor_mesh_instance_h205f22", "supervisor_instance_id"],
  ["compute_fabric_a2_workspace_binding_h205f22", "binding_id"],
  ["compute_fabric_a2_browser_cognitive_cursor_h205f22", "workspace_id"],
  ["metaengine_peer_health_h205f22", "peer_id"],
]) {
  const r = await fetch(`${URL}/rest/v1/${tbl}?${key}=not.is.null`, { method: "DELETE", headers: H });
  const t = await r.text();
  console.log(`DELETE ${tbl} → ${r.status}: ${t.slice(0, 260).replace(/\n/g, " ")}`);
}

// 2) GET-доступ к тем же таблицам
for (const [tbl, key] of [
  ["compute_fabric_a2_workspace_binding_h205f22", "binding_id"],
  ["compute_fabric_a2_browser_cognitive_cursor_h205f22", "workspace_id"],
  ["metaengine_peer_health_h205f22", "peer_id"],
]) {
  const r = await fetch(`${URL}/rest/v1/${tbl}?select=${key}&limit=1`, { headers: H });
  console.log(`GET ${tbl} → ${r.status}: ${(await r.text()).slice(0, 160).replace(/\n/g, " ")}`);
}

// 3) последние FAILED CLOSE_TAB с error
const r = await fetch(
  `${URL}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?action=eq.CLOSE_TAB&status=eq.FAILED&order=issued_at.desc&limit=5&select=command_id,issued_at,error,receipt`,
  { headers: H },
);
const rows = (await r.json()) as Array<{ command_id: string; error: unknown; receipt: { error?: unknown } | null }>;
for (const row of rows) {
  console.log(`FAILED CLOSE_TAB ${row.command_id.slice(0, 10)} err=${JSON.stringify(row.error ?? row.receipt?.error)?.slice(0, 200)}`);
}
