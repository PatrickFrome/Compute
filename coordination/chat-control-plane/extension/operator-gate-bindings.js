(() => {
  "use strict";

  const SAFE = "SAFE_RETRY_PRE_ACTUATION";

  function typedError(message) {
    const error = new Error(message);
    error.a2ExecutionClass = SAFE;
    return error;
  }

  async function operatorGateEnabled() {
    const { operatorMode } = await chrome.storage.local.get("operatorMode");
    return operatorMode === "GATE_SEND";
  }

  async function arm(tabId, command, ttl = 15000) {
    if (!(await operatorGateEnabled())) return false;
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "A2_PROMPT_GATE_BRIDGE_BYPASS",
      command_id: String(command?.command_id || ""),
      draft: String(command?.prompt || ""),
      expires_in_ms: ttl
    }).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    if (!response?.ok) throw typedError(`operator_gate_bypass_unavailable:${response?.error || "unknown"}`);
    return true;
  }

  async function clear(tabId, command) {
    await chrome.tabs.sendMessage(tabId, {
      type: "A2_PROMPT_GATE_BRIDGE_BYPASS_CLEAR",
      command_id: String(command?.command_id || "")
    }).catch(() => null);
  }

  const originalGlm = globalThis.A2_GLM_TRUSTED_SEND;
  if (typeof originalGlm === "function") {
    globalThis.A2_GLM_TRUSTED_SEND = async (tabId, command) => {
      const armed = await arm(tabId, command, 15000);
      try {
        return await originalGlm(tabId, command);
      } finally {
        if (armed) await clear(tabId, command);
      }
    };
  }
})();
