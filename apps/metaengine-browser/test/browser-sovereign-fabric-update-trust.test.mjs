import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSER_FABRIC_PLATFORM_SIGNATURE_RECEIPT_SCHEMA,
  BROWSER_FABRIC_PROVENANCE_RECEIPT_SCHEMA,
  BROWSER_FABRIC_TRANSPARENCY_RECEIPT_SCHEMA,
  BROWSER_FABRIC_TUF_RECEIPT_SCHEMA,
  BROWSER_FABRIC_UPDATE_TRUST_SCHEMA,
  browserFabricUpdateTrustContract,
  evaluateBrowserFabricUpdateTrust,
} from '../src/browser-fabric-update-trust.mjs';
import { BROWSER_FABRIC_PROVENANCE_EVIDENCE_SCHEMA } from '../src/browser-fabric-release-authority-gate.mjs';
import { canonicalFabricJson, fabricSha256 } from '../src/browser-fabric-effect-ledger.mjs';

const H64 = (ch) => ch.repeat(64);
const SOURCE_SHA = '1'.repeat(40);
const NOW = new Date('2026-09-05T10:30:00Z');
const TARGET = 'browser/METAENGINE-Browser.exe';
const VERIFIED_AT = '2026-09-05T10:29:00Z';

function descriptor(signed) {
  const canonical = canonicalFabricJson(signed);
  return { sha256: fabricSha256(canonical), size: Buffer.byteLength(canonical, 'utf8') };
}

function tufReceipt(role, metadata, trustedRootSha, { rotation = false, evidence = 'e' } = {}) {
  const d = descriptor(metadata.signed);
  return {
    schema: BROWSER_FABRIC_TUF_RECEIPT_SCHEMA,
    verifier_id: `tuf-verifier-${role}`,
    verified_at: VERIFIED_AT,
    evidence_sha256: H64(evidence),
    role,
    signed_sha256: d.sha256,
    signed_size: d.size,
    metadata_version: metadata.signed.version,
    expires_at: metadata.signed.expires_at,
    trusted_root_sha256: trustedRootSha,
    signature_threshold_verified: true,
    root_rotation_verified: rotation,
    authority_effect: false,
  };
}

