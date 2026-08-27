(() => {
  "use strict";

  const RUNTIME = "0.6.5-final.1";
  const originalRequest = globalThis.A2_BRIDGE_REQUEST;
  if (typeof originalRequest !== "function") throw new Error("v065_bridge_runtime_dependency_missing");

  globalThis.A2_BRIDGE_REQUEST = async (path, init = {}) => {
    if (String(path || "") !== "/v1/commands/next" || typeof init?.body !== "string") {
      return originalRequest(path, init);
    }
    let body;
    try { body = JSON.parse(init.body); }
    catch (_) { return originalRequest(path, init); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return originalRequest(path, init);
    return originalRequest(path, {
      ...init,
      body: JSON.stringify({ ...body, operator_runtime: RUNTIME })
    });
  };

  globalThis.A2_FINAL_RUNTIME = RUNTIME;
})();
