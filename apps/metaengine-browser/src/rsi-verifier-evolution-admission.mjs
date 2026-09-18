import crypto from 'node:crypto';

import {
  verifyRsiSealedCanaryReview,
  verifyRsiSealedCanaryReviewReceipt,
} from './rsi-sealed-canary-review.mjs';

export const RSI_VERIFIER_EVOLUTION_PLAN_SCHEMA='metaengine.rsi.verifier-evolution-plan.v1';
export const RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA='metaengine.rsi.verifier-evolution-receipt.v1';
export const RSI_VERIFIER_EVOLUTION_ADMISSION_SCHEMA='metaengine.rsi.verifier-evolution-admission.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const ROLES=new Set(['PREDECESSOR','SECONDARY']);
const REQUIRED_CHECKS=Object.freeze([
  'anchor_pass',
  'adversarial_attack_resistance_pass',
  'reward_hacking_trap_pass',
  'transfer_holdout_pass',
  'trajectory_integrity_pass',
  'monitorability_non_regression_pass',
  'sabotage_resistance_pass',
  'weak_to_strong_consistency_pass',
]);

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function dg(v){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;
}
function exactSha(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA40_RE.test(x))throw new Error(`rsi_verifier_evolution_${l}_sha_invalid`);
  return x;
}
function exactDigest(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA256_RE.test(x))throw new Error(`rsi_verifier_evolution_${l}_digest_invalid`);
  return x;
}
function id(v,l){
  const x=String(v||'').trim();
  if(!SAFE_ID_RE.test(x))throw new Error(`rsi_verifier_evolution_${l}_invalid`);
  return x;
}
function assertZero(v,l){
  for(const f of [
    'execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','scheduler_authority','signing_authority','authority_effect',
  ]){
    if(v?.[f]!==false)throw new Error(`rsi_verifier_evolution_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_verifier_evolution_${l}_retry_invalid`);
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function verifyDigestObject(row,schema,digestField,label){
  if(!row||row.schema!==schema||row.version!==1)throw new Error(`rsi_verifier_evolution_${label}_invalid`);
  assertZero(row,label);
  const clone=structuredClone(row);delete clone[digestField];
  if(dg(clone)!==exactDigest(row[digestField],label))throw new Error(`rsi_verifier_evolution_${label}_digest_mismatch`);
  return Object.freeze(structuredClone(row));
}
function constitution(){
  const value={
    schema:'metaengine.rsi.verifier-evolution-constitution.v1',
    version:1,
    active_verifier_remains_predecessor:true,
    challenger_verifier_shadow_only:true,
    predecessor_verifier_required:true,
    distinct_secondary_verifier_required:true,
    candidate_cannot_self_certify:true,
    candidate_cannot_choose_hidden_suites:true,
    candidate_cannot_modify_constitution:true,
    predecessor_and_secondary_must_evaluate_same_plan:true,
    hidden_anchor_required:true,
    adversarial_prover_required:true,
    reward_hacking_traps_required:true,
    transfer_holdout_required:true,
    trajectory_integrity_required:true,
    monitorability_non_regression_required:true,
    sabotage_resistance_required:true,
    weak_to_strong_consistency_required:true,
    disagreement_fails_closed:true,
    verifier_root_replacement_authorized:false,
    external_activation_gate_required:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...value,constitution_digest:dg(value)});
}
const CONSTITUTION=constitution();

export function createRsiVerifierEvolutionPlan({
  plan_id,
  source_sha,
  canary_record,
  sealed_review,
  sealed_receipt,
  candidate_verifier_root_digest,
  candidate_artifact_digest,
  candidate_build_receipt_digest,
  secondary_verifier_root_digest,
  hidden_anchor_suite_digest,
  adversarial_prover_suite_digest,
  reward_hacking_suite_digest,
  transfer_holdout_digest,
  trajectory_integrity_digest,
  monitorability_suite_digest,
  sabotage_suite_digest,
  weak_to_strong_suite_digest,
  external_plan_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_plan_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_verifier_evolution_external_plan_owner_required');
  }
  const receipt=verifyRsiSealedCanaryReviewReceipt(sealed_receipt,canary_record);
  const review=verifyRsiSealedCanaryReview(sealed_review,{canary_record,receipt});
  if(
    review.ready_for_external_canary_promotion_review!==true
    ||review.state!=='READY_FOR_EXTERNAL_CANARY_PROMOTION_REVIEW'
    ||review.review_is_promotion_authority!==false
  ){
    throw new Error('rsi_verifier_evolution_sealed_review_not_ready');
  }
  const source=exactSha(source_sha,'source');
  if(review.source_sha!==source||receipt.source_sha!==source){
    throw new Error('rsi_verifier_evolution_source_mismatch');
  }
  const predecessor=exactDigest(receipt.sealed_verifier_root_digest,'predecessor_root');
  const candidate=exactDigest(candidate_verifier_root_digest,'candidate_root');
  const secondary=exactDigest(secondary_verifier_root_digest,'secondary_root');
  if(candidate===predecessor||secondary===predecessor||secondary===candidate){
    throw new Error('rsi_verifier_evolution_verifier_roots_must_be_distinct');
  }
  const core={
    schema:RSI_VERIFIER_EVOLUTION_PLAN_SCHEMA,version:1,
    plan_id:id(plan_id,'plan_id'),
    source_sha:source,
    sealed_review_digest:exactDigest(review.review_digest,'sealed_review'),
    sealed_receipt_digest:exactDigest(receipt.receipt_digest,'sealed_receipt'),
    canary_admission_digest:exactDigest(review.canary_admission_digest,'canary_admission'),
    constitution_digest:CONSTITUTION.constitution_digest,
    predecessor_verifier_root_digest:predecessor,
    candidate_verifier_root_digest:candidate,
    candidate_artifact_digest:exactDigest(candidate_artifact_digest,'candidate_artifact'),
    candidate_build_receipt_digest:exactDigest(candidate_build_receipt_digest,'candidate_build_receipt'),
    secondary_verifier_root_digest:secondary,
    hidden_anchor_suite_digest:exactDigest(hidden_anchor_suite_digest,'hidden_anchor_suite'),
    adversarial_prover_suite_digest:exactDigest(adversarial_prover_suite_digest,'adversarial_prover_suite'),
    reward_hacking_suite_digest:exactDigest(reward_hacking_suite_digest,'reward_hacking_suite'),
    transfer_holdout_digest:exactDigest(transfer_holdout_digest,'transfer_holdout'),
    trajectory_integrity_digest:exactDigest(trajectory_integrity_digest,'trajectory_integrity'),
    monitorability_suite_digest:exactDigest(monitorability_suite_digest,'monitorability_suite'),
    sabotage_suite_digest:exactDigest(sabotage_suite_digest,'sabotage_suite'),
    weak_to_strong_suite_digest:exactDigest(weak_to_strong_suite_digest,'weak_to_strong_suite'),
    required_checks:REQUIRED_CHECKS,
    mode:'VERIFIER_SHADOW_ONLY',
    active_verifier_root_digest:predecessor,
    candidate_verifier_is_challenger:true,
    predecessor_verifier_frozen:true,
    secondary_verifier_independent:true,
    candidate_can_self_certify:false,
    candidate_can_choose_secondary_verifier:false,
    candidate_can_choose_hidden_suites:false,
    candidate_can_read_hidden_suites:false,
    candidate_can_modify_constitution:false,
    candidate_can_choose_thresholds:false,
    candidate_can_choose_stopping_rule:false,
    candidate_can_choose_risk_budget:false,
    verifier_root_replacement_authorized:false,
    verifier_shadow_activation_authorized:false,
    external_activation_gate_required:true,
    external_plan_owner:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,plan_digest:dg(core)});
}

