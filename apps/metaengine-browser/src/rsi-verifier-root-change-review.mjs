import crypto from 'node:crypto';

import {
  verifyRsiVerifierEvolutionPlan,
  verifyRsiVerifierEvolutionEvaluationReceipt,
  verifyRsiVerifierEvolutionAdmission,
} from './rsi-verifier-evolution-admission.mjs';
import {
  verifyRsiVerifierShadowQualification,
} from './rsi-verifier-shadow-qualification.mjs';

export const RSI_VERIFIER_ROOT_CHANGE_PROPOSAL_SCHEMA='metaengine.rsi.verifier-root-change-proposal.v1';
export const RSI_VERIFIER_ROOT_CHANGE_APPROVAL_SCHEMA='metaengine.rsi.verifier-root-change-approval.v1';
export const RSI_VERIFIER_ROOT_CHANGE_REVIEW_SCHEMA='metaengine.rsi.verifier-root-change-review.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const ROLES=new Set(['PREDECESSOR_TRUST','SECONDARY_TRUST']);
const REQUIRED_CHECKS=Object.freeze([
  'qualification_binding_pass',
  'constitution_unchanged_pass',
  'compatibility_pass',
  'rollback_protection_pass',
  'root_history_continuity_pass',
  'independent_audit_pass',
  'shadow_nonregression_pass',
]);

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactDigest(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA256_RE.test(x))throw new Error(`rsi_verifier_root_change_${l}_digest_invalid`);
  return x;
}
function id(v,l){
  const x=String(v||'').trim();
  if(!SAFE_ID_RE.test(x))throw new Error(`rsi_verifier_root_change_${l}_invalid`);
  return x;
}
function positiveInt(v,l){
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_verifier_root_change_${l}_invalid`);
  return n;
}
function assertZero(v,l){
  for(const f of [
    'execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','scheduler_authority','signing_authority','authority_effect',
  ]){
    if(v?.[f]!==false)throw new Error(`rsi_verifier_root_change_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_verifier_root_change_${l}_retry_invalid`);
}
function verifyDigestObject(row,schema,digestField,label){
  if(!row||row.schema!==schema||row.version!==1)throw new Error(`rsi_verifier_root_change_${label}_invalid`);
  assertZero(row,label);
  const clone=structuredClone(row);delete clone[digestField];
  if(dg(clone)!==exactDigest(row[digestField],label))throw new Error(`rsi_verifier_root_change_${label}_digest_mismatch`);
  return Object.freeze(structuredClone(row));
}
function verifyShadowBundle({
  qualification,observations,admission,plan,predecessor_receipt,secondary_receipt,
}={}){
  const p=verifyRsiVerifierEvolutionPlan(plan);
  const pre=verifyRsiVerifierEvolutionEvaluationReceipt(predecessor_receipt,{plan:p});
  const sec=verifyRsiVerifierEvolutionEvaluationReceipt(secondary_receipt,{plan:p});
  const a=verifyRsiVerifierEvolutionAdmission(admission,{
    plan:p,predecessor_receipt:pre,secondary_receipt:sec,
  });
  const q=verifyRsiVerifierShadowQualification(qualification,{
    admission:a,plan:p,predecessor_receipt:pre,secondary_receipt:sec,observations,
  });
  if(q.state!=='QUALIFIED_VERIFIER_SHADOW'||q.qualified_for_verifier_shadow_continuation!==true){
    throw new Error('rsi_verifier_root_change_shadow_qualification_required');
  }
  if(
    q.active_verifier_root_digest!==p.predecessor_verifier_root_digest
    ||q.shadow_verifier_root_digest!==p.candidate_verifier_root_digest
  ){
    throw new Error('rsi_verifier_root_change_shadow_root_binding_mismatch');
  }
  return Object.freeze({plan:p,admission:a,qualification:q,predecessor_receipt:pre,secondary_receipt:sec});
}

export function createRsiVerifierRootChangeProposal({
  proposal_id,
  qualification,
  observations,
  admission,
  plan,
  predecessor_receipt,
  secondary_receipt,
  current_root_generation,
  next_root_generation,
  prior_root_history_digest,
  compatibility_manifest_digest,
  compatibility_evidence_digest,
  external_proposal_owner=false,
  authored_by_candidate=true,
}={}){
  const bundle=verifyShadowBundle({
    qualification,observations,admission,plan,predecessor_receipt,secondary_receipt,
  });
  if(external_proposal_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_verifier_root_change_external_proposal_owner_required');
  }
  const current=positiveInt(current_root_generation,'current_generation');
  const next=positiveInt(next_root_generation,'next_generation');
  if(next!==current+1)throw new Error('rsi_verifier_root_change_generation_must_increment_by_one');
  const priorHistory=exactDigest(prior_root_history_digest,'prior_history');
  const compatibilityManifest=exactDigest(compatibility_manifest_digest,'compatibility_manifest');
  const compatibilityEvidence=exactDigest(compatibility_evidence_digest,'compatibility_evidence');
  const nextHistory=dg({
    prior_root_history_digest:priorHistory,
    current_root_generation:current,
    next_root_generation:next,
    predecessor_verifier_root_digest:bundle.qualification.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:bundle.qualification.candidate_verifier_root_digest,
    qualification_digest:bundle.qualification.qualification_digest,
    constitution_digest:bundle.plan.constitution_digest,
    compatibility_manifest_digest:compatibilityManifest,
    compatibility_evidence_digest:compatibilityEvidence,
  });
  const core={
    schema:RSI_VERIFIER_ROOT_CHANGE_PROPOSAL_SCHEMA,version:1,
    proposal_id:id(proposal_id,'proposal_id'),
    source_sha:bundle.plan.source_sha,
    qualification_digest:bundle.qualification.qualification_digest,
    admission_digest:bundle.admission.admission_digest,
    plan_digest:bundle.plan.plan_digest,
    constitution_digest:bundle.plan.constitution_digest,
    current_root_generation:current,
    next_root_generation:next,
    predecessor_verifier_root_digest:bundle.qualification.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:bundle.qualification.candidate_verifier_root_digest,
    secondary_verifier_root_digest:bundle.qualification.secondary_verifier_root_digest,
    prior_root_history_digest:priorHistory,
    next_root_history_digest:nextHistory,
    compatibility_manifest_digest:compatibilityManifest,
    compatibility_evidence_digest:compatibilityEvidence,
    generation_increment_exactly_one:true,
    root_history_hash_chained:true,
    rollback_to_prior_generation_allowed:false,
    active_verifier_root_digest:bundle.qualification.predecessor_verifier_root_digest,
    proposed_verifier_root_digest:bundle.qualification.candidate_verifier_root_digest,
    root_change_authorized:false,
    verifier_activation_authorized:false,
    proposal_is_trust_root_authority:false,
    candidate_can_choose_generation:false,
    candidate_can_rewrite_root_history:false,
    candidate_can_modify_constitution:false,
    external_proposal_owner:true,
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
  return Object.freeze({...core,proposal_digest:dg(core)});
}

export function verifyRsiVerifierRootChangeProposal(row){
  const p=verifyDigestObject(row,RSI_VERIFIER_ROOT_CHANGE_PROPOSAL_SCHEMA,'proposal_digest','proposal');
  if(
    p.next_root_generation!==p.current_root_generation+1
    ||p.generation_increment_exactly_one!==true
    ||p.root_history_hash_chained!==true
    ||p.rollback_to_prior_generation_allowed!==false
    ||p.active_verifier_root_digest!==p.predecessor_verifier_root_digest
    ||p.proposed_verifier_root_digest!==p.candidate_verifier_root_digest
    ||p.root_change_authorized!==false
    ||p.verifier_activation_authorized!==false
    ||p.proposal_is_trust_root_authority!==false
    ||p.candidate_can_choose_generation!==false
    ||p.candidate_can_rewrite_root_history!==false
    ||p.candidate_can_modify_constitution!==false
    ||p.external_proposal_owner!==true
    ||p.authored_by_candidate!==false
  ){
    throw new Error('rsi_verifier_root_change_proposal_policy_invalid');
  }
  const expectedHistory=dg({
    prior_root_history_digest:p.prior_root_history_digest,
    current_root_generation:p.current_root_generation,
    next_root_generation:p.next_root_generation,
    predecessor_verifier_root_digest:p.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:p.candidate_verifier_root_digest,
    qualification_digest:p.qualification_digest,
    constitution_digest:p.constitution_digest,
    compatibility_manifest_digest:p.compatibility_manifest_digest,
    compatibility_evidence_digest:p.compatibility_evidence_digest,
  });
  if(expectedHistory!==p.next_root_history_digest){
    throw new Error('rsi_verifier_root_change_history_chain_mismatch');
  }
  return p;
}

export function createRsiVerifierRootChangeApproval({
  approval_id,
  proposal,
  approver_role,
  approver_root_digest,
  qualification_binding_pass=false,
  constitution_unchanged_pass=false,
  compatibility_pass=false,
  rollback_protection_pass=false,
  root_history_continuity_pass=false,
  independent_audit_pass=false,
  shadow_nonregression_pass=false,
  approval_evidence_digest,
  evidence_refs,
  external_approver=false,
  authored_by_candidate=true,
}={}){
  const p=verifyRsiVerifierRootChangeProposal(proposal);
  if(external_approver!==true||authored_by_candidate!==false){
    throw new Error('rsi_verifier_root_change_external_approver_required');
  }
  const role=String(approver_role||'').trim().toUpperCase();
  if(!ROLES.has(role))throw new Error('rsi_verifier_root_change_approver_role_invalid');
  const root=exactDigest(approver_root_digest,'approver_root');
  const expected=role==='PREDECESSOR_TRUST'?p.predecessor_verifier_root_digest:p.secondary_verifier_root_digest;
  if(root!==expected)throw new Error('rsi_verifier_root_change_approver_root_mismatch');
  if(root===p.candidate_verifier_root_digest)throw new Error('rsi_verifier_root_change_candidate_cannot_approve_self');
  const refs=Array.isArray(evidence_refs)?[...new Set(evidence_refs.map(x=>id(x,'evidence_ref')))].sort():[];
  if(refs.length<1||refs.length!==evidence_refs.length)throw new Error('rsi_verifier_root_change_evidence_refs_invalid');
  const checks={
    qualification_binding_pass:qualification_binding_pass===true,
    constitution_unchanged_pass:constitution_unchanged_pass===true,
    compatibility_pass:compatibility_pass===true,
    rollback_protection_pass:rollback_protection_pass===true,
    root_history_continuity_pass:root_history_continuity_pass===true,
    independent_audit_pass:independent_audit_pass===true,
    shadow_nonregression_pass:shadow_nonregression_pass===true,
  };
  const overallPass=REQUIRED_CHECKS.every(k=>checks[k]===true);
  const core={
    schema:RSI_VERIFIER_ROOT_CHANGE_APPROVAL_SCHEMA,version:1,
    approval_id:id(approval_id,'approval_id'),
    source_sha:p.source_sha,
    proposal_digest:p.proposal_digest,
    qualification_digest:p.qualification_digest,
    constitution_digest:p.constitution_digest,
    approver_role:role,
    approver_root_digest:root,
    predecessor_verifier_root_digest:p.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:p.candidate_verifier_root_digest,
    secondary_verifier_root_digest:p.secondary_verifier_root_digest,
    current_root_generation:p.current_root_generation,
    next_root_generation:p.next_root_generation,
    prior_root_history_digest:p.prior_root_history_digest,
    next_root_history_digest:p.next_root_history_digest,
    compatibility_manifest_digest:p.compatibility_manifest_digest,
    compatibility_evidence_digest:p.compatibility_evidence_digest,
    ...checks,
    overall_pass:overallPass,
    approval_evidence_digest:exactDigest(approval_evidence_digest,'approval_evidence'),
    evidence_refs:Object.freeze(refs),
    approval_is_root_change_authority:false,
    approval_is_activation_authority:false,
    candidate_self_approval_accepted:false,
    external_approver:true,
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
  return Object.freeze({...core,approval_digest:dg(core)});
}

export function verifyRsiVerifierRootChangeApproval(row,{proposal}={}){
  const p=verifyRsiVerifierRootChangeProposal(proposal);
  const a=verifyDigestObject(row,RSI_VERIFIER_ROOT_CHANGE_APPROVAL_SCHEMA,'approval_digest','approval');
  if(
    a.proposal_digest!==p.proposal_digest
    ||a.qualification_digest!==p.qualification_digest
    ||a.constitution_digest!==p.constitution_digest
    ||a.predecessor_verifier_root_digest!==p.predecessor_verifier_root_digest
    ||a.candidate_verifier_root_digest!==p.candidate_verifier_root_digest
    ||a.secondary_verifier_root_digest!==p.secondary_verifier_root_digest
    ||a.current_root_generation!==p.current_root_generation
    ||a.next_root_generation!==p.next_root_generation
    ||a.prior_root_history_digest!==p.prior_root_history_digest
    ||a.next_root_history_digest!==p.next_root_history_digest
    ||a.compatibility_manifest_digest!==p.compatibility_manifest_digest
    ||a.compatibility_evidence_digest!==p.compatibility_evidence_digest
  ){
    throw new Error('rsi_verifier_root_change_approval_binding_mismatch');
  }
  if(!ROLES.has(a.approver_role))throw new Error('rsi_verifier_root_change_approver_role_invalid');
  const expected=a.approver_role==='PREDECESSOR_TRUST'?p.predecessor_verifier_root_digest:p.secondary_verifier_root_digest;
  if(a.approver_root_digest!==expected)throw new Error('rsi_verifier_root_change_approver_root_mismatch');
  if(
    a.approval_is_root_change_authority!==false
    ||a.approval_is_activation_authority!==false
    ||a.candidate_self_approval_accepted!==false
    ||a.external_approver!==true
    ||a.authored_by_candidate!==false
  ){
    throw new Error('rsi_verifier_root_change_approval_policy_invalid');
  }
  const expectedPass=REQUIRED_CHECKS.every(k=>a[k]===true);
  if(a.overall_pass!==expectedPass)throw new Error('rsi_verifier_root_change_approval_pass_mismatch');
  return a;
}

export function createRsiVerifierRootChangeReview({
  review_id,
  proposal,
  predecessor_approval,
  secondary_approval,
  external_review_owner=false,
  authored_by_candidate=true,
}={}){
  const p=verifyRsiVerifierRootChangeProposal(proposal);
  if(external_review_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_verifier_root_change_external_review_owner_required');
  }
  const predecessor=verifyRsiVerifierRootChangeApproval(predecessor_approval,{proposal:p});
  const secondary=verifyRsiVerifierRootChangeApproval(secondary_approval,{proposal:p});
  if(predecessor.approver_role!=='PREDECESSOR_TRUST'||secondary.approver_role!=='SECONDARY_TRUST'){
    throw new Error('rsi_verifier_root_change_approval_roles_invalid');
  }
  if(
    predecessor.approval_digest===secondary.approval_digest
    ||predecessor.approver_root_digest===secondary.approver_root_digest
  ){
    throw new Error('rsi_verifier_root_change_independent_approvals_required');
  }
  const bothPass=predecessor.overall_pass===true&&secondary.overall_pass===true;
  const disagreement=predecessor.overall_pass!==secondary.overall_pass;
  const state=bothPass
    ?'READY_FOR_EXTERNAL_TRUST_ROOT_CONTROLLER_REVIEW'
    :disagreement?'REJECTED_ROOT_CHANGE_APPROVAL_DISAGREEMENT':'REJECTED_ROOT_CHANGE_EVIDENCE';
  const core={
    schema:RSI_VERIFIER_ROOT_CHANGE_REVIEW_SCHEMA,version:1,
    review_id:id(review_id,'review_id'),
    source_sha:p.source_sha,
    proposal_digest:p.proposal_digest,
    qualification_digest:p.qualification_digest,
    constitution_digest:p.constitution_digest,
    predecessor_approval_digest:predecessor.approval_digest,
    secondary_approval_digest:secondary.approval_digest,
    current_root_generation:p.current_root_generation,
    next_root_generation:p.next_root_generation,
    predecessor_verifier_root_digest:p.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:p.candidate_verifier_root_digest,
    secondary_verifier_root_digest:p.secondary_verifier_root_digest,
    prior_root_history_digest:p.prior_root_history_digest,
    next_root_history_digest:p.next_root_history_digest,
    predecessor_approval_pass:predecessor.overall_pass,
    secondary_approval_pass:secondary.overall_pass,
    approval_disagreement:disagreement,
    state,
    ready_for_external_trust_root_controller_review:bothPass,
    active_verifier_root_digest:p.predecessor_verifier_root_digest,
    proposed_verifier_root_digest:p.candidate_verifier_root_digest,
    active_verifier_remains_predecessor:true,
    generation_increment_exactly_one:true,
    rollback_to_prior_generation_allowed:false,
    root_history_hash_chained:true,
    root_change_authorized:false,
    verifier_activation_authorized:false,
    trust_root_update_token:null,
    candidate_cannot_self_approve:true,
    candidate_cannot_modify_constitution:true,
    external_trust_root_controller_still_required:true,
    review_is_trust_root_authority:false,
    external_review_owner:true,
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
  return Object.freeze({...core,review_digest:dg(core)});
}

export function verifyRsiVerifierRootChangeReview(row,{proposal,predecessor_approval,secondary_approval}={}){
  const r=verifyDigestObject(row,RSI_VERIFIER_ROOT_CHANGE_REVIEW_SCHEMA,'review_digest','review');
  const canonical=createRsiVerifierRootChangeReview({
    review_id:r.review_id,proposal,predecessor_approval,secondary_approval,
    external_review_owner:true,authored_by_candidate:false,
  });
  if(canonical.review_digest!==r.review_digest){
    throw new Error('rsi_verifier_root_change_review_mismatch');
  }
  return canonical;
}

export function rsiVerifierRootChangeReviewTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.verifier-root-change-review-root.v1',version:1,
    phase22_shadow_qualification_required:true,
    current_root_generation_required:true,
    generation_increment_exactly_one:true,
    hash_chained_root_history_required:true,
    rollback_to_prior_generation_allowed:false,
    compatibility_manifest_required:true,
    compatibility_evidence_required:true,
    fixed_constitution_required:true,
    predecessor_trust_approval_required:true,
    independent_secondary_approval_required:true,
    approval_threshold:'2_OF_2',
    candidate_self_approval_allowed:false,
    active_verifier_remains_predecessor:true,
    root_change_authorized:false,
    verifier_activation_authorized:false,
    external_trust_root_controller_required:true,
    review_is_trust_root_authority:false,
    existing_runtime_ledger_is_only_root_change_review_receipt_plane:true,
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
  return Object.freeze({...root,verifier_root_change_root_digest:dg(root)});
}
