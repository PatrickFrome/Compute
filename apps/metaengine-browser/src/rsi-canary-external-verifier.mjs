import crypto from 'node:crypto';
import {
  verifyRsiMetaProfileCanaryAdmission,
  verifyRsiMetaProfileCanaryDecision,
  verifyRsiMetaProfileCanaryOutcome,
} from './rsi-meta-profile-canary-admission.mjs';

export const RSI_CANARY_EXTERNAL_VERIFIER_SCHEMA='metaengine.rsi.canary-external-verifier.v1';
const D=/^sha256:[0-9a-f]{64}$/;
const I=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function dig(v,n){const x=String(v||'').toLowerCase();if(!D.test(x))throw new Error(`rsi_canary_verifier_${n}_digest_invalid`);return x}
function id(v,n){const x=String(v||'');if(!I.test(x))throw new Error(`rsi_canary_verifier_${n}_invalid`);return x}
function zero(v){
  return Object.freeze({...v,execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});
}

export function createRsiCanaryExternalVerifierReview({
  review_id,admission,decisions,outcomes,verifier_root_digest,hidden_acceptance_manifest_digest,
  reward_hacking_trap_digest,transfer_holdout_digest,trajectory_integrity_digest,candidate_test_digest,
  hidden_acceptance_pass=false,reward_hacking_trap_pass=false,transfer_holdout_pass=false,
  trajectory_integrity_pass=false,external_verifier=false,authored_by_candidate=true,
}={}){
  if(external_verifier!==true||authored_by_candidate!==false)throw new Error('rsi_canary_verifier_external_verifier_required');
  const a=verifyRsiMetaProfileCanaryAdmission(admission);
  if(!Array.isArray(decisions)||!Array.isArray(outcomes)
    ||decisions.length!==a.max_decisions||outcomes.length!==a.max_decisions){
    throw new Error('rsi_canary_verifier_complete_fixed_budget_required');
  }
  const ds=decisions.map((row,i)=>{
    const d=verifyRsiMetaProfileCanaryDecision(row,a);
    if(d.decision_seq!==i+1)throw new Error('rsi_canary_verifier_decision_sequence_invalid');
    return d;
  });
  const by=new Map(ds.map(d=>[d.decision_digest,d]));
  const seen=new Set();
  const os=outcomes.map(row=>{
    const decision=by.get(row?.decision_digest);
    if(!decision)throw new Error('rsi_canary_verifier_outcome_decision_missing');
    const o=verifyRsiMetaProfileCanaryOutcome(row,{admission:a,decision});
    if(seen.has(o.decision_digest))throw new Error('rsi_canary_verifier_duplicate_outcome');
    seen.add(o.decision_digest);
    if(o.rollback_required===true||o.ambiguous===true||o.hard_invariant_pass!==true
      ||o.outcome_safety!=='PASS'||o.security_awareness!=='PASS'||o.task_utility<0){
      throw new Error('rsi_canary_verifier_canary_not_clean');
    }
    return o;
  });
  const externalPass=hidden_acceptance_pass===true&&reward_hacking_trap_pass===true
    &&transfer_holdout_pass===true&&trajectory_integrity_pass===true;
  const core={
    schema:RSI_CANARY_EXTERNAL_VERIFIER_SCHEMA,version:1,review_id:id(review_id,'review_id'),
    source_sha:a.source_sha,canary_id:a.canary_id,canary_admission_digest:a.admission_digest,
    selection_digest:a.selection_digest,incumbent_profile_digest:a.incumbent_profile_digest,
    challenger_profile_digest:a.challenger_profile_digest,cohort_digest:a.cohort_digest,
    decision_budget:a.max_decisions,decision_digests:Object.freeze(ds.map(x=>x.decision_digest)),
    outcome_digests:Object.freeze(os.map(x=>x.outcome_digest)),fixed_budget_complete:true,
    verifier_root_digest:dig(verifier_root_digest,'verifier_root'),
    hidden_acceptance_manifest_digest:dig(hidden_acceptance_manifest_digest,'hidden_manifest'),
    reward_hacking_trap_digest:dig(reward_hacking_trap_digest,'reward_trap'),
    transfer_holdout_digest:dig(transfer_holdout_digest,'transfer_holdout'),
    trajectory_integrity_digest:dig(trajectory_integrity_digest,'trajectory_integrity'),
    candidate_test_digest:dig(candidate_test_digest,'candidate_test'),
    hidden_acceptance_pass:hidden_acceptance_pass===true,
    reward_hacking_trap_pass:reward_hacking_trap_pass===true,
    transfer_holdout_pass:transfer_holdout_pass===true,
    trajectory_integrity_pass:trajectory_integrity_pass===true,
    all_external_dimensions_pass:externalPass,
    state:externalPass?'READY_FOR_SEPARATE_VERIFIER_EVOLUTION_REVIEW':'REJECTED_EXTERNAL_VERIFIER',
    complete_trajectory_evidence_required:true,candidate_tests_advisory_only:true,
    scalar_utility_is_not_deployment_authority:true,incumbent_remains_default:true,
    verifier_evolution_requires_separate_sealed_admission:true,
    deployment_acceptance_authorized:false,profile_activation_authorized:false,
    external_verifier:true,authored_by_candidate:false,
  };
  return zero({...core,review_digest:dg(core)});
}

export function verifyRsiCanaryExternalVerifierReview(row){
  if(!row||row.schema!==RSI_CANARY_EXTERNAL_VERIFIER_SCHEMA||row.version!==1)throw new Error('rsi_canary_verifier_review_invalid');
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect']){
    if(row[f]!==false)throw new Error('rsi_canary_verifier_authority_invalid');
  }
  if(row.automatic_retry_allowed!==false||row.fixed_budget_complete!==true||row.complete_trajectory_evidence_required!==true
    ||row.candidate_tests_advisory_only!==true||row.scalar_utility_is_not_deployment_authority!==true
    ||row.incumbent_remains_default!==true||row.verifier_evolution_requires_separate_sealed_admission!==true
    ||row.deployment_acceptance_authorized!==false||row.profile_activation_authorized!==false
    ||row.external_verifier!==true||row.authored_by_candidate!==false)throw new Error('rsi_canary_verifier_policy_invalid');
  const clone=structuredClone(row);delete clone.review_digest;
  if(dg(clone)!==dig(row.review_digest,'review'))throw new Error('rsi_canary_verifier_review_digest_mismatch');
  return Object.freeze(structuredClone(row));
}

export function rsiCanaryExternalVerifierTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.canary-external-verifier-root.v1',version:1,
    full_fixed_budget_canary_required:true,complete_trajectory_evidence_required:true,
    hidden_acceptance_required:true,reward_hacking_trap_required:true,transfer_holdout_required:true,
    trajectory_integrity_required:true,external_verifier_required:true,
    candidate_tests_advisory_only:true,scalar_utility_is_not_deployment_authority:true,
    incumbent_remains_default:true,verifier_evolution_requires_separate_sealed_admission:true,
    deployment_acceptance_authorized:false,profile_activation_authorized:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,verifier_root_digest:dg(root)});
}
