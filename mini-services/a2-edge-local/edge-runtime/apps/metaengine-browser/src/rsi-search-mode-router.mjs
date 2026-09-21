import crypto from 'node:crypto';

export const RSI_SEARCH_CONTEXT_SCHEMA = 'metaengine.rsi.search-context.v1';
export const RSI_SEARCH_MODE_OUTCOME_SCHEMA = 'metaengine.rsi.search-mode-outcome.v1';
export const RSI_SEARCH_MODE_ROUTING_SCHEMA = 'metaengine.rsi.search-mode-routing.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_OUTCOMES = 4096;
const MAX_REFS = 32;

export const RSI_SEARCH_MODES = Object.freeze([
  'FIXED_SKELETON',
  'BROAD_ARCHITECTURE',
  'RECURSIVE_DEPTH',
  'COMPARATIVE_LINEAGE',
]);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_mode_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_mode_${label}_invalid`);
  return out;
}

function token(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_mode_${label}_invalid`);
  return out;
}

function mode(value) {
  const out = token(value, 'mode');
  if (!RSI_SEARCH_MODES.includes(out)) throw new Error('rsi_mode_mode_invalid');
  return out;
}

function boundedScore(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_mode_${label}_invalid`);
  return out;
}

function positive(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out <= 0) throw new Error(`rsi_mode_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max=Number.MAX_SAFE_INTEGER) {
  const out=Number(value);
  if(!Number.isSafeInteger(out)||out<0||out>max) throw new Error(`rsi_mode_${label}_invalid`);
  return out;
}

function refs(value) {
  if(!Array.isArray(value)||value.length<1||value.length>MAX_REFS) throw new Error('rsi_mode_evidence_refs_invalid');
  const seen=new Set();
  return Object.freeze(value.map((raw)=>{
    const v=boundedId(raw,'evidence_ref');
    if(seen.has(v)) throw new Error('rsi_mode_evidence_ref_duplicate');
    seen.add(v); return v;
  }).sort());
}

