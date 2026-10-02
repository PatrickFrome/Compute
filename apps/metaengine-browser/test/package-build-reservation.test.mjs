import assert from 'node:assert/strict';
import test from 'node:test';

import {
  candidateArtifactName,
  evaluatePackageBuildReservation,
  reservationArtifactName,
} from '../scripts/package-build-reservation.mjs';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const VERSION = '0.7.0-dev.36975000001.1';
const RUN_ID = 36975000002;

function artifact({
  id = 11,
  name,
  runId = 100,
  head = OTHER_HEAD,
  expired = false,
} = {}) {
  return {
    id,
    name,
    expired,
    created_at: '2026-10-02T06:00:00Z',
    digest: 'sha256:' + 'c'.repeat(64),
    workflow_run: {
      id: runId,
      head_sha: head,
    },
  };
}

function evaluate(overrides = {}) {
  return evaluatePackageBuildReservation({
    repository: 'PatrickFrome/Compute',
    sourceHead: HEAD,
    packageVersion: VERSION,
    runId: RUN_ID,
    runAttempt: 1,
    versionArtifacts: [],
    sourceArtifacts: [],
    ...overrides,
  });
}

test('first exact source/version build is admitted as zero-authority preflight', () => {
  const proof = evaluate();
  assert.equal(proof.schema, 'metaengine.browser.package-build-reservation-preflight.v1');
  assert.equal(proof.physical_package_build_allowed, true);
  assert.equal(proof.reservation_artifact_name, reservationArtifactName(VERSION));
  assert.equal(proof.candidate_artifact_name, candidateArtifactName(HEAD));
  assert.equal(proof.automatic_retry_allowed, false);
  assert.equal(proof.promotion_authorized, false);
  assert.equal(proof.authority_effect, false);
});

test('GitHub workflow rerun attempt is refused before physical packaging', () => {
  assert.throws(
    () => evaluate({ runAttempt: 2 }),
    (error) => error?.code === 'PACKAGE_IDENTITY_RERUN_REQUIRES_NEW_SOURCE_AND_VERSION',
  );
});

test('existing version reservation from another run fails closed across source heads', () => {
  assert.throws(
    () => evaluate({
      versionArtifacts: [artifact({
        name: reservationArtifactName(VERSION),
        runId: RUN_ID - 1,
        head: OTHER_HEAD,
      })],
    }),
    (error) => {
      assert.equal(error?.code, 'PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED');
      assert.equal(error?.details?.prior_source_head, OTHER_HEAD);
      return true;
    },
  );
});

test('existing source candidate from another run fails closed even without version marker', () => {
  assert.throws(
    () => evaluate({
      sourceArtifacts: [artifact({
        name: candidateArtifactName(HEAD),
        runId: RUN_ID - 1,
        head: HEAD,
      })],
    }),
    (error) => error?.code === 'PACKAGE_IDENTITY_SOURCE_ALREADY_BUILT',
  );
});

test('expired artifacts and current-run artifacts do not create false collisions', () => {
  const proof = evaluate({
    versionArtifacts: [
      artifact({ name: reservationArtifactName(VERSION), runId: RUN_ID - 1, expired: true }),
      artifact({ name: reservationArtifactName(VERSION), runId: RUN_ID, head: HEAD }),
    ],
    sourceArtifacts: [
      artifact({ name: candidateArtifactName(HEAD), runId: RUN_ID - 1, head: HEAD, expired: true }),
      artifact({ name: candidateArtifactName(HEAD), runId: RUN_ID, head: HEAD }),
    ],
  });
  assert.equal(proof.physical_package_build_allowed, true);
});

test('malformed repository, source, version, run, or attempt fails before proof creation', () => {
  assert.throws(() => evaluate({ repository: 'Compute' }), /repository_invalid/);
  assert.throws(() => evaluate({ sourceHead: 'abc' }), /source_head_invalid/);
  assert.throws(() => evaluate({ packageVersion: '0.7.0' }), /version_invalid/);
  assert.throws(() => evaluate({ runId: 'x' }), /run_id_invalid/);
  assert.throws(() => evaluate({ runAttempt: 0 }), /run_attempt_invalid/);
});
