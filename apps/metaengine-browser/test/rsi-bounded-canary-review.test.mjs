import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RSI_SHADOW_DIVERGENCE_REVIEW_EVIDENCE_SCHEMA,
} from '../src/rsi-shadow-divergence-monitor.mjs';
import {
  RsiBoundedCanaryReviewLedger,
  createRsiBoundedCanaryReview,
  rsiBoundedCanaryReviewTrustRootSnapshot,
  verifyRsiBoundedCanaryReview,
  verifyRsiShadowReviewEvidence,
} from '../src/rsi-bounded-canary-review.mjs';
import { rsiPromotionGateTrustRootSnapshot } from '../src/rsi-promotion-admission-gate.mjs';
import { rsiTournamentTrustRootSnapshot } from '../src/rsi-shadow-tournament.mjs';

const SOURCE='a'.repeat(40);

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function d(label){return digest({label});}

function reviewEvidence(overrides={}){
  const core={
    schema:RSI_SHADOW_DIVERGENCE_REVIEW_EVIDENCE_SCHEMA,
    version:1,
    source_sha:SOURCE,
    monitor_id:'shadow.monitor.review.1',
    policy_digest:d('policy'),
    binding_digest:d('binding'),
    qualification_digest:d('qualification'),
    champion_profile_digest:d('champion'),
    challenger_profile_digest:d('challenger'),
    verified_context_digest:d('context'),
    monitor_root_digest:d('monitor-root'),
    security_negative_holdout_digest:d('security-negative'),
    from_scratch_replay_root_digest:d('replay-root'),
    observation_count:8,
    relation_counts:Object.freeze({
      CHALLENGER_BETTER:1,
      CHAMPION_BETTER:0,
      INCONCLUSIVE:0,
      MATCH:7,
      TRADEOFF:0,
    }),
    incident_latched:false,
    first_incident_observation_index:null,
    first_incident_codes:Object.freeze([]),
    enough_evidence:true,
    no_negative_comparative_evidence:true,
    challenger_has_positive_evidence:true,
    ready_for_external_bounded_canary_review:true,
    champion_remains_default:true,
    active_profile_replacement_authorized:false,
    canary_activation_authorized:false,
    external_review_still_required:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
    ...overrides,
  };
  return Object.freeze({...core,review_evidence_digest:digest(core)});
}

test('sealed monitor evidence yields review eligibility only, never canary activation',()=>{
  const evidence=reviewEvidence();
  verifyRsiShadowReviewEvidence(evidence);
  const review=createRsiBoundedCanaryReview({
    review_id:'bounded.canary.review.1',
    shadow_review_evidence:evidence,
    external_cohort_digest:d('cohort'),
    decision_budget:128,
    window_budget:32,
    action_surface:'READ_ONLY_DECISION_SUPPORT_CANARY',
    external_reviewer:true,
    authored_by_candidate:false,
  });
  verifyRsiBoundedCanaryReview(review,{shadow_review_evidence:evidence});
  assert.equal(review.state,'READY_FOR_EXTERNAL_CANARY_CONTROLLER_REVIEW');
  assert.equal(review.decision_budget,128);
  assert.equal(review.window_budget,32);
  assert.equal(review.champion_remains_default,true);
  assert.equal(review.champion_is_mandatory_fallback,true);
  assert.equal(review.challenger_is_advisory_only,true);
  assert.equal(review.review_can_activate_canary,false);
  assert.equal(review.review_can_execute_browser_effect,false);
  assert.equal(review.canary_activation_authorized,false);
  assert.equal(review.production_activation_authorized,false);
  assert.equal(review.authority_effect,false);
});

test('incident, comparative regression, or insufficient evidence cannot enter bounded review',()=>{
  for(const [label,patch] of [
    ['incident',{incident_latched:true,first_incident_observation_index:2,first_incident_codes:Object.freeze(['SECURITY_NEGATIVE_FAILURE']),ready_for_external_bounded_canary_review:false}],
    ['champion-better',{no_negative_comparative_evidence:false,ready_for_external_bounded_canary_review:false}],
    ['insufficient',{observation_count:7,enough_evidence:false,ready_for_external_bounded_canary_review:false}],
    ['no-positive',{challenger_has_positive_evidence:false,ready_for_external_bounded_canary_review:false}],
  ]){
    assert.throws(()=>createRsiBoundedCanaryReview({
      review_id:`bounded.canary.review.${label}`,
      shadow_review_evidence:reviewEvidence(patch),
      external_cohort_digest:d('cohort'),
      external_reviewer:true,
      authored_by_candidate:false,
    }),/shadow_evidence_not_ready|shadow_observation_floor_invalid/);
  }
});

test('cohort budgets and canary surface are externally fixed',()=>{
  const evidence=reviewEvidence();
  assert.throws(()=>createRsiBoundedCanaryReview({
    review_id:'bounded.canary.review.bad-decisions',
    shadow_review_evidence:evidence,
    external_cohort_digest:d('cohort'),
    decision_budget:127,
    external_reviewer:true,
    authored_by_candidate:false,
  }),/fixed_decision_budget_required/);
  assert.throws(()=>createRsiBoundedCanaryReview({
    review_id:'bounded.canary.review.bad-windows',
    shadow_review_evidence:evidence,
    external_cohort_digest:d('cohort'),
    window_budget:31,
    external_reviewer:true,
    authored_by_candidate:false,
  }),/fixed_window_budget_required/);
  assert.throws(()=>createRsiBoundedCanaryReview({
    review_id:'bounded.canary.review.bad-surface',
    shadow_review_evidence:evidence,
    external_cohort_digest:d('cohort'),
    action_surface:'BROWSER_MUTATION',
    external_reviewer:true,
    authored_by_candidate:false,
  }),/surface_invalid/);
  assert.throws(()=>createRsiBoundedCanaryReview({
    review_id:'bounded.canary.review.candidate',
    shadow_review_evidence:evidence,
    external_cohort_digest:d('cohort'),
    external_reviewer:false,
    authored_by_candidate:true,
  }),/external_reviewer_required/);
});

