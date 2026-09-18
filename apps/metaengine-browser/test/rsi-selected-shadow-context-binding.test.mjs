import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RSI_META_PROFILE_QUALIFICATION_SCHEMA } from '../src/rsi-meta-profile-qualification.mjs';
import { createRsiMetaProfileShadowSelection } from '../src/rsi-meta-profile-shadow-selection.mjs';
import {
  RsiSelectedShadowContextBindingLedger,
  createRsiSelectedShadowContextBinding,
  verifyRsiSelectedShadowContextBinding,
  rsiSelectedShadowContextBindingTrustRootSnapshot,
} from '../src/rsi-selected-shadow-context-binding.mjs';
import { rsiPromotionGateTrustRootSnapshot } from '../src/rsi-promotion-admission-gate.mjs';
import { rsiTournamentTrustRootSnapshot } from '../src/rsi-shadow-tournament.mjs';

const SOURCE='a'.repeat(40);

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function dg(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function qualification({id,parent,successor,index=1}){
  const core={
    schema:RSI_META_PROFILE_QUALIFICATION_SCHEMA,version:1,source_sha:SOURCE,
    qualification_id:id,meta_record_digest:dg({id,kind:'meta'}),
    parent_profile_digest:dg({parent}),successor_profile_digest:dg({successor}),
    shadow_plan_digest:dg({id,kind:'plan'}),shadow_result_digest:dg({id,kind:'result'}),
    certificate_digest:dg({id,kind:'cert'}),risk_budget_digest:dg({kind:'risk'}),
    confirmation_index:index,allocated_alpha:0.01,alpha_used:0.005,global_alpha:0.05,
    state:'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION',qualified_for_shadow_profile_selection:true,
    live_profile_activation_authorized:false,profile_replacement_authorized:false,canary_activation_authorized:false,
    external_activation_gate_still_required:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,qualification_digest:dg(core)});
}
function selection(){
  const profiles=[
    qualification({id:'qualified.alpha',parent:'parent.alpha',successor:'successor.alpha',index:1}),
    qualification({id:'qualified.beta',parent:'parent.beta',successor:'successor.beta',index:2}),
  ];
  return createRsiMetaProfileShadowSelection({
    source_sha:SOURCE,selection_id:'selection.phase18.1',context_class:'CODING',
    context_digest:dg({context:'coding:one'}),qualified_profiles:profiles,selection_history:[],
    external_context_owner:true,authored_by_candidate:false,
  });
}

test('binding fixes champion and challenger to the exact Phase18 selected profile on the same verified context',()=>{
  const selected=selection();
  const binding=createRsiSelectedShadowContextBinding({
    binding_id:'binding.phase19.1',selection:selected,comparator_root_digest:dg({root:'external-comparator'}),
    external_shadow_owner:true,authored_by_candidate:false,
  });
  const checked=verifyRsiSelectedShadowContextBinding(binding,selected);
  assert.equal(checked.selection_digest,selected.selection_digest);
  assert.equal(checked.selected_qualification_digest,selected.selected.qualification_digest);
  assert.equal(checked.champion_profile_digest,selected.selected.parent_profile_digest);
  assert.equal(checked.challenger_profile_digest,selected.selected.successor_profile_digest);
  assert.equal(checked.verified_context_digest,selected.context_digest);
  assert.equal(checked.comparison_mode,'READ_ONLY_DUAL_PLAN');
  assert.equal(checked.selection_policy_reused_without_override,true);
  assert.equal(checked.browser_effects_allowed,false);
  assert.equal(checked.plan_execution_allowed,false);
  assert.equal(checked.canary_activation_authorized,false);
  assert.equal(checked.authority_effect,false);
});

test('candidate cannot author binding, swap roles, choose another context, or bypass the selected qualification',()=>{
  const selected=selection();
  assert.throws(()=>createRsiSelectedShadowContextBinding({
    binding_id:'binding.phase19.candidate',selection:selected,comparator_root_digest:dg({root:'comparator'}),
    external_shadow_owner:false,authored_by_candidate:true,
  }),/external_owner_required/);

  const binding=createRsiSelectedShadowContextBinding({
    binding_id:'binding.phase19.tamper',selection:selected,comparator_root_digest:dg({root:'comparator'}),
    external_shadow_owner:true,authored_by_candidate:false,
  });
  for(const tampered of [
    {...binding,champion_profile_digest:binding.challenger_profile_digest},
    {...binding,challenger_profile_digest:binding.champion_profile_digest},
    {...binding,verified_context_digest:dg({context:'other'})},
    {...binding,selected_qualification_digest:dg({qualification:'other'})},
  ]){
    assert.throws(()=>verifyRsiSelectedShadowContextBinding(tampered,selected),/binding_digest_mismatch|binding_policy_invalid/);
  }
});

test('binding ledger is append-only, restart-safe, source-fenced, and has no active shadow/canary state',async(t)=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'selected-shadow-binding-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const statePath=path.join(root,'bindings.json');
  const selected=selection();
  const binding=createRsiSelectedShadowContextBinding({
    binding_id:'binding.phase19.persist',selection:selected,comparator_root_digest:dg({root:'comparator'}),
    external_shadow_owner:true,authored_by_candidate:false,
  });

  const ledger=new RsiSelectedShadowContextBindingLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  assert.equal((await ledger.add(binding,selected)).state,'READ_ONLY_DUAL_PLAN_BOUND');
  assert.equal((await ledger.add(binding,selected)).state,'IDEMPOTENT');
  assert.equal(ledger.snapshot().row_count,1);
  assert.equal(ledger.snapshot().active_profile_digest,null);
  assert.equal(ledger.snapshot().shadow_profile_digest,null);
  assert.equal(ledger.snapshot().canary_profile_digest,null);

  const restored=new RsiSelectedShadowContextBindingLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.bindings().length,1);
  assert.equal(restored.bindingByDigest(binding.binding_digest).binding_id,binding.binding_id);

  const conflict=createRsiSelectedShadowContextBinding({
    binding_id:binding.binding_id,selection:selected,comparator_root_digest:dg({root:'other-comparator'}),
    external_shadow_owner:true,authored_by_candidate:false,
  });
  await assert.rejects(()=>restored.add(conflict,selected),/binding_conflict/);
});

test('selected shadow binding root stays immutable to candidates and non-authoritative across tournament/promotion',()=>{
  const root=rsiSelectedShadowContextBindingTrustRootSnapshot();
  assert.equal(root.phase18_selection_required,true);
  assert.equal(root.selected_qualification_only,true);
  assert.equal(root.same_verified_context_required,true);
  assert.equal(root.comparison_mode,'READ_ONLY_DUAL_PLAN');
  assert.equal(root.browser_effects_allowed,false);
  assert.equal(root.plan_execution_allowed,false);
  assert.equal(root.active_profile_replacement_authorized,false);
  assert.equal(root.canary_activation_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.binding_root_digest,/^sha256:[0-9a-f]{64}$/);

  const immutable='apps/metaengine-browser/src/rsi-selected-shadow-context-binding.mjs';
  for(const trustRoot of [rsiPromotionGateTrustRootSnapshot(),rsiTournamentTrustRootSnapshot()]){
    assert.equal(trustRoot.immutable_component_paths.includes(immutable),true);
  }
});
