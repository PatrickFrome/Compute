import crypto from 'node:crypto';

import {
  RSI_SKILL_LIBRARY_SCHEMA,
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';

export const RSI_META_SKILL_PROFILE_SCHEMA = 'metaengine.rsi.meta-skill-profile.v1';
export const RSI_META_SKILL_FAST_LOOP_SUMMARY_SCHEMA = 'metaengine.rsi.meta-skill-fast-loop-summary.v1';
export const RSI_META_SKILL_EVOLUTION_PLAN_SCHEMA = 'metaengine.rsi.meta-skill-evolution-plan.v1';
export const RSI_META_SKILL_EVALUATION_SCHEMA = 'metaengine.rsi.meta-skill-evaluation.v1';
export const RSI_META_SKILL_EVOLUTION_RESULT_SCHEMA = 'metaengine.rsi.meta-skill-evolution-result.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const META_ROLES = Object.freeze(['ANALYZER','RETRIEVER','ALLOCATOR','PROPOSER','EVOLVER']);
const MAX_EVIDENCE_REFS = 32;
const MAX_FAST_EPISODES = 1_000_000;
const MAX_ROLE_CHANGES = 2;
const MAX_OBJECTIVES = 8;

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_meta_skill_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_meta_skill_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_meta_skill_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_meta_skill_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_meta_skill_${label}_invalid`);
  return out;
}

function finiteNumber(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out)) throw new Error(`rsi_meta_skill_${label}_invalid`);
  return out;
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'signing_authority',
    'direct_tool_execution_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_meta_skill_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_meta_skill_${label}_automatic_retry_invalid`);
}

function modelFamily(value) {
  const out = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,95}$/.test(out)) throw new Error('rsi_meta_skill_backbone_invalid');
  return out;
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_meta_skill_evidence_refs_invalid');
  const seen = new Set();
  return Object.freeze(value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_meta_skill_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort());
}

function roleBindings(value, library) {
  if (!plainObject(value)) throw new Error('rsi_meta_skill_role_bindings_invalid');
  const keys = Object.keys(value).sort();
  const expected = [...META_ROLES].sort();
  if (keys.length !== expected.length || keys.some((key,index)=>key!==expected[index])) throw new Error('rsi_meta_skill_role_bindings_shape_invalid');
  const used = new Set();
  return Object.freeze(Object.fromEntries(META_ROLES.map((role) => {
    const row = value[role];
    if (!plainObject(row)) throw new Error('rsi_meta_skill_role_binding_invalid');
    const entry = library.entries.find((candidate) =>
      candidate.skill_id === String(row.skill_id || '')
      && candidate.skill_version === Number(row.skill_version)
      && candidate.skill_digest === String(row.skill_digest || '').toLowerCase());
    if (!entry) throw new Error('rsi_meta_skill_role_not_in_library');
    if (entry.role !== role) throw new Error('rsi_meta_skill_role_mismatch');
    if (used.has(entry.skill_digest)) throw new Error('rsi_meta_skill_duplicate_binding');
    used.add(entry.skill_digest);
    return [role,Object.freeze({
      role,
      skill_id: entry.skill_id,
      skill_version: entry.skill_version,
      skill_digest: entry.skill_digest,
      evidence_digest: entry.evidence_digest,
      input_schema_digest: entry.input_schema_digest,
      output_schema_digest: entry.output_schema_digest,
    })];
  })));
}

