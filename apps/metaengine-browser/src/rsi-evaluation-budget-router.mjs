import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_SHARED_EXPERIENCE_ADMISSION_SCHEMA,
  RSI_SHARED_EXPERIENCE_HYPOTHESIS_SCHEMA,
  verifyRsiSharedExperienceAdmission,
  verifyRsiSharedExperienceHypothesis,
} from './rsi-shared-experience-bus.mjs';

export const RSI_EVALUATION_ROUTING_REQUEST_SCHEMA='metaengine.rsi.evaluation-routing-request.v1';
export const RSI_ARTIFACT_EVALUATION_ROUTING_REQUEST_SCHEMA='metaengine.rsi.artifact-evaluation-routing-request.v1';
export const RSI_EVALUATION_BUDGET_PLAN_SCHEMA='metaengine.rsi.evaluation-budget-plan.v1';
export const RSI_EVALUATION_BUDGET_LEDGER_SCHEMA='metaengine.rsi.evaluation-budget-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_REQUESTS=1024;
const MAX_PLAN_BUDGET_UNITS=256;
const PROTECTED_SCOPE_TAGS=Object.freeze(['SAFETY','SECURITY','HIDDEN_HOLDOUT']);

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_eval_router_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_eval_router_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_eval_router_${l}_invalid`);return x;}
function boundedInt(v,l,max){const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`rsi_eval_router_${l}_invalid`);return n;}
function unit(v,l,{allowZero=false}={}){const n=Number(v);if(!Number.isFinite(n)||(allowZero?n<0:n<=0)||n>1)throw new Error(`rsi_eval_router_${l}_invalid`);return n;}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_eval_router_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_eval_router_${l}_retry_invalid`);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}

function routeTags(v,l){
  if(!Array.isArray(v)||v.length<1||v.length>32)throw new Error(`rsi_eval_router_${l}_invalid`);
  const out=[...new Set(v.map(x=>String(x||'').trim().toUpperCase()))].sort();
  if(out.length!==v.length||out.some(x=>!/^[A-Z0-9][A-Z0-9_.:-]{1,63}$/.test(x)))throw new Error(`rsi_eval_router_${l}_invalid`);
  return Object.freeze(out);
}

function verifyExperience(hypothesis,admission){
  if(!hypothesis||hypothesis.schema!==RSI_SHARED_EXPERIENCE_HYPOTHESIS_SCHEMA)throw new Error('rsi_eval_router_hypothesis_invalid');
  if(!admission||admission.schema!==RSI_SHARED_EXPERIENCE_ADMISSION_SCHEMA)throw new Error('rsi_eval_router_admission_invalid');
  const h=verifyRsiSharedExperienceHypothesis(hypothesis);
  const a=verifyRsiSharedExperienceAdmission(admission,{hypothesis:h});
  if(a.state!=='ELIGIBLE_FOR_SHARED_EXPERIENCE_BUS'||a.eligible_for_shared_experience_bus!==true)throw new Error('rsi_eval_router_admitted_experience_required');
  return Object.freeze({hypothesis:h,admission:a});
}

