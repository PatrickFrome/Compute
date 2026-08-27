import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyReadback, evaluateR2Proof } from "./readback-verifier.mjs";

const FRESH = 7 * 24 * 60 * 60 * 1000;
const NOW = Date.now();

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// build a valid manifest for a domain carrying identical content hash + WORM evidence
function makeManifest(over) {
  const base = {
    domainId: over.id || "domain-A",
    provider: over.provider || "aws",
    region: over.region || "us-east-1",
    bucket: over.bucket || "h205f22-r1-a",
    objectKey: "h205f22/r1/sha256/ciphertext.age",
    sequence: 1,
    timestamp: over.timestamp || NOW,
    contentHash: over.contentHash,
    expectedBytes: over.expectedBytes,
    immutable: over.immutable !== undefined ? over.immutable : true,
    worm: over.worm || { mode: "COMPLIANCE_NON_SHORTENABLE", legalHold: true, retentionUntil: "indefinite" },
  };
  return Object.assign(base, over.extra || {});
}

function domainSpec(bytes, hash, over) {
  const m = makeManifest(Object.assign({ contentHash: hash, expectedBytes: bytes.length }, over || {}));
  return {
    id: m.domainId,
    provider: m.provider,
    region: m.region,
    bucket: m.bucket,
    bytes,
    expectedHash: hash,
    manifest: m,
  };
}

test("verifyReadback accepts authentic intact WORM readback", () => {
  const bytes = Buffer.from("recovery-ciphertext-bytes-for-r2-proof");
  const hash = sha256(bytes);
  const r = verifyReadback(bytes, hash, makeManifest({ contentHash: hash, expectedBytes: bytes.length }));
  assert.equal(r.ok, true);
  assert.equal(r.sha256, hash);
  assert.equal(r.byteLength, bytes.length);
  assert.equal(r.worm.strong, true);
});

test("evaluateR2Proof ok for two distinct WORM domains with identical content", () => {
  const bytes = Buffer.from("identical-canonical-ciphertext-readback");
  const hash = sha256(bytes);
  const a = domainSpec(bytes, hash, {
    id: "aws-compliance",
    provider: "aws",
    region: "us-east-1",
    bucket: "h205f22-r1-a",
  });
  const b = domainSpec(bytes, hash, {
    id: "b2-compliance",
    provider: "backblaze",
    region: "us-west-002",
    bucket: "h205f22-r1-b",
    worm: { mode: "COMPLIANCE_NON_SHORTENABLE", legalHold: true, retentionUntil: "indefinite" },
  });
  const r = evaluateR2Proof([a, b], { clock: NOW, freshnessMs: FRESH });
  assert.equal(r.ok, true);
  assert.equal(r.proof.contentHash, hash);
  assert.equal(r.proof.domains.length, 2);
  assert.equal(r.proof.weakRetentionWarning, false);
});

test("evaluateR2Proof fails on tampered bytes in one domain", () => {
  const bytes = Buffer.from("identical-canonical-ciphertext-readback");
  const hash = sha256(bytes);
  const a = domainSpec(bytes, hash, { id: "aws-compliance", provider: "aws", region: "us-east-1", bucket: "h205f22-r1-a" });
  const tampered = Buffer.from("identical-canonical-ciphertext-readbak-X");
  const b = domainSpec(tampered, hash, { id: "b2-compliance", provider: "backblaze", region: "us-west-002", bucket: "h205f22-r1-b" });
  const r = evaluateR2Proof([a, b], { clock: NOW, freshnessMs: FRESH });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "domain_invalid");
  assert.equal(r.index, 1);
});

