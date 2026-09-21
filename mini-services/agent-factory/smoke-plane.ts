// Live smoke test of the typed command plane: census + fleet status.
import { cloudIssueCommand, cloudCommandReceipt, cloudLatestState } from "../../src/lib/cloud";

async function issue(action: string, payload: Record<string, unknown>, waitMs = 20000) {
  const issued = await cloudIssueCommand({
    action,
    payload,
    ttlSeconds: 90,
    issuedBy: "AGENT_FACTORY_TEST",
    idempotencyKey: `factory-smoke:${action.toLowerCase()}:${Date.now().toString(36)}`,
  });
  const id = String(issued.command_id ?? "");
  if (!id) return { action, error: "no_command_id", issued };
  const deadline = Date.now() + waitMs;
  let rec = await cloudCommandReceipt(id);
  while (rec && !["COMPLETED", "EXPIRED", "FAILED"].includes(rec.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    rec = await cloudCommandReceipt(id);
  }
  return { action, commandId: id, status: rec?.status, receipt: rec?.receipt, error: rec ? undefined : "no receipt" };
}

// 1) live state + tabs
const st = await cloudLatestState();
const state = (st?.state ?? {}) as Record<string, unknown>;
const tabs = (state.tabs ?? []) as { tab_id: string; url: string; kind: string; selected: boolean }[];
console.log("last_seen:", st?.last_seen_at, "tabs:", tabs.length);
console.log("tab urls:", JSON.stringify([...new Set(tabs.map((t) => `${t.url.slice(0, 40)}#${t.tab_id.slice(4, 12)}${t.selected ? "*" : ""}`))], null, 1));

// 2) fleet status (read-only)
const fs = await issue("FLEET_STATUS", {});
console.log("\nFLEET_STATUS:", JSON.stringify(fs).slice(0, 900));

// 3) semantic census on the selected chat.z.ai tab
const sel = tabs.find((t) => t.selected) ?? tabs[0];
if (sel) {
  const c = await issue("SEMANTIC_CENSUS", { tab_id: sel.tab_id }, 25000);
  const rec = c.receipt as { result?: Record<string, unknown> } | null;
  const result = rec?.result as { elements?: unknown[]; stats?: Record<string, unknown> } | undefined;
  console.log("\nSEMANTIC_CENSUS status:", c.status);
  if (result) {
    const els = (result.elements ?? []) as { role?: string; name?: string; semantic_ref_id?: string }[];
    console.log("census elements:", els.length);
    for (const e of els.slice(0, 24)) console.log(`- ${e.role} "${String(e.name).slice(0, 42)}" ${e.semantic_ref_id?.slice(0, 18)}`);
  } else console.log("census result:", JSON.stringify(c.receipt)?.slice(0, 600));
}
console.log("\nDONE");
