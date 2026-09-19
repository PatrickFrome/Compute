import crypto from 'node:crypto';

import {
  verifyRsiFreshSourceIdentityConvergenceCertificate,
} from './rsi-source-identity-freshness.mjs';

export const RSI_SOURCE_IDENTITY_STABILITY_SCHEMA =
  'metaengine.rsi.source-identity-stability.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MIN_STABILITY_WINDOW_MS=1_000;
const MAX_STABILITY_WINDOW_MS=60_000;
const MAX_CERTIFICATE_AGE_MS=60_000;
const MAX_FUTURE_SKEW_MS=5_000;

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(!value||typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function stableJson(value){ return JSON.stringify(stable(value)); }
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(stableJson(value),'utf8').digest('hex')}`;
}
function boundedId(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID_RE.test(out)) throw new Error(`rsi_source_stability_${label}_invalid`);
  return out;
}
function exactDigest(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out)) throw new Error(`rsi_source_stability_${label}_digest_invalid`);
  return out;
}
function instant(value,label){
  const text=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(text)){
    throw new Error(`rsi_source_stability_${label}_time_invalid`);
  }
  const ms=Date.parse(text);
  if(!Number.isFinite(ms)) throw new Error(`rsi_source_stability_${label}_time_invalid`);
  return Object.freeze({text,ms});
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZero(row,label){
  for(const field of [
    'execution_authority','browser_authority','task_authority',
    'production_mutation_authority','promotion_authority','self_update_authority',
    'scheduler_authority','signing_authority','direct_tool_execution_authority',
    'authority_effect',
  ]){
    if(row?.[field]!==false) throw new Error(`rsi_source_stability_${label}_${field}_invalid`);
  }
  if(row?.automatic_retry_allowed!==false){
    throw new Error(`rsi_source_stability_${label}_automatic_retry_invalid`);
  }
}
function sourceTuple(certificate){
  const evidence=certificate.convergence_evidence;
  return Object.freeze({
    github_source_sha:evidence.github_source_sha,
    db_authority_baseline_sha:evidence.db_authority_baseline_sha,
    runtime_target_git_sha:evidence.runtime_target_git_sha,
    github_ref:evidence.github_ref,
    db_authority_key:evidence.db_authority_key,
    db_alignment_epoch:evidence.db_alignment_epoch,
    runtime_client_id:evidence.runtime_client_id,
    runtime_process_incarnation_id:certificate.readbacks.runtime.process_incarnation_id,
  });
}
function readWindow(certificate,label){
  const rows=[
    instant(certificate.readbacks.github.read_at,`${label}_github_read_at`).ms,
    instant(certificate.readbacks.db_authority.read_at,`${label}_db_read_at`).ms,
    instant(certificate.readbacks.runtime.read_at,`${label}_runtime_read_at`).ms,
  ];
  return Object.freeze({earliest:Math.min(...rows),latest:Math.max(...rows)});
}
function stabilityBlockers(first,second,evaluated){
  const blockers=[];
  if(first.fresh_source_identity_converged!==true) blockers.push('FIRST_ROUND_NOT_FRESH');
  if(second.fresh_source_identity_converged!==true) blockers.push('SECOND_ROUND_NOT_FRESH');

  if(first.certificate_digest===second.certificate_digest
    ||first.certificate_id===second.certificate_id){
    blockers.push('REPLAYED_ROUND_CERTIFICATE');
  }

  const a=sourceTuple(first);
  const b=sourceTuple(second);
  for(const key of [
    'github_source_sha','db_authority_baseline_sha','runtime_target_git_sha',
    'github_ref','db_authority_key','runtime_client_id',
  ]){
    if(a[key]!==b[key]) blockers.push('SOURCE_IDENTITY_CHANGED_BETWEEN_ROUNDS');
  }
  if(a.db_alignment_epoch!==b.db_alignment_epoch){
    blockers.push('DB_ALIGNMENT_EPOCH_CHANGED_BETWEEN_ROUNDS');
  }
  if(a.runtime_process_incarnation_id!==b.runtime_process_incarnation_id){
    blockers.push('RUNTIME_PROCESS_INCARNATION_CHANGED_BETWEEN_ROUNDS');
  }

  const firstEvaluated=instant(first.evaluated_at,'first_evaluated_at');
  const secondEvaluated=instant(second.evaluated_at,'second_evaluated_at');
  if(secondEvaluated.ms<=firstEvaluated.ms){
    blockers.push('ROUND_EVALUATION_ORDER_INVALID');
  }

  const firstWindow=readWindow(first,'first');
  const secondWindow=readWindow(second,'second');
  const stableWindowMs=secondWindow.earliest-firstWindow.latest;
  if(stableWindowMs<MIN_STABILITY_WINDOW_MS){
    blockers.push('STABILITY_WINDOW_TOO_SHORT_OR_OVERLAPPING');
  }
  if(stableWindowMs>MAX_STABILITY_WINDOW_MS){
    blockers.push('STABILITY_WINDOW_TOO_LONG');
  }

  const certificateAge=evaluated.ms-secondEvaluated.ms;
  if(certificateAge>MAX_CERTIFICATE_AGE_MS){
    blockers.push('SECOND_ROUND_CERTIFICATE_STALE');
  }
  if(certificateAge < -MAX_FUTURE_SKEW_MS){
    blockers.push('SECOND_ROUND_CERTIFICATE_FUTURE');
  }

  return Object.freeze({
    blockers:Object.freeze([...new Set(blockers)].sort()),
    stable_window_ms:stableWindowMs,
  });
}

export function createRsiStableSourceIdentityConvergenceCertificate({
  certificate_id,
  first_round,
  second_round,
  evaluated_at,
  authored_by_candidate=true,
}={}){
  if(authored_by_candidate!==false){
    throw new Error('rsi_source_stability_external_certificate_owner_required');
  }
  const first=verifyRsiFreshSourceIdentityConvergenceCertificate(first_round);
  const second=verifyRsiFreshSourceIdentityConvergenceCertificate(second_round);
  const evaluated=instant(evaluated_at,'evaluated_at');
  const result=stabilityBlockers(first,second,evaluated);
  const stableConvergence=result.blockers.length===0;

  const core=zero({
    schema:RSI_SOURCE_IDENTITY_STABILITY_SCHEMA,
    version:1,
    certificate_id:boundedId(certificate_id,'certificate_id'),
    first_round:first,
    second_round:second,
    evaluated_at:evaluated.text,
    stability_policy:Object.freeze({
      min_stability_window_ms:MIN_STABILITY_WINDOW_MS,
      max_stability_window_ms:MAX_STABILITY_WINDOW_MS,
      max_certificate_age_ms:MAX_CERTIFICATE_AGE_MS,
      max_future_skew_ms:MAX_FUTURE_SKEW_MS,
      caller_configurable:false,
      strictly_newer_readback_round_required:true,
      exact_source_tuple_stable_required:true,
      exact_db_alignment_epoch_stable_required:true,
      exact_runtime_process_incarnation_stable_required:true,
    }),
    stable_window_ms:result.stable_window_ms,
    blockers:result.blockers,
    state:stableConvergence
      ?'STABLE_SOURCE_IDENTITY_CONVERGED'
      :'SOURCE_IDENTITY_STABILITY_BLOCKED',
    stable_source_identity_converged:stableConvergence,
    eligible_for_external_admission_review:stableConvergence,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiStableSourceIdentityConvergenceCertificate(certificate){
  if(!certificate||typeof certificate!=='object'||Array.isArray(certificate)
    ||certificate.schema!==RSI_SOURCE_IDENTITY_STABILITY_SCHEMA||certificate.version!==1){
    throw new Error('rsi_source_stability_certificate_invalid');
  }
  assertZero(certificate,'certificate');
  const canonical=createRsiStableSourceIdentityConvergenceCertificate({
    certificate_id:certificate.certificate_id,
    first_round:certificate.first_round,
    second_round:certificate.second_round,
    evaluated_at:certificate.evaluated_at,
    authored_by_candidate:false,
  });
  if(stableJson({...canonical,certificate_digest:undefined})
    !==stableJson({...certificate,certificate_digest:undefined})){
    throw new Error('rsi_source_stability_certificate_canonical_mismatch');
  }
  if(canonical.certificate_digest!==exactDigest(certificate.certificate_digest,'certificate')){
    throw new Error('rsi_source_stability_certificate_digest_mismatch');
  }
  return canonical;
}

export function rsiSourceIdentityStabilityTrustRootSnapshot(){
  const core=zero({
    schema:'metaengine.rsi.source-identity-stability-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-source-identity-stability.mjs',
    min_stability_window_ms:MIN_STABILITY_WINDOW_MS,
    max_stability_window_ms:MAX_STABILITY_WINDOW_MS,
    max_certificate_age_ms:MAX_CERTIFICATE_AGE_MS,
    max_future_skew_ms:MAX_FUTURE_SKEW_MS,
    exact_freshness_parent_required:true,
    strictly_newer_readback_round_required:true,
    exact_source_tuple_stable_required:true,
    exact_db_alignment_epoch_stable_required:true,
    exact_runtime_process_incarnation_stable_required:true,
    candidate_cannot_configure_stability:true,
    candidate_cannot_author_certificate:true,
    stable_witness_grants_effect_authority:false,
  });
  return Object.freeze({...core,trust_root_digest:digest(core)});
}
