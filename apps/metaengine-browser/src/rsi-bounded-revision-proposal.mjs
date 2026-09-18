import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_CANDIDATE_EXPERIMENT_INTENT_SCHEMA,
  RSI_CANDIDATE_EXPERIMENT_RECEIPT_SCHEMA,
  verifyRsiCandidateExperimentIntent,
  verifyRsiCandidateExperimentReceipt,
} from './rsi-candidate-experiment-ledger.mjs';

export const RSI_REVISION_ENVELOPE_SCHEMA='metaengine.rsi.bounded-revision-envelope.v1';
export const RSI_REVISION_PROPOSAL_SCHEMA='metaengine.rsi.bounded-revision-proposal.v1';
export const RSI_REVISION_PROPOSAL_ARCHIVE_SCHEMA='metaengine.rsi.bounded-revision-proposal-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TAG_RE=/^[A-Z0-9][A-Z0-9_.:-]{1,63}$/;
const MAX_MUTATED_FILES=4;
const MAX_EDIT_OPERATIONS=16;
const MAX_CHANGED_BYTES=65536;
const MAX_ROWS=1024;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_revision_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_revision_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_revision_${l}_invalid`);return x;}
function boundedInt(v,l,max){const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`rsi_revision_${l}_invalid`);return n;}
function tags(v,l){
  if(!Array.isArray(v)||v.length<1||v.length>16)throw new Error(`rsi_revision_${l}_invalid`);
  const out=[...new Set(v.map(x=>String(x||'').trim().toUpperCase()))].sort();
  if(out.length!==v.length||out.some(x=>!SAFE_TAG_RE.test(x)))throw new Error(`rsi_revision_${l}_invalid`);
  return Object.freeze(out);
}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_revision_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_revision_${l}_retry_invalid`);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}

function verifySupportedExperiment(intent,receipt){
  if(!intent||intent.schema!==RSI_CANDIDATE_EXPERIMENT_INTENT_SCHEMA)throw new Error('rsi_revision_experiment_intent_invalid');
  if(!receipt||receipt.schema!==RSI_CANDIDATE_EXPERIMENT_RECEIPT_SCHEMA)throw new Error('rsi_revision_experiment_receipt_invalid');
  const checkedIntent=verifyRsiCandidateExperimentIntent(intent);
  const checkedReceipt=verifyRsiCandidateExperimentReceipt(receipt,{intent:checkedIntent});
  if(checkedReceipt.state!=='SUPPORTED_FOR_BOUNDED_REVISION'||checkedReceipt.eligible_for_bounded_revision!==true
    ||checkedReceipt.no_metric_regression!==true||checkedReceipt.strict_metric_improvement!==true
    ||checkedReceipt.validity_blockers.length!==0||checkedReceipt.ambiguous_effect!==false||checkedReceipt.inconclusive_environment!==false
    ||checkedReceipt.retry_count!==0)throw new Error('rsi_revision_supported_experiment_required');
  return Object.freeze({intent:checkedIntent,receipt:checkedReceipt});
}

