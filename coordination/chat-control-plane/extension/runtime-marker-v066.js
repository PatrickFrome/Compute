(() => {
  "use strict";
  const RUNTIME = "0.6.6-final.1";
  globalThis.A2_OPERATOR_RUNTIME = RUNTIME;
  globalThis.A2_FINAL_RUNTIME = RUNTIME;
  chrome.storage.local.set({ operatorRuntime: RUNTIME }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.operatorRuntime) return;
    if (String(changes.operatorRuntime.newValue || "") === RUNTIME) return;
    chrome.storage.local.set({ operatorRuntime: RUNTIME }).catch(() => {});
  });
})();
