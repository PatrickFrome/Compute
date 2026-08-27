// R1 STEP11 — Two-Domain Materialized Readback Verifier (additive, fail-closed, offline)
//
// Pure decision oracle for the R2 acceptance gate: "real two-domain persisted readback".
// It decides ONLY from bytes that were already materialized by an independent provider
// controller, plus a bound manifest describing where those bytes came from and what
// immutability property they carry. It performs NO network, NO AWS/S3/B2 call, and it
// PERSISTS NOTHING. It is a fail-closed local proof evaluator, not an authority.
//
// Authority boundary (per R1_STEP02 / R1_STEP08 / R1_STEP09A research):
//   - this module never creates R2/R3, never writes the continuity DB, never creates a seal;
//   - a real production R2 can ONLY be derived by the append-only continuity DB functions
//     (STEP09B) after a real STEP09A authority gate; this verifier is a pre-DB, offline
//     contract check that the two supplied domain readbacks satisfy the two-domain WORM
//     readback contract before they are projected.
//
// Non-claims (explicit, honored):
//   - authority_effect = false
//   - does NOT itself persist anything
//   - does NOT generate synthetic proof rows
//   - never throws on bad input (every path returns {ok:true,...} | {ok:false, reason})

import { createHash } from "node:crypto";

// ---- recognized WORM / retention strength grades (R1_STEP02 taxonomy) ----
export const WORM_GRADES = {
  COMPLIANCE_NON_SHORTENABLE: { grade: "COMPLIANCE_NON_SHORTENABLE", strong: true, warning: false },
  GOVERNANCE_BYPASSABLE: { grade: "GOVERNANCE_BYPASSABLE", strong: false, warning: true },
  ADMIN_REVOCABLE_BUCKET_RULE: { grade: "ADMIN_REVOCABLE_BUCKET_RULE", strong: false, warning: true },
};

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const DEFAULT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000; // 7-day DB readiness window (R1_STEP09B)
const DEFAULT_FUTURE_SKEW_MS = 5 * 60 * 1000; // 5-minute clock skew tolerance
const MIN_EPOCH_FLOOR_MS = 1_000_000_000_000; // 2001-09-09, reject absurd ancient timestamps

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toBuffer(bytes) {
  if (bytes == null) return null;
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8");
  return null;
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function validSha256Hex(s) {
  return typeof s === "string" && SHA256_HEX_RE.test(s);
}

// Parse a timestamp (epoch ms number, or ISO-8601 / RFC string) into epoch ms.
// Returns null when unparseable. Never throws.
function parseTimestamp(t) {
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t === "string" && t.length > 0) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function wormGradeOf(mode) {
  if (typeof mode === "string" && WORM_GRADES[mode]) return WORM_GRADES[mode];
  return null;
}

// Validate WORM / immutability evidence carried in a manifest.
// Fail-closed: requires an explicit immutable claim AND at least one concrete WORM fact
// (legal hold, or a retention-until that is indefinite/non-shortenable, or a recognized mode).
function checkWormEvidence(manifest, clockMs) {
  if (manifest.immutable !== true) return { ok: false, reason: "no_immutable_claim" };

  const worm = manifest.worm;
  if (!isPlainObject(worm)) return { ok: false, reason: "no_worm_evidence" };

  const grade = wormGradeOf(worm.mode);
  if (worm.mode !== undefined && worm.mode !== null && !grade) {
    return { ok: false, reason: "unrecognized_worm_mode" };
  }

  const legalHold = worm.legalHold === true;

  // retentionUntil may be: a future date, or an explicit indefinite marker.
  let retentionOk = false;
  let indefinite = false;
  if (worm.retentionUntil === "indefinite" || worm.retentionUntil === null) {
    retentionOk = true;
    indefinite = true;
  } else {
    const until = parseTimestamp(worm.retentionUntil);
    if (until !== null && until > clockMs) retentionOk = true;
  }

  if (!legalHold && !retentionOk && !grade) {
    return { ok: false, reason: "no_worm_evidence" };
  }

  // A finite retention date that is already in the past is not WORM protection.
  if (!legalHold && !indefinite && !retentionOk && !grade) {
    return { ok: false, reason: "worm_retention_expired" };
  }

  return {
    ok: true,
    grade: grade ? grade.grade : "IMPLICIT_CLAIM",
    strong: grade ? grade.strong : false,
    warning: grade ? grade.warning : true,
  };
}

// Validate manifest structural integrity (domain id, sequence/order, timestamp bounds,
// content hash binding). Fail-closed: any missing/malformed required field => reason.
function checkManifestIntegrity(manifest, computedHash, clockMs, opts) {
  if (!isPlainObject(manifest)) return { ok: false, reason: "manifest_not_object" };

  const required = ["domainId", "provider", "region", "bucket", "objectKey", "sequence", "timestamp", "contentHash"];
  for (const k of required) {
    if (manifest[k] === undefined || manifest[k] === null || manifest[k] === "") {
      return { ok: false, reason: `manifest_missing_${k}` };
    }
  }

  if (typeof manifest.domainId !== "string") return { ok: false, reason: "manifest_domainId_not_string" };
  if (typeof manifest.provider !== "string") return { ok: false, reason: "manifest_provider_not_string" };
  if (typeof manifest.region !== "string") return { ok: false, reason: "manifest_region_not_string" };
  if (typeof manifest.bucket !== "string") return { ok: false, reason: "manifest_bucket_not_string" };

  // sequence/order: finite non-negative integer
  const seq = manifest.sequence;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0 || !Number.isFinite(seq)) {
    return { ok: false, reason: "manifest_sequence_invalid" };
  }

  // timestamp bounds: parseable, not absurdly old, not in the future beyond skew
  const ts = parseTimestamp(manifest.timestamp);
  if (ts === null) return { ok: false, reason: "manifest_timestamp_unparseable" };
  if (ts < MIN_EPOCH_FLOOR_MS) return { ok: false, reason: "manifest_timestamp_too_old" };
  if (ts > clockMs + opts.maxFutureSkewMs) return { ok: false, reason: "manifest_timestamp_future" };

  // content hash binding: manifest claims the same SHA-256 we computed from the bytes
  if (!validSha256Hex(manifest.contentHash)) {
    return { ok: false, reason: "manifest_contentHash_malformed" };
  }
  if (manifest.contentHash !== computedHash) {
    return { ok: false, reason: "manifest_content_hash_mismatch" };
  }

  if (typeof manifest.expectedBytes === "number" && Number.isFinite(manifest.expectedBytes)) {
    if (manifest.expectedBytes < 0) return { ok: false, reason: "manifest_expectedBytes_negative" };
  }

  return { ok: true };
}

