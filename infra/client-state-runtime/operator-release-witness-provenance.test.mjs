import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectReleaseWitnessProvenance as inspect, RELEASE_WITNESS_PROVENANCE_SCHEMA } from './operator-release-witness-provenance.mjs';
import { PROOF_SCHEMA } from '../../scripts/release-attestation-verification.mjs';
import { OPERATOR_HOST_SOURCE, OPERATOR_HOST_EVIDENCE_SCHEMA, reduceHostProcessObservation } from './operator-host-incarnation-core.mjs';
import { verifyReleaseEvidenceIdentity } from './operator-release-evidence-identity.mjs';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const at = milliseconds => new Date(NOW + milliseconds).toISOString();
const SHA = 'a'.repeat(40), HASH = 'b'.repeat(64), ROOT = 'c'.repeat(64);
const policy = { nowMs: NOW };
function witnesses() {
  return {
    expected: { git_sha: SHA, owner_id: 'owner-identity-123', process_incarnation: 'browser-process-456', observed_at: at(-1000) },
    source: { git_sha: SHA, observed_at: at(-1000) },
    build: { source_sha: SHA, artifact_sha256: HASH, observed_at: at(-1000) },
    package: { source_sha: SHA, artifact_sha256: HASH, observed_at: at(-1000) },
    runtime: { source_sha: SHA, artifact_sha256: HASH, owner_id: 'owner-identity-123', process_incarnation: 'browser-process-456', observed_at: at(-1000) },
    owner: { owner_id: 'owner-identity-123', process_incarnation: 'browser-process-456', observed_at: at(-1000) },
    artifact: { sha256: HASH, observed_at: at(-1000) },
  };
}
function receipt() {
  // Entirely forgeable fixture: even all "verified" bits MUST remain inert.
  return {
    schema: PROOF_SCHEMA, repository: 'PatrickFrome/Compute',
    source_head: SHA, installer_sha256: HASH, trusted_root_sha256: ROOT,
    cryptographic_verification: true, signer_identity_verified: true,
    semantic_binding_verified: true, trusted_root_snapshot_bound: true,
    authority_effect: false, promotion_authorized: false, release_published: false,
  };
}
function host() {
  const owner = {
    owner_id: 'owner-identity-123', device_id: 'device-identity-456', generation: 3,
    pid: 9001, created_at: at(-24000), process_incarnation_id: 'owner-process-123',
    observed_at: at(-200),
  };
  const browser = { pid: 4554, created_at: at(-12000), process_incarnation_id: 'browser-process-456' };
  const guardian = {
    schema: 'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
    state: 'READY', ready: true, guardian_service_ready: true,
    owner_binding_proven: true, device_binding_proven: true,
    stale: false, authority_effect: false, automatic_retry_allowed: false,
    owner_id: owner.owner_id, device_id: owner.device_id, owner_generation: owner.generation,
    owner_pid: owner.pid, owner_created_at: owner.created_at, owner_process_incarnation_id: owner.process_incarnation_id,
    observed_at: at(-170),
  };
  const channels = Object.fromEntries(['startup','liveness','readiness','progress'].map(key =>
    [key, { sequence: 4, observed_at_ms: NOW - 100 }]));
  return {
    schema: OPERATOR_HOST_EVIDENCE_SCHEMA, source: OPERATOR_HOST_SOURCE, authority_effect: false,
    observed_at: at(-100), owner, browser, guardian,
    guardian_health_observed_at: at(-150),
    owner_runtime_probe: {
      source: 'OS_PROCESS_INVENTORY', pid: owner.pid, created_at: owner.created_at,
      process_incarnation_id: owner.process_incarnation_id, observed_at: at(-80), state: 'PRESENT',
    },
    runtime_probe: {
      source: 'OS_PROCESS_INVENTORY', pid: browser.pid, created_at: browser.created_at,
      process_incarnation_id: browser.process_incarnation_id, observed_at: at(-80), state: 'PRESENT',
    },
    heartbeat_fence: { valid: true, reason: 'EXACT_SPLIT_HEARTBEATS_FENCED',
      pid: browser.pid, process_incarnation_id: browser.process_incarnation_id, channels },
  };
}
const call = (changes = {}) => inspect({
  witnesses: witnesses(), issuerEvidence: receipt(), hostObservation: host(), ...changes,
}, policy);
const noAuthority = v => {
  assert.equal(v.schema, RELEASE_WITNESS_PROVENANCE_SCHEMA);
  assert.equal(v.authenticity, 'UNKNOWN');
  for (const key of ['trusted_issuer_proven','trusted_runtime_proven','provenance_cryptographically_verified',
    'release_ready','installed_runtime_proven','authority_effect','scheduler_authority','automatic_retry_allowed','remote_fallback_allowed'])
    assert.equal(v[key], false, key);
};

test('existing W11 and Host structural reducers can MATCH/AVAILABLE, but forged provenance stays UNKNOWN', () => {
  assert.equal(verifyReleaseEvidenceIdentity(witnesses(), policy).state, 'MATCH');
  assert.equal(reduceHostProcessObservation(host(), {nowMs: NOW, maxAgeMs: 10000}).state, 'AVAILABLE');
  const r = call(); assert.equal(r.state, 'UNKNOWN'); noAuthority(r);
  assert.equal(r.identity_consistency, 'MATCH');
  assert.ok(r.reasons.includes('ISSUER_ORIGIN_NOT_AUTHENTICATED'));
  assert.ok(r.reasons.includes('HOST_OBSERVATION_ORIGIN_NOT_AUTHENTICATED'));
});

