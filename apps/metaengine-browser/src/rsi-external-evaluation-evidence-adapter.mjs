import crypto from 'node:crypto';

import {
  applyRsiEvaluatorMesh,
  createRsiEvaluatorMeshPlan,
  verifyRsiEvaluatorReceipt,
} from './rsi-evaluator-mesh.mjs';
import { RsiShadowArchive, RSI_HARD_INVARIANTS, RSI_SHADOW_STATES } from './rsi-shadow-core.mjs';
import {
  createRsiBenchmarkEvidenceAdmission,
  verifyRsiBenchmarkEvidenceAdmission,
} from './rsi-benchmark-provenance-guard.mjs';
import {
  verifyRsiRetentionReplayReceipt,
  finalizeRsiRetentionGate,
  verifyRsiRetentionGate,
} from './rsi-regression-replay.mjs';
import {
  verifyRsiEvaluationIntegrityPolicy,
  verifyRsiEvaluationIntegrityReceipt,
  assessRsiEvaluationIntegrity,
  verifyRsiEvaluationIntegrityAssessment,
} from './rsi-evaluation-integrity-guard.mjs';
import {
  createRsiShadowTournamentPlan,
  evaluateRsiShadowTournament,
  verifyRsiShadowTournamentResult,
} from './rsi-shadow-tournament.mjs';

export const RSI_EXTERNAL_HOLDOUT_RESULT_SCHEMA='metaengine.rsi.external-holdout-result.v1';
export const RSI_EXTERNAL_EVALUATION_BUNDLE_SCHEMA='metaengine.rsi.external-evaluation-bundle.v1';
export const RSI_EXTERNAL_EVALUATION_ROOT_SCHEMA='metaengine.rsi.external-evaluation-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,511}$/;
const REQUIRED_KINDS=Object.freeze([
  'HARD_INVARIANTS',
  'OBJECTIVES',
  'HOLDOUT',
  'REGRESSION_REPLAY',
  'EVALUATION_INTEGRITY',
  'TOURNAMENT',
]);
const MAX_REFS=32;
const MAX_BUNDLE_BYTES=48*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(value,label){
  for(const key of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_external_eval_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_external_eval_${label}_retry_invalid`);
}
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_external_eval_${label}_sha_invalid`);return out}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_external_eval_${label}_digest_invalid`);return out}
function candidateId(value,label='candidate'){const out=String(value||'').trim().toLowerCase();if(!CANDIDATE_ID_RE.test(out))throw new Error(`rsi_external_eval_${label}_id_invalid`);return out}
function boundedId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_external_eval_${label}_invalid`);return out}
function probability(value,label){const out=Number(value);if(!Number.isFinite(out)||out<0||out>1)throw new Error(`rsi_external_eval_${label}_invalid`);return Math.round(out*1e12)/1e12}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_REFS)throw new Error('rsi_external_eval_evidence_refs_invalid');
  const out=value.map(row=>boundedId(row,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_external_eval_evidence_ref_duplicate');
  return Object.freeze(out);
}
function assertIdentity(row,identity,label){
  if(candidateId(row?.candidate_id,label)!==identity.candidate_id)throw new Error(`rsi_external_eval_${label}_candidate_id_mismatch`);
  if(exactSha(row?.candidate_sha,label)!==identity.candidate_sha)throw new Error(`rsi_external_eval_${label}_candidate_sha_mismatch`);
}
function verifiedMaterializationIdentity(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!=='metaengine.rsi.verified-candidate-materialization.v1'||row.version!==1)throw new Error('rsi_external_eval_verified_materialization_invalid');
  assertZeroAuthority(row,'verified_materialization');
  if(
    row.exact_workspace_incarnation_verified!==true
    || row.exact_candidate_source_verified!==true
    || row.eligible_for_external_evaluation!==true
    || row.eligible_for_promotion!==false
    || row.materialization_replay_authorized!==false
    || row.db_lease_was_execution_authority!==true
    || row.verified_materialization_is_execution_authority!==false
  )throw new Error('rsi_external_eval_verified_materialization_policy_invalid');
  const identity=Object.freeze({
    episode_id:boundedId(row.episode_id,'episode_id'),
    candidate_id:candidateId(row.candidate_id),
    candidate_sha:exactSha(row.candidate_sha,'candidate'),
    parent_sha:exactSha(row.source_sha,'parent'),
    isolated_handoff_digest:exactDigest(row.isolated_candidate_handoff_digest,'isolated_handoff'),
  });
  if(identity.candidate_sha===identity.parent_sha)throw new Error('rsi_external_eval_noop_candidate');
  return identity;
}

