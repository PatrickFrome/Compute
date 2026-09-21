import crypto from 'node:crypto';

export const RSI_EVALUATION_CASCADE_POLICY_SCHEMA = 'metaengine.rsi.evaluation-cascade-policy.v1';
export const RSI_EVALUATION_STAGE_RECEIPT_SCHEMA = 'metaengine.rsi.evaluation-stage-receipt.v1';
export const RSI_EVALUATION_STAGE_DECISION_SCHEMA = 'metaengine.rsi.evaluation-stage-decision.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_CANDIDATES=4096;
const MAX_EVIDENCE_REFS=32;

export const RSI_EVALUATION_STAGES=Object.freeze([
  'STATIC_CONTRACT',
  'MICRO_TESTS',
  'LLM_JUDGE_TRIAGE',
  'TARGETED_SHARD',
  'FULL_HOLDOUT',
]);

const DEFAULT_STAGE_RULES=Object.freeze({
  STATIC_CONTRACT:Object.freeze({fidelity_rank:1,max_cost_units:1,score_role:'BINARY_CONTRACT',low_fidelity:true}),
  MICRO_TESTS:Object.freeze({fidelity_rank:2,max_cost_units:4,score_role:'DETERMINISTIC_MICRO_TEST',low_fidelity:true}),
  LLM_JUDGE_TRIAGE:Object.freeze({fidelity_rank:3,max_cost_units:2,score_role:'CHEAP_EXTERNAL_JUDGE',low_fidelity:true}),
  TARGETED_SHARD:Object.freeze({fidelity_rank:4,max_cost_units:16,score_role:'PARTIAL_BENCHMARK',low_fidelity:true}),
  FULL_HOLDOUT:Object.freeze({fidelity_rank:5,max_cost_units:64,score_role:'HIDDEN_FULL_BENCHMARK',low_fidelity:false}),
});

