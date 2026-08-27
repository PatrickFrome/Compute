(() => {
  "use strict";

  const LEGACY_BASE = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v3-canary";
  const SIGNED_BASE = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4-canary";
  const SIGNED_RUNTIME_PREFIX = "/a2-browser-supervisor-v4-canary";
  const PROFILE = "A2_DEVICE_HTTP_SIGNATURE_V1";
  const RECOVERABLE_IDENTITY_REASONS = new Set(["DEVICE_NOT_FOUND", "DEVICE_REVOKED", "DEVICE_BINDING_MISMATCH"]);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let enrollmentPromise = null;

  function mappedSupervisorUrl(value) {
    let url;
    try { url = new URL(typeof value === "string" ? value : value?.url || ""); }
    catch (_) { return null; }
    const legacy = new URL(LEGACY_BASE);
    if (url.origin !== legacy.origin) return null;
    if (url.pathname !== legacy.pathname && !url.pathname.startsWith(`${legacy.pathname}/`)) return null;
    const suffix = url.pathname.slice(legacy.pathname.length);
    const signed = new URL(`${SIGNED_BASE}${suffix || ""}`);
    signed.search = url.search;
    return { url: signed.toString(), routePath: suffix || "/", signaturePath: `${SIGNED_RUNTIME_PREFIX}${suffix || ""}` };
  }

  async function ensureEnrollment(clientId, pairingSecret, force = false) {
    if (typeof globalThis.A2_DEVICE_STATUS !== "function" || typeof globalThis.A2_DEVICE_ENROLL !== "function") {
      throw new Error("supervisor_device_identity_unavailable");
    }
    if (!force) {
      const status = await globalThis.A2_DEVICE_STATUS();
      if (status?.enrolled === true && status?.device_id) return status;
    }
    if (enrollmentPromise) return enrollmentPromise;
    enrollmentPromise = (async () => {
      if (force && typeof globalThis.A2_DEVICE_CLEAR_ENROLLMENT === "function") await globalThis.A2_DEVICE_CLEAR_ENROLLMENT();
      await globalThis.A2_DEVICE_ENROLL(SIGNED_BASE, clientId, pairingSecret);
      const status = await globalThis.A2_DEVICE_STATUS();
      if (status?.enrolled !== true || !status?.device_id) throw new Error("supervisor_device_enrollment_incomplete");
      return status;
    })().finally(() => { enrollmentPromise = null; });
    return enrollmentPromise;
  }

  async function signedFetch(mapped, init, clientId) {
    if (typeof globalThis.A2_DEVICE_SIGN_REQUEST !== "function") throw new Error("supervisor_device_signer_unavailable");
    const method = String(init?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : (init?.body == null ? "" : String(init.body));
    const signature = await globalThis.A2_DEVICE_SIGN_REQUEST(method, mapped.signaturePath, body);
    if (!signature || signature.profile !== PROFILE || !signature.device_id) throw new Error("supervisor_device_signature_unavailable");
    const headers = new Headers(init?.headers || {});
    headers.delete("x-a2-chat-bridge-secret");
    headers.set("x-a2-chat-bridge-client", clientId);
    headers.set("x-a2-device-profile", signature.profile);
    headers.set("x-a2-device-id", signature.device_id);
    headers.set("x-a2-device-timestamp", signature.timestamp);
    headers.set("x-a2-device-nonce", signature.nonce);
    headers.set("x-a2-device-body-sha256", signature.body_sha256);
    headers.set("x-a2-device-signature", signature.signature_b64url);
    return nativeFetch(mapped.url, { ...init, method, headers, cache: "no-store" });
  }

  async function authReason(response) {
    if (response?.status !== 401) return null;
    try {
      const body = await response.clone().json();
      return String(body?.reason || body?.error || "").toUpperCase();
    } catch (_) { return null; }
  }

  globalThis.fetch = async (input, init = {}) => {
    const mapped = mappedSupervisorUrl(input);
    if (!mapped) return nativeFetch(input, init);

    const sourceHeaders = new Headers(init?.headers || {});
    const pairingSecret = String(sourceHeaders.get("x-a2-chat-bridge-secret") || "");
    const clientId = String(sourceHeaders.get("x-a2-chat-bridge-client") || "").trim().slice(0, 160);
    if (pairingSecret.length < 32) throw new Error("supervisor_device_pairing_secret_missing");
    if (!clientId) throw new Error("supervisor_device_client_id_missing");

    await ensureEnrollment(clientId, pairingSecret, false);
    let response = await signedFetch(mapped, init, clientId);
    const reason = await authReason(response);
    if (!RECOVERABLE_IDENTITY_REASONS.has(reason)) return response;

    await ensureEnrollment(clientId, pairingSecret, true);
    response = await signedFetch(mapped, init, clientId);
    return response;
  };

  globalThis.A2_SUPERVISOR_DEVICE_TRANSPORT = Object.freeze({
    profile: PROFILE,
    legacy_base: LEGACY_BASE,
    signed_base: SIGNED_BASE,
    signed_runtime_prefix: SIGNED_RUNTIME_PREFIX,
    mode: "DEVICE_SIGNED_NO_BEARER_FALLBACK"
  });
})();
