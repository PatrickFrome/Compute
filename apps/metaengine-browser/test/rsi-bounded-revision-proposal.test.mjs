import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createRsiSharedExperienceAdmission,
  createRsiSharedExperienceHypothesis,
} from '../src/rsi-shared-experience-bus.mjs';
import {
  createRsiEvaluationBudgetPlan,
  createRsiEvaluationRoutingRequest,
} from '../src/rsi-evaluation-budget-router.mjs';
import {
  createRsiCandidateExperimentIntent,
  createRsiCandidateExperimentReceipt,
} from '../src/rsi-candidate-experiment-ledger.mjs';
import {
  RsiBoundedRevisionProposalArchive,
  createRsiBoundedRevisionEnvelope,
  createRsiBoundedRevisionProposal,
  rsiBoundedRevisionProposalTrustRootSnapshot,
  verifyRsiBoundedRevisionEnvelope,
  verifyRsiBoundedRevisionProposal,
} from '../src/rsi-bounded-revision-proposal.mjs';

const SOURCE='a'.repeat(40);
function dg(label){return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;}
function stableForDigest(v){
  if(Array.isArray(v))return v.map(stableForDigest);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stableForDigest(v[k])]));
}
function objectDigest(v){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stableForDigest(v)),'utf8').digest('hex')}`;
}

function experimentFixture(label='one',{supported=true}={}){
  const hypothesis=createRsiSharedExperienceHypothesis({
    hypothesis_id:`revision.hypothesis.${label}`,
    source_sha:SOURCE,
    origin_candidate_digest:dg(`origin-candidate-${label}`),
    origin_lineage_digest:dg(`origin-lineage-${label}`),
    sanitized_summary_digest:dg(`summary-${label}`),
    supporting_evidence_digest:dg(`support-${label}`),
    counterevidence_digest:dg(`counter-${label}`),
    falsification_test_digest:dg(`falsification-${label}`),
    scope_tags:['PLANNING'],
    recipient_group_tags:['CODING'],
    evaluator_cost_units:8,
    expected_information_gain:0.8,
    hidden_data_disclosed:false,
    raw_benchmark_content_included:false,
    raw_verifier_assets_included:false,
    external_synthesizer:true,
    authored_by_candidate:false,
  });
  const admission=createRsiSharedExperienceAdmission({
    admission_id:`revision.experience.admission.${label}`,
    hypothesis,
    supporting_evidence_verified:true,
    counterevidence_reviewed:true,
    falsification_test_precommitted:true,
    hidden_data_non_disclosure_pass:true,
    scope_precision_pass:true,
    evaluator_budget_available:true,
    marginal_information_gain_certified:true,
    external_reviewer:true,
    authored_by_candidate:false,
  });
  const request=createRsiEvaluationRoutingRequest({
    request_id:`revision.request.${label}`,
    hypothesis,
    admission,
    external_measurement_digest:dg(`measurement-${label}`),
    proxy_score_digest:dg(`proxy-${label}`),
    uncertainty:0.8,
    decision_closeness:0.8,
    proxy_reliability_gap:0.2,
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:`revision.plan.${label}`,
    source_sha:SOURCE,
    requests:[request],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  const intent=createRsiCandidateExperimentIntent({
    intent_id:`revision.experiment.intent.${label}`,
    request,plan,plan_requests:[request],hypothesis,admission,
    baseline_artifact_digest:dg(`baseline-${label}`),
    candidate_artifact_digest:dg(`candidate-${label}`),
    sealed_task_set_digest:dg(`tasks-${label}`),
    harness_digest:dg(`harness-${label}`),
    evaluator_root_digest:dg(`experiment-evaluator-${label}`),
    trial_worker_image_digest:dg(`worker-${label}`),
    resource_budget_digest:dg(`resource-budget-${label}`),
    task_order_digest:dg(`task-order-${label}`),
    external_experiment_owner:true,
    authored_by_candidate:false,
  });
  const control={
    task_utility:0.70,safety:0.95,security:0.95,
    process_integrity:0.90,outcome_integrity:0.90,efficiency:0.70,
  };
  const treatment=supported?{
    task_utility:0.80,safety:0.95,security:0.96,
    process_integrity:0.92,outcome_integrity:0.91,efficiency:0.72,
  }:{
    task_utility:0.80,safety:0.80,security:0.96,
    process_integrity:0.92,outcome_integrity:0.91,efficiency:0.72,
  };
  const receipt=createRsiCandidateExperimentReceipt({
    receipt_id:`revision.experiment.receipt.${label}`,
    intent,
    control_metrics:control,
    treatment_metrics:treatment,
    control_attempts:1,treatment_attempts:1,retry_count:0,
    same_tasks_pass:true,same_task_order_pass:true,harness_identity_pass:true,
    resource_budget_identity_pass:true,evaluator_integrity_pass:true,trial_isolation_pass:true,
    from_scratch_replay_pass:true,contamination_clear:true,reward_hack_detected:false,
    blind_retry_detected:false,environment_blocker_detected:false,controllable_failure_detected:false,
    ambiguous_effect:false,evidence_digest:dg(`experiment-evidence-${label}`),
    external_runner:true,external_evaluator:true,authored_by_candidate:false,
  });
  return {hypothesis,admission,request,plan,intent,receipt};
}

function envelope(fx,label='one',overrides={}){
  return createRsiBoundedRevisionEnvelope({
    envelope_id:`revision.envelope.${label}`,
    intent:fx.intent,
    receipt:fx.receipt,
    experiment_ledger_state_digest:dg(`ledger-state-${label}`),
    editable_scope_digest:dg(`editable-scope-${label}`),
    preserved_behavior_digest:dg(`preserved-behavior-${label}`),
    negative_evidence_root_digest:dg(`negative-evidence-${label}`),
    regression_budget_digest:dg(`regression-budget-${label}`),
    validation_plan_digest:dg(`validation-plan-${label}`),
    trust_root_policy_digest:dg(`trust-root-${label}`),
    evaluator_policy_digest:dg(`evaluator-policy-${label}`),
    scheduler_policy_digest:dg(`scheduler-policy-${label}`),
    self_update_policy_digest:dg(`self-update-policy-${label}`),
    production_authority_policy_digest:dg(`production-authority-${label}`),
    security_boundary_digest:dg(`security-boundary-${label}`),
    max_mutated_files:4,
    max_edit_operations:16,
    max_changed_bytes:65536,
    external_revision_controller:true,
    ...overrides,
  });
}
function proposal(env,label='one',overrides={}){
  return createRsiBoundedRevisionProposal({
    proposal_id:`revision.proposal.${label}`,
    envelope:env,
    candidate_revision_spec_digest:dg(`revision-spec-${label}`),
    proposed_child_artifact_identity_digest:dg(`child-artifact-${label}`),
    mutation_categories:['CONTROL_FLOW','VALIDATION'],
    estimated_mutated_files:2,
    estimated_edit_operations:6,
    estimated_changed_bytes:8192,
    expected_preserved_behavior_receipt_digest:dg(`expected-preservation-${label}`),
    expected_regression_test_root_digest:dg(`regression-tests-${label}`),
    candidate_optimizer_id_digest:dg(`optimizer-${label}`),
    authored_by_optimizer:true,
    ...overrides,
  });
}

test('external envelope binds exact supported experiment and immutable policy boundaries',()=>{
  const fx=experimentFixture();
  const env=envelope(fx);
  const checked=verifyRsiBoundedRevisionEnvelope(env,{intent:fx.intent,receipt:fx.receipt});
  assert.equal(checked.envelope_digest,env.envelope_digest);
  assert.equal(env.parent_candidate_artifact_digest,fx.receipt.candidate_artifact_digest);
  assert.equal(env.parent_artifact_preserved,true);
  assert.equal(env.candidate_must_be_new_artifact,true);
  assert.equal(env.protected_policy_roots_immutable,true);
  assert.equal(env.rejected_experiment_evidence_must_be_considered,true);
  assert.equal(env.regression_budget_precommitted,true);
  assert.equal(env.envelope_can_apply_revision,false);
  assert.equal(env.envelope_can_schedule_implementation,false);
  assert.equal(env.authority_effect,false);
});

test('rejected experiment cannot authorize a revision envelope',()=>{
  const fx=experimentFixture('rejected',{supported:false});
  assert.equal(fx.receipt.state,'CANDIDATE_EXPERIMENT_REJECTED');
  assert.throws(()=>envelope(fx,'rejected'),/supported_experiment_required/);
});

test('revision envelope enforces small edit budgets and independent protected roots',()=>{
  const fx=experimentFixture('limits');
  assert.throws(()=>envelope(fx,'too-many-files',{max_mutated_files:5}),/max_mutated_files_invalid/);
  assert.throws(()=>envelope(fx,'too-many-ops',{max_edit_operations:17}),/max_edit_operations_invalid/);
  assert.throws(()=>envelope(fx,'too-many-bytes',{max_changed_bytes:65537}),/max_changed_bytes_invalid/);
  const same=dg('same-policy-root');
  assert.throws(()=>envelope(fx,'root-alias',{
    trust_root_policy_digest:same,
    evaluator_policy_digest:same,
  }),/independent_policy_roots_required/);
});

test('optimizer may author bounded proposal but proposal cannot write or apply changes',()=>{
  const fx=experimentFixture('proposal');
  const env=envelope(fx,'proposal');
  const p=proposal(env,'proposal');
  assert.equal(verifyRsiBoundedRevisionProposal(p,{envelope:env}).proposal_digest,p.proposal_digest);
  assert.equal(p.authored_by_optimizer,true);
  assert.equal(p.proposal_within_external_envelope,true);
  assert.equal(p.proposal_does_not_apply_changes,true);
  assert.equal(p.parent_artifact_remains_immutable,true);
  assert.equal(p.protected_policy_roots_untouched,true);
  assert.equal(p.external_implementation_review_required,true);
  assert.equal(p.external_paired_validation_required,true);
  assert.equal(p.proposal_can_mutate_active_state,false);
  assert.equal(p.proposal_can_write_repository,false);
  assert.equal(p.proposal_can_schedule_implementation,false);
  assert.equal(p.proposal_is_execution_authority,false);
  assert.equal(p.state,'ELIGIBLE_FOR_EXTERNAL_IMPLEMENTATION_REVIEW');
});

test('proposal cannot exceed external envelope or reuse parent identity',()=>{
  const fx=experimentFixture('proposal-limits');
  const env=envelope(fx,'proposal-limits',{max_mutated_files:2,max_edit_operations:4,max_changed_bytes:4096});
  assert.throws(()=>proposal(env,'files',{estimated_mutated_files:3}),/estimated_mutated_files_invalid/);
  assert.throws(()=>proposal(env,'ops',{estimated_edit_operations:5}),/estimated_edit_operations_invalid/);
  assert.throws(()=>proposal(env,'bytes',{estimated_changed_bytes:4097}),/estimated_changed_bytes_invalid/);
  assert.throws(()=>proposal(env,'same-child',{
    proposed_child_artifact_identity_digest:env.parent_candidate_artifact_digest,
  }),/new_child_identity_required/);
});

test('proposal must be optimizer-authored inside external envelope',()=>{
  const fx=experimentFixture('authorship');
  const env=envelope(fx,'authorship');
  assert.throws(()=>proposal(env,'authorship',{authored_by_optimizer:false}),/optimizer_authorship_required/);
});

test('append-only archive preserves multiple proposals and never selects or applies a winner',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-revision-proposal-archive-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'archive.json');
  const archive=new RsiBoundedRevisionProposalArchive({statePath,source_sha:SOURCE});
  await archive.init();

  const fx1=experimentFixture('archive-one');
  const env1=envelope(fx1,'archive-one');
  const p1=proposal(env1,'archive-one',{mutation_categories:['VALIDATION']});
  assert.equal((await archive.add({envelope:env1,proposal:p1})).state,'ARCHIVED_FOR_EXTERNAL_IMPLEMENTATION_REVIEW');

  const fx2=experimentFixture('archive-two');
  const env2=envelope(fx2,'archive-two');
  const p2=proposal(env2,'archive-two',{mutation_categories:['CONTROL_FLOW','MEMORY']});
  assert.equal((await archive.add({envelope:env2,proposal:p2})).state,'ARCHIVED_FOR_EXTERNAL_IMPLEMENTATION_REVIEW');

  const snap=archive.snapshot();
  assert.equal(snap.row_count,2);
  assert.equal(snap.preserves_multiple_proposals,true);
  assert.equal(snap.scalar_winner_forbidden,true);
  assert.equal(snap.active_artifact_digest,null);
  assert.equal(snap.archive_can_apply_revision,false);
  assert.equal(snap.archive_can_write_repository,false);
  assert.equal(snap.archive_can_schedule_implementation,false);
  assert.ok(snap.represented_mutation_categories.includes('VALIDATION'));
  assert.ok(snap.represented_mutation_categories.includes('MEMORY'));

  const restored=new RsiBoundedRevisionProposalArchive({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,2);
  assert.equal((await restored.add({envelope:env1,proposal:p1})).state,'IDEMPOTENT');
});

test('revision trust root preserves external boundaries and zero authority',()=>{
  const root=rsiBoundedRevisionProposalTrustRootSnapshot();
  assert.equal(root.supported_phase26_experiment_required,true);
  assert.equal(root.external_revision_envelope_required,true);
  assert.equal(root.max_mutated_files,4);
  assert.equal(root.max_edit_operations,16);
  assert.equal(root.max_changed_bytes,65536);
  assert.equal(root.parent_artifact_preserved,true);
  assert.equal(root.new_child_artifact_identity_required,true);
  assert.equal(root.protected_trust_evaluator_scheduler_self_update_production_security_roots_immutable,true);
  assert.equal(root.preserved_behavior_contract_required,true);
  assert.equal(root.negative_evidence_required,true);
  assert.equal(root.regression_budget_precommitted,true);
  assert.equal(root.external_implementation_required,true);
  assert.equal(root.external_paired_validation_required,true);
  assert.equal(root.optimizer_may_author_proposal_but_not_envelope,true);
  assert.equal(root.multiple_proposals_preserved,true);
  assert.equal(root.scalar_winner_forbidden,true);
  assert.equal(root.proposal_can_mutate_active_state,false);
  assert.equal(root.proposal_can_write_repository,false);
  assert.equal(root.proposal_can_schedule_implementation,false);
  assert.equal(root.archive_can_apply_revision,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.bounded_revision_proposal_root_digest,/^sha256:[0-9a-f]{64}$/);
});


test('failed archive rename never exposes a phantom bounded revision proposal',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-revision-proposal-crash-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'archive.json');
  const archive=new RsiBoundedRevisionProposalArchive({statePath,source_sha:SOURCE});
  await archive.init();

  const fx=experimentFixture('crash');
  const env=envelope(fx,'crash');
  const p=proposal(env,'crash');

  const originalRename=fs.rename;
  fs.rename=async()=>{throw Object.assign(new Error('injected_revision_archive_rename_failure'),{code:'EIO'});};
  try{
    await assert.rejects(
      ()=>archive.add({envelope:env,proposal:p}),
      /injected_revision_archive_rename_failure/,
    );
  }finally{
    fs.rename=originalRename;
  }

  assert.equal(archive.snapshot().row_count,0);
  assert.equal(archive.snapshot().represented_mutation_categories.length,0);

  const restored=new RsiBoundedRevisionProposalArchive({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,0);

  assert.equal((await archive.add({envelope:env,proposal:p})).state,'ARCHIVED_FOR_EXTERNAL_IMPLEMENTATION_REVIEW');
  assert.equal(archive.snapshot().row_count,1);
});

test('restart rejects self-rehashed revision policy weakening and forged archive summaries',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-revision-proposal-replay-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'archive.json');
  const archive=new RsiBoundedRevisionProposalArchive({statePath,source_sha:SOURCE});
  await archive.init();

  const fx=experimentFixture('replay');
  const env=envelope(fx,'replay');
  const p=proposal(env,'replay',{mutation_categories:['VALIDATION']});
  await archive.add({envelope:env,proposal:p});

  const raw=JSON.parse(await fs.readFile(statePath,'utf8'));

  const weakened=structuredClone(raw);
  weakened.rows[0].proposal.proposal_can_write_repository=true;
  const weakenedProposal=structuredClone(weakened.rows[0].proposal);
  delete weakenedProposal.proposal_digest;
  weakened.rows[0].proposal.proposal_digest=objectDigest(weakenedProposal);
  const weakenedState=structuredClone(weakened);
  delete weakenedState.state_digest;
  weakened.state_digest=objectDigest(weakenedState);
  const weakenedPath=path.join(dir,'weakened.json');
  await fs.writeFile(weakenedPath,JSON.stringify(weakened),'utf8');
  const weakenedArchive=new RsiBoundedRevisionProposalArchive({statePath:weakenedPath,source_sha:SOURCE});
  await assert.rejects(()=>weakenedArchive.init(),/proposal_policy_invalid/);

  const forged=structuredClone(raw);
  forged.represented_mutation_categories=['FORGED_CATEGORY'];
  const forgedState=structuredClone(forged);
  delete forgedState.state_digest;
  forged.state_digest=objectDigest(forgedState);
  const forgedPath=path.join(dir,'forged.json');
  await fs.writeFile(forgedPath,JSON.stringify(forged),'utf8');
  const forgedArchive=new RsiBoundedRevisionProposalArchive({statePath:forgedPath,source_sha:SOURCE});
  await assert.rejects(()=>forgedArchive.init(),/archive_derived_state_mismatch/);
});
