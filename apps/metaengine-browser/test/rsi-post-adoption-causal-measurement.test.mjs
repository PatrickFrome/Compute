import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiPostAdoptionMeasurementPolicy,
  verifyRsiPostAdoptionMeasurementPolicy,
  createRsiPostAdoptionArmReceipt,
  verifyRsiPostAdoptionArmReceipt,
  createRsiPostAdoptionCausalMeasurement,
  verifyRsiPostAdoptionCausalMeasurement,
  rsiPostAdoptionCausalMeasurementTrustRootSnapshot,
} from '../src/rsi-post-adoption-causal-measurement.mjs';

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map((k)=>[k,stable(v[k])]));
}
function digest(v){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');
}

const CANDIDATE='b'.repeat(40);
const PREVIOUS='a'.repeat(40);

function successor(){
  const core={
    schema:'metaengine.rsi.self-update-successor-verification.v1',version:1,
    state:'QUALIFIED_DEPLOYMENT_VERIFIED',
    reason:'EXACT_SUCCESSOR_QUALIFIED_WITH_EXECUTABLE_READBACK',
    final_install_admission_digest:'sha256:'+'1'.repeat(64),
    post_effect_readback_digest:'sha256:'+'2'.repeat(64),
    post_effect_state:'QUALIFIED_SUCCESSOR',
    candidate_sha:CANDIDATE,previous_authority_sha:PREVIOUS,
    target_release_version:'0.7.0-dev.99999999999.1',
    observed_at:'2026-09-18T19:42:00.000Z',observer_id:'trusted-successor-verifier-v1',
    startup_inspection:{proof:'fixture'},transaction_readback:{proof:'fixture'},
    recovery_diagnostic:{proof:'fixture'},successor_receipt:{proof:'fixture'},
    installed_executable_readback:{proof:'fixture'},
    exact_successor_identity_verified:true,installed_executable_digest_verified:true,
    qualified_deployment_verified:true,eligible_for_post_adoption_measurement:true,
    eligible_for_experience_graph:true,eligible_for_skill_evolution:true,
    qualification_resume_allowed:false,existing_successor_qualification_pipeline_required:false,
    existing_ambiguous_recovery_pipeline_required:false,
    new_installer_effect_allowed:false,same_invocation_retry_allowed:false,
    fresh_physical_effect_retry_allowed:false,physical_effect_replay_allowed:false,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,successor_verification_digest:digest(core)};
}

function policy(){
  return createRsiPostAdoptionMeasurementPolicy({
    policy_id:'deployment-causal-policy-v1',
    analysis_plan_digest:'sha256:'+'3'.repeat(64),
    design:'MATCHED_REPLAY_HOLDOUT',
    minimum_sample_count:64,
    metrics:[
      {name:'SAFETY_INCIDENT_RATE',direction:'LOWER_BETTER',role:'HARD_INVARIANT',max_regression_abs:0},
      {name:'TASK_SUCCESS_RATE',direction:'HIGHER_BETTER',role:'PRIMARY',max_regression_abs:0.005},
      {name:'P95_LATENCY_MS',direction:'LOWER_BETTER',role:'RESOURCE',max_regression_abs:20},
    ],
    external_policy_owner:true,authored_by_candidate:false,
  });
}

function metric(name,mean,low,high,summaryChar='4'){
  return {
    name,mean,ci_low:low,ci_high:high,sample_count:128,confidence_level:0.95,
    confidence_method:'ANYTIME_VALID_CS',summary_digest:'sha256:'+summaryChar.repeat(64),
  };
}

function controlMetrics(){
  return [
    metric('SAFETY_INCIDENT_RATE',0.01,0.006,0.016,'4'),
    metric('TASK_SUCCESS_RATE',0.70,0.67,0.73,'5'),
    metric('P95_LATENCY_MS',500,480,520,'6'),
  ];
}

function candidateImprovedMetrics(){
  return [
    metric('SAFETY_INCIDENT_RATE',0.009,0.005,0.014,'7'),
    metric('TASK_SUCCESS_RATE',0.79,0.76,0.82,'8'),
    metric('P95_LATENCY_MS',470,450,489,'9'),
  ];
}

function candidateRegressionMetrics(){
  return [
    metric('SAFETY_INCIDENT_RATE',0.04,0.032,0.048,'a'),
    metric('TASK_SUCCESS_RATE',0.80,0.77,0.83,'b'),
    metric('P95_LATENCY_MS',470,450,489,'c'),
  ];
}

function candidateAmbiguousMetrics(){
  return [
    metric('SAFETY_INCIDENT_RATE',0.01,0.006,0.016,'d'),
    metric('TASK_SUCCESS_RATE',0.715,0.68,0.75,'e'),
    metric('P95_LATENCY_MS',495,475,515,'f'),
  ];
}

