const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
let url = "", jwt = "";
for (const line of envRaw.split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  const v = m[2].replace(/^["']|["']$/g, "");
  if (m[1] === "SUPABASE_URL") url = v;
  if (m[1] === "SUPABASE_SERVICE_ROLE_JWT") jwt = v;
}
const W = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4";
const H = { apikey: jwt, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
const r = await fetch(`${url}/rest/v1/rpc/devos_fleet_snapshot_v1`, { method: "POST", headers: H, body: JSON.stringify({ p_workspace: W }) });
const d = (await r.json()) as Record<string, unknown>;
console.log("keys:", Object.keys(d));
const tasks = (d.tasks ?? d.active_tasks ?? []) as Record<string, unknown>[];
console.log("total tasks:", tasks.length);
const states: Record<string, number> = {};
for (const t of tasks) { const s = String(t.state ?? t.status); states[s] = (states[s] ?? 0) + 1; }
console.log("by state:", states);
for (const t of tasks) {
  const s = String(t.state ?? t.status);
  console.log(JSON.stringify(t, null, 1));
}