// verifyReadback — decide whether ONE materialized readback is authentic, intact and
// carried by an immutable WORM domain.
//
// Returns {ok:true, sha256, byteLength, domainId, worm} or {ok:false, reason}.
// NEVER throws.
export function verifyReadback(bytes, expectedHash, manifest) {
  try {
    const buf = toBuffer(bytes);
    if (buf === null) return { ok: false, reason: "bad_input_bytes" };

    if (!validSha256Hex(expectedHash)) return { ok: false, reason: "bad_expected_hash" };

    const computedHash = sha256Hex(buf);

    // (a) content integrity: SHA-256(bytes) === expectedHash  (tampered bytes fail here)
    if (computedHash !== expectedHash.toLowerCase()) return { ok: false, reason: "hash_mismatch" };

    // byte count binding (when manifest declares one)
    if (isPlainObject(manifest) && typeof manifest.expectedBytes === "number" && buf.length !== manifest.expectedBytes) {
      return { ok: false, reason: "byte_count_mismatch" };
    }

    // (b) manifest integrity (domain id, sequence/order, timestamp bounds, content hash)
    const integrity = checkManifestIntegrity(manifest, computedHash, Date.now(), {
      maxFutureSkewMs: DEFAULT_FUTURE_SKEW_MS,
    });
    if (!integrity.ok) return { ok: false, reason: integrity.reason };

    // (c) immutability / WORM evidence (fail-closed if any missing)
    const worm = checkWormEvidence(manifest, Date.now());
    if (!worm.ok) return { ok: false, reason: worm.reason };

    return {
      ok: true,
      sha256: computedHash,
      byteLength: buf.length,
      domainId: manifest.domainId,
      worm: { grade: worm.grade, strong: worm.strong, warning: worm.warning },
    };
  } catch (err) {
    return { ok: false, reason: "exception", detail: String(err && err.message ? err.message : err) };
  }
}

