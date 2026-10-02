import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILD_TYPE,
  DEFAULT_REPOSITORY,
  DEFAULT_WORKFLOW_PATH,
  EVIDENCE_SCHEMA,
  PREDICATE_TYPE,
  verifyBrowserSlsaProvenance,
} from '../scripts/browser-slsa-provenance-verification.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const SOURCE_REF = 'refs/heads/work/build-slsa-provenance-physical-v1';
const INSTALLER_NAME = 'METAENGINE-Browser-Test-Setup-0.7.0-dev.37007000001.1-x64.exe';
const INSTALLER_SHA = 'b'.repeat(64);
const RUN_ID = '44444444444';
const RUN_ATTEMPT = '1';
const REPOSITORY_URL = `https://github.com/${DEFAULT_REPOSITORY}`;
const BUILDER_ID = `${REPOSITORY_URL}/${DEFAULT_WORKFLOW_PATH}@${SOURCE_REF}`;

function statement() {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{
      name: INSTALLER_NAME,
      digest: { sha256: INSTALLER_SHA },
    }],
    predicateType: PREDICATE_TYPE,
    predicate: {
      buildDefinition: {
        buildType: BUILD_TYPE,
        externalParameters: {
          workflow: {
            ref: SOURCE_REF,
            repository: REPOSITORY_URL,
            path: DEFAULT_WORKFLOW_PATH,
          },
        },
        internalParameters: {
          github: {
            event_name: 'push',
            repository_id: '1341371143',
            repository_owner_id: '20597814',
            runner_environment: 'github-hosted',
          },
        },
        resolvedDependencies: [{
          uri: `git+${REPOSITORY_URL}@${SOURCE_REF}`,
          digest: { gitCommit: SOURCE_SHA },
        }],
      },
      runDetails: {
        builder: {
          id: BUILDER_ID,
        },
        metadata: {
          invocationId: `${REPOSITORY_URL}/actions/runs/${RUN_ID}/attempts/${RUN_ATTEMPT}`,
        },
      },
    },
  };
}

function verification(value = statement()) {
  return [{
    attestation: { fixture: true },
    verificationResult: { statement: value },
  }];
}

function input(overrides = {}) {
  return {
    verification: verification(),
    expectedSourceSha: SOURCE_SHA,
    expectedSourceRef: SOURCE_REF,
    expectedInstallerName: INSTALLER_NAME,
    expectedInstallerSha256: INSTALLER_SHA,
    expectedRunId: RUN_ID,
    expectedRunAttempt: RUN_ATTEMPT,
    verifiedAt: '2026-10-03T00:00:00.000Z',
    now: new Date('2026-10-03T00:01:00.000Z'),
    ...overrides,
  };
}

test('verified GitHub push provenance maps exactly to Browser Fabric provenance evidence', () => {
  const out = verifyBrowserSlsaProvenance(input());
  assert.deepEqual(Object.keys(out).sort(), [
    'authority_effect',
    'builder_id',
    'builder_trusted',
    'predicate_type',
    'schema',
    'source_sha',
    'subject_name',
    'subject_sha256',
    'verified',
    'verified_at',
    'verifier_id',
  ].sort());
  assert.equal(out.schema, EVIDENCE_SCHEMA);
  assert.equal(out.verifier_id, `github-slsa:${RUN_ID}:${RUN_ATTEMPT}`);
  assert.equal(out.verified, true);
  assert.equal(out.builder_trusted, true);
  assert.equal(out.builder_id, BUILDER_ID);
  assert.equal(out.source_sha, SOURCE_SHA);
  assert.equal(out.subject_name, INSTALLER_NAME);
  assert.equal(out.subject_sha256, INSTALLER_SHA);
  assert.equal(out.predicate_type, PREDICATE_TYPE);
  assert.equal(out.authority_effect, false);
});

test('pull-request provenance is rejected even when the artifact subject is exact', () => {
  const value = statement();
  value.predicate.buildDefinition.internalParameters.github.event_name = 'pull_request';
  assert.throws(
    () => verifyBrowserSlsaProvenance(input({ verification: verification(value) })),
    /browser_slsa_event_not_push/,
  );
});

test('synthetic merge commit provenance cannot impersonate the physical PR head', () => {
  const value = statement();
  value.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'c'.repeat(40);
  assert.throws(
    () => verifyBrowserSlsaProvenance(input({ verification: verification(value) })),
    /browser_slsa_source_sha_mismatch/,
  );
});

test('pull merge refs are forbidden as producer source identity', () => {
  assert.throws(
    () => verifyBrowserSlsaProvenance(input({ expectedSourceRef: 'refs/pull/1099/merge' })),
    /browser_slsa_source_ref_not_branch|browser_slsa_pull_request_ref_forbidden/,
  );
});

test('builder identity must be exact Package Smoke workflow and exact source ref', () => {
  const value = statement();
  value.predicate.runDetails.builder.id = `${REPOSITORY_URL}/.github/workflows/other.yml@${SOURCE_REF}`;
  assert.throws(
    () => verifyBrowserSlsaProvenance(input({ verification: verification(value) })),
    /browser_slsa_builder_id_mismatch/,
  );
});

test('installer subject digest drift fails closed', () => {
  const value = statement();
  value.subject[0].digest.sha256 = 'd'.repeat(64);
  assert.throws(
    () => verifyBrowserSlsaProvenance(input({ verification: verification(value) })),
    /browser_slsa_subject_digest_mismatch/,
  );
});

test('provenance invocation must identify the exact producer run and attempt', () => {
  const value = statement();
  value.predicate.runDetails.metadata.invocationId =
    `${REPOSITORY_URL}/actions/runs/999999/attempts/2`;
  assert.throws(
    () => verifyBrowserSlsaProvenance(input({ verification: verification(value) })),
    /browser_slsa_invocation_id_mismatch/,
  );
});

test('extra resolved dependencies are rejected instead of silently widening build materials', () => {
  const value = statement();
  value.predicate.buildDefinition.resolvedDependencies.push({
    uri: 'git+https://github.com/example/other@refs/heads/main',
    digest: { gitCommit: 'e'.repeat(40) },
  });
  assert.throws(
    () => verifyBrowserSlsaProvenance(input({ verification: verification(value) })),
    /browser_slsa_resolved_dependency_cardinality_invalid/,
  );
});

test('self-hosted provenance is rejected at semantic layer as defense in depth', () => {
  const value = statement();
  value.predicate.buildDefinition.internalParameters.github.runner_environment = 'self-hosted';
  assert.throws(
    () => verifyBrowserSlsaProvenance(input({ verification: verification(value) })),
    /browser_slsa_runner_not_github_hosted/,
  );
});

test('future-dated verification evidence is rejected', () => {
  assert.throws(
    () => verifyBrowserSlsaProvenance(input({
      verifiedAt: '2026-10-03T00:02:00.000Z',
      now: new Date('2026-10-03T00:01:00.000Z'),
    })),
    /browser_slsa_verified_at_invalid/,
  );
});
