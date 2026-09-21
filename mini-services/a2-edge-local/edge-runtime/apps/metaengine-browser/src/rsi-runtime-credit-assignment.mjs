import crypto from 'node:crypto';

export const RSI_STEP_CREDIT_RECEIPT_SCHEMA='metaengine.rsi.step-credit-receipt.v1';
export const RSI_STEP_CREDIT_ROOT_SCHEMA='metaengine.rsi.step-credit-root.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const METHODS=new Set(['EXTERNAL_STEP_EVALUATOR','COUNTERFACTUAL_ABLATION','TD_REFERENCE_MODEL','MARGINAL_SHAPLEY']);
const SIGNS=new Set(['POSITIVE','NEGATIVE','NEUTRAL']);
const MAX_REFS=32;const MAX_CODES=24;const MAX_LESSONS=32;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_credit_${l}_digest_invalid`);return o}
function uuid(v,l){const o=String(v||'').trim().toLowerCase();if(!UUID_RE.test(o))throw new Error(`rsi_credit_${l}_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_credit_${l}_invalid`);return o}
function token(v,l){const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_credit_${l}_invalid`);return o}
function candidateId(v){const o=String(v||'').trim().toLowerCase();if(!CANDIDATE_ID_RE.test(o))throw new Error('rsi_credit_candidate_id_invalid');return o}
function positiveInt(v,l,max=10000){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_credit_${l}_invalid`);return o}
function score(v){const o=Number(v);if(!Number.isFinite(o)||o < -1||o > 1)throw new Error('rsi_credit_score_invalid');return Math.round(o*1e9)/1e9}
function refs(v){if(!Array.isArray(v)||v.length<1||v.length>MAX_REFS)throw new Error('rsi_credit_evidence_refs_invalid');return [...new Set(v.map(x=>boundedId(x,'evidence_ref')))].sort()}
function codes(v){if(v==null)return [];if(!Array.isArray(v)||v.length>MAX_CODES)throw new Error('rsi_credit_failure_codes_invalid');return [...new Set(v.map(x=>token(x,'failure_code')))].sort()}
function lessons(v){if(v==null)return [];if(!Array.isArray(v)||v.length>MAX_LESSONS)throw new Error('rsi_credit_lesson_digests_invalid');return [...new Set(v.map(x=>exactDigest(x,'lesson')))].sort()}
function assertEpisode(e){
  if(!e||typeof e!=='object'||Array.isArray(e)||e.schema!=='metaengine.rsi.browser-outcome-episode.v1')throw new Error('rsi_credit_episode_invalid');
  if(e.authority_effect!==false||e.execution_authority!==false||e.automatic_retry_allowed!==false)throw new Error('rsi_credit_episode_authority_invalid');
  if(e.quarantined===true||e.eligible_for_credit_assignment!==true)throw new Error('rsi_credit_episode_not_eligible');
  exactDigest(e.episode_digest,'episode');uuid(e.command_id,'command_id');candidateId(e.candidate_id);
  boundedId(e.trajectory_id,'trajectory_id');positiveInt(e.step_index,'step_index');positiveInt(e.step_count,'step_count');
  if(e.step_index>e.step_count)throw new Error('rsi_credit_episode_step_invalid');
  return e;
}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_credit_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_credit_${l}_automatic_retry_invalid`)}

export function createRsiStepCreditReceipt({
  credit_id,episode,credit_sign,credit_score,method,evaluator_digest,evaluation_digest,
  failure_codes=[],lesson_digests=[],evidence_refs,
  external_credit_assigner=false,authored_by_candidate=true,
}={}){
  const e=assertEpisode(episode);
  const sign=token(credit_sign,'sign');if(!SIGNS.has(sign))throw new Error('rsi_credit_sign_invalid');
  const s=score(credit_score);
  if((sign==='POSITIVE'&&s<=0)||(sign==='NEGATIVE'&&s>=0)||(sign==='NEUTRAL'&&s!==0))throw new Error('rsi_credit_sign_score_mismatch');
  const methodId=token(method,'method');if(!METHODS.has(methodId))throw new Error('rsi_credit_method_invalid');
  if(external_credit_assigner!==true||authored_by_candidate!==false)throw new Error('rsi_credit_external_assigner_required');
  const failures=codes(failure_codes);
  if(sign==='NEGATIVE'&&failures.length<1)throw new Error('rsi_credit_negative_failure_code_required');
  if(sign!=='NEGATIVE'&&failures.length>0)throw new Error('rsi_credit_nonnegative_failure_codes_forbidden');
  const core={
    schema:RSI_STEP_CREDIT_RECEIPT_SCHEMA,version:1,
    credit_id:boundedId(credit_id,'credit_id'),
    episode_digest:e.episode_digest,command_id:e.command_id,
    task_id:e.task_id,task_signature_digest:e.task_signature_digest,
    trajectory_id:e.trajectory_id,step_index:e.step_index,step_count:e.step_count,
    candidate_id:e.candidate_id,candidate_sha:e.candidate_sha,proposal_digest:e.proposal_digest,
    skill_digests:[...(e.skill_digests||[])],
    credit_sign:sign,credit_score:s,method:methodId,
    evaluator_digest:exactDigest(evaluator_digest,'evaluator'),
    evaluation_digest:exactDigest(evaluation_digest,'evaluation'),
    failure_codes:failures,lesson_digests:lessons(lesson_digests),evidence_refs:refs(evidence_refs),
    external_credit_assigner:true,authored_by_candidate:false,
    final_task_reward_broadcast_to_all_steps:false,
    candidate_can_assign_own_credit:false,
    receipt_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiStepCreditReceipt(row,episode){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_STEP_CREDIT_RECEIPT_SCHEMA||row.version!==1)throw new Error('rsi_credit_receipt_invalid');
  assertZero(row,'receipt');
  if(row.external_credit_assigner!==true||row.authored_by_candidate!==false||row.final_task_reward_broadcast_to_all_steps!==false||row.candidate_can_assign_own_credit!==false||row.receipt_is_execution_authority!==false)throw new Error('rsi_credit_receipt_policy_invalid');
  const canonical=createRsiStepCreditReceipt({
    credit_id:row.credit_id,episode,credit_sign:row.credit_sign,credit_score:row.credit_score,method:row.method,
    evaluator_digest:row.evaluator_digest,evaluation_digest:row.evaluation_digest,failure_codes:row.failure_codes,
    lesson_digests:row.lesson_digests,evidence_refs:row.evidence_refs,external_credit_assigner:true,authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(row.receipt_digest,'receipt'))throw new Error('rsi_credit_receipt_digest_mismatch');
  return canonical;
}

export function rsiStepCreditTrustRootSnapshot(){
  const root={
    schema:RSI_STEP_CREDIT_ROOT_SCHEMA,version:1,
    policy_path:'apps/metaengine-browser/src/rsi-runtime-credit-assignment.mjs',
    methods:[...METHODS].sort(),credit_signs:[...SIGNS].sort(),
    independently_verified_episode_required:true,
    exact_trajectory_step_binding_required:true,
    final_task_reward_broadcast_to_all_steps:false,
    candidate_can_assign_own_credit:false,
    neutral_credit_not_success_or_failure:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,credit_root_digest:digest(root)});
}