export function createRsiMetaSkillProfile({
  profile_id,
  library,
  profile_generation,
  slow_meta_epoch,
  fast_skill_epoch,
  frozen_backbone_family,
  bindings,
  external_profile_owner = false,
  authored_by_candidate = true,
} = {}) {
  const checkedLibrary = verifyRsiVerifiedSkillLibrary(library);
  if (external_profile_owner !== true || authored_by_candidate !== false) throw new Error('rsi_meta_skill_profile_external_origin_required');
  const checkedBindings = roleBindings(bindings, checkedLibrary);
  const core = {
    schema: RSI_META_SKILL_PROFILE_SCHEMA,
    version: 1,
    profile_id: boundedId(profile_id, 'profile_id'),
    library_id: checkedLibrary.library_id,
    library_digest: checkedLibrary.library_digest,
    profile_generation: positiveInt(profile_generation, 'profile_generation', 1_000_000),
    slow_meta_epoch: positiveInt(slow_meta_epoch, 'slow_meta_epoch', 1_000_000),
    fast_skill_epoch: positiveInt(fast_skill_epoch, 'fast_skill_epoch', 1_000_000),
    frozen_backbone_family: modelFamily(frozen_backbone_family),
    bindings: checkedBindings,
    roles: Object.freeze([...META_ROLES]),
    two_timescale_profile: true,
    backbone_mutable_by_profile: false,
    evaluator_root_mutable_by_profile: false,
    promotion_root_mutable_by_profile: false,
    scheduler_root_mutable_by_profile: false,
    signing_root_mutable_by_profile: false,
    self_update_root_mutable_by_profile: false,
    candidate_can_bind_unverified_skill: false,
    candidate_can_activate_profile: false,
    external_profile_owner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, profile_digest: digest(core) });
}