test('review and monitor evidence tampering fail closed',()=>{
  const evidence=reviewEvidence();
  const review=createRsiBoundedCanaryReview({
    review_id:'bounded.canary.review.tamper',
    shadow_review_evidence:evidence,
    external_cohort_digest:d('cohort'),
    external_reviewer:true,
    authored_by_candidate:false,
  });
  assert.throws(
    ()=>verifyRsiShadowReviewEvidence({...evidence,challenger_has_positive_evidence:false}),
    /shadow_evidence_not_ready/,
  );
  assert.throws(
    ()=>verifyRsiBoundedCanaryReview({...review,review_can_activate_canary:true},{shadow_review_evidence:evidence}),
    /policy_invalid/,
  );
  assert.throws(
    ()=>verifyRsiBoundedCanaryReview({...review,external_cohort_digest:d('tampered')},{shadow_review_evidence:evidence}),
    /digest_mismatch/,
  );
});

test('ledger persists monitor evidence with the review and re-verifies both on restart',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-bounded-canary-review-'));
  try{
    const statePath=path.join(root,'review.json');
    const evidence=reviewEvidence();
    const review=createRsiBoundedCanaryReview({
      review_id:'bounded.canary.review.persist',
      shadow_review_evidence:evidence,
      external_cohort_digest:d('cohort'),
      external_reviewer:true,
      authored_by_candidate:false,
    });
    const ledger=new RsiBoundedCanaryReviewLedger({statePath,source_sha:SOURCE});
    await ledger.init();
    assert.equal((await ledger.append({review,shadow_review_evidence:evidence})).state,'READY_FOR_EXTERNAL_CANARY_CONTROLLER_REVIEW');
    assert.equal((await ledger.append({review,shadow_review_evidence:evidence})).state,'IDEMPOTENT');
    assert.equal(ledger.snapshot().row_count,1);
    assert.equal(ledger.snapshot().active_profile_digest,null);
    assert.equal(ledger.snapshot().active_canary_review_digest,null);
    assert.equal(ledger.snapshot().ledger_can_activate_canary,false);
    assert.equal(ledger.snapshot().ledger_can_replace_profile,false);
    assert.equal(ledger.evidenceForReview(review.review_digest).review_evidence_digest,evidence.review_evidence_digest);

    const restored=new RsiBoundedCanaryReviewLedger({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().row_count,1);
    assert.equal(restored.reviews()[0].review_digest,review.review_digest);

    const raw=JSON.parse(await fs.readFile(statePath,'utf8'));
    raw.rows[0].shadow_review_evidence.challenger_has_positive_evidence=false;
    const tamperedPath=path.join(root,'tampered.json');
    await fs.writeFile(tamperedPath,JSON.stringify(raw),'utf8');
    const tampered=new RsiBoundedCanaryReviewLedger({statePath:tamperedPath,source_sha:SOURCE});
    await assert.rejects(()=>tampered.init(),/ledger_digest_mismatch|shadow_evidence_not_ready|shadow_evidence_digest_mismatch/);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('bounded review trust root preserves baseline and zero authority',()=>{
  const root=rsiBoundedCanaryReviewTrustRootSnapshot();
  assert.equal(root.sealed_shadow_monitor_evidence_required,true);
  assert.equal(root.incident_free_monitor_required,true);
  assert.equal(root.challenger_positive_evidence_required,true);
  assert.equal(root.negative_comparative_evidence_forbidden,true);
  assert.equal(root.fixed_decision_budget,128);
  assert.equal(root.fixed_window_budget,32);
  assert.equal(root.allowed_surface,'READ_ONLY_DECISION_SUPPORT_CANARY');
  assert.equal(root.champion_remains_default,true);
  assert.equal(root.champion_is_mandatory_fallback,true);
  assert.equal(root.external_canary_controller_required,true);
  assert.equal(root.canary_activation_authorized,false);
  assert.equal(root.production_activation_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.review_root_digest,/^sha256:[0-9a-f]{64}$/);
});


test('downstream tournament and promotion roots freeze the entire meta-profile review policy',()=>{
  const required=[
    'apps/metaengine-browser/src/rsi-runtime-meta-skill-archive.mjs',
    'apps/metaengine-browser/src/rsi-meta-profile-qualification.mjs',
    'apps/metaengine-browser/src/rsi-meta-profile-shadow-selection.mjs',
    'apps/metaengine-browser/src/rsi-shadow-profile-binding.mjs',
    'apps/metaengine-browser/src/rsi-shadow-divergence-monitor.mjs',
    'apps/metaengine-browser/src/rsi-bounded-canary-review.mjs',
  ];
  for(const root of [rsiPromotionGateTrustRootSnapshot(),rsiTournamentTrustRootSnapshot()]){
    for(const path of required)assert.equal(root.immutable_component_paths.includes(path),true,path);
  }
});
