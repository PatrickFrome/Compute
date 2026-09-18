import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiPostAdoptionExperienceAdmission,
  verifyRsiPostAdoptionExperienceAdmission,
  applyRsiPostAdoptionExperienceAdmission,
  rsiPostAdoptionExperienceAdmissionTrustRootSnapshot,
} from '../src/rsi-post-adoption-experience-admission.mjs';

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}

const CANDIDATE='b'.repeat(40);
const PREVIOUS='a'.repeat(40);
const CANDIDATE_ID='candidate_sha256_'+'c'.repeat(64);

function review(){
  const core={
    schema:'metaengine.rsi.episode-promotion-review.v1',version:1,
    state:'READY_FOR_EXTERNAL_RELEASE_HANDOFF_REVIEW',
    episode_id:'episode-post-adoption-v1',candidate_id:CANDIDATE_ID,candidate_sha:CANDIDATE,
    parent_sha:PREVIOUS,source_sha:PREVIOUS,trust_root_set_digest:'sha256:'+'1'.repeat(64),
    evaluation_bundle_digest:'sha256:'+'2'.repeat(64),promotion_gate_digest:'sha256:'+'3'.repeat(64),
    risk_review_digest:'sha256:'+'4'.repeat(64),risk_confirmation_digest:'sha256:'+'5'.repeat(64),
    artifact_digest:'sha256:'+'6'.repeat(64),provenance_digest:'sha256:'+'7'.repeat(64),
    rollback:{predecessor_sha:PREVIOUS,artifact_digest:'sha256:'+'8'.repeat(64),ready:true,
      ambiguous_effect_replay_allowed:false,automatic_replay_authorized:false},
    all_episode_evidence_pass:true,ordinary_promotion_gate_pass:true,statistical_confirmation_pass:true,
    rollback_ready:true,external_release_handoff_review_required:true,release_handoff_authorized:false,
    direct_install_authorized:false,direct_promotion_authorized:false,existing_self_update_handoff_authorized:false,
    promotion_token:null,physical_effect_replay_allowed:false,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,review_digest:digest(core)};
}

function measurement(state='PARETO_IMPROVEMENT',suffix='9',epoch=42){
  const graph=state==='PARETO_IMPROVEMENT'||state==='REGRESSION';
  const skill=state==='PARETO_IMPROVEMENT';
  const core={
    schema:'metaengine.rsi.post-adoption-causal-measurement.v1',version:1,
    measurement_id:'post-adoption-'+state.toLowerCase()+'-'+suffix,
    successor_verification_digest:'sha256:'+'a'.repeat(64),
    candidate_sha:CANDIDATE,previous_authority_sha:PREVIOUS,
    policy_digest:'sha256:'+'b'.repeat(64),analysis_plan_digest:'sha256:'+'c'.repeat(64),
    design:'MATCHED_REPLAY_HOLDOUT',control_receipt_digest:'sha256:'+'d'.repeat(64),
    candidate_receipt_digest:'sha256:'+suffix.repeat(64),workload_manifest_digest:'sha256:'+'e'.repeat(64),
    environment_fingerprint:'browser-prod-cohort-v1',execution_signature_digest:'sha256:'+'f'.repeat(64),
    observation_epoch:epoch,evaluator_id:'external-deployment-evaluator-v1',
    evaluated_at:'2026-09-18T20:16:00.000Z',
    comparisons:[{name:'TASK_SUCCESS_RATE',role:'PRIMARY',status:state==='REGRESSION'?'REGRESSED':'IMPROVED'}],
    state,hard_invariant_regression:state==='REGRESSION',primary_regression:state==='REGRESSION',
    primary_improvement:state==='PARETO_IMPROVEMENT',
    scalar_reward:null,scalar_reward_authoritative:false,external_synthesizer:true,authored_by_candidate:false,
    eligible_for_experience_graph:graph,eligible_for_skill_evolution:skill,eligible_for_next_autonomous_episode:graph,
    experience_graph_write_performed:false,skill_library_write_performed:false,next_episode_created:false,
    promotion_effect:false,self_update_effect:false,candidate_can_change_measurement:false,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,measurement_digest:digest(core)};
}

function admit(state='PARETO_IMPROVEMENT',suffix='9',epoch=42,overrides={}){
  return createRsiPostAdoptionExperienceAdmission({
    post_adoption_measurement:measurement(state,suffix,epoch),episode_promotion_review:review(),
    model_family:'METAENGINE_BROWSER',evidence_refs:['deployment-metrics-'+suffix],
    external_graph_writer:true,authored_by_candidate:false,...overrides,
  });
}

