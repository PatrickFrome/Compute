// Honest capture->extract->type->send->verify chain, verbatim semantic_ref from semantic_refs_issued.
const envRaw = await Bun.file("/tmp/my-project/.a2-backup/me2.env.20260922").text();
let SB = "", KEY = "";
for (const line of envRaw.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) { if (m[1]==="SUPABASE_URL") SB=m[2].trim(); if (m[1]==="SUPABASE_SERVICE_ROLE_JWT") KEY=m[2].trim(); } }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const CLIENT_ID = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";
const tabId = process.argv[2] || "tab_1cd808d0-7496-457f-a0a2-497308ba8d6f";
const text = process.argv[3] || "LIVE-MECHANICS-PROBE-20260928-C: reply exactly MECH-OK-3";

async function issue(action: string, payload: any, platform: string|null = null, ttl = 240, waitMs = 260000) {
  const res = await fetch(`${SB}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1`, { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ p_client_id: CLIENT_ID, p_action: action, p_payload: payload, p_ttl_seconds: ttl, p_issued_by: "MECHANICS-TEST-RUNNER", p_platform: platform, p_idempotency_key: `mech6:${action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}` }) });
  if (!res.ok) return { status: `RPC_${res.status}`, error: (await res.text()).slice(0,200), receipt: null };
  const issued = await res.json();
  const dl = Date.now() + waitMs;
  while (Date.now() < dl) { await Bun.sleep(5000);
    const r = await fetch(`${SB}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?select=status,receipt,error&command_id=eq.${issued.command_id}&limit=1`, { headers: H });
    const row = (await r.json())[0];
    if (row && ["COMPLETED","FAILED","EXPIRED","CANCELLED"].includes(row.status)) return { status: row.status, error: row.error, receipt: row.receipt };
  }
  return { status: "STILL_PENDING", error: null, receipt: null };
}
function walk(n: any, out: any[] = [], depth = 0): any[] {
  if (!n || typeof n !== "object" || depth > 40) return out;
  if (n.role) out.push(n);
  for (const k of Object.keys(n)) { const v = (n as any)[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, out, depth + 1)); else if (v && typeof v === "object") walk(v, out, depth + 1); }
  return out;
}
// 1. capture
const cap = await issue("CAPTURE", { tab_id: tabId }, null, 180, 100000);
console.log("CAPTURE:", cap.status);
const res: any = (cap.receipt as any)?.result ?? {};
const tree: any[] = Array.isArray(res.interaction_tree) ? res.interaction_tree : walk(res.interaction_tree);
const refs: any[] = res.semantic_refs_issued ?? [];
console.log("tree:", tree.length, "targets type:", typeof res.semantic_targets, Array.isArray(res.semantic_targets) ? res.semantic_targets.length : JSON.stringify(res.semantic_targets).slice(0,80), "refs type:", typeof res.semantic_refs_issued, "frame:", res.runtime_main_frame_id, "target:", res.target_id, "rev:", res.state_revision_id);
const comp = tree.find((e) => String(e.path||"").endsWith("form>textbox") || (e.role === "textbox" && String(e.text||"").includes("help you today")));
console.log("composer node:", JSON.stringify(comp).slice(0, 220));
const targets: any[] = Array.isArray(res.semantic_targets) ? res.semantic_targets : (Array.isArray(res.semantic_refs_issued) ? res.semantic_refs_issued : []);
const ref = targets.find((x) => x.semantic_ref_id === comp?.semantic_ref_id) ?? targets.find((x) => String(x?.evidence?.name||"").includes("help you today")) ?? targets.find((x) => x?.evidence?.role === "textbox");
if (!ref) { console.log("NO COMPOSER SEMANTIC REF — targets:", JSON.stringify(res.semantic_targets).slice(0,500)); process.exit(0); }
console.log("verbatim target:", JSON.stringify(ref).slice(0, 300));
const refInner: any = ref.semantic_ref ?? ref;
if (ref.semantic_ref_id && !refInner.semantic_ref_id) refInner.semantic_ref_id = ref.semantic_ref_id;
console.log("inner ref:", JSON.stringify(refInner).slice(0, 300));
// 2. type with verbatim ref
const t = await issue("SEMANTIC_TYPE", { tab_id: tabId, role: "textbox", text, semantic_ref: refInner }, "GLM_ZAI");
console.log("TYPE:", t.status, String(t.error||"").slice(0,180));
const tres: any = (t.receipt as any)?.result;
if (tres) console.log("type result:", JSON.stringify(tres).slice(0,400));
// 3. send
if (t.status === "COMPLETED") {
  await Bun.sleep(2500);
  const s = await issue("PRESS_KEY", { tab_id: tabId, key: "Enter" }, "GLM_ZAI");
  console.log("SEND Enter:", s.status, String(s.error||"").slice(0,150));
  const sres: any = (s.receipt as any)?.result;
  if (sres) console.log("send result:", JSON.stringify(sres).slice(0,300));
  // 4. verify
  await Bun.sleep(14000);
  const v = await issue("READ_TRANSCRIPT", { tab_id: tabId, limit: 40 });
  const vres: any = (v.receipt as any)?.result;
  const txt = String(vres?.text ?? "");
  console.log("VERIFY: status", v.status, "| MECH-OK-3 in transcript:", txt.includes("MECH-OK-3"));
  console.log("transcript:", txt.slice(0, 350).replace(/\n/g, " | "));
}
console.log("CHAIN-DONE");
