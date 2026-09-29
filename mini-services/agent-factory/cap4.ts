const envRaw = await Bun.file("/tmp/my-project/.a2-backup/me2.env.20260922").text();
let SB = "", KEY = "";
for (const line of envRaw.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) { if (m[1]==="SUPABASE_URL") SB=m[2].trim(); if (m[1]==="SUPABASE_SERVICE_ROLE_JWT") KEY=m[2].trim(); } }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const CLIENT_ID = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";
async function issue(action: string, payload: any, platform: string|null = null, waitMs = 90000) {
  const res = await fetch(`${SB}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1`, { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ p_client_id: CLIENT_ID, p_action: action, p_payload: payload, p_ttl_seconds: 150, p_issued_by: "MECHANICS-TEST-RUNNER", p_platform: platform, p_idempotency_key: `mech4:${action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}` }) });
  if (!res.ok) return { status: `RPC_${res.status}`, error: (await res.text()).slice(0,200), receipt: null };
  const issued = await res.json();
  const dl = Date.now() + waitMs;
  while (Date.now() < dl) { await Bun.sleep(3000);
    const r = await fetch(`${SB}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?select=status,receipt,error&command_id=eq.${issued.command_id}&limit=1`, { headers: H });
    const row = (await r.json())[0];
    if (row && ["COMPLETED","FAILED","EXPIRED","CANCELLED"].includes(row.status)) return { status: row.status, error: row.error, receipt: row.receipt };
  }
  return { status: "TIMEOUT", error: null, receipt: null };
}
const tabId = process.argv[2];
const r = await issue("CAPTURE", { tab_id: tabId });
console.log("CAPTURE:", r.status);
const res: any = (r.receipt as any)?.result ?? {};
const raw = res.interaction_tree;
console.log("tree keys:", typeof raw === "object" && raw ? Object.keys(raw).join(",") : typeof raw);
// flatten any object tree: walk recursively collecting nodes with .role
function walk(n: any, out: any[] = [], depth = 0): any[] {
  if (!n || typeof n !== "object" || depth > 40) return out;
  if (n.role) out.push(n);
  for (const k of Object.keys(n)) { const v = (n as any)[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, out, depth + 1)); else if (v && typeof v === "object") walk(v, out, depth + 1); }
  return out;
}
const tree: any[] = Array.isArray(raw) ? raw : walk(raw);
const tb = tree.filter((e) => e.role === "textbox");
console.log("textboxes:", tb.length);
for (const e of tb.slice(0, 5)) console.log("TB:", JSON.stringify({path:e.path, text:String(e.text||"").slice(0,50), len:String(e.text||"").length, sel:e.selector}).slice(0,240));
const comp = tb.find((e) => String(e.path||"").endsWith(">textbox")) ?? tb[0];
if (comp) console.log("COMPOSER:", JSON.stringify({ frame_id: res.runtime_main_frame_id, target_id: res.target_id, backend_node_id: comp.selector?parseInt(String(comp.selector).replace("backend_node_id:","")):null, semantic_ref_id: comp.semantic_ref_id }));
else console.log("NO COMPOSER TEXTBOX");