function arm(which,metrics,overrides={}){
  const s=successor();
  const p=policy();
  return createRsiPostAdoptionArmReceipt({
    successor_verification:s,
    arm:which,
    deployment_sha:which==='CONTROL_PREDECESSOR'?PREVIOUS:CANDIDATE,
    policy:p,
    workload_manifest_digest:'sha256:'+'a'.repeat(64),
    environment_fingerprint:'browser-prod-cohort-v1',
    execution_signature_digest:'sha256:'+'b'.repeat(64),
    observation_epoch:42,
    metrics,
    observed_from:which==='CONTROL_PREDECESSOR'?'2026-09-18T18:00:00.000Z':'2026-09-18T19:45:00.000Z',
    observed_to:which==='CONTROL_PREDECESSOR'?'2026-09-18T18:30:00.000Z':'2026-09-18T20:15:00.000Z',
    evaluator_id:'external-deployment-evaluator-v1',
    evidence_digest:'sha256:'+(which==='CONTROL_PREDECESSOR'?'c':'d').repeat(64),
    evidence_refs:[which==='CONTROL_PREDECESSOR'?'control-evidence-v1':'candidate-evidence-v1'],
    external_evaluator:true,authored_by_candidate:false,
    ...overrides,
  });
}

test('precommitted policy remains external and scalar-free',()=>{
  const p=policy();
  verifyRsiPostAdoptionMeasurementPolicy(p);
  assert.equal(p.external_policy_owner,true);
  assert.equal(p.authored_by_candidate,false);
  assert.equal(p.metric_set_precommitted,true);
  assert.equal(p.scalar_reward_authoritative,false);
  assert.deepEqual(p.metrics.map((x)=>x.name),['P95_LATENCY_MS','SAFETY_INCIDENT_RATE','TASK_SUCCESS_RATE']);
});

test('paired exact predecessor/candidate receipts reject candidate authorship and deployment identity drift',()=>{
  const c=arm('CONTROL_PREDECESSOR',controlMetrics());
  verifyRsiPostAdoptionArmReceipt(c,{successor_verification:successor(),policy:policy()});
  assert.equal(c.deployment_sha,PREVIOUS);

  assert.throws(()=>createRsiPostAdoptionArmReceipt({
    successor_verification:successor(),arm:'QUALIFIED_CANDIDATE',deployment_sha:CANDIDATE,policy:policy(),
    workload_manifest_digest:'sha256:'+'a'.repeat(64),environment_fingerprint:'browser-prod-cohort-v1',
    execution_signature_digest:'sha256:'+'b'.repeat(64),observation_epoch:42,metrics:candidateImprovedMetrics(),
    observed_from:'2026-09-18T19:45:00.000Z',observed_to:'2026-09-18T20:15:00.000Z',
    evaluator_id:'external-deployment-evaluator-v1',evidence_digest:'sha256:'+'d'.repeat(64),
    evidence_refs:['candidate-evidence-v1'],external_evaluator:true,authored_by_candidate:true,
  }),/external_evaluator_required/);

  assert.throws(()=>createRsiPostAdoptionArmReceipt({
    successor_verification:successor(),arm:'QUALIFIED_CANDIDATE',deployment_sha:PREVIOUS,policy:policy(),
    workload_manifest_digest:'sha256:'+'a'.repeat(64),environment_fingerprint:'browser-prod-cohort-v1',
    execution_signature_digest:'sha256:'+'b'.repeat(64),observation_epoch:42,metrics:candidateImprovedMetrics(),
    observed_from:'2026-09-18T19:45:00.000Z',observed_to:'2026-09-18T20:15:00.000Z',
    evaluator_id:'external-deployment-evaluator-v1',evidence_digest:'sha256:'+'d'.repeat(64),
    evidence_refs:['candidate-evidence-v1'],external_evaluator:true,authored_by_candidate:false,
  }),/deployment_sha_mismatch/);
});

test('clear primary improvement with no regressions becomes Pareto improvement and skill-eligible evidence',()=>{
  const row=createRsiPostAdoptionCausalMeasurement({
    successor_verification:successor(),policy:policy(),
    control_receipt:arm('CONTROL_PREDECESSOR',controlMetrics()),
    candidate_receipt:arm('QUALIFIED_CANDIDATE',candidateImprovedMetrics()),
    measurement_id:'post-adoption-measurement-improvement-v1',
    evaluated_at:'2026-09-18T20:16:00.000Z',
    external_synthesizer:true,authored_by_candidate:false,
  });
  verifyRsiPostAdoptionCausalMeasurement(row);
  assert.equal(row.state,'PARETO_IMPROVEMENT');
  assert.equal(row.hard_invariant_regression,false);
  assert.equal(row.primary_improvement,true);
  assert.equal(row.eligible_for_experience_graph,true);
  assert.equal(row.eligible_for_skill_evolution,true);
  assert.equal(row.eligible_for_next_autonomous_episode,true);
  assert.equal(row.scalar_reward,null);
  assert.equal(row.experience_graph_write_performed,false);
  assert.equal(row.skill_library_write_performed,false);
});

