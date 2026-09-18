import crypto from 'node:crypto';

export const RSI_BROWSER_OUTCOME_EPISODE_SCHEMA = 'metaengine.rsi.browser-outcome-episode.v1';
export const RSI_BROWSER_OUTCOME_INGEST_ROOT_SCHEMA = 'metaengine.rsi.browser-outcome-ingest-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const TERMINAL_STATUSES=new Set(['COMPLETED','FAILED']);
const MAX_SKILLS=32;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_outcome_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_outcome_${l}_digest_invalid`);return o}
function uuid(v,l){const o=String(v||'').trim().toLowerCase();if(!UUID_RE.test(o))throw new Error(`rsi_outcome_${l}_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_outcome_${l}_invalid`);return o}
function token(v,l,{nullable=false}={}){if(nullable&&(v==null||v===''))return null;const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_outcome_${l}_invalid`);return o}
function candidateId(v){const o=String(v||'').trim().toLowerCase();if(!CANDIDATE_ID_RE.test(o))throw new Error('rsi_outcome_candidate_id_invalid');return o}
function boundedExecutionMs(v){if(v==null)return null;const o=Number(v);if(!Number.isFinite(o)||o<0||o>86_400_000)throw new Error('rsi_outcome_execution_ms_invalid');return Math.round(o*1000)/1000}
function assertZeroAuthority(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_outcome_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_outcome_${l}_automatic_retry_invalid`)}
function normalizeSkillDigests(v){if(v==null)return Object.freeze([]);if(!Array.isArray(v)||v.length>MAX_SKILLS)throw new Error('rsi_outcome_skill_digests_invalid');const seen=new Set();const out=v.map(x=>exactDigest(x,'skill'));for(const d of out){if(seen.has(d))throw new Error('rsi_outcome_skill_digest_duplicate');seen.add(d)}return Object.freeze(out.sort())}

function verifyReadback(readback){
  if(!readback||typeof readback!=='object'||Array.isArray(readback)||readback.schema!=='metaengine.rsi.result-receipt-readback.v1')throw new Error('rsi_outcome_readback_invalid');
  assertZeroAuthority(readback,'readback');
  const commandId=uuid(readback.command_id,'command_id');
  if(readback.found!==true||readback.terminal!==true)throw new Error('rsi_outcome_terminal_readback_required');
  const status=token(readback.status,'terminal_status');
  if(!TERMINAL_STATUSES.has(status))throw new Error('rsi_outcome_terminal_status_invalid');
  const receipt=readback.receipt;
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||receipt.schema!=='metaengine.native-supervisor.command-receipt.v2')throw new Error('rsi_outcome_receipt_invalid');
  if(receipt.authority_effect!==false)throw new Error('rsi_outcome_receipt_authority_invalid');
  if(uuid(receipt.command_id,'receipt_command_id')!==commandId)throw new Error('rsi_outcome_receipt_command_mismatch');
  return {commandId,status,receipt};
}

function normalizeAttribution(attribution){
  if(!attribution||typeof attribution!=='object'||Array.isArray(attribution))throw new Error('rsi_outcome_external_attribution_required');
  if(attribution.external_attribution!==true||attribution.authored_by_candidate!==false)throw new Error('rsi_outcome_external_attribution_required');
  const candidatePresent=attribution.candidate_id!=null||attribution.candidate_sha!=null||attribution.proposal_digest!=null;
  let candidate_id=null,candidate_sha=null,proposal_digest=null;
  if(candidatePresent){
    if(attribution.candidate_id==null||attribution.candidate_sha==null||attribution.proposal_digest==null)throw new Error('rsi_outcome_candidate_attribution_incomplete');
    candidate_id=candidateId(attribution.candidate_id);
    candidate_sha=exactSha(attribution.candidate_sha,'candidate');
    proposal_digest=exactDigest(attribution.proposal_digest,'proposal');
  }
  return Object.freeze({
    task_id:boundedId(attribution.task_id,'task_id'),
    task_signature_digest:exactDigest(attribution.task_signature_digest,'task_signature'),
    environment_fingerprint:boundedId(attribution.environment_fingerprint,'environment_fingerprint'),
    model_family:token(attribution.model_family,'model_family'),
    candidate_id,candidate_sha,proposal_digest,
    skill_digests:normalizeSkillDigests(attribution.skill_digests),
    external_attribution:true,
    authored_by_candidate:false,
  });
}

function classify(status,effectOutcome){
  if(effectOutcome==='AMBIGUOUS')return 'QUARANTINED_AMBIGUOUS';
  if(status==='COMPLETED'){
    if(effectOutcome==null)return 'VERIFIED_COMPLETED_READ_ONLY';
    if(effectOutcome==='CONFIRMED')return 'VERIFIED_CONFIRMED_EFFECT';
    if(effectOutcome==='NO_EFFECT_PROVEN')return 'VERIFIED_COMPLETED_NO_EFFECT';
    return 'QUARANTINED_UNCLASSIFIED_EFFECT';
  }
  if(effectOutcome==='NO_EFFECT_PROVEN'||effectOutcome==='PRE_EFFECT_FAILURE'||effectOutcome==='FENCED')return 'VERIFIED_FAILED_NO_EFFECT';
  return 'QUARANTINED_UNCLASSIFIED_EFFECT';
}

export function createRsiBrowserOutcomeEpisode({source_sha,readback,attribution}={}){
  const sourceSha=exactSha(source_sha,'source');
  const {commandId,status,receipt}=verifyReadback(readback);
  const bound=normalizeAttribution(attribution);
  const action=token(receipt.action,'action');
  const platform=token(receipt.platform,'platform',{nullable:true});
  const effectOutcome=token(receipt.effect_outcome,'effect_outcome',{nullable:true});
  const lane=token(receipt.lane,'lane',{nullable:true});
  const effectKey=receipt.effect_key==null?null:boundedId(receipt.effect_key,'effect_key');
  const executionMs=boundedExecutionMs(receipt.execution_ms);
  if(typeof receipt.recorded_at!=='string'||Number.isNaN(Date.parse(receipt.recorded_at)))throw new Error('rsi_outcome_recorded_at_invalid');
  const outcomeState=classify(status,effectOutcome);
  const quarantined=outcomeState.startsWith('QUARANTINED_');
  const candidateBound=bound.candidate_id!=null;
  const receiptDigest=digest(receipt);
  const errorDigest=readback.error==null?null:digest({error:String(readback.error)});
  const contextDigest=digest(bound);
  const core={
    schema:RSI_BROWSER_OUTCOME_EPISODE_SCHEMA,
    version:1,
    source_sha:sourceSha,
    command_id:commandId,
    terminal_status:status,
    action,
    platform,
    effect_outcome:effectOutcome,
    lane,
    effect_key:effectKey,
    execution_ms:executionMs,
    recorded_at:new Date(receipt.recorded_at).toISOString(),
    receipt_digest:receiptDigest,
    error_digest:errorDigest,
    task_id:bound.task_id,
    task_signature_digest:bound.task_signature_digest,
    environment_fingerprint:bound.environment_fingerprint,
    model_family:bound.model_family,
    candidate_id:bound.candidate_id,
    candidate_sha:bound.candidate_sha,
    proposal_digest:bound.proposal_digest,
    skill_digests:bound.skill_digests,
    context_digest:contextDigest,
    outcome_state:outcomeState,
    quarantined,
    terminal_receipt_readback_required:true,
    same_client_readback_assumed_by_adapter_contract:true,
    raw_result_stored:false,
    raw_error_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    candidate_attribution_required_for_learning:true,
    eligible_for_experience_graph:!quarantined&&candidateBound,
    eligible_for_skill_evidence:!quarantined&&candidateBound&&bound.skill_digests.length>0,
    ambiguous_outcome_learning_allowed:false,
    physical_effect_replay_allowed:false,
    candidate_can_edit_episode:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,episode_digest:digest(core)});
}

export function verifyRsiBrowserOutcomeEpisode(episode,{source_sha,readback,attribution}={}){
  if(!episode||typeof episode!=='object'||Array.isArray(episode)||episode.schema!==RSI_BROWSER_OUTCOME_EPISODE_SCHEMA||episode.version!==1)throw new Error('rsi_outcome_episode_invalid');
  assertZeroAuthority(episode,'episode');
  if(episode.raw_result_stored!==false||episode.raw_error_stored!==false||episode.raw_page_text_stored!==false||episode.raw_user_input_stored!==false||episode.candidate_can_edit_episode!==false||episode.physical_effect_replay_allowed!==false||episode.ambiguous_outcome_learning_allowed!==false)throw new Error('rsi_outcome_episode_policy_invalid');
  const canonical=createRsiBrowserOutcomeEpisode({source_sha,readback,attribution});
  if(canonical.episode_digest!==exactDigest(episode.episode_digest,'episode'))throw new Error('rsi_outcome_episode_digest_mismatch');
  return canonical;
}

export function rsiBrowserOutcomeIngestTrustRootSnapshot(){
  const root={
    schema:RSI_BROWSER_OUTCOME_INGEST_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-browser-outcome-ingest.mjs',
    terminal_receipt_readback_required:true,
    terminal_statuses:[...TERMINAL_STATUSES].sort(),
    same_client_readback_required:true,
    external_attribution_required:true,
    candidate_attribution_required_for_learning:true,
    ambiguous_outcome_learning_allowed:false,
    unclassified_effect_learning_allowed:false,
    raw_result_stored:false,
    raw_error_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    receipt_digest_only:true,
    candidate_can_edit_episode:false,
    physical_effect_replay_allowed:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,outcome_ingest_root_digest:digest(root)});
}