function fixture() {
  const root = {
    role: 'root',
    signed: {
      version: 3,
      expires_at: '2027-09-05T00:00:00Z',
      keys_digest: H64('3'),
    },
  };
  const rootDescriptor = descriptor(root.signed);

  const targets = {
    role: 'targets',
    signed: {
      version: 7,
      expires_at: '2026-09-06T00:00:00Z',
      targets: {
        [TARGET]: {
          sha256: H64('a'),
          size: 123456,
          media_type: 'application/vnd.metaengine.browser.executable.v1',
          source_sha: SOURCE_SHA,
        },
      },
    },
  };
  const targetsDescriptor = descriptor(targets.signed);

  const snapshot = {
    role: 'snapshot',
    signed: {
      version: 11,
      expires_at: '2026-09-06T00:00:00Z',
      meta: {
        targets: {
          role: 'targets',
          version: targets.signed.version,
          sha256: targetsDescriptor.sha256,
          size: targetsDescriptor.size,
        },
      },
    },
  };
  const snapshotDescriptor = descriptor(snapshot.signed);

  const timestamp = {
    role: 'timestamp',
    signed: {
      version: 19,
      expires_at: '2026-09-05T11:00:00Z',
      meta: {
        snapshot: {
          role: 'snapshot',
          version: snapshot.signed.version,
          sha256: snapshotDescriptor.sha256,
          size: snapshotDescriptor.size,
        },
      },
    },
  };

  return {
    now: NOW,
    trusted_state: {
      root_version: 3,
      targets_version: 7,
      snapshot_version: 11,
      timestamp_version: 19,
      root_sha256: rootDescriptor.sha256,
    },
    root,
    root_receipt: tufReceipt('root', root, rootDescriptor.sha256, { evidence: '1' }),
    targets,
    targets_receipt: tufReceipt('targets', targets, rootDescriptor.sha256, { evidence: '2' }),
    snapshot,
    snapshot_receipt: tufReceipt('snapshot', snapshot, rootDescriptor.sha256, { evidence: '3' }),
    timestamp,
    timestamp_receipt: tufReceipt('timestamp', timestamp, rootDescriptor.sha256, { evidence: '4' }),
    target_path: TARGET,
    provenance_receipt: {
      schema: BROWSER_FABRIC_PROVENANCE_RECEIPT_SCHEMA,
      verifier_id: 'slsa-verifier-1',
      verified_at: VERIFIED_AT,
      evidence_sha256: H64('5'),
      predicate_type: 'https://slsa.dev/provenance/v1',
      builder_id: 'github-actions-browser-release',
      builder_trusted: true,
      subject_name: TARGET,
      subject_sha256: H64('a'),
      subject_size: 123456,
      source_sha: SOURCE_SHA,
      authority_effect: false,
    },
    transparency_receipt: {
      schema: BROWSER_FABRIC_TRANSPARENCY_RECEIPT_SCHEMA,
      verifier_id: 'sigstore-verifier-1',
      verified_at: VERIFIED_AT,
      evidence_sha256: H64('6'),
      verification_profile: 'SIGSTORE_BUNDLE_SIGNATURE_IDENTITY_TLOG_V1',
      bundle_sha256: H64('b'),
      log_id: 'rekor-public-v1',
      subject_sha256: H64('a'),
      integrated_time_ms: Date.parse('2026-09-05T10:20:00Z'),
      authority_effect: false,
    },
    platform_signature_receipt: {
      schema: BROWSER_FABRIC_PLATFORM_SIGNATURE_RECEIPT_SCHEMA,
      verifier_id: 'windows-signature-verifier-1',
      verified_at: VERIFIED_AT,
      evidence_sha256: H64('7'),
      verification_profile: 'PLATFORM_SIGNATURE_CHAIN_V1',
      subject_sha256: H64('a'),
      subject_size: 123456,
      signer_identity: 'metaengine-release-publisher',
      authority_effect: false,
    },
  };
}

test('typed TUF/SLSA/transparency/platform receipts compose exact immutable update trust without authority', () => {
  const out = evaluateBrowserFabricUpdateTrust(fixture());
  assert.equal(out.ok, true);
  assert.equal(out.schema, BROWSER_FABRIC_UPDATE_TRUST_SCHEMA);
  assert.equal(out.reason, 'TYPED_IMMUTABLE_UPDATE_TRUST_EXACT');
  assert.equal(out.verified_immutable_release_exact, true);
  assert.equal(out.source_sha, SOURCE_SHA);
  assert.equal(out.artifact_sha256, H64('a'));
  assert.equal(out.artifact_size, 123456);
  assert.equal(out.bare_crypto_booleans_accepted, false);
  assert.equal(out.requires_separate_release_gate, true);
  assert.equal(out.requires_separate_journaled_promotion_effect, true);
  assert.equal(out.release_authority, false);
  assert.equal(out.authority_effect, false);
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.release_gate_provenance_evidence.schema, BROWSER_FABRIC_PROVENANCE_EVIDENCE_SCHEMA);
  assert.equal(out.release_gate_provenance_evidence.subject_sha256, H64('a'));
});

test('old caller-supplied crypto booleans cannot substitute for typed verification receipts', () => {
  const input = fixture();
  delete input.root_receipt;
  input.root.signatures_verified = true;
  input.root.thresholds_verified = true;
  input.root.rotation_verified = true;
  const out = evaluateBrowserFabricUpdateTrust(input);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'ROOT_VERIFICATION_RECEIPT_INVALID_OR_UNBOUND');
});

test('trusted root digest is a durable trust anchor, not caller-selected metadata', () => {
  const input = fixture();
  input.trusted_state = { ...input.trusted_state, root_sha256: H64('f') };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'TUF_ROOT_TRUST_ANCHOR_MISMATCH');
});

test('root version advance requires explicit rotation receipt bound to the prior trusted root', () => {
  const input = fixture();
  const priorRoot = input.trusted_state.root_sha256;
  input.root = { ...input.root, signed: { ...input.root.signed, version: 4, keys_digest: H64('4') } };
  input.root_receipt = tufReceipt('root', input.root, priorRoot, { rotation: false, evidence: '8' });
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'TUF_ROOT_ROTATION_RECEIPT_REQUIRED');
});

