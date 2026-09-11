import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  BROWSER_FABRIC_DESIRED_STATE_POLICY_SCHEMA,
  browserFabricDesiredStatePolicyDigest,
  evaluateBrowserFabricDesiredStatePolicy,
} from '../src/browser-fabric-desired-state-policy.mjs';
import { canonicalFabricJson } from '../src/browser-fabric-effect-ledger.mjs';

const H64 = (ch) => ch.repeat(64);
const SHA = '1'.repeat(40);
const policy = {
  schema: BROWSER_FABRIC_DESIRED_STATE_POLICY_SCHEMA,
  policy_version: '1.0.0',
  generation: 66,
  desired_integration_sha: SHA,
  release_channel: 'dev',
  required_release_tag: 'v0.6.6-dev.42.1',
  required_release_manifest_sha256: H64('a'),
  required_installed_executable_sha256: H64('b'),
  minimum_guardian_protocol_generation: 2,
  new_effect_domains_frozen: true,
  policy_effective_at: '2026-09-05T04:00:00Z',
};

const exactReleaseGate = {
  action: 'AUTHORITY_ADVANCE_CANDIDATE',
  authority_advance_candidate: true,
  candidate_sha: SHA,
  release_tag: policy.required_release_tag,
  manifest_sha256: policy.required_release_manifest_sha256,
  installed_executable_sha256: policy.required_installed_executable_sha256,
  release_authority: false,
  authority_effect: false,
};

const policyKeyPair = crypto.generateKeyPairSync('ed25519');
const policySignature = {
  schema: 'metaengine.browser-fabric.desired-state-signature.v1',
  alg: 'EdDSA',
  key_id: 'key:desired-state-01',
  policy_sha256: browserFabricDesiredStatePolicyDigest(policy),
  signature: crypto.sign(
    null,
    Buffer.from(canonicalFabricJson(policy), 'utf8'),
    policyKeyPair.privateKey,
  ).toString('base64url'),
};

function evaluate(input) {
  return evaluateBrowserFabricDesiredStatePolicy({
    policy_signature: policySignature,
    trusted_policy_public_keys: { 'key:desired-state-01': policyKeyPair.publicKey },
    now: new Date('2026-09-05T04:00:30Z'),
    ...input,
  });
}

test('Git SHA cannot become desired-state authority without exact verified release gate', () => {
  const noRelease = evaluate({
    policy,
    current_policy_generation: 65,
    observed_guardian_protocol_generation: 2,
  });
  assert.equal(noRelease.action, 'HOLD_DESIRED_STATE');
  assert.equal(noRelease.reason, 'VERIFIED_RELEASE_GATE_REQUIRED');
  assert.equal(noRelease.desired_state_authority_candidate, false);
});

test('versioned desired-state policy is monotonic and artifact-bound', () => {
  const stale = evaluate({
    policy,
    current_policy_generation: 66,
    release_gate: exactReleaseGate,
    observed_guardian_protocol_generation: 2,
  });
  assert.equal(stale.reason, 'DESIRED_STATE_POLICY_STALE_GENERATION');

  const wrongExe = evaluate({
    policy,
    current_policy_generation: 65,
    release_gate: { ...exactReleaseGate, installed_executable_sha256: H64('c') },
    observed_guardian_protocol_generation: 2,
  });
  assert.equal(wrongExe.reason, 'DESIRED_STATE_INSTALLED_EXE_MISMATCH');
});

test('exact policy and release produce a candidate, never direct authority mutation', () => {
  const out = evaluate({
    policy,
    current_policy_generation: 65,
    release_gate: exactReleaseGate,
    observed_guardian_protocol_generation: 2,
  });
  assert.equal(out.action, 'DESIRED_STATE_AUTHORITY_CANDIDATE');
  assert.equal(out.desired_state_authority_candidate, true);
  assert.equal(out.requires_separate_journaled_authority_effect, true);
  assert.equal(out.new_effect_domains_frozen, true);
  assert.equal(out.authority_effect, false);
  assert.match(out.policy_hash, /^[0-9a-f]{64}$/);
  assert.equal(out.policy_hash, browserFabricDesiredStatePolicyDigest(policy));
});

test('old Guardian protocol cannot consume newer desired-state policy', () => {
  const out = evaluate({
    policy,
    current_policy_generation: 65,
    release_gate: exactReleaseGate,
    observed_guardian_protocol_generation: 1,
  });
  assert.equal(out.reason, 'GUARDIAN_PROTOCOL_TOO_OLD_FOR_DESIRED_STATE');
});

test('future or unsigned desired-state policy cannot become an authority candidate', () => {
  const unsigned = evaluateBrowserFabricDesiredStatePolicy({
    policy,
    current_policy_generation: 65,
    release_gate: exactReleaseGate,
    observed_guardian_protocol_generation: 2,
    now: new Date('2026-09-05T04:00:30Z'),
  });
  assert.equal(unsigned.reason, 'DESIRED_STATE_POLICY_SIGNATURE_INVALID');

  const future = evaluate({
    policy,
    current_policy_generation: 65,
    release_gate: exactReleaseGate,
    observed_guardian_protocol_generation: 2,
    now: new Date('2026-09-05T03:59:59Z'),
  });
  assert.equal(future.reason, 'DESIRED_STATE_POLICY_NOT_EFFECTIVE');
});
