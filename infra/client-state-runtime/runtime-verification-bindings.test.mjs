import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRuntimeBindings, finishRuntimeBindings } from './runtime-verification-bindings.mjs';

test('missing evidence bindings can produce only smoke classification', () => {
  const value = classifyRuntimeBindings({ missing: ['restore_path'], diskStable: true, startupMatched: true });
  assert.equal(value.level, 'SMOKE_ONLY');
  assert.equal(value.complete_bindings, false);
  assert.equal(value.process_code_attested, false);
  assert.equal(classifyRuntimeBindings({ diskStable: true }).level, 'SOURCE_BOUND_SMOKE');
});

test('disk or instance drift invalidates successful functional probes', () => {
  const before = { manifest_sha256: 'a', source_tree_sha256: 'b', git: { head: 'c' }, missing: [], health: { instance_id: 'd', endpoint: 'http://127.0.0.1:15433' } };
  const after = structuredClone(before);
  assert.equal(finishRuntimeBindings(before, after).level, 'SOURCE_BOUND_SMOKE');
  before.startup = { matched: true, source_manifest_sha256: 'started-bytes' };
  after.startup = structuredClone(before.startup);
  assert.equal(finishRuntimeBindings(before, after).level, 'STARTUP_MANIFEST_BOUND_SMOKE');
  after.manifest_sha256 = 'different';
  assert.throws(() => finishRuntimeBindings(before, after), /source_changed_during_probes/);
  after.manifest_sha256 = before.manifest_sha256;
  after.health.instance_id = 'new-process';
  assert.throws(() => finishRuntimeBindings(before, after), /candidate_changed_during_probes/);
});

test('startup source equality does not become a loaded-code cryptographic attestation', () => {
  const value = classifyRuntimeBindings({ diskStable: true, startupMatched: true });
  assert.equal(value.level, 'STARTUP_MANIFEST_BOUND_SMOKE');
  assert.equal(value.process_code_attested, false);
});
