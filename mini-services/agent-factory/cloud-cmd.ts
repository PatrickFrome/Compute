// Cloud-plane command issue + receipt poll (console-equivalent, bun)
const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
let url = "", jwt = "";
for (const line of envRaw.split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  const v = m[2].replace(/^["']|["']$/g, "");
  if (m[1] === "SUPABASE_URL") url = v;
  if (m[1] === "SUPABASE_SERVICE_ROLE_JWT") jwt = v;
}
const CLIENT_ID = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";
const H = { apikey: jwt, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };

export async function issue(action: string, payload: Record<string, unknown>, ttl = 90, waitMs = 20000, platform: string | null = null) {
  const res = await fetch(`${url}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({
      p_client_id: CLIENT_ID, p_action: action, p_payload: payload,
      p_ttl_seconds: ttl, p_issued_by: "MISSION_CONTROL_CONSOLE",
      p_platform: platform,
      p_idempotency_key: `mc-bun:${action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`issue ${action} HTTP ${res.status}: ${text.slice(0, 240)}`);
  const issued = JSON.parse(text) as { command_id: string };
  const deadline = Date.now() + waitMs;
  let rec: { status: string; receipt: Record<string, unknown> | null } | null = null;
  while (Date.now() < deadline) {
    await Bun.sleep(1000);
    const r = await fetch(`${url}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?select=status,receipt&command_id=eq.${issued.command_id}&limit=1`, { headers: H });
    const rows = (await r.json()) as { status: string; receipt: Record<string, unknown> | null }[];
    rec = rows[0] ?? null;
    if (rec && ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"].includes(rec.status)) break;
  }
  return { commandId: issued.command_id, status: rec?.status ?? "PENDING", result: rec?.receipt?.result ?? null, error: rec?.receipt?.error ?? null };
}
