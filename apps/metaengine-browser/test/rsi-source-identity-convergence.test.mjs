import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSourceIdentityConvergenceEvidence,
  verifyRsiSourceIdentityConvergenceEvidence,
  rsiSourceIdentityConvergenceTrustRootSnapshot,
} from '../src/rsi-source-identity-convergence.mjs';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;

function create(overrides = {}) {
  return createRsiSourceIdentityConvergenceEvidence({
    evidence_id: 'source.identity.evidence.1',
    github_source_sha: a,
    db_authority_baseline_sha: a,
    runtime_target_git_sha: a,
    github_ref: 'refs/heads/main',
    db_authority_key: 'METAENGINE_DEVOS',
    runtime_client_id: 'runtime-client-1',
    db_alignment_epoch: 87,
    github_readback_digest: d('1'),
    db_authority_readback_digest: d('2'),
    runtime_readback_digest: d('3'),
    observed_at: '2026-09-19T15:53:09Z',
    external_github_reader: true,
    external_db_reader: true,
    external_runtime_reader: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

test('exact GitHub, DB authority and runtime SHA equality is the only converged state', () => {
  const evidence = create();
  assert.equal(evidence.state, 'SOURCE_IDENTITY_CONVERGED');
  assert.equal(evidence.source_identity_converged, true);
  assert.equal(evidence.eligible_for_external_admission_review, true);
  assert.deepEqual(evidence.blockers, []);
  assert.equal(evidence.ancestry_equivalence_allowed, false);
  assert.equal(evidence.semantic_equivalence_allowed, false);
  assert.equal(evidence.version_string_equivalence_allowed, false);
  assert.equal(evidence.execution_authority, false);
  assert.equal(evidence.browser_authority, false);
  assert.equal(evidence.task_authority, false);
  assert.equal(evidence.promotion_authority, false);
  assert.equal(evidence.authority_effect, false);
  assert.equal(
    verifyRsiSourceIdentityConvergenceEvidence(evidence).evidence_digest,
    evidence.evidence_digest,
  );
});

test('three different source identities fail closed and enumerate every pairwise drift', () => {
  const evidence = create({
    github_source_sha: a,
    db_authority_baseline_sha: b,
    runtime_target_git_sha: c,
  });
  assert.equal(evidence.state, 'SOURCE_IDENTITY_DRIFT');
  assert.equal(evidence.source_identity_converged, false);
  assert.equal(evidence.eligible_for_external_admission_review, false);
  assert.deepEqual(evidence.blockers, [
    'DB_RUNTIME_SOURCE_MISMATCH',
    'GITHUB_DB_SOURCE_MISMATCH',
    'GITHUB_RUNTIME_SOURCE_MISMATCH',
  ]);
});

test('one stale authority plane remains drift even when GitHub and runtime match', () => {
  const evidence = create({
    github_source_sha: a,
    db_authority_baseline_sha: b,
    runtime_target_git_sha: a,
  });
  assert.equal(evidence.state, 'SOURCE_IDENTITY_DRIFT');
  assert.deepEqual(evidence.blockers, [
    'DB_RUNTIME_SOURCE_MISMATCH',
    'GITHUB_DB_SOURCE_MISMATCH',
  ]);
  assert.equal(evidence.eligible_for_external_admission_review, false);
});

test('candidate-authored or missing external readback ownership is rejected', () => {
  assert.throws(
    () => create({ authored_by_candidate: true }),
    /external_readbacks_required/,
  );
  assert.throws(
    () => create({ external_runtime_reader: false }),
    /external_readbacks_required/,
  );
});

test('tampering any exact source coordinate invalidates the evidence digest', () => {
  const evidence = create();
  assert.throws(
    () => verifyRsiSourceIdentityConvergenceEvidence({
      ...evidence,
      runtime_target_git_sha: b,
    }),
    /evidence_digest_mismatch/,
  );
});

test('trust root freezes exact equality and keeps the gate zero-authority', () => {
  const root = rsiSourceIdentityConvergenceTrustRootSnapshot();
  assert.equal(root.exact_three_way_sha_equality_required, true);
  assert.equal(root.independent_readback_digests_required, true);
  assert.equal(root.drift_blocks_external_admission_review, true);
  assert.equal(root.candidate_cannot_author_source_identity, true);
  assert.equal(root.ancestry_equivalence_allowed, false);
  assert.equal(root.semantic_equivalence_allowed, false);
  assert.equal(root.version_string_equivalence_allowed, false);
  assert.equal(root.execution_authority, false);
  assert.equal(root.browser_authority, false);
  assert.equal(root.task_authority, false);
  assert.equal(root.scheduler_authority, false);
  assert.equal(root.promotion_authority, false);
  assert.equal(root.self_update_authority, false);
  assert.equal(root.authority_effect, false);
});
