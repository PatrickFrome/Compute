import crypto from 'node:crypto';

import {
  verifyRsiVerifierRootActivationPrepare,
  verifyRsiVerifierRootActivationReadinessReceipt,
  verifyRsiVerifierRootActivationPrepareReview,
} from './rsi-verifier-root-activation-prepare.mjs';

export const RSI_VERIFIER_ROOT_ACTIVATION_COMMIT_INTENT_SCHEMA='metaengine.rsi.verifier-root-activation-commit-intent.v1';
export const RSI_VERIFIER_ROOT_ACTIVATION_AUTHORIZATION_SCHEMA='metaengine.rsi.verifier-root-activation-authorization.v1';
export const RSI_VERIFIER_ROOT_ACTIVATION_COMMIT_REVIEW_SCHEMA='metaengine.rsi.verifier-root-activation-commit-review.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const ROLES=new Set(['OLD_ROOT_AUTHORITY','NEW_ROOT_CUSTODIAN']);
const REQUIRED_CHECKS=Object.freeze([
  'prepare_binding_pass',
  'joint_readiness_pass',
  'generation_continuity_pass',
  'root_history_continuity_pass',
  'rollback_path_pass',
  'no_pending_effect_pass',
  'incident_free_pass',
]);

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactDigest(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA256_RE.test(x))throw new Error(`rsi_root_commit_${l}_digest_invalid`);
  return x;
}
function id(v,l){
  const x=String(v||'').trim();
  if(!SAFE_ID_RE.test(x))throw new Error(`rsi_root_commit_${l}_invalid`);
  return x;
}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_root_commit_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_root_commit_${l}_retry_invalid`);
}
function verifyDigestObject(row,schema,digestField,label){
  if(!row||row.schema!==schema||row.version!==1)throw new Error(`rsi_root_commit_${label}_invalid`);
  assertZero(row,label);
  const clone=structuredClone(row);delete clone[digestField];
  if(dg(clone)!==exactDigest(row[digestField],label))throw new Error(`rsi_root_commit_${label}_digest_mismatch`);
  return Object.freeze(structuredClone(row));
}
function prepareBundle({prepare_review,prepare,readiness_receipts}={}){
  const p=verifyRsiVerifierRootActivationPrepare(prepare);
  const receipts=readiness_receipts.map(row=>verifyRsiVerifierRootActivationReadinessReceipt(row,{prepare:p}));
  const review=verifyRsiVerifierRootActivationPrepareReview(prepare_review,{prepare:p,readiness_receipts:receipts});
  if(
    review.state!=='PREPARED_FOR_EXTERNAL_ROOT_ACTIVATION_COMMIT_REVIEW'
    ||review.prepared_for_external_root_activation_commit_review!==true
    ||review.root_activation_commit_authorized!==false
    ||review.verifier_activation_authorized!==false
  )throw new Error('rsi_root_commit_prepare_review_not_ready');
  return Object.freeze({prepare:p,prepare_review:review,readiness_receipts:Object.freeze(receipts)});
}

export function createRsiVerifierRootActivationCommitIntent({
  commit_intent_id,
  prepare_review,
  prepare,
  readiness_receipts,
  old_root_authority_digest,
  new_root_custodian_digest,
  external_intent_owner=false,
  authored_by_candidate=true,
}={}){
  const bundle=prepareBundle({prepare_review,prepare,readiness_receipts});
  if(external_intent_owner!==true||authored_by_candidate!==false)throw new Error('rsi_root_commit_external_intent_owner_required');
  const oldAuthority=exactDigest(old_root_authority_digest,'old_root_authority');
  const newCustodian=exactDigest(new_root_custodian_digest,'new_root_custodian');
  if(oldAuthority===newCustodian)throw new Error('rsi_root_commit_dual_authority_roots_must_be_distinct');
  if(newCustodian===bundle.prepare.candidate_verifier_root_digest)throw new Error('rsi_root_commit_candidate_cannot_be_new_root_custodian');
  const effectKey=dg({
    effect_type:'VERIFIER_ROOT_ACTIVATION',
    prepare_review_digest:bundle.prepare_review.review_digest,
    predecessor_verifier_root_digest:bundle.prepare.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:bundle.prepare.candidate_verifier_root_digest,
    prepared_root_generation:bundle.prepare.prepared_root_generation,
    next_root_history_digest:bundle.prepare.next_root_history_digest,
  });
  const core={
    schema:RSI_VERIFIER_ROOT_ACTIVATION_COMMIT_INTENT_SCHEMA,version:1,
    commit_intent_id:id(commit_intent_id,'commit_intent_id'),
    source_sha:bundle.prepare.source_sha,
    prepare_review_digest:bundle.prepare_review.review_digest,
    prepare_digest:bundle.prepare.prepare_digest,
    staging_review_digest:bundle.prepare.staging_review_digest,
    staging_bundle_digest:bundle.prepare.staging_bundle_digest,
    current_root_generation:bundle.prepare.current_root_generation,
    prepared_root_generation:bundle.prepare.prepared_root_generation,
    predecessor_verifier_root_digest:bundle.prepare.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:bundle.prepare.candidate_verifier_root_digest,
    secondary_verifier_root_digest:bundle.prepare.secondary_verifier_root_digest,
    next_root_history_digest:bundle.prepare.next_root_history_digest,
    old_root_authority_digest:oldAuthority,
    new_root_custodian_digest:newCustodian,
    effect_key:effectKey,
    state:'PRE_EFFECT_PREPARED',
    write_ahead_required:true,
    durable_pre_effect_state_required:true,
    exact_single_shot_effect_identity:true,
    effect_attempt_count:0,
    max_effect_attempts:1,
    blind_retry_allowed:false,
    ambiguous_effect_requires_same_intent_reconciliation:true,
    abortable_before_effect:true,
    abort_requires_external_controller:true,
    abort_effect_authorized:false,
    active_verifier_root_digest:bundle.prepare.predecessor_verifier_root_digest,
    candidate_role:'LEARNER_NON_AUTHORITATIVE',
    predecessor_retirement_authorized:false,
    root_activation_effect_authorized:false,
    verifier_activation_authorized:false,
    effect_executor_token:null,
    external_effect_executor_required:true,
    old_and_new_authorization_required:true,
    candidate_can_author_intent:false,
    candidate_can_choose_effect_key:false,
    candidate_can_retry_effect:false,
    external_intent_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,intent_digest:dg(core)});
}

export function verifyRsiVerifierRootActivationCommitIntent(row){
  const i=verifyDigestObject(row,RSI_VERIFIER_ROOT_ACTIVATION_COMMIT_INTENT_SCHEMA,'intent_digest','intent');
  if(
    i.prepared_root_generation!==i.current_root_generation+1
    ||i.state!=='PRE_EFFECT_PREPARED'
    ||i.write_ahead_required!==true
    ||i.durable_pre_effect_state_required!==true
    ||i.exact_single_shot_effect_identity!==true
    ||i.effect_attempt_count!==0
    ||i.max_effect_attempts!==1
    ||i.blind_retry_allowed!==false
    ||i.ambiguous_effect_requires_same_intent_reconciliation!==true
    ||i.abortable_before_effect!==true
    ||i.abort_requires_external_controller!==true
    ||i.abort_effect_authorized!==false
    ||i.active_verifier_root_digest!==i.predecessor_verifier_root_digest
    ||i.candidate_role!=='LEARNER_NON_AUTHORITATIVE'
    ||i.predecessor_retirement_authorized!==false
    ||i.root_activation_effect_authorized!==false
    ||i.verifier_activation_authorized!==false
    ||i.effect_executor_token!==null
    ||i.external_effect_executor_required!==true
    ||i.old_and_new_authorization_required!==true
    ||i.candidate_can_author_intent!==false
    ||i.candidate_can_choose_effect_key!==false
    ||i.candidate_can_retry_effect!==false
    ||i.external_intent_owner!==true||i.authored_by_candidate!==false
  )throw new Error('rsi_root_commit_intent_policy_invalid');
  if(i.old_root_authority_digest===i.new_root_custodian_digest)throw new Error('rsi_root_commit_dual_authority_roots_must_be_distinct');
  if(i.new_root_custodian_digest===i.candidate_verifier_root_digest)throw new Error('rsi_root_commit_candidate_cannot_be_new_root_custodian');
  const expectedEffect=dg({
    effect_type:'VERIFIER_ROOT_ACTIVATION',
    prepare_review_digest:i.prepare_review_digest,
    predecessor_verifier_root_digest:i.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:i.candidate_verifier_root_digest,
    prepared_root_generation:i.prepared_root_generation,
    next_root_history_digest:i.next_root_history_digest,
  });
  if(expectedEffect!==i.effect_key)throw new Error('rsi_root_commit_effect_key_mismatch');
  return i;
}

export function createRsiVerifierRootActivationAuthorization({
  authorization_id,
  intent,
  authorization_role,
  authorizer_digest,
  prepare_binding_pass=false,
  joint_readiness_pass=false,
  generation_continuity_pass=false,
  root_history_continuity_pass=false,
  rollback_path_pass=false,
  no_pending_effect_pass=false,
  incident_free_pass=false,
  authorization_evidence_digest,
  evidence_refs,
  external_authorizer=false,
  authored_by_candidate=true,
}={}){
  const i=verifyRsiVerifierRootActivationCommitIntent(intent);
  if(external_authorizer!==true||authored_by_candidate!==false)throw new Error('rsi_root_commit_external_authorizer_required');
  const role=String(authorization_role||'').trim().toUpperCase();
  if(!ROLES.has(role))throw new Error('rsi_root_commit_authorization_role_invalid');
  const root=exactDigest(authorizer_digest,'authorizer');
  const expected=role==='OLD_ROOT_AUTHORITY'?i.old_root_authority_digest:i.new_root_custodian_digest;
  if(root!==expected)throw new Error('rsi_root_commit_authorizer_mismatch');
  if(root===i.candidate_verifier_root_digest)throw new Error('rsi_root_commit_candidate_cannot_authorize_self');
  const refs=Array.isArray(evidence_refs)?[...new Set(evidence_refs.map(x=>id(x,'evidence_ref')))].sort():[];
  if(refs.length<1||refs.length!==evidence_refs.length)throw new Error('rsi_root_commit_evidence_refs_invalid');
  const checks={
    prepare_binding_pass:prepare_binding_pass===true,
    joint_readiness_pass:joint_readiness_pass===true,
    generation_continuity_pass:generation_continuity_pass===true,
    root_history_continuity_pass:root_history_continuity_pass===true,
    rollback_path_pass:rollback_path_pass===true,
    no_pending_effect_pass:no_pending_effect_pass===true,
    incident_free_pass:incident_free_pass===true,
  };
  const overallPass=REQUIRED_CHECKS.every(k=>checks[k]===true);
  const core={
    schema:RSI_VERIFIER_ROOT_ACTIVATION_AUTHORIZATION_SCHEMA,version:1,
    authorization_id:id(authorization_id,'authorization_id'),
    source_sha:i.source_sha,
    intent_digest:i.intent_digest,
    commit_intent_id:i.commit_intent_id,
    effect_key:i.effect_key,
    authorization_role:role,
    authorizer_digest:root,
    old_root_authority_digest:i.old_root_authority_digest,
    new_root_custodian_digest:i.new_root_custodian_digest,
    predecessor_verifier_root_digest:i.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:i.candidate_verifier_root_digest,
    current_root_generation:i.current_root_generation,
    prepared_root_generation:i.prepared_root_generation,
    next_root_history_digest:i.next_root_history_digest,
    ...checks,
    overall_pass:overallPass,
    authorization_evidence_digest:exactDigest(authorization_evidence_digest,'authorization_evidence'),
    evidence_refs:Object.freeze(refs),
    authorization_is_effect_authority:false,
    candidate_self_authorization_accepted:false,
    external_authorizer:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,authorization_digest:dg(core)});
}

export function verifyRsiVerifierRootActivationAuthorization(row,{intent}={}){
  const i=verifyRsiVerifierRootActivationCommitIntent(intent);
  const a=verifyDigestObject(row,RSI_VERIFIER_ROOT_ACTIVATION_AUTHORIZATION_SCHEMA,'authorization_digest','authorization');
  if(
    a.intent_digest!==i.intent_digest||a.commit_intent_id!==i.commit_intent_id||a.effect_key!==i.effect_key
    ||!ROLES.has(a.authorization_role)
    ||a.old_root_authority_digest!==i.old_root_authority_digest
    ||a.new_root_custodian_digest!==i.new_root_custodian_digest
    ||a.predecessor_verifier_root_digest!==i.predecessor_verifier_root_digest
    ||a.candidate_verifier_root_digest!==i.candidate_verifier_root_digest
    ||a.current_root_generation!==i.current_root_generation
    ||a.prepared_root_generation!==i.prepared_root_generation
    ||a.next_root_history_digest!==i.next_root_history_digest
    ||a.authorization_is_effect_authority!==false
    ||a.candidate_self_authorization_accepted!==false
    ||a.external_authorizer!==true||a.authored_by_candidate!==false
  )throw new Error('rsi_root_commit_authorization_policy_invalid');
  const expected=a.authorization_role==='OLD_ROOT_AUTHORITY'?i.old_root_authority_digest:i.new_root_custodian_digest;
  if(a.authorizer_digest!==expected)throw new Error('rsi_root_commit_authorizer_mismatch');
  const expectedPass=REQUIRED_CHECKS.every(k=>a[k]===true);
  if(a.overall_pass!==expectedPass)throw new Error('rsi_root_commit_authorization_pass_mismatch');
  return a;
}

export function createRsiVerifierRootActivationCommitReview({
  review_id,intent,old_root_authorization,new_root_authorization,
  external_review_owner=false,authored_by_candidate=true,
}={}){
  const i=verifyRsiVerifierRootActivationCommitIntent(intent);
  if(external_review_owner!==true||authored_by_candidate!==false)throw new Error('rsi_root_commit_external_review_owner_required');
  const oldAuth=verifyRsiVerifierRootActivationAuthorization(old_root_authorization,{intent:i});
  const newAuth=verifyRsiVerifierRootActivationAuthorization(new_root_authorization,{intent:i});
  if(oldAuth.authorization_role!=='OLD_ROOT_AUTHORITY'||newAuth.authorization_role!=='NEW_ROOT_CUSTODIAN'){
    throw new Error('rsi_root_commit_authorization_roles_invalid');
  }
  if(oldAuth.authorization_digest===newAuth.authorization_digest||oldAuth.authorizer_digest===newAuth.authorizer_digest){
    throw new Error('rsi_root_commit_independent_authorizations_required');
  }
  const bothPass=oldAuth.overall_pass===true&&newAuth.overall_pass===true;
  const disagreement=oldAuth.overall_pass!==newAuth.overall_pass;
  const state=bothPass
    ?'READY_FOR_EXTERNAL_ROOT_ACTIVATION_EXECUTOR_REVIEW'
    :disagreement?'REJECTED_ROOT_ACTIVATION_AUTHORIZATION_DISAGREEMENT':'REJECTED_ROOT_ACTIVATION_COMMIT_EVIDENCE';
  const core={
    schema:RSI_VERIFIER_ROOT_ACTIVATION_COMMIT_REVIEW_SCHEMA,version:1,
    review_id:id(review_id,'review_id'),
    source_sha:i.source_sha,
    intent_digest:i.intent_digest,
    commit_intent_id:i.commit_intent_id,
    effect_key:i.effect_key,
    prepare_review_digest:i.prepare_review_digest,
    old_root_authorization_digest:oldAuth.authorization_digest,
    new_root_authorization_digest:newAuth.authorization_digest,
    current_root_generation:i.current_root_generation,
    prepared_root_generation:i.prepared_root_generation,
    predecessor_verifier_root_digest:i.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:i.candidate_verifier_root_digest,
    next_root_history_digest:i.next_root_history_digest,
    old_root_authorization_pass:oldAuth.overall_pass,
    new_root_authorization_pass:newAuth.overall_pass,
    authorization_disagreement:disagreement,
    state,
    ready_for_external_root_activation_executor_review:bothPass,
    active_verifier_root_digest:i.predecessor_verifier_root_digest,
    candidate_role:'LEARNER_NON_AUTHORITATIVE',
    write_ahead_intent_state:'PRE_EFFECT_PREPARED',
    effect_attempt_count:0,
    max_effect_attempts:1,
    same_intent_reconciliation_required_on_ambiguous:true,
    blind_retry_allowed:false,
    abortable_before_effect:true,
    predecessor_retirement_authorized:false,
    root_activation_effect_authorized:false,
    verifier_activation_authorized:false,
    external_effect_executor_required:true,
    effect_executor_token:null,
    review_is_effect_authority:false,
    external_review_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,review_digest:dg(core)});
}

export function verifyRsiVerifierRootActivationCommitReview(row,{intent,old_root_authorization,new_root_authorization}={}){
  const r=verifyDigestObject(row,RSI_VERIFIER_ROOT_ACTIVATION_COMMIT_REVIEW_SCHEMA,'review_digest','review');
  const canonical=createRsiVerifierRootActivationCommitReview({
    review_id:r.review_id,intent,old_root_authorization,new_root_authorization,
    external_review_owner:true,authored_by_candidate:false,
  });
  if(canonical.review_digest!==r.review_digest)throw new Error('rsi_root_commit_review_mismatch');
  return canonical;
}

export function rsiVerifierRootActivationCommitReviewTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.verifier-root-activation-commit-review-root.v1',version:1,
    phase25_prepare_review_required:true,
    write_ahead_pre_effect_intent_required:true,
    old_root_authorization_required:true,
    new_root_custodian_authorization_required:true,
    authorization_threshold:'2_OF_2',
    authorizers_must_be_distinct:true,
    candidate_self_authorization_allowed:false,
    exact_single_shot_effect_identity_required:true,
    max_effect_attempts:1,
    blind_retry_allowed:false,
    ambiguous_effect_requires_same_intent_reconciliation:true,
    abortable_before_effect:true,
    predecessor_remains_active:true,
    root_activation_effect_authorized:false,
    verifier_activation_authorized:false,
    external_effect_executor_required:true,
    review_is_effect_authority:false,
    existing_runtime_ledger_is_only_commit_review_receipt_plane:true,
    second_scheduler_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,root_activation_commit_review_root_digest:dg(root)});
}
