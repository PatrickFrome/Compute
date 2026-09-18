import crypto from 'node:crypto';

export const RSI_SHADOW_COMPARISON_BINDING_SCHEMA='metaengine.rsi.shadow-comparison-binding.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_shadow_comparison_${l}_sha_invalid`);return x}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_shadow_comparison_${l}_digest_invalid`);return x}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_shadow_comparison_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_shadow_comparison_${l}_retry_invalid`);
}
function verifyDigestObject(row,digestField,label){
  const clone=structuredClone(row);delete clone[digestField];
  if(digest(clone)!==exactDigest(row[digestField],label))throw new Error(`rsi_shadow_comparison_${label}_digest_mismatch`);
}
function verifyQualification(q){
  if(!q||q.schema!=='metaengine.rsi.meta-profile-qualification.v1'||q.version!==1)throw new Error('rsi_shadow_comparison_qualification_invalid');
  assertZero(q,'qualification');
  if(q.state!=='QUALIFIED_FOR_SHADOW_PROFILE_SELECTION'||q.qualified_for_shadow_profile_selection!==true
    ||q.live_profile_activation_authorized!==false||q.canary_activation_authorized!==false
    ||q.external_activation_gate_still_required!==true)throw new Error('rsi_shadow_comparison_qualification_policy_invalid');
  verifyDigestObject(q,'qualification_digest','qualification');
  return q;
}
function verifySelection(s){
  if(!s||s.schema!=='metaengine.rsi.meta-profile-shadow-selection.v1'||s.version!==1)throw new Error('rsi_shadow_comparison_selection_invalid');
  assertZero(s,'selection');
  if(s.mode!=='SHADOW_ONLY'||s.external_selector!==true||s.authored_by_candidate!==false
    ||s.candidate_can_select_profile!==false||s.selection_can_change_execution!==false
    ||s.selection_can_replace_incumbent!==false||s.selection_can_grant_skill_activity!==false
    ||s.canary_gate_still_required!==true)throw new Error('rsi_shadow_comparison_selection_policy_invalid');
  verifyDigestObject(s,'selection_digest','selection');
  return s;
}

export function createRsiShadowComparisonBinding({
  selection,
  qualification,
  context_digest,
  baseline_plan_digest,
  comparator_root_digest,
  external_comparator_owner=false,
  authored_by_candidate=true,
}={}){
  const s=verifySelection(selection);
  const q=verifyQualification(qualification);
  if(external_comparator_owner!==true||authored_by_candidate!==false)throw new Error('rsi_shadow_comparison_external_comparator_required');
  if(exactSha(s.source_sha,'selection_source')!==exactSha(q.source_sha,'qualification_source'))throw new Error('rsi_shadow_comparison_source_mismatch');
  if(exactDigest(s.qualification_digest,'selection_qualification')!==q.qualification_digest)throw new Error('rsi_shadow_comparison_qualification_binding_mismatch');
  if(exactDigest(s.incumbent_profile_digest,'incumbent')!==exactDigest(q.parent_profile_digest,'parent'))throw new Error('rsi_shadow_comparison_incumbent_binding_mismatch');
  if(exactDigest(s.challenger_profile_digest,'challenger')!==exactDigest(q.successor_profile_digest,'successor'))throw new Error('rsi_shadow_comparison_challenger_binding_mismatch');

  const core={
    schema:RSI_SHADOW_COMPARISON_BINDING_SCHEMA,version:1,
    source_sha:s.source_sha,
    selection_digest:s.selection_digest,
    qualification_digest:q.qualification_digest,
    champion_profile_digest:q.parent_profile_digest,
    challenger_profile_digest:q.successor_profile_digest,
    verified_context_digest:exactDigest(context_digest,'context'),
    baseline_plan_digest:exactDigest(baseline_plan_digest,'baseline_plan'),
    comparator_root_digest:exactDigest(comparator_root_digest,'comparator_root'),
    comparison_mode:'READ_ONLY_DUAL_PLAN',
    context_source:'BASELINE_PLAN',
    champion_challenger_roles_fixed:true,
    same_verified_context_required:true,
    external_comparator_owner:true,
    authored_by_candidate:false,
    candidate_can_choose_context:false,
    candidate_can_choose_comparator:false,
    candidate_can_swap_roles:false,
    raw_context_exposed_to_candidate:false,
    browser_effects_allowed:false,
    plan_execution_allowed:false,
    baseline_execution_path_unchanged:true,
    comparison_can_change_execution:false,
    comparison_can_activate_profile:false,
    comparison_can_authorize_canary:false,
    external_canary_gate_still_required:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,binding_digest:digest(core)});
}

export function verifyRsiShadowComparisonBinding(binding,{selection,qualification}={}){
  if(!binding||binding.schema!==RSI_SHADOW_COMPARISON_BINDING_SCHEMA||binding.version!==1)throw new Error('rsi_shadow_comparison_binding_invalid');
  assertZero(binding,'binding');
  if(binding.comparison_mode!=='READ_ONLY_DUAL_PLAN'||binding.context_source!=='BASELINE_PLAN'
    ||binding.champion_challenger_roles_fixed!==true||binding.same_verified_context_required!==true
    ||binding.external_comparator_owner!==true||binding.authored_by_candidate!==false
    ||binding.candidate_can_choose_context!==false||binding.candidate_can_choose_comparator!==false
    ||binding.candidate_can_swap_roles!==false||binding.raw_context_exposed_to_candidate!==false
    ||binding.browser_effects_allowed!==false||binding.plan_execution_allowed!==false
    ||binding.baseline_execution_path_unchanged!==true||binding.comparison_can_change_execution!==false
    ||binding.comparison_can_activate_profile!==false||binding.comparison_can_authorize_canary!==false
    ||binding.external_canary_gate_still_required!==true)throw new Error('rsi_shadow_comparison_binding_policy_invalid');
  const canonical=createRsiShadowComparisonBinding({
    selection,qualification,
    context_digest:binding.verified_context_digest,
    baseline_plan_digest:binding.baseline_plan_digest,
    comparator_root_digest:binding.comparator_root_digest,
    external_comparator_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.binding_digest!==exactDigest(binding.binding_digest,'binding'))throw new Error('rsi_shadow_comparison_binding_digest_mismatch');
  return canonical;
}

export function rsiShadowComparisonBindingTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.shadow-comparison-binding-root.v1',version:1,
    durable_phase17_qualification_required:true,
    durable_shadow_selection_required:true,
    comparison_mode:'READ_ONLY_DUAL_PLAN',
    context_source:'BASELINE_PLAN',
    same_verified_context_required:true,
    champion_is_incumbent_parent:true,
    challenger_is_qualified_successor:true,
    external_comparator_owner_required:true,
    candidate_can_choose_context:false,
    candidate_can_choose_comparator:false,
    candidate_can_swap_roles:false,
    raw_context_exposed_to_candidate:false,
    browser_effects_allowed:false,
    plan_execution_allowed:false,
    baseline_execution_path_unchanged:true,
    comparison_can_activate_profile:false,
    comparison_can_authorize_canary:false,
    external_canary_gate_still_required:true,
    existing_runtime_ledger_is_only_comparison_receipt_plane:true,
    second_shadow_binding_ledger_allowed:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,shadow_comparison_root_digest:digest(root)});
}
