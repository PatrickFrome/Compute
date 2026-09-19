import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SCHEMA, compareWorkflowManifests } = require('../scripts/release-target-workflow-auth-preflight.cjs');

const sha = (c) => c.repeat(40);
const row = (path, digest, type = 'file') => ({ path, sha: digest, type });

test('release preflight allows GITHUB_TOKEN only when workflow manifests are identical', () => {
  const rows = [
    row('.github/workflows/a.yml', sha('a')),
    row('.github/workflows/b.yml', sha('b')),
  ];
  const receipt = compareWorkflowManifests({
    defaultRows: rows,
    targetRows: [...rows].reverse(),
    defaultBranch: 'main',
    targetSha: sha('c'),
  });
  assert.equal(receipt.schema, SCHEMA);
  assert.equal(receipt.state, 'GITHUB_TOKEN_ELIGIBLE');
  assert.equal(receipt.workflow_drift_count, 0);
  assert.deepEqual(receipt.workflow_drift_sample, []);
  assert.equal(receipt.github_token_supported, true);
  assert.equal(receipt.external_workflows_write_actor_required, false);
  assert.equal(receipt.automatic_retry_allowed, false);
  assert.equal(receipt.authority_effect, false);
});

test('release preflight fails closed on workflow content drift', () => {
  const receipt = compareWorkflowManifests({
    defaultRows: [row('.github/workflows/a.yml', sha('a'))],
    targetRows: [row('.github/workflows/a.yml', sha('b'))],
    defaultBranch: 'main',
    targetSha: sha('c'),
  });
  assert.equal(receipt.state, 'BLOCKED_WORKFLOWS_WRITE_REQUIRED');
  assert.equal(receipt.workflow_drift_count, 1);
  assert.deepEqual(receipt.workflow_drift_sample, ['.github/workflows/a.yml']);
  assert.equal(receipt.github_token_supported, false);
  assert.equal(receipt.external_workflows_write_actor_required, true);
  assert.equal(receipt.automatic_retry_allowed, false);
  assert.equal(receipt.authority_effect, false);
});

test('release preflight treats added and removed workflow files as authorization drift', () => {
  const receipt = compareWorkflowManifests({
    defaultRows: [
      row('.github/workflows/a.yml', sha('a')),
      row('.github/workflows/removed.yml', sha('b')),
    ],
    targetRows: [
      row('.github/workflows/a.yml', sha('a')),
      row('.github/workflows/added.yml', sha('c')),
    ],
    defaultBranch: 'main',
    targetSha: sha('d'),
  });
  assert.equal(receipt.workflow_drift_count, 2);
  assert.deepEqual(receipt.workflow_drift_sample, [
    '.github/workflows/added.yml',
    '.github/workflows/removed.yml',
  ]);
});

test('release preflight keeps the drift receipt bounded and deterministic', () => {
  const defaultRows = [];
  const targetRows = Array.from({ length: 40 }, (_, index) =>
    row(`.github/workflows/w-${String(index).padStart(2, '0')}.yml`, sha((index % 10).toString()))
  );
  const receipt = compareWorkflowManifests({
    defaultRows,
    targetRows,
    defaultBranch: 'main',
    targetSha: sha('e'),
  });
  assert.equal(receipt.workflow_drift_count, 40);
  assert.equal(receipt.workflow_drift_sample.length, 32);
  assert.equal(receipt.workflow_drift_sample[0], '.github/workflows/w-00.yml');
  assert.equal(receipt.workflow_drift_sample.at(-1), '.github/workflows/w-31.yml');
});

test('release preflight rejects malformed or non-workflow manifest rows', () => {
  assert.throws(() => compareWorkflowManifests({
    defaultRows: [{ path: 'README.md', sha: sha('a'), type: 'file' }],
    targetRows: [],
    defaultBranch: 'main',
    targetSha: sha('b'),
  }), /manifest_row_incomplete/);
});
