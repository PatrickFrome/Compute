import crypto from 'node:crypto';

import { verifyRsiExperienceContextPlan } from './rsi-experience-context-planner.mjs';
import { verifyRsiAutonomousEpisodePlan } from './rsi-autonomous-episode-controller.mjs';

export const RSI_EXPERIENCE_CONTEXT_ATTRIBUTION_PLAN_SCHEMA =
  'metaengine.rsi.experience-context-attribution-plan.v1';
export const RSI_EXPERIENCE_CONTEXT_ABLATION_RECEIPT_SCHEMA =
  'metaengine.rsi.experience-context-ablation-receipt.v1';
export const RSI_EXPERIENCE_CONTEXT_ATTRIBUTION_RESULT_SCHEMA =
  'metaengine.rsi.experience-context-attribution-result.v1';

const D=/^sha256:[0-9a-f]{64}$/;
const H=/^[0-9a-f]{64}$/;
const S=/^[0-9a-f]{40}$/;
const I=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const T=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const DIR=new Set(['HIGHER_BETTER','LOWER_BETTER']);
const MAX_CASES=12;
const MAX_METRICS=12;
const MAX_REFS=24;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}
function pd(v,l){const x=String(v||'').trim().toLowerCase();if(!D.test(x))throw new Error('rsi_memattr_'+l+'_digest_invalid');return x}
function hd(v,l){const x=String(v||'').trim().toLowerCase().replace(/^sha256:/,'');if(!H.test(x))throw new Error('rsi_memattr_'+l+'_digest_invalid');return x}
function sha(v,l){const x=String(v||'').trim().toLowerCase();if(!S.test(x))throw new Error('rsi_memattr_'+l+'_sha_invalid');return x}
function id(v,l){const x=String(v||'').trim();if(!I.test(x))throw new Error('rsi_memattr_'+l+'_invalid');return x}
function tok(v,l){const x=String(v||'').trim().toUpperCase();if(!T.test(x))throw new Error('rsi_memattr_'+l+'_invalid');return x}
function num(v,l){const x=Number(v);if(!Number.isFinite(x))throw new Error('rsi_memattr_'+l+'_invalid');return x}
function nonneg(v,l){const x=num(v,l);if(x<0)throw new Error('rsi_memattr_'+l+'_invalid');return x}
function refs(v){
  if(!Array.isArray(v)||v.length<1||v.length>MAX_REFS)throw new Error('rsi_memattr_evidence_refs_invalid');
  const out=v.map(x=>id(x,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_memattr_evidence_ref_duplicate');
  return Object.freeze(out);
}
function zero(extra={}){
  return Object.freeze({...extra,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false});
}
function assertZero(v,l){
  for(const f of ['execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(v||{},f)&&v[f]!==false)throw new Error('rsi_memattr_'+l+'_'+f+'_invalid');
  }
  if(Object.hasOwn(v||{},'automatic_retry_allowed')&&v.automatic_retry_allowed!==false){
    throw new Error('rsi_memattr_'+l+'_automatic_retry_invalid');
  }
}
function objectiveSpec(v){
  if(!Array.isArray(v)||v.length<1||v.length>MAX_METRICS)throw new Error('rsi_memattr_objective_spec_invalid');
  const out=v.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_memattr_objective_invalid');
    const metric=tok(row.metric,'metric'),direction=tok(row.direction,'direction');
    if(!DIR.has(direction))throw new Error('rsi_memattr_direction_invalid');
    return Object.freeze({metric,direction,epsilon:nonneg(row.epsilon??0,'epsilon')});
  }).sort((a,b)=>a.metric.localeCompare(b.metric));
  if(new Set(out.map(x=>x.metric)).size!==out.length)throw new Error('rsi_memattr_objective_duplicate');
  return Object.freeze(out);
}
function objectiveValues(v,spec,label){
  if(!Array.isArray(v)||v.length!==spec.length)throw new Error('rsi_memattr_'+label+'_objectives_invalid');
  const map=new Map();
  for(const row of v){
    if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_memattr_'+label+'_objective_invalid');
    const metric=tok(row.metric,label+'_metric');
    if(map.has(metric))throw new Error('rsi_memattr_'+label+'_objective_duplicate');
    map.set(metric,num(row.value,label+'_value'));
  }
  return Object.freeze(spec.map(s=>{
    if(!map.has(s.metric))throw new Error('rsi_memattr_'+label+'_objective_missing');
    return Object.freeze({metric:s.metric,value:map.get(s.metric)});
  }));
}
function bindContext(context,controller){
  if(
    controller.experience_context_digest!==context.context_plan_digest.slice(7)
    ||controller.experience_context_plan?.context_plan_digest!==context.context_plan_digest
    ||controller.observation_digest!==String(context.observation_digest).replace(/^sha256:/,'')
    ||controller.opportunity_id!==context.opportunity_id
    ||controller.mutation_surface!==context.mutation_surface
  )throw new Error('rsi_memattr_controller_context_mismatch');
}

export function createRsiExperienceContextAttributionPlan({
  experience_context_plan,
  autonomous_controller_plan,
  evaluation_protocol_digest,
  objective_spec,
  external_planner=false,
  authored_by_candidate=true,
}={}){
  const context=verifyRsiExperienceContextPlan(experience_context_plan);
  const controller=verifyRsiAutonomousEpisodePlan(autonomous_controller_plan);
  if(context.mode!=='VERIFIED_EXPERIENCE_RETRIEVAL'||context.selected_case_count<1){
    throw new Error('rsi_memattr_verified_retrieval_required');
  }
  bindContext(context,controller);
  if(external_planner!==true||authored_by_candidate!==false)throw new Error('rsi_memattr_external_planner_required');
  const protocol=pd(evaluation_protocol_digest,'protocol');
  const spec=objectiveSpec(objective_spec);
  const selected=[...context.selected_cases].sort((a,b)=>a.case_id.localeCompare(b.case_id));
  const ablations=selected.map((row,index)=>{
    const retained=selected.filter(x=>x.case_id!==row.case_id).map(x=>Object.freeze({
      case_id:x.case_id,case_digest:x.case_digest,
    }));
    const material={
      context_plan_digest:context.context_plan_digest,
      controller_plan_digest:controller.controller_plan_digest,
      evaluation_protocol_digest:protocol,
      removed_case_id:row.case_id,
      removed_case_digest:row.case_digest,
      retained_case_digests:retained.map(x=>x.case_digest).sort(),
    };
    const ablationDigest=digest(material);
    return Object.freeze({
      ordinal:index+1,
      ablation_id:'rsi_mem_ablate_'+ablationDigest.slice(7,31),
      ablation_digest:ablationDigest,
      removed_case_id:row.case_id,
      removed_case_digest:row.case_digest,
      retained_cases:Object.freeze(retained),
      retained_case_count:retained.length,
      only_selected_case_removed:true,
      workload_must_match_baseline:true,
      seed_set_must_match_baseline:true,
      budget_must_match_baseline:true,
      evaluator_must_match_baseline:true,
      scheduler_action_authorized:false,
      authority_effect:false,
    });
  });
  const core=zero({
    schema:RSI_EXPERIENCE_CONTEXT_ATTRIBUTION_PLAN_SCHEMA,version:1,
    source_sha:controller.source_sha,
    episode_id:controller.episode_id,
    controller_plan_digest:controller.controller_plan_digest,
    context_plan_digest:context.context_plan_digest,
    target_context_digest:context.target_context_digest,
    graph_snapshot_digest:context.graph_snapshot_digest,
    retrieval_digest:context.retrieval_digest,
    evaluation_protocol_digest:protocol,
    objective_spec:spec,
    selected_case_count:selected.length,
    selected_cases:Object.freeze(selected.map(x=>Object.freeze({case_id:x.case_id,case_digest:x.case_digest}))),
    ablations:Object.freeze(ablations),
    ablation_count:ablations.length,
    attribution_scope:'ALL_SELECTED_CASES',
    causal_claim_scope:'MATCHED_SINGLE_MEMORY_ABLATION',
    interaction_claims_require_separate_evidence:true,
    external_planner:true,authored_by_candidate:false,
    candidate_can_select_memory_for_attribution:false,
    candidate_can_author_attribution:false,
    scalar_attribution_is_authority:false,
    graph_write_performed:false,
  });
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiExperienceContextAttributionPlan(row){
  if(!row||row.schema!==RSI_EXPERIENCE_CONTEXT_ATTRIBUTION_PLAN_SCHEMA||row.version!==1){
    throw new Error('rsi_memattr_plan_schema_invalid');
  }
  assertZero(row,'plan');
  if(row.attribution_scope!=='ALL_SELECTED_CASES'||row.causal_claim_scope!=='MATCHED_SINGLE_MEMORY_ABLATION'
    ||row.interaction_claims_require_separate_evidence!==true||row.external_planner!==true
    ||row.authored_by_candidate!==false||row.candidate_can_select_memory_for_attribution!==false
    ||row.candidate_can_author_attribution!==false||row.scalar_attribution_is_authority!==false
    ||row.graph_write_performed!==false)throw new Error('rsi_memattr_plan_policy_invalid');
  sha(row.source_sha,'source');hd(row.controller_plan_digest,'controller');
  for(const f of ['context_plan_digest','target_context_digest','graph_snapshot_digest','retrieval_digest','evaluation_protocol_digest'])pd(row[f],f);
  objectiveSpec(row.objective_spec);
  if(!Array.isArray(row.selected_cases)||!Array.isArray(row.ablations)
    ||row.selected_case_count!==row.selected_cases.length||row.ablation_count!==row.ablations.length
    ||row.selected_case_count!==row.ablation_count||row.selected_case_count<1||row.selected_case_count>MAX_CASES){
    throw new Error('rsi_memattr_plan_count_invalid');
  }
  const selected=new Map(row.selected_cases.map(x=>[id(x.case_id,'case_id'),pd(x.case_digest,'case')]));
  if(selected.size!==row.selected_cases.length)throw new Error('rsi_memattr_plan_case_duplicate');
  const removed=new Set();
  for(const a of row.ablations){
    id(a.ablation_id,'ablation_id');pd(a.ablation_digest,'ablation');
    const caseId=id(a.removed_case_id,'removed_case_id');
    if(!selected.has(caseId)||selected.get(caseId)!==pd(a.removed_case_digest,'removed_case')){
      throw new Error('rsi_memattr_plan_ablation_case_mismatch');
    }
    if(removed.has(caseId))throw new Error('rsi_memattr_plan_ablation_duplicate');
    removed.add(caseId);
    if(a.only_selected_case_removed!==true||a.workload_must_match_baseline!==true
      ||a.seed_set_must_match_baseline!==true||a.budget_must_match_baseline!==true
      ||a.evaluator_must_match_baseline!==true||a.scheduler_action_authorized!==false
      ||a.authority_effect!==false)throw new Error('rsi_memattr_plan_ablation_policy_invalid');
  }
  const clone=structuredClone(row),claimed=pd(clone.plan_digest,'plan');delete clone.plan_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_memattr_plan_digest_mismatch');
  return row;
}

function classify(spec,baseline,ablated,baselineHard,ablatedHard){
  if(baselineHard!==true)throw new Error('rsi_memattr_baseline_hard_invariants_not_pass');
  if(ablatedHard!==true){
    return Object.freeze({outcome:'HELPFUL',pareto_relation:'BASELINE_DOMINATES_BY_HARD_INVARIANT',effects:[]});
  }
  let baselineBetter=false,ablatedBetter=false;
  const effects=spec.map((s,i)=>{
    const b=baseline[i].value,a=ablated[i].value;
    const signed=s.direction==='HIGHER_BETTER'?b-a:a-b;
    if(signed>s.epsilon)baselineBetter=true;
    if(signed<(-s.epsilon))ablatedBetter=true;
    return Object.freeze({metric:s.metric,direction:s.direction,epsilon:s.epsilon,baseline_value:b,ablated_value:a,signed_memory_contribution:signed});
  });
  let outcome='NEUTRAL',relation='NO_CLEAR_EFFECT';
  if(baselineBetter&&!ablatedBetter){outcome='HELPFUL';relation='BASELINE_PARETO_DOMINATES_ABLATION'}
  else if(ablatedBetter&&!baselineBetter){outcome='HARMFUL';relation='ABLATION_PARETO_DOMINATES_BASELINE'}
  else if(baselineBetter&&ablatedBetter){outcome='AMBIGUOUS';relation='TRADEOFF_INTERACTION_AMBIGUOUS'}
  return Object.freeze({outcome,pareto_relation:relation,effects:Object.freeze(effects)});
}

export function createRsiExperienceContextAblationReceipt({
  plan,
  ablation_id,
  baseline_hard_invariants_pass,
  ablated_hard_invariants_pass,
  baseline_objectives,
  ablated_objectives,
  workload_digest,
  seed_set_digest,
  budget_digest,
  evaluator_id,
  evidence_digest,
  evidence_refs,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  const checked=verifyRsiExperienceContextAttributionPlan(plan);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_memattr_external_evaluator_required');
  const ablation=checked.ablations.find(x=>x.ablation_id===String(ablation_id||''));
  if(!ablation)throw new Error('rsi_memattr_ablation_id_invalid');
  const baseline=objectiveValues(baseline_objectives,checked.objective_spec,'baseline');
  const ablated=objectiveValues(ablated_objectives,checked.objective_spec,'ablated');
  const classification=classify(
    checked.objective_spec,baseline,ablated,
    baseline_hard_invariants_pass===true,ablated_hard_invariants_pass===true,
  );
  const core=zero({
    schema:RSI_EXPERIENCE_CONTEXT_ABLATION_RECEIPT_SCHEMA,version:1,
    plan_digest:checked.plan_digest,
    context_plan_digest:checked.context_plan_digest,
    target_context_digest:checked.target_context_digest,
    evaluation_protocol_digest:checked.evaluation_protocol_digest,
    ablation_id:ablation.ablation_id,
    ablation_digest:ablation.ablation_digest,
    removed_case_id:ablation.removed_case_id,
    removed_case_digest:ablation.removed_case_digest,
    workload_digest:pd(workload_digest,'workload'),
    seed_set_digest:pd(seed_set_digest,'seed_set'),
    budget_digest:pd(budget_digest,'budget'),
    evaluator_id:id(evaluator_id,'evaluator_id'),
    baseline_hard_invariants_pass:baseline_hard_invariants_pass===true,
    ablated_hard_invariants_pass:ablated_hard_invariants_pass===true,
    baseline_objectives:baseline,
    ablated_objectives:ablated,
    effects:classification.effects,
    outcome:classification.outcome,
    pareto_relation:classification.pareto_relation,
    evidence_digest:pd(evidence_digest,'evidence'),
    evidence_refs:refs(evidence_refs),
    external_evaluator:true,authored_by_candidate:false,
    matched_workload_required:true,matched_seed_set_required:true,matched_budget_required:true,
    single_memory_ablation_only:true,
    interaction_claims_require_separate_evidence:true,
    outcome_is_contextual_not_global_truth:true,
    candidate_can_edit_receipt:false,
    attribution_is_scheduler_authority:false,
    attribution_is_promotion_authority:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiExperienceContextAblationReceipt(row,plan){
  if(!row||row.schema!==RSI_EXPERIENCE_CONTEXT_ABLATION_RECEIPT_SCHEMA||row.version!==1){
    throw new Error('rsi_memattr_receipt_schema_invalid');
  }
  assertZero(row,'receipt');
  if(row.external_evaluator!==true||row.authored_by_candidate!==false
    ||row.matched_workload_required!==true||row.matched_seed_set_required!==true||row.matched_budget_required!==true
    ||row.single_memory_ablation_only!==true||row.interaction_claims_require_separate_evidence!==true
    ||row.outcome_is_contextual_not_global_truth!==true||row.candidate_can_edit_receipt!==false
    ||row.attribution_is_scheduler_authority!==false||row.attribution_is_promotion_authority!==false){
    throw new Error('rsi_memattr_receipt_policy_invalid');
  }
  const checked=verifyRsiExperienceContextAttributionPlan(plan);
  const canonical=createRsiExperienceContextAblationReceipt({
    plan:checked,ablation_id:row.ablation_id,
    baseline_hard_invariants_pass:row.baseline_hard_invariants_pass,
    ablated_hard_invariants_pass:row.ablated_hard_invariants_pass,
    baseline_objectives:row.baseline_objectives,ablated_objectives:row.ablated_objectives,
    workload_digest:row.workload_digest,seed_set_digest:row.seed_set_digest,budget_digest:row.budget_digest,
    evaluator_id:row.evaluator_id,evidence_digest:row.evidence_digest,evidence_refs:row.evidence_refs,
    external_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==pd(row.receipt_digest,'receipt'))throw new Error('rsi_memattr_receipt_digest_mismatch');
  return row;
}

export function finalizeRsiExperienceContextAttribution({plan,receipts}={}){
  const checked=verifyRsiExperienceContextAttributionPlan(plan);
  if(!Array.isArray(receipts)||receipts.length!==checked.ablation_count){
    throw new Error('rsi_memattr_receipt_set_incomplete');
  }
  const byId=new Map();
  for(const receipt of receipts){
    const row=verifyRsiExperienceContextAblationReceipt(receipt,checked);
    if(byId.has(row.ablation_id))throw new Error('rsi_memattr_receipt_duplicate');
    byId.set(row.ablation_id,row);
  }
  const ordered=checked.ablations.map(a=>{
    const row=byId.get(a.ablation_id);
    if(!row)throw new Error('rsi_memattr_receipt_missing');
    return row;
  });
  const workload=new Set(ordered.map(x=>x.workload_digest));
  const seeds=new Set(ordered.map(x=>x.seed_set_digest));
  const budgets=new Set(ordered.map(x=>x.budget_digest));
  const evaluators=new Set(ordered.map(x=>x.evaluator_id));
  if(workload.size!==1||seeds.size!==1||budgets.size!==1||evaluators.size!==1){
    throw new Error('rsi_memattr_matched_evaluation_contract_mismatch');
  }
  const ambiguous=ordered.filter(x=>x.outcome==='AMBIGUOUS');
  const judgments=ambiguous.length===0?ordered.map(row=>Object.freeze({
    case_id:row.removed_case_id,
    case_digest:row.removed_case_digest,
    outcome:row.outcome,
    evidence_digest:row.receipt_digest,
    evidence_refs:Object.freeze((['ablation:'+row.ablation_id]).concat(row.evidence_refs).sort()),
  })).sort((a,b)=>a.case_id.localeCompare(b.case_id)):[];

  const core=zero({
    schema:RSI_EXPERIENCE_CONTEXT_ATTRIBUTION_RESULT_SCHEMA,version:1,
    state:ambiguous.length===0?'ATTRIBUTION_READY':'AMBIGUOUS_INTERACTIONS_HOLD',
    plan_digest:checked.plan_digest,
    context_plan_digest:checked.context_plan_digest,
    target_context_digest:checked.target_context_digest,
    evaluation_protocol_digest:checked.evaluation_protocol_digest,
    receipt_digests:Object.freeze(ordered.map(x=>x.receipt_digest).sort()),
    record_count:ordered.length,
    records:Object.freeze(ordered.map(row=>Object.freeze({
      case_id:row.removed_case_id,case_digest:row.removed_case_digest,
      outcome:row.outcome,pareto_relation:row.pareto_relation,
      effects:row.effects,receipt_digest:row.receipt_digest,
      authority_effect:false,
    })).sort((a,b)=>a.case_id.localeCompare(b.case_id))),
    utility_judgments:Object.freeze(judgments),
    utility_judgment_count:judgments.length,
    all_selected_cases_attributed:true,
    all_evaluations_matched:true,
    causal_claim_scope:'MATCHED_SINGLE_MEMORY_ABLATION',
    interaction_claims_require_separate_evidence:true,
    ambiguous_interactions_present:ambiguous.length>0,
    eligible_for_context_utility_feedback:ambiguous.length===0,
    attribution_is_contextual_not_global_truth:true,
    attribution_is_skill_evidence:false,
    attribution_is_scheduler_authority:false,
    attribution_is_promotion_authority:false,
    graph_write_performed:false,
  });
  return Object.freeze({...core,result_digest:digest(core)});
}

export function verifyRsiExperienceContextAttributionResult(row){
  if(!row||row.schema!==RSI_EXPERIENCE_CONTEXT_ATTRIBUTION_RESULT_SCHEMA||row.version!==1){
    throw new Error('rsi_memattr_result_schema_invalid');
  }
  assertZero(row,'result');
  if(!['ATTRIBUTION_READY','AMBIGUOUS_INTERACTIONS_HOLD'].includes(row.state)
    ||row.all_selected_cases_attributed!==true||row.all_evaluations_matched!==true
    ||row.causal_claim_scope!=='MATCHED_SINGLE_MEMORY_ABLATION'
    ||row.interaction_claims_require_separate_evidence!==true
    ||row.attribution_is_contextual_not_global_truth!==true
    ||row.attribution_is_skill_evidence!==false
    ||row.attribution_is_scheduler_authority!==false
    ||row.attribution_is_promotion_authority!==false
    ||row.graph_write_performed!==false){
    throw new Error('rsi_memattr_result_policy_invalid');
  }
  const ready=row.state==='ATTRIBUTION_READY';
  if(row.eligible_for_context_utility_feedback!==ready
    ||row.ambiguous_interactions_present===ready
    ||(ready&&row.utility_judgment_count!==row.record_count)
    ||(!ready&&row.utility_judgment_count!==0)){
    throw new Error('rsi_memattr_result_state_mismatch');
  }
  for(const f of ['plan_digest','context_plan_digest','target_context_digest','evaluation_protocol_digest'])pd(row[f],f);
  const clone=structuredClone(row),claimed=pd(clone.result_digest,'result');delete clone.result_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_memattr_result_digest_mismatch');
  return row;
}

export function rsiExperienceContextAttributionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.experience-context-attribution-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-experience-context-ablation-attribution.mjs',
    all_selected_cases_attributed:true,
    matched_single_memory_ablation:true,
    matched_workload_seed_budget_evaluator_required:true,
    hard_invariant_ablation_supported:true,
    pareto_objective_comparison:true,
    interaction_claims_require_separate_evidence:true,
    ambiguous_interactions_block_utility_feedback:true,
    candidate_can_select_memory_for_attribution:false,
    candidate_can_author_attribution:false,
    attribution_is_contextual_not_global_truth:true,
    attribution_is_skill_evidence:false,
    attribution_is_scheduler_authority:false,
    attribution_is_promotion_authority:false,
    graph_write_performed_here:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,attribution_root_digest:digest(root)});
}