function plainObject(v){if(!v||typeof v!=='object'||Array.isArray(v))return false;const p=Object.getPrototypeOf(v);return p===Object.prototype||p===null}
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactDigest(v,l){const o=String(v||'').toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_eval_${l}_digest_invalid`);return o}
function exactSha(v,l){const o=String(v||'').toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_eval_${l}_sha_invalid`);return o}
function exactCandidateId(v,l){const o=String(v||'').toLowerCase();if(!CANDIDATE_ID_RE.test(o))throw new Error(`rsi_eval_${l}_candidate_id_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_eval_${l}_invalid`);return o}
function boundedToken(v,l){const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_eval_${l}_invalid`);return o}
function positiveInt(v,l,max=Number.MAX_SAFE_INTEGER){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_eval_${l}_invalid`);return o}
function boundedScore(v,l){const o=Number(v);if(!Number.isFinite(o)||o<0||o>1)throw new Error(`rsi_eval_${l}_invalid`);return o}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_eval_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_eval_${l}_automatic_retry_invalid`)}
function refs(v){if(!Array.isArray(v)||v.length<1||v.length>MAX_EVIDENCE_REFS)throw new Error('rsi_eval_evidence_refs_invalid');const s=new Set();return v.map(raw=>{const x=boundedId(raw,'evidence_ref');if(s.has(x))throw new Error('rsi_eval_evidence_ref_duplicate');s.add(x);return x}).sort()}
function stage(v){const s=boundedToken(v,'stage');if(!RSI_EVALUATION_STAGES.includes(s))throw new Error('rsi_eval_stage_invalid');return s}

export function createRsiEvaluationCascadePolicy({
  policy_id,
  targeted_shard_digest,
  full_holdout_digest,
  matched_budget_baseline_digest,
  stage_rules=DEFAULT_STAGE_RULES,
  external_policy_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_policy_owner!==true||authored_by_candidate!==false)throw new Error('rsi_eval_policy_external_origin_required');
  if(!plainObject(stage_rules))throw new Error('rsi_eval_stage_rules_invalid');
  const normalized={};
  for(const id of RSI_EVALUATION_STAGES){
    const row=stage_rules[id];
    if(!plainObject(row))throw new Error('rsi_eval_stage_rule_missing');
    normalized[id]=Object.freeze({
      fidelity_rank:positiveInt(row.fidelity_rank,'fidelity_rank',RSI_EVALUATION_STAGES.length),
      max_cost_units:positiveInt(row.max_cost_units,'max_cost_units',1_000_000),
      score_role:boundedToken(row.score_role,'score_role'),
      low_fidelity:row.low_fidelity===true,
    });
  }
  for(let i=0;i<RSI_EVALUATION_STAGES.length;i+=1){
    const id=RSI_EVALUATION_STAGES[i];
    if(normalized[id].fidelity_rank!==i+1)throw new Error('rsi_eval_fidelity_order_invalid');
  }
  if(normalized.FULL_HOLDOUT.low_fidelity!==false)throw new Error('rsi_eval_full_holdout_fidelity_invalid');
  const shard=exactDigest(targeted_shard_digest,'targeted_shard');
  const holdout=exactDigest(full_holdout_digest,'full_holdout');
  if(shard===holdout)throw new Error('rsi_eval_holdout_alias_forbidden');

  const core={
    schema:RSI_EVALUATION_CASCADE_POLICY_SCHEMA,
    version:1,
    policy_id:boundedId(policy_id,'policy_id'),
    targeted_shard_digest:shard,
    full_holdout_digest:holdout,
    matched_budget_baseline_digest:exactDigest(matched_budget_baseline_digest,'matched_budget'),
    stage_rules:normalized,
    stage_order:[...RSI_EVALUATION_STAGES],
    hierarchical_multi_fidelity:true,
    successive_halving_inspired:true,
    low_fidelity_allocates_compute_only:true,
    low_fidelity_archive_authority:false,
    low_fidelity_promotion_authority:false,
    full_holdout_required_for_archive_review:true,
    statistical_confirmation_required_for_promotion_review:true,
    exploration_escape_hatch_required:true,
    matched_budget_baseline_required:true,
    candidate_can_choose_stage:false,
    candidate_can_choose_budget:false,
    candidate_can_author_receipt:false,
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

export function verifyRsiEvaluationCascadePolicy(row){
  if(!plainObject(row)||row.schema!==RSI_EVALUATION_CASCADE_POLICY_SCHEMA||row.version!==1)throw new Error('rsi_eval_policy_invalid');
  assertZeroAuthority(row,'policy');
  if(
    row.hierarchical_multi_fidelity!==true
    ||row.successive_halving_inspired!==true
    ||row.low_fidelity_allocates_compute_only!==true
    ||row.low_fidelity_archive_authority!==false
    ||row.low_fidelity_promotion_authority!==false
    ||row.full_holdout_required_for_archive_review!==true
    ||row.statistical_confirmation_required_for_promotion_review!==true
    ||row.exploration_escape_hatch_required!==true
    ||row.matched_budget_baseline_required!==true
    ||row.candidate_can_choose_stage!==false
    ||row.candidate_can_choose_budget!==false
    ||row.candidate_can_author_receipt!==false
    ||row.external_policy_owner!==true
    ||row.authored_by_candidate!==false
  )throw new Error('rsi_eval_policy_contract_invalid');
  const canonical=createRsiEvaluationCascadePolicy({
    policy_id:row.policy_id,
    targeted_shard_digest:row.targeted_shard_digest,
    full_holdout_digest:row.full_holdout_digest,
    matched_budget_baseline_digest:row.matched_budget_baseline_digest,
    stage_rules:row.stage_rules,
    external_policy_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.policy_digest!==exactDigest(row.policy_digest,'policy'))throw new Error('rsi_eval_policy_digest_mismatch');
  return canonical;
}

export function createRsiEvaluationStageReceipt({
  receipt_id,
  policy,
  candidate_id,
  candidate_sha,
  stage:stage_id,
  evaluator_root_digest,
  workload_digest,
  cost_units_used,
  hard_invariants_pass,
  stage_pass,
  score,
  novelty_score=0,
  matched_budget_delta=0,
  evidence_refs,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  const checked=verifyRsiEvaluationCascadePolicy(policy);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_eval_receipt_external_origin_required');
  const s=stage(stage_id);
  const rule=checked.stage_rules[s];
  const cost=positiveInt(cost_units_used,'cost_units_used',1_000_000);
  if(cost>rule.max_cost_units)throw new Error('rsi_eval_receipt_stage_budget_exceeded');
  const workload=exactDigest(workload_digest,'workload');
  if(s==='TARGETED_SHARD'&&workload!==checked.targeted_shard_digest)throw new Error('rsi_eval_receipt_targeted_shard_mismatch');
  if(s==='FULL_HOLDOUT'&&workload!==checked.full_holdout_digest)throw new Error('rsi_eval_receipt_full_holdout_mismatch');
  const hard=hard_invariants_pass===true;
  const pass=stage_pass===true;
  if(pass&&!hard)throw new Error('rsi_eval_receipt_pass_without_hard_invariants');
  const core={
    schema:RSI_EVALUATION_STAGE_RECEIPT_SCHEMA,
    version:1,
    receipt_id:boundedId(receipt_id,'receipt_id'),
    policy_id:checked.policy_id,
    policy_digest:checked.policy_digest,
    candidate_id:exactCandidateId(candidate_id,'candidate'),
    candidate_sha:exactSha(candidate_sha,'candidate'),
    stage:s,
    fidelity_rank:rule.fidelity_rank,
    score_role:rule.score_role,
    low_fidelity:rule.low_fidelity,
    evaluator_root_digest:exactDigest(evaluator_root_digest,'evaluator_root'),
    workload_digest:workload,
    cost_units_used:cost,
    stage_cost_ceiling:rule.max_cost_units,
    hard_invariants_pass:hard,
    stage_pass:pass,
    score:boundedScore(score,'score'),
    novelty_score:boundedScore(novelty_score,'novelty_score'),
    matched_budget_delta:Number(matched_budget_delta),
    evidence_refs:refs(evidence_refs),
    external_evaluator:true,
    authored_by_candidate:false,
    cheap_judge_is_full_evaluator:false,
    low_fidelity_result_is_archive_authority:false,
    low_fidelity_result_is_promotion_authority:false,
    receipt_is_scheduler_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  if(!Number.isFinite(core.matched_budget_delta))throw new Error('rsi_eval_matched_budget_delta_invalid');
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiEvaluationStageReceipt(row,policy){
  if(!plainObject(row)||row.schema!==RSI_EVALUATION_STAGE_RECEIPT_SCHEMA||row.version!==1)throw new Error('rsi_eval_receipt_invalid');
  assertZeroAuthority(row,'receipt');
  if(
    row.external_evaluator!==true
    ||row.authored_by_candidate!==false
    ||row.cheap_judge_is_full_evaluator!==false
    ||row.low_fidelity_result_is_archive_authority!==false
    ||row.low_fidelity_result_is_promotion_authority!==false
    ||row.receipt_is_scheduler_authority!==false
  )throw new Error('rsi_eval_receipt_policy_invalid');
  const canonical=createRsiEvaluationStageReceipt({
    receipt_id:row.receipt_id,
    policy,
    candidate_id:row.candidate_id,
    candidate_sha:row.candidate_sha,
    stage:row.stage,
    evaluator_root_digest:row.evaluator_root_digest,
    workload_digest:row.workload_digest,
    cost_units_used:row.cost_units_used,
    hard_invariants_pass:row.hard_invariants_pass,
    stage_pass:row.stage_pass,
    score:row.score,
    novelty_score:row.novelty_score,
    matched_budget_delta:row.matched_budget_delta,
    evidence_refs:row.evidence_refs,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(row.receipt_digest,'receipt'))throw new Error('rsi_eval_receipt_digest_mismatch');
  return canonical;
}

function tie(seed,id){return crypto.createHash('sha256').update(`${seed}:${id}`,'utf8').digest('hex')}

export function createRsiEvaluationStageDecision({
  decision_id,
  policy,
  stage:stage_id,
  receipts,
  survivor_slots,
  exploration_slots=1,
}={}){
  const checked=verifyRsiEvaluationCascadePolicy(policy);
  const s=stage(stage_id);
  if(!Array.isArray(receipts)||receipts.length<1||receipts.length>MAX_CANDIDATES)throw new Error('rsi_eval_decision_receipts_invalid');
  const normalized=receipts.map(r=>verifyRsiEvaluationStageReceipt(r,checked));
  if(normalized.some(r=>r.stage!==s))throw new Error('rsi_eval_decision_stage_mismatch');
  const evaluatorRoots=new Set(normalized.map(r=>r.evaluator_root_digest));
  if(evaluatorRoots.size!==1)throw new Error('rsi_eval_decision_evaluator_root_mismatch');
  const ids=new Set();
  for(const r of normalized){if(ids.has(r.candidate_id))throw new Error('rsi_eval_decision_candidate_duplicate');ids.add(r.candidate_id)}
  const slots=positiveInt(survivor_slots,'survivor_slots',normalized.length);
  const exploration=Number(exploration_slots);
  if(!Number.isSafeInteger(exploration)||exploration<0||exploration>slots)throw new Error('rsi_eval_exploration_slots_invalid');

  const eligible=normalized.filter(r=>r.hard_invariants_pass===true&&r.stage_pass===true);
  const seed=digest({policy_digest:checked.policy_digest,stage:s,receipts:normalized.map(r=>r.receipt_digest).sort(),slots,exploration});
  const exploitationCount=Math.max(0,slots-exploration);
  const ranked=eligible.slice().sort((a,b)=>b.score-a.score||a.cost_units_used-b.cost_units_used||tie(seed,a.candidate_id).localeCompare(tie(seed,b.candidate_id)));
  const selected=[];
  for(const r of ranked.slice(0,exploitationCount))selected.push({receipt:r,exploration:false});
  const remaining=eligible.filter(r=>!selected.some(x=>x.receipt.candidate_id===r.candidate_id));
  const noveltyRanked=remaining.slice().sort((a,b)=>b.novelty_score-a.novelty_score||b.score-a.score||tie(seed,a.candidate_id).localeCompare(tie(seed,b.candidate_id)));
  for(const r of noveltyRanked.slice(0,exploration))selected.push({receipt:r,exploration:true});
  if(selected.length<slots){
    for(const r of ranked){
      if(selected.length>=slots)break;
      if(!selected.some(x=>x.receipt.candidate_id===r.candidate_id))selected.push({receipt:r,exploration:false});
    }
  }

  const low=checked.stage_rules[s].low_fidelity===true;
  const rows=normalized.map(r=>{
    const chosen=selected.find(x=>x.receipt.candidate_id===r.candidate_id);
    const fullHoldoutPass=s==='FULL_HOLDOUT'&&r.hard_invariants_pass===true&&r.stage_pass===true&&r.matched_budget_delta>=0;
    return zeroAuthority({
      candidate_id:r.candidate_id,
      candidate_sha:r.candidate_sha,
      receipt_digest:r.receipt_digest,
      score:r.score,
      novelty_score:r.novelty_score,
      stage_pass:r.stage_pass,
      hard_invariants_pass:r.hard_invariants_pass,
      selected_for_next_fidelity:Boolean(chosen),
      exploration_slot:chosen?.exploration===true,
      state:!r.hard_invariants_pass||!r.stage_pass
        ?'REJECTED_AT_STAGE'
        : fullHoldoutPass
          ?'FULL_HOLDOUT_PASS_FOR_ARCHIVE_REVIEW'
          : chosen
            ?'ALLOCATE_NEXT_FIDELITY'
            :'PRUNED_BY_RESOURCE_ALLOCATION',
      eligible_for_archive_review:fullHoldoutPass,
      eligible_for_promotion_review:false,
      statistical_confirmation_required_for_promotion:s==='FULL_HOLDOUT'&&fullHoldoutPass,
      low_fidelity_compute_allocation_only:low,
      low_fidelity_final_verdict:false,
      scheduler_action_authorized:false,
    });
  });

  const core={
    schema:RSI_EVALUATION_STAGE_DECISION_SCHEMA,
    version:1,
    decision_id:boundedId(decision_id,'decision_id'),
    policy_id:checked.policy_id,
    policy_digest:checked.policy_digest,
    stage:s,
    fidelity_rank:checked.stage_rules[s].fidelity_rank,
    evaluator_root_digest:[...evaluatorRoots][0],
    survivor_slots:slots,
    exploration_slots:exploration,
    decisions:rows,
    input_candidate_count:normalized.length,
    eligible_candidate_count:eligible.length,
    selected_candidate_count:rows.filter(r=>r.selected_for_next_fidelity).length,
    low_fidelity_compute_allocation_only:low,
    low_fidelity_final_verdict:false,
    exploration_escape_hatch_active:exploration>0&&low,
    full_holdout_required_for_archive_review:true,
    statistical_confirmation_required_for_promotion_review:true,
    matched_budget_baseline_required:true,
    scheduler_action_authorized:false,
    candidate_can_choose_survivors:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,decision_digest:digest(core)});
}

export function verifyRsiEvaluationStageDecision(row,policy,receipts){
  if(!plainObject(row)||row.schema!==RSI_EVALUATION_STAGE_DECISION_SCHEMA||row.version!==1)throw new Error('rsi_eval_decision_invalid');
  assertZeroAuthority(row,'decision');
  if(
    row.low_fidelity_final_verdict!==false
    ||row.full_holdout_required_for_archive_review!==true
    ||row.statistical_confirmation_required_for_promotion_review!==true
    ||row.matched_budget_baseline_required!==true
    ||row.scheduler_action_authorized!==false
    ||row.candidate_can_choose_survivors!==false
  )throw new Error('rsi_eval_decision_policy_invalid');
  const canonical=createRsiEvaluationStageDecision({
    decision_id:row.decision_id,
    policy,
    stage:row.stage,
    receipts,
    survivor_slots:row.survivor_slots,
    exploration_slots:row.exploration_slots,
  });
  if(canonical.decision_digest!==exactDigest(row.decision_digest,'decision'))throw new Error('rsi_eval_decision_digest_mismatch');
  return canonical;
}

export function rsiHierarchicalEvaluationEconomyTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.hierarchical-evaluation-economy-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-hierarchical-evaluation-economy.mjs',
    stages:[...RSI_EVALUATION_STAGES],
    hierarchical_multi_fidelity:true,
    successive_halving_inspired:true,
    sift_inspired_cheap_judge_triage:true,
    cheap_judge_is_full_evaluator:false,
    low_fidelity_allocates_compute_only:true,
    exploration_escape_hatch_required:true,
    full_holdout_required_for_archive_review:true,
    statistical_confirmation_required_for_promotion_review:true,
    matched_budget_baseline_required:true,
    candidate_can_choose_stage:false,
    candidate_can_choose_budget:false,
    candidate_can_choose_survivors:false,
    scheduler_action_authorized:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,evaluation_root_digest:digest(root)});
}
