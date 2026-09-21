import crypto from 'node:crypto';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiLineageProvenanceAcceptance } from './rsi-lineage-provenance-acceptance.mjs';

export const RSI_SKILL_LINEAGE_CONTAMINATION_REVIEW_SCHEMA='metaengine.rsi.skill-lineage-contamination-review.v3';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const PREDICATE_STATES=new Set(['PASS','FAIL','UNKNOWN']);

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_lineage_contamination_${label}_sha_invalid`);return out;}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_lineage_contamination_${label}_digest_invalid`);return out;}
function boundedId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_lineage_contamination_${label}_invalid`);return out;}
function assertFalse(value,label){if(value!==false)throw new Error(`rsi_lineage_contamination_${label}_must_be_false`);}
function predicateState(value,label){
  const out=String(value||'').trim().toUpperCase();
  if(!PREDICATE_STATES.has(out))throw new Error(`rsi_lineage_contamination_${label}_predicate_invalid`);
  return out;
}
function deriveStatus(states){
  if(states.includes('FAIL'))return 'CONTAMINATED';
  if(states.includes('UNKNOWN'))return 'UNKNOWN';
  return 'CLEAN';
}

function buildLineageClosure(library,targetSkillDigest){
  const lib=verifyRsiVerifiedSkillLibrary(library);
  const target=exactDigest(targetSkillDigest,'target_skill');
  const byDigest=new Map(lib.entries.map((entry)=>[entry.skill_digest,entry]));
  if(!byDigest.has(target))throw new Error('rsi_lineage_contamination_target_not_in_library');

  const ancestors=[];
  const missingParents=[];
  const ancestorSeen=new Set([target]);
  let cursor=byDigest.get(target);
  while(cursor?.capsule?.parent_skill_digest){
    const parent=exactDigest(cursor.capsule.parent_skill_digest,'parent_skill');
    if(ancestorSeen.has(parent))throw new Error('rsi_lineage_contamination_parent_cycle');
    ancestorSeen.add(parent);
    const parentEntry=byDigest.get(parent);
    if(!parentEntry){
      missingParents.push(parent);
      break;
    }
    ancestors.push(parent);
    cursor=parentEntry;
  }

  const children=new Map();
  for(const entry of lib.entries){
    const parent=entry?.capsule?.parent_skill_digest;
    if(!parent)continue;
    const checkedParent=exactDigest(parent,'descendant_parent');
    const rows=children.get(checkedParent)||[];
    rows.push(entry.skill_digest);
    children.set(checkedParent,rows);
  }
  for(const rows of children.values())rows.sort();

  const descendants=[];
  const descendantSeen=new Set([target]);
  const queue=[target];
  while(queue.length){
    const current=queue.shift();
    for(const child of children.get(current)||[]){
      if(descendantSeen.has(child))throw new Error('rsi_lineage_contamination_descendant_cycle');
      descendantSeen.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }

  return Object.freeze({
    library:lib,
    target_skill_digest:target,
    ancestor_skill_digests:Object.freeze([...ancestors]),
    descendant_skill_digests:Object.freeze([...descendants].sort()),
    closure_skill_digests:Object.freeze([...new Set([target,...ancestors,...descendants])].sort()),
    missing_parent_skill_digests:Object.freeze([...new Set(missingParents)].sort()),
  });
}

function normalizeFinding(row,expectedSkills,effectExecutor,library){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_lineage_contamination_finding_invalid');
  if(Object.prototype.hasOwnProperty.call(row,'status'))throw new Error('rsi_lineage_contamination_candidate_status_forbidden');
  if(Object.prototype.hasOwnProperty.call(row,'provenance_integrity_state')){
    throw new Error('rsi_lineage_contamination_candidate_provenance_state_forbidden');
  }

  const skill=exactDigest(row.skill_digest,'finding_skill');
  if(!expectedSkills.has(skill))throw new Error('rsi_lineage_contamination_finding_outside_closure');

  const provenance=verifyRsiLineageProvenanceAcceptance(row.provenance_acceptance,{
    library,
    skill_digest:skill,
  });
  if(provenance.structural_attestation.effect_executor_identity_digest!==effectExecutor){
    throw new Error('rsi_lineage_contamination_provenance_effect_executor_mismatch');
  }

  const provenanceReviewer=provenance.structural_attestation.provenance_reviewer_identity_digest;
  const securityReviewer=exactDigest(row.security_reviewer_identity_digest,'security_reviewer');
  const semanticReviewer=exactDigest(row.semantic_reviewer_identity_digest,'semantic_reviewer');
  if(new Set([provenanceReviewer,securityReviewer,semanticReviewer]).size!==3){
    throw new Error('rsi_lineage_contamination_three_reviewer_separation_required');
  }
  if([provenanceReviewer,securityReviewer,semanticReviewer].includes(effectExecutor)){
    throw new Error('rsi_lineage_contamination_reviewer_effect_executor_separation_required');
  }

  const provenanceIntegrityState=predicateState(provenance.provenance_integrity_state,'provenance_integrity');
  const securityNegativeTransferState=predicateState(row.security_negative_transfer_state,'security_negative_transfer');
  const semanticConsistencyState=predicateState(row.semantic_consistency_state,'semantic_consistency');

  const evidenceDigests=[
    exactDigest(provenance.acceptance_digest,'provenance_acceptance'),
    exactDigest(row.negative_transfer_receipt_digest,'negative_transfer_receipt'),
    exactDigest(row.semantic_consistency_digest,'semantic_consistency'),
  ];
  if(new Set(evidenceDigests).size!==evidenceDigests.length){
    throw new Error('rsi_lineage_contamination_independent_predicate_evidence_required');
  }

  const status=deriveStatus([
    provenanceIntegrityState,
    securityNegativeTransferState,
    semanticConsistencyState,
  ]);

  const core={
    skill_digest:skill,
    provenance_integrity_state:provenanceIntegrityState,
    security_negative_transfer_state:securityNegativeTransferState,
    semantic_consistency_state:semanticConsistencyState,
    status,
    status_derived_from_predicates:true,
    provenance_acceptance:structuredClone(provenance),
    provenance_acceptance_digest:evidenceDigests[0],
    structural_provenance_attestation_digest:provenance.structural_attestation_digest,
    github_verification_receipt_digest:provenance.github_verification_receipt_digest,
    causal_provenance_digest:evidenceDigests[0],
    negative_transfer_receipt_digest:evidenceDigests[1],
    semantic_consistency_digest:evidenceDigests[2],
    provenance_reviewer_identity_digest:provenanceReviewer,
    security_reviewer_identity_digest:securityReviewer,
    semantic_reviewer_identity_digest:semanticReviewer,
    provenance_state_derived_from_structural_and_cryptographic_acceptance:true,
    external_provenance_reviewer:true,
    external_security_reviewer:true,
    external_semantic_reviewer:true,
    authored_by_candidate:false,
    reviewer_votes_are_not_authority:true,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    scheduler_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,finding_digest:digest(core)});
}

export function createRsiSkillLineageContaminationReview({
  review_id,
  source_sha,
  library,
  target_skill_digest,
  current_governance_digest,
  target_consumer_snapshot_digest,
  effect_executor_identity_digest,
  findings,
  external_review_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_review_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_lineage_contamination_external_review_owner_required');
  }

  const source=exactSha(source_sha,'source');
  const lineage=buildLineageClosure(library,target_skill_digest);
  const governance=exactDigest(current_governance_digest,'current_governance');
  const consumer=exactDigest(target_consumer_snapshot_digest,'target_consumer_snapshot');
  const executor=exactDigest(effect_executor_identity_digest,'effect_executor');

  if(!Array.isArray(findings)||findings.length<1||findings.length>lineage.closure_skill_digests.length){
    throw new Error('rsi_lineage_contamination_findings_invalid');
  }

  const expected=new Set(lineage.closure_skill_digests);
  const normalized=[];
  const seen=new Set();
  for(const raw of findings){
    const finding=normalizeFinding(raw,expected,executor,lineage.library);
    if(seen.has(finding.skill_digest))throw new Error('rsi_lineage_contamination_finding_duplicate');
    seen.add(finding.skill_digest);
    normalized.push(finding);
  }
  if(seen.size!==expected.size||[...expected].some((skill)=>!seen.has(skill))){
    throw new Error('rsi_lineage_contamination_exact_closure_coverage_required');
  }
  normalized.sort((a,b)=>a.skill_digest.localeCompare(b.skill_digest));

  const blockers=[];
  if(lineage.missing_parent_skill_digests.length>0)blockers.push('LINEAGE_PARENT_MISSING_FROM_CURRENT_LIBRARY');
  if(normalized.some((row)=>row.status==='CONTAMINATED'))blockers.push('LINEAGE_CONTAMINATION_DETECTED');
  if(normalized.some((row)=>row.status==='UNKNOWN'))blockers.push('LINEAGE_CONTAMINATION_UNKNOWN');

  const eligible=blockers.length===0;
  const core={
    schema:RSI_SKILL_LINEAGE_CONTAMINATION_REVIEW_SCHEMA,
    version:3,
    review_id:boundedId(review_id,'review_id'),
    source_sha:source,
    library_digest:lineage.library.library_digest,
    target_skill_digest:lineage.target_skill_digest,
    current_governance_digest:governance,
    target_consumer_snapshot_digest:consumer,
    effect_executor_identity_digest:executor,
    ancestor_skill_digests:lineage.ancestor_skill_digests,
    descendant_skill_digests:lineage.descendant_skill_digests,
    closure_skill_digests:lineage.closure_skill_digests,
    missing_parent_skill_digests:lineage.missing_parent_skill_digests,
    findings:Object.freeze(normalized),
    finding_count:normalized.length,
    all_current_lineage_nodes_reviewed:true,
    ancestor_and_descendant_scan_required:true,
    three_heterogeneous_reviewers_per_skill_required:true,
    structural_behavioral_semantic_critic_separation_required:true,
    deterministic_predicate_status_derivation_required:true,
    structural_and_cryptographic_provenance_acceptance_required:true,
    missing_cryptographic_provenance_blocks_clean:true,
    candidate_supplied_provenance_state_allowed:false,
    candidate_supplied_status_allowed:false,
    reviewer_votes_are_not_authority:true,
    independent_predicate_evidence_required:true,
    state:eligible?'CLEAR_FOR_ZERO_EFFECT_EXPOSURE_PRECOMMIT':'BLOCKED_LINEAGE_CONTAMINATION_OR_INCOMPLETE',
    blockers:Object.freeze(blockers),
    eligible_for_exposure_precommit:eligible,
    review_is_effect_authority:false,
    review_can_release_exposure_hold:false,
    review_can_activate_skill:false,
    review_can_mutate_library:false,
    external_review_owner:true,
    authored_by_candidate:false,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    scheduler_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,review_digest:digest(core)});
}

export function verifyRsiSkillLineageContaminationReview(row,{
  source_sha,
  library,
  target_skill_digest,
  current_governance_digest,
  effect_executor_identity_digest,
}={}){
  if(!row||row.schema!==RSI_SKILL_LINEAGE_CONTAMINATION_REVIEW_SCHEMA||row.version!==3){
    throw new Error('rsi_lineage_contamination_review_required');
  }
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','automatic_retry_allowed','authority_effect']){
    assertFalse(row[field],field);
  }
  if(row.deterministic_predicate_status_derivation_required!==true
    ||row.structural_and_cryptographic_provenance_acceptance_required!==true
    ||row.missing_cryptographic_provenance_blocks_clean!==true
    ||row.candidate_supplied_provenance_state_allowed!==false
    ||row.candidate_supplied_status_allowed!==false
    ||row.reviewer_votes_are_not_authority!==true
    ||row.independent_predicate_evidence_required!==true){
    throw new Error('rsi_lineage_contamination_review_policy_invalid');
  }

  const canonical=createRsiSkillLineageContaminationReview({
    review_id:row.review_id,
    source_sha,
    library,
    target_skill_digest,
    current_governance_digest,
    target_consumer_snapshot_digest:row.target_consumer_snapshot_digest,
    effect_executor_identity_digest,
    findings:row.findings.map((finding)=>({
      skill_digest:finding.skill_digest,
      provenance_acceptance:finding.provenance_acceptance,
      security_negative_transfer_state:finding.security_negative_transfer_state,
      semantic_consistency_state:finding.semantic_consistency_state,
      negative_transfer_receipt_digest:finding.negative_transfer_receipt_digest,
      semantic_consistency_digest:finding.semantic_consistency_digest,
      security_reviewer_identity_digest:finding.security_reviewer_identity_digest,
      semantic_reviewer_identity_digest:finding.semantic_reviewer_identity_digest,
    })),
    external_review_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.review_digest!==exactDigest(row.review_digest,'review')){
    throw new Error('rsi_lineage_contamination_review_digest_mismatch');
  }
  return canonical;
}

export function rsiSkillLineageContaminationReviewTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.skill-lineage-contamination-review-root.v3',
    version:3,
    policy_path:'apps/metaengine-browser/src/rsi-skill-lineage-contamination-review.mjs',
    existing_verified_library_reused:true,
    second_lineage_graph_allowed:false,
    current_library_digest_required:true,
    exact_target_skill_required:true,
    current_governance_digest_required:true,
    target_consumer_snapshot_required:true,
    ancestors_and_descendants_derived_from_parent_skill_digest:true,
    missing_parent_blocks_exposure_precommit:true,
    exact_lineage_closure_finding_coverage_required:true,
    contaminated_or_unknown_lineage_blocks_exposure_precommit:true,
    three_heterogeneous_reviewers_per_skill_required:true,
    structural_behavioral_semantic_critic_separation_required:true,
    reviewer_effect_executor_separation_required:true,
    deterministic_predicate_status_derivation_required:true,
    structural_and_cryptographic_provenance_acceptance_required:true,
    missing_cryptographic_provenance_blocks_clean:true,
    candidate_supplied_provenance_state_allowed:false,
    candidate_supplied_status_allowed:false,
    reviewer_votes_are_not_authority:true,
    independent_predicate_evidence_required:true,
    candidate_can_author_review:false,
    review_is_effect_authority:false,
    review_can_release_exposure_hold:false,
    review_can_activate_skill:false,
    browser_authority:false,
    task_authority:false,
    scheduler_authority:false,
    execution_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,root_digest:digest(root)});
}
