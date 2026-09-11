(() => {
  "use strict";
  const originalRequest = globalThis.A2_BRIDGE_REQUEST;
  if (typeof originalRequest !== "function") throw new Error("bridge_runtime_dependency_missing");
  function runtimeVersion() {
    const value = String(globalThis.A2_RUNTIME?.version || globalThis.A2_OPERATOR_RUNTIME || "").trim();
    if (!value) throw new Error("runtime_version_unavailable");
    return value;
  }
  globalThis.A2_BRIDGE_REQUEST = async (path, init = {}) => {
    if (String(path || "") !== "/v1/commands/next" || typeof init?.body !== "string") return originalRequest(path, init);
    let body;
    try { body = JSON.parse(init.body); } catch (_) { return originalRequest(path, init); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return originalRequest(path, init);
    return originalRequest(path, { ...init, body: JSON.stringify({ ...body, operator_runtime: runtimeVersion() }) });
  };
  globalThis.A2_FINAL_RUNTIME = runtimeVersion();
})();
