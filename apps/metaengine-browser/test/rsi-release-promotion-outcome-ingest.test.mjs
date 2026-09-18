import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiReleasePromotionJournalIntent,
  admitRsiReleasePromotionCapability,
} from '../src/rsi-release-promotion-journal.mjs';
import {
  createFabricLedgerEvent,
} from '../src/browser-fabric-effect-ledger.mjs';
import {
  fabricCapabilitySigningBytes,
  BROWSER_FABRIC_CAPABILITY_SCHEMA,
  BROWSER_FABRIC_CAPABILITY_ALG,
} from '../src/browser-fabric-capability.mjs';
import {
  createRsiReleaseAuthorityReadback,
  verifyRsiReleaseAuthorityReadback,
  createRsiSelfUpdateEligibilityReview,
  verifyRsiSelfUpdateEligibilityReview,
  rsiSelfUpdateEligibilityReviewTrustRootSnapshot,
} from '../src/rsi-release-promotion-outcome-ingest.mjs';

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(!value||typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function hashHex(value){
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex');
}
function digest(value){return 'sha256:'+hashHex(value)}

const CANDIDATE_ID='candidate_sha256_'+'c'.repeat(64);
const CANDIDATE_SHA='b'.repeat(40);
const PARENT_SHA='a'.repeat(40);
const NOW='2026-09-18T19:00:00.000Z';
const VERSION='0.7.0-dev.99999999999.1';
const TAG='v'+VERSION;
const INSTALLER='METAENGINE-Browser-Test-Setup-'+VERSION+'-x64.exe';

function reconciliation(){
  const core={
    schema:'metaengine.rsi.published-release-reconciliation.v1',
    version:1,
    state:'READY_FOR_EXTERNAL_AUTHORITY_ADVANCE_REVIEW',
    release_handoff_intent_digest:'sha256:'+'1'.repeat(64),
    episode_promotion_review_digest:'sha256:'+'2'.repeat(64),
    candidate_id:CANDIDATE_ID,candidate_sha:CANDIDATE_SHA,parent_sha:PARENT_SHA,previous_authority_sha:PARENT_SHA,
    candidate_identity_frozen:true,release_source_sha_exact:true,
    release_tag:TAG,release_version:VERSION,
    installer_sha256:'sha256:'+'3'.repeat(64),
    installed_executable_sha256:'sha256:'+'4'.repeat(64),
    manifest_sha256:'sha256:'+'5'.repeat(64),
    immutable_evidence_verifier_id:'release-lock-verifier-v1',
    provenance_verifier_id:'slsa-verifier-v1',
    ancestry_verifier_id:'ancestry-verifier-v1',
    browser_fabric_release_gate_schema:'metaengine.browser-fabric.release-authority-gate.v1',
    browser_fabric_release_gate_digest:'sha256:'+'6'.repeat(64),
    promotion_unit:'IMMUTABLE_VERIFIED_RELEASE',
    immutable_release_verified:true,immutable_release_attestation_verified:true,slsa_provenance_verified:true,
    source_fast_forward_verified:true,installed_executable_binding_verified:true,
    authority_advance_candidate:true,authority_advance_authorized:false,
    separate_journaled_promotion_effect_required:true,release_authority_mutation_performed:false,
    self_update_handoff_authorized:false,direct_install_authorized:false,
    one_attempt_physical_effect_required:true,ambiguous_effect_requires_reconciliation:true,
    physical_effect_replay_allowed:false,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,reconciliation_digest:digest(core)};
}

function intent(){
  return createRsiReleasePromotionJournalIntent({
    published_release_reconciliation:reconciliation(),
    generation:1,
    occurred_at:NOW,
  });
}

function signedCapability(row){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const e=row.capability_expectation;
  const claims={
    schema:BROWSER_FABRIC_CAPABILITY_SCHEMA,
    capability_id:'release-promotion-capability-selfupdate-review-v1',
    issuer:'METAENGINE_EXTERNAL_RELEASE_AUTHORITY',
    audience:e.audience,subject_device:e.subject_device,effect_id:e.effect_id,task_id:e.task_id,
    claim_generation:e.claim_generation,browser_context_id:e.browser_context_id,target_id:e.target_id,
    target_incarnation:e.target_incarnation,action:e.action,
    issued_at:'2026-09-18T18:59:59.000Z',not_before:'2026-09-18T18:59:59.000Z',
    deadline:'2026-09-18T19:04:00.000Z',idempotency_key:e.idempotency_key,policy_hash:e.policy_hash,
    plan_digest:e.plan_digest,nonce:e.nonce,max_uses:1,retry_budget:0,delegation_depth:0,parent_capability_digest:null,
  };
  const envelope={
    alg:BROWSER_FABRIC_CAPABILITY_ALG,key_id:'release-authority-key-selfupdate-v1',claims,
    signature:crypto.sign(null,fabricCapabilitySigningBytes(claims),privateKey).toString('base64url'),
  };
  return {envelope,trusted_public_keys:{'release-authority-key-selfupdate-v1':publicKey}};
}

function confirmedEvents(row){
  const signed=signedCapability(row);
  const admission=admitRsiReleasePromotionCapability({
    journal_intent:row,capability_envelope:signed.envelope,trusted_public_keys:signed.trusted_public_keys,now:new Date(NOW),
  });
  const capability=admission.capability_event;
  const attempt=createFabricLedgerEvent({
    sequence:3,effect_id:row.effect_id,domain:'RELEASE_PROMOTION',type:'ATTEMPT',
    occurred_at:'2026-09-18T19:00:01.000Z',previous_event_sha256:capability.event_sha256,
    material:{
      attempt_id:'release-promotion-attempt-selfupdate-review-v1',
      actuator_id:'RELEASE_PUBLISHER',dispatched_at:'2026-09-18T19:00:00.500Z',
      capability_digest:admission.capability_digest,nonce:row.capability_expectation.nonce,
      target_incarnation:row.capability_expectation.target_incarnation,
    },
  });
  const readback=createFabricLedgerEvent({
    sequence:4,effect_id:row.effect_id,domain:'RELEASE_PROMOTION',type:'READBACK',
    occurred_at:'2026-09-18T19:00:03.000Z',previous_event_sha256:attempt.event_sha256,
    material:{
      observer_id:'RELEASE_PROMOTION_RECONCILER',observer_independent:true,
      observed_at:'2026-09-18T19:00:02.500Z',evidence_digest:'7'.repeat(64),
      observed_state:'AUTHORITY_EXACT_CANDIDATE',target_incarnation:row.capability_expectation.target_incarnation,
    },
  });
  const outcome=createFabricLedgerEvent({
    sequence:5,effect_id:row.effect_id,domain:'RELEASE_PROMOTION',type:'OUTCOME',
    occurred_at:'2026-09-18T19:00:04.000Z',previous_event_sha256:readback.event_sha256,
    material:{state:'CONFIRMED',reason:'INDEPENDENT_AUTHORITY_READBACK_EXACT',readback_evidence_digest:'7'.repeat(64),automatic_retry_allowed:false},
  });
  return [row.intent_event,capability,attempt,readback,outcome];
}

function ambiguousEvents(row){
  const signed=signedCapability(row);
  const admission=admitRsiReleasePromotionCapability({
    journal_intent:row,capability_envelope:signed.envelope,trusted_public_keys:signed.trusted_public_keys,now:new Date(NOW),
  });
  const capability=admission.capability_event;
  const attempt=createFabricLedgerEvent({
    sequence:3,effect_id:row.effect_id,domain:'RELEASE_PROMOTION',type:'ATTEMPT',
    occurred_at:'2026-09-18T19:00:01.000Z',previous_event_sha256:capability.event_sha256,
    material:{
      attempt_id:'release-promotion-attempt-selfupdate-ambiguous-v1',
      actuator_id:'RELEASE_PUBLISHER',dispatched_at:'2026-09-18T19:00:00.500Z',
      capability_digest:admission.capability_digest,nonce:row.capability_expectation.nonce,
      target_incarnation:row.capability_expectation.target_incarnation,
    },
  });
  const outcome=createFabricLedgerEvent({
    sequence:4,effect_id:row.effect_id,domain:'RELEASE_PROMOTION',type:'OUTCOME',
    occurred_at:'2026-09-18T19:00:02.000Z',previous_event_sha256:attempt.event_sha256,
    material:{state:'AMBIGUOUS',reason:'NO_INDEPENDENT_AUTHORITY_READBACK',readback_evidence_digest:null,automatic_retry_allowed:false},
  });
  return [row.intent_event,capability,attempt,outcome];
}

function trustedRelease(overrides={}){
  return {
    schema:'metaengine.trusted-dev-release.v1',version:VERSION,tag:TAG,git_sha:CANDIDATE_SHA,
    installer_name:INSTALLER,installer_sha256:'3'.repeat(64),manifest_sha256:'5'.repeat(64),
    dev_yml_sha256:'8'.repeat(64),installed_executable_sha256:'4'.repeat(64),
    target_present_proof_supported:true,authority_effect:false,...overrides,
  };
}

test('confirmed release-promotion plus independent exact authority readback creates only external self-update-check review readiness',()=>{
  const row=intent();
  const events=confirmedEvents(row);
  const authority=createRsiReleaseAuthorityReadback({
    journal_intent:row,journal_events:events,observed_authority_sha:CANDIDATE_SHA,
    observed_at:'2026-09-18T19:00:05.000Z',observer_id:'release-authority-readback-v1',
    evidence_digest:'sha256:'+'9'.repeat(64),external_authority_observer:true,authored_by_candidate:false,
  });
  verifyRsiReleaseAuthorityReadback(authority,{journal_intent:row,journal_events:events});

  const review=createRsiSelfUpdateEligibilityReview({
    journal_intent:row,journal_events:events,authority_readback:authority,trusted_release:trustedRelease(),
  });
  verifyRsiSelfUpdateEligibilityReview(review);
  assert.equal(review.state,'READY_FOR_EXTERNAL_SELF_UPDATE_CHECK_REVIEW');
  assert.equal(review.release_promotion_confirmed,true);
  assert.equal(review.exact_release_authority_confirmed,true);
  assert.equal(review.trusted_release_reverified,true);
  assert.equal(review.installed_executable_binding_present,true);
  assert.equal(review.external_self_update_controller_required,true);
  assert.equal(review.existing_self_update_runtime_required,true);
  assert.equal(review.prior_self_update_transaction_readback_required,true);
  assert.equal(review.restart_gate_revalidation_required,true);
  assert.equal(review.host_resilience_revalidation_required,true);
  assert.equal(review.self_update_check_authorized,false);
  assert.equal(review.self_update_apply_authorized,false);
  assert.equal(review.installer_launch_authorized,false);
  assert.equal(review.physical_effect_replay_allowed,false);
});

test('ambiguous release-promotion outcome cannot create authority readback or self-update eligibility',()=>{
  const row=intent();
  assert.throws(
    ()=>createRsiReleaseAuthorityReadback({
      journal_intent:row,journal_events:ambiguousEvents(row),observed_authority_sha:CANDIDATE_SHA,
      observed_at:'2026-09-18T19:00:05.000Z',observer_id:'release-authority-readback-v1',
      evidence_digest:'sha256:'+'9'.repeat(64),external_authority_observer:true,authored_by_candidate:false,
    }),
    /release_promotion_not_confirmed/,
  );
});

test('authority drift and candidate-authored readback fail closed',()=>{
  const row=intent();
  const events=confirmedEvents(row);
  assert.throws(
    ()=>createRsiReleaseAuthorityReadback({
      journal_intent:row,journal_events:events,observed_authority_sha:PARENT_SHA,
      observed_at:'2026-09-18T19:00:05.000Z',observer_id:'release-authority-readback-v1',
      evidence_digest:'sha256:'+'9'.repeat(64),external_authority_observer:true,authored_by_candidate:false,
    }),
    /authority_candidate_mismatch/,
  );
  assert.throws(
    ()=>createRsiReleaseAuthorityReadback({
      journal_intent:row,journal_events:events,observed_authority_sha:CANDIDATE_SHA,
      observed_at:'2026-09-18T19:00:05.000Z',observer_id:'release-authority-readback-v1',
      evidence_digest:'sha256:'+'9'.repeat(64),external_authority_observer:true,authored_by_candidate:true,
    }),
    /external_authority_observer_required/,
  );
});

test('self-update review re-resolves exact trusted release and rejects source or executable drift',()=>{
  const row=intent();
  const events=confirmedEvents(row);
  const authority=createRsiReleaseAuthorityReadback({
    journal_intent:row,journal_events:events,observed_authority_sha:CANDIDATE_SHA,
    observed_at:'2026-09-18T19:00:05.000Z',observer_id:'release-authority-readback-v1',
    evidence_digest:'sha256:'+'9'.repeat(64),external_authority_observer:true,authored_by_candidate:false,
  });
  assert.throws(
    ()=>createRsiSelfUpdateEligibilityReview({
      journal_intent:row,journal_events:events,authority_readback:authority,
      trusted_release:trustedRelease({git_sha:'f'.repeat(40)}),
    }),
    /trusted_release_source_mismatch/,
  );
  assert.throws(
    ()=>createRsiSelfUpdateEligibilityReview({
      journal_intent:row,journal_events:events,authority_readback:authority,
      trusted_release:trustedRelease({installed_executable_sha256:null}),
    }),
    /installed_executable_digest_invalid/,
  );
});

test('eligibility review cannot be widened into check, apply, installer or replay authority',()=>{
  const row=intent();
  const events=confirmedEvents(row);
  const authority=createRsiReleaseAuthorityReadback({
    journal_intent:row,journal_events:events,observed_authority_sha:CANDIDATE_SHA,
    observed_at:'2026-09-18T19:00:05.000Z',observer_id:'release-authority-readback-v1',
    evidence_digest:'sha256:'+'9'.repeat(64),external_authority_observer:true,authored_by_candidate:false,
  });
  const base=createRsiSelfUpdateEligibilityReview({
    journal_intent:row,journal_events:events,authority_readback:authority,trusted_release:trustedRelease(),
  });
  for(const mutate of [
    (x)=>{x.self_update_check_authorized=true;},
    (x)=>{x.self_update_apply_authorized=true;},
    (x)=>{x.self_update_handoff_authorized=true;},
    (x)=>{x.installer_launch_authorized=true;},
    (x)=>{x.physical_effect_replay_allowed=true;},
  ]){
    const copy=structuredClone(base);mutate(copy);
    assert.throws(()=>verifyRsiSelfUpdateEligibilityReview(copy),/policy_invalid/);
  }
});

test('self-update eligibility trust root preserves existing transaction journal and external controller boundary',()=>{
  const root=rsiSelfUpdateEligibilityReviewTrustRootSnapshot();
  assert.equal(root.exact_release_authority_readback_required,true);
  assert.equal(root.trusted_release_reverification_required,true);
  assert.equal(root.installed_executable_binding_required,true);
  assert.equal(root.existing_self_update_runtime_required,true);
  assert.equal(root.prior_self_update_transaction_readback_required,true);
  assert.equal(root.restart_gate_revalidation_required,true);
  assert.equal(root.host_resilience_revalidation_required,true);
  assert.equal(root.self_update_check_authorized,false);
  assert.equal(root.self_update_apply_authorized,false);
  assert.equal(root.installer_launch_authorized,false);
  assert.equal(root.candidate_can_modify_self_update_review_root,false);
  assert.equal(root.physical_effect_replay_allowed,false);
});
