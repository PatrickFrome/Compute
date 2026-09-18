import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCandidateCapsule, verifyCandidateCapsule } = require('../src/candidate-capsule.cjs');

const SOURCE = Object.freeze({ repository: 'PatrickFrome/Compute', head: 'a'.repeat(40), ref: 'refs/heads/work/metaengine-browser-shell-v1' });
const D1 = `sha256:${'1'.repeat(64)}`;
const D2 = `sha256:${'2'.repeat(64)}`;

function payload(overrides = {}) {
  return {
    source_head: SOURCE.head,
    sequence: 7,
    previous_candidate_id: null,
    intent: 'Add deterministic candidate provenance without promotion authority',
    components: [
      { path: 'apps/metaengine-browser/src/development-plane.mjs', change: 'MODIFY', digest: D1 },
      { path: 'apps/metaengine-browser/test/development-plane.test.mjs', change: 'MODIFY', digest: D2 },
    ],
    verification_plan: [
      { id: 'UNIT_TESTS', required: true },
      { id: 'SECURITY_STATIC', required: true },
    ],
    evidence: [{ name: 'BASELINE_CI', digest: D1 }],
    ...overrides,
  };
}

test('candidate capsule is deterministic across semantically equivalent input ordering', () => {
  const a = createCandidateCapsule(payload(), SOURCE);
  const b = createCandidateCapsule(payload({
    components: [...payload().components].reverse(),
    verification_plan: [...payload().verification_plan].reverse(),
  }), SOURCE);
  assert.equal(a.candidate_id, b.candidate_id);
  assert.equal(a.digest, b.digest);
  assert.equal(a.policy.candidate_only, true);
  assert.equal(a.policy.executable, false);
  assert.equal(a.policy.direct_promote_current, false);
  assert.equal(a.provenance.signed, false);
});

test('candidate creation is bound to exact current source head', () => {
  assert.throws(() => createCandidateCapsule(payload({ source_head: 'b'.repeat(40) }), SOURCE), /source_head_mismatch/);
});

test('candidate rejects path traversal and command-like verification payload surfaces', () => {
  assert.throws(() => createCandidateCapsule(payload({ components: [{ path: '../escape', change: 'MODIFY', digest: D1 }] }), SOURCE), /path_invalid/);
  assert.throws(() => createCandidateCapsule(payload({ verification_plan: [{ id: 'run shell now', required: true }] }), SOURCE), /verification_step_invalid/);
});

test('verification recomputes digest and rejects tampering', () => {
  const capsule = createCandidateCapsule(payload(), SOURCE);
  const receipt = verifyCandidateCapsule(capsule, SOURCE);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.source_current, true);
  assert.equal(receipt.promotion_authorized, false);
  const tampered = structuredClone(capsule);
  tampered.intent = 'tampered';
  assert.throws(() => verifyCandidateCapsule(tampered, SOURCE), /digest_mismatch/);
});

test('verification rejects stale source even when capsule digest itself is intact', () => {
  const capsule = createCandidateCapsule(payload(), SOURCE);
  assert.throws(() => verifyCandidateCapsule(capsule, { ...SOURCE, head: 'c'.repeat(40) }), /source_head_mismatch/);
});

test('policy tampering cannot be hidden behind a matching candidate id', () => {
  const capsule = createCandidateCapsule(payload(), SOURCE);
  const tampered = structuredClone(capsule);
  tampered.policy.direct_promote_current = true;
  assert.throws(() => verifyCandidateCapsule(tampered, SOURCE), /policy_tampered/);
});
