import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDevosBaseCompatibility } from '../src/devos-base-compatibility.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const task = (basePolicy, overrides = {}) => ({
  base_sha: A,
  claim_class: 'ADVISORY',
  task_spec: { base_policy: basePolicy, read_set: [], write_set: [], contract_set: [], ...(overrides.task_spec || {}) },
  ...overrides,
});

test('null and unknown base policies preserve exact-SHA fencing', () => {
  const missing = evaluateDevosBaseCompatibility({ task: task(null), authoritative_base_sha: B });
  const unknown = evaluateDevosBaseCompatibility({ task: task('magic'), authoritative_base_sha: B });
  assert.equal(missing.state, 'FENCE');
  assert.equal(missing.policy, 'EXACT');
  assert.equal(unknown.state, 'FENCE');
  assert.equal(unknown.policy, 'EXACT');
});

test('LATEST rebind is allowed only for explicit advisory work', () => {
  const advisory = evaluateDevosBaseCompatibility({ task: task('LATEST'), authoritative_base_sha: B });
  const mutating = evaluateDevosBaseCompatibility({ task: task('LATEST', { claim_class: 'MUTATING' }), authoritative_base_sha: B });
  assert.equal(advisory.state, 'REVALIDATE');
  assert.equal(advisory.next_base_sha, B);
  assert.equal(mutating.state, 'FENCE');
  assert.equal(mutating.reason, 'MUTATING_BASE_REVALIDATION_NOT_ENABLED');
});

test('ANCESTOR_OK requires exact verified relation evidence', () => {
  const noProof = evaluateDevosBaseCompatibility({ task: task('ANCESTOR_OK'), authoritative_base_sha: B });
  const proven = evaluateDevosBaseCompatibility({
    task: task('ANCESTOR_OK'), authoritative_base_sha: B,
    ancestor_proof: { verified: true, ancestor_sha: A, descendant_sha: B, source: 'git-merge-base' },
  });
  assert.equal(noProof.state, 'FENCE');
  assert.equal(proven.state, 'REVALIDATE');
  assert.equal(proven.evidence.source, 'git-merge-base');
});

test('SCOPED_REVALIDATE permits unrelated changes and fences dependency overlap', () => {
  const scoped = task('SCOPED_REVALIDATE', {
    task_spec: {
      base_policy: 'SCOPED_REVALIDATE',
      read_set: ['apps/metaengine-browser/src/native-supervisor-client.mjs'],
      write_set: ['apps/metaengine-browser/src/host-agent-ipc.mjs'],
      contract_set: ['apps/metaengine-browser/supabase'],
    },
  });
  const unrelated = evaluateDevosBaseCompatibility({ task: scoped, authoritative_base_sha: B, changed_paths: ['README.md'] });
  const conflict = evaluateDevosBaseCompatibility({ task: scoped, authoritative_base_sha: B, changed_paths: ['apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts'] });
  assert.equal(unrelated.state, 'REVALIDATE');
  assert.equal(unrelated.reason, 'SCOPED_DEPENDENCIES_UNCHANGED');
  assert.equal(conflict.state, 'FENCE');
  assert.equal(conflict.reason, 'SCOPED_DEPENDENCY_CHANGED');
  assert.equal(conflict.dependency_conflict, 'apps/metaengine-browser/supabase');
});

test('SCOPED_REVALIDATE fails closed without dependency or changed-path evidence', () => {
  const noDependencies = evaluateDevosBaseCompatibility({ task: task('SCOPED_REVALIDATE'), authoritative_base_sha: B, changed_paths: [] });
  const noChanges = evaluateDevosBaseCompatibility({
    task: task('SCOPED_REVALIDATE', { task_spec: { base_policy: 'SCOPED_REVALIDATE', read_set: ['apps/metaengine-browser/src'], write_set: [], contract_set: [] } }),
    authoritative_base_sha: B,
  });
  assert.equal(noDependencies.state, 'FENCE');
  assert.equal(noDependencies.reason, 'SCOPED_DEPENDENCY_SET_REQUIRED');
  assert.equal(noChanges.state, 'FENCE');
  assert.equal(noChanges.reason, 'SCOPED_CHANGED_PATHS_REQUIRED');
});