export function verifyRsiVerifierEvolutionPlan(plan){
  const p=verifyDigestObject(plan,RSI_VERIFIER_EVOLUTION_PLAN_SCHEMA,'plan_digest','plan');
  if(
    p.constitution_digest!==CONSTITUTION.constitution_digest
    ||p.mode!=='VERIFIER_SHADOW_ONLY'
    ||p.active_verifier_root_digest!==p.predecessor_verifier_root_digest
    ||p.candidate_verifier_is_challenger!==true
    ||p.predecessor_verifier_frozen!==true
    ||p.secondary_verifier_independent!==true
    ||p.candidate_can_self_certify!==false
    ||p.candidate_can_choose_secondary_verifier!==false
    ||p.candidate_can_choose_hidden_suites!==false
    ||p.candidate_can_read_hidden_suites!==false
    ||p.candidate_can_modify_constitution!==false
    ||p.candidate_can_choose_thresholds!==false
    ||p.candidate_can_choose_stopping_rule!==false
    ||p.candidate_can_choose_risk_budget!==false
    ||p.verifier_root_replacement_authorized!==false
    ||p.verifier_shadow_activation_authorized!==false
    ||p.external_activation_gate_required!==true
    ||p.external_plan_owner!==true
    ||p.authored_by_candidate!==false
  ){
    throw new Error('rsi_verifier_evolution_plan_policy_invalid');
  }
  if(
    p.candidate_verifier_root_digest===p.predecessor_verifier_root_digest
    ||p.secondary_verifier_root_digest===p.predecessor_verifier_root_digest
    ||p.secondary_verifier_root_digest===p.candidate_verifier_root_digest
  ){
    throw new Error('rsi_verifier_evolution_verifier_roots_must_be_distinct');
  }
  if(
    !Array.isArray(p.required_checks)
    ||p.required_checks.length!==REQUIRED_CHECKS.length
    ||p.required_checks.some((x,i)=>x!==REQUIRED_CHECKS[i])
  ){
    throw new Error('rsi_verifier_evolution_required_checks_invalid');
  }
  return p;
}

