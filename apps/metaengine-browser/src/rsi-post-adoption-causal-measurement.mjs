import crypto from 'node:crypto';

import {
  verifyRsiSelfUpdateSuccessorVerification,
} from './rsi-self-update-successor-verification.mjs';

export const RSI_POST_ADOPTION_ARM_RECEIPT_SCHEMA =
  'metaengine.rsi.post-adoption-arm-receipt.v1';
export const RSI_POST_ADOPTION_POLICY_SCHEMA =
  'metaengine.rsi.post-adoption-measurement-policy.v1';
export const RSI_POST_ADOPTION_CAUSAL_MEASUREMENT_SCHEMA =
  'metaengine.rsi.post-adoption-causal-measurement.v1';

const SHA40=/^[0-9a-f]{40}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:@/+:-]{2,255}$/;
const TOKEN=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const ARMS=new Set(['CONTROL_PREDECESSOR','QUALIFIED_CANDIDATE']);
const DESIGNS=new Set(['MATCHED_REPLAY_HOLDOUT','INTERLEAVED_CANARY']);
const DIRECTIONS=new Set(['HIGHER_BETTER','LOWER_BETTER']);
const ROLES=new Set(['HARD_INVARIANT','PRIMARY','RESOURCE']);
const CONFIDENCE_METHODS=new Set([
  'ANYTIME_VALID_CS',
  'PRECOMMITTED_BOOTSTRAP_BCA',
  'EXACT_BINOMIAL',
]);

const MAX_METRICS=12;
const MAX_EVIDENCE_REFS=24;
const MIN_SAMPLES=16;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map((k)=>[k,stable(v[k])]));
}
function digest(v){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');
}
function exactSha(v,l){
  const o=String(v||'').trim().toLowerCase();
  if(!SHA40.test(o))throw new Error('rsi_post_adoption_'+l+'_sha_invalid');
  return o;
}
function exactDigest(v,l){
  const o=String(v||'').trim().toLowerCase();
  if(!SHA256.test(o))throw new Error('rsi_post_adoption_'+l+'_digest_invalid');
  return o;
}
function exactUtc(v,l){
  const o=String(v||'');
  if(!UTC.test(o)||!Number.isFinite(Date.parse(o)))throw new Error('rsi_post_adoption_'+l+'_time_invalid');
  return new Date(Date.parse(o)).toISOString();
}
function safeId(v,l){
  const o=String(v||'').trim();
  if(!SAFE_ID.test(o))throw new Error('rsi_post_adoption_'+l+'_invalid');
  return o;
}
function token(v,l){
  const o=String(v||'').trim().toUpperCase();
  if(!TOKEN.test(o))throw new Error('rsi_post_adoption_'+l+'_invalid');
  return o;
}
function positiveInt(v,l,{min=1,max=1_000_000}={}){
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('rsi_post_adoption_'+l+'_invalid');
  return n;
}
function finite(v,l){
  const n=Number(v);
  if(!Number.isFinite(n))throw new Error('rsi_post_adoption_'+l+'_invalid');
  return n;
}
function nonNegative(v,l){
  const n=finite(v,l);
  if(n<0)throw new Error('rsi_post_adoption_'+l+'_invalid');
  return n;
}
function unit(v,l){
  const n=finite(v,l);
  if(n<0||n>1)throw new Error('rsi_post_adoption_'+l+'_invalid');
  return n;
}
function assertZero(v,l){
  for(const f of [
    'execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority',
    'self_update_authority','authority_effect',
  ]){
    if(Object.hasOwn(v||{},f)&&v[f]!==false){
      throw new Error('rsi_post_adoption_'+l+'_'+f+'_invalid');
    }
  }
  if(Object.hasOwn(v||{},'automatic_retry_allowed')&&v.automatic_retry_allowed!==false){
    throw new Error('rsi_post_adoption_'+l+'_automatic_retry_invalid');
  }
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  });
}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_EVIDENCE_REFS){
    throw new Error('rsi_post_adoption_evidence_refs_invalid');
  }
  const out=value.map((v)=>safeId(v,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_post_adoption_evidence_ref_duplicate');
  return Object.freeze(out);
}

function normalizeMetricSummary(row, label){
  if(!row||typeof row!=='object'||Array.isArray(row)){
    throw new Error('rsi_post_adoption_'+label+'_metric_invalid');
  }
  const name=token(row.name,label+'_metric_name');
  const method=token(row.confidence_method,label+'_confidence_method');
  if(!CONFIDENCE_METHODS.has(method))throw new Error('rsi_post_adoption_'+label+'_confidence_method_unsupported');
  const n=positiveInt(row.sample_count,label+'_sample_count',{min:MIN_SAMPLES});
  const mean=finite(row.mean,label+'_mean');
  const low=finite(row.ci_low,label+'_ci_low');
  const high=finite(row.ci_high,label+'_ci_high');
  if(low>mean||mean>high)throw new Error('rsi_post_adoption_'+label+'_confidence_interval_invalid');
  const confidence=unit(row.confidence_level,label+'_confidence_level');
  if(confidence<0.90)throw new Error('rsi_post_adoption_'+label+'_confidence_level_too_low');
  return Object.freeze({
    name,mean,ci_low:low,ci_high:high,sample_count:n,
    confidence_level:confidence,confidence_method:method,
    summary_digest:exactDigest(row.summary_digest,label+'_summary'),
  });
}

function normalizeMetrics(value,label){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_METRICS){
    throw new Error('rsi_post_adoption_'+label+'_metrics_invalid');
  }
  const out=value.map((row)=>normalizeMetricSummary(row,label));
  const names=out.map((x)=>x.name);
  if(new Set(names).size!==names.length)throw new Error('rsi_post_adoption_'+label+'_metric_duplicate');
  return Object.freeze([...out].sort((a,b)=>a.name.localeCompare(b.name)));
}