export function createRsiExternalHoldoutResult({
  candidate_id,
  candidate_sha,
  benchmark_admission_digest,
  hidden_manifest_digest,
  holdout_suite_digest,
  pass_rate,
  minimum_pass_rate=0.8,
  evaluation_complete=true,
  external_holdout_evaluator=false,
  authored_by_candidate=true,
  evidence_refs,
}={}){
  if(external_holdout_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_external_eval_holdout_external_origin_required');
  const rate=probability(pass_rate,'holdout_pass_rate');
  const floor=probability(minimum_pass_rate,'holdout_minimum_pass_rate');
  const complete=evaluation_complete===true;
  const result=complete?(rate>=floor?'PASS':'FAIL'):'AMBIGUOUS';
  const core=zeroAuthority({
    schema:RSI_EXTERNAL_HOLDOUT_RESULT_SCHEMA,
    version:1,
    candidate_id:candidateId(candidate_id),
    candidate_sha:exactSha(candidate_sha,'holdout_candidate'),
    benchmark_admission_digest:exactDigest(benchmark_admission_digest,'benchmark_admission'),
    hidden_manifest_digest:exactDigest(hidden_manifest_digest,'hidden_manifest'),
    holdout_suite_digest:exactDigest(holdout_suite_digest,'holdout_suite'),
    pass_rate:rate,
    minimum_pass_rate:floor,
    evaluation_complete:complete,
    result,
    external_holdout_evaluator:true,
    authored_by_candidate:false,
    hidden_task_content_exposed:false,
    reference_solution_exposed:false,
    candidate_can_select_holdout:false,
    candidate_can_self_certify:false,
    holdout_result_is_promotion_authority:false,
    evidence_refs:refs(evidence_refs),
  });
  return Object.freeze({...core,holdout_result_digest:digest(core)});
}

export function verifyRsiExternalHoldoutResult(row,identity,benchmarkAdmission){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_EXTERNAL_HOLDOUT_RESULT_SCHEMA||row.version!==1)throw new Error('rsi_external_eval_holdout_result_invalid');
  assertZeroAuthority(row,'holdout');
  assertIdentity(row,identity,'holdout');
  if(
    row.external_holdout_evaluator!==true
    || row.authored_by_candidate!==false
    || row.hidden_task_content_exposed!==false
    || row.reference_solution_exposed!==false
    || row.candidate_can_select_holdout!==false
    || row.candidate_can_self_certify!==false
    || row.holdout_result_is_promotion_authority!==false
  )throw new Error('rsi_external_eval_holdout_policy_invalid');
  if(row.benchmark_admission_digest!==benchmarkAdmission.admission_digest)throw new Error('rsi_external_eval_holdout_benchmark_binding_mismatch');
  const canonical=createRsiExternalHoldoutResult({
    candidate_id:row.candidate_id,
    candidate_sha:row.candidate_sha,
    benchmark_admission_digest:row.benchmark_admission_digest,
    hidden_manifest_digest:row.hidden_manifest_digest,
    holdout_suite_digest:row.holdout_suite_digest,
    pass_rate:row.pass_rate,
    minimum_pass_rate:row.minimum_pass_rate,
    evaluation_complete:row.evaluation_complete,
    external_holdout_evaluator:true,
    authored_by_candidate:false,
    evidence_refs:row.evidence_refs,
  });
  if(canonical.holdout_result_digest!==exactDigest(row.holdout_result_digest,'holdout_result'))throw new Error('rsi_external_eval_holdout_digest_mismatch');
  return canonical;
}