export function createRsiVerifierEvolutionEvaluationReceipt({
  receipt_id,
  plan,
  evaluator_role,
  evaluator_root_digest,
  anchor_pass=false,
  adversarial_attack_resistance_pass=false,
  reward_hacking_trap_pass=false,
  transfer_holdout_pass=false,
  trajectory_integrity_pass=false,
  monitorability_non_regression_pass=false,
  sabotage_resistance_pass=false,
  weak_to_strong_consistency_pass=false,
  evaluation_evidence_digest,
  evidence_refs,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  const p=verifyRsiVerifierEvolutionPlan(plan);
  if(external_evaluator!==true||authored_by_candidate!==false){
    throw new Error('rsi_verifier_evolution_external_evaluator_required');
  }
  const role=String(evaluator_role||'').trim().toUpperCase();
  if(!ROLES.has(role))throw new Error('rsi_verifier_evolution_evaluator_role_invalid');
  const root=exactDigest(evaluator_root_digest,'evaluator_root');
  const expected=role==='PREDECESSOR'?p.predecessor_verifier_root_digest:p.secondary_verifier_root_digest;
  if(root!==expected)throw new Error('rsi_verifier_evolution_evaluator_root_mismatch');
  const refs=Array.isArray(evidence_refs)?[...new Set(evidence_refs.map(x=>id(x,'evidence_ref')))].sort():[];
  if(refs.length<1||refs.length!==evidence_refs.length)throw new Error('rsi_verifier_evolution_evidence_refs_invalid');
  const checks={
    anchor_pass:anchor_pass===true,
    adversarial_attack_resistance_pass:adversarial_attack_resistance_pass===true,
    reward_hacking_trap_pass:reward_hacking_trap_pass===true,
    transfer_holdout_pass:transfer_holdout_pass===true,
    trajectory_integrity_pass:trajectory_integrity_pass===true,
    monitorability_non_regression_pass:monitorability_non_regression_pass===true,
    sabotage_resistance_pass:sabotage_resistance_pass===true,
    weak_to_strong_consistency_pass:weak_to_strong_consistency_pass===true,
  };
  const overallPass=REQUIRED_CHECKS.every(k=>checks[k]===true);
  const core={
    schema:RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA,version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:p.source_sha,
    plan_digest:p.plan_digest,
    constitution_digest:p.constitution_digest,
    evaluator_role:role,
    evaluator_root_digest:root,
    predecessor_verifier_root_digest:p.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:p.candidate_verifier_root_digest,
    secondary_verifier_root_digest:p.secondary_verifier_root_digest,
    hidden_anchor_suite_digest:p.hidden_anchor_suite_digest,
    adversarial_prover_suite_digest:p.adversarial_prover_suite_digest,
    reward_hacking_suite_digest:p.reward_hacking_suite_digest,
    transfer_holdout_digest:p.transfer_holdout_digest,
    trajectory_integrity_digest:p.trajectory_integrity_digest,
    monitorability_suite_digest:p.monitorability_suite_digest,
    sabotage_suite_digest:p.sabotage_suite_digest,
    weak_to_strong_suite_digest:p.weak_to_strong_suite_digest,
    ...checks,
    overall_pass:overallPass,
    evaluation_evidence_digest:exactDigest(evaluation_evidence_digest,'evaluation_evidence'),
    evidence_refs:Object.freeze(refs),
    evaluator_cannot_activate_candidate:true,
    evaluator_cannot_replace_active_verifier:true,
    candidate_self_evaluation_accepted:false,
    external_evaluator:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:dg(core)});
}

