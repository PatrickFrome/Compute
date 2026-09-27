// GLM chat creation flow via cloud RPC (proper effect binding) — goal #1 mechanic test.
const envRaw = await Bun.file("/tmp/my-project/.a2-backup/me2.env.20260922").text();
let SB = "", KEY = "";
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) continue;
  if (m[1] === "SUPABASE_URL") SB = m[2].trim();
  if (m[1] === "SUPABASE_SERVICE_ROLE_JWT") KEY = m[2].trim();
}
const CLIENT_ID = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function issue(action: string, payload: Record<string, unknown>, platform: string | null = null, waitMs = 90000): Promise<{ status: string; error: any; receipt: any }> {
  const res = await fetch(`${SB}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1`, {
    method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({
      p_client_id: CLIENT_ID, p_action: action, p_payload: payload,
      p_ttl_seconds: 150, p_issued_by: "MECHANICS-TEST-RUNNER",
      p_platform: platform,
      p_idempotency_key: `mech-flow:${action.toLowerCase()}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    }),
  });
  const text = await res.text();
  if (!res.ok) return { status: `RPC_HTTP_${res.status}`, error: text.slice(0, 220), receipt: null };
  const issued = JSON.parse(text) as { command_id: string };
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await Bun.sleep(3000);
    const r = await fetch(`${SB}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?select=status,receipt,error&command_id=eq.${issued.command_id}&limit=1`, { headers: H });
    const rows = await r.json();
    const row = rows[0];
    if (row && ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"].includes(row.status)) {
      return { status: row.status, error: row.error, receipt: row.receipt };
    }
  }
  return { status: "TIMEOUT", error: null, receipt: null };
}

function resultOf(receipt: any): any {
  if (!receipt) return null;
  if (typeof receipt === "object") return receipt.result ?? receipt;
  try { const p = JSON.parse(String(receipt).replace(/(\w)'(\w)/g, "$1\\\\'$2").replace(/'/g, '"')); return p.result ?? p; } catch { return null; }
}

// ---- flow ----
const text = process.argv[2] || "LIVE-MECHANICS-PROBE-20260928-A: reply exactly MECH-OK-1";
const step = process.argv[3] || "full";

let tabId = process.argv[4] || "";
let frameId = process.argv[5] || "";
let targetId = process.argv[6] || "";
let backendNodeId: number | null = process.argv[7] ? parseInt(process.argv[7]) : null;

if (step === "full" || step === "newtab") {
  const r = await issue("NEW_TAB", { url: "https://chat.z.ai/", select: true });
  console.log("NEW_TAB:", r.status, r.error ? JSON.stringify(r.error).slice(0, 150) : "");
  const res = resultOf(r.receipt);
  tabId = res?.tab_id ?? "";
  console.log("  tab_id:", tabId);
  await Bun.sleep(6000);
}

if (step === "full" || step === "newtab" || step === "capture") {
  if (!tabId) { console.error("no tab_id"); process.exit(1); }
  const r = await issue("CAPTURE", { tab_id: tabId });
  console.log("CAPTURE:", r.status);
  const rec = r.receipt ? JSON.stringify(r.receipt) : "";
  const m = rec.match(/"frame_id":\s*"([A-F0-9]+)"/) || rec.match(/'frame_id': '([A-F0-9]+)'/);
  const t = rec.match(/'target_id': '(webcontents:\d+)'/) || rec.match(/"target_id":\s*"(webcontents:\d+)"/);
  const b = rec.match(/'path': 'form>textbox', 'role': 'textbox', 'text': '[^']*', 'visible': (?:None|null), 'selector': 'backend_node_id:(\d+)'/);
  frameId = m ? m[1] : "";
  targetId = t ? t[1] : "";
  backendNodeId = b ? parseInt(b[1]) : null;
  const drafts = [...rec.matchAll(/'path': 'form>textbox>statictext', 'role': 'statictext', 'text': '(.*?)', 'visible'/g)];
  console.log("  frame:", frameId, "target:", targetId, "backend_node:", backendNodeId, "draft_nodes:", drafts.length, "draft_chars:", drafts.reduce((a, d) => a + d[1].length, 0));
}

if (step === "full" || step === "type") {
  if (!tabId || !frameId || !targetId || backendNodeId == null) { console.error("missing refs"); process.exit(1); }
  const semref: Record<string, unknown> = {
    schema: "metaengine.native-browser.semantic-ref.v1",
    evidence: { name: "How can I help you today?", role: "textbox", identity_authority: false },
    frame_id: frameId, target_id: targetId, backend_node_id: backendNodeId,
  };
  const r = await issue("SEMANTIC_TYPE", { tab_id: tabId, role: "textbox", text, semantic_ref: semref }, "GLM_ZAI");
  console.log("SEMANTIC_TYPE:", r.status, r.error ? String(r.error).slice(0, 160) : "");
  const res = resultOf(r.receipt);
  console.log("  result:", JSON.stringify(res)?.slice(0, 320));
}

if (step === "full" || step === "send") {
  const r = await issue("PRESS_KEY", { tab_id: tabId, key: "Enter" }, "GLM_ZAI");
  console.log("PRESS_KEY Enter:", r.status, r.error ? String(r.error).slice(0, 160) : "");
  const res = resultOf(r.receipt);
  console.log("  result:", JSON.stringify(res)?.slice(0, 320));
}

if (step === "full" || step === "verify") {
  await Bun.sleep(step === "verify" ? 0 : 12000);
  const r = await issue("READ_TRANSCRIPT", { tab_id: tabId, limit: 40 });
  console.log("READ_TRANSCRIPT:", r.status);
  const res = resultOf(r.receipt);
  const t = String(res?.text ?? "");
  console.log("  transcript head:", t.slice(0, 400).replace(/\n/g, " | "));
  console.log("  MECH-OK-1 present:", t.includes("MECH-OK-1"));
}
console.log("FLOW-DONE tab:", tabId);
