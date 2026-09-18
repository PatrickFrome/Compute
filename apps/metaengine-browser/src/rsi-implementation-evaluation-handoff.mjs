import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA,
  RSI_IMPLEMENTATION_ARTIFACT_RECEIPT_SCHEMA,
  verifyRsiBoundedRevisionArtifactReceipt,
  verifyRsiBoundedRevisionDevosBridge,
} from './rsi-bounded-revision-devos-bridge.mjs';
import {
  RSI_CANDIDATE_EXPERIMENT_INTENT_SCHEMA,
  RSI_CANDIDATE_EXPERIMENT_RECEIPT_SCHEMA,
  createRsiCandidateExperimentIntent,
  verifyRsiCandidateExperimentIntent,
  verifyRsiCandidateExperimentReceipt,
} from './rsi-candidate-experiment-ledger.mjs';

export const RSI_IMPLEMENTATION_EVALUATION_HANDOFF_SCHEMA='metaengine.rsi.implementation-evaluation-handoff.v1';
export const RSI_IMPLEMENTATION_EVALUATION_RESULT_SCHEMA='metaengine.rsi.implementation-evaluation-result.v1';
export const RSI_IMPLEMENTATION_EVALUATION_LEDGER_SCHEMA='metaengine.rsi.implementation-evaluation-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=1024;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_impl_eval_${l}_digest_invalid`);return x;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_impl_eval_${l}_sha_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_impl_eval_${l}_invalid`);return x;}
function assertZero(v,l){
  for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_impl_eval_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_impl_eval_${l}_retry_invalid`);
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}

function verifyBridgeSnapshot(bridge,{revision_envelope,revision_proposal}={}){
  if(!bridge||bridge.schema!==RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA)throw new Error('rsi_impl_eval_bridge_invalid');
  const checked=verifyRsiBoundedRevisionDevosBridge(bridge,{
    envelope:revision_envelope,
    proposal:revision_proposal,
    experiment_intent:revision_envelope?.experiment_intent_snapshot,
    experiment_receipt:revision_envelope?.experiment_receipt_snapshot,
  });
  assertZero(checked,'bridge');
  if(checked.external_implementation_reviewer!==true||checked.uses_existing_devos_scheduler!==true
    ||checked.uses_existing_isolated_candidate_builder!==true||checked.bridge_can_create_workspace!==false
    ||checked.bridge_can_materialize_candidate!==false||checked.bridge_can_execute_commands!==false
    ||checked.bridge_can_promote!==false)throw new Error('rsi_impl_eval_bridge_policy_invalid');
  exactDigest(checked.revision_limits?.parent_candidate_artifact_digest,'parent_candidate');
  return checked;
}

export function createRsiImplementationEvaluationHandoff({
  handoff_id,
  bridge,
  revision_envelope,
  revision_proposal,
  artifact_receipt,
  candidate_handoff,
  request,
  plan,
  plan_requests,
  hypothesis,
  admission,
  sealed_task_set_digest,
  evaluator_root_digest,
  trial_worker_image_digest,
  resource_budget_digest,
  task_order_digest,
  external_evaluation_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_evaluation_owner!==true||authored_by_candidate!==false)throw new Error('rsi_impl_eval_external_owner_required');
  const checkedBridge=verifyBridgeSnapshot(bridge,{revision_envelope,revision_proposal});
  if(!artifact_receipt||artifact_receipt.schema!==RSI_IMPLEMENTATION_ARTIFACT_RECEIPT_SCHEMA)throw new Error('rsi_impl_eval_artifact_receipt_invalid');
  const artifact=verifyRsiBoundedRevisionArtifactReceipt(artifact_receipt,{bridge:checkedBridge,candidate_handoff});
  const baselineArtifact=exactDigest(checkedBridge.revision_limits.parent_candidate_artifact_digest,'baseline_artifact');
  const childArtifact=exactDigest(artifact.artifact_bundle_digest,'child_artifact');
  if(baselineArtifact===childArtifact)throw new Error('rsi_impl_eval_child_must_differ_from_parent');

  const intent=createRsiCandidateExperimentIntent({
    intent_id:`phase29.${id(handoff_id,'handoff_id')}`,
    request,
    plan,
    plan_requests,
    hypothesis,
    admission,
    baseline_artifact_digest:baselineArtifact,
    candidate_artifact_digest:childArtifact,
    sealed_task_set_digest:exactDigest(sealed_task_set_digest,'sealed_task_set'),
    harness_digest:artifact.harness_manifest_digest,
    evaluator_root_digest:exactDigest(evaluator_root_digest,'evaluator_root'),
    trial_worker_image_digest:exactDigest(trial_worker_image_digest,'trial_worker_image'),
    resource_budget_digest:exactDigest(resource_budget_digest,'resource_budget'),
    task_order_digest:exactDigest(task_order_digest,'task_order'),
    external_experiment_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiCandidateExperimentIntent(intent,{request,plan,plan_requests,hypothesis,admission});

  const core=zero({
    schema:RSI_IMPLEMENTATION_EVALUATION_HANDOFF_SCHEMA,
    version:1,
    handoff_id:id(handoff_id,'handoff_id'),
    source_sha:exactSha(artifact.source_sha,'source'),
    parent_candidate_artifact_digest:baselineArtifact,
    child_candidate_artifact_digest:childArtifact,
    bridge_digest:checkedBridge.bridge_digest,
    artifact_receipt_digest:artifact.receipt_digest,
    candidate_handoff_digest:artifact.candidate_handoff_digest,
    implementation_manifest_digest:artifact.implementation_manifest_digest,
    candidate_sha:exactSha(artifact.candidate_sha,'candidate'),
    harness_manifest_digest:artifact.harness_manifest_digest,
    toolchain_digest:artifact.toolchain_digest,
    dependency_closure_digest:artifact.dependency_closure_digest,
    provenance_statement_digest:artifact.provenance_statement_digest,
    bridge_snapshot:checkedBridge,
    revision_envelope_snapshot:Object.freeze(structuredClone(revision_envelope)),
    revision_proposal_snapshot:Object.freeze(structuredClone(revision_proposal)),
    artifact_receipt_snapshot:artifact,
    candidate_handoff_snapshot:Object.freeze(structuredClone(candidate_handoff)),
    experiment_intent:intent,
    external_evaluation_owner:true,
    authored_by_candidate:false,
    reuses_existing_candidate_experiment_contract:true,
    reuses_existing_verification_sandbox:true,
    target_improvement_and_regression_preservation_separate:true,
    scalar_winner_forbidden:true,
    candidate_can_choose_baseline:false,
    candidate_can_choose_harness:false,
    candidate_can_choose_evaluator:false,
    candidate_can_choose_task_set:false,
    candidate_can_choose_resource_budget:false,
    handoff_can_execute:false,
    handoff_can_schedule:false,
    handoff_can_promote:false,
    state:'READY_FOR_EXISTING_PAIRED_EXTERNAL_EVALUATION',
  });
  return Object.freeze({...core,handoff_digest:digest(core)});
}

export function verifyRsiImplementationEvaluationHandoff(handoff){
  if(!handoff||handoff.schema!==RSI_IMPLEMENTATION_EVALUATION_HANDOFF_SCHEMA||handoff.version!==1)throw new Error('rsi_impl_eval_handoff_invalid');
  assertZero(handoff,'handoff');
  if(handoff.external_evaluation_owner!==true||handoff.authored_by_candidate!==false
    ||handoff.reuses_existing_candidate_experiment_contract!==true||handoff.reuses_existing_verification_sandbox!==true
    ||handoff.target_improvement_and_regression_preservation_separate!==true||handoff.scalar_winner_forbidden!==true
    ||handoff.candidate_can_choose_baseline!==false||handoff.candidate_can_choose_harness!==false
    ||handoff.candidate_can_choose_evaluator!==false||handoff.candidate_can_choose_task_set!==false
    ||handoff.candidate_can_choose_resource_budget!==false||handoff.handoff_can_execute!==false
    ||handoff.handoff_can_schedule!==false||handoff.handoff_can_promote!==false
    ||handoff.state!=='READY_FOR_EXISTING_PAIRED_EXTERNAL_EVALUATION')throw new Error('rsi_impl_eval_handoff_policy_invalid');

  const intent=handoff.experiment_intent;
  if(!intent||intent.schema!==RSI_CANDIDATE_EXPERIMENT_INTENT_SCHEMA)throw new Error('rsi_impl_eval_handoff_intent_invalid');
  const request=intent.request_snapshot;
  const plan=intent.plan_snapshot;
  const planRequests=plan?.request_snapshots;
  const hypothesis=request?.hypothesis_snapshot;
  const admission=request?.admission_snapshot;
  if(!request||!plan||!planRequests||!hypothesis||!admission)throw new Error('rsi_impl_eval_handoff_embedded_routing_invalid');

  const canonical=createRsiImplementationEvaluationHandoff({
    handoff_id:handoff.handoff_id,
    bridge:handoff.bridge_snapshot,
    revision_envelope:handoff.revision_envelope_snapshot,
    revision_proposal:handoff.revision_proposal_snapshot,
    artifact_receipt:handoff.artifact_receipt_snapshot,
    candidate_handoff:handoff.candidate_handoff_snapshot,
    request,
    plan,
    plan_requests:planRequests,
    hypothesis,
    admission,
    sealed_task_set_digest:intent.sealed_task_set_digest,
    evaluator_root_digest:intent.evaluator_root_digest,
    trial_worker_image_digest:intent.trial_worker_image_digest,
    resource_budget_digest:intent.resource_budget_digest,
    task_order_digest:intent.task_order_digest,
    external_evaluation_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.handoff_digest!==exactDigest(handoff.handoff_digest,'handoff'))throw new Error('rsi_impl_eval_handoff_digest_mismatch');
  return canonical;
}

export function createRsiImplementationEvaluationResult({
  result_id,
  handoff,
  experiment_receipt,
  external_result_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_result_owner!==true||authored_by_candidate!==false)throw new Error('rsi_impl_eval_external_result_owner_required');
  const checkedHandoff=verifyRsiImplementationEvaluationHandoff(handoff);
  if(!experiment_receipt||experiment_receipt.schema!==RSI_CANDIDATE_EXPERIMENT_RECEIPT_SCHEMA)throw new Error('rsi_impl_eval_experiment_receipt_invalid');
  const receipt=verifyRsiCandidateExperimentReceipt(experiment_receipt,{intent:checkedHandoff.experiment_intent});

  const stateMap={
    SUPPORTED_FOR_BOUNDED_REVISION:'EVALUATED_CHILD_SUPPORTED',
    NO_MATERIAL_IMPROVEMENT:'EVALUATED_CHILD_NO_MATERIAL_IMPROVEMENT',
    CANDIDATE_EXPERIMENT_REJECTED:'EVALUATED_CHILD_REJECTED',
    INCONCLUSIVE_ENVIRONMENT:'EVALUATED_CHILD_INCONCLUSIVE_ENVIRONMENT',
    INCONCLUSIVE_AMBIGUOUS:'EVALUATED_CHILD_INCONCLUSIVE_AMBIGUOUS',
  };
  const state=stateMap[receipt.state];
  if(!state)throw new Error('rsi_impl_eval_experiment_state_invalid');
  const conclusive=!state.startsWith('EVALUATED_CHILD_INCONCLUSIVE_');

  const core=zero({
    schema:RSI_IMPLEMENTATION_EVALUATION_RESULT_SCHEMA,
    version:1,
    result_id:id(result_id,'result_id'),
    source_sha:checkedHandoff.source_sha,
    handoff_digest:checkedHandoff.handoff_digest,
    experiment_intent_digest:checkedHandoff.experiment_intent.intent_digest,
    experiment_receipt_digest:receipt.receipt_digest,
    parent_candidate_artifact_digest:checkedHandoff.parent_candidate_artifact_digest,
    child_candidate_artifact_digest:checkedHandoff.child_candidate_artifact_digest,
    candidate_sha:checkedHandoff.candidate_sha,
    control_metrics:receipt.control_metrics,
    treatment_metrics:receipt.treatment_metrics,
    no_metric_regression:receipt.no_metric_regression,
    strict_metric_improvement:receipt.strict_metric_improvement,
    regressed_metrics:receipt.regressed_metrics,
    improved_metrics:receipt.improved_metrics,
    validity_blockers:receipt.validity_blockers,
    environment_blocker_detected:receipt.environment_blocker_detected,
    controllable_failure_detected:receipt.controllable_failure_detected,
    ambiguous_effect:receipt.ambiguous_effect,
    experiment_state:receipt.state,
    state,
    conclusive_external_evaluation:conclusive,
    eligible_for_external_learning_review:true,
    eligible_for_new_revision_search:state==='EVALUATED_CHILD_SUPPORTED',
    child_can_replace_parent:false,
    result_can_mutate_archive:false,
    result_can_promote:false,
    result_can_schedule:false,
    result_can_retry:false,
    scalar_winner_forbidden:true,
    external_result_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,result_digest:digest(core)});
}

export function verifyRsiImplementationEvaluationResult(result,{handoff,experiment_receipt}={}){
  if(!result||result.schema!==RSI_IMPLEMENTATION_EVALUATION_RESULT_SCHEMA||result.version!==1)throw new Error('rsi_impl_eval_result_invalid');
  assertZero(result,'result');
  if(result.external_result_owner!==true||result.authored_by_candidate!==false
    ||result.eligible_for_external_learning_review!==true||result.child_can_replace_parent!==false
    ||result.result_can_mutate_archive!==false||result.result_can_promote!==false
    ||result.result_can_schedule!==false||result.result_can_retry!==false||result.scalar_winner_forbidden!==true)throw new Error('rsi_impl_eval_result_policy_invalid');
  const canonical=createRsiImplementationEvaluationResult({
    result_id:result.result_id,
    handoff,
    experiment_receipt,
    external_result_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.result_digest!==exactDigest(result.result_digest,'result'))throw new Error('rsi_impl_eval_result_digest_mismatch');
  return canonical;
}

function ledgerState(sourceSha,rows){
  const counts={
    supported:rows.filter(r=>r.result.state==='EVALUATED_CHILD_SUPPORTED').length,
    no_material_improvement:rows.filter(r=>r.result.state==='EVALUATED_CHILD_NO_MATERIAL_IMPROVEMENT').length,
    rejected:rows.filter(r=>r.result.state==='EVALUATED_CHILD_REJECTED').length,
    inconclusive_environment:rows.filter(r=>r.result.state==='EVALUATED_CHILD_INCONCLUSIVE_ENVIRONMENT').length,
    inconclusive_ambiguous:rows.filter(r=>r.result.state==='EVALUATED_CHILD_INCONCLUSIVE_AMBIGUOUS').length,
  };
  const core=zero({
    schema:RSI_IMPLEMENTATION_EVALUATION_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    state_counts:Object.freeze(counts),
    append_only:true,
    preserves_negative_evidence:true,
    preserves_inconclusive_evidence:true,
    scalar_winner_forbidden:true,
    active_candidate_artifact_digest:null,
    ledger_can_replace_parent:false,
    ledger_can_promote:false,
    ledger_can_schedule:false,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
  });
  return {...core,state_digest:digest(core)};
}

function verifyStoredRow(row,sourceSha){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_impl_eval_ledger_row_invalid');
  const handoff=verifyRsiImplementationEvaluationHandoff(row.handoff);
  const receipt=row.experiment_receipt;
  const result=verifyRsiImplementationEvaluationResult(row.result,{handoff,experiment_receipt:receipt});
  const expected=exactSha(sourceSha,'ledger_source');
  if(row.source_sha!==expected||handoff.source_sha!==expected||result.source_sha!==expected)throw new Error('rsi_impl_eval_ledger_source_mismatch');
  return Object.freeze({
    source_sha:expected,
    handoff:structuredClone(handoff),
    experiment_receipt:structuredClone(receipt),
    result:structuredClone(result),
  });
}

export class RsiImplementationEvaluationLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath)throw new Error('rsi_impl_eval_ledger_path_required');
    this.#path=path.resolve(statePath);
    this.#sourceSha=exactSha(source_sha,'ledger_source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(p,'ledger');
      if(p.schema!==RSI_IMPLEMENTATION_EVALUATION_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.preserves_negative_evidence!==true||p.preserves_inconclusive_evidence!==true
        ||p.scalar_winner_forbidden!==true||p.active_candidate_artifact_digest!==null
        ||p.ledger_can_replace_parent!==false||p.ledger_can_promote!==false||p.ledger_can_schedule!==false
        ||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false)throw new Error('rsi_impl_eval_ledger_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'ledger'))throw new Error('rsi_impl_eval_ledger_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_impl_eval_ledger_rows_invalid');
      const handoffIds=new Set();
      const resultIds=new Set();
      const intentDigests=new Set();
      const checked=p.rows.map(row=>{
        const x=verifyStoredRow(row,this.#sourceSha);
        if(handoffIds.has(x.handoff.handoff_id))throw new Error('rsi_impl_eval_ledger_handoff_duplicate');
        if(resultIds.has(x.result.result_id))throw new Error('rsi_impl_eval_ledger_result_duplicate');
        if(intentDigests.has(x.result.experiment_intent_digest))throw new Error('rsi_impl_eval_ledger_intent_duplicate');
        handoffIds.add(x.handoff.handoff_id);
        resultIds.add(x.result.result_id);
        intentDigests.add(x.result.experiment_intent_digest);
        return x;
      });
      const canonical=ledgerState(this.#sourceSha,checked);
      if(canonical.state_digest!==p.state_digest)throw new Error('rsi_impl_eval_ledger_derived_state_mismatch');
      this.#rows=checked;
    }catch(error){
      if(error?.code!=='ENOENT')throw error;
    }
    this.#initialized=true;
    return this.snapshot();
  }
  async #persist(rows=this.#rows){
    const state=ledgerState(this.#sourceSha,rows);
    const tmp=`${this.#path}.tmp`;
    const h=await fs.open(tmp,'w',0o600);
    try{
      await h.writeFile(`${JSON.stringify(state)}\n`,'utf8');
      await h.sync();
    }finally{
      await h.close();
    }
    await fs.rename(tmp,this.#path);
  }
  async add({handoff,experiment_receipt,result}={}){
    if(!this.#initialized)throw new Error('rsi_impl_eval_ledger_not_initialized');
    const row=verifyStoredRow({source_sha:this.#sourceSha,handoff,experiment_receipt,result},this.#sourceSha);
    const existing=this.#rows.find(r=>r.handoff.handoff_id===row.handoff.handoff_id
      ||r.result.result_id===row.result.result_id
      ||r.result.experiment_intent_digest===row.result.experiment_intent_digest);
    if(existing){
      if(existing.result.result_digest!==row.result.result_digest)throw new Error('rsi_impl_eval_ledger_identity_conflict');
      return zero({state:'IDEMPOTENT',result_digest:row.result.result_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_impl_eval_ledger_capacity_exceeded');
    const preview=Object.freeze([...this.#rows,row]);
    await this.#persist(preview);
    this.#rows=preview;
    return zero({state:row.result.state,result_digest:row.result.result_digest});
  }
  snapshot(){
    const s=ledgerState(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      row_count:s.row_count,state_counts:s.state_counts,append_only:true,preserves_negative_evidence:true,
      preserves_inconclusive_evidence:true,scalar_winner_forbidden:true,active_candidate_artifact_digest:null,
      ledger_can_replace_parent:false,ledger_can_promote:false,ledger_can_schedule:false,authority_effect:false,
    });
  }
}

export function rsiImplementationEvaluationHandoffTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.implementation-evaluation-handoff-root.v1',
    version:1,
    provenance_verified_phase28_artifact_required:true,
    exact_parent_child_identity_required:true,
    existing_candidate_experiment_contract_required:true,
    existing_verification_sandbox_required:true,
    external_evaluation_owner_required:true,
    target_improvement_and_regression_preservation_separate:true,
    environment_invalidity_separate:true,
    ambiguity_separate:true,
    negative_evidence_retained:true,
    inconclusive_evidence_retained:true,
    repeated_independent_child_evaluations_allowed:true,
    scalar_winner_forbidden:true,
    candidate_can_choose_baseline:false,
    candidate_can_choose_harness:false,
    candidate_can_choose_evaluator:false,
    candidate_can_choose_task_set:false,
    second_evaluator_forbidden:true,
    second_experiment_executor_forbidden:true,
    result_can_replace_parent:false,
    result_can_promote:false,
    result_can_schedule:false,
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
  return Object.freeze({...root,implementation_evaluation_handoff_root_digest:digest(root)});
}