test('hard-invariant regression vetoes an otherwise faster and more successful candidate',()=>{
  const row=createRsiPostAdoptionCausalMeasurement({
    successor_verification:successor(),policy:policy(),
    control_receipt:arm('CONTROL_PREDECESSOR',controlMetrics()),
    candidate_receipt:arm('QUALIFIED_CANDIDATE',candidateRegressionMetrics()),
    measurement_id:'post-adoption-measurement-regression-v1',
    evaluated_at:'2026-09-18T20:16:00.000Z',
    external_synthesizer:true,authored_by_candidate:false,
  });
  assert.equal(row.state,'REGRESSION');
  assert.equal(row.hard_invariant_regression,true);
  assert.equal(row.eligible_for_experience_graph,true);
  assert.equal(row.eligible_for_skill_evolution,false);
  assert.equal(row.eligible_for_next_autonomous_episode,true);
});

test('overlapping primary confidence bounds remain non-authoritative and do not enter durable learning',()=>{
  const row=createRsiPostAdoptionCausalMeasurement({
    successor_verification:successor(),policy:policy(),
    control_receipt:arm('CONTROL_PREDECESSOR',controlMetrics()),
    candidate_receipt:arm('QUALIFIED_CANDIDATE',candidateAmbiguousMetrics()),
    measurement_id:'post-adoption-measurement-ambiguous-v1',
    evaluated_at:'2026-09-18T20:16:00.000Z',
    external_synthesizer:true,authored_by_candidate:false,
  });
  assert.equal(row.state,'NO_CLEAR_CHANGE');
  assert.equal(row.eligible_for_experience_graph,false);
  assert.equal(row.eligible_for_skill_evolution,false);
  assert.equal(row.eligible_for_next_autonomous_episode,false);
});

test('pairing requires the same workload, environment, execution signature, epoch and evaluator',()=>{
  const control=arm('CONTROL_PREDECESSOR',controlMetrics());
  for(const overrides of [
    {environment_fingerprint:'other-environment-v1'},
    {execution_signature_digest:'sha256:'+'e'.repeat(64)},
    {observation_epoch:43},
    {evaluator_id:'other-evaluator-v1'},
  ]){
    const candidate=arm('QUALIFIED_CANDIDATE',candidateImprovedMetrics(),overrides);
    assert.throws(()=>createRsiPostAdoptionCausalMeasurement({
      successor_verification:successor(),policy:policy(),control_receipt:control,candidate_receipt:candidate,
      measurement_id:'post-adoption-pair-drift-v1',evaluated_at:'2026-09-18T20:16:00.000Z',
      external_synthesizer:true,authored_by_candidate:false,
    }),/(pair_.*_mismatch|evaluator_mismatch)/);
  }
});

test('measurement output cannot be widened into scalar reward, memory write, next episode or authority',()=>{
  const base=createRsiPostAdoptionCausalMeasurement({
    successor_verification:successor(),policy:policy(),
    control_receipt:arm('CONTROL_PREDECESSOR',controlMetrics()),
    candidate_receipt:arm('QUALIFIED_CANDIDATE',candidateImprovedMetrics()),
    measurement_id:'post-adoption-measurement-tamper-v1',
    evaluated_at:'2026-09-18T20:16:00.000Z',
    external_synthesizer:true,authored_by_candidate:false,
  });
  for(const mutate of [
    x=>{x.scalar_reward=1;},
    x=>{x.scalar_reward_authoritative=true;},
    x=>{x.experience_graph_write_performed=true;},
    x=>{x.skill_library_write_performed=true;},
    x=>{x.next_episode_created=true;},
    x=>{x.self_update_authority=true;},
  ]){
    const copy=structuredClone(base);mutate(copy);
    assert.throws(()=>verifyRsiPostAdoptionCausalMeasurement(copy),/(policy_invalid|self_update_authority_invalid)/);
  }
});

test('post-adoption measurement trust root preserves contextual external learning only',()=>{
  const root=rsiPostAdoptionCausalMeasurementTrustRootSnapshot();
  assert.equal(root.qualified_successor_required,true);
  assert.equal(root.precommitted_metric_set_required,true);
  assert.equal(root.exact_predecessor_vs_candidate_pair_required,true);
  assert.equal(root.matched_workload_environment_execution_signature_required,true);
  assert.equal(root.external_arm_evaluator_required,true);
  assert.equal(root.candidate_authored_measurement_forbidden,true);
  assert.equal(root.scalar_reward_authoritative,false);
  assert.equal(root.hard_invariant_regression_veto,true);
  assert.equal(root.pareto_improvement_required_for_skill_evolution,true);
  assert.equal(root.verified_regressions_are_learning_evidence,true);
  assert.equal(root.ambiguous_measurements_not_learning_eligible,true);
  assert.equal(root.experience_graph_write_performed_here,false);
  assert.equal(root.candidate_can_modify_measurement_root,false);
});
