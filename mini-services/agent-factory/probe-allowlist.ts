// Probe the issue-RPC action allowlist.
import { cloudIssueCommand } from "../../src/lib/cloud";

const ACTIONS = [
  "FLEET_RECONCILE", "CLOSE_TAB", "NEW_TAB", "SELECT_TAB", "RELOAD", "RELOAD_TAB",
  "SEMANTIC_CENSUS", "SEMANTIC_TYPE", "TYPED_CLICK", "SEMANTIC_FOCUS", "READ_TRANSCRIPT",
  "CAPTURE_VIEW", "PRESS_KEY", "SCROLL", "NAVIGATE", "FLEET_STATUS", "TAB_CENSUS",
  "CAPTURE", "POLL", "ARM", "RESOLVE_PROMPT", "STOP_GENERATION", "SYSTEM_TELEMETRY",
];

for (const a of ACTIONS) {
  try {
    const payload =
      a === "CLOSE_TAB" || a === "SELECT_TAB" || a === "SEMANTIC_CENSUS" || a === "READ_TRANSCRIPT" || a === "CAPTURE_VIEW"
        ? { tab_id: "tab_probe" }
        : a === "NEW_TAB" || a === "NAVIGATE"
          ? { url: "https://example.com" }
          : a === "SEMANTIC_TYPE"
            ? { role: "textbox", text: "x", tab_id: "tab_probe" }
            : a === "TYPED_CLICK"
              ? { role: "button", tab_id: "tab_probe" }
              : a === "PRESS_KEY"
                ? { key: "Enter", tab_id: "tab_probe" }
                : a === "SCROLL"
                  ? { direction: "down", amount: 100, tab_id: "tab_probe" }
                  : {};
    const r = await cloudIssueCommand({
      action: a,
      payload,
      ttlSeconds: 20,
      issuedBy: "AGENT_FACTORY_PROBE",
      idempotencyKey: `probe:${a}:${Date.now().toString(36)}`,
    });
    console.log(`${a}: OK command_id=${String(r.command_id ?? "?").slice(0, 10)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`${a}: ${msg.includes("action_invalid") ? "DENIED" : msg.slice(0, 120)}`);
  }
}
