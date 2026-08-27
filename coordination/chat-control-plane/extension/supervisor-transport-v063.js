(() => {
  "use strict";

  const DEVICE_AUTH_URL = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-device-auth-v2-canary";
  const SUPERVISOR_URL = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4-auth-canary";
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let enrollmentPromise = null;

  async function ensureDevice() {
    if (typeof globalThis.A2_DEVICE_STATUS !== "function" || typeof globalThis.A2_DEVICE_ENROLL !== "function") {
      throw new Error("supervisor_device_identity_unavailable");
    }
    const current = await globalThis.A2_DEVICE_STATUS();
    if (current?.enrolled === true && current?.device_id) return current;
    if (enrollmentPromise) return enrollmentPromise;
    enrollmentPromise = (async () => {
      if (typeof globalThis.A2_GET_PAIRING_SECRET !== "function") throw new Error("supervisor_pairing_vault_unavailable");
      if (typeof globalThis.A2_BRIDGE_CLIENT_ID !== "function") throw new Error("supervisor_client_identity_unavailable");
      const [secret, client] = await Promise.all([
        globalThis.A2_GET_PAIRING_SECRET(),
        globalThis.A2_BRIDGE_CLIENT_ID()
      ]);
      await globalThis.A2_DEVICE_ENROLL(DEVICE_AUTH_URL, client, secret);
      const enrolled = await globalThis.A2_DEVICE_STATUS();
      if (enrolled?.enrolled !== true || !enrolled?.device_id) throw new Error("supervisor_device_enrollment_readback_failed");
      return enrolled;
    })().finally(() => { enrollmentPromise = null; });
    return enrollmentPromise;
  }

  async function signedRequest(path, init = {}) {
    if (typeof globalThis.A2_DEVICE_SIGN_REQUEST !== "function") throw new Error("supervisor_device_signer_unavailable");
    if (typeof globalThis.A2_BRIDGE_CLIENT_ID !== "function") throw new Error("supervisor_client_identity_unavailable");
    await ensureDevice();
    const method = String(init.method || "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : init.body == null ? "" : String(init.body);
    const [client, signature] = await Promise.all([
      globalThis.A2_BRIDGE_CLIENT_ID(),
      globalThis.A2_DEVICE_SIGN_REQUEST(method, path, body)
    ]);
    if (!signature?.device_id || !signature?.signature_b64url) throw new Error("supervisor_device_signature_missing");
    const headers = new Headers(init.headers || {});
    headers.delete("x-a2-chat-bridge-secret");
    headers.set("content-type", "application/json");
    headers.set("x-a2-chat-bridge-client", client);
    headers.set("x-a2-device-profile", signature.profile);
    headers.set("x-a2-device-id", signature.device_id);
    headers.set("x-a2-device-timestamp", signature.timestamp);
    headers.set("x-a2-device-nonce", signature.nonce);
    headers.set("x-a2-device-body-sha256", signature.body_sha256);
    headers.set("x-a2-device-signature", signature.signature_b64url);
    return nativeFetch(`${SUPERVISOR_URL}${path}`, { ...init, method, body: method === "GET" ? undefined : body, headers, cache: "no-store" });
  }

  globalThis.A2_SUPERVISOR_NATIVE_FETCH = nativeFetch;
  globalThis.A2_SUPERVISOR_DEVICE_ENSURE = ensureDevice;
  globalThis.A2_SUPERVISOR_SIGNED_REQUEST = signedRequest;
  globalThis.A2_SUPERVISOR_SIGNED_URL = SUPERVISOR_URL;
})();
