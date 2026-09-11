(() => {
  "use strict";

  const bootstrap = globalThis.A2_BRIDGE_BOOTSTRAP || {};
  const LEGACY_BASE = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v3-canary";
  const SIGNED_BASE = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4";
  const SIGNED_RUNTIME_PREFIX = "/a2-browser-supervisor-v4";
  const HEALTH_URL = `${SIGNED_BASE}/health`;
  const PROFILE = "A2_DEVICE_HTTP_SIGNATURE_V1";
  // Intentionally retain the V067 key so an in-session upgrade can reconcile an existing terminal hold.
  const HOLD_KEY = "a2SupervisorEnrollmentHoldV067";
  const TRANSIENT_BASE_MS = 30_000;
  const TRANSIENT_MAX_MS = 5 * 60_000;
  const TERMINAL_RECONCILE_BASE_MS = 60_000;
  const TERMINAL_RECONCILE_JITTER_MS = 30_000;
  const TERMINAL_RECONCILE_LIMIT = 1;
  const RECOVERABLE_TERMINAL_REASONS = new Set(["EMBEDDED_BOOTSTRAP_ROTATION_FAILED"]);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let enrollmentPromise = null;
  let reconciliationPromise = null;

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
    return { url: signed.toString(), signaturePath: `${SIGNED_RUNTIME_PREFIX}${suffix || ""}` };
  }

  function pairingEpoch() { return String(bootstrap.pairingEpoch || "unprovisioned").slice(0, 160); }
  function enrollmentSecret(sourceHeaders) {
    const dedicated = String(bootstrap.supervisorBootstrapSecret || "").trim();
    if (dedicated.length >= 32) return dedicated;
    return String(sourceHeaders.get("x-a2-chat-bridge-secret") || "").trim();
  }
  function jitterMs() {
    try {
      const row = new Uint32Array(1);
      crypto.getRandomValues(row);
      return Number(row[0] % (TERMINAL_RECONCILE_JITTER_MS + 1));
    } catch (_) {
      return 0;
    }
  }
  function nextTerminalReconcileAt() {
    return new Date(Date.now() + TERMINAL_RECONCILE_BASE_MS + jitterMs()).toISOString();
  }
  async function readHold() {
    const row = (await chrome.storage.session.get(HOLD_KEY))[HOLD_KEY] || null;
    if (!row || row.epoch !== pairingEpoch()) return null;
    return row;
  }
  async function clearHold() { await chrome.storage.session.remove(HOLD_KEY); }
  async function storeHold(error) {
    const previous = await readHold();
    const attempts = Math.max(0, Number(previous?.attempts || 0)) + 1;
    const terminal = error?.a2Terminal === true;
    const retryMs = terminal ? null : Math.min(TRANSIENT_MAX_MS, TRANSIENT_BASE_MS * (2 ** Math.min(4, attempts - 1)));
    const row = {
      schema: "metaengine.a2-browser-supervisor.enrollment-hold.v2",
      epoch: pairingEpoch(), terminal, attempts,
      status: Number(error?.a2HttpStatus || 0) || null,
      reason: String(error?.a2ServerReason || error?.message || "enrollment_failed").slice(0, 200),
      observed_at: new Date().toISOString(),
      next_retry_at: retryMs == null ? null : new Date(Date.now() + retryMs).toISOString(),
      reconcile_after: terminal ? nextTerminalReconcileAt() : null,
      reconcile_attempts: Math.max(0, Number(previous?.reconcile_attempts || 0)),
      last_reconcile_at: previous?.last_reconcile_at || null,
      last_reconcile_result: previous?.last_reconcile_result || null
    };
    await chrome.storage.session.set({ [HOLD_KEY]: row });
    return row;
  }
  function holdError(row) {
    const error = new Error(row?.terminal ? `supervisor_device_enrollment_terminal_hold:${row.reason}` : `supervisor_device_enrollment_backoff:${row.reason}`);
    error.a2ExecutionClass = "BLOCKED";
    error.a2EnrollmentHold = row;
    return error;
  }

  async function recoveryCapability() {
    const response = await nativeFetch(HEALTH_URL, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" }
    });
    if (!response?.ok) return { supported: false, reason: `health_http_${Number(response?.status || 0)}` };
    const body = await response.json().catch(() => null);
    const supported = body?.enrollment_recovery_after_rotation === true &&
      body?.embedded_bootstrap_rotation === true &&
      String(body?.profile || "") === PROFILE;
    return {
      supported,
      reason: supported ? "RECOVERY_CAPABILITY_CONFIRMED" : "RECOVERY_CAPABILITY_ABSENT",
      schema: String(body?.schema || "").slice(0, 120) || null
    };
  }

  async function maybeReconcileTerminalHold(row) {
    if (!row?.terminal) return false;
    const reason = String(row.reason || "").toUpperCase();
    if (!RECOVERABLE_TERMINAL_REASONS.has(reason)) return false;
    if (Math.max(0, Number(row.reconcile_attempts || 0)) >= TERMINAL_RECONCILE_LIMIT) return false;
    const after = Date.parse(String(row.reconcile_after || row.observed_at || ""));
    if (Number.isFinite(after) && Date.now() < after) return false;
    if (reconciliationPromise) return reconciliationPromise;
    reconciliationPromise = (async () => {
      let result;
      try { result = await recoveryCapability(); }
      catch (error) { result = { supported: false, reason: `health_probe_failed:${String(error?.message || error).slice(0, 120)}` }; }
      const latest = await readHold();
      if (!latest?.terminal || String(latest.reason || "").toUpperCase() !== reason) return false;
      const next = {
        ...latest,
        reconcile_after: nextTerminalReconcileAt(),
        last_reconcile_at: new Date().toISOString(),
        last_reconcile_result: String(result.reason || "UNKNOWN").slice(0, 160)
      };
      if (result.supported === true) {
        next.reconcile_attempts = Math.max(0, Number(latest.reconcile_attempts || 0)) + 1;
        next.reconcile_after = null;
        await chrome.storage.session.set({ [HOLD_KEY]: next });
        return true;
      }
      await chrome.storage.session.set({ [HOLD_KEY]: next });
      return false;
    })().finally(() => { reconciliationPromise = null; });
    return reconciliationPromise;
  }

  async function assertEnrollmentAllowed() {
    const row = await readHold();
    if (!row) return;
    if (row.terminal) {
      if (await maybeReconcileTerminalHold(row)) return;
      throw holdError(await readHold() || row);
    }
    const retryAt = Date.parse(String(row.next_retry_at || ""));
    if (Number.isFinite(retryAt) && Date.now() < retryAt) throw holdError(row);
  }

  async function ensureEnrollment(clientId, supervisorSecret) {
    if (typeof globalThis.A2_DEVICE_STATUS !== "function" || typeof globalThis.A2_DEVICE_ENROLL !== "function") throw new Error("supervisor_device_identity_unavailable");
    const status = await globalThis.A2_DEVICE_STATUS();
    if (status?.enrolled === true && status?.device_id) { await clearHold(); return status; }
    await assertEnrollmentAllowed();
    if (enrollmentPromise) return enrollmentPromise;
    enrollmentPromise = (async () => {
      try {
        await globalThis.A2_DEVICE_ENROLL(SIGNED_BASE, clientId, supervisorSecret);
        const next = await globalThis.A2_DEVICE_STATUS();
        if (next?.enrolled !== true || !next?.device_id) throw new Error("supervisor_device_enrollment_incomplete");
        await clearHold();
        return next;
      } catch (error) {
        const row = await storeHold(error);
        throw holdError(row);
      }
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
    try { const body = await response.clone().json(); return String(body?.reason || body?.error || "").toUpperCase(); }
    catch (_) { return null; }
  }

  globalThis.fetch = async (input, init = {}) => {
    const mapped = mappedSupervisorUrl(input);
    if (!mapped) return nativeFetch(input, init);
    const sourceHeaders = new Headers(init?.headers || {});
    const supervisorSecret = enrollmentSecret(sourceHeaders);
    const clientId = String(sourceHeaders.get("x-a2-chat-bridge-client") || "").trim().slice(0, 160);
    if (supervisorSecret.length < 32) throw new Error("supervisor_device_bootstrap_secret_missing");
    if (!clientId) throw new Error("supervisor_device_client_id_missing");
    await ensureEnrollment(clientId, supervisorSecret);
    const response = await signedFetch(mapped, init, clientId);
    const reason = await authReason(response);
    if (["DEVICE_NOT_FOUND", "DEVICE_REVOKED", "DEVICE_BINDING_MISMATCH"].includes(reason)) {
      const error = new Error(`supervisor_device_reprovision_required:${reason}`);
      error.a2ExecutionClass = "BLOCKED";
      throw error;
    }
    return response;
  };

  globalThis.A2_SUPERVISOR_DEVICE_TRANSPORT = Object.freeze({
    profile: PROFILE, legacy_base: LEGACY_BASE, signed_base: SIGNED_BASE,
    signed_runtime_prefix: SIGNED_RUNTIME_PREFIX, mode: "DEVICE_SIGNED_NO_BEARER_FALLBACK",
    credential_mode: "SCOPED_SINGLE_USE_BOOTSTRAP_THEN_DEVICE_GRANT",
    enrollment_hold_key: HOLD_KEY,
    enrollment_reconciliation: "KNOWN_TERMINAL_SERVER_CAPABILITY_ONCE",
    terminal_reconcile_limit: TERMINAL_RECONCILE_LIMIT
  });
})();