test('role receipt must bind exact canonical metadata digest and byte size', () => {
  const input = fixture();
  input.targets_receipt = { ...input.targets_receipt, signed_sha256: H64('f') };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'TARGETS_VERIFICATION_RECEIPT_INVALID_OR_UNBOUND');
});

test('metadata rollback and expiry fail closed even when a receipt is otherwise well-formed', () => {
  const rollback = fixture();
  rollback.trusted_state = { ...rollback.trusted_state, targets_version: 8 };
  assert.equal(evaluateBrowserFabricUpdateTrust(rollback).reason, 'TUF_TARGETS_ROLLBACK_DETECTED');

  const expired = fixture();
  expired.timestamp = { ...expired.timestamp, signed: { ...expired.timestamp.signed, expires_at: '2026-09-05T10:29:59Z' } };
  expired.timestamp_receipt = tufReceipt('timestamp', expired.timestamp, expired.trusted_state.root_sha256, { evidence: '9' });
  assert.equal(evaluateBrowserFabricUpdateTrust(expired).reason, 'TUF_TIMESTAMP_EXPIRED_OR_VERSION_INVALID');
});

test('snapshot and timestamp prevent metadata mix-and-match', () => {
  const input = fixture();
  input.snapshot = {
    ...input.snapshot,
    signed: {
      ...input.snapshot.signed,
      meta: { targets: { ...input.snapshot.signed.meta.targets, sha256: H64('f') } },
    },
  };
  input.snapshot_receipt = tufReceipt('snapshot', input.snapshot, input.trusted_state.root_sha256, { evidence: 'a' });
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'TUF_SNAPSHOT_TARGETS_BINDING_MISMATCH');
});

test('provenance receipt binds digest, byte size, source SHA and target name', () => {
  const input = fixture();
  input.provenance_receipt = { ...input.provenance_receipt, subject_size: 123455 };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'SLSA_PROVENANCE_RECEIPT_INVALID_OR_UNBOUND');
});

test('transparency receipt binds exact subject and forbids future integrated time', () => {
  const input = fixture();
  input.transparency_receipt = {
    ...input.transparency_receipt,
    integrated_time_ms: NOW.getTime() + 1,
  };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'TRANSPARENCY_RECEIPT_INVALID_OR_UNBOUND');
});

test('platform signature receipt is independently bound to the exact artifact bytes', () => {
  const input = fixture();
  input.platform_signature_receipt = { ...input.platform_signature_receipt, subject_sha256: H64('f') };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'PLATFORM_SIGNATURE_RECEIPT_INVALID_OR_UNBOUND');
});

test('future-dated independent verification receipts are rejected', () => {
  const input = fixture();
  input.provenance_receipt = { ...input.provenance_receipt, verified_at: '2026-09-05T10:30:01Z' };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'SLSA_PROVENANCE_RECEIPT_INVALID_OR_UNBOUND');
});

test('update trust contract stays a pure evidence composer below release/promotion authority', () => {
  const contract = browserFabricUpdateTrustContract();
  assert.equal(contract.typed_tuf_verification_receipts_required, true);
  assert.equal(contract.receipt_verifier_identity_required, true);
  assert.equal(contract.receipt_evidence_digest_required, true);
  assert.equal(contract.bare_signatures_verified_boolean_sufficient, false);
  assert.equal(contract.root_rotation_receipt_required_on_advance, true);
  assert.equal(contract.snapshot_binds_targets_digest_size_version, true);
  assert.equal(contract.timestamp_binds_snapshot_digest_size_version, true);
  assert.equal(contract.typed_slsa_receipt_required, true);
  assert.equal(contract.typed_transparency_receipt_required, true);
  assert.equal(contract.typed_platform_signature_receipt_required, true);
  assert.equal(contract.git_sha_alone_sufficient, false);
  assert.equal(contract.direct_release_or_authority_effect_allowed, false);
  assert.equal(contract.automatic_retry_allowed, false);
  assert.equal(contract.authority_effect, false);
});