test("verifyReadback fails on expected-hash mismatch", () => {
  const bytes = Buffer.from("some-bytes");
  const r = verifyReadback(bytes, "0".repeat(64), makeManifest({ contentHash: sha256(bytes), expectedBytes: bytes.length }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "hash_mismatch");
});

test("evaluateR2Proof fails when same domain presented twice (non-independent)", () => {
  const bytes = Buffer.from("identical-canonical-ciphertext-readback");
  const hash = sha256(bytes);
  const a = domainSpec(bytes, hash, { id: "aws-compliance", provider: "aws", region: "us-east-1", bucket: "h205f22-r1-a" });
  const b = domainSpec(bytes, hash, { id: "aws-compliance", provider: "aws", region: "us-east-1", bucket: "h205f22-r1-a" });
  const r = evaluateR2Proof([a, b], { clock: NOW, freshnessMs: FRESH });
  assert.equal(r.ok, false);
  assert.ok(r.reason === "same_domain_id" || r.reason === "not_independent_provider_region_bucket");
});

test("verifyReadback fails when WORM immutability flag missing", () => {
  const bytes = Buffer.from("some-bytes");
  const hash = sha256(bytes);
  const m = makeManifest({ contentHash: hash, expectedBytes: bytes.length, immutable: false, worm: undefined });
  const r = verifyReadback(bytes, hash, m);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_immutable_claim");
});

test("verifyReadback fails when WORM evidence missing entirely", () => {
  const bytes = Buffer.from("some-bytes");
  const hash = sha256(bytes);
  const m = makeManifest({ contentHash: hash, expectedBytes: bytes.length, immutable: true, worm: {} });
  const r = verifyReadback(bytes, hash, m);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_worm_evidence");
});

test("evaluateR2Proof fails on stale readback timestamp", () => {
  const bytes = Buffer.from("identical-canonical-ciphertext-readback");
  const hash = sha256(bytes);
  const a = domainSpec(bytes, hash, { id: "aws-compliance", provider: "aws", region: "us-east-1", bucket: "h205f22-r1-a", timestamp: NOW - 8 * 24 * 60 * 60 * 1000 });
  const b = domainSpec(bytes, hash, { id: "b2-compliance", provider: "backblaze", region: "us-west-002", bucket: "h205f22-r1-b" });
  const r = evaluateR2Proof([a, b], { clock: NOW, freshnessMs: FRESH });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "stale_readback");
  assert.equal(r.index, 0);
});

test("verifyReadback fails on malformed manifest (missing field)", () => {
  const bytes = Buffer.from("some-bytes");
  const hash = sha256(bytes);
  const m = makeManifest({ contentHash: hash, expectedBytes: bytes.length });
  delete m.sequence;
  const r = verifyReadback(bytes, hash, m);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "manifest_missing_sequence");
});

test("evaluateR2Proof requires exactly two domains", () => {
  const bytes = Buffer.from("x");
  const hash = sha256(bytes);
  const a = domainSpec(bytes, hash, { id: "aws", provider: "aws", region: "r", bucket: "b" });
  const r1 = evaluateR2Proof([a], { clock: NOW });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "not_two_domains");
  const r3 = evaluateR2Proof([a, a, a], { clock: NOW });
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, "not_two_domains");
});

test("weak retention (R2 bucket lock) still passes but warns", () => {
  const bytes = Buffer.from("identical-canonical-ciphertext-readback");
  const hash = sha256(bytes);
  const a = domainSpec(bytes, hash, { id: "aws-compliance", provider: "aws", region: "us-east-1", bucket: "h205f22-r1-a" });
  const b = domainSpec(bytes, hash, {
    id: "r2-bucket-lock",
    provider: "cloudflare",
    region: "auto",
    bucket: "h205f22-r1-r2",
    worm: { mode: "ADMIN_REVOCABLE_BUCKET_RULE", legalHold: false, retentionUntil: "2099-01-01T00:00:00Z" },
  });
  const r = evaluateR2Proof([a, b], { clock: NOW, freshnessMs: FRESH });
  assert.equal(r.ok, true);
  assert.equal(r.proof.weakRetentionWarning, true);
});

test("never throws on garbage input", () => {
  const r = verifyReadback(null, null, null);
  assert.equal(r.ok, false);
  const r2 = evaluateR2Proof("not-an-array", {});
  assert.equal(r2.ok, false);
});