export function createRsiBoundedRevisionEnvelope({
  envelope_id,
  intent,
  receipt,
  experiment_ledger_state_digest,
  editable_scope_digest,
  preserved_behavior_digest,
  negative_evidence_root_digest,
  regression_budget_digest,
  validation_plan_digest,
  trust_root_policy_digest,
  evaluator_policy_digest,
  scheduler_policy_digest,
  self_update_policy_digest,
  production_authority_policy_digest,
  security_boundary_digest,
  max_mutated_files=MAX_MUTATED_FILES,
  max_edit_operations=MAX_EDIT_OPERATIONS,
  max_changed_bytes=MAX_CHANGED_BYTES,
  external_revision_controller=false,
}={}){
  if(external_revision_controller!==true)throw new Error('rsi_revision_external_controller_required');
  const experiment=verifySupportedExperiment(intent,receipt);
  const roots=[
    exactDigest(experiment_ledger_state_digest,'experiment_ledger_state'),
    exactDigest(editable_scope_digest,'editable_scope'),
    exactDigest(preserved_behavior_digest,'preserved_behavior'),
    exactDigest(negative_evidence_root_digest,'negative_evidence'),
    exactDigest(regression_budget_digest,'regression_budget'),
    exactDigest(validation_plan_digest,'validation_plan'),
    exactDigest(trust_root_policy_digest,'trust_root_policy'),
    exactDigest(evaluator_policy_digest,'evaluator_policy'),
    exactDigest(scheduler_policy_digest,'scheduler_policy'),
    exactDigest(self_update_policy_digest,'self_update_policy'),
    exactDigest(production_authority_policy_digest,'production_authority_policy'),
    exactDigest(security_boundary_digest,'security_boundary'),
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_revision_independent_policy_roots_required');
  const files=boundedInt(max_mutated_files,'max_mutated_files',MAX_MUTATED_FILES);
  const ops=boundedInt(max_edit_operations,'max_edit_operations',MAX_EDIT_OPERATIONS);
  const bytes=boundedInt(max_changed_bytes,'max_changed_bytes',MAX_CHANGED_BYTES);
  const core=zero({
    schema:RSI_REVISION_ENVELOPE_SCHEMA,
    version:1,
    envelope_id:id(envelope_id,'envelope_id'),
    source_sha:exactSha(experiment.receipt.source_sha,'source'),
    experiment_intent_digest:experiment.intent.intent_digest,
    experiment_receipt_digest:experiment.receipt.receipt_digest,
    experiment_intent_snapshot:experiment.intent,
    experiment_receipt_snapshot:experiment.receipt,
    parent_candidate_artifact_digest:experiment.receipt.candidate_artifact_digest,
    baseline_artifact_digest:experiment.receipt.baseline_artifact_digest,
    experiment_ledger_state_digest:roots[0],
    editable_scope_digest:roots[1],
    preserved_behavior_digest:roots[2],
    negative_evidence_root_digest:roots[3],
    regression_budget_digest:roots[4],
    validation_plan_digest:roots[5],
    protected_policy_roots:Object.freeze({
      trust_root_policy_digest:roots[6],
      evaluator_policy_digest:roots[7],
      scheduler_policy_digest:roots[8],
      self_update_policy_digest:roots[9],
      production_authority_policy_digest:roots[10],
      security_boundary_digest:roots[11],
    }),
    max_mutated_files:files,
    max_edit_operations:ops,
    max_changed_bytes:bytes,
    external_revision_controller:true,
    parent_artifact_preserved:true,
    candidate_must_be_new_artifact:true,
    protected_policy_roots_immutable:true,
    rejected_experiment_evidence_must_be_considered:true,
    preserved_behavior_contract_required:true,
    regression_budget_precommitted:true,
    external_implementation_required:true,
    external_validation_required:true,
    envelope_can_apply_revision:false,
    envelope_can_schedule_implementation:false,
    envelope_is_execution_authority:false,
  });
  return Object.freeze({...core,envelope_digest:digest(core)});
}

export function verifyRsiBoundedRevisionEnvelope(envelope,{intent,receipt}={}){
  if(!envelope||envelope.schema!==RSI_REVISION_ENVELOPE_SCHEMA||envelope.version!==1)throw new Error('rsi_revision_envelope_invalid');
  assertZero(envelope,'envelope');
  if(envelope.external_revision_controller!==true||envelope.parent_artifact_preserved!==true
    ||envelope.candidate_must_be_new_artifact!==true||envelope.protected_policy_roots_immutable!==true
    ||envelope.rejected_experiment_evidence_must_be_considered!==true||envelope.preserved_behavior_contract_required!==true
    ||envelope.regression_budget_precommitted!==true||envelope.external_implementation_required!==true
    ||envelope.external_validation_required!==true||envelope.envelope_can_apply_revision!==false
    ||envelope.envelope_can_schedule_implementation!==false||envelope.envelope_is_execution_authority!==false)throw new Error('rsi_revision_envelope_policy_invalid');
  const p=envelope.protected_policy_roots||{};
  const embeddedIntent=intent??envelope.experiment_intent_snapshot;
  const embeddedReceipt=receipt??envelope.experiment_receipt_snapshot;
  if(!embeddedIntent||!embeddedReceipt)throw new Error('rsi_revision_embedded_experiment_evidence_required');
  const canonical=createRsiBoundedRevisionEnvelope({
    envelope_id:envelope.envelope_id,intent:embeddedIntent,receipt:embeddedReceipt,
    experiment_ledger_state_digest:envelope.experiment_ledger_state_digest,
    editable_scope_digest:envelope.editable_scope_digest,preserved_behavior_digest:envelope.preserved_behavior_digest,
    negative_evidence_root_digest:envelope.negative_evidence_root_digest,regression_budget_digest:envelope.regression_budget_digest,
    validation_plan_digest:envelope.validation_plan_digest,trust_root_policy_digest:p.trust_root_policy_digest,
    evaluator_policy_digest:p.evaluator_policy_digest,scheduler_policy_digest:p.scheduler_policy_digest,
    self_update_policy_digest:p.self_update_policy_digest,production_authority_policy_digest:p.production_authority_policy_digest,
    security_boundary_digest:p.security_boundary_digest,max_mutated_files:envelope.max_mutated_files,
    max_edit_operations:envelope.max_edit_operations,max_changed_bytes:envelope.max_changed_bytes,
    external_revision_controller:true,
  });
  if(canonical.envelope_digest!==exactDigest(envelope.envelope_digest,'envelope'))throw new Error('rsi_revision_envelope_digest_mismatch');
  return canonical;
}

export function createRsiBoundedRevisionProposal({
  proposal_id,
  envelope,
  candidate_revision_spec_digest,
  proposed_child_artifact_identity_digest,
  mutation_categories,
  estimated_mutated_files,
  estimated_edit_operations,
  estimated_changed_bytes,
  expected_preserved_behavior_receipt_digest,
  expected_regression_test_root_digest,
  candidate_optimizer_id_digest,
  authored_by_optimizer=false,
}={}){
  if(!envelope||envelope.schema!==RSI_REVISION_ENVELOPE_SCHEMA)throw new Error('rsi_revision_envelope_invalid');
  assertZero(envelope,'proposal_envelope');
  const ec=structuredClone(envelope);delete ec.envelope_digest;
  if(digest(ec)!==exactDigest(envelope.envelope_digest,'proposal_envelope'))throw new Error('rsi_revision_envelope_digest_mismatch');
  if(authored_by_optimizer!==true)throw new Error('rsi_revision_optimizer_authorship_required');
  const spec=exactDigest(candidate_revision_spec_digest,'candidate_revision_spec');
  const child=exactDigest(proposed_child_artifact_identity_digest,'child_artifact_identity');
  if(child===envelope.parent_candidate_artifact_digest||child===envelope.baseline_artifact_digest)throw new Error('rsi_revision_new_child_identity_required');
  const files=boundedInt(estimated_mutated_files,'estimated_mutated_files',envelope.max_mutated_files);
  const ops=boundedInt(estimated_edit_operations,'estimated_edit_operations',envelope.max_edit_operations);
  const bytes=boundedInt(estimated_changed_bytes,'estimated_changed_bytes',envelope.max_changed_bytes);
  const core=zero({
    schema:RSI_REVISION_PROPOSAL_SCHEMA,
    version:1,
    proposal_id:id(proposal_id,'proposal_id'),
    source_sha:envelope.source_sha,
    envelope_digest:envelope.envelope_digest,
    experiment_receipt_digest:envelope.experiment_receipt_digest,
    parent_candidate_artifact_digest:envelope.parent_candidate_artifact_digest,
    candidate_revision_spec_digest:spec,
    proposed_child_artifact_identity_digest:child,
    mutation_categories:tags(mutation_categories,'mutation_categories'),
    estimated_mutated_files:files,
    estimated_edit_operations:ops,
    estimated_changed_bytes:bytes,
    expected_preserved_behavior_receipt_digest:exactDigest(expected_preserved_behavior_receipt_digest,'preserved_behavior_receipt'),
    expected_regression_test_root_digest:exactDigest(expected_regression_test_root_digest,'regression_test_root'),
    candidate_optimizer_id_digest:exactDigest(candidate_optimizer_id_digest,'optimizer_id'),
    authored_by_optimizer:true,
    proposal_within_external_envelope:true,
    proposal_does_not_apply_changes:true,
    parent_artifact_remains_immutable:true,
    protected_policy_roots_untouched:true,
    external_implementation_review_required:true,
    external_paired_validation_required:true,
    proposal_can_mutate_active_state:false,
    proposal_can_write_repository:false,
    proposal_can_schedule_implementation:false,
    proposal_is_execution_authority:false,
    state:'ELIGIBLE_FOR_EXTERNAL_IMPLEMENTATION_REVIEW',
  });
  return Object.freeze({...core,proposal_digest:digest(core)});
}

export function verifyRsiBoundedRevisionProposal(proposal,{envelope}={}){
  if(!proposal||proposal.schema!==RSI_REVISION_PROPOSAL_SCHEMA||proposal.version!==1)throw new Error('rsi_revision_proposal_invalid');
  assertZero(proposal,'proposal');
  if(proposal.authored_by_optimizer!==true||proposal.proposal_within_external_envelope!==true
    ||proposal.proposal_does_not_apply_changes!==true||proposal.parent_artifact_remains_immutable!==true
    ||proposal.protected_policy_roots_untouched!==true||proposal.external_implementation_review_required!==true
    ||proposal.external_paired_validation_required!==true||proposal.proposal_can_mutate_active_state!==false
    ||proposal.proposal_can_write_repository!==false||proposal.proposal_can_schedule_implementation!==false
    ||proposal.proposal_is_execution_authority!==false||proposal.state!=='ELIGIBLE_FOR_EXTERNAL_IMPLEMENTATION_REVIEW')throw new Error('rsi_revision_proposal_policy_invalid');
  if(proposal.envelope_digest!==envelope?.envelope_digest)throw new Error('rsi_revision_proposal_envelope_mismatch');
  const canonical=createRsiBoundedRevisionProposal({
    proposal_id:proposal.proposal_id,envelope,
    candidate_revision_spec_digest:proposal.candidate_revision_spec_digest,
    proposed_child_artifact_identity_digest:proposal.proposed_child_artifact_identity_digest,
    mutation_categories:proposal.mutation_categories,estimated_mutated_files:proposal.estimated_mutated_files,
    estimated_edit_operations:proposal.estimated_edit_operations,estimated_changed_bytes:proposal.estimated_changed_bytes,
    expected_preserved_behavior_receipt_digest:proposal.expected_preserved_behavior_receipt_digest,
    expected_regression_test_root_digest:proposal.expected_regression_test_root_digest,
    candidate_optimizer_id_digest:proposal.candidate_optimizer_id_digest,authored_by_optimizer:true,
  });
  if(canonical.proposal_digest!==exactDigest(proposal.proposal_digest,'proposal'))throw new Error('rsi_revision_proposal_digest_mismatch');
  return canonical;
}


function archiveState(sourceSha,rows){
  const categories=[...new Set(rows.flatMap(r=>r.proposal.mutation_categories))].sort();
  const core=zero({
    schema:RSI_REVISION_PROPOSAL_ARCHIVE_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    represented_mutation_categories:Object.freeze(categories),
    append_only:true,
    preserves_multiple_proposals:true,
    scalar_winner_forbidden:true,
    active_artifact_digest:null,
    archive_can_apply_revision:false,
    archive_can_write_repository:false,
    archive_can_schedule_implementation:false,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiBoundedRevisionProposalArchive{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_revision_archive_path_required');this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');
      if(p.schema!==RSI_REVISION_PROPOSAL_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.append_only!==true
        ||p.preserves_multiple_proposals!==true||p.scalar_winner_forbidden!==true||p.active_artifact_digest!==null
        ||p.archive_can_apply_revision!==false||p.archive_can_write_repository!==false||p.archive_can_schedule_implementation!==false
        ||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false)throw new Error('rsi_revision_archive_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_revision_archive_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_revision_archive_rows_invalid');
      const ids=new Set();
      const proposalIds=new Set();
      const childIds=new Set();
      const checkedRows=[];
      for(const row of p.rows){
        if(!row||typeof row!=='object'||row.source_sha!==this.#sourceSha)throw new Error('rsi_revision_archive_source_mismatch');
        const expectedSeq=checkedRows.length+1;
        if(row.archive_seq!==expectedSeq)throw new Error('rsi_revision_archive_sequence_invalid');
        const envelope=verifyRsiBoundedRevisionEnvelope(row.envelope);
        const proposal=verifyRsiBoundedRevisionProposal(row.proposal,{envelope});
        if(envelope.source_sha!==this.#sourceSha||proposal.source_sha!==this.#sourceSha)throw new Error('rsi_revision_archive_source_mismatch');
        if(ids.has(proposal.proposal_digest))throw new Error('rsi_revision_archive_proposal_duplicate');
        if(proposalIds.has(proposal.proposal_id))throw new Error('rsi_revision_archive_proposal_id_duplicate');
        if(childIds.has(proposal.proposed_child_artifact_identity_digest))throw new Error('rsi_revision_archive_child_identity_duplicate');
        ids.add(proposal.proposal_digest);
        proposalIds.add(proposal.proposal_id);
        childIds.add(proposal.proposed_child_artifact_identity_digest);
        checkedRows.push(Object.freeze({source_sha:this.#sourceSha,archive_seq:expectedSeq,envelope,proposal}));
      }
      const recomputed=archiveState(this.#sourceSha,checkedRows);
      if(recomputed.state_digest!==exactDigest(p.state_digest,'archive')){
        throw new Error('rsi_revision_archive_derived_state_mismatch');
      }
      this.#rows=checkedRows;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows){const s=archiveState(this.#sourceSha,rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,this.#path);}
  async add({envelope,proposal}={}){
    if(!this.#initialized)throw new Error('rsi_revision_archive_not_initialized');
    if(!envelope||envelope.schema!==RSI_REVISION_ENVELOPE_SCHEMA||!proposal||proposal.schema!==RSI_REVISION_PROPOSAL_SCHEMA)throw new Error('rsi_revision_archive_input_invalid');
    const checkedEnvelope=verifyRsiBoundedRevisionEnvelope(envelope);
    const checkedProposal=verifyRsiBoundedRevisionProposal(proposal,{envelope:checkedEnvelope});
    if(checkedEnvelope.source_sha!==this.#sourceSha||checkedProposal.source_sha!==this.#sourceSha)throw new Error('rsi_revision_archive_binding_mismatch');
    const existing=this.#rows.find(r=>
      r.proposal.proposal_digest===checkedProposal.proposal_digest
      ||r.proposal.proposal_id===checkedProposal.proposal_id
      ||r.proposal.proposed_child_artifact_identity_digest===checkedProposal.proposed_child_artifact_identity_digest
    );
    if(existing){
      if(existing.proposal.proposal_digest!==checkedProposal.proposal_digest)throw new Error('rsi_revision_archive_identity_conflict');
      return zero({state:'IDEMPOTENT',proposal_digest:checkedProposal.proposal_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_revision_archive_capacity_exceeded');
    const nextRows=[...this.#rows,Object.freeze({
      source_sha:this.#sourceSha,
      archive_seq:this.#rows.length+1,
      envelope:structuredClone(checkedEnvelope),
      proposal:structuredClone(checkedProposal),
    })];
    await this.#persist(nextRows);
    this.#rows=nextRows;
    return zero({state:'ARCHIVED_FOR_EXTERNAL_IMPLEMENTATION_REVIEW',proposal_digest:checkedProposal.proposal_digest});
  }
  snapshot(){const s=archiveState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,last_archive_seq:s.rows.length,monotonic_archive_sequence:true,represented_mutation_categories:s.represented_mutation_categories,append_only:true,preserves_multiple_proposals:true,scalar_winner_forbidden:true,active_artifact_digest:null,archive_can_apply_revision:false,archive_can_write_repository:false,archive_can_schedule_implementation:false,authority_effect:false});}
}

export function rsiBoundedRevisionProposalTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.bounded-revision-proposal-root.v1',
    version:1,
    supported_phase26_experiment_required:true,
    external_revision_envelope_required:true,
    embedded_phase26_evidence_required:true,
    canonical_phase26_replay_required:true,
    durable_before_visible_required:true,
    restart_revalidation_required:true,
    monotonic_archive_sequence_required:true,
    max_mutated_files:MAX_MUTATED_FILES,
    max_edit_operations:MAX_EDIT_OPERATIONS,
    max_changed_bytes:MAX_CHANGED_BYTES,
    parent_artifact_preserved:true,
    new_child_artifact_identity_required:true,
    protected_trust_evaluator_scheduler_self_update_production_security_roots_immutable:true,
    preserved_behavior_contract_required:true,
    negative_evidence_required:true,
    regression_budget_precommitted:true,
    external_implementation_required:true,
    external_paired_validation_required:true,
    optimizer_may_author_proposal_but_not_envelope:true,
    multiple_proposals_preserved:true,
    scalar_winner_forbidden:true,
    proposal_can_mutate_active_state:false,
    proposal_can_write_repository:false,
    proposal_can_schedule_implementation:false,
    archive_can_apply_revision:false,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,bounded_revision_proposal_root_digest:digest(root)});
}
