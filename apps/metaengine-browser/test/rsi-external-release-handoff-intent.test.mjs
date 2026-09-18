import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiExternalReleaseHandoffIntent,
  verifyRsiExternalReleaseHandoffIntent,
  verifyRsiPromotionAttestationVerification,
  rsiExternalReleaseHandoffTrustRootSnapshot,
} from '../src/rsi-external-release-handoff-intent.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digestHex(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}
function digest(value) {
  return 'sha256:' + digestHex(value);
}

const CANDIDATE_ID='candidate_sha256_'+'c'.repeat(64);
const CANDIDATE_SHA='b'.repeat(40);
const PARENT_SHA='a'.repeat(40);

function review() {
  const core={
    schema:'metaengine.rsi.episode-promotion-review.v1',
    version:1,
    state:'READY_FOR_EXTERNAL_RELEASE_HANDOFF_REVIEW',
    episode_id:'rsi_episode_0123456789abcdef01234567',
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE_SHA,
    parent_sha:PARENT_SHA,
    source_sha:PARENT_SHA,
    trust_root_set_digest:'sha256:'+'1'.repeat(64),
    evaluation_bundle_digest:'sha256:'+'2'.repeat(64),
    promotion_gate_digest:'sha256:'+'3'.repeat(64),
    risk_review_digest:'sha256:'+'4'.repeat(64),
    risk_confirmation_digest:'sha256:'+'5'.repeat(64),
    artifact_digest:'sha256:'+'6'.repeat(64),
    provenance_digest:'sha256:'+'7'.repeat(64),
    rollback:{
      predecessor_sha:PARENT_SHA,
      artifact_digest:'sha256:'+'8'.repeat(64),
      ready:true,
      ambiguous_effect_replay_allowed:false,
      automatic_replay_authorized:false,
    },
    all_episode_evidence_pass:true,
    ordinary_promotion_gate_pass:true,
    statistical_confirmation_pass:true,
    rollback_ready:true,
    external_release_handoff_review_required:true,
    release_handoff_authorized:false,
    direct_install_authorized:false,
    direct_promotion_authorized:false,
    existing_self_update_handoff_authorized:false,
    promotion_token:null,
    physical_effect_replay_allowed:false,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {...core,review_digest:digest(core)};
}

function attestation(overrides={}) {
  const core={
    schema:'metaengine.rsi.promotion-review-attestation-verification.v1',
    classification:'CRYPTOGRAPHICALLY_VERIFIED_RSI_PROMOTION_REVIEW_NONAUTHORITATIVE',
    source:{
      repository_id:1341371143,
      repository:'PatrickFrome/Compute',
      workflow_path:'.github/workflows/rsi-promotion-attestation.yml',
      head_sha:'d'.repeat(40),
      run_id:123456789,
    },
    predicate_type:'https://github.com/PatrickFrome/Compute/attestations/rsi-promotion-review/v1',
    predicate_sha256:'1'.repeat(64),
    attested_file_sha256:'2'.repeat(64),
    attested_file_bytes:4096,
    promotion_subject_sha256:'4'.repeat(64),
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE_SHA,
    parent_sha:PARENT_SHA,
    artifact_sha256:'6'.repeat(64),
    promotion_gate_sha256:'3'.repeat(64),
    verified_timestamp_count:1,
    source_attestation_verified:true,
    promotion_authority:false,
    self_update_authority:false,
    direct_install_authorized:false,
    authority_effect:false,
    required_next:'EXTERNAL_PROMOTION_AUTHORITY_MUST_CONSUME_THIS_RECEIPT_AND_REVALIDATE_LIVE_RELEASE_STATE',
    ...overrides,
  };
  return {...core,verification_receipt_sha256:digestHex(core)};
}

test('cryptographically verified promotion evidence becomes only a zero-authority external release intent',()=>{
  const intent=createRsiExternalReleaseHandoffIntent({
    episode_promotion_review:review(),
    promotion_attestation_verification:attestation(),
  });
  verifyRsiExternalReleaseHandoffIntent(intent);
  assert.equal(intent.state,'READY_FOR_EXTERNAL_RELEASE_COORDINATOR_REVIEW');
  assert.equal(intent.candidate_identity_frozen,true);
  assert.equal(intent.cryptographic_promotion_attestation_verified,true);
  assert.equal(intent.publisher_action_authorized,false);
  assert.equal(intent.release_publication_authorized,false);
  assert.equal(intent.release_authority,false);
  assert.equal(intent.self_update_handoff_authorized,false);
  assert.equal(intent.direct_install_authorized,false);
  assert.equal(intent.existing_browser_fabric_release_gate_required,true);
  assert.equal(intent.existing_self_update_transaction_journal_required,true);
  assert.equal(intent.one_attempt_install_effect_required,true);
  assert.equal(intent.ambiguous_install_requires_reconciliation,true);
  assert.equal(intent.physical_effect_replay_allowed,false);
  assert.equal(intent.promotion_token,null);
});

test('candidate, artifact and promotion gate are exact-bound across review and independent attestation',()=>{
  for(const mutate of [
    (row)=>{row.candidate_sha='e'.repeat(40);},
    (row)=>{row.parent_sha='f'.repeat(40);},
    (row)=>{row.artifact_sha256='9'.repeat(64);},
    (row)=>{row.promotion_gate_sha256='a'.repeat(64);},
  ]){
    const row=attestation();
    mutate(row);
    delete row.verification_receipt_sha256;
    row.verification_receipt_sha256=digestHex(row);
    assert.throws(
      ()=>createRsiExternalReleaseHandoffIntent({
        episode_promotion_review:review(),
        promotion_attestation_verification:row,
      }),
      /(candidate_identity_mismatch|attestation_review_binding_mismatch)/,
    );
  }
});

test('attestation source and self-hash tampering fail before release intent exists',()=>{
  const wrongSource=attestation();
  wrongSource.source.workflow_path='.github/workflows/untrusted.yml';
  delete wrongSource.verification_receipt_sha256;
  wrongSource.verification_receipt_sha256=digestHex(wrongSource);
  assert.throws(()=>verifyRsiPromotionAttestationVerification(wrongSource),/attestation_source_invalid/);

  const tampered=attestation();
  tampered.source.run_id+=1;
  assert.throws(()=>verifyRsiPromotionAttestationVerification(tampered),/attestation_receipt_digest_mismatch/);
});

test('release intent cannot be widened into publication, promotion, install or replay authority',()=>{
  for(const mutate of [
    (row)=>{row.release_publication_authorized=true;},
    (row)=>{row.publisher_action_authorized=true;},
    (row)=>{row.promotion_authority=true;},
    (row)=>{row.self_update_authority=true;},
    (row)=>{row.direct_install_authorized=true;},
    (row)=>{row.physical_effect_replay_allowed=true;},
  ]){
    const row=structuredClone(createRsiExternalReleaseHandoffIntent({
      episode_promotion_review:review(),
      promotion_attestation_verification:attestation(),
    }));
    mutate(row);
    assert.throws(()=>verifyRsiExternalReleaseHandoffIntent(row),/(policy_invalid|authority_invalid|promotion_authority_invalid|self_update_authority_invalid)/);
  }
});

test('release handoff trust root reuses existing release gate and self-update transaction instead of creating a parallel updater',()=>{
  const root=rsiExternalReleaseHandoffTrustRootSnapshot();
  assert.equal(root.candidate_identity_frozen,true);
  assert.equal(root.cryptographic_attestation_required,true);
  assert.equal(root.external_release_coordinator_review_required,true);
  assert.equal(root.release_publication_authorized,false);
  assert.equal(root.existing_browser_fabric_release_gate_required,true);
  assert.equal(root.existing_self_update_transaction_journal_required,true);
  assert.equal(root.one_attempt_install_effect_required,true);
  assert.equal(root.ambiguous_install_requires_reconciliation,true);
  assert.equal(root.physical_effect_replay_allowed,false);
  assert.equal(root.candidate_can_modify_release_handoff_root,false);
  assert.equal(root.release_authority,false);
  assert.equal(root.self_update_authority,false);
});
