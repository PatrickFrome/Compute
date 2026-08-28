const ENVELOPE_SCHEMA = "metaengine.compute.w1-execution-callback-envelope.h205f22.v1";
const MARKER_SCHEMA = "metaengine.compute.w1-execution-marker.h205f22.v1";
const ATTESTATION_SCHEMA = "metaengine.compute.w1-execution-callback-attestation.h205f22.v1";
const ALGORITHM = "ES256-P1363-SHA256";
const DOMAIN = new TextEncoder().encode("METAENGINE:H205F22:W1:EXECUTION-CALLBACK:v1\n");
const MAX_BODY_BYTES = 8192;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_AGE_MS = 5 * 60_000;
const SHA256 = /^[0-9a-f]{64}$/;
const INSTANCE_ID = /^i-[0-9a-f]{8}([0-9a-f]{9})?$/;
const WORKER_ID = /^[A-Za-z0-9._:-]{3,160}$/;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new Error("unsupported_json_value");
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function hex(raw: ArrayBuffer): string {
  return Array.from(new Uint8Array(raw), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(raw: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", raw));
}

function decodeB64u(value: unknown, expectedBytes: number): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.includes("=")) {
    throw new Error("base64url_invalid");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob(normalized);
  const raw = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  if (raw.length !== expectedBytes) throw new Error("base64url_size_invalid");
  return raw;
}

function exactPublicJwk(value: unknown): JsonWebKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("public_jwk_invalid");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "crv,kty,x,y") throw new Error("public_jwk_shape_invalid");
  if (record.kty !== "EC" || record.crv !== "P-256") throw new Error("public_jwk_curve_invalid");
  decodeB64u(record.x, 32);
  decodeB64u(record.y, 32);
  return record as JsonWebKey;
}

function requireNonclaims(marker: Record<string, unknown>): void {
  for (const field of [
    "host_safety_verified",
    "persistent_worker_proof",
    "worker_admitted",
    "w1_verified",
    "canonical",
    "authority_effect",
  ]) {
    if (marker[field] !== false) throw new Error(`marker_nonclaim_invalid:${field}`);
  }
}

function secretApiKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) throw new Error("supabase_secret_keys_missing");
  const parsed = JSON.parse(raw);
  const key = parsed?.default;
  if (typeof key !== "string" || !key.startsWith("sb_secret_")) throw new Error("supabase_secret_key_invalid");
  return key;
}

