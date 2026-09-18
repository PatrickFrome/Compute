import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiVerifierRootActivationReadinessReceipt,
  createRsiVerifierRootActivationPrepareReview,
} from '../src/rsi-verifier-root-activation-prepare.mjs';
import {
  createRsiVerifierRootActivationCommitIntent,
  verifyRsiVerifierRootActivationCommitIntent,
  createRsiVerifierRootActivationAuthorization,
  verifyRsiVerifierRootActivationAuthorization,
  createRsiVerifierRootActivationCommitReview,
  verifyRsiVerifierRootActivationCommitReview,
  rsiVerifierRootActivationCommitReviewTrustRootSnapshot,
} from '../src/rsi-verifier-root-activation-commit-review.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

const DOMAINS=['PROMOTION','RUNTIME','TOURNAMENT'];
const CHECKS=[
 'predecessor_liveness_pass','candidate_catchup_pass','joint_validation_pass','rollback_path_pass',
 'root_history_freshness_pass','incident_free','no_pending_effect',
];

function prepare(){
  const core={
    schema:'metaengine.rsi.verifier-root-activation-prepare.v1',version:1,
    prepare_id:'commit.review.prepare.1',source_sha:SOURCE,staging_review_digest:d('1'),
    staging_manifest_digest:d('2'),staging_bundle_digest:d('3'),root_change_review_digest:d('4'),
    current_root_generation:7,prepared_root_generation:8,predecessor_verifier_root_digest:d('5'),
    candidate_verifier_root_digest:d('6'),secondary_verifier_root_digest:d('7'),next_root_history_digest:d('8'),
    overlap_root_digests:[d('5'),d('6')].sort(),readiness_roots:{PROMOTION:d('9'),RUNTIME:d('a'),TOURNAMENT:d('b')},
    required_readiness_domains:DOMAINS,required_checks:CHECKS,mode:'JOINT_TRUST_PREPARE',
    candidate_role:'LEARNER_NON_AUTHORITATIVE',active_verifier_root_digest:d('5'),
    joint_old_new_validation_required:true,predecessor_liveness_required:true,candidate_catchup_required:true,
    rollback_path_required:true,root_history_freshness_required:true,incident_free_required:true,
    no_pending_effect_required:true,candidate_can_vote:false,candidate_can_be_active:false,candidate_can_self_promote:false,
    candidate_can_choose_readiness_roots:false,predecessor_retirement_authorized:false,
    root_activation_commit_authorized:false,verifier_activation_authorized:false,activation_commit_token:null,
    external_commit_controller_required:true,external_prepare_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,prepare_digest:dg(core)});
}
function readinessReceipt(p,domain,{pass=true,idSuffix='1'}={}){
  return createRsiVerifierRootActivationReadinessReceipt({
    receipt_id:`commit.review.readiness.${domain.toLowerCase()}.${idSuffix}`,prepare:p,
    readiness_domain:domain,readiness_root_digest:p.readiness_roots[domain],
    predecessor_liveness_pass:pass,candidate_catchup_pass:pass,joint_validation_pass:pass,
    rollback_path_pass:pass,root_history_freshness_pass:pass,incident_free:pass,no_pending_effect:pass,
    observed_active_verifier_root_digest:p.predecessor_verifier_root_digest,
    observed_staging_bundle_digest:p.staging_bundle_digest,
    readiness_evidence_digest:dg({domain,pass,idSuffix}),evidence_refs:[`commit:review:readiness:${domain.toLowerCase()}:${idSuffix}`],
    external_readiness_auditor:true,authored_by_candidate:false,
  });
}
function preparedBundle(){
  const p=prepare();
  const rows=DOMAINS.map(x=>readinessReceipt(p,x));
  const review=createRsiVerifierRootActivationPrepareReview({
    review_id:'commit.review.prepare.review.1',prepare:p,readiness_receipts:rows,
    external_review_owner:true,authored_by_candidate:false,
  });
  assert.equal(review.state,'PREPARED_FOR_EXTERNAL_ROOT_ACTIVATION_COMMIT_REVIEW');
  return {prepare:p,readinessReceipts:rows,prepareReview:review};
}
function intent(overrides={}){
  const b=preparedBundle();
  const i=createRsiVerifierRootActivationCommitIntent({
    commit_intent_id:'commit.review.intent.1',prepare_review:b.prepareReview,prepare:b.prepare,
    readiness_receipts:b.readinessReceipts,old_root_authority_digest:d('c'),new_root_custodian_digest:d('d'),
    external_intent_owner:true,authored_by_candidate:false,...overrides,
  });
  return {...b,intent:i};
}
function authorization(i,role,{pass=true,idSuffix='1'}={}){
  return createRsiVerifierRootActivationAuthorization({
    authorization_id:`commit.review.${role.toLowerCase()}.authorization.${idSuffix}`,intent:i,
    authorization_role:role,authorizer_digest:role==='OLD_ROOT_AUTHORITY'?i.old_root_authority_digest:i.new_root_custodian_digest,
    prepare_binding_pass:pass,joint_readiness_pass:pass,generation_continuity_pass:pass,
    root_history_continuity_pass:pass,rollback_path_pass:pass,no_pending_effect_pass:pass,incident_free_pass:pass,
    authorization_evidence_digest:dg({role,pass,idSuffix}),
    evidence_refs:[`commit:review:${role.toLowerCase()}:${idSuffix}`],
    external_authorizer:true,authored_by_candidate:false,
  });
}

