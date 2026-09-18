import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_GENERATION_SCOPED_OUTCOME_ENTRY_SCHEMA,
  verifyRsiGenerationScopedOutcomeEntry,
} from './rsi-generation-scoped-outcome-frontier.mjs';

export const RSI_KNOWLEDGE_CONSOLIDATION_PROPOSAL_SCHEMA='metaengine.rsi.knowledge-consolidation-proposal.v1';
export const RSI_KNOWLEDGE_TRANSFER_VALIDATION_SCHEMA='metaengine.rsi.knowledge-transfer-validation.v1';
export const RSI_KNOWLEDGE_CONSOLIDATION_ADMISSION_SCHEMA='metaengine.rsi.knowledge-consolidation-admission.v1';
export const RSI_KNOWLEDGE_CONSOLIDATION_ARCHIVE_SCHEMA='metaengine.rsi.knowledge-consolidation-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TAG_RE=/^[A-Z0-9][A-Z0-9_.:-]{1,63}$/;
const MAX_SOURCE_ROWS=16;
const MAX_ARCHIVE_ROWS=1024;

const KNOWLEDGE_CLASSES=new Set([
  'REUSABLE_RECIPE_CANDIDATE',
  'NEGATIVE_CONSTRAINT',
  'LOW_YIELD_CONSTRAINT',
  'ENVIRONMENT_DIAGNOSTIC',
  'AMBIGUITY_DIAGNOSTIC',
]);

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_consolidation_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_consolidation_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_consolidation_${l}_invalid`);return x;}
function positiveInt(v,l,max=1_000_000){const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`rsi_consolidation_${l}_invalid`);return n;}
function tags(v,l){
  if(!Array.isArray(v)||v.length<1||v.length>16)throw new Error(`rsi_consolidation_${l}_invalid`);
  const out=[...new Set(v.map(x=>String(x||'').trim().toUpperCase()))].sort();
  if(out.length!==v.length||out.some(x=>!SAFE_TAG_RE.test(x)))throw new Error(`rsi_consolidation_${l}_invalid`);
  return Object.freeze(out);
}
function assertZero(v,l){
  for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_consolidation_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_consolidation_${l}_retry_invalid`);
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,browser_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  });
}

function verifySourceRow(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_consolidation_source_row_invalid');
  const entry=row.entry;
  if(!entry||entry.schema!==RSI_GENERATION_SCOPED_OUTCOME_ENTRY_SCHEMA)throw new Error('rsi_consolidation_source_entry_invalid');
  const canonical=verifyRsiGenerationScopedOutcomeEntry(entry,{
    handoff_row:row.handoff_row,
    experiment_intent:row.experiment_intent,
    experiment_receipt:row.experiment_receipt,
  });
  return Object.freeze({
    entry:canonical,
    handoff_row:row.handoff_row,
    experiment_intent:row.experiment_intent,
    experiment_receipt:row.experiment_receipt,
  });
}

function normalizeSourceRows(rows){
  if(!Array.isArray(rows)||rows.length<2||rows.length>MAX_SOURCE_ROWS)throw new Error('rsi_consolidation_source_rows_invalid');
  const checked=rows.map(verifySourceRow);
  const sourceSha=checked[0].entry.source_sha;
  const evaluatorRoot=exactDigest(checked[0].entry.evaluator_root_digest,'evaluator_root');
  const generation=checked[0].entry.evaluator_generation_digest;
  const generationSeq=positiveInt(checked[0].entry.evaluator_generation_seq,'generation_seq');
  const generationAnchor=exactDigest(checked[0].entry.evaluator_generation_history_anchor_digest,'generation_history_anchor');
  const epoch=checked[0].entry.evaluation_epoch_digest;
  const epochSeq=positiveInt(checked[0].entry.evaluation_epoch_seq,'epoch_seq');
  const evaluationContract=exactDigest(checked[0].entry.evaluation_contract_digest,'evaluation_contract');
  const kind=checked[0].entry.learning_kind;
  if(!KNOWLEDGE_CLASSES.has(kind))throw new Error('rsi_consolidation_knowledge_class_invalid');
  const ids=new Set(), receipts=new Set(), candidates=new Set(), provenanceRoots=new Set();
  const sealedAcceptance=new Set(), differentialReferences=new Set(), counterevidence=new Set(), failureAttributions=new Set();
  for(const row of checked){
    const e=row.entry;
    if(e.source_sha!==sourceSha)throw new Error('rsi_consolidation_source_sha_mismatch');
    if(e.evaluator_root_digest!==evaluatorRoot)throw new Error('rsi_consolidation_evaluator_root_mismatch');
    if(e.evaluator_generation_digest!==generation||e.evaluator_generation_seq!==generationSeq)throw new Error('rsi_consolidation_cross_generation_forbidden');
    if(e.evaluator_generation_history_anchor_digest!==generationAnchor)throw new Error('rsi_consolidation_generation_history_anchor_mismatch');
    if(e.evaluation_epoch_digest!==epoch||e.evaluation_epoch_seq!==epochSeq)throw new Error('rsi_consolidation_cross_epoch_forbidden');
    if(e.evaluation_contract_digest!==evaluationContract)throw new Error('rsi_consolidation_cross_evaluation_contract_forbidden');
    if(e.learning_kind!==kind)throw new Error('rsi_consolidation_mixed_learning_kind_forbidden');
    if(ids.has(e.entry_digest)||receipts.has(e.experiment_receipt_digest))throw new Error('rsi_consolidation_duplicate_source_evidence');
    ids.add(e.entry_digest);receipts.add(e.experiment_receipt_digest);candidates.add(e.candidate_artifact_digest);
    provenanceRoots.add(exactDigest(e.provenance_root_digest,'source_provenance_root'));
    counterevidence.add(exactDigest(e.counterevidence_digest,'source_counterevidence'));
    if(e.sealed_exogenous_acceptance_digest)sealedAcceptance.add(exactDigest(e.sealed_exogenous_acceptance_digest,'source_sealed_acceptance'));
    if(e.differential_reference_digest)differentialReferences.add(exactDigest(e.differential_reference_digest,'source_differential_reference'));
    if(e.failure_attribution_digest)failureAttributions.add(exactDigest(e.failure_attribution_digest,'source_failure_attribution'));
  }
  if(candidates.size<2)throw new Error('rsi_consolidation_source_diversity_required');
  return Object.freeze({
    rows:Object.freeze(checked),
    source_sha:sourceSha,
    evaluator_root_digest:evaluatorRoot,
    evaluator_generation_digest:generation,
    evaluator_generation_seq:generationSeq,
    evaluator_generation_history_anchor_digest:generationAnchor,
    evaluation_epoch_digest:epoch,
    evaluation_epoch_seq:epochSeq,
    evaluation_contract_digest:evaluationContract,
    knowledge_class:kind,
    source_entry_digests:Object.freeze([...ids].sort()),
    source_receipt_digests:Object.freeze([...receipts].sort()),
    source_candidate_digests:Object.freeze([...candidates].sort()),
    source_provenance_root_digests:Object.freeze([...provenanceRoots].sort()),
    source_sealed_acceptance_digests:Object.freeze([...sealedAcceptance].sort()),
    source_differential_reference_digests:Object.freeze([...differentialReferences].sort()),
    source_counterevidence_digests:Object.freeze([...counterevidence].sort()),
    source_failure_attribution_digests:Object.freeze([...failureAttributions].sort()),
  });
}

