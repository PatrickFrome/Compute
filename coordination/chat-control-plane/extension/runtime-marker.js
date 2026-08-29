(() => {
  "use strict";
  const RUNTIME = "0.8.0";
  const descriptor = Object.freeze({
    schema: "metaengine.a2-browser-operator.runtime.v2",
    version: RUNTIME,
    milestone: "GPT_FLEET_RUNTIME_V1",
    roadmap_state: "R9_R16_EXTENSION_INTEGRATION",
    release_channel: "candidate",
    provider_architecture: "PROVIDER_NAMES_ARE_POLICIES_NOT_ARCHITECTURE",
    browser_provider_policy: "OPENAI_WEB_CHAT_ONLY",
    external_peer_transport: "MAILBOX_ONLY",
    authority_effect: false
  });
  globalThis.A2_RUNTIME = descriptor;
  globalThis.A2_OPERATOR_RUNTIME = RUNTIME;
  globalThis.A2_FINAL_RUNTIME = RUNTIME;
  chrome.storage.local.set({ operatorRuntime: RUNTIME }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.operatorRuntime) return;
    if (String(changes.operatorRuntime.newValue || "") === RUNTIME) return;
    chrome.storage.local.set({ operatorRuntime: RUNTIME }).catch(() => {});
  });
})();
