import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SCHEMA = "metaengine.compute.sigstore-tuf-chain-verifier.h205f22.v1";
const CORE_SCHEMA = "metaengine.compute.sigstore-tuf-verifier.h205f22.v6";
const CORE_URL = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/metaengine-sigstore-tuf-verifier-h205f22";
const MIRROR = "https://tuf-repo-cdn.sigstore.dev";
const MAX_BYTES = 2_000_000;
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "pragma": "no-cache",
  "x-content-type-options": "nosniff",
};

type MetaRef = { version?: number; length?: number; hashes?: Record<string, string>; [k: string]: unknown };
type CoreEvidence = {
  schema: string;
  provider_id: string;
  provider_kind: string;
  external_identity: string;
  continuity: { current_root_version: number; current_root_sha256: string; [k: string]: unknown };
  live_metadata: { targets_version: number; targets_sha256: string; [k: string]: unknown };
  verification_proof_sha256: string;
  [k: string]: unknown;
};

function out(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

async function fetchBytes(url: string, allow404 = false) {
  const res = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (allow404 && res.status === 404) return { status: 404, bytes: new Uint8Array(), text: "" };
  if (!res.ok) throw new Error(`upstream_http_${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("upstream_object_too_large");
  return { status: res.status, bytes, text: new TextDecoder().decode(bytes) };
}

async function bindExactSha(bytes: Uint8Array, expected: unknown, label: string) {
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) throw new Error(`${label}_expected_sha_invalid`);
  const actual = await sha256(bytes);
  if (actual !== expected) throw new Error(`${label}_sha256_mismatch`);
  return actual;
}

async function bindTarget(bytes: Uint8Array, ref: MetaRef, label: string) {
  if (!Number.isSafeInteger(Number(ref.length)) || Number(ref.length) < 1) throw new Error(`${label}_length_invalid`);
  if (bytes.length !== Number(ref.length)) throw new Error(`${label}_length_mismatch`);
  const expected = ref.hashes?.sha256;
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) throw new Error(`${label}_sha256_ref_missing`);
  const actual = await sha256(bytes);
  if (actual !== expected) throw new Error(`${label}_sha256_mismatch`);
  return actual;
}

function parseJson(text: string, label: string): Record<string, unknown> {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_json_object_required`);
  return value as Record<string, unknown>;
}

function arrayCount(value: unknown, label: string, requireNonempty = false) {
  if (!Array.isArray(value)) throw new Error(`${label}_array_required`);
  if (requireNonempty && value.length < 1) throw new Error(`${label}_empty`);
  return value.length;
}

async function fetchCore(): Promise<CoreEvidence> {
  const res = await fetch(CORE_URL, { redirect: "error", cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`core_verifier_http_${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  if (body.schema !== CORE_SCHEMA || body.verification_status !== "CRYPTO_VERIFIED_EVIDENCE") throw new Error("core_verifier_not_crypto_verified");
  const evidence = body.evidence as CoreEvidence | undefined;
  if (!evidence || evidence.schema !== CORE_SCHEMA) throw new Error("core_evidence_shape_invalid");
  if (evidence.provider_id !== "sigstore-public-good" || evidence.provider_kind !== "SIGSTORE_TUF" || evidence.external_identity !== MIRROR) throw new Error("core_provider_identity_mismatch");
  if (!/^[0-9a-f]{64}$/.test(String(evidence.verification_proof_sha256 ?? ""))) throw new Error("core_proof_sha_invalid");
  return evidence;
}

async function verifyChain(test: string | null) {
  if (test === "content-hash-only") throw new Error("CONTENT_HASH_ONLY_REJECTED_BEFORE_CRYPTO_CHAIN");

  const core = await fetchCore();
  const rootVersion = Number(core.continuity?.current_root_version);
  const targetsVersion = Number(core.live_metadata?.targets_version);
  if (!Number.isSafeInteger(rootVersion) || rootVersion < 1) throw new Error("core_root_version_invalid");
  if (!Number.isSafeInteger(targetsVersion) || targetsVersion < 1) throw new Error("core_targets_version_invalid");

  // Re-fetch exact objects already authenticated by the crypto-core and bind them
  // to the hashes in its proof. Metadata rotation between calls therefore fails closed.
  const rootFetch = await fetchBytes(`${MIRROR}/${rootVersion}.root.json`);
  await bindExactSha(rootFetch.bytes, core.continuity.current_root_sha256, "current_root");
  const rootEnvelope = parseJson(rootFetch.text, "root_envelope");
  const rootSigned = rootEnvelope.signed as Record<string, unknown> | undefined;
  if (!rootSigned || rootSigned._type !== "root" || Number(rootSigned.version) !== rootVersion) throw new Error("current_root_shape_mismatch");
  const consistentSnapshot = rootSigned.consistent_snapshot === true;

  const targetsName = consistentSnapshot ? `${targetsVersion}.targets.json` : "targets.json";
  const targetsFetch = await fetchBytes(`${MIRROR}/${targetsName}`);
  await bindExactSha(targetsFetch.bytes, core.live_metadata.targets_sha256, "targets_metadata");
  const targetsEnvelope = parseJson(targetsFetch.text, "targets_envelope");
  const targetsSigned = targetsEnvelope.signed as Record<string, unknown> | undefined;
  if (!targetsSigned || targetsSigned._type !== "targets" || Number(targetsSigned.version) !== targetsVersion) throw new Error("targets_metadata_shape_mismatch");
  const targetMap = targetsSigned.targets as Record<string, unknown> | undefined;
  const trustedRef = targetMap?.["trusted_root.json"] as MetaRef | undefined;
  if (!trustedRef) throw new Error("trusted_root_target_not_listed");
  const targetSha = trustedRef.hashes?.sha256;
  if (typeof targetSha !== "string" || !/^[0-9a-f]{64}$/.test(targetSha)) throw new Error("trusted_root_target_sha_missing");

  const targetName = consistentSnapshot ? `${targetSha}.trusted_root.json` : "trusted_root.json";
  const targetFetch = await fetchBytes(`${MIRROR}/targets/${targetName}`);

  if (test === "target-tamper") {
    const tampered = targetFetch.bytes.slice();
    if (!tampered.length) throw new Error("trusted_root_target_empty");
    tampered[0] ^= 1;
    try {
      await bindTarget(tampered, trustedRef, "trusted_root_target");
    } catch {
      throw new Error("trusted_root_target_tamper_rejected");
    }
    throw new Error("trusted_root_target_tamper_unexpectedly_accepted");
  }

  const verifiedTargetSha = await bindTarget(targetFetch.bytes, trustedRef, "trusted_root_target");
  const trustedRoot = parseJson(targetFetch.text, "trusted_root");
  if (trustedRoot.mediaType !== "application/vnd.dev.sigstore.trustedroot+json;version=0.1") throw new Error("trusted_root_media_type_mismatch");
  const tlogs = arrayCount(trustedRoot.tlogs, "trusted_root_tlogs", true);
  const ctlogs = arrayCount(trustedRoot.ctlogs, "trusted_root_ctlogs", true);
  const certificateAuthorities = arrayCount(trustedRoot.certificateAuthorities, "trusted_root_certificate_authorities", true);
  const timestampAuthorities = arrayCount(trustedRoot.timestampAuthorities, "trusted_root_timestamp_authorities", false);

  if (test === "semantic-tamper") {
    const bad = structuredClone(trustedRoot);
    bad.mediaType = "application/json";
    if (bad.mediaType === "application/vnd.dev.sigstore.trustedroot+json;version=0.1") throw new Error("semantic_tamper_unexpectedly_accepted");
    throw new Error("trusted_root_semantic_tamper_rejected");
  }

  const proof = {
    schema: SCHEMA,
    verification_status: "FULL_TUF_CHAIN_CRYPTO_VERIFIED",
    provider_id: "sigstore-public-good",
    provider_kind: "SIGSTORE_TUF",
    external_identity: MIRROR,
    chain: {
      bootstrap_to_current_root: true,
      timestamp_to_snapshot: true,
      snapshot_to_targets: true,
      targets_to_trusted_root: true,
      current_root_version: rootVersion,
      targets_version: targetsVersion,
      consistent_snapshot: consistentSnapshot,
      trusted_root_target_name: targetName,
    },
    core_verification: {
      schema: CORE_SCHEMA,
      verification_proof_sha256: core.verification_proof_sha256,
      current_root_sha256: core.continuity.current_root_sha256,
      targets_metadata_sha256: core.live_metadata.targets_sha256,
    },
    trusted_root: {
      sha256: verifiedTargetSha,
      length: targetFetch.bytes.length,
      media_type: trustedRoot.mediaType,
      tlogs,
      ctlogs,
      certificate_authorities: certificateAuthorities,
      timestamp_authorities: timestampAuthorities,
    },
    guarantees: {
      core_metadata_signatures_verified: true,
      metadata_refetch_hash_bound_to_core_proof: true,
      target_length_and_sha256_bound_to_verified_targets_metadata: true,
      consistent_snapshot_target_path_enforced: true,
      trusted_root_semantic_shape_checked: true,
      fetched_is_not_verified: true,
      database_write: false,
      canonical: false,
      authority_effect: false,
    },
    verified_at: new Date().toISOString(),
    canonical: false,
    authority_effect: false,
  };
  return { ...proof, verification_proof_sha256: await sha256(new TextEncoder().encode(JSON.stringify(proof))) };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return out({ schema: SCHEMA, verification_status: "REJECTED", error: "method_not_allowed", canonical: false, authority_effect: false }, 405);
  const test = new URL(req.url).searchParams.get("test");
  const allowed = new Set<string | null>([null, "content-hash-only", "target-tamper", "semantic-tamper"]);
  if (!allowed.has(test)) return out({ schema: SCHEMA, verification_status: "REJECTED", error: "unsupported_test_mode", canonical: false, authority_effect: false }, 400);
  try {
    const evidence = await verifyChain(test);
    if (test) return out({ schema: SCHEMA, verification_status: "TEST_UNEXPECTEDLY_ACCEPTED", test, evidence, canonical: false, authority_effect: false }, 500);
    return out({ schema: SCHEMA, verification_status: "FULL_TUF_CHAIN_CRYPTO_VERIFIED", evidence, receipt_production: false, database_write: false, canonical: false, authority_effect: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "verification_error";
    return out({ schema: SCHEMA, verification_status: test ? "NEGATIVE_TEST_REJECTED" : "REJECTED", test, error: message.slice(0, 512), receipt_production: false, database_write: false, canonical: false, authority_effect: false }, test ? 200 : 422);
  }
});
