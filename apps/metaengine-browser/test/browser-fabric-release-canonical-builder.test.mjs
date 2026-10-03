import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateBrowserFabricReleaseAuthorityGate,
  browserFabricReleaseGateContract,
} from '../src/browser-fabric-release-authority-gate.mjs';

const workflow = 'https://github.com/PatrickFrome/Compute/.github/workflows/browser-windows-package-smoke.yml';
const physical = `${workflow}@refs/heads/physical/build-slsa-provenance-v1`;
const release = `${workflow}@refs/heads/release/self-update-ambiguity-live-v2`;

function fixture(builder = physical) {
  const candidate = 'a'.repeat(40);
  const current = 'b'.repeat(40);
  const trusted = {
    schema: 'metaengine.trusted-dev-release.v1', git_sha: candidate,
    tag: 'v0.7.0-dev.37086632570.1', version: '0.7.0-dev.37086632570.1',
    installer_name: 'METAENGINE-Browser-Test-Setup.exe',
    installer_sha256: 'c'.repeat(64), manifest_sha256: 'd'.repeat(64),
    dev_yml_sha256: 'e'.repeat(64), installed_executable_sha256: 'f'.repeat(64),
    target_present_proof_supported: true, authority_effect: false,
  };
  const stamp = { verifier_id: 'independent-verifier:01', verified_at: '2026-10-03T00:00:00Z', authority_effect: false };
  return {
    candidate_sha: candidate, current_authority_sha: current, trusted_release: trusted,
    immutable_release_evidence: {
      ...stamp, schema: 'metaengine.browser-fabric.immutable-release-evidence.v1',
      enabled: true, tag_locked: true, assets_locked: true, attestation_verified: true,
      release_tag: trusted.tag, commit_sha: candidate, manifest_sha256: trusted.manifest_sha256,
      installer_sha256: trusted.installer_sha256, installed_executable_sha256: trusted.installed_executable_sha256,
    },
    provenance_evidence: {
      ...stamp, schema: 'metaengine.browser-fabric.provenance-evidence.v1',
      verified: true, builder_trusted: true, builder_id: builder, source_sha: candidate,
      subject_name: trusted.installer_name, subject_sha256: trusted.installer_sha256,
      predicate_type: 'https://slsa.dev/provenance/v1',
    },
    source_ancestry_evidence: {
      ...stamp, schema: 'metaengine.browser-fabric.source-ancestry-evidence.v1',
      base_sha: current, candidate_sha: candidate, fast_forward_verified: true,
    },
    now: new Date('2026-10-03T01:00:00Z'),
  };
}

for (const builder of [physical, release]) test(`canonical builder ${builder} produces only a journalable candidate`, () => {
  const out = evaluateBrowserFabricReleaseAuthorityGate(fixture(builder));
  assert.equal(out.action, 'AUTHORITY_ADVANCE_CANDIDATE');
  assert.equal(out.requires_separate_journaled_promotion_effect, true);
  assert.equal(out.release_authority, false);
  assert.equal(out.authority_effect, false);
  assert.equal(out.automatic_retry_allowed, false);
});

for (const [label, builder] of [
  ['generic trusted flag', 'github-actions:browser-release'],
  ['fork repository', physical.replace('PatrickFrome/Compute', 'OtherOwner/Compute')],
  ['repository prefix collision', physical.replace('Compute/', 'Compute-Evil/')],
  ['different workflow', physical.replace('browser-windows-package-smoke.yml', 'browser-release-attestation-v1.yml')],
  ['workflow suffix collision', physical.replace('.yml@', '.yml-evil@')],
  ['main ref', `${workflow}@refs/heads/main`],
  ['feature ref', `${workflow}@refs/heads/work/feature`],
  ['physical branch suffix', `${physical}-evil`],
  ['release branch suffix', `${release}-evil`],
  ['tag ref', `${workflow}@refs/tags/v0.7.0`],
  ['PR ref', `${workflow}@refs/pull/1100/merge`],
  ['wrong host', physical.replace('github.com', 'github.com.evil')],
  ['wrong scheme', physical.replace('https:', 'http:')],
  ['case drift', physical.replace('PatrickFrome', 'patrickfrome')],
]) test(`${label} cannot advance authority even when all other proofs are positive`, () => {
  const out = evaluateBrowserFabricReleaseAuthorityGate(fixture(builder));
  assert.equal(out.reason, 'SLSA_PROVENANCE_BUILDER_NOT_CANONICAL');
  assert.equal(out.action, 'HOLD_AUTHORITY');
  assert.equal(out.authority_advance_candidate, false);
  assert.equal(out.release_authority, false);
  assert.equal(out.authority_effect, false);
  assert.equal(out.automatic_retry_allowed, false);
});

test('caller-supplied builder allowlist cannot change local trust policy', () => {
  const value = fixture(`${workflow}@refs/heads/main`);
  const out = evaluateBrowserFabricReleaseAuthorityGate({ ...value, trusted_builder_ids: [value.provenance_evidence.builder_id] });
  assert.equal(out.reason, 'SLSA_PROVENANCE_BUILDER_NOT_CANONICAL');
});

for (const [label, mutate, reason] of [
  ['source drift', x => { x.provenance_evidence.source_sha = '0'.repeat(40); }, 'SLSA_PROVENANCE_SOURCE_MISMATCH'],
  ['subject drift', x => { x.provenance_evidence.subject_name = 'Other-Setup.exe'; }, 'SLSA_PROVENANCE_SUBJECT_NAME_MISMATCH'],
  ['digest drift', x => { x.provenance_evidence.subject_sha256 = '0'.repeat(64); }, 'SLSA_PROVENANCE_SUBJECT_DIGEST_MISMATCH'],
  ['absent cryptographic verification', x => { x.provenance_evidence.verified = false; }, 'SLSA_PROVENANCE_PROOF_REQUIRED'],
  ['missing immutable evidence', x => { delete x.immutable_release_evidence; }, 'IMMUTABLE_RELEASE_PROOF_REQUIRED'],
  ['missing ancestry evidence', x => { delete x.source_ancestry_evidence; }, 'SOURCE_FAST_FORWARD_PROOF_REQUIRED'],
]) test(`canonical builder does not override ${label}`, () => {
  const value = fixture(); mutate(value);
  assert.equal(evaluateBrowserFabricReleaseAuthorityGate(value).reason, reason);
});

test('published gate contract requires canonical builder and forbids direct authority mutation', () => {
  const contract = browserFabricReleaseGateContract();
  assert.equal(contract.provenance_canonical_builder_required, true);
  assert.equal(contract.direct_authority_mutation_allowed, false);
  assert.equal(contract.authority_effect, false);
});
