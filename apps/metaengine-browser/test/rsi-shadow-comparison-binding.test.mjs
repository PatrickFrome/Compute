import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiShadowComparisonBinding,
  verifyRsiShadowComparisonBinding,
  rsiShadowComparisonBindingTrustRootSnapshot,
} from '../src/rsi-shadow-comparison-binding.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function qualification(){
  const core={
    schema:'metaengine.rsi.meta-profile-qualification.v1',version:1,
    source_sha:SOURCE,qualification_id:'shadow.compare.qualification.1',
    meta_record_digest:d('1'),parent_profile_digest:d('2'),successor_profile_digest:d('3'),
    shadow_plan_digest:d('4'),shadow_result_digest:d('5'),certificate_digest:d('6'),
    risk_budget_digest:d('7'),confirmation_index:1,allocated_alpha:0.01,alpha_used:0.01,global_alpha:0.05,
    state:'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION',qualified_for_shadow_profile_selection:true,
    live_profile_activation_authorized:false,profile_replacement_authorized:false,
    canary_activation_authorized:false,external_activation_gate_still_required:true,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,qualification_digest:digest(core)});
}
function selection(q){
  const core={
    schema:'metaengine.rsi.meta-profile-shadow-selection.v1',version:1,
    source_sha:SOURCE,selection_id:'shadow.compare.selection.1',
    qualification_digest:q.qualification_digest,meta_record_digest:q.meta_record_digest,library_digest:d('8'),
    incumbent_profile_digest:q.parent_profile_digest,challenger_profile_digest:q.successor_profile_digest,
    mode:'SHADOW_ONLY',external_selector:true,authored_by_candidate:false,
    candidate_can_select_profile:false,selection_can_change_execution:false,
    selection_can_replace_incumbent:false,selection_can_grant_skill_activity:false,
    continuous_shadow_review_required:true,canary_gate_still_required:true,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,selection_digest:digest(core)});
}

test('shadow comparison binds qualified challenger to exact baseline context and comparator root',()=>{
  const q=qualification();
  const s=selection(q);
  const binding=createRsiShadowComparisonBinding({
    selection:s,qualification:q,context_digest:d('9'),baseline_plan_digest:d('a'),comparator_root_digest:d('b'),
    external_comparator_owner:true,authored_by_candidate:false,
  });
  verifyRsiShadowComparisonBinding(binding,{selection:s,qualification:q});
  assert.equal(binding.champion_profile_digest,q.parent_profile_digest);
  assert.equal(binding.challenger_profile_digest,q.successor_profile_digest);
  assert.equal(binding.verified_context_digest,d('9'));
  assert.equal(binding.baseline_plan_digest,d('a'));
  assert.equal(binding.comparator_root_digest,d('b'));
  assert.equal(binding.comparison_mode,'READ_ONLY_DUAL_PLAN');
  assert.equal(binding.context_source,'BASELINE_PLAN');
  assert.equal(binding.baseline_execution_path_unchanged,true);
  assert.equal(binding.comparison_can_activate_profile,false);
  assert.equal(binding.comparison_can_authorize_canary,false);
  assert.equal(binding.browser_authority,false);
  assert.equal(binding.task_authority,false);
  assert.equal(binding.authority_effect,false);
});

test('candidate cannot own comparator or swap incumbent and challenger roles',()=>{
  const q=qualification();
  const s=selection(q);
  assert.throws(()=>createRsiShadowComparisonBinding({
    selection:s,qualification:q,context_digest:d('9'),baseline_plan_digest:d('a'),comparator_root_digest:d('b'),
    external_comparator_owner:false,authored_by_candidate:true,
  }),/external_comparator_required/);

  const binding=createRsiShadowComparisonBinding({
    selection:s,qualification:q,context_digest:d('9'),baseline_plan_digest:d('a'),comparator_root_digest:d('b'),
    external_comparator_owner:true,authored_by_candidate:false,
  });
  const tampered={...binding,champion_profile_digest:q.successor_profile_digest,challenger_profile_digest:q.parent_profile_digest};
  assert.throws(()=>verifyRsiShadowComparisonBinding(tampered,{selection:s,qualification:q}),/binding_digest_mismatch/);
});

test('comparison rejects selection that is not exactly bound to the durable qualification',()=>{
  const q=qualification();
  const other=qualification();
  const forgedCore={...selection(q),qualification_digest:d('c')};
  delete forgedCore.selection_digest;
  const forged=Object.freeze({...forgedCore,selection_digest:digest(forgedCore)});
  assert.throws(()=>createRsiShadowComparisonBinding({
    selection:forged,qualification:other,context_digest:d('9'),baseline_plan_digest:d('a'),comparator_root_digest:d('b'),
    external_comparator_owner:true,authored_by_candidate:false,
  }),/qualification_binding_mismatch/);
});

test('shadow comparison trust root reuses the existing runtime ledger and forbids a second binding ledger',()=>{
  const root=rsiShadowComparisonBindingTrustRootSnapshot();
  assert.equal(root.durable_phase17_qualification_required,true);
  assert.equal(root.durable_shadow_selection_required,true);
  assert.equal(root.context_source,'BASELINE_PLAN');
  assert.equal(root.same_verified_context_required,true);
  assert.equal(root.external_comparator_owner_required,true);
  assert.equal(root.existing_runtime_ledger_is_only_comparison_receipt_plane,true);
  assert.equal(root.second_shadow_binding_ledger_allowed,false);
  assert.equal(root.comparison_can_activate_profile,false);
  assert.equal(root.comparison_can_authorize_canary,false);
  assert.equal(root.browser_authority,false);
  assert.equal(root.task_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.shadow_comparison_root_digest,/^sha256:[0-9a-f]{64}$/);
});
