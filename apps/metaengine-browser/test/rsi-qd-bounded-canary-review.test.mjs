import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RSI_META_PROFILE_QUALIFICATION_SCHEMA } from '../src/rsi-meta-profile-qualification.mjs';
import { createRsiMetaProfileShadowSelection } from '../src/rsi-meta-profile-shadow-selection.mjs';
import {
  createRsiMetaProfileShadowComparisonBinding,
  createRsiMetaProfileDualPlanComparison,
} from '../src/rsi-meta-profile-shadow-comparison.mjs';
import {
  RsiQdBoundedCanaryReviewLedger,
  createRsiQdBoundedCanaryReview,
  rsiQdBoundedCanaryReviewTrustRootSnapshot,
  verifyRsiQdBoundedCanaryReview,
} from '../src/rsi-qd-bounded-canary-review.mjs';

const SOURCE='a'.repeat(40);
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function qualification(){
  const core={schema:RSI_META_PROFILE_QUALIFICATION_SCHEMA,version:1,source_sha:SOURCE,
    qualification_id:'qd.canary.qual.1',meta_record_digest:dg({x:'meta'}),parent_profile_digest:dg({x:'parent'}),
    successor_profile_digest:dg({x:'successor'}),shadow_plan_digest:dg({x:'plan'}),shadow_result_digest:dg({x:'result'}),
    certificate_digest:dg({x:'cert'}),risk_budget_digest:dg({x:'risk'}),confirmation_index:1,allocated_alpha:0.01,alpha_used:0.005,global_alpha:0.05,
    state:'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION',qualified_for_shadow_profile_selection:true,live_profile_activation_authorized:false,
    profile_replacement_authorized:false,canary_activation_authorized:false,external_activation_gate_still_required:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,
    automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...core,qualification_digest:dg(core)});
}

function pairs({count=32,contexts=4,hardFailureAt=-1,incidentAt=-1,comparatorDriftAt=-1,divergence=true}={}){
  const q=qualification();
  const out=[];
  for(let i=0;i<count;i++){
    const context=dg({context:i%contexts});
    const selection=createRsiMetaProfileShadowSelection({
      source_sha:SOURCE,selection_id:`qd.canary.selection.${i}`,context_class:'CODING',context_digest:context,
      qualified_profiles:[q],selection_history:[],external_context_owner:true,authored_by_candidate:false,
    });
    const binding=createRsiMetaProfileShadowComparisonBinding({
      binding_id:`qd.canary.binding.${i}`,selection,selected_qualification:q,verified_context_digest:context,
      comparator_root_digest:dg({comparator:i===comparatorDriftAt?'drift':'stable'}),external_comparator_owner:true,authored_by_candidate:false,
    });
    const championProjection=dg({projection:'champion',i});
    const challengerProjection=divergence&&i===0?dg({projection:'challenger',i}):championProjection;
    const comparison=createRsiMetaProfileDualPlanComparison({
      comparison_id:`qd.canary.comparison.${i}`,binding,selection,selected_qualification:q,
      champion_plan_digest:dg({plan:'champion',i}),challenger_plan_digest:dg({plan:'challenger',i}),
      champion_projection_digest:championProjection,challenger_projection_digest:challengerProjection,
      hard_invariants_pass:i!==hardFailureAt,incident_observed:i===incidentAt,divergence_kind:'ROUTING_DECISION',
      evidence_digest:dg({evidence:i}),evidence_refs:[`canary:shadow:${i}`],external_comparator:true,authored_by_candidate:false,
    });
    out.push(Object.freeze({binding,comparison}));
  }
  return out;
}

test('32 clean Phase19 comparisons across four contexts yield only external bounded canary review readiness',()=>{
  const comparisonPairs=pairs();
  const review=createRsiQdBoundedCanaryReview({
    review_id:'qd.canary.review.1',source_sha:SOURCE,comparison_pairs:comparisonPairs,
    cohort_digest:dg({cohort:'external-fixed'}),external_review_owner:true,authored_by_candidate:false,
  });
  assert.equal(review.comparison_count,32);
  assert.equal(review.context_count,4);
  assert.equal(review.divergence_count,1);
  assert.equal(review.canary_surface,'READ_ONLY_DECISION_SUPPORT');
  assert.equal(review.max_canary_decisions,16);
  assert.equal(review.incumbent_remains_default,true);
  assert.equal(review.incumbent_is_mandatory_fallback,true);
  assert.equal(review.ready_for_external_bounded_canary_review,true);
  assert.equal(review.external_canary_controller_required,true);
  assert.equal(review.canary_token,null);
  assert.equal(review.canary_activation_authorized,false);
  assert.equal(review.execution_authority,false);
  assert.equal(verifyRsiQdBoundedCanaryReview(review,{comparison_pairs:comparisonPairs}).review_digest,review.review_digest);
});

