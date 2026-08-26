(() => {
  "use strict";

  const DB_NAME = "metaengine-a2-device-identity";
  const DB_VERSION = 1;
  const STORE = "identity";
  const KEYPAIR_ID = "p256_keypair_v1";
  const META_ID = "enrollment_v1";
  const PROFILE = "A2_DEVICE_HTTP_SIGNATURE_V1";
  const MAX_CLOCK_SKEW_MS = 120000;

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("device_identity_db_open_failed"));
    });
  }

  async function withStore(mode, callback) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let request;
        try { request = callback(store); } catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error || new Error("device_identity_transaction_failed"));
        tx.onabort = () => reject(tx.error || new Error("device_identity_transaction_aborted"));
      });
    } finally { db.close(); }
  }

  async function loadKeypair() { return withStore("readonly", (store) => store.get(KEYPAIR_ID)); }
  async function loadEnrollment() { return withStore("readonly", (store) => store.get(META_ID)); }
  async function storeEnrollment(meta) { await withStore("readwrite", (store) => store.put(meta, META_ID)); }
  async function clearEnrollment() { await withStore("readwrite", (store) => store.delete(META_ID)); }

  async function ensureKeypair() {
    let row = await loadKeypair();
    if (row?.privateKey instanceof CryptoKey && row?.publicKey instanceof CryptoKey) {
      if (row.privateKey.extractable === true) throw new Error("device_private_key_extractable_rejected");
      return row;
    }
    // For asymmetric WebCrypto key generation, extractable=false keeps the private
    // signing key non-exportable while the public verification key remains exportable.
    // No private PKCS#8/JWK bytes ever enter JavaScript memory.
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    if (pair.privateKey.extractable === true || pair.publicKey.extractable !== true) throw new Error("device_key_extractability_contract_failed");
    row = { privateKey: pair.privateKey, publicKey: pair.publicKey, created_at: new Date().toISOString(), profile: PROFILE };
    await withStore("readwrite", (store) => store.put(row, KEYPAIR_ID));
    return row;
  }

  async function publicJwk() {
    const row = await ensureKeypair();
    const jwk = await crypto.subtle.exportKey("jwk", row.publicKey);
    if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || typeof jwk?.x !== "string" || typeof jwk?.y !== "string") throw new Error("device_public_jwk_invalid");
    return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, key_ops: ["verify"], ext: true };
  }

  async function sha256Hex(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value ?? "")));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function b64url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function nonce() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return b64url(bytes);
  }

  function canonicalPath(path) {
    const value = String(path || "");
    if (!value.startsWith("/") || value.includes("\n") || value.includes("\r")) throw new Error("device_signature_path_invalid");
    return value;
  }

  async function signingMaterial(method, path, body, timestamp, requestNonce, deviceId) {
    const bodySha256 = await sha256Hex(body || "");
    const normalizedMethod = String(method || "GET").toUpperCase();
    const normalizedPath = canonicalPath(path);
    return {
      bodySha256,
      text: [
        PROFILE,
        `device_id:${String(deviceId || "")}`,
        `method:${normalizedMethod}`,
        `path:${normalizedPath}`,
        `timestamp:${timestamp}`,
        `nonce:${requestNonce}`,
        `body_sha256:${bodySha256}`
      ].join("\n")
    };
  }

  async function signRequest(method, path, body = "") {
    const enrollment = await loadEnrollment();
    if (!enrollment?.device_id || enrollment?.status !== "ACTIVE") return null;
    const row = await ensureKeypair();
    const timestamp = new Date().toISOString();
    const requestNonce = nonce();
    const material = await signingMaterial(method, path, body, timestamp, requestNonce, enrollment.device_id);
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, row.privateKey, new TextEncoder().encode(material.text));
    return {
      profile: PROFILE,
      device_id: enrollment.device_id,
      timestamp,
      nonce: requestNonce,
      body_sha256: material.bodySha256,
      signature_b64url: b64url(new Uint8Array(signature))
    };
  }

  async function enroll(base, clientId, pairingSecret) {
    const secret = String(pairingSecret || "");
    if (secret.length < 32) throw new Error("device_enrollment_pairing_secret_missing");
    const jwk = await publicJwk();
    const response = await fetch(`${String(base).replace(/\/+$/, "")}/v1/device/enroll`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-a2-chat-bridge-secret": secret,
        "x-a2-chat-bridge-client": String(clientId || "")
      },
      body: JSON.stringify({ profile: PROFILE, public_jwk: jwk }),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`device_enrollment_http_${response.status}`);
    const body = await response.json().catch(() => ({}));
    if (!body?.device_id || body?.profile !== PROFILE) throw new Error("device_enrollment_response_invalid");
    const meta = {
      status: "ACTIVE",
      profile: PROFILE,
      device_id: String(body.device_id),
      enrolled_at: new Date().toISOString(),
      server_enrolled_at: body.enrolled_at || null
    };
    await storeEnrollment(meta);
    return meta;
  }

  async function status() {
    const enrollment = await loadEnrollment().catch(() => null);
    const keypair = await loadKeypair().catch(() => null);
    return {
      profile: PROFILE,
      key_present: keypair?.privateKey instanceof CryptoKey && keypair?.publicKey instanceof CryptoKey,
      private_extractable: keypair?.privateKey?.extractable === true,
      public_extractable: keypair?.publicKey?.extractable === true,
      enrolled: enrollment?.status === "ACTIVE" && Boolean(enrollment?.device_id),
      device_id: enrollment?.device_id || null,
      enrolled_at: enrollment?.enrolled_at || null,
      max_clock_skew_ms: MAX_CLOCK_SKEW_MS
    };
  }

  globalThis.A2_DEVICE_PROFILE = PROFILE;
  globalThis.A2_DEVICE_PUBLIC_JWK = publicJwk;
  globalThis.A2_DEVICE_SIGN_REQUEST = signRequest;
  globalThis.A2_DEVICE_ENROLL = enroll;
  globalThis.A2_DEVICE_STATUS = status;
  globalThis.A2_DEVICE_CLEAR_ENROLLMENT = clearEnrollment;
})();
