(() => {
  "use strict";
  const RUNTIME = "0.7.0-dev.2";
  const descriptor = Object.freeze({
    schema: "metaengine.a2-browser-operator.runtime.v1",
    version: RUNTIME,
    milestone: "R3_TARGET_REGISTRY_V1"
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