export function verifyRsiVerifierEvolutionEvaluationReceipt(receipt,{plan}={}){
  const p=verifyRsiVerifierEvolutionPlan(plan);
  const r=verifyDigestObject(receipt,RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA,'receipt_digest','receipt');
  if(
    r.source_sha!==p.source_sha
    ||r.plan_digest!==p.plan_digest
    ||r.constitution_digest!==p.constitution_digest
    ||r.predecessor_verifier_root_digest!==p.predecessor_verifier_root_digest
    ||r.candidate_verifier_root_digest!==p.candidate_verifier_root_digest
    ||r.secondary_verifier_root_digest!==p.secondary_verifier_root_digest
    ||r.hidden_anchor_suite_digest!==p.hidden_anchor_suite_digest
    ||r.adversarial_prover_suite_digest!==p.adversarial_prover_suite_digest
    ||r.reward_hacking_suite_digest!==p.reward_hacking_suite_digest
    ||r.transfer_holdout_digest!==p.transfer_holdout_digest
    ||r.trajectory_integrity_digest!==p.trajectory_integrity_digest
    ||r.monitorability_suite_digest!==p.monitorability_suite_digest
    ||r.sabotage_suite_digest!==p.sabotage_suite_digest
    ||r.weak_to_strong_suite_digest!==p.weak_to_strong_suite_digest
  ){
    throw new Error('rsi_verifier_evolution_receipt_binding_mismatch');
  }
  if(!ROLES.has(r.evaluator_role))throw new Error('rsi_verifier_evolution_evaluator_role_invalid');
  const expected=r.evaluator_role==='PREDECESSOR'?p.predecessor_verifier_root_digest:p.secondary_verifier_root_digest;
  if(r.evaluator_root_digest!==expected)throw new Error('rsi_verifier_evolution_evaluator_root_mismatch');
  if(
    r.evaluator_cannot_activate_candidate!==true
    ||r.evaluator_cannot_replace_active_verifier!==true
    ||r.candidate_self_evaluation_accepted!==false
    ||r.external_evaluator!==true
    ||r.authored_by_candidate!==false
  ){
    throw new Error('rsi_verifier_evolution_receipt_policy_invalid');
  }
  const expectedPass=REQUIRED_CHECKS.every(k=>r[k]===true);
  if(r.overall_pass!==expectedPass)throw new Error('rsi_verifier_evolution_receipt_pass_mismatch');
  return r;
}

