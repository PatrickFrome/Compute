import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiProxyCalibrationPolicy,
  verifyRsiProxyCalibrationPolicy,
  createRsiProxyHoldoutPair,
  verifyRsiProxyHoldoutPair,
  createRsiProxyReliabilitySnapshot,
  verifyRsiProxyReliabilitySnapshot,
  createRsiProxyAllocationGuidance,
  rsiProxyCalibrationTrustRootSnapshot,
} from '../src/rsi-proxy-reliability-calibration.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;

function hexId(index,width){
  return index.toString(16).padStart(width,'0');
}
function candidateId(index){
  return `candidate_sha256_${hexId(index,64)}`;
}
function candidateSha(index){
  return hexId(index,40);
}

function policy(overrides={}){
  return createRsiProxyCalibrationPolicy({
    policy_id:'proxy.calibration.judge.1',
    proxy_stage:'LLM_JUDGE_TRIAGE',
    proxy_identity_digest:d('a'),
    full_holdout_digest:d('b'),
    intervention_suite_digest:d('c'),
    min_pairs:24,
    proxy_pass_threshold:0.5,
    holdout_pass_threshold:0.5,
    calibrated_min_concordance:0.75,
    degraded_min_concordance:0.6,
    max_false_positive_upper:0.25,
    max_brier:0.18,
    recent_window:12,
    drift_brier_delta:0.08,
    external_policy_owner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function pair(p,index,{proxy,holdout,intervention=false,evaluator='f'}={}){
  return createRsiProxyHoldoutPair({
    pair_id:`pair.${index}`,
    policy:p,
    sequence:index,
    candidate_id:candidateId(index),
    candidate_sha:candidateSha(index),
    proxy_score:proxy,
    holdout_score:holdout,
    proxy_receipt_digest:d('d'),
    holdout_receipt_digest:d('e'),
    evaluator_root_digest:d(evaluator),
    intervention_case:intervention,
    evidence_refs:[`RUN_PAIR_${index}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function calibratedPairs(p,count=24,start=1){
  return Array.from({length:count},(_,offset)=>{
    const i=start+offset;
    const rank=offset/(count-1);
    const holdout=0.05+0.9*rank;
    const proxy=Math.min(0.99,Math.max(0.01,holdout+(offset%2===0?0.01:-0.01)));
    return pair(p,i,{proxy,holdout,intervention:offset<4});
  });
}

test('policy treats proxy output as noisy labels and requires heldout/intervention calibration before pruning',()=>{
  const p=policy();
  verifyRsiProxyCalibrationPolicy(p);
  assert.equal(p.heldout_pairing_required,true);
  assert.equal(p.controlled_intervention_suite_required,true);
  assert.equal(p.proxy_output_is_noisy_label,true);
  assert.equal(p.calibration_precedes_pruning,true);
  assert.equal(p.insufficient_evidence_disables_aggressive_pruning,true);
  assert.equal(p.drift_disables_aggressive_pruning,true);
  assert.equal(p.candidate_can_edit_calibration,false);
  assert.equal(p.candidate_can_choose_calibration_pairs,false);
  assert.equal(p.candidate_can_set_proxy_weight,false);
  assert.equal(p.authority_effect,false);
});

test('candidate cannot author calibration pair or alias hidden holdout with intervention suite',()=>{
  const p=policy();
  assert.throws(()=>createRsiProxyHoldoutPair({
    pair_id:'pair.self',policy:p,sequence:1,candidate_id:candidateId(1),candidate_sha:candidateSha(1),
    proxy_score:0.9,holdout_score:0.9,proxy_receipt_digest:d('d'),holdout_receipt_digest:d('e'),evaluator_root_digest:d('f'),
    intervention_case:true,evidence_refs:['MODEL_SELF_REPORT'],external_evaluator:false,authored_by_candidate:true,
  }),/external_origin_required/);
  assert.throws(()=>policy({
    full_holdout_digest:d('b'),
    intervention_suite_digest:d('b'),
  }),/holdout_intervention_alias_forbidden/);
});

test('well aligned heldout pairs produce CALIBRATED proxy state with rank/Brier/FPR evidence',()=>{
  const p=policy();
  const rows=calibratedPairs(p);
  for(const row of rows)verifyRsiProxyHoldoutPair(row,p);
  const snapshot=createRsiProxyReliabilitySnapshot({policy:p,pairs:rows});
  verifyRsiProxyReliabilitySnapshot(snapshot,p,rows);
  assert.equal(snapshot.state,'CALIBRATED');
  assert.ok(snapshot.all_time.rank.concordance>=0.95);
  assert.ok(snapshot.all_time.brier_score<p.max_brier);
  assert.equal(snapshot.all_time.false_positive_count,0);
  assert.ok(snapshot.all_time.false_positive_wilson_95.upper<=p.max_false_positive_upper);
  assert.equal(snapshot.intervention_case_count,4);
  assert.equal(snapshot.heldout_pairing_verified,true);
  assert.equal(snapshot.proxy_output_treated_as_noisy_label,true);
  assert.equal(snapshot.calibration_state_is_pruning_authority,false);
  assert.equal(snapshot.calibration_state_is_promotion_authority,false);
  assert.equal(snapshot.authority_effect,false);
});

test('too little evidence disables aggressive pruning even when observed pairs look perfect',()=>{
  const p=policy();
  const rows=calibratedPairs(p,8);
  const snapshot=createRsiProxyReliabilitySnapshot({policy:p,pairs:rows});
  assert.equal(snapshot.state,'INSUFFICIENT_EVIDENCE');
  const guidance=createRsiProxyAllocationGuidance({policy:p,snapshot});
  assert.equal(guidance.pruning_mode,'AGGRESSIVE_PRUNING_DISABLED');
  assert.equal(guidance.minimum_exploration_fraction,0.5);
  assert.equal(guidance.minimum_forced_full_evaluation_fraction,0.5);
  assert.equal(guidance.guidance_allocates_compute_only,true);
  assert.equal(guidance.guidance_is_scheduler_authority,false);
});

test('anti-correlated proxy becomes UNRELIABLE and receives zero allocation weight',()=>{
  const p=policy();
  const rows=Array.from({length:24},(_,offset)=>{
    const i=offset+1;
    const holdout=0.05+0.9*(offset/23);
    const proxy=1-holdout;
    return pair(p,i,{proxy,holdout,intervention:offset<4});
  });
  const snapshot=createRsiProxyReliabilitySnapshot({policy:p,pairs:rows});
  assert.equal(snapshot.state,'UNRELIABLE');
  assert.ok(snapshot.all_time.rank.kendall_like_tau<0);
  const guidance=createRsiProxyAllocationGuidance({policy:p,snapshot});
  assert.equal(guidance.proxy_allocation_weight,0);
  assert.equal(guidance.pruning_mode,'PROXY_PRUNING_DISABLED');
  assert.equal(guidance.minimum_exploration_fraction,0.5);
  assert.equal(guidance.minimum_forced_full_evaluation_fraction,0.5);
  assert.equal(guidance.guidance_is_archive_authority,false);
  assert.equal(guidance.guidance_is_promotion_authority,false);
  assert.equal(guidance.candidate_can_override_guidance,false);
});

test('recent reliability drift disables proxy pruning even when older history was calibrated',()=>{
  const p=policy({min_pairs:24,recent_window:12});
  const prior=calibratedPairs(p,24,1);
  const recent=Array.from({length:12},(_,offset)=>{
    const i=25+offset;
    const holdout=0.08+0.84*(offset/11);
    const proxy=1-holdout;
    return pair(p,i,{proxy,holdout,intervention:offset<2});
  });
  const snapshot=createRsiProxyReliabilitySnapshot({policy:p,pairs:[...prior,...recent]});
  assert.equal(snapshot.drift_detected,true);
  assert.ok(snapshot.brier_drift>p.drift_brier_delta);
  assert.equal(snapshot.state,'UNRELIABLE');
  const guidance=createRsiProxyAllocationGuidance({policy:p,snapshot});
  assert.equal(guidance.drift_detected,true);
  assert.equal(guidance.proxy_allocation_weight,0);
});

test('duplicate candidate, sequence or mixed evaluator root fails calibration evidence binding',()=>{
  const p=policy();
  const rows=calibratedPairs(p);
  assert.throws(()=>createRsiProxyReliabilitySnapshot({
    policy:p,
    pairs:[...rows.slice(0,23),pair(p,24,{proxy:0.9,holdout:0.9,evaluator:'a'})],
  }),/evaluator_root_mismatch/);

  assert.throws(()=>createRsiProxyReliabilitySnapshot({
    policy:p,
    pairs:[...rows,createRsiProxyHoldoutPair({
      pair_id:'pair.duplicate-candidate',
      policy:p,
      sequence:25,
      candidate_id:rows[0].candidate_id,
      candidate_sha:rows[0].candidate_sha,
      proxy_score:0.9,
      holdout_score:0.9,
      proxy_receipt_digest:d('d'),
      holdout_receipt_digest:d('e'),
      evaluator_root_digest:d('f'),
      intervention_case:false,
      evidence_refs:['RUN_DUP'],
      external_evaluator:true,
      authored_by_candidate:false,
    })],
  }),/candidate_duplicate/);
});

test('calibration guidance remains compute allocation only and never final evaluator or scheduler authority',()=>{
  const p=policy();
  const rows=calibratedPairs(p);
  const snapshot=createRsiProxyReliabilitySnapshot({policy:p,pairs:rows});
  const guidance=createRsiProxyAllocationGuidance({policy:p,snapshot});
  assert.equal(guidance.reliability_state,'CALIBRATED');
  assert.equal(guidance.proxy_allocation_weight,1);
  assert.equal(guidance.pruning_mode,'NORMAL_PROXY_PRUNING');
  assert.equal(guidance.guidance_allocates_compute_only,true);
  assert.equal(guidance.guidance_is_scheduler_authority,false);
  assert.equal(guidance.guidance_is_archive_authority,false);
  assert.equal(guidance.guidance_is_promotion_authority,false);
  assert.equal(guidance.existing_scheduler_admission_required,true);
  assert.equal(guidance.authority_effect,false);
});

test('proxy calibration trust root freezes reliability policy outside candidate control',()=>{
  const root=rsiProxyCalibrationTrustRootSnapshot();
  assert.equal(root.heldout_pairing_required,true);
  assert.equal(root.controlled_intervention_suite_required,true);
  assert.equal(root.proxy_output_is_noisy_label,true);
  assert.equal(root.wilson_false_positive_bound,true);
  assert.equal(root.pairwise_rank_concordance,true);
  assert.equal(root.brier_calibration_error,true);
  assert.equal(root.drift_detection,true);
  assert.equal(root.insufficient_evidence_disables_aggressive_pruning,true);
  assert.equal(root.unreliable_proxy_weight_zero,true);
  assert.equal(root.exploration_escape_hatch_expands_when_unreliable,true);
  assert.equal(root.candidate_can_edit_calibration,false);
  assert.equal(root.candidate_can_choose_calibration_pairs,false);
  assert.equal(root.candidate_can_set_proxy_weight,false);
  assert.equal(root.scheduler_action_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.proxy_calibration_root_digest,/^sha256:[0-9a-f]{64}$/);
});