test('coverage, identity, comparator and clean-evidence gates fail closed',()=>{
  assert.throws(()=>createRsiQdBoundedCanaryReview({
    review_id:'qd.canary.review.too-few',source_sha:SOURCE,comparison_pairs:pairs({count:31}),
    cohort_digest:dg({cohort:'x'}),external_review_owner:true,authored_by_candidate:false,
  }),/minimum_comparisons_required/);
  assert.throws(()=>createRsiQdBoundedCanaryReview({
    review_id:'qd.canary.review.too-narrow',source_sha:SOURCE,comparison_pairs:pairs({contexts:3}),
    cohort_digest:dg({cohort:'x'}),external_review_owner:true,authored_by_candidate:false,
  }),/context_coverage_insufficient/);
  assert.throws(()=>createRsiQdBoundedCanaryReview({
    review_id:'qd.canary.review.comparator-drift',source_sha:SOURCE,comparison_pairs:pairs({comparatorDriftAt:31}),
    cohort_digest:dg({cohort:'x'}),external_review_owner:true,authored_by_candidate:false,
  }),/comparator_root_drift/);
  assert.throws(()=>createRsiQdBoundedCanaryReview({
    review_id:'qd.canary.review.hard-fail',source_sha:SOURCE,comparison_pairs:pairs({hardFailureAt:31}),
    cohort_digest:dg({cohort:'x'}),external_review_owner:true,authored_by_candidate:false,
  }),/clean_comparison_required/);
  assert.throws(()=>createRsiQdBoundedCanaryReview({
    review_id:'qd.canary.review.incident',source_sha:SOURCE,comparison_pairs:pairs({incidentAt:31}),
    cohort_digest:dg({cohort:'x'}),external_review_owner:true,authored_by_candidate:false,
  }),/clean_comparison_required/);
  assert.throws(()=>createRsiQdBoundedCanaryReview({
    review_id:'qd.canary.review.no-divergence',source_sha:SOURCE,comparison_pairs:pairs({divergence:false}),
    cohort_digest:dg({cohort:'x'}),external_review_owner:true,authored_by_candidate:false,
  }),/meaningful_divergence_required/);
});

test('candidate cannot own the review or choose an active canary',()=>{
  assert.throws(()=>createRsiQdBoundedCanaryReview({
    review_id:'qd.canary.review.candidate',source_sha:SOURCE,comparison_pairs:pairs(),
    cohort_digest:dg({cohort:'x'}),external_review_owner:false,authored_by_candidate:true,
  }),/external_review_owner_required/);
});

test('review ledger is restart durable and rejects self-rehashed policy downgrades',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-qd-canary-review-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const comparisonPairs=pairs();
  const review=createRsiQdBoundedCanaryReview({
    review_id:'qd.canary.review.persist',source_sha:SOURCE,comparison_pairs:comparisonPairs,
    cohort_digest:dg({cohort:'persist'}),external_review_owner:true,authored_by_candidate:false,
  });
  const statePath=path.join(dir,'review.json');
  const ledger=new RsiQdBoundedCanaryReviewLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  assert.equal((await ledger.add(review)).state,'REVIEW_RECORDED');
  assert.equal((await ledger.add(review)).state,'IDEMPOTENT');
  const restored=new RsiQdBoundedCanaryReviewLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,1);
  assert.equal(restored.snapshot().active_canary_digest,null);
  assert.equal(restored.snapshot().ledger_can_activate_canary,false);

  const core={...review,max_canary_decisions:999};delete core.review_digest;
  const weakened={...core,review_digest:dg(core)};
  await assert.rejects(()=>restored.add(weakened),/review_policy_invalid/);
});

test('trust root fixes read-only surface and leaves activation to an external controller',()=>{
  const root=rsiQdBoundedCanaryReviewTrustRootSnapshot();
  assert.equal(root.phase19_clean_dual_plan_comparison_required,true);
  assert.equal(root.minimum_comparisons,32);
  assert.equal(root.minimum_contexts,4);
  assert.equal(root.meaningful_divergence_required,true);
  assert.equal(root.canary_surface,'READ_ONLY_DECISION_SUPPORT');
  assert.equal(root.max_canary_decisions,16);
  assert.equal(root.incumbent_remains_default,true);
  assert.equal(root.external_canary_controller_required,true);
  assert.equal(root.canary_token_minted,false);
  assert.equal(root.canary_activation_authorized,false);
  assert.equal(root.authority_effect,false);
});
