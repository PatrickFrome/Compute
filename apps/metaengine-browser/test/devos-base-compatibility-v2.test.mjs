import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBaseCompatibility } from '../src/devos-base-compatibility-v2.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('EXACT policy fences every changed base', () => {
  const result = evaluateBaseCompatibility({ created_from_sha: A, base_policy: 'EXACT' }, { next_sha: B, is_ancestor: true });
  assert.equal(result.state, 'FENCED');
  assert.equal(result.reason, 'EXACT_SHA_REQUIRED');
  assert.equal(result.automatic_effect_retry_allowed, false);
});

test('LATEST policy revalidates without pretending to prove an effect', () => {
  const result = evaluateBaseCompatibility({ created_from_sha: A, base_policy: 'LATEST' }, { next_sha: B, is_ancestor: false });
  assert.equal(result.state, 'REVALIDATED');
  assert.equal(result.rebind_allowed, true);
  assert.equal(result.authority_effect, false);
});

test('SCOPED_REVALIDATE survives unrelated baseline changes', () => {
  const result = evaluateBaseCompatibility({
    created_from_sha: A,
    base_policy: 'SCOPED_REVALIDATE',
    read_set: ['apps/metaengine-browser/src/native-supervisor-client-base.mjs'],
    write_set: ['apps/metaengine-browser/src/browser-plan-runtime.mjs'],
    contract_set: ['command-fabric-v2'],
  }, {
    next_sha: B,
    is_ancestor: true,
    changed_paths: ['docs/research.md', 'README.md'],
    changed_contracts: ['unrelated-contract'],
  });
  assert.equal(result.state, 'REVALIDATED');
  assert.equal(result.reason, 'SCOPED_DEPENDENCIES_UNCHANGED');
});

test('SCOPED_REVALIDATE fences a path or contract dependency collision', () => {
  const path = evaluateBaseCompatibility({ created_from_sha: A, base_policy: 'SCOPED_REVALIDATE', read_set: ['src/a.mjs'] }, { next_sha: B, is_ancestor: true, changed_paths: ['src/a.mjs'] });
  assert.equal(path.state, 'FENCED');
  assert.equal(path.reason, 'SCOPED_PATH_CONFLICT');
  assert.equal(path.conflict, 'src/a.mjs');

  const contract = evaluateBaseCompatibility({ created_from_sha: A, base_policy: 'SCOPED_REVALIDATE', contract_set: ['lease-v3'] }, { next_sha: B, is_ancestor: true, changed_contracts: ['lease-v3'] });
  assert.equal(contract.state, 'FENCED');
  assert.equal(contract.reason, 'SCOPED_CONTRACT_CONFLICT');
});

test('SCOPED_REVALIDATE fails closed when ancestry is not proven', () => {
  const result = evaluateBaseCompatibility({ created_from_sha: A, base_policy: 'SCOPED_REVALIDATE' }, { next_sha: B, is_ancestor: false });
  assert.equal(result.state, 'FENCED');
  assert.equal(result.reason, 'ANCESTRY_NOT_PROVEN');
});