export function createRsiKnowledgeConsolidationProposal({
  proposal_id,
  source_rows,
  consolidation_tags,
  consolidated_knowledge_digest,
  applicability_contract_digest,
  watch_out_digest,
  falsification_protocol_digest,
  transfer_validation_plan_digest,
  external_consolidator=false,
  external_scope_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_consolidator!==true||external_scope_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_consolidation_external_ownership_required');
  }
  const source=normalizeSourceRows(source_rows);
  const roots=[
    exactDigest(consolidated_knowledge_digest,'knowledge'),
    exactDigest(applicability_contract_digest,'applicability'),
    exactDigest(watch_out_digest,'watch_out'),
    exactDigest(falsification_protocol_digest,'falsification'),
    exactDigest(transfer_validation_plan_digest,'transfer_plan'),
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_consolidation_independent_roots_required');
  const core=zero({
    schema:RSI_KNOWLEDGE_CONSOLIDATION_PROPOSAL_SCHEMA,
    version:1,
    proposal_id:id(proposal_id,'proposal_id'),
    source_sha:exactSha(source.source_sha,'source'),
    evaluator_root_digest:source.evaluator_root_digest,
    evaluator_generation_digest:source.evaluator_generation_digest,
    evaluator_generation_seq:source.evaluator_generation_seq,
    evaluator_generation_history_anchor_digest:source.evaluator_generation_history_anchor_digest,
    evaluation_epoch_digest:source.evaluation_epoch_digest,
    evaluation_epoch_seq:source.evaluation_epoch_seq,
    evaluation_contract_digest:source.evaluation_contract_digest,
    knowledge_class:source.knowledge_class,
    source_entry_digests:source.source_entry_digests,
    source_experiment_receipt_digests:source.source_receipt_digests,
    source_candidate_artifact_digests:source.source_candidate_digests,
    source_provenance_root_digests:source.source_provenance_root_digests,
    source_sealed_acceptance_digests:source.source_sealed_acceptance_digests,
    source_differential_reference_digests:source.source_differential_reference_digests,
    source_counterevidence_digests:source.source_counterevidence_digests,
    source_failure_attribution_digests:source.source_failure_attribution_digests,
    source_entry_count:source.source_entry_digests.length,
    source_candidate_count:source.source_candidate_digests.length,
    consolidation_tags:tags(consolidation_tags,'tags'),
    consolidated_knowledge_digest:roots[0],
    applicability_contract_digest:roots[1],
    watch_out_digest:roots[2],
    falsification_protocol_digest:roots[3],
    transfer_validation_plan_digest:roots[4],
    external_consolidator:true,
    external_scope_owner:true,
    authored_by_candidate:false,
    same_evaluator_root_required:true,
    same_evaluator_generation_required:true,
    same_evaluator_generation_sequence_required:true,
    generation_history_anchor_required:true,
    same_evaluation_epoch_required:true,
    same_evaluation_epoch_sequence_required:true,
    same_evaluation_contract_required:true,
    cross_contract_consolidation_allowed:false,
    cross_generation_consolidation_allowed:false,
    cross_generation_revalidation_required_before_new_proposal:true,
    source_diversity_required:true,
    source_evidence_preserved_by_digest:true,
    source_provenance_roots_preserved:true,
    source_external_acceptance_evidence_preserved:true,
    source_counterevidence_preserved:true,
    source_failure_attribution_preserved:true,
    slow_loop_distinct_from_fast_candidate_loop:true,
    raw_source_trajectory_copied:false,
    raw_hidden_holdout_copied:false,
    raw_evaluator_assets_copied:false,
    proposal_can_write_skill_library:false,
    proposal_can_write_experience_graph:false,
    proposal_can_modify_meta_skill_profile:false,
    proposal_can_schedule_transfer_validation:false,
    proposal_can_activate_knowledge:false,
    external_transfer_validation_required:true,
  });
  return Object.freeze({...core,proposal_digest:digest(core)});
}

export function verifyRsiKnowledgeConsolidationProposal(proposal,{source_rows}={}){
  if(!proposal||proposal.schema!==RSI_KNOWLEDGE_CONSOLIDATION_PROPOSAL_SCHEMA||proposal.version!==1)throw new Error('rsi_consolidation_proposal_invalid');
  assertZero(proposal,'proposal');
  if(proposal.external_consolidator!==true||proposal.external_scope_owner!==true||proposal.authored_by_candidate!==false
    ||proposal.same_evaluator_root_required!==true
    ||proposal.same_evaluator_generation_required!==true||proposal.same_evaluator_generation_sequence_required!==true
    ||proposal.generation_history_anchor_required!==true||proposal.same_evaluation_epoch_required!==true
    ||proposal.same_evaluation_epoch_sequence_required!==true||proposal.same_evaluation_contract_required!==true
    ||proposal.cross_contract_consolidation_allowed!==false||proposal.cross_generation_consolidation_allowed!==false
    ||proposal.cross_generation_revalidation_required_before_new_proposal!==true
    ||proposal.source_diversity_required!==true||proposal.source_evidence_preserved_by_digest!==true
    ||proposal.source_provenance_roots_preserved!==true||proposal.source_external_acceptance_evidence_preserved!==true
    ||proposal.source_counterevidence_preserved!==true||proposal.source_failure_attribution_preserved!==true
    ||proposal.slow_loop_distinct_from_fast_candidate_loop!==true
    ||proposal.raw_source_trajectory_copied!==false||proposal.raw_hidden_holdout_copied!==false
    ||proposal.raw_evaluator_assets_copied!==false||proposal.proposal_can_write_skill_library!==false
    ||proposal.proposal_can_write_experience_graph!==false||proposal.proposal_can_modify_meta_skill_profile!==false
    ||proposal.proposal_can_schedule_transfer_validation!==false||proposal.proposal_can_activate_knowledge!==false
    ||proposal.external_transfer_validation_required!==true)throw new Error('rsi_consolidation_proposal_policy_invalid');
  const canonical=createRsiKnowledgeConsolidationProposal({
    proposal_id:proposal.proposal_id,
    source_rows,
    consolidation_tags:proposal.consolidation_tags,
    consolidated_knowledge_digest:proposal.consolidated_knowledge_digest,
    applicability_contract_digest:proposal.applicability_contract_digest,
    watch_out_digest:proposal.watch_out_digest,
    falsification_protocol_digest:proposal.falsification_protocol_digest,
    transfer_validation_plan_digest:proposal.transfer_validation_plan_digest,
    external_consolidator:true,external_scope_owner:true,authored_by_candidate:false,
  });
  if(canonical.proposal_digest!==exactDigest(proposal.proposal_digest,'proposal'))throw new Error('rsi_consolidation_proposal_digest_mismatch');
  return canonical;
}

function goalPass(knowledgeClass,receipt){
  if(knowledgeClass==='REUSABLE_RECIPE_CANDIDATE')return receipt.strict_transfer_improvement===true;
  if(knowledgeClass==='NEGATIVE_CONSTRAINT'||knowledgeClass==='LOW_YIELD_CONSTRAINT')return receipt.constraint_prediction_confirmed===true;
  if(knowledgeClass==='ENVIRONMENT_DIAGNOSTIC'||knowledgeClass==='AMBIGUITY_DIAGNOSTIC')return receipt.diagnostic_discrimination_pass===true;
  return false;
}

export function createRsiKnowledgeTransferValidation({
  validation_id,
  proposal,
  heldout_context_digest,
  heldout_task_set_digest,
  task_family_digest,
  transfer_harness_digest,
  acceptance_policy_digest,
  hidden_holdout_root_digest,
  external_evaluator_root_digest,
  external_evaluator_generation_digest,
  matched_reference_plan_digest,
  sealed_transfer_acceptance_digest,
  control_receipt_digest,
  treatment_receipt_digest,
  transfer_evidence_digest,
  source_context_exclusion_pass,
  hidden_holdout_pass,
  evaluator_integrity_pass,
  contamination_clear,
  from_scratch_replay_pass,
  matched_reference_integrity_pass,
  sealed_transfer_acceptance_pass,
  task_non_regression,
  safety_non_regression,
  security_non_regression,
  process_non_regression,
  outcome_non_regression,
  efficiency_non_regression,
  strict_transfer_improvement=false,
  constraint_prediction_confirmed=false,
  diagnostic_discrimination_pass=false,
  external_transfer_validator=false,
  external_holdout_owner=false,
  external_reference_owner=false,
  external_acceptance_owner=false,
  authored_by_candidate=true,
}={}){
  if(!proposal||proposal.schema!==RSI_KNOWLEDGE_CONSOLIDATION_PROPOSAL_SCHEMA)throw new Error('rsi_consolidation_proposal_invalid');
  assertZero(proposal,'validation_proposal');
  const pc=structuredClone(proposal);delete pc.proposal_digest;
  if(digest(pc)!==exactDigest(proposal.proposal_digest,'validation_proposal'))throw new Error('rsi_consolidation_proposal_digest_mismatch');
  if(external_transfer_validator!==true||external_holdout_owner!==true
    ||external_reference_owner!==true||external_acceptance_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_consolidation_external_transfer_validation_required');
  }
  const roots=[
    exactDigest(heldout_context_digest,'heldout_context'),
    exactDigest(heldout_task_set_digest,'heldout_tasks'),
    exactDigest(task_family_digest,'task_family'),
    exactDigest(transfer_harness_digest,'transfer_harness'),
    exactDigest(acceptance_policy_digest,'acceptance_policy'),
    exactDigest(hidden_holdout_root_digest,'hidden_holdout_root'),
    exactDigest(external_evaluator_root_digest,'external_evaluator'),
    exactDigest(external_evaluator_generation_digest,'external_evaluator_generation'),
    exactDigest(matched_reference_plan_digest,'matched_reference_plan'),
    exactDigest(sealed_transfer_acceptance_digest,'sealed_transfer_acceptance'),
    exactDigest(control_receipt_digest,'control_receipt'),
    exactDigest(treatment_receipt_digest,'treatment_receipt'),
    exactDigest(transfer_evidence_digest,'transfer_evidence'),
    proposal.consolidated_knowledge_digest,
    proposal.transfer_validation_plan_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_consolidation_transfer_roots_must_be_independent');
  const blockers=[];
  if(source_context_exclusion_pass!==true)blockers.push('SOURCE_CONTEXT_OVERLAP');
  if(hidden_holdout_pass!==true)blockers.push('HIDDEN_HOLDOUT_FAILURE');
  if(evaluator_integrity_pass!==true)blockers.push('EVALUATOR_INTEGRITY_FAILURE');
  if(contamination_clear!==true)blockers.push('CONTAMINATION_DETECTED');
  if(from_scratch_replay_pass!==true)blockers.push('FROM_SCRATCH_REPLAY_FAILURE');
  if(matched_reference_integrity_pass!==true)blockers.push('MATCHED_REFERENCE_INTEGRITY_FAILURE');
  if(sealed_transfer_acceptance_pass!==true)blockers.push('SEALED_TRANSFER_ACCEPTANCE_FAILURE');
  if(task_non_regression!==true)blockers.push('TASK_REGRESSION');
  if(safety_non_regression!==true)blockers.push('SAFETY_REGRESSION');
  if(security_non_regression!==true)blockers.push('SECURITY_REGRESSION');
  if(process_non_regression!==true)blockers.push('PROCESS_REGRESSION');
  if(outcome_non_regression!==true)blockers.push('OUTCOME_REGRESSION');
  if(efficiency_non_regression!==true)blockers.push('EFFICIENCY_REGRESSION');
  const goalReceipt={
    strict_transfer_improvement:strict_transfer_improvement===true,
    constraint_prediction_confirmed:constraint_prediction_confirmed===true,
    diagnostic_discrimination_pass:diagnostic_discrimination_pass===true,
  };
  if(!goalPass(proposal.knowledge_class,goalReceipt))blockers.push('KNOWLEDGE_CLASS_TRANSFER_GOAL_NOT_MET');
  const pass=blockers.length===0;
  const core=zero({
    schema:RSI_KNOWLEDGE_TRANSFER_VALIDATION_SCHEMA,
    version:1,
    validation_id:id(validation_id,'validation_id'),
    source_sha:proposal.source_sha,
    proposal_digest:proposal.proposal_digest,
    evaluator_root_digest:proposal.evaluator_root_digest,
    evaluator_root_digest:proposal.evaluator_root_digest,
    evaluator_generation_digest:proposal.evaluator_generation_digest,
    evaluator_generation_seq:proposal.evaluator_generation_seq,
    evaluator_generation_history_anchor_digest:proposal.evaluator_generation_history_anchor_digest,
    source_evaluation_epoch_digest:proposal.evaluation_epoch_digest,
    source_evaluation_epoch_seq:proposal.evaluation_epoch_seq,
    source_evaluation_contract_digest:proposal.evaluation_contract_digest,
    knowledge_class:proposal.knowledge_class,
    heldout_context_digest:roots[0],
    heldout_task_set_digest:roots[1],
    task_family_digest:roots[2],
    transfer_harness_digest:roots[3],
    acceptance_policy_digest:roots[4],
    hidden_holdout_root_digest:roots[5],
    external_evaluator_root_digest:roots[6],
    external_evaluator_generation_digest:roots[7],
    matched_reference_plan_digest:roots[8],
    sealed_transfer_acceptance_digest:roots[9],
    control_receipt_digest:roots[10],
    treatment_receipt_digest:roots[11],
    transfer_evidence_digest:roots[12],
    source_context_exclusion_pass:source_context_exclusion_pass===true,
    hidden_holdout_pass:hidden_holdout_pass===true,
    evaluator_integrity_pass:evaluator_integrity_pass===true,
    contamination_clear:contamination_clear===true,
    from_scratch_replay_pass:from_scratch_replay_pass===true,
    matched_reference_integrity_pass:matched_reference_integrity_pass===true,
    sealed_transfer_acceptance_pass:sealed_transfer_acceptance_pass===true,
    task_non_regression:task_non_regression===true,
    safety_non_regression:safety_non_regression===true,
    security_non_regression:security_non_regression===true,
    process_non_regression:process_non_regression===true,
    outcome_non_regression:outcome_non_regression===true,
    efficiency_non_regression:efficiency_non_regression===true,
    strict_transfer_improvement:goalReceipt.strict_transfer_improvement,
    constraint_prediction_confirmed:goalReceipt.constraint_prediction_confirmed,
    diagnostic_discrimination_pass:goalReceipt.diagnostic_discrimination_pass,
    blockers:Object.freeze(blockers.sort()),
    state:pass?'TRANSFER_VALIDATED_ADVISORY_KNOWLEDGE':'KNOWLEDGE_TRANSFER_REJECTED',
    eligible_for_advisory_knowledge_archive:pass,
    external_transfer_validator:true,
    external_holdout_owner:true,
    external_reference_owner:true,
    external_acceptance_owner:true,
    authored_by_candidate:false,
    candidate_can_choose_holdout:false,
    candidate_can_view_hidden_holdout:false,
    candidate_can_choose_task_family:false,
    candidate_can_choose_transfer_harness:false,
    candidate_can_choose_acceptance_policy:false,
    candidate_can_choose_evaluator:false,
    candidate_can_choose_reference:false,
    candidate_can_view_sealed_transfer_acceptance:false,
    validation_can_write_skill_library:false,
    validation_can_write_experience_graph:false,
    validation_can_modify_meta_skill_profile:false,
    validation_can_activate_knowledge:false,
    validation_can_schedule_work:false,
  });
  return Object.freeze({...core,validation_digest:digest(core)});
}

export function verifyRsiKnowledgeTransferValidation(validation,{proposal}={}){
  if(!validation||validation.schema!==RSI_KNOWLEDGE_TRANSFER_VALIDATION_SCHEMA||validation.version!==1)throw new Error('rsi_consolidation_validation_invalid');
  assertZero(validation,'validation');
  if(validation.external_transfer_validator!==true||validation.external_holdout_owner!==true
    ||validation.external_reference_owner!==true||validation.external_acceptance_owner!==true||validation.authored_by_candidate!==false
    ||validation.candidate_can_choose_holdout!==false||validation.candidate_can_view_hidden_holdout!==false
    ||validation.candidate_can_choose_task_family!==false||validation.candidate_can_choose_transfer_harness!==false
    ||validation.candidate_can_choose_acceptance_policy!==false||validation.candidate_can_choose_evaluator!==false
    ||validation.candidate_can_choose_reference!==false||validation.candidate_can_view_sealed_transfer_acceptance!==false
    ||validation.validation_can_write_skill_library!==false||validation.validation_can_write_experience_graph!==false
    ||validation.validation_can_modify_meta_skill_profile!==false||validation.validation_can_activate_knowledge!==false
    ||validation.validation_can_schedule_work!==false)throw new Error('rsi_consolidation_validation_policy_invalid');
  const canonical=createRsiKnowledgeTransferValidation({
    validation_id:validation.validation_id,proposal,
    heldout_context_digest:validation.heldout_context_digest,
    heldout_task_set_digest:validation.heldout_task_set_digest,
    task_family_digest:validation.task_family_digest,
    transfer_harness_digest:validation.transfer_harness_digest,
    acceptance_policy_digest:validation.acceptance_policy_digest,
    hidden_holdout_root_digest:validation.hidden_holdout_root_digest,
    external_evaluator_root_digest:validation.external_evaluator_root_digest,
    external_evaluator_generation_digest:validation.external_evaluator_generation_digest,
    matched_reference_plan_digest:validation.matched_reference_plan_digest,
    sealed_transfer_acceptance_digest:validation.sealed_transfer_acceptance_digest,
    control_receipt_digest:validation.control_receipt_digest,
    treatment_receipt_digest:validation.treatment_receipt_digest,
    transfer_evidence_digest:validation.transfer_evidence_digest,
    source_context_exclusion_pass:validation.source_context_exclusion_pass,
    hidden_holdout_pass:validation.hidden_holdout_pass,
    evaluator_integrity_pass:validation.evaluator_integrity_pass,
    contamination_clear:validation.contamination_clear,
    from_scratch_replay_pass:validation.from_scratch_replay_pass,
    matched_reference_integrity_pass:validation.matched_reference_integrity_pass,
    sealed_transfer_acceptance_pass:validation.sealed_transfer_acceptance_pass,
    task_non_regression:validation.task_non_regression,
    safety_non_regression:validation.safety_non_regression,
    security_non_regression:validation.security_non_regression,
    process_non_regression:validation.process_non_regression,
    outcome_non_regression:validation.outcome_non_regression,
    efficiency_non_regression:validation.efficiency_non_regression,
    strict_transfer_improvement:validation.strict_transfer_improvement,
    constraint_prediction_confirmed:validation.constraint_prediction_confirmed,
    diagnostic_discrimination_pass:validation.diagnostic_discrimination_pass,
    external_transfer_validator:true,external_holdout_owner:true,
    external_reference_owner:true,external_acceptance_owner:true,authored_by_candidate:false,
  });
  if(canonical.validation_digest!==exactDigest(validation.validation_digest,'validation'))throw new Error('rsi_consolidation_validation_digest_mismatch');
  return canonical;
}

export function createRsiKnowledgeConsolidationAdmission({
  admission_id,
  proposal,
  validations,
  external_admission_owner=false,
  authored_by_candidate=true,
}={}){
  if(!proposal||proposal.schema!==RSI_KNOWLEDGE_CONSOLIDATION_PROPOSAL_SCHEMA)throw new Error('rsi_consolidation_proposal_invalid');
  assertZero(proposal,'admission_proposal');
  const pc=structuredClone(proposal);delete pc.proposal_digest;
  if(digest(pc)!==exactDigest(proposal.proposal_digest,'admission_proposal'))throw new Error('rsi_consolidation_proposal_digest_mismatch');
  if(external_admission_owner!==true||authored_by_candidate!==false)throw new Error('rsi_consolidation_external_admission_owner_required');
  if(!Array.isArray(validations)||validations.length<2||validations.length>8)throw new Error('rsi_consolidation_transfer_validation_quorum_invalid');
  const checked=validations.map(v=>verifyRsiKnowledgeTransferValidation(v,{proposal}));
  const contexts=new Set(), tasks=new Set(), families=new Set(), harnesses=new Set();
  const referencePlans=new Set(), sealedAcceptances=new Set(), controls=new Set(), treatments=new Set(), transferEvidence=new Set();
  for(const v of checked){
    if(v.state!=='TRANSFER_VALIDATED_ADVISORY_KNOWLEDGE'||v.eligible_for_advisory_knowledge_archive!==true){
      throw new Error('rsi_consolidation_only_passed_transfer_validations_admissible');
    }
    if(contexts.has(v.heldout_context_digest))throw new Error('rsi_consolidation_distinct_target_contexts_required');
    if(referencePlans.has(v.matched_reference_plan_digest)||sealedAcceptances.has(v.sealed_transfer_acceptance_digest)
      ||controls.has(v.control_receipt_digest)||treatments.has(v.treatment_receipt_digest)||transferEvidence.has(v.transfer_evidence_digest)){
      throw new Error('rsi_consolidation_transfer_evidence_reuse_forbidden');
    }
    contexts.add(v.heldout_context_digest);tasks.add(v.heldout_task_set_digest);families.add(v.task_family_digest);harnesses.add(v.transfer_harness_digest);
    referencePlans.add(v.matched_reference_plan_digest);sealedAcceptances.add(v.sealed_transfer_acceptance_digest);
    controls.add(v.control_receipt_digest);treatments.add(v.treatment_receipt_digest);transferEvidence.add(v.transfer_evidence_digest);
  }
  if(contexts.size<2||tasks.size<2||families.size<2||referencePlans.size<2||sealedAcceptances.size<2){
    throw new Error('rsi_consolidation_transfer_diversity_required');
  }
  const core=zero({
    schema:RSI_KNOWLEDGE_CONSOLIDATION_ADMISSION_SCHEMA,
    version:1,
    admission_id:id(admission_id,'admission_id'),
    source_sha:proposal.source_sha,
    proposal_digest:proposal.proposal_digest,
    evaluator_generation_digest:proposal.evaluator_generation_digest,
    evaluator_generation_seq:proposal.evaluator_generation_seq,
    evaluator_generation_history_anchor_digest:proposal.evaluator_generation_history_anchor_digest,
    evaluation_epoch_digest:proposal.evaluation_epoch_digest,
    evaluation_epoch_seq:proposal.evaluation_epoch_seq,
    evaluation_contract_digest:proposal.evaluation_contract_digest,
    knowledge_class:proposal.knowledge_class,
    validation_digests:Object.freeze(checked.map(v=>v.validation_digest).sort()),
    target_context_digests:Object.freeze([...contexts].sort()),
    heldout_task_set_digests:Object.freeze([...tasks].sort()),
    task_family_digests:Object.freeze([...families].sort()),
    transfer_harness_digests:Object.freeze([...harnesses].sort()),
    matched_reference_plan_digests:Object.freeze([...referencePlans].sort()),
    sealed_transfer_acceptance_digests:Object.freeze([...sealedAcceptances].sort()),
    passed_transfer_context_count:contexts.size,
    all_transfer_validations_passed:true,
    matched_reference_quorum_satisfied:true,
    sealed_transfer_acceptance_quorum_satisfied:true,
    zero_observed_negative_transfer:true,
    external_admission_owner:true,
    authored_by_candidate:false,
    state:'ELIGIBLE_FOR_LIBRARY_ADMISSION_REVIEW',
    eligible_for_library_admission_review:true,
    library_admission_token:null,
    admission_can_write_skill_library:false,
    admission_can_write_experience_graph:false,
    admission_can_modify_meta_skill_profile:false,
    admission_can_activate_knowledge:false,
    admission_can_schedule_work:false,
  });
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiKnowledgeConsolidationAdmission(admission,{proposal,validations}={}){
  if(!admission||admission.schema!==RSI_KNOWLEDGE_CONSOLIDATION_ADMISSION_SCHEMA||admission.version!==1)throw new Error('rsi_consolidation_admission_invalid');
  assertZero(admission,'admission');
  if(admission.external_admission_owner!==true||admission.authored_by_candidate!==false
    ||admission.all_transfer_validations_passed!==true||admission.matched_reference_quorum_satisfied!==true
    ||admission.sealed_transfer_acceptance_quorum_satisfied!==true||admission.zero_observed_negative_transfer!==true
    ||admission.eligible_for_library_admission_review!==true||admission.library_admission_token!==null
    ||admission.admission_can_write_skill_library!==false||admission.admission_can_write_experience_graph!==false
    ||admission.admission_can_modify_meta_skill_profile!==false||admission.admission_can_activate_knowledge!==false
    ||admission.admission_can_schedule_work!==false||admission.state!=='ELIGIBLE_FOR_LIBRARY_ADMISSION_REVIEW'){
    throw new Error('rsi_consolidation_admission_policy_invalid');
  }
  const canonical=createRsiKnowledgeConsolidationAdmission({
    admission_id:admission.admission_id,proposal,validations,
    external_admission_owner:true,authored_by_candidate:false,
  });
  if(canonical.admission_digest!==exactDigest(admission.admission_digest,'admission'))throw new Error('rsi_consolidation_admission_digest_mismatch');
  return canonical;
}

function archiveState(sourceSha,rows){
  const counts={};
  for(const row of rows)counts[row.proposal.knowledge_class]=(counts[row.proposal.knowledge_class]||0)+1;
  const core=zero({
    schema:RSI_KNOWLEDGE_CONSOLIDATION_ARCHIVE_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    validated_count:rows.filter(r=>r.admission.eligible_for_library_admission_review===true).length,
    knowledge_class_counts:Object.freeze(counts),
    append_only:true,
    durable_before_visible:true,
    source_outcome_rows_not_copied:true,
    source_evidence_resolver_required:true,
    active_skill_library_digest:null,
    active_meta_skill_profile_digest:null,
    archive_can_write_skill_library:false,
    archive_can_write_experience_graph:false,
    archive_can_modify_meta_skill_profile:false,
    archive_can_activate_knowledge:false,
    archive_can_schedule_work:false,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiKnowledgeConsolidationArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_consolidation_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_consolidation_source_evidence_resolver_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');this.#resolver=evidenceResolver;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');
      if(p.schema!==RSI_KNOWLEDGE_CONSOLIDATION_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.durable_before_visible!==true||p.source_outcome_rows_not_copied!==true
        ||p.source_evidence_resolver_required!==true||p.active_skill_library_digest!==null||p.active_meta_skill_profile_digest!==null
        ||p.archive_can_write_skill_library!==false||p.archive_can_write_experience_graph!==false
        ||p.archive_can_modify_meta_skill_profile!==false||p.archive_can_activate_knowledge!==false
        ||p.archive_can_schedule_work!==false||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false){
        throw new Error('rsi_consolidation_archive_policy_invalid');
      }
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_consolidation_archive_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ARCHIVE_ROWS)throw new Error('rsi_consolidation_archive_rows_invalid');
      const ids=new Set();
      const checkedRows=[];
      for(const row of p.rows){
        if(row.source_sha!==this.#sourceSha)throw new Error('rsi_consolidation_archive_source_mismatch');
        const sourceRows=await this.#resolver({
          proposal_digest:row.proposal.proposal_digest,
          source_entry_digests:row.proposal.source_entry_digests,
        });
        const proposal=verifyRsiKnowledgeConsolidationProposal(row.proposal,{source_rows:sourceRows});
        if(!Array.isArray(row.validations))throw new Error('rsi_consolidation_archive_validations_invalid');
        const validations=row.validations.map(v=>verifyRsiKnowledgeTransferValidation(v,{proposal}));
        const admission=verifyRsiKnowledgeConsolidationAdmission(row.admission,{proposal,validations});
        if(admission.proposal_digest!==proposal.proposal_digest)throw new Error('rsi_consolidation_archive_binding_mismatch');
        if(ids.has(proposal.proposal_digest))throw new Error('rsi_consolidation_archive_duplicate');
        ids.add(proposal.proposal_digest);
        checkedRows.push(Object.freeze({source_sha:this.#sourceSha,proposal,validations:Object.freeze(validations),admission}));
      }
      this.#rows=checkedRows;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows){
    const state=archiveState(this.#sourceSha,rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);
    try{await h.writeFile(`${JSON.stringify(state)}\n`,'utf8');await h.sync();}finally{await h.close();}
    await fs.rename(tmp,this.#path);
  }
  async add({proposal,validations,admission,source_rows}={}){
    if(!this.#initialized)throw new Error('rsi_consolidation_archive_not_initialized');
    const checkedProposal=verifyRsiKnowledgeConsolidationProposal(proposal,{source_rows});
    if(!Array.isArray(validations))throw new Error('rsi_consolidation_archive_validations_invalid');
    const checkedValidations=validations.map(v=>verifyRsiKnowledgeTransferValidation(v,{proposal:checkedProposal}));
    const checkedAdmission=verifyRsiKnowledgeConsolidationAdmission(admission,{proposal:checkedProposal,validations:checkedValidations});
    if(checkedProposal.source_sha!==this.#sourceSha||checkedAdmission.source_sha!==this.#sourceSha||checkedAdmission.proposal_digest!==checkedProposal.proposal_digest){
      throw new Error('rsi_consolidation_archive_binding_mismatch');
    }
    proposal=checkedProposal;validations=checkedValidations;admission=checkedAdmission;
    const existing=this.#rows.find(r=>r.proposal.proposal_digest===proposal.proposal_digest);
    if(existing){
      if(existing.admission.admission_digest!==admission.admission_digest)throw new Error('rsi_consolidation_archive_identity_conflict');
      return zero({state:'IDEMPOTENT',admission_digest:admission.admission_digest});
    }
    if(this.#rows.length>=MAX_ARCHIVE_ROWS)throw new Error('rsi_consolidation_archive_capacity_exceeded');
    const next=[...this.#rows,Object.freeze({source_sha:this.#sourceSha,proposal:structuredClone(proposal),validations:structuredClone(validations),admission:structuredClone(admission)})];
    await this.#persist(next);this.#rows=next;
    return zero({state:admission.state,admission_digest:admission.admission_digest});
  }
  validated(){
    if(!this.#initialized)throw new Error('rsi_consolidation_archive_not_initialized');
    return Object.freeze(this.#rows.filter(r=>r.admission.eligible_for_library_admission_review===true).map(r=>Object.freeze(structuredClone(r))));
  }
  snapshot(){
    const s=archiveState(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      row_count:s.row_count,validated_count:s.validated_count,knowledge_class_counts:s.knowledge_class_counts,
      append_only:true,durable_before_visible:true,source_outcome_rows_not_copied:true,
      active_skill_library_digest:null,active_meta_skill_profile_digest:null,
      archive_can_write_skill_library:false,archive_can_write_experience_graph:false,
      archive_can_modify_meta_skill_profile:false,archive_can_activate_knowledge:false,
      archive_can_schedule_work:false,authority_effect:false,
    });
  }
}

export function rsiSlowKnowledgeConsolidationTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.slow-knowledge-consolidation-root.v1',
    version:1,
    phase30_generation_scoped_outcome_evidence_required:true,
    min_source_entries:2,
    max_source_entries:MAX_SOURCE_ROWS,
    source_candidate_diversity_required:true,
    same_evaluator_root_required:true,
    same_evaluator_generation_required:true,
    same_evaluator_generation_sequence_required:true,
    generation_history_anchor_required:true,
    same_evaluation_epoch_required:true,
    same_evaluation_epoch_sequence_required:true,
    same_evaluation_contract_required:true,
    cross_contract_consolidation_allowed:false,
    cross_generation_consolidation_allowed:false,
    cross_generation_revalidation_required_before_new_proposal:true,
    mixed_learning_kind_forbidden:true,
    source_evidence_preserved_by_digest:true,
    source_provenance_roots_preserved:true,
    source_external_acceptance_evidence_preserved:true,
    source_counterevidence_preserved:true,
    source_failure_attribution_preserved:true,
    slow_loop_distinct_from_fast_candidate_loop:true,
    raw_trajectory_copy_forbidden:true,
    raw_hidden_holdout_copy_forbidden:true,
    raw_evaluator_assets_copy_forbidden:true,
    external_consolidator_required:true,
    external_scope_owner_required:true,
    external_transfer_validator_required:true,
    external_holdout_owner_required:true,
    external_reference_owner_required:true,
    external_acceptance_owner_required:true,
    matched_reference_integrity_required:true,
    sealed_transfer_acceptance_required:true,
    candidate_can_view_hidden_holdout:false,
    candidate_can_choose_reference:false,
    candidate_can_view_sealed_transfer_acceptance:false,
    min_distinct_passed_transfer_contexts:2,
    distinct_heldout_task_sets_required:true,
    distinct_task_families_required:true,
    distinct_matched_reference_plans_required:true,
    distinct_sealed_transfer_acceptance_required:true,
    zero_observed_negative_transfer_required:true,
    heldout_source_context_exclusion_required:true,
    common_non_regression_floor_required:true,
    knowledge_class_specific_transfer_goal_required:true,
    skill_library_write_performed_here:false,
    experience_graph_write_performed_here:false,
    meta_skill_profile_mutation_performed_here:false,
    knowledge_activation_performed_here:false,
    archive_can_schedule_work:false,
    execution_authority:false,browser_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,slow_knowledge_consolidation_root_digest:digest(root)});
}