function evaluatorEvidence(identity,candidateHandoff,receipts){
  if(!candidateHandoff||candidateHandoff.handoff_digest!==identity.isolated_handoff_digest)throw new Error('rsi_external_eval_candidate_handoff_digest_mismatch');
  if(candidateHandoff.parent_sha!==identity.parent_sha||candidateHandoff.candidate_sha!==identity.candidate_sha||candidateHandoff.candidate_capsule?.candidate_id!==identity.candidate_id)throw new Error('rsi_external_eval_candidate_handoff_identity_mismatch');
  const plan=createRsiEvaluatorMeshPlan({candidate_handoff:candidateHandoff});
  if(!Array.isArray(receipts))throw new Error('rsi_external_eval_evaluator_receipts_invalid');
  for(const receipt of receipts)verifyRsiEvaluatorReceipt({plan,receipt});
  const archive=new RsiShadowArchive({clock:()=>Date.parse('2026-09-18T00:00:00.000Z')});
  archive.propose(candidateHandoff.shadow_archive_proposal);
  const result=applyRsiEvaluatorMesh({archive,candidate_handoff:candidateHandoff,plan,receipts});
  const allHardPass=RSI_HARD_INVARIANTS.every(name=>result.hard_invariants?.[name]==='PASS');
  const anyObjectiveImproved=Array.isArray(result.objectives)&&result.objectives.some(row=>row?.improved===true);
  return Object.freeze({
    plan,
    result,
    hard_result:allHardPass?'PASS':'FAIL',
    objective_result:result.state===RSI_SHADOW_STATES.SHADOW_QUALIFIED&&anyObjectiveImproved?'PASS':'FAIL',
  });
}

function holdoutEvidence(identity,bundle){
  const admission=createRsiBenchmarkEvidenceAdmission({
    policy:bundle.policy,
    assessments:bundle.assessments,
    tasks:bundle.tasks,
  });
  verifyRsiBenchmarkEvidenceAdmission(admission,bundle.policy,bundle.assessments,bundle.tasks);
  const result=verifyRsiExternalHoldoutResult(bundle.result,identity,admission);
  const verdict=admission.eligible_for_full_holdout_evidence===true?result.result:'FAIL';
  return Object.freeze({admission,result,verdict});
}

function regressionEvidence(identity,bundle){
  if(!bundle||typeof bundle!=='object'||Array.isArray(bundle))throw new Error('rsi_external_eval_regression_bundle_invalid');
  if(!Array.isArray(bundle.receipts))throw new Error('rsi_external_eval_regression_receipts_invalid');
  for(const receipt of bundle.receipts)verifyRsiRetentionReplayReceipt(receipt,bundle.plan,bundle.ledger);
  const gate=finalizeRsiRetentionGate({plan:bundle.plan,ledger:bundle.ledger,receipts:bundle.receipts});
  verifyRsiRetentionGate(gate,bundle.plan,bundle.ledger,bundle.receipts);
  if(gate.current_candidate_id!==identity.candidate_id||gate.current_candidate_sha!==identity.candidate_sha)throw new Error('rsi_external_eval_regression_candidate_mismatch');
  return Object.freeze({gate,verdict:gate.retention_gate_pass===true?'PASS':'FAIL'});
}

function integrityEvidence(identity,bundle){
  const policy=verifyRsiEvaluationIntegrityPolicy(bundle.policy);
  const receipt=verifyRsiEvaluationIntegrityReceipt(bundle.receipt,policy);
  assertIdentity(receipt,identity,'integrity');
  const assessment=assessRsiEvaluationIntegrity({policy,receipt});
  verifyRsiEvaluationIntegrityAssessment(assessment,policy,receipt);
  return Object.freeze({assessment,verdict:assessment.state==='INTEGRITY_VERIFIED'?'PASS':'FAIL'});
}

function tournamentEvidence(identity,candidateHandoff,evaluatorResult,bundle){
  if(!bundle||typeof bundle!=='object'||Array.isArray(bundle))throw new Error('rsi_external_eval_tournament_bundle_invalid');
  const plan=createRsiShadowTournamentPlan({
    candidate_handoff:candidateHandoff,
    evaluator_result:evaluatorResult,
    workload:bundle.workload,
    pair_count:bundle.pair_count,
  });
  const result=evaluateRsiShadowTournament({plan,receipts:bundle.receipts});
  verifyRsiShadowTournamentResult({plan,result});
  if(result.candidate?.candidate_id!==identity.candidate_id||result.candidate?.candidate_sha!==identity.candidate_sha)throw new Error('rsi_external_eval_tournament_candidate_mismatch');
  const verdict=result.relation==='PARETO_ADVANCE'?'PASS':'FAIL';
  return Object.freeze({plan,result,verdict});
}

