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
const SHA = "71d0d424afdd37e26d3587d23632202ddacafbf5"; // v0.7.0-dev.35655839197.1
const nonce = `mc-agentmode-unlock-${Date.now()}-${crypto.randomUUID().replaceAll("-", "")}`;
const res = await fetch(`${url}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_developer_emergency_update_`, {
  method: "POST",
  headers: { apikey: jwt, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    p_client_id: CLIENT_ID,
    p_request_nonce: nonce,
    p_idempotency_key: `mc-agentmode-unlock-${SHA.slice(0, 8)}`,
    p_expected_git_sha: SHA,
    p_ttl_seconds: 600,
    p_issued_by: "MISSION_CONTROL_CONSOLE",
  }),
});
console.log("RPC:", res.status, (await res.text()).slice(0, 300));