function zeroAuthority(extra={}) {
  return Object.freeze({
    ...extra,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}

function assertZeroAuthority(value,label){
  for(const field of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect']){
    if(value?.[field]!==false) throw new Error(`rsi_mode_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false) throw new Error(`rsi_mode_${label}_automatic_retry_invalid`);
}

export function createRsiSearchContext({
  context_id,
  mutation_surface,
  problem_class,
  budget_class,
  skeleton_available,
  trace_history_available,
  lineage_candidate_count,
  failure_class,
  novelty_pressure,
  external_context_owner=false,
  authored_by_candidate=true,
}={}) {
  if(external_context_owner!==true||authored_by_candidate!==false) throw new Error('rsi_mode_context_external_origin_required');
  const core={
    schema:RSI_SEARCH_CONTEXT_SCHEMA,
    version:1,
    context_id:boundedId(context_id,'context_id'),
    mutation_surface:token(mutation_surface,'mutation_surface'),
    problem_class:token(problem_class,'problem_class'),
    budget_class:token(budget_class,'budget_class'),
    skeleton_available:skeleton_available===true,
    trace_history_available:trace_history_available===true,
    lineage_candidate_count:nonNegativeInt(lineage_candidate_count,'lineage_candidate_count',100000),
    failure_class:failure_class==null?null:token(failure_class,'failure_class'),
    novelty_pressure:boundedScore(novelty_pressure,'novelty_pressure'),
    external_context_owner:true,
    authored_by_candidate:false,
    raw_page_text_present:false,
    raw_user_input_present:false,
    candidate_can_edit_context:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,context_digest:digest(core)});
}

export function verifyRsiSearchContext(context){
  if(!plainObject(context)||context.schema!==RSI_SEARCH_CONTEXT_SCHEMA||context.version!==1) throw new Error('rsi_mode_context_invalid');
  assertZeroAuthority(context,'context');
  if(context.external_context_owner!==true||context.authored_by_candidate!==false||context.raw_page_text_present!==false||context.raw_user_input_present!==false||context.candidate_can_edit_context!==false) throw new Error('rsi_mode_context_policy_invalid');
  const canonical=createRsiSearchContext({
    context_id:context.context_id,
    mutation_surface:context.mutation_surface,
    problem_class:context.problem_class,
    budget_class:context.budget_class,
    skeleton_available:context.skeleton_available,
    trace_history_available:context.trace_history_available,
    lineage_candidate_count:context.lineage_candidate_count,
    failure_class:context.failure_class,
    novelty_pressure:context.novelty_pressure,
    external_context_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.context_digest!==exactDigest(context.context_digest,'context')) throw new Error('rsi_mode_context_digest_mismatch');
  return canonical;
}

export function createRsiSearchModeOutcome({
  outcome_id,
  context,
  search_mode,
  net_benefit_verified,
  hard_invariants_pass,
  candidate_valid,
  cost_units,
  evaluation_digest,
  evidence_refs,
  external_evaluator=false,
  authored_by_candidate=true,
}={}) {
  const checked=verifyRsiSearchContext(context);
  if(external_evaluator!==true||authored_by_candidate!==false) throw new Error('rsi_mode_outcome_external_origin_required');
  const hard=hard_invariants_pass===true;
  const valid=candidate_valid===true;
  const benefit=net_benefit_verified===true;
  if(benefit&&(!hard||!valid)) throw new Error('rsi_mode_outcome_positive_without_validity');
  const core={
    schema:RSI_SEARCH_MODE_OUTCOME_SCHEMA,
    version:1,
    outcome_id:boundedId(outcome_id,'outcome_id'),
    context_digest:checked.context_digest,
    search_mode:mode(search_mode),
    net_benefit_verified:benefit,
    hard_invariants_pass:hard,
    candidate_valid:valid,
    cost_units:positive(cost_units,'cost_units'),
    evaluation_digest:exactDigest(evaluation_digest,'evaluation'),
    evidence_refs:refs(evidence_refs),
    external_evaluator:true,
    authored_by_candidate:false,
    outcome_is_routing_evidence_only:true,
    outcome_is_promotion_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,outcome_digest:digest(core)});
}

function verifyOutcome(row,context){
  if(!plainObject(row)||row.schema!==RSI_SEARCH_MODE_OUTCOME_SCHEMA||row.version!==1) throw new Error('rsi_mode_outcome_invalid');
  assertZeroAuthority(row,'outcome');
  if(row.context_digest!==context.context_digest||row.external_evaluator!==true||row.authored_by_candidate!==false||row.outcome_is_routing_evidence_only!==true||row.outcome_is_promotion_authority!==false) throw new Error('rsi_mode_outcome_policy_invalid');
  const canonical=createRsiSearchModeOutcome({
    outcome_id:row.outcome_id,
    context,
    search_mode:row.search_mode,
    net_benefit_verified:row.net_benefit_verified,
    hard_invariants_pass:row.hard_invariants_pass,
    candidate_valid:row.candidate_valid,
    cost_units:row.cost_units,
    evaluation_digest:row.evaluation_digest,
    evidence_refs:row.evidence_refs,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.outcome_digest!==exactDigest(row.outcome_digest,'outcome')) throw new Error('rsi_mode_outcome_digest_mismatch');
  return canonical;
}

function compatible(modeId,context){
  if(modeId==='FIXED_SKELETON') return context.skeleton_available;
  if(modeId==='RECURSIVE_DEPTH') return context.trace_history_available;
  if(modeId==='COMPARATIVE_LINEAGE') return context.lineage_candidate_count>=2;
  return true;
}

function statsFor(modeId,outcomes){
  const rows=outcomes.filter((row)=>row.search_mode===modeId);
  const attempts=rows.length;
  const wins=rows.filter((row)=>row.net_benefit_verified).length;
  const invalid=rows.filter((row)=>!row.candidate_valid||!row.hard_invariants_pass).length;
  const avgCost=attempts?rows.reduce((s,row)=>s+row.cost_units,0)/attempts:null;
  return {attempts,wins,invalid,avgCost};
}

export function createRsiSearchModeRoutingPlan({
  context,
  outcomes=[],
  routing_id,
  proposal_budget_units=100,
  exploration_fraction=0.2,
  external_router=false,
  authored_by_candidate=true,
}={}) {
  const checked=verifyRsiSearchContext(context);
  if(external_router!==true||authored_by_candidate!==false) throw new Error('rsi_mode_router_external_origin_required');
  if(!Array.isArray(outcomes)||outcomes.length>MAX_OUTCOMES) throw new Error('rsi_mode_outcomes_invalid');
  const verified=outcomes.map((row)=>verifyOutcome(row,checked));
  const totalBudget=positive(proposal_budget_units,'proposal_budget_units');
  const explore=boundedScore(exploration_fraction,'exploration_fraction');
  if(explore<=0||explore>=0.5) throw new Error('rsi_mode_exploration_fraction_invalid');
  const totalAttempts=verified.length;
  const compatibleModes=RSI_SEARCH_MODES.filter((m)=>compatible(m,checked));
  if(compatibleModes.length<1) throw new Error('rsi_mode_no_compatible_mode');

  const rows=compatibleModes.map((m)=>{
    const s=statsFor(m,verified);
    const posteriorMean=(1+s.wins)/(2+s.attempts);
    const invalidRate=s.attempts?s.invalid/s.attempts:0;
    const explorationBonus=Math.sqrt(Math.log(totalAttempts+2)/(s.attempts+1));
    const normalizedCost=s.avgCost==null?0:Math.min(1,s.avgCost/Math.max(1,totalBudget));
    // Keep exploitation and exploration as separate budget decisions. Folding the
    // UCB/novelty bonus into the exploit score double-counts exploration because
    // this router already reserves an explicit exploration fraction below.
    const exploitationScore=posteriorMean - 0.35*invalidRate - 0.10*normalizedCost;
    const explorationScore=explorationBonus + 0.15*checked.novelty_pressure/(s.attempts+1);
    return Object.freeze({
      search_mode:m,...s,posterior_mean:posteriorMean,
      exploration_bonus:explorationBonus,
      exploration_score:explorationScore,
      selection_score:exploitationScore,
    });
  });

  const seed=digest({context:checked.context_digest,outcomes:verified.map((x)=>x.outcome_digest).sort(),routing_id});
  const sorted=rows.slice().sort((a,b)=>b.selection_score-a.selection_score||detTie(seed,a.search_mode).localeCompare(detTie(seed,b.search_mode)));
  const exploit=sorted[0];
  const explorationCandidates=rows.filter((row)=>row.search_mode!==exploit.search_mode).sort((a,b)=>b.exploration_score-a.exploration_score||a.attempts-b.attempts||detTie(seed,a.search_mode).localeCompare(detTie(seed,b.search_mode)));
  const exploreMode=explorationCandidates[0]||null;

  let allocations;
  if(exploreMode){
    const explorationBudget=totalBudget*explore;
    allocations=[
      {search_mode:exploit.search_mode,role:'EXPLOIT',proposal_budget_units:totalBudget-explorationBudget},
      {search_mode:exploreMode.search_mode,role:'EXPLORE',proposal_budget_units:explorationBudget},
    ];
  }else{
    allocations=[{search_mode:exploit.search_mode,role:'ONLY_COMPATIBLE',proposal_budget_units:totalBudget}];
  }

  const core={
    schema:RSI_SEARCH_MODE_ROUTING_SCHEMA,
    version:1,
    routing_id:boundedId(routing_id,'routing_id'),
    context_digest:checked.context_digest,
    evidence_outcome_digests:verified.map((x)=>x.outcome_digest).sort(),
    compatible_modes:compatibleModes,
    mode_statistics:rows,
    allocations:Object.freeze(allocations.map((row)=>Object.freeze(row))),
    total_proposal_budget_units:totalBudget,
    exploration_fraction:explore,
    routing_rule:'CONTEXTUAL_COST_AWARE_UCB_WITH_EXPLICIT_EXPLORATION',
    externally_verified_outcomes_only:true,
    incompatible_modes_receive_zero_budget:true,
    explicit_exploration_required:compatibleModes.length>1,
    candidate_can_choose_mode:false,
    candidate_can_edit_statistics:false,
    routing_is_scheduler_authority:false,
    routing_is_evaluation_authority:false,
    routing_is_promotion_authority:false,
    external_router:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,routing_digest:digest(core)});
}

function detTie(seed,id){
  return crypto.createHash('sha256').update(`${seed}:${id}`,'utf8').digest('hex');
}

export function verifyRsiSearchModeRoutingPlan(plan){
  if(!plainObject(plan)||plan.schema!==RSI_SEARCH_MODE_ROUTING_SCHEMA||plan.version!==1) throw new Error('rsi_mode_routing_invalid');
  assertZeroAuthority(plan,'routing');
  if(plan.routing_rule!=='CONTEXTUAL_COST_AWARE_UCB_WITH_EXPLICIT_EXPLORATION'||plan.externally_verified_outcomes_only!==true||plan.incompatible_modes_receive_zero_budget!==true||plan.candidate_can_choose_mode!==false||plan.candidate_can_edit_statistics!==false||plan.routing_is_scheduler_authority!==false||plan.routing_is_evaluation_authority!==false||plan.routing_is_promotion_authority!==false||plan.external_router!==true||plan.authored_by_candidate!==false) throw new Error('rsi_mode_routing_policy_invalid');
  if(!Array.isArray(plan.allocations)||plan.allocations.length<1||plan.allocations.length>2) throw new Error('rsi_mode_allocations_invalid');
  const sum=plan.allocations.reduce((s,row)=>s+positive(row.proposal_budget_units,'allocation_budget'),0);
  if(Math.abs(sum-plan.total_proposal_budget_units)>1e-9) throw new Error('rsi_mode_budget_sum_invalid');
  const clone=structuredClone(plan); delete clone.routing_digest;
  if(exactDigest(plan.routing_digest,'routing')!==digest(clone)) throw new Error('rsi_mode_routing_digest_mismatch');
  return plan;
}

export function rsiSearchModeRouterTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.search-mode-router-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-search-mode-router.mjs',
    modes:[...RSI_SEARCH_MODES],
    mechanism:'CONTEXTUAL_COST_AWARE_UCB_WITH_EXPLICIT_EXPLORATION',
    ael_contextual_bandit_inspired:true,
    adas_search_space_routing:true,
    funsearch_narrow_mode:true,
    meta_n_recursive_depth_mode:true,
    externally_verified_outcomes_only:true,
    explicit_exploration_required:true,
    candidate_can_choose_mode:false,
    candidate_can_edit_statistics:false,
    routing_is_scheduler_authority:false,
    routing_is_evaluation_authority:false,
    routing_is_promotion_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,search_mode_root_digest:digest(root)});
}
