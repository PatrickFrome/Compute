(() => {
  "use strict";

  const SAFE = "SAFE_RETRY_PRE_ACTUATION";

  function typedError(message) {
    const error = new Error(message);
    error.a2ExecutionClass = SAFE;
    return error;
  }

  function autonomousDisabled() {
    return globalThis.A2_COMPAT_GET?.("kill_switches.autonomous_send_disabled", false) === true;
  }

  function assertAutonomousAllowed() {
    if (autonomousDisabled()) throw typedError("compat_kill_switch_autonomous_send_disabled");
  }

  // Prompt-gate bypass is intentionally armed inside each trusted transport at
  // the last reversible boundary. GLM arms only after durable DISPATCHED and
  // immediately before mouseReleased; ChatGPT arms immediately before the
  // durable Enter sequence. This wrapper enforces only the global kill switch.
  const originalGlm = globalThis.A2_GLM_TRUSTED_SEND;
  if (typeof originalGlm === "function") {
    globalThis.A2_GLM_TRUSTED_SEND = async (tabId, command) => {
      assertAutonomousAllowed();
      return originalGlm(tabId, command);
    };
  }

  const originalChatgpt = globalThis.A2_CHATGPT_TRUSTED_SEND;
  if (typeof originalChatgpt === "function") {
    globalThis.A2_CHATGPT_TRUSTED_SEND = async (tabId, command) => {
      assertAutonomousAllowed();
      return originalChatgpt(tabId, command);
    };
  }
})();
