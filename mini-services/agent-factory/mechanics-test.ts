// LIVE-BROWSER MECHANICS TEST RUNNER (Stage A/B/C) — reads creds from me2.env at runtime, never prints them.
// Channel: Supabase RPC issue_native_v1 -> browser_supervisor_command (PENDING -> leased -> receipt).
const envRaw = await Bun.file("/tmp/my-project/.a2-backup/me2.env.20260922").text();
let SB = "", KEY = "";
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) continue;
  if (m[1] === "SUPABASE_URL") SB = m[2].trim();
  if (m[1] === "SUPABASE_SERVICE_ROLE_JWT") KEY = m[2].trim();
}
if (!SB || !KEY) { console.error("NO CREDS"); process.exit(1); }
const CLIENT_ID = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

export interface IssueResult {
  action: string; commandId: string; status: string;
  result: any; error: any; ms: number;
}

export async function issue(action: string, payload: Record<string, unknown> = {}, waitMs = 32000, ttl = 90): Promise<IssueResult> {
  const t0 = Date.now();
  const res = await fetch(`${SB}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1`, {
    method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({
      p_client_id: CLIENT_ID, p_action: action, p_payload: payload,
      p_ttl_seconds: ttl, p_issued_by: "MECHANICS-TEST-RUNNER",
      p_platform: null,
      p_idempotency_key: `mech-test:${action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    }),
  });
  const text = await res.text();
  if (!res.ok) return { action, commandId: "", status: `ISSUE_HTTP_${res.status}`, result: null, error: text.slice(0, 200), ms: Date.now() - t0 };
  const issued = JSON.parse(text) as { command_id: string };
  const deadline = Date.now() + waitMs;
  let st = "PENDING", rec: any = null;
  while (Date.now() < deadline) {
    await Bun.sleep(1200);
    const r = await fetch(`${SB}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?select=status,receipt,error&command_id=eq.${issued.command_id}&limit=1`, { headers: H });
    const rows = await r.json();
    const row = rows[0];
    if (row) { st = row.status; rec = row.receipt ?? row.error; }
    if (row && ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"].includes(row.status)) break;
  }
  const result = rec && typeof rec === "object" ? (rec.result ?? rec) : rec;
  return { action, commandId: issued.command_id, status: st, result, error: rec && typeof rec === "object" ? rec.error ?? null : rec, ms: Date.now() - t0 };
}

// ---- Stage A: READ_ONLY census ----
const stageA = process.argv.includes("--stage-a");
if (stageA) {
  const readOnly: Array<[string, Record<string, unknown>]> = [
    ["POLL", {}],
    ["CONTROL_CAPABILITIES", {}],
    ["SEMANTIC_CENSUS", {}],
    ["PROCESS_CENSUS", {}],
    ["CONTROL_LATENCY_STATUS", {}],
    ["TAB_CENSUS", {}],
    ["FLEET_STATUS", {}],
    ["DOWNLOAD_STATUS", {}],
    ["SELF_UPDATE_STATUS", {}],
    ["GATE_STATUS", {}],
    ["WORKTREE_LIST", {}],
    ["MIRROR_STATUS", {}],
    ["DEV_PLANE_HEALTH", {}],
    ["DEV_PLANE_CAPABILITIES", {}],
    ["DEV_PLANE_REPO_HEAD", {}],
    ["TASK_GET", {}],
  ];
  for (const [a, p] of readOnly) {
    const r = await issue(a, p);
    const res = r.result;
    let brief = "";
    if (res && typeof res === "object") {
      const keys = Object.keys(res).slice(0, 6);
      brief = keys.map((k) => `${k}=${JSON.stringify(res[k]).slice(0, 90)}`).join(" ");
    } else brief = JSON.stringify(res)?.slice(0, 120) ?? "";
    console.log(`[${r.status}] ${a} (${r.ms}ms) ${r.status !== "COMPLETED" ? "ERR=" + JSON.stringify(r.error).slice(0, 120) : ""}`);
    console.log(`    ${brief.slice(0, 420)}`);
  }
  console.log("STAGE-A-DONE");
}