test('missing trusted issuer remains UNKNOWN even with synthetic complete Host inventory', () => {
  const r = call({issuerEvidence: null}); assert.equal(r.state, 'UNKNOWN');
  assert.ok(r.reasons.includes('TRUSTED_ISSUER_ABSENT')); noAuthority(r);
});

test('verified, signer, trusted-root flags supplied by caller are never provenance', () => {
  for (const key of ['verified','signature_verified','issuer_trusted','authenticated','cryptographic_verification','trusted']) {
    const w = witnesses(); w.build[key] = true;
    const r = call({witnesses: w}); assert.equal(r.state, 'UNKNOWN', key);
    assert.ok(r.reasons.includes('SELF_ASSERTED_VERIFICATION_IGNORED'), key);
    noAuthority(r);
  }
  const i = receipt();
  i.verified = true;
  assert.equal(call({issuerEvidence:i}).state, 'UNKNOWN');
});

test('missing Host/Guardian/native owner evidence never inherits issuer flags', () => {
  for (const value of [null, undefined, {}]) {
    const r = call({hostObservation:value});
    assert.equal(r.state, 'UNKNOWN'); noAuthority(r);
  }
});

test('an issuer receipt source/digest/repository contradiction blocks, even though it asserts verified', () => {
  for (const mutation of [
    i => {i.source_head='d'.repeat(40);},
    i => {i.installer_sha256='d'.repeat(64);},
    i => {i.repository='attacker/forged';},
    i => {i.schema='spoofed.schema';},
    i => {i.authority_effect=true;},
    i => {i.promotion_authorized=true;},
    i => {i.release_published=true;},
    i => {i.trusted_root_sha256='not-a-digest';},
  ]) {
    const i=receipt(); mutation(i);
    const r=call({issuerEvidence:i}); assert.equal(r.state,'BLOCKED');
    noAuthority(r);
  }
});

test('missing or unsigned root provenance stays UNKNOWN rather than verified', () => {
  const i=receipt(); delete i.trusted_root_sha256;
  const r=call({issuerEvidence:i}); assert.equal(r.state,'UNKNOWN');
  assert.ok(r.reasons.includes('ISSUER_ROOT_DIGEST_MISSING'));
});

test('W11 source/package/Owner contradictions block despite missing issuer and Host', () => {
  for (const mutate of [
    w=>{w.package.source_sha='d'.repeat(40);},
    w=>{w.artifact.sha256='d'.repeat(64);},
    w=>{w.runtime.owner_id='other-owner';},
  ]) {
    const w=witnesses(); mutate(w);
    const r=call({witnesses:w, issuerEvidence:null, hostObservation:null});
    assert.equal(r.state,'BLOCKED'); assert.ok(r.reasons.includes('RELEASE_IDENTITY_CONFLICT'));
    noAuthority(r);
  }
});

test('stale Guardian, PID reuse, child incarnation swap are rejected by existing Host fence', () => {
  for (const mutate of [
    h => {h.guardian.observed_at=at(-20000);},
    h => {h.runtime_probe.created_at=at(-2000);},
    h => {h.browser.process_incarnation_id='browser-process-789';},
  ]) {
    const h=host(); mutate(h);
    const r=call({hostObservation:h}); assert.equal(r.state,'BLOCKED');
    noAuthority(r);
  }
});

test('W11 runtime token cannot be replayed against newly born native Browser', () => {
  const h=host(); h.browser.process_incarnation_id='browser-process-789';
  h.runtime_probe.process_incarnation_id='browser-process-789';
  h.heartbeat_fence.process_incarnation_id='browser-process-789';
  const r=call({hostObservation:h});
  assert.equal(reduceHostProcessObservation(h,{nowMs:NOW,maxAgeMs:10000}).state,'AVAILABLE');
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('RUNTIME_INCARNATION_MISMATCH'));
});

test('fresh W11 snapshot predating actual Browser creation cannot prove running bytes', () => {
  const w=witnesses();
  for (const v of Object.values(w)) v.observed_at=at(-20000);
  assert.equal(verifyReleaseEvidenceIdentity(w, policy).state,'MATCH');
  const r=call({witnesses:w});
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('RUNTIME_SNAPSHOT_PRECEDES_PROCESS_BIRTH'));
});

test('native Owner binding mismatch is BLOCKED, not promoted by guardian READY', () => {
  const h=host(); h.owner.owner_id='different-owner'; h.guardian.owner_id='different-owner';
  const r=call({hostObservation:h}); assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('HOST_OWNER_MISMATCH')); noAuthority(r);
});

test('non-data getter, malformed issuer and bad clock fail closed without leaking evidence', () => {
  const i=receipt(); Object.defineProperty(i,'source_head',{get(){throw Error('secret!');}});
  const r=call({issuerEvidence:i});
  assert.equal(r.state,'BLOCKED');
  assert.deepEqual(r.reasons,['PROVENANCE_READBACK_INVALID']);
  assert.equal(JSON.stringify(r).includes('secret!'),false);
  assert.equal(call({issuerEvidence:'string'}).state,'BLOCKED');
  assert.equal(inspect({witnesses:witnesses()},{nowMs:Infinity}).state,'BLOCKED');
  noAuthority(r);
});

test('partial native witness stays UNKNOWN unless present source, owner or incarnation contradicts', () => {
  assert.equal(call({hostObservation:{browser:{process_incarnation_id:'browser-process-456'}}}).state,'UNKNOWN');
  const mismatch=call({hostObservation:{browser:{process_incarnation_id:'reused-process'}}});
  assert.equal(mismatch.state,'BLOCKED');
  assert.ok(mismatch.reasons.includes('RUNTIME_INCARNATION_MISMATCH'));
  assert.equal(call({hostObservation:{source:'FORGED_READBACK'}}).state,'BLOCKED');
});
