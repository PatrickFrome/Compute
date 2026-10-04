(() => {
  "use strict";

  const bootstrap = globalThis.A2_BRIDGE_BOOTSTRAP || {};
  const DEFAULT_REMOTE = String(bootstrap.daemonUrl || "https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-chat-bridge-remote").replace(/\/+$/, "");
  const RETIRED_REMOTE = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote";

  function normalizeBase(value) {
    const url = new URL(String(value || DEFAULT_REMOTE));
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${url.pathname}`;
  }

  async function bridgeBase() {
    const stored = await chrome.storage.local.get("daemonUrl");
    const candidate = normalizeBase(stored.daemonUrl || DEFAULT_REMOTE);
    if (candidate === RETIRED_REMOTE) {
      // Upgrade repair only: old recovery-project routing is no longer an
      // execution endpoint. Rebind to the current Client project without
      // changing pairing/device authority.
      await chrome.storage.local.set({ daemonUrl: DEFAULT_REMOTE });
      return DEFAULT_REMOTE;
    }
    return candidate;
  }

  async function clientId() {
    const stored = await chrome.storage.local.get("clientId");
    const current = String(stored.clientId || "");
    if (current) return current;
    const next = crypto.randomUUID();
    await chrome.storage.local.set({ clientId: next });
    return next;
  }

  async function request(path, init = {}) {
    if (typeof globalThis.A2_GET_PAIRING_SECRET !== "function") throw new Error("pairing_vault_unavailable");
    const [base, secret, id] = await Promise.all([
      bridgeBase(),
      globalThis.A2_GET_PAIRING_SECRET(),
      clientId()
    ]);
    const headers = new Headers(init.headers || {});
    headers.set("content-type", "application/json");
    headers.set("x-a2-chat-bridge-secret", secret);
    headers.set("x-a2-chat-bridge-client", id);
    return fetch(`${base}${String(path || "")}`, { ...init, headers, cache: "no-store" });
  }

  globalThis.A2_BRIDGE_REQUEST = request;
  globalThis.A2_BRIDGE_CLIENT_ID = clientId;
  globalThis.A2_BRIDGE_BASE = bridgeBase;
})();