export function verifyRsiMetaSkillProfile(profile, library) {
  if (!plainObject(profile) || profile.schema !== RSI_META_SKILL_PROFILE_SCHEMA || profile.version !== 1) throw new Error('rsi_meta_skill_profile_invalid');
  assertZeroAuthority(profile,'profile');
  if (
    profile.two_timescale_profile !== true
    || profile.backbone_mutable_by_profile !== false
    || profile.evaluator_root_mutable_by_profile !== false
    || profile.promotion_root_mutable_by_profile !== false
    || profile.scheduler_root_mutable_by_profile !== false
    || profile.signing_root_mutable_by_profile !== false
    || profile.self_update_root_mutable_by_profile !== false
    || profile.candidate_can_bind_unverified_skill !== false
    || profile.candidate_can_activate_profile !== false
    || profile.external_profile_owner !== true
    || profile.authored_by_candidate !== false
  ) throw new Error('rsi_meta_skill_profile_policy_invalid');
  const canonical = createRsiMetaSkillProfile({
    profile_id: profile.profile_id,
    library,
    profile_generation: profile.profile_generation,
    slow_meta_epoch: profile.slow_meta_epoch,
    fast_skill_epoch: profile.fast_skill_epoch,
    frozen_backbone_family: profile.frozen_backbone_family,
    bindings: profile.bindings,
    external_profile_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.profile_digest !== exactDigest(profile.profile_digest,'profile')) throw new Error('rsi_meta_skill_profile_digest_mismatch');
  return canonical;
}

export function createRsiMetaSkillFastLoopSummary({
  profile,
  library,
  fast_holdout_digest,
  episode_count,
  helpful_count,
  harmful_count,
  neutral_count,
  insufficient_count,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiMetaSkillProfile(profile,library);
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_meta_skill_fast_summary_external_origin_required');
  const episodes=positiveInt(episode_count,'fast_episode_count',MAX_FAST_EPISODES);
  const helpful=nonNegativeInt(helpful_count,'fast_helpful_count',episodes);
  const harmful=nonNegativeInt(harmful_count,'fast_harmful_count',episodes);
  const neutral=nonNegativeInt(neutral_count,'fast_neutral_count',episodes);
  const insufficient=nonNegativeInt(insufficient_count,'fast_insufficient_count',episodes);
  if(helpful+harmful+neutral+insufficient!==episodes) throw new Error('rsi_meta_skill_fast_summary_count_mismatch');
  const core={
    schema:RSI_META_SKILL_FAST_LOOP_SUMMARY_SCHEMA,
    version:1,
    profile_id:checked.profile_id,
    profile_digest:checked.profile_digest,
    library_digest:checked.library_digest,
    fast_skill_epoch:checked.fast_skill_epoch,
    slow_meta_epoch:checked.slow_meta_epoch,
    fast_holdout_digest:exactDigest(fast_holdout_digest,'fast_holdout'),
    episode_count:episodes,
    helpful_count:helpful,
    harmful_count:harmful,
    neutral_count:neutral,
    insufficient_count:insufficient,
    useful_rate:helpful/episodes,
    harmful_rate:harmful/episodes,
    evidence_refs:evidenceRefs(evidence_refs),
    external_evaluator:true,
    authored_by_candidate:false,
    fast_loop_evidence_only:true,
    slow_meta_update_authority:false,
    profile_activation_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,summary_digest:digest(core)});
}

export function verifyRsiMetaSkillFastLoopSummary(summary,profile,library){
  if(!plainObject(summary)||summary.schema!==RSI_META_SKILL_FAST_LOOP_SUMMARY_SCHEMA||summary.version!==1) throw new Error('rsi_meta_skill_fast_summary_invalid');
  assertZeroAuthority(summary,'fast_summary');
  if(
    summary.external_evaluator!==true
    ||summary.authored_by_candidate!==false
    ||summary.fast_loop_evidence_only!==true
    ||summary.slow_meta_update_authority!==false
    ||summary.profile_activation_authority!==false
  ) throw new Error('rsi_meta_skill_fast_summary_policy_invalid');
  const canonical=createRsiMetaSkillFastLoopSummary({
    profile,library,
    fast_holdout_digest:summary.fast_holdout_digest,
    episode_count:summary.episode_count,
    helpful_count:summary.helpful_count,
    harmful_count:summary.harmful_count,
    neutral_count:summary.neutral_count,
    insufficient_count:summary.insufficient_count,
    evidence_refs:summary.evidence_refs,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.summary_digest!==exactDigest(summary.summary_digest,'fast_summary')) throw new Error('rsi_meta_skill_fast_summary_digest_mismatch');
  return canonical;
}

function changedRoles(parent,successor){
  return META_ROLES.filter((role)=>parent.bindings[role].skill_digest!==successor.bindings[role].skill_digest);
}

export function createRsiMetaSkillEvolutionPlan({
  parent_profile,
  successor_profile,
  library,
  fast_loop_summary,
  min_fast_episodes = 8,
  meta_holdout_digest,
  max_role_changes = 1,
  external_meta_operator = false,
  authored_by_candidate = true,
} = {}) {
  const parent=verifyRsiMetaSkillProfile(parent_profile,library);
  const successor=verifyRsiMetaSkillProfile(successor_profile,library);
  const summary=verifyRsiMetaSkillFastLoopSummary(fast_loop_summary,parent,library);
  if(external_meta_operator!==true||authored_by_candidate!==false) throw new Error('rsi_meta_skill_plan_external_origin_required');
  const minEpisodes=positiveInt(min_fast_episodes,'min_fast_episodes',MAX_FAST_EPISODES);
  const maxChanges=positiveInt(max_role_changes,'max_role_changes',MAX_ROLE_CHANGES);
  if(summary.episode_count<minEpisodes) throw new Error('rsi_meta_skill_fast_evidence_insufficient');
  if(successor.profile_generation!==parent.profile_generation+1) throw new Error('rsi_meta_skill_profile_generation_not_advanced');
  if(successor.slow_meta_epoch!==parent.slow_meta_epoch+1) throw new Error('rsi_meta_skill_slow_epoch_not_advanced');
  if(successor.fast_skill_epoch<parent.fast_skill_epoch) throw new Error('rsi_meta_skill_fast_epoch_regressed');
  if(successor.frozen_backbone_family!==parent.frozen_backbone_family) throw new Error('rsi_meta_skill_backbone_drift');
  const changed=changedRoles(parent,successor);
  if(changed.length<1||changed.length>maxChanges) throw new Error('rsi_meta_skill_role_change_count_invalid');
  const metaHoldout=exactDigest(meta_holdout_digest,'meta_holdout');
  if(metaHoldout===summary.fast_holdout_digest) throw new Error('rsi_meta_skill_holdout_alias');

  const core={
    schema:RSI_META_SKILL_EVOLUTION_PLAN_SCHEMA,
    version:1,
    parent_profile_id:parent.profile_id,
    parent_profile_digest:parent.profile_digest,
    successor_profile_id:successor.profile_id,
    successor_profile_digest:successor.profile_digest,
    library_digest:parent.library_digest,
    fast_loop_summary_digest:summary.summary_digest,
    min_fast_episodes:minEpisodes,
    observed_fast_episodes:summary.episode_count,
    fast_holdout_digest:summary.fast_holdout_digest,
    meta_holdout_digest:metaHoldout,
    changed_roles:Object.freeze(changed),
    changed_role_count:changed.length,
    max_role_changes:maxChanges,
    same_frozen_backbone_required:true,
    fast_and_slow_holdouts_separate:true,
    fast_loop_and_slow_loop_evidence_separate:true,
    slow_loop_runs_less_frequently:true,
    candidate_can_choose_meta_holdout:false,
    candidate_can_activate_successor:false,
    candidate_can_modify_evaluator_root:false,
    candidate_can_modify_promotion_root:false,
    candidate_can_modify_scheduler_root:false,
    candidate_can_modify_signing_root:false,
    candidate_can_modify_self_update_root:false,
    external_meta_operator:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiMetaSkillEvolutionPlan(plan,parent_profile,successor_profile,library,fast_loop_summary){
  if(!plainObject(plan)||plan.schema!==RSI_META_SKILL_EVOLUTION_PLAN_SCHEMA||plan.version!==1) throw new Error('rsi_meta_skill_plan_invalid');
  assertZeroAuthority(plan,'plan');
  if(
    plan.same_frozen_backbone_required!==true
    ||plan.fast_and_slow_holdouts_separate!==true
    ||plan.fast_loop_and_slow_loop_evidence_separate!==true
    ||plan.slow_loop_runs_less_frequently!==true
    ||plan.candidate_can_choose_meta_holdout!==false
    ||plan.candidate_can_activate_successor!==false
    ||plan.candidate_can_modify_evaluator_root!==false
    ||plan.candidate_can_modify_promotion_root!==false
    ||plan.candidate_can_modify_scheduler_root!==false
    ||plan.candidate_can_modify_signing_root!==false
    ||plan.candidate_can_modify_self_update_root!==false
    ||plan.external_meta_operator!==true
    ||plan.authored_by_candidate!==false
  ) throw new Error('rsi_meta_skill_plan_policy_invalid');
  const canonical=createRsiMetaSkillEvolutionPlan({
    parent_profile,successor_profile,library,fast_loop_summary,
    min_fast_episodes:plan.min_fast_episodes,
    meta_holdout_digest:plan.meta_holdout_digest,
    max_role_changes:plan.max_role_changes,
    external_meta_operator:true,
    authored_by_candidate:false,
  });
  if(canonical.plan_digest!==exactDigest(plan.plan_digest,'plan')) throw new Error('rsi_meta_skill_plan_digest_mismatch');
  return canonical;
}

function normalizeObjectiveSpec(spec){
  if(!Array.isArray(spec)||spec.length<1||spec.length>MAX_OBJECTIVES) throw new Error('rsi_meta_skill_objective_spec_invalid');
  const seen=new Set();
  return Object.freeze(spec.map((row)=>{
    if(!plainObject(row)) throw new Error('rsi_meta_skill_objective_invalid');
    const metric=boundedId(row.metric,'objective_metric');
    if(seen.has(metric)) throw new Error('rsi_meta_skill_objective_duplicate');
    seen.add(metric);
    const direction=boundedToken(row.direction,'objective_direction');
    if(direction!=='MAXIMIZE'&&direction!=='MINIMIZE') throw new Error('rsi_meta_skill_objective_direction_invalid');
    const threshold=Number(row.materiality_threshold);
    if(!Number.isFinite(threshold)||threshold<0) throw new Error('rsi_meta_skill_objective_threshold_invalid');
    return Object.freeze({metric,direction,materiality_threshold:threshold});
  }).sort((a,b)=>a.metric.localeCompare(b.metric)));
}

function normalizeMetricMap(value,spec,label){
  if(!plainObject(value)) throw new Error(`rsi_meta_skill_${label}_metrics_invalid`);
  const keys=Object.keys(value).sort();
  const expected=spec.map((row)=>row.metric).sort();
  if(keys.length!==expected.length||keys.some((key,index)=>key!==expected[index])) throw new Error(`rsi_meta_skill_${label}_metrics_shape_invalid`);
  return Object.freeze(Object.fromEntries(expected.map((metric)=>[metric,finiteNumber(value[metric],`${label}_metric`)])));
}

function relationFor(parentMetrics,successorMetrics,spec){
  let better=0,worse=0;
  const deltas=spec.map((row)=>{
    const parent=parentMetrics[row.metric];
    const successor=successorMetrics[row.metric];
    const signed=row.direction==='MAXIMIZE'?successor-parent:parent-successor;
    const status=signed>row.materiality_threshold?'BETTER':signed<-row.materiality_threshold?'WORSE':'EQUIVALENT';
    if(status==='BETTER') better+=1;
    if(status==='WORSE') worse+=1;
    return Object.freeze({metric:row.metric,direction:row.direction,parent_value:parent,successor_value:successor,signed_successor_gain:signed,status});
  });
  const relation=better>0&&worse===0?'PARETO_ADVANCE':better>0&&worse>0?'TRADEOFF_STEPPING_STONE':better===0&&worse===0?'NO_MEASURED_ADVANCE':'DOMINATED_REGRESSION';
  return Object.freeze({relation,deltas:Object.freeze(deltas),better_count:better,worse_count:worse});
}

export function createRsiMetaSkillEvaluation({
  plan,
  parent_profile,
  successor_profile,
  library,
  fast_loop_summary,
  evaluator_root_digest,
  objective_spec,
  parent_metrics,
  successor_metrics,
  hard_invariants_pass,
  evidence_refs:refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checkedPlan=verifyRsiMetaSkillEvolutionPlan(plan,parent_profile,successor_profile,library,fast_loop_summary);
  if(external_evaluator!==true||authored_by_candidate!==false) throw new Error('rsi_meta_skill_eval_external_origin_required');
  const spec=normalizeObjectiveSpec(objective_spec);
  const parent=normalizeMetricMap(parent_metrics,spec,'parent');
  const successor=normalizeMetricMap(successor_metrics,spec,'successor');
  const hard=hard_invariants_pass===true;
  const relation=hard?relationFor(parent,successor,spec):Object.freeze({relation:'HARD_INVARIANT_REJECT',deltas:Object.freeze([]),better_count:0,worse_count:0});
  const core={
    schema:RSI_META_SKILL_EVALUATION_SCHEMA,
    version:1,
    plan_digest:checkedPlan.plan_digest,
    parent_profile_digest:checkedPlan.parent_profile_digest,
    successor_profile_digest:checkedPlan.successor_profile_digest,
    meta_holdout_digest:checkedPlan.meta_holdout_digest,
    evaluator_root_digest:exactDigest(evaluator_root_digest,'eval_root'),
    objective_spec:spec,
    parent_metrics:parent,
    successor_metrics:successor,
    objective_deltas:relation.deltas,
    relation:relation.relation,
    better_objective_count:relation.better_count,
    worse_objective_count:relation.worse_count,
    hard_invariants_pass:hard,
    evidence_refs:evidenceRefs(refs),
    external_evaluator:true,
    authored_by_candidate:false,
    scalar_winner_authoritative:false,
    evaluation_is_profile_activation_authority:false,
    evaluation_is_promotion_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,evaluation_digest:digest(core)});
}

export function verifyRsiMetaSkillEvaluation(row,plan,parent_profile,successor_profile,library,fast_loop_summary){
  if(!plainObject(row)||row.schema!==RSI_META_SKILL_EVALUATION_SCHEMA||row.version!==1) throw new Error('rsi_meta_skill_eval_invalid');
  assertZeroAuthority(row,'eval');
  if(
    row.external_evaluator!==true
    ||row.authored_by_candidate!==false
    ||row.scalar_winner_authoritative!==false
    ||row.evaluation_is_profile_activation_authority!==false
    ||row.evaluation_is_promotion_authority!==false
  ) throw new Error('rsi_meta_skill_eval_policy_invalid');
  const canonical=createRsiMetaSkillEvaluation({
    plan,parent_profile,successor_profile,library,fast_loop_summary,
    evaluator_root_digest:row.evaluator_root_digest,
    objective_spec:row.objective_spec,
    parent_metrics:row.parent_metrics,
    successor_metrics:row.successor_metrics,
    hard_invariants_pass:row.hard_invariants_pass,
    evidence_refs:row.evidence_refs,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.evaluation_digest!==exactDigest(row.evaluation_digest,'eval')) throw new Error('rsi_meta_skill_eval_digest_mismatch');
  return canonical;
}

export function finalizeRsiMetaSkillEvolution({
  plan,parent_profile,successor_profile,library,fast_loop_summary,evaluation,
} = {}) {
  const checkedPlan=verifyRsiMetaSkillEvolutionPlan(plan,parent_profile,successor_profile,library,fast_loop_summary);
  const checkedEval=verifyRsiMetaSkillEvaluation(evaluation,checkedPlan,parent_profile,successor_profile,library,fast_loop_summary);
  const state=checkedEval.relation==='PARETO_ADVANCE'||checkedEval.relation==='TRADEOFF_STEPPING_STONE'
    ?'ELIGIBLE_FOR_META_ARCHIVE'
    :'REJECTED_FROM_META_ARCHIVE';
  const core={
    schema:RSI_META_SKILL_EVOLUTION_RESULT_SCHEMA,
    version:1,
    plan_digest:checkedPlan.plan_digest,
    evaluation_digest:checkedEval.evaluation_digest,
    parent_profile_digest:checkedPlan.parent_profile_digest,
    successor_profile_digest:checkedPlan.successor_profile_digest,
    relation:checkedEval.relation,
    state,
    changed_roles:checkedPlan.changed_roles,
    eligible_for_meta_archive:state==='ELIGIBLE_FOR_META_ARCHIVE',
    successor_profile_activation_authorized:false,
    parent_profile_replacement_authorized:false,
    meta_archive_admission_is_promotion:false,
    external_profile_activation_required:true,
    existing_rsi_tournament_still_required:true,
    existing_recursive_risk_gate_still_required:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,result_digest:digest(core)});
}

export function rsiMetaSkillEvolutionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.meta-skill-evolution-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-meta-skill-evolution.mjs',
    meta_roles:Object.freeze([...META_ROLES]),
    mechanism:'TWO_TIMESCALE_VERIFIED_SKILL_AND_META_SKILL_EVOLUTION',
    fast_loop_target:'VERIFIED_TASK_SKILLS',
    slow_loop_target:'ANALYZER_RETRIEVER_ALLOCATOR_PROPOSER_EVOLVER_PROFILE',
    frozen_backbone_required:true,
    fast_and_slow_holdouts_separate:true,
    external_fast_summary_required:true,
    external_meta_operator_required:true,
    external_meta_evaluator_required:true,
    max_role_changes_per_slow_step:MAX_ROLE_CHANGES,
    candidate_can_bind_unverified_skill:false,
    candidate_can_choose_meta_holdout:false,
    candidate_can_activate_successor:false,
    scalar_winner_authoritative:false,
    evaluator_root_mutable:false,
    promotion_root_mutable:false,
    scheduler_root_mutable:false,
    signing_root_mutable:false,
    self_update_root_mutable:false,
    meta_skill_result_is_promotion_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,meta_skill_root_digest:digest(root)});
}
