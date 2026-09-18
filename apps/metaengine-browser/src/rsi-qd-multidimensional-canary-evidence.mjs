import crypto from 'node:crypto';

import {
  verifyRsiQdBoundedCanaryReview,
} from './rsi-qd-bounded-canary-review.mjs';
import {
  RSI_RISK_SPENDING_POLICIES,
  createRsiRecursiveRiskBudget,
  verifyRsiRecursiveRiskBudget,
  rsiRiskAllocationForConfirmation,
} from './rsi-recursive-risk-budget.mjs';

export const RSI_QD_MULTIDIMENSIONAL_EVIDENCE_SCHEMA='metaengine.rsi.qd-multidimensional-shadow-evidence.v1';
export const RSI_QD_ANYTIME_CERTIFICATE_SCHEMA='metaengine.rsi.qd-anytime-canary-certificate.v1';
export const RSI_QD_CONVERGED_CANARY_REVIEW_SCHEMA='metaengine.rsi.qd-converged-canary-review.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const EPS=1e-12;
const CERT_METHODS=new Set(['E_VALUE_EXTERNAL_V1','PAIRED_CONFIDENCE_SEQUENCE_EXTERNAL_V1']);
const RISK_BUDGET=createRsiRecursiveRiskBudget({
  budget_id:'rsi.qd.canary-review.risk.v1',
  global_alpha:0.01,
  spending_policy:RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
  evidence_family:'RSI_QD_MULTIDIMENSIONAL_CANARY_REVIEW',
});

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function dg(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_qd_multi_${l}_digest_invalid`);return x}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_qd_multi_${l}_invalid`);return x}
function finite(v,l,min,max){const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`rsi_qd_multi_${l}_invalid`);return n}
function nonneg(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw new Error(`rsi_qd_multi_${l}_invalid`);return n}
function positive(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_qd_multi_${l}_invalid`);return n}
function probability(v,l){const n=Number(v);if(!Number.isFinite(n)||n<=0||n>=1)throw new Error(`rsi_qd_multi_${l}_invalid`);return n}
function zero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_qd_multi_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_qd_multi_${l}_retry_invalid`)}
function refs(v){if(!Array.isArray(v)||v.length<1||v.length>32)throw new Error('rsi_qd_multi_evidence_refs_invalid');const out=[...new Set(v.map(x=>id(x,'evidence_ref')))].sort();if(out.length!==v.length)throw new Error('rsi_qd_multi_evidence_ref_duplicate');return Object.freeze(out)}
function metrics(v,l){
  if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(`rsi_qd_multi_${l}_metrics_invalid`);
  const keys=Object.keys(v).sort(), expected=['latency_ms','outcome_safety','security_awareness','task_utility','token_count'];
  if(keys.length!==expected.length||keys.some((x,i)=>x!==expected[i]))throw new Error(`rsi_qd_multi_${l}_metrics_shape_invalid`);
  return Object.freeze({
    latency_ms:finite(v.latency_ms,`${l}_latency`,0,86400000),
    outcome_safety:finite(v.outcome_safety,`${l}_safety`,0,1),
    security_awareness:finite(v.security_awareness,`${l}_security`,0,1),
    task_utility:finite(v.task_utility,`${l}_utility`,0,1),
    token_count:nonneg(v.token_count,`${l}_tokens`),
  });
}
function pairByComparisonDigest(pairs,d){
  const wanted=dg(d,'comparison_lookup');
  return pairs.find(x=>x?.comparison?.comparison_digest===wanted)||null;
}
function signedGain(champion,challenger){
  const gains=Object.freeze({
    outcome_safety:challenger.outcome_safety-champion.outcome_safety,
    security_awareness:challenger.security_awareness-champion.security_awareness,
    task_utility:challenger.task_utility-champion.task_utility,
    latency_efficiency:champion.latency_ms-challenger.latency_ms,
    token_efficiency:champion.token_count-challenger.token_count,
  });
  const values=Object.values(gains), anyGain=values.some(x=>x>0), anyRegression=values.some(x=>x<0);
  return Object.freeze({gains,relation:anyGain&&!anyRegression?'VECTOR_PARETO_ADVANCE':anyGain&&anyRegression?'VECTOR_TRADEOFF':!anyGain&&anyRegression?'VECTOR_DOMINATED_REGRESSION':'VECTOR_MATCH'});
}

