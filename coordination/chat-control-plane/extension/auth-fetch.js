"use strict";

const originalFetch = globalThis.fetch.bind(globalThis);

function isDaemonRequest(value) {
  try {
    const url = new URL(typeof value === "string" ? value : value?.url || String(value));
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch (_) {
    return false;
  }
}

async function pairingSecret() {
  const stored = await chrome.storage.local.get("bridgeSecret");
  const secret = String(stored.bridgeSecret || "");
  if (secret.length < 32) throw new Error("bridge_pairing_secret_missing_or_short");
  return secret;
}

globalThis.fetch = async (input, init = {}) => {
  if (!isDaemonRequest(input)) return originalFetch(input, init);
  const headers = new Headers(init.headers || {});
  headers.set("x-a2-chat-bridge-secret", await pairingSecret());
  return originalFetch(input, { ...init, headers });
};
