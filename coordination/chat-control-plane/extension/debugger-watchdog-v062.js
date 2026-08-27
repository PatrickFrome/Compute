(() => {
  "use strict";

  const rawRun = globalThis.A2_DEBUGGER_RUN;
  if (typeof rawRun !== "function") return;

  const DEFAULT_TIMEOUT_MS = 30_000;
  const MARKER_KEY = "a2DebuggerWatchdogRecoveryV062";

  function timeoutMs() {
    const test = Number(globalThis.A2_DEBUGGER_WATCHDOG_TEST_MS);
    return Number.isFinite(test) && test >= 10 ? Math.min(test, 120_000) : DEFAULT_TIMEOUT_MS;
  }

  function run(tabId, owner, operation) {
    const rawPromise = Promise.resolve().then(() => rawRun(tabId, owner, operation));
    const ms = timeoutMs();
    let timer = null;
    const watchdog = new Promise(() => {
      timer = setTimeout(async () => {
        const marker = {
          schema: "metaengine.a2-debugger-watchdog.v1",
          reason: "debugger_watchdog_timeout",
          tab_id: Number(tabId),
          owner: String(owner || "anonymous").slice(0, 96),
          timeout_ms: ms,
          at: new Date().toISOString(),
          recovery: "SERVICE_WORKER_RELOAD_WITH_DURABLE_LEDGER",
          authority_effect: false
        };
        await chrome.storage.local.set({ [MARKER_KEY]: marker }).catch(() => {});
        chrome.runtime.reload();
      }, ms);
    });
    return Promise.race([rawPromise, watchdog]).finally(() => { if (timer) clearTimeout(timer); });
  }

  globalThis.A2_DEBUGGER_RUN_RAW_V062 = rawRun;
  globalThis.A2_DEBUGGER_RUN = run;
})();
