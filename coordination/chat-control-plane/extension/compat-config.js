(() => {
  "use strict";

  const PACK_SCHEMA = "metaengine.a2-browser-operator.compat-pack.v1";
  const STORAGE_KEY = "a2OperatorCompatPackV1";
  const STATUS_KEY = "a2OperatorCompatStatusV1";
  const REFRESH_ALARM = "a2-operator-compat-refresh";
  const MAX_PACK_BYTES = 65536;
  const MAX_PACK_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
  const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
  let activeEnvelope = null;
  let activePayload = Object.freeze({});

  const ALLOWED_FEATURES = new Set(["point_click_enabled", "screenshot_sensor_enabled", "prompt_gate_enabled", "semantic_actions_enabled"]);
  const ALLOWED_KILL_SWITCHES = new Set(["autonomous_send_disabled", "operator_actions_disabled"]);
  const ALLOWED_TIMEOUTS = Object.freeze({
    frame_max_age_ms: [5000, 120000],
    send_ready_ms: [500, 15000],
    prompt_allow_once_ms: [2000, 20000],
    perception_capture_timeout_ms: [1000, 30000]
  });
  const ALLOWED_ADAPTER_FIELDS = new Set(["composer_selectors", "send_selectors", "stop_selectors", "send_labels", "stop_labels"]);
  const ALLOWED_PLATFORMS = new Set(["CHATGPT", "GLM_ZAI"]);

  function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }

  async function sha256Text(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text ?? "")));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function fromBase64Url(value) {
    const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = text + "=".repeat((4 - (text.length % 4 || 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }

  function versionTuple(value) {
    const parts = String(value || "0").split(".").slice(0, 4).map((part) => {
      const match = String(part).match(/^\d+/);
      return match ? Number(match[0]) : 0;
    });
    while (parts.length < 4) parts.push(0);
    return parts;
  }

  function compareVersion(a, b) {
    const aa = versionTuple(a), bb = versionTuple(b);
    for (let i = 0; i < aa.length; i += 1) {
      if (aa[i] < bb[i]) return -1;
      if (aa[i] > bb[i]) return 1;
    }
    return 0;
  }

  function assertBooleanMap(value, allowed, name) {
    if (value == null) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`compat_${name}_invalid`);
    for (const [key, entry] of Object.entries(value)) {
      if (!allowed.has(key) || typeof entry !== "boolean") throw new Error(`compat_${name}_field_invalid:${key}`);
    }
  }

  function assertStringList(value, field, maxItems, maxChars) {
    if (!Array.isArray(value) || value.length > maxItems) throw new Error(`compat_${field}_invalid`);
    for (const item of value) {
      if (typeof item !== "string" || !item.trim() || item.length > maxChars) throw new Error(`compat_${field}_item_invalid`);
      const lower = item.toLowerCase();
      if (lower.includes("javascript:") || lower.includes("data:text/html") || lower.includes("<script")) throw new Error(`compat_${field}_unsafe_string`);
    }
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("compat_payload_invalid");
    const allowedTop = new Set(["features", "kill_switches", "timeouts", "adapters", "protocol"]);
    for (const key of Object.keys(payload)) if (!allowedTop.has(key)) throw new Error(`compat_payload_unknown_field:${key}`);

    assertBooleanMap(payload.features, ALLOWED_FEATURES, "features");
    assertBooleanMap(payload.kill_switches, ALLOWED_KILL_SWITCHES, "kill_switches");

    if (payload.timeouts != null) {
      if (!payload.timeouts || typeof payload.timeouts !== "object" || Array.isArray(payload.timeouts)) throw new Error("compat_timeouts_invalid");
      for (const [key, entry] of Object.entries(payload.timeouts)) {
        const range = ALLOWED_TIMEOUTS[key];
        if (!range || !Number.isInteger(entry) || entry < range[0] || entry > range[1]) throw new Error(`compat_timeout_invalid:${key}`);
      }
    }

    if (payload.adapters != null) {
      if (!payload.adapters || typeof payload.adapters !== "object" || Array.isArray(payload.adapters)) throw new Error("compat_adapters_invalid");
      for (const [platform, adapter] of Object.entries(payload.adapters)) {
        if (!ALLOWED_PLATFORMS.has(platform) || !adapter || typeof adapter !== "object" || Array.isArray(adapter)) throw new Error(`compat_adapter_invalid:${platform}`);
        for (const [field, value] of Object.entries(adapter)) {
          if (!ALLOWED_ADAPTER_FIELDS.has(field)) throw new Error(`compat_adapter_field_invalid:${platform}:${field}`);
          if (field.endsWith("_selectors")) assertStringList(value, `${platform}_${field}`, 16, 320);
          else assertStringList(value, `${platform}_${field}`, 24, 160);
        }
      }
    }

    if (payload.protocol != null) {
      if (!payload.protocol || typeof payload.protocol !== "object" || Array.isArray(payload.protocol)) throw new Error("compat_protocol_invalid");
      const allowed = new Set(["minimum_edge_protocol"]);
      for (const [key, value] of Object.entries(payload.protocol)) {
        if (!allowed.has(key) || typeof value !== "string" || !/^[A-Z0-9_.-]{1,96}$/.test(value)) throw new Error(`compat_protocol_field_invalid:${key}`);
      }
    }
    return payload;
  }

  function signedMaterial(envelope) {
    return canonical({
      schema: envelope.schema,
      epoch: envelope.epoch,
      created_at: envelope.created_at,
      expires_at: envelope.expires_at,
      min_extension_version: envelope.min_extension_version || null,
      max_extension_version: envelope.max_extension_version || null,
      payload_sha256: envelope.payload_sha256
    });
  }

  async function importRootKey() {
    const jwk = globalThis.A2_COMPAT_ROOT_JWK;
    if (!jwk || typeof jwk !== "object") throw new Error("compat_root_unprovisioned");
    return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }

  async function verifyEnvelope(envelope, previousEpoch = 0) {
    const serialized = JSON.stringify(envelope || {});
    if (new TextEncoder().encode(serialized).byteLength > MAX_PACK_BYTES) throw new Error("compat_pack_too_large");
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("compat_envelope_invalid");
    const allowedEnvelope = new Set(["schema", "epoch", "created_at", "expires_at", "min_extension_version", "max_extension_version", "payload", "payload_sha256", "signature_b64url"]);
    for (const key of Object.keys(envelope)) if (!allowedEnvelope.has(key)) throw new Error(`compat_envelope_unknown_field:${key}`);
    if (envelope.schema !== PACK_SCHEMA) throw new Error("compat_schema_invalid");
    if (!Number.isInteger(envelope.epoch) || envelope.epoch <= Number(previousEpoch || 0)) throw new Error("compat_epoch_not_monotonic");
    const created = Date.parse(envelope.created_at || ""), expires = Date.parse(envelope.expires_at || "");
    const now = Date.now();
    if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now + MAX_CLOCK_SKEW_MS || expires <= now || expires <= created || expires - created > MAX_PACK_LIFETIME_MS) throw new Error("compat_time_window_invalid");
    const currentVersion = chrome.runtime.getManifest().version;
    if (envelope.min_extension_version && compareVersion(currentVersion, envelope.min_extension_version) < 0) throw new Error("compat_extension_too_old");
    if (envelope.max_extension_version && compareVersion(currentVersion, envelope.max_extension_version) > 0) throw new Error("compat_extension_too_new");

    const payload = validatePayload(envelope.payload);
    const payloadHash = await sha256Text(canonical(payload));
    if (!/^[0-9a-f]{64}$/i.test(String(envelope.payload_sha256 || "")) || payloadHash !== String(envelope.payload_sha256).toLowerCase()) throw new Error("compat_payload_hash_mismatch");
    const signature = fromBase64Url(envelope.signature_b64url);
    if (signature.byteLength < 48 || signature.byteLength > 144) throw new Error("compat_signature_invalid");
    const key = await importRootKey();
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, new TextEncoder().encode(signedMaterial(envelope)));
    if (!ok) throw new Error("compat_signature_rejected");
    return { envelope, payload };
  }

  async function statusPatch(patch) {
    const previous = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] || {};
    await chrome.storage.local.set({ [STATUS_KEY]: { ...previous, ...patch, updated_at: new Date().toISOString() } });
  }

  async function installVerified(envelope, payload) {
    activeEnvelope = envelope;
    activePayload = Object.freeze(structuredClone(payload));
    await chrome.storage.local.set({ [STORAGE_KEY]: envelope });
    await statusPatch({ status: "ACTIVE", epoch: envelope.epoch, expires_at: envelope.expires_at, payload_sha256: envelope.payload_sha256, last_error: null });
    return activePayload;
  }

  async function loadPersisted() {
    if (!globalThis.A2_COMPAT_ROOT_JWK) {
      activeEnvelope = null;
      activePayload = Object.freeze({});
      await statusPatch({ status: "UNPROVISIONED", epoch: null });
      return activePayload;
    }
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || null;
    if (!stored) {
      await statusPatch({ status: "NO_PACK", epoch: null });
      return activePayload;
    }
    try {
      const verified = await verifyEnvelope(stored, Number(stored.epoch || 0) - 1);
      activeEnvelope = verified.envelope;
      activePayload = Object.freeze(structuredClone(verified.payload));
      await statusPatch({ status: "ACTIVE", epoch: stored.epoch, expires_at: stored.expires_at, payload_sha256: stored.payload_sha256, last_error: null });
      return activePayload;
    } catch (error) {
      activeEnvelope = null;
      activePayload = Object.freeze({});
      await chrome.storage.local.remove(STORAGE_KEY);
      await statusPatch({ status: "PERSISTED_REJECTED", epoch: null, last_error: String(error?.message || error) });
      return activePayload;
    }
  }

  async function refresh() {
    if (!globalThis.A2_COMPAT_ROOT_JWK) {
      await statusPatch({ status: "UNPROVISIONED", last_error: null });
      return { applied: false, reason: "ROOT_UNPROVISIONED" };
    }
    if (typeof globalThis.A2_BRIDGE_REQUEST !== "function") throw new Error("compat_bridge_client_unavailable");
    const response = await globalThis.A2_BRIDGE_REQUEST("/v1/compatibility-pack", { method: "GET" });
    if (!response.ok) throw new Error(`compat_http_${response.status}`);
    const envelope = await response.json();
    const previousEpoch = Number(activeEnvelope?.epoch || 0);
    try {
      const verified = await verifyEnvelope(envelope, previousEpoch);
      await installVerified(verified.envelope, verified.payload);
      return { applied: true, epoch: verified.envelope.epoch };
    } catch (error) {
      await statusPatch({ status: activeEnvelope ? "KEEP_LAST_KNOWN_GOOD" : "REJECTED", last_error: String(error?.message || error), rejected_at: new Date().toISOString() });
      throw error;
    }
  }

  function current() { return activePayload; }
  function get(path, fallback = null) {
    const parts = Array.isArray(path) ? path : String(path || "").split(".").filter(Boolean);
    let value = activePayload;
    for (const part of parts) {
      if (!value || typeof value !== "object" || !(part in value)) return fallback;
      value = value[part];
    }
    return value;
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== REFRESH_ALARM) return;
    refresh().catch(() => {});
  });
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 60 }).catch(() => {});
    loadPersisted().then(() => refresh()).catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 60 }).catch(() => {});
    loadPersisted().then(() => refresh()).catch(() => {});
  });

  globalThis.A2_COMPAT_CONFIG = current;
  globalThis.A2_COMPAT_GET = get;
  globalThis.A2_COMPAT_REFRESH = refresh;
  globalThis.A2_COMPAT_VERIFY = verifyEnvelope;

  loadPersisted().catch(() => {});
})();