test('commit intent is durable pre-effect state with exact single-shot identity',()=>{
  const {intent:i}=intent();verifyRsiVerifierRootActivationCommitIntent(i);
  assert.equal(i.state,'PRE_EFFECT_PREPARED');
  assert.equal(i.write_ahead_required,true);
  assert.equal(i.durable_pre_effect_state_required,true);
  assert.equal(i.exact_single_shot_effect_identity,true);
  assert.equal(i.effect_attempt_count,0);
  assert.equal(i.max_effect_attempts,1);
  assert.equal(i.blind_retry_allowed,false);
  assert.equal(i.ambiguous_effect_requires_same_intent_reconciliation,true);
  assert.equal(i.abortable_before_effect,true);
  assert.equal(i.active_verifier_root_digest,i.predecessor_verifier_root_digest);
  assert.equal(i.root_activation_effect_authorized,false);
  assert.equal(i.effect_executor_token,null);
  assert.equal(i.authority_effect,false);
});

test('old-root plus new-root-custodian authorization yields executor review only',()=>{
  const {intent:i}=intent();
  const oldAuth=authorization(i,'OLD_ROOT_AUTHORITY'),newAuth=authorization(i,'NEW_ROOT_CUSTODIAN');
  verifyRsiVerifierRootActivationAuthorization(oldAuth,{intent:i});
  verifyRsiVerifierRootActivationAuthorization(newAuth,{intent:i});
  const review=createRsiVerifierRootActivationCommitReview({
    review_id:'commit.review.1',intent:i,old_root_authorization:oldAuth,new_root_authorization:newAuth,
    external_review_owner:true,authored_by_candidate:false,
  });
  verifyRsiVerifierRootActivationCommitReview(review,{intent:i,old_root_authorization:oldAuth,new_root_authorization:newAuth});
  assert.equal(review.state,'READY_FOR_EXTERNAL_ROOT_ACTIVATION_EXECUTOR_REVIEW');
  assert.equal(review.ready_for_external_root_activation_executor_review,true);
  assert.equal(review.old_root_authorization_pass,true);
  assert.equal(review.new_root_authorization_pass,true);
  assert.equal(review.effect_attempt_count,0);
  assert.equal(review.max_effect_attempts,1);
  assert.equal(review.active_verifier_root_digest,i.predecessor_verifier_root_digest);
  assert.equal(review.root_activation_effect_authorized,false);
  assert.equal(review.verifier_activation_authorized,false);
  assert.equal(review.effect_executor_token,null);
  assert.equal(review.review_is_effect_authority,false);
  assert.equal(review.authority_effect,false);
});

