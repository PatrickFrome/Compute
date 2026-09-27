// Fleet mechanics test: FLEET_STATUS (read) + FLEET_RECONCILE (global mutation, target 4)
const envRaw = await Bun.file("/tmp/my-project/.a2-backup/me2.env.20260922").text();
let SB = "", KEY = "";
for (const line of envRaw.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) { if (m[1]==="SUPABASE_URL") SB=m[2].trim(); if (m[1]==="SUPABASE_SERVICE_ROLE_JWT") KEY=m[2].trim(); } }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const CLIENT_ID = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";
const WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4";

async function rpcIssue(action: string, payload: any, platform: string | null = null, ttl = 180, waitMs = 100000) {
  const res = await fetch(`${SB}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1`, { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ p_client_id: CLIENT_ID, p_action: action, p_payload: payload, p_ttl_seconds: ttl, p_issued_by: "MECHANICS-TEST-RUNNER", p_platform: platform, p_idempotency_key: `fleet:${action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }) });
  if (!res.ok) return { status: `RPC_${res.status}`, error: (await res.text()).slice(0, 160), receipt: null };
  const issued = await res.json();
  const dl = Date.now() + waitMs;
  while (Date.now() < dl) { await Bun.sleep(4000);
    const r = await fetch(`${SB}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?select=status,receipt,error&command_id=eq.${issued.command_id}&limit=1`, { headers: H });
    const row = (await r.json())[0];
    if (row && ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"].includes(row.status)) return { status: row.status, error: row.error, receipt: row.receipt };
  }
  return { status: "STILL_PENDING", error: null, receipt: null };
}
async function directInsert(action: string, payload: any) {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().replace(/Z$/, "").replace(/(\.\d{3})\d*/, "$1") + "0";
  const row: any = { command_id: crypto.randomUUID(), workspace_id: WS, target_client_id: CLIENT_ID, issued_by: "MECHANICS-TEST-RUNNER", action, platform: null, payload: JSON.stringify(payload), status: "PENDING", issued_at: iso(now), expires_at: iso(new Date(now.getTime() + 120000)), idempotency_key: `fleet-ins:${action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
  const res = await fetch(`${SB}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(row) });
  if (!res.ok) return { status: `INSERT_${res.status}`, error: (await res.text()).slice(0, 120), receipt: null };
  const ins = await res.json();
  const cid = ins[0]?.command_id;
  const dl = Date.now() + 100000;
  while (Date.now() < dl) { await Bun.sleep(4000);
    const r = await fetch(`${SB}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?select=status,receipt,error&command_id=eq.${cid}&limit=1`, { headers: H });
    const row2 = (await r.json())[0];
    if (row2 && ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"].includes(row2.status)) return { status: row2.status, error: row2.error, receipt: row2.receipt };
  }
  return { status: "STILL_PENDING", error: null, receipt: null };
}
function resultOf(receipt: any): any { if (!receipt) return null; return typeof receipt === "object" ? (receipt.result ?? receipt) : receipt; }

// 1. FLEET_STATUS via RPC
let f = await rpcIssue("FLEET_STATUS", {});
if (f.status.startsWith("RPC_")) f = await directInsert("FLEET_STATUS", {});
console.log("FLEET_STATUS:", f.status, String(f.error || "").slice(0, 100));
const fr: any = resultOf(f.receipt);
if (fr) console.log("  fleet:", JSON.stringify(fr).slice(0, 420));

// 2. FLEET_RECONCILE target 4 via RPC
let rec2 = await rpcIssue("FLEET_RECONCILE", { target_agents: 4 });
if (rec2.status.startsWith("RPC_")) rec2 = await directInsert("FLEET_RECONCILE", { target_agents: 4 });
console.log("FLEET_RECONCILE(4):", rec2.status, String(rec2.error || "").slice(0, 120));
const rr: any = resultOf(rec2.receipt);
if (rr) console.log("  result:", JSON.stringify(rr).slice(0, 420));
console.log("FLEET-TEST-DONE");
// 3. provisioning probe: 5 then back to 4
let up = await rpcIssue("FLEET_RECONCILE", { target_agents: 5 }, null, 240, 260000);
console.log("RECONCILE(5):", up.status, String(up.error || "").slice(0, 120));
const upr: any = resultOf(up.receipt);
if (upr) console.log("  counts:", JSON.stringify(upr.counts), "post:", JSON.stringify(upr.postcondition ?? upr.error ?? null).slice(0, 160));
let down = await rpcIssue("FLEET_RECONCILE", { target_agents: 4 }, null, 240, 260000);
console.log("RECONCILE(4):", down.status, String(down.error || "").slice(0, 120));
const dn: any = resultOf(down.receipt);
if (dn) console.log("  counts:", JSON.stringify(dn.counts), "post:", JSON.stringify(dn.postcondition ?? dn.error ?? null).slice(0, 160));
console.log("PROVISION-TEST-DONE");