// evaluateR2Proof — decide whether TWO independent durability domains together prove the
// R2 readback contract.
//
// domains: array of { id, provider, region, bucket, bytes, expectedHash, manifest }
//   - `id` is the domain identity (defaults to manifest.domainId when absent)
//   - `provider/region/bucket` are read from the domain OR its manifest
//
// Requires (fail-closed):
//   - exactly two domains (matches the R1 v1 exactly-two-domain evidence contract);
//   - two DISTINCT domains: different domain id, and NOT identical (provider,region,bucket);
//     optional operator/failureDomain must also differ when both present;
//   - identical content hash across both readbacks;
//   - each verifyReadback(...).ok === true;
//   - each manifest timestamp within the freshness window (default 7 days) of `clock`;
//   - WORM/immutability evidence present on each.
//
// Returns {ok:true, proof} or {ok:false, reason}.
// NEVER throws.
export function evaluateR2Proof(domains, options = {}) {
  try {
    const freshnessMs = typeof options.freshnessMs === "number" && options.freshnessMs >= 0
      ? options.freshnessMs
      : DEFAULT_FRESHNESS_MS;
    const maxFutureSkewMs = typeof options.maxFutureSkewMs === "number"
      ? options.maxFutureSkewMs
      : DEFAULT_FUTURE_SKEW_MS;
    const clockMs = typeof options.clock === "number" && Number.isFinite(options.clock) ? options.clock : Date.now();

    if (!Array.isArray(domains)) return { ok: false, reason: "domains_not_array" };
    if (domains.length !== 2) return { ok: false, reason: "not_two_domains", found: domains.length };

    const resolved = domains.map((d, i) => {
      const m = d && d.manifest;
      return {
        index: i,
        id: typeof d.id === "string" && d.id.length ? d.id : (m && m.domainId),
        provider: d.provider !== undefined ? d.provider : (m && m.provider),
        region: d.region !== undefined ? d.region : (m && m.region),
        bucket: d.bucket !== undefined ? d.bucket : (m && m.bucket),
        operator: d.operator !== undefined ? d.operator : (m && m.operator),
        failureDomain: d.failureDomain !== undefined ? d.failureDomain : (m && m.failureDomain),
        bytes: d.bytes,
        expectedHash: d.expectedHash,
        manifest: m,
      };
    });

    for (const r of resolved) {
      if (!r.id) return { ok: false, reason: "domain_id_missing", index: r.index };
      if (!r.provider || !r.region || !r.bucket) {
        return { ok: false, reason: "domain_identity_incomplete", index: r.index };
      }
    }

    // independence: distinct id AND not identical (provider,region,bucket)
    if (resolved[0].id === resolved[1].id) return { ok: false, reason: "same_domain_id" };
    if (
      resolved[0].provider === resolved[1].provider &&
      resolved[0].region === resolved[1].region &&
      resolved[0].bucket === resolved[1].bucket
    ) {
      return { ok: false, reason: "not_independent_provider_region_bucket" };
    }
    // optional stronger independence checks (operator class / failure domain)
    if (resolved[0].operator && resolved[1].operator && resolved[0].operator === resolved[1].operator) {
      return { ok: false, reason: "same_operator_class" };
    }
    if (resolved[0].failureDomain && resolved[1].failureDomain && resolved[0].failureDomain === resolved[1].failureDomain) {
      return { ok: false, reason: "same_failure_domain" };
    }

    // per-domain verification
    const verified = resolved.map((r) => verifyReadback(r.bytes, r.expectedHash, r.manifest));
    for (let i = 0; i < verified.length; i++) {
      if (!verified[i].ok) {
        return { ok: false, reason: "domain_invalid", index: i, detail: verified[i].reason };
      }
    }

    // identical content hash across both readbacks
    const h0 = verified[0].sha256;
    const h1 = verified[1].sha256;
    if (h0 !== h1) return { ok: false, reason: "content_hash_divergence" };
    if (typeof resolved[0].expectedHash === "string" && resolved[0].expectedHash !== resolved[1].expectedHash) {
      return { ok: false, reason: "expected_hash_divergence" };
    }

    // freshness: each manifest.timestamp within [clock - freshnessMs - skew, clock + skew]
    for (const r of resolved) {
      const ts = parseTimestamp(r.manifest.timestamp);
      if (ts === null) return { ok: false, reason: "manifest_timestamp_unparseable", index: r.index };
      if (ts < clockMs - freshnessMs - maxFutureSkewMs) return { ok: false, reason: "stale_readback", index: r.index };
      if (ts > clockMs + maxFutureSkewMs) return { ok: false, reason: "future_readback", index: r.index };
    }

    const weakWarning = verified.some((v) => v.worm && v.worm.warning);

    return {
      ok: true,
      proof: {
        contentHash: h0,
        byteLength: verified[0].byteLength,
        domains: resolved.map((r, i) => ({
          id: r.id,
          provider: r.provider,
          region: r.region,
          bucket: r.bucket,
          operator: r.operator || null,
          failureDomain: r.failureDomain || null,
          worm: verified[i].worm,
        })),
        freshnessMs,
        evaluatedAt: clockMs,
        weakRetentionWarning: weakWarning,
      },
    };
  } catch (err) {
    return { ok: false, reason: "exception", detail: String(err && err.message ? err.message : err) };
  }
}

export const R2_VERIFIER_META = {
  step: "R1_STEP11_TWO_DOMAIN_READBACK_VERIFIER",
  authority_effect: false,
  persists_nothing: true,
  network_free: true,
  default_freshness_ms: DEFAULT_FRESHNESS_MS,
};