function normalizePolicyMetric(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_post_adoption_policy_metric_invalid');
  const name=token(row.name,'policy_metric_name');
  const direction=token(row.direction,'policy_direction');
  const role=token(row.role,'policy_role');
  if(!DIRECTIONS.has(direction))throw new Error('rsi_post_adoption_policy_direction_invalid');
  if(!ROLES.has(role))throw new Error('rsi_post_adoption_policy_role_invalid');
  const tolerance=nonNegative(row.max_regression_abs??0,'policy_max_regression_abs');
  return Object.freeze({
    name,direction,role,max_regression_abs:tolerance,
  });
}

export function createRsiPostAdoptionMeasurementPolicy({
  policy_id,
  analysis_plan_digest,
  design,
  metrics,
  minimum_sample_count=MIN_SAMPLES,
  external_policy_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_policy_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_post_adoption_external_policy_owner_required');
  }
  const d=token(design,'design');
  if(!DESIGNS.has(d))throw new Error('rsi_post_adoption_design_invalid');
  if(!Array.isArray(metrics)||metrics.length<1||metrics.length>MAX_METRICS){
    throw new Error('rsi_post_adoption_policy_metrics_invalid');
  }
  const normalized=metrics.map(normalizePolicyMetric).sort((a,b)=>a.name.localeCompare(b.name));
  if(new Set(normalized.map((x)=>x.name)).size!==normalized.length){
    throw new Error('rsi_post_adoption_policy_metric_duplicate');
  }
  if(!normalized.some((x)=>x.role==='PRIMARY')){
    throw new Error('rsi_post_adoption_primary_metric_required');
  }
  const core=zero({
    schema:RSI_POST_ADOPTION_POLICY_SCHEMA,version:1,
    policy_id:safeId(policy_id,'policy_id'),
    analysis_plan_digest:exactDigest(analysis_plan_digest,'analysis_plan'),
    design:d,
    minimum_sample_count:positiveInt(minimum_sample_count,'minimum_sample_count',{min:MIN_SAMPLES}),
    metrics:Object.freeze(normalized),
    external_policy_owner:true,authored_by_candidate:false,
    metric_set_precommitted:true,scalar_reward_authoritative:false,
    candidate_can_change_analysis_plan:false,candidate_can_change_metric_policy:false,
  });
  return Object.freeze({...core,policy_digest:digest(core)});
}