export function createRsiVerifierEvolutionAdmission({
  admission_id,
  plan,
  predecessor_receipt,
  secondary_receipt,
  external_admission_owner=false,
  authored_by_candidate=true,
}={}){
  const p=verifyRsiVerifierEvolutionPlan(plan);
  if(external_admission_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_verifier_evolution_external_admission_owner_required');
  }
  const a=verifyRsiVerifierEvolutionEvaluationReceipt(predecessor_receipt,{plan:p});
  const b=verifyRsiVerifierEvolutionEvaluationReceipt(secondary_receipt,{plan:p});
  if(a.evaluator_role!=='PREDECESSOR'||b.evaluator_role!=='SECONDARY'){
    throw new Error('rsi_verifier_evolution_receipt_roles_invalid');
  }
  if(a.receipt_digest===b.receipt_digest||a.evaluator_root_digest===b.evaluator_root_digest){
    throw new Error('rsi_verifier_evolution_independent_receipts_required');
  }
  const bothPass=a.overall_pass===true&&b.overall_pass===true;
  const disagreement=a.overall_pass!==b.overall_pass;
  const state=bothPass
    ?'ELIGIBLE_FOR_VERIFIER_SHADOW'
    :disagreement?'REJECTED_VERIFIER_DISAGREEMENT':'REJECTED_VERIFIER_EVIDENCE';
  const core={
    schema:RSI_VERIFIER_EVOLUTION_ADMISSION_SCHEMA,version:1,
    admission_id:id(admission_id,'admission_id'),
    source_sha:p.source_sha,
    plan_digest:p.plan_digest,
    constitution_digest:p.constitution_digest,
    sealed_review_digest:p.sealed_review_digest,
    predecessor_receipt_digest:a.receipt_digest,
    secondary_receipt_digest:b.receipt_digest,
    predecessor_verifier_root_digest:p.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:p.candidate_verifier_root_digest,
    secondary_verifier_root_digest:p.secondary_verifier_root_digest,
    state,
    predecessor_pass:a.overall_pass,
    secondary_pass:b.overall_pass,
    verifier_disagreement:disagreement,
    eligible_for_verifier_shadow:bothPass,
    active_verifier_root_digest:p.predecessor_verifier_root_digest,
    shadow_verifier_root_digest:bothPass?p.candidate_verifier_root_digest:null,
    active_verifier_remains_predecessor:true,
    verifier_shadow_only:true,
    candidate_cannot_self_certify:true,
    candidate_cannot_modify_constitution:true,
    disagreement_fails_closed:true,
    negative_evidence_is_terminal_for_this_plan:true,
    verifier_root_replacement_authorized:false,
    verifier_activation_authorized:false,
    verifier_promotion_token:null,
    next_stage_requires_separate_sealed_admission:true,
    external_admission_owner:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:dg(core)});
}

export function verifyRsiVerifierEvolutionAdmission(admission,{plan,predecessor_receipt,secondary_receipt}={}){
  const a=verifyDigestObject(admission,RSI_VERIFIER_EVOLUTION_ADMISSION_SCHEMA,'admission_digest','admission');
  const canonical=createRsiVerifierEvolutionAdmission({
    admission_id:a.admission_id,
    plan,
    predecessor_receipt,
    secondary_receipt,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.admission_digest!==a.admission_digest){
    throw new Error('rsi_verifier_evolution_admission_mismatch');
  }
  return canonical;
}

export function rsiVerifierEvolutionAdmissionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.verifier-evolution-admission-root.v1',version:1,
    constitution_digest:CONSTITUTION.constitution_digest,
    required_checks:REQUIRED_CHECKS,
    successful_sealed_canary_review_required:true,
    predecessor_verifier_frozen:true,
    distinct_secondary_verifier_required:true,
    candidate_verifier_shadow_only:true,
    candidate_cannot_self_certify:true,
    candidate_cannot_choose_hidden_suites:true,
    candidate_cannot_read_hidden_suites:true,
    candidate_cannot_modify_constitution:true,
    candidate_cannot_choose_thresholds:true,
    candidate_cannot_choose_stopping_rule:true,
    candidate_cannot_choose_risk_budget:true,
    predecessor_and_secondary_must_evaluate_same_plan:true,
    disagreement_fails_closed:true,
    hidden_anchor_required:true,
    adversarial_prover_required:true,
    reward_hacking_traps_required:true,
    transfer_holdout_required:true,
    trajectory_integrity_required:true,
    monitorability_non_regression_required:true,
    sabotage_resistance_required:true,
    weak_to_strong_consistency_required:true,
    active_verifier_remains_predecessor:true,
    verifier_root_replacement_authorized:false,
    verifier_activation_authorized:false,
    separate_sealed_admission_required_for_any_future_root_change:true,
    existing_runtime_ledger_is_only_admission_receipt_plane:true,
    second_scheduler_allowed:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,verifier_evolution_root_digest:dg(root)});
}