export function createRsiEvaluationRoutingRequest({
  request_id,
  hypothesis,
  admission,
  external_measurement_digest,
  proxy_score_digest,
  uncertainty,
  decision_closeness,
  proxy_reliability_gap,
  external_measurement_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_measurement_owner!==true||authored_by_candidate!==false)throw new Error('rsi_eval_router_external_measurement_owner_required');
  const exp=verifyExperience(hypothesis,admission);
  const roots=[
    exactDigest(external_measurement_digest,'measurement'),
    exactDigest(proxy_score_digest,'proxy_score'),
    exp.hypothesis.supporting_evidence_digest,
    exp.hypothesis.counterevidence_digest,
    exp.hypothesis.falsification_test_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_eval_router_independent_measurement_roots_required');
  const u=unit(uncertainty,'uncertainty');
  const close=unit(decision_closeness,'decision_closeness',{allowZero:true});
  const gap=unit(proxy_reliability_gap,'proxy_reliability_gap',{allowZero:true});
  const cost=boundedInt(exp.hypothesis.evaluator_cost_units,'cost',64);
  const info=unit(exp.hypothesis.expected_information_gain,'information_gain');
  const score=(info*u*(1+close)*(1+gap))/cost;
  const core=zero({
    schema:RSI_EVALUATION_ROUTING_REQUEST_SCHEMA,
    version:1,
    request_id:id(request_id,'request_id'),
    source_sha:exactSha(exp.hypothesis.source_sha,'source'),
    hypothesis_digest:exp.hypothesis.hypothesis_digest,
    admission_digest:exp.admission.admission_digest,
    origin_candidate_digest:exp.hypothesis.origin_candidate_digest,
    origin_lineage_digest:exp.hypothesis.origin_lineage_digest,
    distilled_recipe_digest:exp.hypothesis.distilled_recipe_digest,
    source_context_digest:exp.hypothesis.source_context_digest,
    local_revalidation_protocol_digest:exp.hypothesis.local_revalidation_protocol_digest,
    negative_transfer_probe_digest:exp.hypothesis.negative_transfer_probe_digest,
    recipe_distillation_verified:exp.admission.recipe_distillation_verified,
    context_compatibility_pass:exp.admission.context_compatibility_pass,
    negative_transfer_probe_pass:exp.admission.negative_transfer_probe_pass,
    scope_tags:exp.hypothesis.scope_tags,
    recipient_group_tags:exp.hypothesis.recipient_group_tags,
    evaluator_cost_units:cost,
    expected_information_gain:info,
    external_measurement_digest:roots[0],
    proxy_score_digest:roots[1],
    uncertainty:u,
    decision_closeness:close,
    proxy_reliability_gap:gap,
    routing_priority_score:score,
    hypothesis_snapshot:exp.hypothesis,
    admission_snapshot:exp.admission,
    external_measurement_owner:true,
    authored_by_candidate:false,
    cheap_proxy_is_final_truth:false,
    independent_audit_required:true,
    candidate_can_set_priority:false,
    candidate_can_set_uncertainty:false,
    candidate_can_set_proxy_reliability:false,
    request_can_schedule_evaluation:false,
    request_can_execute_evaluation:false,
  });
  return Object.freeze({...core,request_digest:digest(core)});
}

export function verifyRsiEvaluationRoutingRequest(request,{hypothesis,admission}={}){
  if(!request||request.schema!==RSI_EVALUATION_ROUTING_REQUEST_SCHEMA||request.version!==1)throw new Error('rsi_eval_router_request_invalid');
  assertZero(request,'request');
  if(request.external_measurement_owner!==true||request.authored_by_candidate!==false
    ||request.cheap_proxy_is_final_truth!==false||request.independent_audit_required!==true
    ||request.candidate_can_set_priority!==false||request.candidate_can_set_uncertainty!==false
    ||request.candidate_can_set_proxy_reliability!==false||request.request_can_schedule_evaluation!==false
    ||request.request_can_execute_evaluation!==false)throw new Error('rsi_eval_router_request_policy_invalid');
  const embeddedHypothesis=hypothesis??request.hypothesis_snapshot;
  const embeddedAdmission=admission??request.admission_snapshot;
  if(!embeddedHypothesis||!embeddedAdmission)throw new Error('rsi_eval_router_request_embedded_experience_required');
  const canonical=createRsiEvaluationRoutingRequest({
    request_id:request.request_id,
    hypothesis:embeddedHypothesis,
    admission:embeddedAdmission,
    external_measurement_digest:request.external_measurement_digest,
    proxy_score_digest:request.proxy_score_digest,
    uncertainty:request.uncertainty,
    decision_closeness:request.decision_closeness,
    proxy_reliability_gap:request.proxy_reliability_gap,
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.request_digest!==exactDigest(request.request_digest,'request'))throw new Error('rsi_eval_router_request_digest_mismatch');
  return canonical;
}


export function createRsiArtifactEvaluationRoutingRequest({
  request_id,
  source_sha,
  phase28_artifact_receipt_digest,
  parent_artifact_digest,
  candidate_artifact_digest,
  provenance_root_digest,
  build_worker_image_digest,
  build_harness_manifest_digest,
  build_capability_manifest_digest,
  evaluator_root_digest,
  evaluator_generation_digest,
  evaluation_epoch_digest,
  external_measurement_digest,
  proxy_score_digest,
  uncertainty,
  decision_closeness,
  proxy_reliability_gap,
  evaluator_cost_units,
  expected_information_gain,
  scope_tags,
  recipient_group_tags,
  external_measurement_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_measurement_owner!==true||authored_by_candidate!==false)throw new Error('rsi_eval_router_external_measurement_owner_required');
  const source=exactSha(source_sha,'artifact_source');
  const artifactReceipt=exactDigest(phase28_artifact_receipt_digest,'artifact_receipt');
  const parent=exactDigest(parent_artifact_digest,'parent_artifact');
  const candidate=exactDigest(candidate_artifact_digest,'candidate_artifact');
  if(parent===candidate)throw new Error('rsi_eval_router_distinct_candidate_required');
  const provenance=exactDigest(provenance_root_digest,'provenance_root');
  const buildWorker=exactDigest(build_worker_image_digest,'build_worker_image');
  const buildHarness=exactDigest(build_harness_manifest_digest,'build_harness_manifest');
  const buildCapabilities=exactDigest(build_capability_manifest_digest,'build_capability_manifest');
  const evaluator=exactDigest(evaluator_root_digest,'evaluator_root');
  const generation=exactDigest(evaluator_generation_digest,'evaluator_generation');
  const epoch=exactDigest(evaluation_epoch_digest,'evaluation_epoch');
  const measurement=exactDigest(external_measurement_digest,'measurement');
  const proxy=exactDigest(proxy_score_digest,'proxy_score');
  const roots=[artifactReceipt,parent,candidate,provenance,buildWorker,buildHarness,buildCapabilities,evaluator,generation,epoch,measurement,proxy];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_eval_router_independent_artifact_roots_required');
  const u=unit(uncertainty,'uncertainty');
  const close=unit(decision_closeness,'decision_closeness',{allowZero:true});
  const gap=unit(proxy_reliability_gap,'proxy_reliability_gap',{allowZero:true});
  const cost=boundedInt(evaluator_cost_units,'cost',64);
  const info=unit(expected_information_gain,'information_gain');
  const score=(info*u*(1+close)*(1+gap))/cost;
  const scopes=routeTags(scope_tags,'artifact_scope_tags');
  const recipients=routeTags(recipient_group_tags,'artifact_recipient_group_tags');
  const core=zero({
    schema:RSI_ARTIFACT_EVALUATION_ROUTING_REQUEST_SCHEMA,
    version:1,
    request_kind:'MATERIALIZED_CANDIDATE',
    request_id:id(request_id,'request_id'),
    source_sha:source,
    phase28_artifact_receipt_digest:artifactReceipt,
    evaluation_subject_digest:artifactReceipt,
    parent_artifact_digest:parent,
    candidate_artifact_digest:candidate,
    origin_candidate_digest:candidate,
    origin_lineage_digest:artifactReceipt,
    provenance_root_digest:provenance,
    build_worker_image_digest:buildWorker,
    build_harness_manifest_digest:buildHarness,
    build_capability_manifest_digest:buildCapabilities,
    evaluator_root_digest:evaluator,
    evaluator_generation_digest:generation,
    evaluation_epoch_digest:epoch,
    scope_tags:scopes,
    recipient_group_tags:recipients,
    evaluator_cost_units:cost,
    expected_information_gain:info,
    external_measurement_digest:measurement,
    proxy_score_digest:proxy,
    uncertainty:u,
    decision_closeness:close,
    proxy_reliability_gap:gap,
    routing_priority_score:score,
    artifact_provenance_verified:true,
    fresh_budget_epoch_required:true,
    prior_budget_reuse_allowed:false,
    evaluator_generation_frozen:true,
    build_evaluation_environment_separation_required:true,
    candidate_can_choose_evaluator_generation:false,
    candidate_can_choose_build_environment:false,
    external_measurement_owner:true,
    authored_by_candidate:false,
    cheap_proxy_is_final_truth:false,
    independent_audit_required:true,
    candidate_can_set_priority:false,
    candidate_can_set_uncertainty:false,
    candidate_can_set_proxy_reliability:false,
    request_can_schedule_evaluation:false,
    request_can_execute_evaluation:false,
  });
  return Object.freeze({...core,request_digest:digest(core)});
}

export function verifyRsiArtifactEvaluationRoutingRequest(request){
  if(!request||request.schema!==RSI_ARTIFACT_EVALUATION_ROUTING_REQUEST_SCHEMA||request.version!==1)throw new Error('rsi_eval_router_artifact_request_invalid');
  assertZero(request,'artifact_request');
  if(request.request_kind!=='MATERIALIZED_CANDIDATE'
    ||request.artifact_provenance_verified!==true
    ||request.fresh_budget_epoch_required!==true
    ||request.prior_budget_reuse_allowed!==false
    ||request.evaluator_generation_frozen!==true
    ||request.build_evaluation_environment_separation_required!==true
    ||request.candidate_can_choose_evaluator_generation!==false
    ||request.candidate_can_choose_build_environment!==false
    ||request.external_measurement_owner!==true||request.authored_by_candidate!==false
    ||request.cheap_proxy_is_final_truth!==false||request.independent_audit_required!==true
    ||request.candidate_can_set_priority!==false||request.candidate_can_set_uncertainty!==false
    ||request.candidate_can_set_proxy_reliability!==false||request.request_can_schedule_evaluation!==false
    ||request.request_can_execute_evaluation!==false)throw new Error('rsi_eval_router_artifact_request_policy_invalid');
  const canonical=createRsiArtifactEvaluationRoutingRequest({
    request_id:request.request_id,
    source_sha:request.source_sha,
    phase28_artifact_receipt_digest:request.phase28_artifact_receipt_digest,
    parent_artifact_digest:request.parent_artifact_digest,
    candidate_artifact_digest:request.candidate_artifact_digest,
    provenance_root_digest:request.provenance_root_digest,
    build_worker_image_digest:request.build_worker_image_digest,
    build_harness_manifest_digest:request.build_harness_manifest_digest,
    build_capability_manifest_digest:request.build_capability_manifest_digest,
    evaluator_root_digest:request.evaluator_root_digest,
    evaluator_generation_digest:request.evaluator_generation_digest,
    evaluation_epoch_digest:request.evaluation_epoch_digest,
    external_measurement_digest:request.external_measurement_digest,
    proxy_score_digest:request.proxy_score_digest,
    uncertainty:request.uncertainty,
    decision_closeness:request.decision_closeness,
    proxy_reliability_gap:request.proxy_reliability_gap,
    evaluator_cost_units:request.evaluator_cost_units,
    expected_information_gain:request.expected_information_gain,
    scope_tags:request.scope_tags,
    recipient_group_tags:request.recipient_group_tags,
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.request_digest!==exactDigest(request.request_digest,'artifact_request'))throw new Error('rsi_eval_router_artifact_request_digest_mismatch');
  return canonical;
}

export function verifyRsiEvaluationBudgetRequest(request,args={}){
  if(request?.schema===RSI_EVALUATION_ROUTING_REQUEST_SCHEMA)return verifyRsiEvaluationRoutingRequest(request,args);
  if(request?.schema===RSI_ARTIFACT_EVALUATION_ROUTING_REQUEST_SCHEMA)return verifyRsiArtifactEvaluationRoutingRequest(request);
  throw new Error('rsi_eval_router_request_schema_invalid');
}

function selectRequests(rows,budgetUnits){
  const sorted=[...rows].sort((a,b)=>{
    if(b.routing_priority_score!==a.routing_priority_score)return b.routing_priority_score-a.routing_priority_score;
    return a.request_digest.localeCompare(b.request_digest);
  });
  const protectedPresent=PROTECTED_SCOPE_TAGS.filter(tag=>sorted.some(row=>row.scope_tags.includes(tag)));
  const selected=[];
  const selectedDigests=new Set();
  let used=0;
  for(const tag of protectedPresent){
    if(selected.some(row=>row.scope_tags.includes(tag)))continue;
    const candidate=sorted.find(row=>row.scope_tags.includes(tag)&&!selectedDigests.has(row.request_digest));
    if(!candidate||used+candidate.evaluator_cost_units>budgetUnits){
      return {
        selected:[],
        deferred:sorted,
        used:0,
        safetyFloorSatisfied:false,
        protectedScopesPresent:Object.freeze(protectedPresent),
        protectedScopesCovered:Object.freeze([]),
      };
    }
    selected.push(candidate);
    selectedDigests.add(candidate.request_digest);
    used+=candidate.evaluator_cost_units;
  }
  for(const row of sorted){
    if(selectedDigests.has(row.request_digest))continue;
    if(used+row.evaluator_cost_units<=budgetUnits){
      selected.push(row);
      selectedDigests.add(row.request_digest);
      used+=row.evaluator_cost_units;
    }
  }
  const deferred=sorted.filter(row=>!selectedDigests.has(row.request_digest));
  const covered=protectedPresent.filter(tag=>selected.some(row=>row.scope_tags.includes(tag)));
  return {
    selected,
    deferred,
    used,
    safetyFloorSatisfied:covered.length===protectedPresent.length,
    protectedScopesPresent:Object.freeze(protectedPresent),
    protectedScopesCovered:Object.freeze(covered),
  };
}

export function createRsiEvaluationBudgetPlan({
  plan_id,
  source_sha,
  requests,
  epoch_budget_units,
  external_budget_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_budget_owner!==true||authored_by_candidate!==false)throw new Error('rsi_eval_router_external_budget_owner_required');
  const source=exactSha(source_sha,'source');
  if(!Array.isArray(requests)||requests.length<1||requests.length>MAX_REQUESTS)throw new Error('rsi_eval_router_requests_invalid');
  const seen=new Set();
  const rows=requests.map(row=>{
    const checked=verifyRsiEvaluationBudgetRequest(row);
    if(checked.source_sha!==source)throw new Error('rsi_eval_router_request_source_mismatch');
    if(seen.has(checked.request_digest))throw new Error('rsi_eval_router_request_duplicate');
    seen.add(checked.request_digest);
    return checked;
  });
  const budget=boundedInt(epoch_budget_units,'epoch_budget_units',MAX_PLAN_BUDGET_UNITS);
  const routed=selectRequests(rows,budget);
  const core=zero({
    schema:RSI_EVALUATION_BUDGET_PLAN_SCHEMA,
    version:1,
    plan_id:id(plan_id,'plan_id'),
    source_sha:source,
    epoch_budget_units:budget,
    used_budget_units:routed.used,
    remaining_budget_units:budget-routed.used,
    request_count:rows.length,
    request_snapshots:Object.freeze(rows.map(r=>Object.freeze(structuredClone(r)))),
    selected_request_digests:Object.freeze(routed.selected.map(r=>r.request_digest)),
    deferred_request_digests:Object.freeze(routed.deferred.map(r=>r.request_digest)),
    routing_order:Object.freeze([...routed.selected,...routed.deferred].map(r=>r.request_digest)),
    external_budget_owner:true,
    authored_by_candidate:false,
    deterministic_priority_routing:true,
    uncertainty_aware:true,
    information_gain_aware:true,
    proxy_bias_aware:true,
    close_decision_priority:true,
    budget_fail_closed:true,
    safety_floor_fail_closed:true,
    protected_scope_floor_tags:PROTECTED_SCOPE_TAGS,
    protected_scopes_present:routed.protectedScopesPresent,
    protected_scopes_covered:routed.protectedScopesCovered,
    safety_floor_satisfied:routed.safetyFloorSatisfied,
    state:routed.safetyFloorSatisfied?'EVALUATION_BUDGET_ROUTED':'EVALUATION_BUDGET_FLOOR_UNSATISFIED',
    cheap_proxy_is_final_truth:false,
    selected_requests_are_execution_authority:false,
    selected_requests_are_scheduler_authority:false,
    candidate_can_override_budget:false,
    candidate_can_override_priority:false,
    plan_can_schedule_evaluation:false,
    plan_can_execute_evaluation:false,
  });
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiEvaluationBudgetPlan(plan,{requests}={}){
  if(!plan||plan.schema!==RSI_EVALUATION_BUDGET_PLAN_SCHEMA||plan.version!==1)throw new Error('rsi_eval_router_plan_invalid');
  assertZero(plan,'plan');
  if(plan.external_budget_owner!==true||plan.authored_by_candidate!==false||plan.deterministic_priority_routing!==true
    ||plan.uncertainty_aware!==true||plan.information_gain_aware!==true||plan.proxy_bias_aware!==true
    ||plan.close_decision_priority!==true||plan.budget_fail_closed!==true||plan.safety_floor_fail_closed!==true
    ||JSON.stringify(plan.protected_scope_floor_tags)!==JSON.stringify(PROTECTED_SCOPE_TAGS)
    ||plan.cheap_proxy_is_final_truth!==false
    ||plan.selected_requests_are_execution_authority!==false||plan.selected_requests_are_scheduler_authority!==false
    ||plan.candidate_can_override_budget!==false||plan.candidate_can_override_priority!==false
    ||plan.plan_can_schedule_evaluation!==false||plan.plan_can_execute_evaluation!==false)throw new Error('rsi_eval_router_plan_policy_invalid');
  const canonical=createRsiEvaluationBudgetPlan({
    plan_id:plan.plan_id,
    source_sha:plan.source_sha,
    requests:requests??plan.request_snapshots,
    epoch_budget_units:plan.epoch_budget_units,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.plan_digest!==exactDigest(plan.plan_digest,'plan'))throw new Error('rsi_eval_router_plan_digest_mismatch');
  return canonical;
}

function ledgerState(sourceSha,rows){
  const totalBudget=rows.reduce((s,r)=>s+r.plan.epoch_budget_units,0);
  const used=rows.reduce((s,r)=>s+r.plan.used_budget_units,0);
  const core=zero({
    schema:RSI_EVALUATION_BUDGET_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    total_budget_units:totalBudget,
    total_used_budget_units:used,
    total_remaining_budget_units:totalBudget-used,
    append_only:true,
    ledger_can_schedule_evaluation:false,
    ledger_can_execute_evaluation:false,
    ledger_can_increase_budget:false,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiEvaluationBudgetLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_eval_router_ledger_path_required');this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'ledger_source');}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'ledger');
      if(p.schema!==RSI_EVALUATION_BUDGET_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.append_only!==true
        ||p.ledger_can_schedule_evaluation!==false||p.ledger_can_execute_evaluation!==false||p.ledger_can_increase_budget!==false
        ||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false)throw new Error('rsi_eval_router_ledger_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==exactDigest(p.state_digest,'ledger'))throw new Error('rsi_eval_router_ledger_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_REQUESTS)throw new Error('rsi_eval_router_ledger_rows_invalid');
      const ids=new Set();
      const planIds=new Set();
      const checkedRows=[];
      for(const row of p.rows){
        if(row.source_sha!==this.#sourceSha)throw new Error('rsi_eval_router_ledger_source_mismatch');
        const plan=verifyRsiEvaluationBudgetPlan(row.plan);
        if(plan.source_sha!==this.#sourceSha)throw new Error('rsi_eval_router_ledger_source_mismatch');
        if(ids.has(plan.plan_digest))throw new Error('rsi_eval_router_ledger_plan_duplicate');
        if(planIds.has(plan.plan_id))throw new Error('rsi_eval_router_ledger_plan_id_duplicate');
        ids.add(plan.plan_digest);
        planIds.add(plan.plan_id);
        checkedRows.push(Object.freeze({source_sha:this.#sourceSha,plan}));
      }
      const canonicalState=ledgerState(this.#sourceSha,checkedRows);
      if(canonicalState.state_digest!==p.state_digest)throw new Error('rsi_eval_router_ledger_derived_state_mismatch');
      this.#rows=checkedRows;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows=this.#rows){const s=ledgerState(this.#sourceSha,rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,this.#path);}
  async add(plan){
    if(!this.#initialized)throw new Error('rsi_eval_router_ledger_not_initialized');
    const checked=verifyRsiEvaluationBudgetPlan(plan);
    if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_eval_router_ledger_source_mismatch');
    const existing=this.#rows.find(r=>r.plan.plan_id===checked.plan_id||r.plan.plan_digest===checked.plan_digest);
    if(existing){
      if(existing.plan.plan_digest!==checked.plan_digest)throw new Error('rsi_eval_router_ledger_identity_conflict');
      return zero({state:'IDEMPOTENT',plan_digest:checked.plan_digest});
    }
    if(this.#rows.length>=MAX_REQUESTS)throw new Error('rsi_eval_router_ledger_capacity_exceeded');
    const nextRows=[...this.#rows,Object.freeze({source_sha:this.#sourceSha,plan:structuredClone(checked)})];
    await this.#persist(nextRows);
    this.#rows=nextRows;
    return zero({state:'RECORDED',plan_digest:checked.plan_digest});
  }
  snapshot(){const s=ledgerState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,total_budget_units:s.total_budget_units,total_used_budget_units:s.total_used_budget_units,total_remaining_budget_units:s.total_remaining_budget_units,append_only:true,ledger_can_schedule_evaluation:false,ledger_can_execute_evaluation:false,ledger_can_increase_budget:false,authority_effect:false});}
}

export function rsiEvaluationBudgetRouterTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.evaluation-budget-router-root.v1',
    version:1,
    admitted_experience_required:true,
    materialized_artifact_request_supported:true,
    phase28_artifact_receipt_binding_required:true,
    fresh_budget_epoch_required_for_materialized_artifacts:true,
    prior_budget_reuse_forbidden_for_materialized_artifacts:true,
    evaluator_generation_frozen_for_materialized_artifacts:true,
    build_evaluation_environment_separation_required:true,
    build_worker_and_trial_worker_must_differ:true,
    build_harness_and_evaluation_harness_must_differ:true,
    candidate_cannot_choose_evaluator_generation:true,
    candidate_cannot_choose_build_environment:true,
    recipe_distillation_verified_required:true,
    context_compatible_experience_required:true,
    negative_transfer_clearance_required:true,
    local_revalidation_protocol_binding_required:true,
    external_measurement_owner_required:true,
    external_budget_owner_required:true,
    uncertainty_aware_routing:true,
    information_gain_aware_routing:true,
    proxy_bias_aware_routing:true,
    close_decision_priority:true,
    deterministic_tie_break_required:true,
    bounded_epoch_budget_units:MAX_PLAN_BUDGET_UNITS,
    cheap_proxy_is_final_truth:false,
    independent_audit_required:true,
    budget_fail_closed:true,
    protected_scope_floor_tags:PROTECTED_SCOPE_TAGS,
    safety_floor_fail_closed:true,
    request_embeds_admitted_experience:true,
    plan_embeds_request_snapshots:true,
    durable_before_visible_required:true,
    restart_revalidation_required:true,
    candidate_can_set_priority:false,
    candidate_can_override_budget:false,
    router_can_schedule_evaluation:false,
    router_can_execute_evaluation:false,
    selected_request_is_execution_authority:false,
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
  return Object.freeze({...root,evaluation_budget_router_root_digest:digest(root)});
}
