import crypto from 'node:crypto';

export const RSI_PROXY_CALIBRATION_POLICY_SCHEMA = 'metaengine.rsi.proxy-calibration-policy.v1';
export const RSI_PROXY_HOLDOUT_PAIR_SCHEMA = 'metaengine.rsi.proxy-holdout-pair.v1';
export const RSI_PROXY_RELIABILITY_SNAPSHOT_SCHEMA = 'metaengine.rsi.proxy-reliability-snapshot.v1';
export const RSI_PROXY_ALLOCATION_GUIDANCE_SCHEMA = 'metaengine.rsi.proxy-allocation-guidance.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_PAIRS=2048;
const MAX_REFS=32;

const PROXY_STAGES=new Set(['LLM_JUDGE_TRIAGE','TARGETED_SHARD']);
const RELIABILITY_STATES=new Set(['CALIBRATED','DEGRADED','UNRELIABLE','INSUFFICIENT_EVIDENCE']);

function plainObject(v){if(!v||typeof v!=='object'||Array.isArray(v))return false;const p=Object.getPrototypeOf(v);return p===Object.prototype||p===null}
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactDigest(v,l){const o=String(v||'').toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_proxy_${l}_digest_invalid`);return o}
function exactSha(v,l){const o=String(v||'').toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_proxy_${l}_sha_invalid`);return o}
function exactCandidateId(v,l){const o=String(v||'').toLowerCase();if(!CANDIDATE_ID_RE.test(o))throw new Error(`rsi_proxy_${l}_candidate_id_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_proxy_${l}_invalid`);return o}
function boundedToken(v,l){const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_proxy_${l}_invalid`);return o}
function positiveInt(v,l,max=Number.MAX_SAFE_INTEGER){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_proxy_${l}_invalid`);return o}
function probability(v,l,{allowZero=true,allowOne=true}={}){const o=Number(v);if(!Number.isFinite(o)||(allowZero?o<0:o<=0)||(allowOne?o>1:o>=1))throw new Error(`rsi_proxy_${l}_invalid`);return o}
function refs(v){if(!Array.isArray(v)||v.length<1||v.length>MAX_REFS)throw new Error('rsi_proxy_evidence_refs_invalid');const s=new Set();return v.map(x=>{const r=boundedId(x,'evidence_ref');if(s.has(r))throw new Error('rsi_proxy_evidence_ref_duplicate');s.add(r);return r}).sort()}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_proxy_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_proxy_${l}_automatic_retry_invalid`)}

function wilson(successes,total,z=1.96){
  if(total===0)return {lower:0,upper:1};
  const p=successes/total;
  const z2=z*z;
  const den=1+z2/total;
  const center=(p+z2/(2*total))/den;
  const margin=(z*Math.sqrt((p*(1-p)+z2/(4*total))/total))/den;
  return {lower:Math.max(0,center-margin),upper:Math.min(1,center+margin)};
}

function pairwiseConcordance(rows){
  let concordant=0,discordant=0,ties=0;
  for(let i=0;i<rows.length;i+=1){
    for(let j=i+1;j<rows.length;j+=1){
      const proxyDelta=rows[i].proxy_score-rows[j].proxy_score;
      const holdoutDelta=rows[i].holdout_score-rows[j].holdout_score;
      if(proxyDelta===0||holdoutDelta===0){ties+=1;continue;}
      if(Math.sign(proxyDelta)===Math.sign(holdoutDelta))concordant+=1;else discordant+=1;
    }
  }
  const comparable=concordant+discordant;
  return Object.freeze({
    comparable_pairs:comparable,
    concordant_pairs:concordant,
    discordant_pairs:discordant,
    tied_pairs:ties,
    concordance:comparable===0?0.5:concordant/comparable,
    kendall_like_tau:comparable===0?0:(concordant-discordant)/comparable,
  });
}

export function createRsiProxyCalibrationPolicy({
  policy_id,
  proxy_stage,
  proxy_identity_digest,
  full_holdout_digest,
  intervention_suite_digest,
  min_pairs=24,
  proxy_pass_threshold=0.5,
  holdout_pass_threshold=0.5,
  calibrated_min_concordance=0.75,
  degraded_min_concordance=0.6,
  max_false_positive_upper=0.25,
  max_brier=0.18,
  recent_window=12,
  drift_brier_delta=0.08,
  external_policy_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_policy_owner!==true||authored_by_candidate!==false)throw new Error('rsi_proxy_policy_external_origin_required');
  const stage=boundedToken(proxy_stage,'proxy_stage');if(!PROXY_STAGES.has(stage))throw new Error('rsi_proxy_stage_invalid');
  const min=positiveInt(min_pairs,'min_pairs',MAX_PAIRS);
  const recent=positiveInt(recent_window,'recent_window',MAX_PAIRS);
  if(recent>min)throw new Error('rsi_proxy_recent_window_exceeds_min_pairs');
  const degraded=probability(degraded_min_concordance,'degraded_min_concordance');
  const calibrated=probability(calibrated_min_concordance,'calibrated_min_concordance');
  if(calibrated<degraded)throw new Error('rsi_proxy_concordance_threshold_order_invalid');
  const proxyDigest=exactDigest(proxy_identity_digest,'proxy_identity');
  const holdout=exactDigest(full_holdout_digest,'full_holdout');
  const intervention=exactDigest(intervention_suite_digest,'intervention_suite');
  if(holdout===intervention)throw new Error('rsi_proxy_holdout_intervention_alias_forbidden');

  const core={
    schema:RSI_PROXY_CALIBRATION_POLICY_SCHEMA,
    version:1,
    policy_id:boundedId(policy_id,'policy_id'),
    proxy_stage:stage,
    proxy_identity_digest:proxyDigest,
    full_holdout_digest:holdout,
    intervention_suite_digest:intervention,
    min_pairs:min,
    proxy_pass_threshold:probability(proxy_pass_threshold,'proxy_pass_threshold'),
    holdout_pass_threshold:probability(holdout_pass_threshold,'holdout_pass_threshold'),
    calibrated_min_concordance:calibrated,
    degraded_min_concordance:degraded,
    max_false_positive_upper:probability(max_false_positive_upper,'max_false_positive_upper'),
    max_brier:probability(max_brier,'max_brier'),
    recent_window:recent,
    drift_brier_delta:probability(drift_brier_delta,'drift_brier_delta'),
    heldout_pairing_required:true,
    controlled_intervention_suite_required:true,
    proxy_output_is_noisy_label:true,
    calibration_precedes_pruning:true,
    insufficient_evidence_disables_aggressive_pruning:true,
    drift_disables_aggressive_pruning:true,
    candidate_can_edit_calibration:false,
    candidate_can_choose_calibration_pairs:false,
    candidate_can_set_proxy_weight:false,
    external_policy_owner:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,policy_digest:digest(core)});
}

export function verifyRsiProxyCalibrationPolicy(row){
  if(!plainObject(row)||row.schema!==RSI_PROXY_CALIBRATION_POLICY_SCHEMA||row.version!==1)throw new Error('rsi_proxy_policy_invalid');
  assertZeroAuthority(row,'policy');
  if(
    row.heldout_pairing_required!==true
    ||row.controlled_intervention_suite_required!==true
    ||row.proxy_output_is_noisy_label!==true
    ||row.calibration_precedes_pruning!==true
    ||row.insufficient_evidence_disables_aggressive_pruning!==true
    ||row.drift_disables_aggressive_pruning!==true
    ||row.candidate_can_edit_calibration!==false
    ||row.candidate_can_choose_calibration_pairs!==false
    ||row.candidate_can_set_proxy_weight!==false
    ||row.external_policy_owner!==true
    ||row.authored_by_candidate!==false
  )throw new Error('rsi_proxy_policy_contract_invalid');
  const canonical=createRsiProxyCalibrationPolicy({
    policy_id:row.policy_id,
    proxy_stage:row.proxy_stage,
    proxy_identity_digest:row.proxy_identity_digest,
    full_holdout_digest:row.full_holdout_digest,
    intervention_suite_digest:row.intervention_suite_digest,
    min_pairs:row.min_pairs,
    proxy_pass_threshold:row.proxy_pass_threshold,
    holdout_pass_threshold:row.holdout_pass_threshold,
    calibrated_min_concordance:row.calibrated_min_concordance,
    degraded_min_concordance:row.degraded_min_concordance,
    max_false_positive_upper:row.max_false_positive_upper,
    max_brier:row.max_brier,
    recent_window:row.recent_window,
    drift_brier_delta:row.drift_brier_delta,
    external_policy_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.policy_digest!==exactDigest(row.policy_digest,'policy'))throw new Error('rsi_proxy_policy_digest_mismatch');
  return canonical;
}

export function createRsiProxyHoldoutPair({
  pair_id,
  policy,
  sequence,
  candidate_id,
  candidate_sha,
  proxy_score,
  holdout_score,
  proxy_receipt_digest,
  holdout_receipt_digest,
  evaluator_root_digest,
  intervention_case=false,
  evidence_refs,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  const checked=verifyRsiProxyCalibrationPolicy(policy);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_proxy_pair_external_origin_required');
  const proxy=probability(proxy_score,'proxy_score');
  const holdout=probability(holdout_score,'holdout_score');
  const core={
    schema:RSI_PROXY_HOLDOUT_PAIR_SCHEMA,
    version:1,
    pair_id:boundedId(pair_id,'pair_id'),
    policy_id:checked.policy_id,
    policy_digest:checked.policy_digest,
    sequence:positiveInt(sequence,'sequence',1_000_000_000),
    candidate_id:exactCandidateId(candidate_id,'candidate'),
    candidate_sha:exactSha(candidate_sha,'candidate'),
    proxy_stage:checked.proxy_stage,
    proxy_identity_digest:checked.proxy_identity_digest,
    full_holdout_digest:checked.full_holdout_digest,
    proxy_score:proxy,
    holdout_score:holdout,
    proxy_pass:proxy>=checked.proxy_pass_threshold,
    holdout_pass:holdout>=checked.holdout_pass_threshold,
    proxy_receipt_digest:exactDigest(proxy_receipt_digest,'proxy_receipt'),
    holdout_receipt_digest:exactDigest(holdout_receipt_digest,'holdout_receipt'),
    evaluator_root_digest:exactDigest(evaluator_root_digest,'evaluator_root'),
    intervention_case:intervention_case===true,
    intervention_suite_digest:intervention_case===true?checked.intervention_suite_digest:null,
    evidence_refs:refs(evidence_refs),
    external_evaluator:true,
    authored_by_candidate:false,
    pair_is_pruning_authority:false,
    pair_is_promotion_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,pair_digest:digest(core)});
}

export function verifyRsiProxyHoldoutPair(row,policy){
  if(!plainObject(row)||row.schema!==RSI_PROXY_HOLDOUT_PAIR_SCHEMA||row.version!==1)throw new Error('rsi_proxy_pair_invalid');
  assertZeroAuthority(row,'pair');
  if(row.external_evaluator!==true||row.authored_by_candidate!==false||row.pair_is_pruning_authority!==false||row.pair_is_promotion_authority!==false)throw new Error('rsi_proxy_pair_policy_invalid');
  const canonical=createRsiProxyHoldoutPair({
    pair_id:row.pair_id,
    policy,
    sequence:row.sequence,
    candidate_id:row.candidate_id,
    candidate_sha:row.candidate_sha,
    proxy_score:row.proxy_score,
    holdout_score:row.holdout_score,
    proxy_receipt_digest:row.proxy_receipt_digest,
    holdout_receipt_digest:row.holdout_receipt_digest,
    evaluator_root_digest:row.evaluator_root_digest,
    intervention_case:row.intervention_case,
    evidence_refs:row.evidence_refs,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.pair_digest!==exactDigest(row.pair_digest,'pair'))throw new Error('rsi_proxy_pair_digest_mismatch');
  return canonical;
}

function brier(rows){
  if(rows.length===0)return 1;
  return rows.reduce((sum,row)=>sum+(row.proxy_score-(row.holdout_pass?1:0))**2,0)/rows.length;
}

function calibrationStats(rows,policy){
  const falsePositives=rows.filter(row=>row.proxy_pass&&!row.holdout_pass).length;
  const proxyPositives=rows.filter(row=>row.proxy_pass).length;
  const falseNegatives=rows.filter(row=>!row.proxy_pass&&row.holdout_pass).length;
  const proxyNegatives=rows.filter(row=>!row.proxy_pass).length;
  const agreement=rows.filter(row=>row.proxy_pass===row.holdout_pass).length;
  const concordance=pairwiseConcordance(rows);
  return Object.freeze({
    pair_count:rows.length,
    agreement_rate:rows.length===0?0:agreement/rows.length,
    brier_score:brier(rows),
    false_positive_count:falsePositives,
    proxy_positive_count:proxyPositives,
    false_positive_rate:proxyPositives===0?0:falsePositives/proxyPositives,
    false_positive_wilson_95:proxyPositives===0?Object.freeze({lower:0,upper:1}):Object.freeze(wilson(falsePositives,proxyPositives)),
    false_negative_count:falseNegatives,
    proxy_negative_count:proxyNegatives,
    false_negative_rate:proxyNegatives===0?0:falseNegatives/proxyNegatives,
    rank:concordance,
    thresholds:Object.freeze({
      proxy_pass_threshold:policy.proxy_pass_threshold,
      holdout_pass_threshold:policy.holdout_pass_threshold,
    }),
  });
}

export function createRsiProxyReliabilitySnapshot({policy,pairs}={}){
  const checked=verifyRsiProxyCalibrationPolicy(policy);
  if(!Array.isArray(pairs)||pairs.length<1||pairs.length>MAX_PAIRS)throw new Error('rsi_proxy_pairs_invalid');
  const rows=pairs.map(pair=>verifyRsiProxyHoldoutPair(pair,checked)).sort((a,b)=>a.sequence-b.sequence||a.pair_id.localeCompare(b.pair_id));
  const sequences=new Set();
  const pairIds=new Set();
  const candidates=new Set();
  const evaluatorRoots=new Set();
  for(const row of rows){
    if(sequences.has(row.sequence))throw new Error('rsi_proxy_pair_sequence_duplicate');
    if(pairIds.has(row.pair_id))throw new Error('rsi_proxy_pair_id_duplicate');
    if(candidates.has(row.candidate_id))throw new Error('rsi_proxy_candidate_duplicate');
    sequences.add(row.sequence);pairIds.add(row.pair_id);candidates.add(row.candidate_id);evaluatorRoots.add(row.evaluator_root_digest);
  }
  if(evaluatorRoots.size!==1)throw new Error('rsi_proxy_evaluator_root_mismatch');
  const all=calibrationStats(rows,checked);
  const recentRows=rows.slice(-checked.recent_window);
  const priorRows=rows.slice(0,Math.max(0,rows.length-checked.recent_window));
  const recent=calibrationStats(recentRows,checked);
  const prior=priorRows.length?calibrationStats(priorRows,checked):null;
  const brierDrift=prior==null?0:recent.brier_score-prior.brier_score;
  const driftDetected=prior!=null&&brierDrift>checked.drift_brier_delta;
  const interventionRows=rows.filter(row=>row.intervention_case);
  const intervention=interventionRows.length?calibrationStats(interventionRows,checked):null;
  const minimumInterventionPairs=Math.min(4,checked.min_pairs);
  const interventionEvidenceSufficient=interventionRows.length>=minimumInterventionPairs;

  let state='INSUFFICIENT_EVIDENCE';
  if(rows.length>=checked.min_pairs&&interventionEvidenceSufficient){
    const calibrated=
      all.rank.concordance>=checked.calibrated_min_concordance
      &&all.false_positive_wilson_95.upper<=checked.max_false_positive_upper
      &&all.brier_score<=checked.max_brier
      &&!driftDetected;
    const degraded=
      all.rank.concordance>=checked.degraded_min_concordance
      &&all.false_positive_wilson_95.upper<=Math.min(1,checked.max_false_positive_upper+0.15)
      &&!driftDetected;
    state=calibrated?'CALIBRATED':degraded?'DEGRADED':'UNRELIABLE';
  }
  if(driftDetected)state='UNRELIABLE';
  if(!RELIABILITY_STATES.has(state))throw new Error('rsi_proxy_reliability_state_invalid');

  const core={
    schema:RSI_PROXY_RELIABILITY_SNAPSHOT_SCHEMA,
    version:1,
    policy_id:checked.policy_id,
    policy_digest:checked.policy_digest,
    proxy_stage:checked.proxy_stage,
    proxy_identity_digest:checked.proxy_identity_digest,
    evaluator_root_digest:[...evaluatorRoots][0],
    pair_digests:rows.map(row=>row.pair_digest),
    pair_count:rows.length,
    state,
    all_time:all,
    recent,
    prior,
    brier_drift:brierDrift,
    drift_detected:driftDetected,
    intervention_case_count:interventionRows.length,
    minimum_intervention_pairs:minimumInterventionPairs,
    intervention_evidence_sufficient:interventionEvidenceSufficient,
    intervention_stats:intervention,
    heldout_pairing_verified:true,
    proxy_output_treated_as_noisy_label:true,
    calibration_state_is_pruning_authority:false,
    calibration_state_is_promotion_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,snapshot_digest:digest(core)});
}

export function verifyRsiProxyReliabilitySnapshot(row,policy,pairs){
  if(!plainObject(row)||row.schema!==RSI_PROXY_RELIABILITY_SNAPSHOT_SCHEMA||row.version!==1)throw new Error('rsi_proxy_snapshot_invalid');
  assertZeroAuthority(row,'snapshot');
  if(row.heldout_pairing_verified!==true||row.proxy_output_treated_as_noisy_label!==true||row.calibration_state_is_pruning_authority!==false||row.calibration_state_is_promotion_authority!==false)throw new Error('rsi_proxy_snapshot_policy_invalid');
  const canonical=createRsiProxyReliabilitySnapshot({policy,pairs});
  if(canonical.snapshot_digest!==exactDigest(row.snapshot_digest,'snapshot'))throw new Error('rsi_proxy_snapshot_digest_mismatch');
  return canonical;
}

export function createRsiProxyAllocationGuidance({policy,snapshot}={}){
  const checked=verifyRsiProxyCalibrationPolicy(policy);
  if(!plainObject(snapshot)||snapshot.schema!==RSI_PROXY_RELIABILITY_SNAPSHOT_SCHEMA||snapshot.policy_digest!==checked.policy_digest)throw new Error('rsi_proxy_guidance_snapshot_invalid');
  const snapshotClone=structuredClone(snapshot);
  delete snapshotClone.snapshot_digest;
  if(exactDigest(snapshot.snapshot_digest,'guidance_snapshot')!==digest(snapshotClone))throw new Error('rsi_proxy_guidance_snapshot_digest_mismatch');
  const state=boundedToken(snapshot.state,'guidance_state');if(!RELIABILITY_STATES.has(state))throw new Error('rsi_proxy_guidance_state_invalid');
  const settings={
    CALIBRATED:{weight:1,exploration:0.10,forcedFull:0.10,pruning:'NORMAL_PROXY_PRUNING'},
    DEGRADED:{weight:0.5,exploration:0.25,forcedFull:0.25,pruning:'CONSERVATIVE_PROXY_PRUNING'},
    UNRELIABLE:{weight:0,exploration:0.50,forcedFull:0.50,pruning:'PROXY_PRUNING_DISABLED'},
    INSUFFICIENT_EVIDENCE:{weight:0.25,exploration:0.50,forcedFull:0.50,pruning:'AGGRESSIVE_PRUNING_DISABLED'},
  }[state];
  const core={
    schema:RSI_PROXY_ALLOCATION_GUIDANCE_SCHEMA,
    version:1,
    policy_id:checked.policy_id,
    policy_digest:checked.policy_digest,
    snapshot_digest:exactDigest(snapshot.snapshot_digest,'guidance_snapshot'),
    reliability_state:state,
    proxy_allocation_weight:settings.weight,
    minimum_exploration_fraction:settings.exploration,
    minimum_forced_full_evaluation_fraction:settings.forcedFull,
    pruning_mode:settings.pruning,
    drift_detected:snapshot.drift_detected===true,
    guidance_allocates_compute_only:true,
    guidance_is_scheduler_authority:false,
    guidance_is_archive_authority:false,
    guidance_is_promotion_authority:false,
    candidate_can_override_guidance:false,
    existing_scheduler_admission_required:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,guidance_digest:digest(core)});
}

export function rsiProxyCalibrationTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.proxy-calibration-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-proxy-reliability-calibration.mjs',
    proxy_stages:[...PROXY_STAGES].sort(),
    heldout_pairing_required:true,
    controlled_intervention_suite_required:true,
    proxy_output_is_noisy_label:true,
    wilson_false_positive_bound:true,
    pairwise_rank_concordance:true,
    brier_calibration_error:true,
    drift_detection:true,
    insufficient_evidence_disables_aggressive_pruning:true,
    unreliable_proxy_weight_zero:true,
    exploration_escape_hatch_expands_when_unreliable:true,
    candidate_can_edit_calibration:false,
    candidate_can_choose_calibration_pairs:false,
    candidate_can_set_proxy_weight:false,
    guidance_allocates_compute_only:true,
    scheduler_action_authorized:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,proxy_calibration_root_digest:digest(root)});
}