export function verifyRsiPostAdoptionMeasurementPolicy(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_POST_ADOPTION_POLICY_SCHEMA||row.version!==1){
    throw new Error('rsi_post_adoption_policy_schema_invalid');
  }
  assertZero(row,'policy');
  const canonical=createRsiPostAdoptionMeasurementPolicy({
    policy_id:row.policy_id,analysis_plan_digest:row.analysis_plan_digest,design:row.design,
    metrics:row.metrics,minimum_sample_count:row.minimum_sample_count,
    external_policy_owner:true,authored_by_candidate:false,
  });
  if(canonical.policy_digest!==exactDigest(row.policy_digest,'policy')){
    throw new Error('rsi_post_adoption_policy_digest_mismatch');
  }
  return row;
}

export function createRsiPostAdoptionArmReceipt({
  successor_verification,
  arm,
  deployment_sha,
  policy,
  workload_manifest_digest,
  environment_fingerprint,
  execution_signature_digest,
  observation_epoch,
  metrics,
  observed_from,
  observed_to,
  evaluator_id,
  evidence_digest,
  evidence_refs,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  const successor=verifyRsiSelfUpdateSuccessorVerification(successor_verification);
  if(successor.state!=='QUALIFIED_DEPLOYMENT_VERIFIED'||successor.eligible_for_post_adoption_measurement!==true){
    throw new Error('rsi_post_adoption_qualified_successor_required');
  }
  const checkedPolicy=verifyRsiPostAdoptionMeasurementPolicy(policy);
  if(external_evaluator!==true||authored_by_candidate!==false){
    throw new Error('rsi_post_adoption_external_evaluator_required');
  }
  const normalizedArm=token(arm,'arm');
  if(!ARMS.has(normalizedArm))throw new Error('rsi_post_adoption_arm_invalid');
  const expectedSha=normalizedArm==='QUALIFIED_CANDIDATE'
    ?successor.candidate_sha:successor.previous_authority_sha;
  if(exactSha(deployment_sha,'deployment')!==expectedSha){
    throw new Error('rsi_post_adoption_deployment_sha_mismatch');
  }
  const normalizedMetrics=normalizeMetrics(metrics,'arm');
  const policyNames=checkedPolicy.metrics.map((x)=>x.name);
  const metricNames=normalizedMetrics.map((x)=>x.name);
  if(JSON.stringify(policyNames)!==JSON.stringify(metricNames)){
    throw new Error('rsi_post_adoption_metric_set_mismatch');
  }
  for(const metric of normalizedMetrics){
    if(metric.sample_count<checkedPolicy.minimum_sample_count){
      throw new Error('rsi_post_adoption_sample_count_below_policy');
    }
  }
  const from=exactUtc(observed_from,'observed_from');
  const to=exactUtc(observed_to,'observed_to');
  if(Date.parse(to)<=Date.parse(from))throw new Error('rsi_post_adoption_window_invalid');
  const core=zero({
    schema:RSI_POST_ADOPTION_ARM_RECEIPT_SCHEMA,version:1,
    successor_verification_digest:successor.successor_verification_digest,
    arm:normalizedArm,deployment_sha:expectedSha,
    policy_digest:checkedPolicy.policy_digest,
    analysis_plan_digest:checkedPolicy.analysis_plan_digest,
    design:checkedPolicy.design,
    workload_manifest_digest:exactDigest(workload_manifest_digest,'workload_manifest'),
    environment_fingerprint:safeId(environment_fingerprint,'environment_fingerprint'),
    execution_signature_digest:exactDigest(execution_signature_digest,'execution_signature'),
    observation_epoch:positiveInt(observation_epoch,'observation_epoch'),
    metrics:normalizedMetrics,
    observed_from:from,observed_to:to,
    evaluator_id:safeId(evaluator_id,'evaluator_id'),
    evidence_digest:exactDigest(evidence_digest,'evidence'),
    evidence_refs:refs(evidence_refs),
    external_evaluator:true,authored_by_candidate:false,
    raw_trajectory_persisted:false,raw_page_text_persisted:false,raw_user_input_persisted:false,
    candidate_can_edit_receipt:false,receipt_is_promotion_authority:false,
    scalar_reward_authoritative:false,
  });
  return Object.freeze({...core,arm_receipt_digest:digest(core)});
}

export function verifyRsiPostAdoptionArmReceipt(row,{successor_verification,policy}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_POST_ADOPTION_ARM_RECEIPT_SCHEMA||row.version!==1){
    throw new Error('rsi_post_adoption_arm_schema_invalid');
  }
  assertZero(row,'arm');
  const canonical=createRsiPostAdoptionArmReceipt({
    successor_verification,arm:row.arm,deployment_sha:row.deployment_sha,policy,
    workload_manifest_digest:row.workload_manifest_digest,
    environment_fingerprint:row.environment_fingerprint,
    execution_signature_digest:row.execution_signature_digest,
    observation_epoch:row.observation_epoch,metrics:row.metrics,
    observed_from:row.observed_from,observed_to:row.observed_to,
    evaluator_id:row.evaluator_id,evidence_digest:row.evidence_digest,evidence_refs:row.evidence_refs,
    external_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.arm_receipt_digest!==exactDigest(row.arm_receipt_digest,'arm_receipt')){
    throw new Error('rsi_post_adoption_arm_receipt_digest_mismatch');
  }
  return row;
}

function compareMetric(control,candidate,policy){
  if(control.name!==candidate.name||control.name!==policy.name){
    throw new Error('rsi_post_adoption_metric_binding_mismatch');
  }
  const lowerBetter=policy.direction==='LOWER_BETTER';
  const rawDelta=candidate.mean-control.mean;
  const signedDelta=lowerBetter?-rawDelta:rawDelta;
  const improves=lowerBetter
    ?candidate.ci_high<control.ci_low
    :candidate.ci_low>control.ci_high;
  const regresses=lowerBetter
    ?candidate.ci_low>control.ci_high
    :candidate.ci_high<control.ci_low;
  const absoluteRegression=Math.max(0,-signedDelta);
  const exceedsTolerance=absoluteRegression>policy.max_regression_abs;
  let status='INCONCLUSIVE';
  if(improves)status='IMPROVED';
  else if(regresses||exceedsTolerance)status='REGRESSED';
  else status='NO_CLEAR_CHANGE';
  return Object.freeze({
    name:policy.name,direction:policy.direction,role:policy.role,
    control_mean:control.mean,candidate_mean:candidate.mean,
    raw_delta:rawDelta,direction_adjusted_delta:signedDelta,
    control_ci:Object.freeze([control.ci_low,control.ci_high]),
    candidate_ci:Object.freeze([candidate.ci_low,candidate.ci_high]),
    sample_count_control:control.sample_count,sample_count_candidate:candidate.sample_count,
    confidence_level:Math.min(control.confidence_level,candidate.confidence_level),
    confidence_method_control:control.confidence_method,
    confidence_method_candidate:candidate.confidence_method,
    max_regression_abs:policy.max_regression_abs,
    regression_abs:absoluteRegression,
    status,
    authority_effect:false,
  });
}

export function createRsiPostAdoptionCausalMeasurement({
  successor_verification,
  policy,
  control_receipt,
  candidate_receipt,
  measurement_id,
  evaluated_at,
  external_synthesizer=false,
  authored_by_candidate=true,
}={}){
  const successor=verifyRsiSelfUpdateSuccessorVerification(successor_verification);
  if(successor.state!=='QUALIFIED_DEPLOYMENT_VERIFIED'){
    throw new Error('rsi_post_adoption_qualified_successor_required');
  }
  const checkedPolicy=verifyRsiPostAdoptionMeasurementPolicy(policy);
  const control=verifyRsiPostAdoptionArmReceipt(control_receipt,{successor_verification:successor,policy:checkedPolicy});
  const candidate=verifyRsiPostAdoptionArmReceipt(candidate_receipt,{successor_verification:successor,policy:checkedPolicy});
  if(control.arm!=='CONTROL_PREDECESSOR'||candidate.arm!=='QUALIFIED_CANDIDATE'){
    throw new Error('rsi_post_adoption_arm_pair_invalid');
  }
  if(external_synthesizer!==true||authored_by_candidate!==false){
    throw new Error('rsi_post_adoption_external_synthesizer_required');
  }
  for(const field of ['policy_digest','analysis_plan_digest','design','workload_manifest_digest','environment_fingerprint','execution_signature_digest','observation_epoch']){
    if(control[field]!==candidate[field])throw new Error('rsi_post_adoption_pair_'+field+'_mismatch');
  }
  if(control.evaluator_id!==candidate.evaluator_id){
    throw new Error('rsi_post_adoption_evaluator_mismatch');
  }

  const comparisons=checkedPolicy.metrics.map((metric)=>{
    const left=control.metrics.find((x)=>x.name===metric.name);
    const right=candidate.metrics.find((x)=>x.name===metric.name);
    return compareMetric(left,right,metric);
  });
  const hardRegression=comparisons.some((x)=>x.role==='HARD_INVARIANT'&&x.status==='REGRESSED');
  const anyRegression=comparisons.some((x)=>x.status==='REGRESSED');
  const primaryImprovement=comparisons.some((x)=>x.role==='PRIMARY'&&x.status==='IMPROVED');
  const primaryRegression=comparisons.some((x)=>x.role==='PRIMARY'&&x.status==='REGRESSED');
  const allPrimaryConclusive=comparisons.filter((x)=>x.role==='PRIMARY').every((x)=>x.status!=='INCONCLUSIVE');

  let state='NO_CLEAR_CHANGE';
  if(hardRegression||primaryRegression)state='REGRESSION';
  else if(primaryImprovement&&!anyRegression)state='PARETO_IMPROVEMENT';
  else if(!allPrimaryConclusive)state='AMBIGUOUS';
  else state='NO_CLEAR_CHANGE';

  const graphEligible=state==='PARETO_IMPROVEMENT'||state==='REGRESSION';
  const skillEligible=state==='PARETO_IMPROVEMENT';
  const nextEpisodeEligible=state==='PARETO_IMPROVEMENT'||state==='REGRESSION';

  const core=zero({
    schema:RSI_POST_ADOPTION_CAUSAL_MEASUREMENT_SCHEMA,version:1,
    measurement_id:safeId(measurement_id,'measurement_id'),
    successor_verification_digest:successor.successor_verification_digest,
    candidate_sha:successor.candidate_sha,previous_authority_sha:successor.previous_authority_sha,
    policy_digest:checkedPolicy.policy_digest,analysis_plan_digest:checkedPolicy.analysis_plan_digest,
    design:checkedPolicy.design,
    control_receipt_digest:control.arm_receipt_digest,
    candidate_receipt_digest:candidate.arm_receipt_digest,
    workload_manifest_digest:control.workload_manifest_digest,
    environment_fingerprint:control.environment_fingerprint,
    execution_signature_digest:control.execution_signature_digest,
    observation_epoch:control.observation_epoch,
    evaluator_id:control.evaluator_id,
    evaluated_at:exactUtc(evaluated_at,'evaluated_at'),
    comparisons:Object.freeze(comparisons),
    state,
    hard_invariant_regression:hardRegression,
    primary_regression:primaryRegression,
    primary_improvement:primaryImprovement,
    scalar_reward:null,
    scalar_reward_authoritative:false,
    external_synthesizer:true,authored_by_candidate:false,
    eligible_for_experience_graph:graphEligible,
    eligible_for_skill_evolution:skillEligible,
    eligible_for_next_autonomous_episode:nextEpisodeEligible,
    experience_graph_write_performed:false,
    skill_library_write_performed:false,
    next_episode_created:false,
    promotion_effect:false,self_update_effect:false,
    candidate_can_change_measurement:false,
  });
  return Object.freeze({...core,measurement_digest:digest(core)});
}

export function verifyRsiPostAdoptionCausalMeasurement(row){
  if(!row||typeof row!=='object'||Array.isArray(row)
    ||row.schema!==RSI_POST_ADOPTION_CAUSAL_MEASUREMENT_SCHEMA||row.version!==1){
    throw new Error('rsi_post_adoption_measurement_schema_invalid');
  }
  assertZero(row,'measurement');
  if(!['PARETO_IMPROVEMENT','REGRESSION','NO_CLEAR_CHANGE','AMBIGUOUS'].includes(row.state)){
    throw new Error('rsi_post_adoption_measurement_state_invalid');
  }
  if(row.scalar_reward!==null||row.scalar_reward_authoritative!==false
    ||row.external_synthesizer!==true||row.authored_by_candidate!==false
    ||row.experience_graph_write_performed!==false||row.skill_library_write_performed!==false
    ||row.next_episode_created!==false||row.promotion_effect!==false||row.self_update_effect!==false
    ||row.candidate_can_change_measurement!==false){
    throw new Error('rsi_post_adoption_measurement_policy_invalid');
  }
  const graphEligible=row.state==='PARETO_IMPROVEMENT'||row.state==='REGRESSION';
  const skillEligible=row.state==='PARETO_IMPROVEMENT';
  const nextEpisodeEligible=graphEligible;
  if(row.eligible_for_experience_graph!==graphEligible
    ||row.eligible_for_skill_evolution!==skillEligible
    ||row.eligible_for_next_autonomous_episode!==nextEpisodeEligible){
    throw new Error('rsi_post_adoption_measurement_eligibility_invalid');
  }
  exactDigest(row.successor_verification_digest,'successor_verification');
  exactDigest(row.policy_digest,'policy');
  exactDigest(row.analysis_plan_digest,'analysis_plan');
  exactDigest(row.control_receipt_digest,'control_receipt');
  exactDigest(row.candidate_receipt_digest,'candidate_receipt');
  exactDigest(row.workload_manifest_digest,'workload_manifest');
  exactDigest(row.execution_signature_digest,'execution_signature');
  exactSha(row.candidate_sha,'candidate');
  exactSha(row.previous_authority_sha,'previous_authority');
  safeId(row.measurement_id,'measurement_id');
  safeId(row.environment_fingerprint,'environment_fingerprint');
  safeId(row.evaluator_id,'evaluator_id');
  exactUtc(row.evaluated_at,'evaluated_at');
  if(!Array.isArray(row.comparisons)||row.comparisons.length<1||row.comparisons.length>MAX_METRICS){
    throw new Error('rsi_post_adoption_comparisons_invalid');
  }
  const clone=structuredClone(row);
  const claimed=exactDigest(clone.measurement_digest,'measurement');
  delete clone.measurement_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_post_adoption_measurement_digest_mismatch');
  return row;
}

export function rsiPostAdoptionCausalMeasurementTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.post-adoption-causal-measurement-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-post-adoption-causal-measurement.mjs',
    qualified_successor_required:true,precommitted_metric_set_required:true,
    exact_predecessor_vs_candidate_pair_required:true,
    matched_workload_environment_execution_signature_required:true,
    external_arm_evaluator_required:true,external_synthesizer_required:true,
    candidate_authored_measurement_forbidden:true,scalar_reward_authoritative:false,
    hard_invariant_regression_veto:true,pareto_improvement_required_for_skill_evolution:true,
    verified_regressions_are_learning_evidence:true,ambiguous_measurements_not_learning_eligible:true,
    experience_graph_write_performed_here:false,skill_library_write_performed_here:false,
    next_episode_created_here:false,candidate_can_modify_measurement_root:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,post_adoption_root_digest:digest(root)});
}