test('authorization disagreement fails closed without executor eligibility',()=>{
  const {intent:i}=intent();
  const oldAuth=authorization(i,'OLD_ROOT_AUTHORITY',{pass:true});
  const newAuth=authorization(i,'NEW_ROOT_CUSTODIAN',{pass:false});
  const review=createRsiVerifierRootActivationCommitReview({
    review_id:'commit.review.disagreement',intent:i,old_root_authorization:oldAuth,new_root_authorization:newAuth,
    external_review_owner:true,authored_by_candidate:false,
  });
  assert.equal(review.state,'REJECTED_ROOT_ACTIVATION_AUTHORIZATION_DISAGREEMENT');
  assert.equal(review.authorization_disagreement,true);
  assert.equal(review.ready_for_external_root_activation_executor_review,false);
  assert.equal(review.root_activation_effect_authorized,false);
});

test('candidate verifier cannot be its own new-root custodian',()=>{
  const b=preparedBundle();
  assert.throws(()=>createRsiVerifierRootActivationCommitIntent({
    commit_intent_id:'commit.review.intent.self',prepare_review:b.prepareReview,prepare:b.prepare,
    readiness_receipts:b.readinessReceipts,old_root_authority_digest:d('c'),
    new_root_custodian_digest:b.prepare.candidate_verifier_root_digest,
    external_intent_owner:true,authored_by_candidate:false,
  }),/candidate_cannot_be_new_root_custodian/);
});

test('self-rehashed effect-key mutation is rejected',()=>{
  const {intent:i}=intent();
  const tampered={...i,effect_key:d('e')};
  const core={...tampered};delete core.intent_digest;
  tampered.intent_digest=dg(core);
  assert.throws(()=>verifyRsiVerifierRootActivationCommitIntent(tampered),/effect_key_mismatch/);
});

test('candidate-authored root authorization is rejected',()=>{
  const {intent:i}=intent();
  assert.throws(()=>createRsiVerifierRootActivationAuthorization({
    authorization_id:'commit.review.self.authorization',intent:i,authorization_role:'NEW_ROOT_CUSTODIAN',
    authorizer_digest:i.new_root_custodian_digest,prepare_binding_pass:true,joint_readiness_pass:true,
    generation_continuity_pass:true,root_history_continuity_pass:true,rollback_path_pass:true,
    no_pending_effect_pass:true,incident_free_pass:true,authorization_evidence_digest:d('f'),
    evidence_refs:['commit:review:self'],external_authorizer:false,authored_by_candidate:true,
  }),/external_authorizer_required/);
});

test('commit review trust root enforces old-new continuity and no effect authority',()=>{
  const root=rsiVerifierRootActivationCommitReviewTrustRootSnapshot();
  assert.equal(root.phase25_prepare_review_required,true);
  assert.equal(root.write_ahead_pre_effect_intent_required,true);
  assert.equal(root.old_root_authorization_required,true);
  assert.equal(root.new_root_custodian_authorization_required,true);
  assert.equal(root.authorization_threshold,'2_OF_2');
  assert.equal(root.candidate_self_authorization_allowed,false);
  assert.equal(root.exact_single_shot_effect_identity_required,true);
  assert.equal(root.max_effect_attempts,1);
  assert.equal(root.blind_retry_allowed,false);
  assert.equal(root.ambiguous_effect_requires_same_intent_reconciliation,true);
  assert.equal(root.abortable_before_effect,true);
  assert.equal(root.predecessor_remains_active,true);
  assert.equal(root.root_activation_effect_authorized,false);
  assert.equal(root.verifier_activation_authorized,false);
  assert.equal(root.external_effect_executor_required,true);
  assert.equal(root.existing_runtime_ledger_is_only_commit_review_receipt_plane,true);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.root_activation_commit_review_root_digest,/^sha256:[0-9a-f]{64}$/);
});