function evidenceRow(kind,result,evidenceDigest,supportSchema,supportDigest){
  const core=zeroAuthority({
    evidence_id:`external:${kind.toLowerCase().replaceAll('_','-')}`,
    evidence_kind:kind,
    result,
    evidence_digest:exactDigest(evidenceDigest,`${kind.toLowerCase()}_evidence`),
    support_schema:supportSchema,
    support_digest:exactDigest(supportDigest,`${kind.toLowerCase()}_support`),
    external_evaluator_required:true,
    authored_by_candidate:false,
    candidate_can_override_result:false,
    physical_effect_replay_allowed:false,
  });
  return Object.freeze(core);
}

export function createRsiExternalEvaluationBundle({
  verified_materialization,
  candidate_handoff,
  evaluator_receipts,
  holdout,
  regression,
  integrity,
  tournament,
}={}){
  const identity=verifiedMaterializationIdentity(verified_materialization);
  const evaluator=evaluatorEvidence(identity,candidate_handoff,evaluator_receipts);
  const holdoutResult=holdoutEvidence(identity,holdout);
  const regressionResult=regressionEvidence(identity,regression);
  const integrityResult=integrityEvidence(identity,integrity);
  const tournamentResult=tournamentEvidence(identity,candidate_handoff,evaluator.result,tournament);

  const hardDigest=digest({result_digest:evaluator.result.result_digest,hard_invariants:evaluator.result.hard_invariants});
  const objectiveDigest=digest({result_digest:evaluator.result.result_digest,objectives:evaluator.result.objectives,state:evaluator.result.state});
  const classes=Object.freeze([
    evidenceRow('HARD_INVARIANTS',evaluator.hard_result,hardDigest,evaluator.result.schema,evaluator.result.result_digest),
    evidenceRow('OBJECTIVES',evaluator.objective_result,objectiveDigest,evaluator.result.schema,evaluator.result.result_digest),
    evidenceRow('HOLDOUT',holdoutResult.verdict,holdoutResult.result.holdout_result_digest,holdoutResult.admission.schema,holdoutResult.admission.admission_digest),
    evidenceRow('REGRESSION_REPLAY',regressionResult.verdict,regressionResult.gate.gate_digest,regressionResult.gate.schema,regressionResult.gate.gate_digest),
    evidenceRow('EVALUATION_INTEGRITY',integrityResult.verdict,integrityResult.assessment.assessment_digest,integrityResult.assessment.schema,integrityResult.assessment.assessment_digest),
    evidenceRow('TOURNAMENT',tournamentResult.verdict,tournamentResult.result.result_digest,tournamentResult.result.schema,tournamentResult.result.result_digest),
  ]);
  if(JSON.stringify(classes.map(row=>row.evidence_kind))!==JSON.stringify(REQUIRED_KINDS))throw new Error('rsi_external_eval_required_class_order_invalid');

  const core=zeroAuthority({
    schema:RSI_EXTERNAL_EVALUATION_BUNDLE_SCHEMA,
    version:1,
    episode_id:identity.episode_id,
    candidate_id:identity.candidate_id,
    candidate_sha:identity.candidate_sha,
    parent_sha:identity.parent_sha,
    isolated_candidate_handoff_digest:identity.isolated_handoff_digest,
    evaluator_plan_digest:evaluator.plan.plan_digest,
    evaluator_result_digest:evaluator.result.result_digest,
    benchmark_admission_digest:holdoutResult.admission.admission_digest,
    holdout_result_digest:holdoutResult.result.holdout_result_digest,
    regression_gate_digest:regressionResult.gate.gate_digest,
    evaluation_integrity_assessment_digest:integrityResult.assessment.assessment_digest,
    tournament_plan_digest:tournamentResult.plan.plan_digest,
    tournament_result_digest:tournamentResult.result.result_digest,
    evidence_classes:classes,
    required_evidence_kinds:[...REQUIRED_KINDS],
    all_classes_pass:classes.every(row=>row.result==='PASS'),
    any_class_ambiguous:classes.some(row=>row.result==='AMBIGUOUS'),
    candidate_can_self_certify:false,
    candidate_can_modify_evidence:false,
    evidence_ingest_is_promotion_authority:false,
    direct_promotion_enabled:false,
    physical_effect_replay_allowed:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_BUNDLE_BYTES)throw new Error('rsi_external_eval_bundle_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_BUNDLE_BYTES,bundle_digest:digest(core)});
}

export function verifyRsiExternalEvaluationBundle(bundle){
  if(!bundle||typeof bundle!=='object'||Array.isArray(bundle)||bundle.schema!==RSI_EXTERNAL_EVALUATION_BUNDLE_SCHEMA||bundle.version!==1)throw new Error('rsi_external_eval_bundle_invalid');
  assertZeroAuthority(bundle,'bundle');
  if(
    bundle.candidate_can_self_certify!==false
    || bundle.candidate_can_modify_evidence!==false
    || bundle.evidence_ingest_is_promotion_authority!==false
    || bundle.direct_promotion_enabled!==false
    || bundle.physical_effect_replay_allowed!==false
  )throw new Error('rsi_external_eval_bundle_policy_invalid');
  candidateId(bundle.candidate_id);
  exactSha(bundle.candidate_sha,'bundle_candidate');
  exactSha(bundle.parent_sha,'bundle_parent');
  for(const [value,label] of [
    [bundle.isolated_candidate_handoff_digest,'handoff'],
    [bundle.evaluator_plan_digest,'evaluator_plan'],
    [bundle.evaluator_result_digest,'evaluator_result'],
    [bundle.benchmark_admission_digest,'benchmark'],
    [bundle.holdout_result_digest,'holdout'],
    [bundle.regression_gate_digest,'regression'],
    [bundle.evaluation_integrity_assessment_digest,'integrity'],
    [bundle.tournament_plan_digest,'tournament_plan'],
    [bundle.tournament_result_digest,'tournament_result'],
  ])exactDigest(value,label);
  if(!Array.isArray(bundle.evidence_classes)||bundle.evidence_classes.length!==REQUIRED_KINDS.length)throw new Error('rsi_external_eval_bundle_classes_invalid');
  if(JSON.stringify(bundle.evidence_classes.map(row=>row.evidence_kind))!==JSON.stringify(REQUIRED_KINDS))throw new Error('rsi_external_eval_bundle_class_order_invalid');
  for(const row of bundle.evidence_classes){
    assertZeroAuthority(row,'class');
    if(!['PASS','FAIL','AMBIGUOUS'].includes(row.result))throw new Error('rsi_external_eval_bundle_class_result_invalid');
    exactDigest(row.evidence_digest,'class_evidence');
    exactDigest(row.support_digest,'class_support');
  }
  if(bundle.all_classes_pass!==bundle.evidence_classes.every(row=>row.result==='PASS'))throw new Error('rsi_external_eval_bundle_all_pass_mismatch');
  if(bundle.any_class_ambiguous!==bundle.evidence_classes.some(row=>row.result==='AMBIGUOUS'))throw new Error('rsi_external_eval_bundle_ambiguous_mismatch');
  const core={...structuredClone(bundle)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.bundle_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(bundle.payload_bytes)||payloadBytes>Number(bundle.max_payload_bytes)||Number(bundle.max_payload_bytes)!==MAX_BUNDLE_BYTES)throw new Error('rsi_external_eval_bundle_size_mismatch');
  if(digest(core)!==exactDigest(bundle.bundle_digest,'bundle'))throw new Error('rsi_external_eval_bundle_digest_mismatch');
  return bundle;
}

export function rsiExternalEvaluationTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_EXTERNAL_EVALUATION_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-external-evaluation-evidence-adapter.mjs',
    required_evidence_kinds:[...REQUIRED_KINDS],
    existing_evaluator_mesh_required:true,
    contamination_resistant_holdout_required:true,
    regression_replay_required:true,
    evaluation_integrity_required:true,
    precommitted_tournament_required:true,
    tournament_pareto_advance_required_for_pass:true,
    candidate_can_self_certify:false,
    candidate_can_modify_evidence:false,
    external_evaluator_receipts_required:true,
    durable_before_episode_apply_required:true,
    all_six_classes_required_for_nomination_ready:true,
    direct_promotion_enabled:false,
    physical_effect_replay_allowed:false,
    max_bundle_bytes:MAX_BUNDLE_BYTES,
    no_second_scheduler:true,
  });
  return Object.freeze({...root,external_evaluation_root_digest:digest(root)});
}
