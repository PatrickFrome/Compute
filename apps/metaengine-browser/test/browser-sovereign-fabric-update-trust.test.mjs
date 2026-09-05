import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSER_FABRIC_UPDATE_TRUST_SCHEMA,
  browserFabricUpdateTrustContract,
  evaluateBrowserFabricUpdateTrust,
} from '../src/browser-fabric-update-trust.mjs';
import { canonicalFabricJson, fabricSha256 } from '../src/browser-fabric-effect-ledger.mjs';

const H64 = (ch) => ch.repeat(64);
const SOURCE_SHA = '1'.repeat(40);
const NOW = new Date('2026-09-05T04:20:00Z');

function descriptor(signed) {
  const bytes = Buffer.from(canonicalFabricJson(signed), 'utf8');
  return { sha256: fabricSha256(bytes), size: bytes.byteLength };
}

function fixture() {
  const root = {
    role: 'root',
    signatures_verified: true,
    thresholds_verified: true,
    rollback_protection_verified: true,
    rotation_verified: true,
    signed: {
      version: 3,
      expires_at: '2027-09-05T00:00:00Z',
    },
  };

  const targetsSigned = {
    version: 7,
    expires_at: '2026-09-06T00:00:00Z',
    targets: {
      'browser/METAENGINE-Browser.exe': {
        sha256: H64('a'),
        size: 123456,
        media_type: 'application/vnd.metaengine.browser.executable.v1',
        source_sha: SOURCE_SHA,
      },
    },
  };
  const targets = { role: 'targets', signatures_verified: true, signed: targetsSigned };
  const targetsDescriptor = descriptor(targetsSigned);

  const snapshotSigned = {
    version: 11,
    expires_at: '2026-09-06T00:00:00Z',
    meta: {
      targets: {
        role: 'targets',
        version: targetsSigned.version,
        sha256: targetsDescriptor.sha256,
        size: targetsDescriptor.size,
      },
    },
  };
  const snapshot = { role: 'snapshot', signatures_verified: true, signed: snapshotSigned };
  const snapshotDescriptor = descriptor(snapshotSigned);

  const timestampSigned = {
    version: 19,
    expires_at: '2026-09-05T05:00:00Z',
    meta: {
      snapshot: {
        role: 'snapshot',
        version: snapshotSigned.version,
        sha256: snapshotDescriptor.sha256,
        size: snapshotDescriptor.size,
      },
    },
  };
  const timestamp = { role: 'timestamp', signatures_verified: true, signed: timestampSigned };

  return {
    now: NOW,
    trusted_versions: { root: 3, targets: 7, snapshot: 11, timestamp: 19 },
    root,
    targets,
    snapshot,
    timestamp,
    target_path: 'browser/METAENGINE-Browser.exe',
    provenance: {
      verified: true,
      builder_trusted: true,
      subject_sha256: H64('a'),
      subject_size: 123456,
      source_sha: SOURCE_SHA,
    },
    transparency: {
      verified: true,
      subject_sha256: H64('a'),
      integrated_time_ms: Date.parse('2026-09-05T04:10:00Z'),
    },
    platform_signature_verified: true,
  };
}

test('TUF-like chain binds root/targets/snapshot/timestamp to exact artifact, provenance and transparency', () => {
  const out = evaluateBrowserFabricUpdateTrust(fixture());
  assert.equal(out.ok, true);
  assert.equal(out.schema, BROWSER_FABRIC_UPDATE_TRUST_SCHEMA);
  assert.equal(out.verified_immutable_release_exact, true);
  assert.equal(out.source_sha, SOURCE_SHA);
  assert.equal(out.artifact_sha256, H64('a'));
  assert.equal(out.artifact_size, 123456);
  assert.equal(out.rollback_protected, true);
  assert.equal(out.freeze_protected, true);
  assert.equal(out.mix_and_match_protected, true);
  assert.equal(out.authority_effect, false);
});

test('expired timestamp fails closed instead of accepting a frozen release view', () => {
  const input = fixture();
  input.timestamp = {
    ...input.timestamp,
    signed: { ...input.timestamp.signed, expires_at: '2026-09-05T04:19:59Z' },
  };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'TUF_TIMESTAMP_INVALID_EXPIRED_OR_ROLLED_BACK');
});

test('metadata rollback below trusted version floor fails closed', () => {
  const input = fixture();
  input.trusted_versions = { ...input.trusted_versions, targets: 8 };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'TUF_TARGETS_INVALID_EXPIRED_OR_ROLLED_BACK');
});

test('snapshot cannot mix a different targets metadata digest or size', () => {
  const input = fixture();
  input.snapshot = {
    ...input.snapshot,
    signed: {
      ...input.snapshot.signed,
      meta: {
        targets: { ...input.snapshot.signed.meta.targets, sha256: H64('f') },
      },
    },
  };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'TUF_SNAPSHOT_TARGETS_BINDING_MISMATCH');
});

test('provenance must bind both artifact digest and exact byte size', () => {
  const input = fixture();
  input.provenance = { ...input.provenance, subject_size: 123455 };
  assert.equal(evaluateBrowserFabricUpdateTrust(input).reason, 'SLSA_PROVENANCE_ARTIFACT_BINDING_MISMATCH');
});

test('transparency and platform signature are independent release requirements', () => {
  const noTransparency = fixture();
  noTransparency.transparency = { ...noTransparency.transparency, verified: false };
  assert.equal(evaluateBrowserFabricUpdateTrust(noTransparency).reason, 'TRANSPARENCY_PROOF_INVALID_OR_UNBOUND');

  const noPlatformSignature = fixture();
  noPlatformSignature.platform_signature_verified = false;
  assert.equal(evaluateBrowserFabricUpdateTrust(noPlatformSignature).reason, 'PLATFORM_SIGNATURE_REQUIRED');
});

test('update trust contract never grants release or runtime authority', () => {
  const contract = browserFabricUpdateTrustContract();
  assert.equal(contract.git_sha_alone_sufficient, false);
  assert.equal(contract.snapshot_binds_targets_digest_size_version, true);
  assert.equal(contract.timestamp_binds_snapshot_digest_size_version, true);
  assert.equal(contract.target_descriptor_binds_digest_size_media_type_source, true);
  assert.equal(contract.direct_release_or_authority_effect_allowed, false);
  assert.equal(contract.automatic_retry_allowed, false);
  assert.equal(contract.authority_effect, false);
});