test('Pareto post-adoption evidence becomes one append-only SUCCESS case in the existing graph',()=>{
  const a=admit();
  verifyRsiPostAdoptionExperienceAdmission(a);
  assert.equal(a.outcome,'SUCCESS');
  assert.equal(a.experience_case.outcome,'SUCCESS');
  assert.equal(a.experience_case.candidate_id,CANDIDATE_ID);
  assert.equal(a.experience_case.candidate_sha,CANDIDATE);
  assert.equal(a.graph_source_sha,PREVIOUS);
  assert.equal(a.graph_id,'rsi.runtime.experience.'+PREVIOUS.slice(0,16));
  assert.equal(a.experience_case.raw_trajectory_present,false);
  assert.equal(a.candidate_can_write_graph,false);
  assert.equal(a.skill_library_write_performed,false);
  assert.equal(a.next_episode_created,false);

  const graph=applyRsiPostAdoptionExperienceAdmission({admission:a});
  assert.equal(graph.case_count,1);
  assert.equal(graph.task_anchor_count,1);
  assert.equal(graph.cases[0].case_digest,a.experience_case.case_digest);
  assert.equal(graph.graph_writer_external_only,true);
});

test('verified deployment regression becomes a FAILURE case and never positive skill state',()=>{
  const a=admit('REGRESSION','8',43);
  assert.equal(a.outcome,'FAILURE');
  assert.equal(a.experience_case.outcome,'FAILURE');
  assert.ok(a.experience_case.failure_codes.includes('POST_ADOPTION_REGRESSION'));
  assert.ok(a.experience_case.failure_codes.includes('HARD_INVARIANT_REGRESSION'));
  assert.equal(a.skill_library_write_performed,false);
});

test('non-learning measurement cannot be inserted into the experience graph',()=>{
  assert.throws(()=>admit('NO_CLEAR_CHANGE','7',44),/measurement_not_learning_eligible/);
});

test('promotion review must bind the exact deployed candidate id and sha',()=>{
  const bad=review();
  bad.candidate_sha='f'.repeat(40);
  const clone=structuredClone(bad);delete clone.review_digest;bad.review_digest=digest(clone);
  assert.throws(()=>createRsiPostAdoptionExperienceAdmission({
    post_adoption_measurement:measurement(),episode_promotion_review:bad,
    model_family:'METAENGINE_BROWSER',evidence_refs:['deployment-metrics-x'],
    external_graph_writer:true,authored_by_candidate:false,
  }),/promotion_candidate_mismatch/);
});

test('candidate-authored graph admission is rejected',()=>{
  assert.throws(()=>createRsiPostAdoptionExperienceAdmission({
    post_adoption_measurement:measurement(),episode_promotion_review:review(),
    model_family:'METAENGINE_BROWSER',evidence_refs:['deployment-metrics-y'],
    external_graph_writer:true,authored_by_candidate:true,
  }),/external_writer_required/);
});

test('multiple post-adoption cases extend one candidate-scoped graph without replacement',()=>{
  const a1=admit('PARETO_IMPROVEMENT','9',42);
  const a2=admit('REGRESSION','8',43);
  const g1=applyRsiPostAdoptionExperienceAdmission({admission:a1});
  const g2=applyRsiPostAdoptionExperienceAdmission({previous_snapshot:g1,admission:a2});
  assert.equal(g2.epoch,2);
  assert.equal(g2.case_count,2);
  assert.equal(g2.task_anchor_count,2);
  assert.equal(g2.predecessor_snapshot_digest,g1.snapshot_digest);
});

test('graph source drift and admission authority widening fail closed',()=>{
  const a=admit();
  const g=applyRsiPostAdoptionExperienceAdmission({admission:a});
  const wrong={...g,graph_id:'rsi.runtime.experience.'+'f'.repeat(16)};
  const core=structuredClone(wrong);delete core.snapshot_digest;wrong.snapshot_digest=digest(core);
  assert.throws(()=>applyRsiPostAdoptionExperienceAdmission({previous_snapshot:wrong,admission:admit('REGRESSION','8',43)}),/graph_source_mismatch/);

  for(const mutate of [
    x=>{x.candidate_can_write_graph=true;},
    x=>{x.graph_write_authorizes_execution=true;},
    x=>{x.skill_library_write_performed=true;},
    x=>{x.next_episode_created=true;},
    x=>{x.self_update_authority=true;},
  ]){
    const copy=structuredClone(a);mutate(copy);
    assert.throws(()=>verifyRsiPostAdoptionExperienceAdmission(copy),/(policy_invalid|self_update_authority_invalid)/);
  }
});

test('post-adoption graph trust root reuses the existing graph without authority expansion',()=>{
  const root=rsiPostAdoptionExperienceAdmissionTrustRootSnapshot();
  assert.equal(root.existing_experience_graph_only,true);
  assert.equal(root.append_only_graph_admission,true);
  assert.equal(root.graph_identity_uses_runtime_source_lineage,true);
  assert.equal(root.exact_candidate_id_from_promotion_review_required,true);
  assert.equal(root.only_pareto_or_verified_regression_measurements,true);
  assert.equal(root.pareto_maps_to_success_case,true);
  assert.equal(root.regression_maps_to_failure_case,true);
  assert.equal(root.contextual_measurement_not_global_truth,true);
  assert.equal(root.candidate_can_write_graph,false);
  assert.equal(root.skill_library_write_performed_here,false);
  assert.equal(root.next_episode_created_here,false);
  assert.equal(root.graph_write_authorizes_execution,false);
});