export function createRsiQdMultidimensionalEvidence({
  evidence_id,qd_review,comparison_pairs,comparison_digest,
  simulation_environment_digest,evaluator_manifest_digest,
  champion_trajectory_digest,challenger_trajectory_digest,
  champion_metrics,challenger_metrics,
  champion_hard_invariants_pass,challenger_hard_invariants_pass,
  comparator_integrity_pass,identity_stable,from_scratch_replay_pass,
  security_negative_pass,ambiguous_evidence=false,challenger_incident=false,
  evidence_digest,evidence_refs,
  counterfactual_simulation=false,browser_effects_performed=true,live_plan_execution_performed=true,
  external_evaluator=false,authored_by_candidate=true,
}={}){
  const review=verifyRsiQdBoundedCanaryReview(qd_review,{comparison_pairs});
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_qd_multi_external_evaluator_required');
  if(counterfactual_simulation!==true||browser_effects_performed!==false||live_plan_execution_performed!==false)throw new Error('rsi_qd_multi_counterfactual_only_required');
  const pair=pairByComparisonDigest(comparison_pairs,comparison_digest);
  if(!pair||!review.comparison_digests.includes(pair.comparison.comparison_digest))throw new Error('rsi_qd_multi_comparison_not_in_review');
  const champion=metrics(champion_metrics,'champion'), challenger=metrics(challenger_metrics,'challenger');
  const vector=signedGain(champion,challenger);
  const incidentCodes=[];
  if(champion_hard_invariants_pass!==true)incidentCodes.push('BASELINE_HARD_INVARIANT_FAILURE');
  if(challenger_hard_invariants_pass!==true)incidentCodes.push('CHALLENGER_HARD_INVARIANT_FAILURE');
  if(comparator_integrity_pass!==true)incidentCodes.push('COMPARATOR_INTEGRITY_FAILURE');
  if(identity_stable!==true)incidentCodes.push('IDENTITY_DRIFT');
  if(from_scratch_replay_pass!==true)incidentCodes.push('FROM_SCRATCH_REPLAY_FAILURE');
  if(security_negative_pass!==true)incidentCodes.push('SECURITY_NEGATIVE_FAILURE');
  if(ambiguous_evidence===true)incidentCodes.push('AMBIGUOUS_EVIDENCE');
  if(challenger_incident===true)incidentCodes.push('CHALLENGER_INCIDENT');
  const core={
    schema:RSI_QD_MULTIDIMENSIONAL_EVIDENCE_SCHEMA,version:1,source_sha:review.source_sha,
    evidence_id:id(evidence_id,'evidence_id'),qd_review_digest:review.review_digest,
    comparison_digest:pair.comparison.comparison_digest,binding_digest:pair.binding.binding_digest,
    qualification_digest:pair.binding.qualification_digest,verified_context_digest:pair.binding.verified_context_digest,
    comparator_root_digest:pair.binding.comparator_root_digest,champion_profile_digest:pair.binding.champion_profile_digest,
    challenger_profile_digest:pair.binding.challenger_profile_digest,
    simulation_environment_digest:dg(simulation_environment_digest,'simulation_environment'),
    evaluator_manifest_digest:dg(evaluator_manifest_digest,'evaluator_manifest'),
    champion_trajectory_digest:dg(champion_trajectory_digest,'champion_trajectory'),
    challenger_trajectory_digest:dg(challenger_trajectory_digest,'challenger_trajectory'),
    champion_metrics:champion,challenger_metrics:challenger,signed_challenger_gain:vector.gains,vector_relation:vector.relation,
    champion_hard_invariants_pass:champion_hard_invariants_pass===true,
    challenger_hard_invariants_pass:challenger_hard_invariants_pass===true,
    comparator_integrity_pass:comparator_integrity_pass===true,identity_stable:identity_stable===true,
    from_scratch_replay_pass:from_scratch_replay_pass===true,security_negative_pass:security_negative_pass===true,
    ambiguous_evidence:ambiguous_evidence===true,challenger_incident:challenger_incident===true,
    incident:incidentCodes.length>0,incident_codes:Object.freeze(incidentCodes.sort()),
    evidence_digest:dg(evidence_digest,'evidence'),evidence_refs:refs(evidence_refs),
    evaluation_dimensions:Object.freeze(['OUTCOME_SAFETY','SECURITY_AWARENESS','TASK_UTILITY','LATENCY_EFFICIENCY','TOKEN_EFFICIENCY']),
    scalar_winner:null,counterfactual_simulation:true,browser_effects_performed:false,live_plan_execution_performed:false,
    champion_remains_execution_baseline:true,evidence_is_canary_authority:false,
    canary_activation_authorized:false,profile_replacement_authorized:false,
    external_evaluator:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,row_digest:digest(core)});
}

