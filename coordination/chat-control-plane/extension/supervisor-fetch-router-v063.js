(() => {
  "use strict";

  const nativeFetch = globalThis.A2_SUPERVISOR_NATIVE_FETCH;
  const signedRequest = globalThis.A2_SUPERVISOR_SIGNED_REQUEST;
  if (typeof nativeFetch !== "function" || typeof signedRequest !== "function") throw new Error("supervisor_signed_transport_not_ready");

  const ROUTES = new Map([
    ["https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v2-canary", true],
    ["https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v3-canary", true]
  ]);

  globalThis.fetch = async (input, init = {}) => {
    const raw = typeof input === "string" ? input : input?.url;
    if (typeof raw === "string") {
      for (const base of ROUTES.keys()) {
        if (raw === base || raw.startsWith(`${base}/`)) {
          const path = raw.slice(base.length) || "/";
          return signedRequest(path, init);
        }
      }
    }
    return nativeFetch(input, init);
  };
})();
