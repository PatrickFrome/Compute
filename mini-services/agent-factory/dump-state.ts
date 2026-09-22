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
const res = await fetch(`${url}/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state,last_seen_at&client_id=eq.${CLIENT_ID}&order=last_seen_at.desc&limit=1`, {
  headers: { apikey: jwt, Authorization: `Bearer ${jwt}` },
});
const rows = (await res.json()) as { state: Record<string, unknown>; last_seen_at: string }[];
const st = rows[0]?.state ?? {};
console.log("last_seen:", rows[0]?.last_seen_at);
console.log("top keys:", Object.keys(st).join(", "));
const pick = (o: unknown, keys: string[]) => {
  if (!o || typeof o !== "object") return;
  const rec = o as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (keys.some(t => k.toLowerCase().includes(t))) {
      console.log(`  ${k} =`, JSON.stringify(rec[k]).slice(0, 300));
    }
    if (typeof rec[k] === "object" && rec[k]) pick(rec[k], keys);
  }
};
pick(st, ["keepalive", "rollover", "cycle_seq", "control_plane", "lease", "dispatch", "seed", "queued_wake", "supervisor"]);
