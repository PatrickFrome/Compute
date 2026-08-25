(() => {
"use strict";

const originalFetch = globalThis.fetch.bind(globalThis);
const bootstrap = globalThis.A2_BRIDGE_BOOTSTRAP || {};

function isBridgeRequest(value) {
  try {
    const url = new URL(typeof value === "string" ? value : value?.url || String(value));
    if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) return true;
    const remote = new URL(String(bootstrap.daemonUrl || ""));
    return url.protocol === "https:" && url.origin === remote.origin &&
      (url.pathname === remote.pathname || url.pathname.startsWith(`${remote.pathname}/`));
  } catch (_) {
    return false;
  }
}

async function pairingSecret() {
  const stored = await chrome.storage.local.get("bridgeSecret");
  const secret = String(stored.bridgeSecret || bootstrap.bridgeSecret || "");
  if (secret.length < 32) throw new Error("bridge_pairing_secret_missing_or_short");
  return secret;
}

globalThis.fetch = async (input, init = {}) => {
  if (!isBridgeRequest(input)) return originalFetch(input, init);
  const headers = new Headers(init.headers || {});
  headers.set("x-a2-chat-bridge-secret", await pairingSecret());
  return originalFetch(input, { ...init, headers });
};

})();
