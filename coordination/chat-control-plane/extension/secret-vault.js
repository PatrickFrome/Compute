(() => {
  "use strict";

  const DB_NAME = "metaengine-a2-chat-bridge";
  const DB_VERSION = 1;
  const STORE = "secrets";
  const PAIRING_KEY = "pairing_secret";
  const BOOTSTRAP_EPOCH_KEY = "a2PairingBootstrapEpoch";
  const bootstrap = globalThis.A2_BRIDGE_BOOTSTRAP || {};

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("pairing_vault_open_failed"));
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let value;
        try { value = fn(store); } catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(value?.result);
        tx.onerror = () => reject(tx.error || new Error("pairing_vault_transaction_failed"));
        tx.onabort = () => reject(tx.error || new Error("pairing_vault_transaction_aborted"));
      });
    } finally {
      db.close();
    }
  }

  async function setPairingSecret(secret) {
    const value = String(secret || "").trim();
    if (value.length < 32 || value.length > 4096) throw new Error("pairing_secret_invalid_length");
    await withStore("readwrite", (store) => store.put(value, PAIRING_KEY));
    return true;
  }

  async function getPairingSecret() {
    const value = await withStore("readonly", (store) => store.get(PAIRING_KEY));
    const secret = String(value || "");
    if (secret.length < 32) throw new Error("bridge_pairing_secret_missing_or_short");
    return secret;
  }

  async function hasPairingSecret() {
    try { return (await getPairingSecret()).length >= 32; } catch (_) { return false; }
  }

  async function migrateLegacySecret() {
    const stored = await chrome.storage.local.get(["bridgeSecret", BOOTSTRAP_EPOCH_KEY]);
    const bootstrapSecret = String(bootstrap.bridgeSecret || "").trim();
    const bootstrapEpoch = String(bootstrap.pairingEpoch || "").trim();
    const legacy = String(stored.bridgeSecret || "").trim();

    // A personalized bundle may intentionally rotate a stale vault credential.
    // The embedded token is applied once per explicit pairingEpoch. After that,
    // a manual token update remains authoritative across MV3 worker restarts.
    if (bootstrapSecret.length >= 32 && bootstrapEpoch && stored[BOOTSTRAP_EPOCH_KEY] !== bootstrapEpoch) {
      await setPairingSecret(bootstrapSecret);
      await chrome.storage.local.set({ [BOOTSTRAP_EPOCH_KEY]: bootstrapEpoch });
    } else if (!(await hasPairingSecret())) {
      const seed = legacy || bootstrapSecret;
      if (seed.length >= 32) await setPairingSecret(seed);
    }

    if (stored.bridgeSecret !== undefined) await chrome.storage.local.remove("bridgeSecret");
  }

  const ready = migrateLegacySecret();
  globalThis.A2_SECRET_VAULT_READY = ready;
  globalThis.A2_GET_PAIRING_SECRET = async () => { await ready; return getPairingSecret(); };
  globalThis.A2_SET_PAIRING_SECRET = async (secret) => { await ready; return setPairingSecret(secret); };
  globalThis.A2_HAS_PAIRING_SECRET = async () => { await ready; return hasPairingSecret(); };
})();