async function rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("supabase_url_missing");
  const result = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": secretApiKey(),
    },
    body: JSON.stringify(payload),
  });
  const text = await result.text();
  if (!result.ok) throw new Error(`rpc_failed:${name}:${result.status}`);
  return text ? JSON.parse(text) : null;
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return response({ accepted: false, error: "method_not_allowed" }, 405);
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return response({ accepted: false, error: "content_type_required" }, 415);
  }
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return response({ accepted: false, error: "body_too_large" }, 413);
  }

  let envelope: Record<string, unknown>;
  try {
    const raw = new Uint8Array(await req.arrayBuffer());
    if (raw.length < 2 || raw.length > MAX_BODY_BYTES) throw new Error("body_size_invalid");
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("envelope_not_object");
    envelope = parsed as Record<string, unknown>;
  } catch (error) {
    return response({ accepted: false, error: String(error instanceof Error ? error.message : error) }, 400);
  }

  try {
    if (envelope.schema !== ENVELOPE_SCHEMA || envelope.algorithm !== ALGORITHM) {
      throw new Error("envelope_contract_invalid");
    }
    const keyId = envelope.key_id;
    if (typeof keyId !== "string" || !SHA256.test(keyId)) throw new Error("key_id_invalid");
    const marker = envelope.marker;
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) throw new Error("marker_invalid");
    const m = marker as Record<string, unknown>;
    if (m.schema !== MARKER_SCHEMA) throw new Error("marker_schema_invalid");
    if (typeof m.worker_id !== "string" || !WORKER_ID.test(m.worker_id)) throw new Error("worker_id_invalid");
    if (m.provider_kind !== "AWS_EC2" || typeof m.provider_instance_id !== "string" ||
        !INSTANCE_ID.test(m.provider_instance_id)) throw new Error("provider_binding_invalid");
    if (m.callback_key_id !== keyId) throw new Error("marker_key_id_mismatch");
    if (typeof m.callback_challenge_nonce !== "string" || !SHA256.test(m.callback_challenge_nonce)) {
      throw new Error("challenge_nonce_invalid");
    }
    for (const field of ["package_sha256", "payload_lock_sha256", "execution_payload_sha256"]) {
      if (typeof m[field] !== "string" || !SHA256.test(m[field] as string)) throw new Error(`${field}_invalid`);
    }
    if (typeof m.marker_id !== "string" ||
        !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(m.marker_id)) {
      throw new Error("marker_id_invalid");
    }
    requireNonclaims(m);
    const observedAt = Date.parse(String(m.observed_at ?? ""));
    const now = Date.now();
    if (!Number.isFinite(observedAt) || observedAt > now + MAX_CLOCK_SKEW_MS || observedAt < now - MAX_AGE_MS) {
      throw new Error("marker_freshness_invalid");
    }

    const registry = await rpc("compute_fabric_get_w1_callback_key_h205f22", { p_key_id: keyId });
    if (!registry || typeof registry !== "object" || Array.isArray(registry)) throw new Error("callback_key_not_registered");
    const keyRecord = registry as Record<string, unknown>;
    if (keyRecord.key_id !== keyId || keyRecord.algorithm !== ALGORITHM || keyRecord.revoked_at !== null) {
      throw new Error("callback_key_registry_state_invalid");
    }
    if (keyRecord.worker_id !== m.worker_id || keyRecord.provider_instance_id !== m.provider_instance_id) {
      throw new Error("callback_key_subject_mismatch");
    }
    const jwk = exactPublicJwk(keyRecord.public_jwk);
    if (await sha256(bytes(canonical(jwk))) !== keyId) throw new Error("callback_key_id_digest_mismatch");

    const markerCanonical = bytes(canonical(m));
    const signedMessage = concat(DOMAIN, markerCanonical);
    const signedPayloadSha = await sha256(signedMessage);
    if (envelope.signed_payload_sha256 !== signedPayloadSha) throw new Error("signed_payload_hash_mismatch");
    const signature = decodeB64u(envelope.signature_b64u, 64);
    const publicKey = await crypto.subtle.importKey(
      "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, publicKey, signature, signedMessage,
    );
    if (!verified) throw new Error("signature_invalid");

    const receivedAt = new Date().toISOString();
    const callbackReceiptId = crypto.randomUUID();
    const markerBodySha = await sha256(markerCanonical);
    const attestation: Record<string, unknown> = {
      schema: ATTESTATION_SCHEMA,
      callback_receipt_id: callbackReceiptId,
      accepted: true,
      auth_kind: "WORKER_ENROLLMENT_SIGNATURE_V1",
      auth_verified: true,
      marker_id: m.marker_id,
      worker_id: m.worker_id,
      provider_kind: "AWS_EC2",
      provider_instance_id: m.provider_instance_id,
      execution_payload_sha256: m.execution_payload_sha256,
      package_sha256: m.package_sha256,
      payload_lock_sha256: m.payload_lock_sha256,
      marker_body_sha256: markerBodySha,
      received_at: receivedAt,
      key_id: keyId,
      key_enrollment_record_sha256: keyRecord.enrollment_record_sha256,
      challenge_nonce_sha256: await sha256(bytes(m.callback_challenge_nonce as string)),
      signed_payload_sha256: signedPayloadSha,
      signature_sha256: await sha256(signature),
      database_persistence_verified: false,
      persistent_worker_proof: false,
      worker_admitted: false,
      w1_verified: false,
      canonical: false,
      authority_effect: false,
    };
    attestation.attestation_sha256 = await sha256(bytes(canonical(attestation)));

    const persisted = await rpc("compute_fabric_record_w1_execution_callback_h205f22", {
      p_attestation: attestation,
    });
    return response({
      accepted: true,
      auth_verified: true,
      callback_receipt_id: callbackReceiptId,
      marker_id: m.marker_id,
      key_id: keyId,
      marker_body_sha256: markerBodySha,
      persisted_non_authority_receipt: persisted,
    });
  } catch (error) {
    return response(
      { accepted: false, auth_verified: false, error: String(error instanceof Error ? error.message : error) },
      401,
    );
  }
}

Deno.serve(handle);
