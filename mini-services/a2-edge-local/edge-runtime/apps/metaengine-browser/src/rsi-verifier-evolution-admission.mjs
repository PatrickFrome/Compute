import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA='metaengine.rsi.verifier-evolution-receipt.v1';
export const RSI_VERIFIER_EVOLUTION_ADMISSION_SCHEMA='metaengine.rsi.verifier-evolution-admission.v1';
export const RSI_VERIFIER_EVOLUTION_LEDGER_SCHEMA='metaengine.rsi.verifier-evolution-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=512;
const METRIC_KEYS=Object.freeze([
  'false_positive_rate',
  'false_negative_rate',
  'reward_hack_detection_rate',
  'environment_blocker_calibration_rate',
  'process_outcome_agreement_rate',
  'transfer_agreement_rate',
]);

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_verifier_evolution_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_verifier_evolution_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_verifier_evolution_${l}_invalid`);return x;}
function rate(v,l){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1)throw new Error(`rsi_verifier_evolution_${l}_invalid`);return n;}
function positiveInt(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_verifier_evolution_${l}_invalid`);return n;}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_verifier_evolution_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_verifier_evolution_${l}_retry_invalid`);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function metrics(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`rsi_verifier_evolution_${label}_metrics_invalid`);
  const out={};
  for(const key of METRIC_KEYS)out[key]=rate(value[key],`${label}_${key}`);
  if(Object.keys(value).some(k=>!METRIC_KEYS.includes(k)))throw new Error(`rsi_verifier_evolution_${label}_metric_unknown`);
  return Object.freeze(out);
}
function compareMetrics(incumbent,candidate){
  const nonRegressions={
    false_positive_rate:candidate.false_positive_rate<=incumbent.false_positive_rate,
    false_negative_rate:candidate.false_negative_rate<=incumbent.false_negative_rate,
    reward_hack_detection_rate:candidate.reward_hack_detection_rate>=incumbent.reward_hack_detection_rate,
    environment_blocker_calibration_rate:candidate.environment_blocker_calibration_rate>=incumbent.environment_blocker_calibration_rate,
    process_outcome_agreement_rate:candidate.process_outcome_agreement_rate>=incumbent.process_outcome_agreement_rate,
    transfer_agreement_rate:candidate.transfer_agreement_rate>=incumbent.transfer_agreement_rate,
  };
  const strict={
    false_positive_rate:candidate.false_positive_rate<incumbent.false_positive_rate,
    false_negative_rate:candidate.false_negative_rate<incumbent.false_negative_rate,
    reward_hack_detection_rate:candidate.reward_hack_detection_rate>incumbent.reward_hack_detection_rate,
    environment_blocker_calibration_rate:candidate.environment_blocker_calibration_rate>incumbent.environment_blocker_calibration_rate,
    process_outcome_agreement_rate:candidate.process_outcome_agreement_rate>incumbent.process_outcome_agreement_rate,
    transfer_agreement_rate:candidate.transfer_agreement_rate>incumbent.transfer_agreement_rate,
  };
  const regressed=Object.entries(nonRegressions).filter(([,ok])=>!ok).map(([k])=>k).sort();
  const improved=Object.entries(strict).filter(([,ok])=>ok).map(([k])=>k).sort();
  return Object.freeze({
    non_regression_pass:regressed.length===0,
    strict_improvement_pass:improved.length>0,
    regressed_metrics:Object.freeze(regressed),
    improved_metrics:Object.freeze(improved),
  });
}

export function createRsiVerifierEvolutionReceipt({
  receipt_id,
  source_sha,
  incumbent_verifier_root_digest,
  candidate_verifier_root_digest,
  sealed_benchmark_root_digest,
  transfer_holdout_digest,
  reward_hack_suite_digest,
  external_evaluator_root_digest,
  paired_comparison_digest,
  incumbent_metrics,
  candidate_metrics,
  sample_count,
  reward_hack_exploitation_count,
  hidden_benchmark_exposure_detected,
  evaluator_integrity_pass,
  from_scratch_replay_pass,
  same_examples_compared,
  process_outcome_labels_separate,
  controllable_environment_labels_separate,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_verifier_evolution_external_evaluator_required');
  const incumbent=exactDigest(incumbent_verifier_root_digest,'incumbent_root');
  const candidate=exactDigest(candidate_verifier_root_digest,'candidate_root');
  if(incumbent===candidate)throw new Error('rsi_verifier_evolution_distinct_candidate_required');
  const sealed=exactDigest(sealed_benchmark_root_digest,'sealed_benchmark');
  const transfer=exactDigest(transfer_holdout_digest,'transfer_holdout');
  const hacks=exactDigest(reward_hack_suite_digest,'reward_hack_suite');
  const evaluator=exactDigest(external_evaluator_root_digest,'external_evaluator_root');
  const pair=exactDigest(paired_comparison_digest,'paired_comparison');
  const roots=[incumbent,candidate,sealed,transfer,hacks,evaluator,pair];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_verifier_evolution_independent_roots_required');
  const incumbentM=metrics(incumbent_metrics,'incumbent');
  const candidateM=metrics(candidate_metrics,'candidate');
  const comparison=compareMetrics(incumbentM,candidateM);
  const exploitation=Number(reward_hack_exploitation_count);
  if(!Number.isSafeInteger(exploitation)||exploitation<0)throw new Error('rsi_verifier_evolution_reward_hack_exploitation_count_invalid');
  if(same_examples_compared!==true||process_outcome_labels_separate!==true||controllable_environment_labels_separate!==true){
    throw new Error('rsi_verifier_evolution_paired_evaluation_policy_invalid');
  }
  const blockers=[];
  if(!comparison.non_regression_pass)blockers.push('METRIC_REGRESSION');
  if(!comparison.strict_improvement_pass)blockers.push('NO_STRICT_IMPROVEMENT');
  if(exploitation>0)blockers.push('REWARD_HACK_EXPLOITATION');
  if(hidden_benchmark_exposure_detected===true)blockers.push('BENCHMARK_EXPOSURE');
  if(evaluator_integrity_pass!==true)blockers.push('EVALUATOR_INTEGRITY_FAILURE');
  if(from_scratch_replay_pass!==true)blockers.push('FROM_SCRATCH_REPLAY_FAILURE');
  const core=zero({
    schema:RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA,
    version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:exactSha(source_sha,'source'),
    incumbent_verifier_root_digest:incumbent,
    candidate_verifier_root_digest:candidate,
    sealed_benchmark_root_digest:sealed,
    transfer_holdout_digest:transfer,
    reward_hack_suite_digest:hacks,
    external_evaluator_root_digest:evaluator,
    paired_comparison_digest:pair,
    incumbent_metrics:incumbentM,
    candidate_metrics:candidateM,
    sample_count:positiveInt(sample_count,'sample_count'),
    reward_hack_exploitation_count:exploitation,
    hidden_benchmark_exposure_detected:hidden_benchmark_exposure_detected===true,
    evaluator_integrity_pass:evaluator_integrity_pass===true,
    from_scratch_replay_pass:from_scratch_replay_pass===true,
    same_examples_compared:true,
    process_outcome_labels_separate:true,
    controllable_environment_labels_separate:true,
    non_regression_pass:comparison.non_regression_pass,
    strict_improvement_pass:comparison.strict_improvement_pass,
    regressed_metrics:comparison.regressed_metrics,
    improved_metrics:comparison.improved_metrics,
    blockers:Object.freeze(blockers.sort()),
    eligible_for_verifier_shadow: blockers.length===0,
    candidate_can_read_sealed_benchmark:false,
    candidate_can_read_reward_hack_suite:false,
    candidate_can_choose_external_evaluator:false,
    candidate_can_rewrite_incumbent:false,
    receipt_is_activation_authority:false,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiVerifierEvolutionReceipt(receipt){
  if(!receipt||receipt.schema!==RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA||receipt.version!==1)throw new Error('rsi_verifier_evolution_receipt_invalid');
  assertZero(receipt,'receipt');
  if(receipt.candidate_can_read_sealed_benchmark!==false||receipt.candidate_can_read_reward_hack_suite!==false
    ||receipt.candidate_can_choose_external_evaluator!==false||receipt.candidate_can_rewrite_incumbent!==false
    ||receipt.receipt_is_activation_authority!==false||receipt.external_evaluator!==true||receipt.authored_by_candidate!==false
    ||receipt.same_examples_compared!==true||receipt.process_outcome_labels_separate!==true
    ||receipt.controllable_environment_labels_separate!==true)throw new Error('rsi_verifier_evolution_receipt_policy_invalid');
  const canonical=createRsiVerifierEvolutionReceipt({
    receipt_id:receipt.receipt_id,
    source_sha:receipt.source_sha,
    incumbent_verifier_root_digest:receipt.incumbent_verifier_root_digest,
    candidate_verifier_root_digest:receipt.candidate_verifier_root_digest,
    sealed_benchmark_root_digest:receipt.sealed_benchmark_root_digest,
    transfer_holdout_digest:receipt.transfer_holdout_digest,
    reward_hack_suite_digest:receipt.reward_hack_suite_digest,
    external_evaluator_root_digest:receipt.external_evaluator_root_digest,
    paired_comparison_digest:receipt.paired_comparison_digest,
    incumbent_metrics:receipt.incumbent_metrics,
    candidate_metrics:receipt.candidate_metrics,
    sample_count:receipt.sample_count,
    reward_hack_exploitation_count:receipt.reward_hack_exploitation_count,
    hidden_benchmark_exposure_detected:receipt.hidden_benchmark_exposure_detected,
    evaluator_integrity_pass:receipt.evaluator_integrity_pass,
    from_scratch_replay_pass:receipt.from_scratch_replay_pass,
    same_examples_compared:true,
    process_outcome_labels_separate:true,
    controllable_environment_labels_separate:true,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'receipt'))throw new Error('rsi_verifier_evolution_receipt_digest_mismatch');
  return canonical;
}

export function createRsiVerifierEvolutionAdmission({
  admission_id,
  receipt,
  external_admission_owner=false,
  authored_by_candidate=true,
}={}){
  const checked=verifyRsiVerifierEvolutionReceipt(receipt);
  if(external_admission_owner!==true||authored_by_candidate!==false)throw new Error('rsi_verifier_evolution_external_admission_owner_required');
  const pass=checked.eligible_for_verifier_shadow===true&&checked.blockers.length===0;
  const core=zero({
    schema:RSI_VERIFIER_EVOLUTION_ADMISSION_SCHEMA,
    version:1,
    source_sha:checked.source_sha,
    admission_id:id(admission_id,'admission_id'),
    receipt_digest:checked.receipt_digest,
    incumbent_verifier_root_digest:checked.incumbent_verifier_root_digest,
    candidate_verifier_root_digest:checked.candidate_verifier_root_digest,
    sealed_benchmark_root_digest:checked.sealed_benchmark_root_digest,
    transfer_holdout_digest:checked.transfer_holdout_digest,
    reward_hack_suite_digest:checked.reward_hack_suite_digest,
    external_evaluator_root_digest:checked.external_evaluator_root_digest,
    state:pass?'QUALIFIED_FOR_VERIFIER_SHADOW':'VERIFIER_EVOLUTION_REJECTED',
    qualified_for_verifier_shadow:pass,
    incumbent_verifier_remains_active:true,
    verifier_shadow_is_observation_only:true,
    verifier_shadow_can_gate_canary:false,
    verifier_shadow_can_gate_promotion:false,
    verifier_shadow_can_execute_browser_effects:false,
    verifier_shadow_can_modify_reward:false,
    candidate_can_self_activate:false,
    candidate_can_replace_incumbent:false,
    external_shadow_review_required:true,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiVerifierEvolutionAdmission(admission,{receipt}={}){
  if(!admission||admission.schema!==RSI_VERIFIER_EVOLUTION_ADMISSION_SCHEMA||admission.version!==1)throw new Error('rsi_verifier_evolution_admission_invalid');
  assertZero(admission,'admission');
  if(admission.incumbent_verifier_remains_active!==true||admission.verifier_shadow_is_observation_only!==true
    ||admission.verifier_shadow_can_gate_canary!==false||admission.verifier_shadow_can_gate_promotion!==false
    ||admission.verifier_shadow_can_execute_browser_effects!==false||admission.verifier_shadow_can_modify_reward!==false
    ||admission.candidate_can_self_activate!==false||admission.candidate_can_replace_incumbent!==false
    ||admission.external_shadow_review_required!==true||admission.external_admission_owner!==true
    ||admission.authored_by_candidate!==false)throw new Error('rsi_verifier_evolution_admission_policy_invalid');
  const canonical=createRsiVerifierEvolutionAdmission({
    admission_id:admission.admission_id,
    receipt,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.admission_digest!==exactDigest(admission.admission_digest,'admission'))throw new Error('rsi_verifier_evolution_admission_digest_mismatch');
  return canonical;
}

function ledgerState(sourceSha,rows){
  const core=zero({
    schema:RSI_VERIFIER_EVOLUTION_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    qualified_count:rows.filter(r=>r.admission.qualified_for_verifier_shadow===true).length,
    append_only:true,
    active_verifier_root_digest:null,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
    ledger_can_activate_verifier:false,
    ledger_can_replace_incumbent:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiVerifierEvolutionLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_verifier_evolution_ledger_path_required');this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(parsed,'ledger');
      if(parsed.schema!==RSI_VERIFIER_EVOLUTION_LEDGER_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha||parsed.append_only!==true
        ||parsed.active_verifier_root_digest!==null||parsed.candidate_can_delete!==false||parsed.candidate_can_rewrite!==false
        ||parsed.ledger_can_activate_verifier!==false||parsed.ledger_can_replace_incumbent!==false)throw new Error('rsi_verifier_evolution_ledger_state_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'ledger'))throw new Error('rsi_verifier_evolution_ledger_digest_mismatch');
      if(!Array.isArray(parsed.rows)||parsed.rows.length>MAX_ROWS)throw new Error('rsi_verifier_evolution_ledger_rows_invalid');
      const seen=new Set();
      for(const row of parsed.rows){
        if(row.source_sha!==this.#sourceSha)throw new Error('rsi_verifier_evolution_ledger_source_mismatch');
        const rc=structuredClone(row.receipt);delete rc.receipt_digest;
        if(digest(rc)!==exactDigest(row.receipt.receipt_digest,'ledger_receipt'))throw new Error('rsi_verifier_evolution_ledger_receipt_digest_mismatch');
        const ac=structuredClone(row.admission);delete ac.admission_digest;
        if(digest(ac)!==exactDigest(row.admission.admission_digest,'ledger_admission'))throw new Error('rsi_verifier_evolution_ledger_admission_digest_mismatch');
        if(row.admission.receipt_digest!==row.receipt.receipt_digest)throw new Error('rsi_verifier_evolution_ledger_binding_mismatch');
        if(seen.has(row.candidate_verifier_root_digest))throw new Error('rsi_verifier_evolution_ledger_candidate_duplicate');
        seen.add(row.candidate_verifier_root_digest);
      }
      this.#rows=parsed.rows;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){
    const state=ledgerState(this.#sourceSha,this.#rows);const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync();}finally{await handle.close();}
    await fs.rename(temp,this.#path);
  }
  async add({receipt,admission}={}){
    if(!this.#initialized)throw new Error('rsi_verifier_evolution_ledger_not_initialized');
    const checkedReceipt=verifyRsiVerifierEvolutionReceipt(receipt);
    const checkedAdmission=verifyRsiVerifierEvolutionAdmission(admission,{receipt:checkedReceipt});
    if(checkedReceipt.source_sha!==this.#sourceSha||checkedAdmission.source_sha!==this.#sourceSha)throw new Error('rsi_verifier_evolution_ledger_source_mismatch');
    const existing=this.#rows.find(r=>r.candidate_verifier_root_digest===checkedReceipt.candidate_verifier_root_digest);
    if(existing){
      if(existing.receipt.receipt_digest!==checkedReceipt.receipt_digest||existing.admission.admission_digest!==checkedAdmission.admission_digest)throw new Error('rsi_verifier_evolution_ledger_identity_conflict');
      return zero({state:'IDEMPOTENT',admission_digest:checkedAdmission.admission_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_verifier_evolution_ledger_capacity_exceeded');
    this.#rows.push(Object.freeze({
      source_sha:this.#sourceSha,
      candidate_verifier_root_digest:checkedReceipt.candidate_verifier_root_digest,
      receipt:structuredClone(checkedReceipt),
      admission:structuredClone(checkedAdmission),
    }));
    await this.#persist();
    return zero({state:checkedAdmission.state,admission_digest:checkedAdmission.admission_digest});
  }
  qualified(){
    if(!this.#initialized)throw new Error('rsi_verifier_evolution_ledger_not_initialized');
    return Object.freeze(this.#rows.filter(r=>r.admission.qualified_for_verifier_shadow===true).map(r=>Object.freeze(structuredClone(r.admission))));
  }
  snapshot(){
    const s=ledgerState(this.#sourceSha,this.#rows);
    return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,qualified_count:s.qualified_count,append_only:true,active_verifier_root_digest:null,ledger_can_activate_verifier:false,ledger_can_replace_incumbent:false,authority_effect:false});
  }
}

export function rsiVerifierEvolutionAdmissionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.verifier-evolution-admission-root.v1',
    version:1,
    paired_same_examples_required:true,
    process_outcome_labels_separate:true,
    controllable_environment_labels_separate:true,
    sealed_benchmark_required:true,
    transfer_holdout_required:true,
    reward_hack_suite_required:true,
    external_evaluator_required:true,
    no_metric_regression_required:true,
    at_least_one_strict_metric_improvement_required:true,
    reward_hack_exploitation_forbidden:true,
    hidden_benchmark_exposure_forbidden:true,
    evaluator_integrity_required:true,
    from_scratch_replay_required:true,
    incumbent_verifier_remains_active:true,
    candidate_qualified_for_shadow_only:true,
    verifier_shadow_can_gate_canary:false,
    verifier_shadow_can_gate_promotion:false,
    verifier_shadow_can_modify_reward:false,
    candidate_can_self_activate:false,
    candidate_can_replace_incumbent:false,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,verifier_evolution_root_digest:digest(root)});
}