export function verifyRsiQdMultidimensionalEvidence(row,args={}){
  if(!row||row.schema!==RSI_QD_MULTIDIMENSIONAL_EVIDENCE_SCHEMA||row.version!==1)throw new Error('rsi_qd_multi_evidence_invalid');
  zero(row,'evidence');
  if(row.scalar_winner!==null||row.counterfactual_simulation!==true||row.browser_effects_performed!==false
    ||row.live_plan_execution_performed!==false||row.champion_remains_execution_baseline!==true
    ||row.evidence_is_canary_authority!==false||row.canary_activation_authorized!==false
    ||row.profile_replacement_authorized!==false||row.external_evaluator!==true||row.authored_by_candidate!==false)throw new Error('rsi_qd_multi_evidence_policy_invalid');
  const canonical=createRsiQdMultidimensionalEvidence({
    evidence_id:row.evidence_id,qd_review:args.qd_review,comparison_pairs:args.comparison_pairs,comparison_digest:row.comparison_digest,
    simulation_environment_digest:row.simulation_environment_digest,evaluator_manifest_digest:row.evaluator_manifest_digest,
    champion_trajectory_digest:row.champion_trajectory_digest,challenger_trajectory_digest:row.challenger_trajectory_digest,
    champion_metrics:row.champion_metrics,challenger_metrics:row.challenger_metrics,
    champion_hard_invariants_pass:row.champion_hard_invariants_pass,challenger_hard_invariants_pass:row.challenger_hard_invariants_pass,
    comparator_integrity_pass:row.comparator_integrity_pass,identity_stable:row.identity_stable,
    from_scratch_replay_pass:row.from_scratch_replay_pass,security_negative_pass:row.security_negative_pass,
    ambiguous_evidence:row.ambiguous_evidence,challenger_incident:row.challenger_incident,
    evidence_digest:row.evidence_digest,evidence_refs:row.evidence_refs,counterfactual_simulation:true,
    browser_effects_performed:false,live_plan_execution_performed:false,external_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.row_digest!==dg(row.row_digest,'row'))throw new Error('rsi_qd_multi_evidence_digest_mismatch');
  return canonical;
}

function verifyEvidenceSet(rows,{qd_review,comparison_pairs}={}){
  const review=verifyRsiQdBoundedCanaryReview(qd_review,{comparison_pairs});
  if(!Array.isArray(rows)||rows.length!==review.comparison_count)throw new Error('rsi_qd_multi_complete_evidence_required');
  const checked=rows.map(row=>verifyRsiQdMultidimensionalEvidence(row,{qd_review:review,comparison_pairs}));
  const byComparison=new Set(checked.map(x=>x.comparison_digest));
  if(byComparison.size!==checked.length||review.comparison_digests.some(d=>!byComparison.has(d)))throw new Error('rsi_qd_multi_evidence_coverage_mismatch');
  if(checked.some(x=>x.incident===true))throw new Error('rsi_qd_multi_incident_latched');
  const evaluatorRoots=new Set(checked.map(x=>x.evaluator_manifest_digest));
  if(evaluatorRoots.size!==1)throw new Error('rsi_qd_multi_evaluator_manifest_drift');
  return Object.freeze({review,rows:Object.freeze(checked),evaluator_manifest_digest:checked[0].evaluator_manifest_digest});
}

export function createRsiQdAnytimeCanaryCertificate({
  certificate_id,qd_review,comparison_pairs,multidimensional_evidence,
  budget,confirmation_index,independent_holdout_digest,security_negative_holdout_digest,
  evaluator_root_digest,method='E_VALUE_EXTERNAL_V1',alpha_used,
  safety_noninferiority_certified,security_noninferiority_certified,utility_noninferiority_certified,
  material_improvement_certified,familywise_valid,independent_holdout,stopping_rule_precommitted,optional_stopping_used,
  sample_count,evidence_refs,external_verifier=false,authored_by_candidate=true,
}={}){
  const evidence=verifyEvidenceSet(multidimensional_evidence,{qd_review,comparison_pairs});
  const checkedBudget=verifyRsiRecursiveRiskBudget(budget);
  if(checkedBudget.budget_digest!==RISK_BUDGET.budget_digest)throw new Error('rsi_qd_multi_fixed_risk_budget_required');
  if(external_verifier!==true||authored_by_candidate!==false)throw new Error('rsi_qd_multi_external_verifier_required');
  const index=positive(confirmation_index,'confirmation_index'), allocation=rsiRiskAllocationForConfirmation(checkedBudget,index);
  const used=probability(alpha_used,'alpha_used');if(used-allocation>EPS)throw new Error('rsi_qd_multi_alpha_over_budget');
  const m=String(method||'').trim().toUpperCase();if(!CERT_METHODS.has(m))throw new Error('rsi_qd_multi_method_invalid');
  if(familywise_valid!==true||independent_holdout!==true||stopping_rule_precommitted!==true||optional_stopping_used!==false)throw new Error('rsi_qd_multi_statistical_policy_invalid');
  const holdout=dg(independent_holdout_digest,'independent_holdout'), securityHoldout=dg(security_negative_holdout_digest,'security_holdout');
  if(holdout===securityHoldout||securityHoldout===evidence.review.comparator_root_digest)throw new Error('rsi_qd_multi_holdout_independence_invalid');
  const core={
    schema:RSI_QD_ANYTIME_CERTIFICATE_SCHEMA,version:1,source_sha:evidence.review.source_sha,
    certificate_id:id(certificate_id,'certificate_id'),qd_review_digest:evidence.review.review_digest,
    multidimensional_evidence_root:digest(evidence.rows.map(x=>x.row_digest)),
    evidence_count:evidence.rows.length,evaluator_manifest_digest:evidence.evaluator_manifest_digest,
    independent_holdout_digest:holdout,security_negative_holdout_digest:securityHoldout,
    evaluator_root_digest:dg(evaluator_root_digest,'evaluator_root'),
    budget_id:checkedBudget.budget_id,budget_digest:checkedBudget.budget_digest,confirmation_index:index,
    allocated_alpha:allocation,alpha_used:used,global_alpha:checkedBudget.global_alpha,method:m,
    safety_noninferiority_certified:safety_noninferiority_certified===true,
    security_noninferiority_certified:security_noninferiority_certified===true,
    utility_noninferiority_certified:utility_noninferiority_certified===true,
    material_improvement_certified:material_improvement_certified===true,
    familywise_valid:true,independent_holdout:true,stopping_rule_precommitted:true,optional_stopping_used:false,
    sample_count:positive(sample_count,'sample_count'),evidence_refs:refs(evidence_refs),
    candidate_can_choose_alpha:false,candidate_can_choose_confirmation_index:false,candidate_can_choose_holdout:false,
    candidate_can_choose_evaluator:false,candidate_can_author_certificate:false,certificate_is_canary_authority:false,
    external_verifier:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  if(core.sample_count<evidence.rows.length)throw new Error('rsi_qd_multi_sample_count_below_evidence');
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiQdAnytimeCanaryCertificate(cert,args={}){
  if(!cert||cert.schema!==RSI_QD_ANYTIME_CERTIFICATE_SCHEMA||cert.version!==1)throw new Error('rsi_qd_multi_certificate_invalid');
  zero(cert,'certificate');
  if(cert.external_verifier!==true||cert.authored_by_candidate!==false||cert.candidate_can_choose_alpha!==false
    ||cert.candidate_can_choose_confirmation_index!==false||cert.candidate_can_choose_holdout!==false
    ||cert.candidate_can_choose_evaluator!==false||cert.candidate_can_author_certificate!==false||cert.certificate_is_canary_authority!==false)throw new Error('rsi_qd_multi_certificate_policy_invalid');
  const canonical=createRsiQdAnytimeCanaryCertificate({
    certificate_id:cert.certificate_id,qd_review:args.qd_review,comparison_pairs:args.comparison_pairs,
    multidimensional_evidence:args.multidimensional_evidence,budget:args.budget,confirmation_index:cert.confirmation_index,
    independent_holdout_digest:cert.independent_holdout_digest,security_negative_holdout_digest:cert.security_negative_holdout_digest,
    evaluator_root_digest:cert.evaluator_root_digest,method:cert.method,alpha_used:cert.alpha_used,
    safety_noninferiority_certified:cert.safety_noninferiority_certified,security_noninferiority_certified:cert.security_noninferiority_certified,
    utility_noninferiority_certified:cert.utility_noninferiority_certified,material_improvement_certified:cert.material_improvement_certified,
    familywise_valid:cert.familywise_valid,independent_holdout:cert.independent_holdout,
    stopping_rule_precommitted:cert.stopping_rule_precommitted,optional_stopping_used:cert.optional_stopping_used,
    sample_count:cert.sample_count,evidence_refs:cert.evidence_refs,external_verifier:true,authored_by_candidate:false,
  });
  if(canonical.certificate_digest!==dg(cert.certificate_digest,'certificate'))throw new Error('rsi_qd_multi_certificate_digest_mismatch');
  return canonical;
}

export function createRsiQdConvergedCanaryReview({
  review_id,qd_review,comparison_pairs,multidimensional_evidence,budget,certificate,
}={}){
  const review=verifyRsiQdBoundedCanaryReview(qd_review,{comparison_pairs});
  const cert=verifyRsiQdAnytimeCanaryCertificate(certificate,{qd_review:review,comparison_pairs,multidimensional_evidence,budget});
  const pass=cert.safety_noninferiority_certified&&cert.security_noninferiority_certified&&cert.utility_noninferiority_certified&&cert.material_improvement_certified;
  const core={
    schema:RSI_QD_CONVERGED_CANARY_REVIEW_SCHEMA,version:1,source_sha:review.source_sha,
    review_id:id(review_id,'review_id'),qd_review_digest:review.review_digest,certificate_digest:cert.certificate_digest,
    qualification_digest:review.qualification_digest,champion_profile_digest:review.champion_profile_digest,
    challenger_profile_digest:review.challenger_profile_digest,comparator_root_digest:review.comparator_root_digest,
    cohort_digest:review.cohort_digest,comparison_count:review.comparison_count,context_count:review.context_count,
    multidimensional_evidence_root:cert.multidimensional_evidence_root,
    state:pass?'ELIGIBLE_FOR_EXTERNAL_BOUNDED_CANARY_CONTROLLER_REVIEW':'MULTIDIMENSIONAL_STATISTICAL_REVIEW_REJECTED',
    eligible_for_external_bounded_canary_controller_review:pass,
    incumbent_remains_default:true,incumbent_is_mandatory_fallback:true,challenger_is_advisory_only:true,
    canary_surface:'READ_ONLY_DECISION_SUPPORT',max_canary_decisions:review.max_canary_decisions,
    canary_token:null,canary_activation_authorized:false,profile_replacement_authorized:false,
    external_canary_controller_required:true,review_is_canary_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,converged_review_digest:digest(core)});
}

export function verifyRsiQdConvergedCanaryReview(row){
  if(!row||row.schema!==RSI_QD_CONVERGED_CANARY_REVIEW_SCHEMA||row.version!==1)throw new Error('rsi_qd_multi_review_invalid');
  zero(row,'review');
  const eligible=row.state==='ELIGIBLE_FOR_EXTERNAL_BOUNDED_CANARY_CONTROLLER_REVIEW';
  if(!eligible&&row.state!=='MULTIDIMENSIONAL_STATISTICAL_REVIEW_REJECTED')throw new Error('rsi_qd_multi_review_state_invalid');
  if(row.eligible_for_external_bounded_canary_controller_review!==eligible||row.incumbent_remains_default!==true
    ||row.incumbent_is_mandatory_fallback!==true||row.challenger_is_advisory_only!==true
    ||row.canary_surface!=='READ_ONLY_DECISION_SUPPORT'||row.max_canary_decisions!==16
    ||row.canary_token!==null||row.canary_activation_authorized!==false||row.profile_replacement_authorized!==false
    ||row.external_canary_controller_required!==true||row.review_is_canary_authority!==false)throw new Error('rsi_qd_multi_review_policy_invalid');
  const clone=structuredClone(row);delete clone.converged_review_digest;
  if(digest(clone)!==dg(row.converged_review_digest,'review'))throw new Error('rsi_qd_multi_review_digest_mismatch');
  return Object.freeze(structuredClone(row));
}

export function rsiQdMultidimensionalRiskBudgetSnapshot(){return RISK_BUDGET}

export function rsiQdMultidimensionalCanaryTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.qd-multidimensional-canary-root.v1',version:1,
    crash_consistent_qd_comparison_required:true,qd_context_coverage_review_required:true,
    complete_multidimensional_evidence_required:true,
    evaluation_dimensions:Object.freeze(['OUTCOME_SAFETY','SECURITY_AWARENESS','TASK_UTILITY','LATENCY_EFFICIENCY','TOKEN_EFFICIENCY']),
    scalar_winner_authoritative:false,external_evaluator_required:true,identity_stability_required:true,
    from_scratch_replay_required:true,security_negative_required:true,comparator_integrity_required:true,
    ambiguity_forbidden:true,incident_forbidden:true,external_statistical_verifier_required:true,
    fixed_risk_budget_digest:RISK_BUDGET.budget_digest,global_alpha:RISK_BUDGET.global_alpha,anytime_risk_spending:true,
    safety_noninferiority_required:true,security_noninferiority_required:true,utility_noninferiority_required:true,
    material_improvement_required:true,independent_holdout_required:true,
    candidate_can_choose_alpha:false,candidate_can_choose_holdout:false,candidate_can_choose_evaluator:false,
    incumbent_remains_default:true,incumbent_is_mandatory_fallback:true,external_canary_controller_required:true,
    canary_token_minted:false,canary_activation_authorized:false,profile_replacement_authorized:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,trust_root_digest:digest(root)});
}
