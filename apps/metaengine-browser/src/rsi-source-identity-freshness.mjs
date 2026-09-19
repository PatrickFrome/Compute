import crypto from 'node:crypto';

import {
  verifyRsiSourceIdentityConvergenceEvidence,
} from './rsi-source-identity-convergence.mjs';

export const RSI_SOURCE_IDENTITY_FRESHNESS_SCHEMA =
  'metaengine.rsi.source-identity-freshness.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_READBACK_AGE_MS=60_000;
const MAX_READBACK_SPAN_MS=30_000;
const MAX_FUTURE_SKEW_MS=5_000;
const TRUSTED_REPOSITORY='PatrickFrome/Compute';
const TRUSTED_SUPABASE_PROJECT='xpeibufgzjknrhbhpffp';

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
  if(!SAFE_ID_RE.test(out)) throw new Error(`rsi_source_freshness_${label}_invalid`);
  return out;
}
function exactDigest(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out)) throw new Error(`rsi_source_freshness_${label}_digest_invalid`);
  return out;
}
function instant(value,label){
  const text=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(text)){
    throw new Error(`rsi_source_freshness_${label}_time_invalid`);
  }
  const ms=Date.parse(text);
  if(!Number.isFinite(ms)) throw new Error(`rsi_source_freshness_${label}_time_invalid`);
  return Object.freeze({text,ms});
}
function positiveInt(value,label){
  const out=Number(value);
  if(!Number.isSafeInteger(out)||out<1) throw new Error(`rsi_source_freshness_${label}_invalid`);
  return out;
}
function plain(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value)){
    throw new Error(`rsi_source_freshness_${label}_invalid`);
  }
  return value;
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
    if(row?.[field]!==false) throw new Error(`rsi_source_freshness_${label}_${field}_invalid`);
  }
  if(row?.automatic_retry_allowed!==false){
    throw new Error(`rsi_source_freshness_${label}_automatic_retry_invalid`);
  }
}
function normalizeGithub(row,evidence){
  row=plain(row,'github_readback');
  if(row.source_kind!=='GITHUB_API_MAIN_REF') throw new Error('rsi_source_freshness_github_source_kind_invalid');
  if(row.repository!==TRUSTED_REPOSITORY) throw new Error('rsi_source_freshness_github_repository_invalid');
  if(boundedId(row.ref,'github_ref')!==evidence.github_ref) throw new Error('rsi_source_freshness_github_ref_mismatch');
  if(String(row.head_sha||'').toLowerCase()!==evidence.github_source_sha) throw new Error('rsi_source_freshness_github_head_mismatch');
  if(exactDigest(row.readback_digest,'github_readback')!==evidence.github_readback_digest) throw new Error('rsi_source_freshness_github_digest_mismatch');
  if(row.authored_by_candidate!==false) throw new Error('rsi_source_freshness_github_candidate_authored');
  instant(row.read_at,'github_read_at');
  return Object.freeze({
    source_kind:'GITHUB_API_MAIN_REF',
    repository:TRUSTED_REPOSITORY,
    ref:evidence.github_ref,
    head_sha:evidence.github_source_sha,
    readback_digest:evidence.github_readback_digest,
    read_at:row.read_at,
    authored_by_candidate:false,
  });
}
function normalizeDb(row,evidence){
  row=plain(row,'db_readback');
  if(row.source_kind!=='SUPABASE_ROADMAP_AUTHORITY_ROW') throw new Error('rsi_source_freshness_db_source_kind_invalid');
  if(row.project_ref!==TRUSTED_SUPABASE_PROJECT) throw new Error('rsi_source_freshness_db_project_invalid');
  if(boundedId(row.authority_key,'db_authority_key')!==evidence.db_authority_key) throw new Error('rsi_source_freshness_db_authority_key_mismatch');
  if(String(row.baseline_sha||'').toLowerCase()!==evidence.db_authority_baseline_sha) throw new Error('rsi_source_freshness_db_baseline_mismatch');
  if(positiveInt(row.alignment_epoch,'db_alignment_epoch')!==evidence.db_alignment_epoch) throw new Error('rsi_source_freshness_db_alignment_epoch_mismatch');
  if(exactDigest(row.readback_digest,'db_readback')!==evidence.db_authority_readback_digest) throw new Error('rsi_source_freshness_db_digest_mismatch');
  if(row.authored_by_candidate!==false) throw new Error('rsi_source_freshness_db_candidate_authored');
  instant(row.read_at,'db_read_at');
  return Object.freeze({
    source_kind:'SUPABASE_ROADMAP_AUTHORITY_ROW',
    project_ref:TRUSTED_SUPABASE_PROJECT,
    authority_key:evidence.db_authority_key,
    baseline_sha:evidence.db_authority_baseline_sha,
    alignment_epoch:evidence.db_alignment_epoch,
    readback_digest:evidence.db_authority_readback_digest,
    read_at:row.read_at,
    authored_by_candidate:false,
  });
}
function normalizeRuntime(row,evidence){
  row=plain(row,'runtime_readback');
  if(row.source_kind!=='DURABLE_RUNTIME_STATE_ROW') throw new Error('rsi_source_freshness_runtime_source_kind_invalid');
  if(row.project_ref!==TRUSTED_SUPABASE_PROJECT) throw new Error('rsi_source_freshness_runtime_project_invalid');
  if(boundedId(row.client_id,'runtime_client_id')!==evidence.runtime_client_id) throw new Error('rsi_source_freshness_runtime_client_mismatch');
  const processIncarnationId=boundedId(row.process_incarnation_id,'runtime_process_incarnation');
  if(String(row.target_git_sha||'').toLowerCase()!==evidence.runtime_target_git_sha) throw new Error('rsi_source_freshness_runtime_target_mismatch');
  if(exactDigest(row.readback_digest,'runtime_readback')!==evidence.runtime_readback_digest) throw new Error('rsi_source_freshness_runtime_digest_mismatch');
  if(row.authored_by_candidate!==false) throw new Error('rsi_source_freshness_runtime_candidate_authored');
  const readAt=instant(row.read_at,'runtime_read_at');
  const lastSeen=instant(row.last_seen_at,'runtime_last_seen_at');
  if(readAt.ms-lastSeen.ms>MAX_READBACK_AGE_MS) throw new Error('rsi_source_freshness_runtime_heartbeat_stale_at_read');
  if(lastSeen.ms-readAt.ms>MAX_FUTURE_SKEW_MS) throw new Error('rsi_source_freshness_runtime_heartbeat_future_at_read');
  return Object.freeze({
    source_kind:'DURABLE_RUNTIME_STATE_ROW',
    project_ref:TRUSTED_SUPABASE_PROJECT,
    client_id:evidence.runtime_client_id,
    process_incarnation_id:processIncarnationId,
    target_git_sha:evidence.runtime_target_git_sha,
    last_seen_at:row.last_seen_at,
    readback_digest:evidence.runtime_readback_digest,
    read_at:row.read_at,
    authored_by_candidate:false,
  });
}
function freshnessBlockers(readbacks,evaluated){
  const blockers=[];
  const rows=[
    ['GITHUB',readbacks.github],
    ['DB_AUTHORITY',readbacks.db_authority],
    ['RUNTIME',readbacks.runtime],
  ];
  const times=[];
  for(const [name,row] of rows){
    const readAt=instant(row.read_at,`${name.toLowerCase()}_read_at`);
    times.push(readAt.ms);
    const age=evaluated.ms-readAt.ms;
    if(age>MAX_READBACK_AGE_MS) blockers.push(`${name}_READBACK_STALE`);
    if(age < -MAX_FUTURE_SKEW_MS) blockers.push(`${name}_READBACK_FUTURE`);
  }
  if(Math.max(...times)-Math.min(...times)>MAX_READBACK_SPAN_MS){
    blockers.push('READBACK_TIME_SPAN_EXCEEDED');
  }
  return blockers;
}

export function createRsiFreshSourceIdentityConvergenceCertificate({
  certificate_id,
  convergence_evidence,
  github_readback,
  db_authority_readback,
  runtime_readback,
  evaluated_at,
  authored_by_candidate=true,
}={}){
  if(authored_by_candidate!==false) throw new Error('rsi_source_freshness_external_certificate_owner_required');
  const evidence=verifyRsiSourceIdentityConvergenceEvidence(convergence_evidence);
  const evaluated=instant(evaluated_at,'evaluated_at');
  const readbacks=Object.freeze({
    github:normalizeGithub(github_readback,evidence),
    db_authority:normalizeDb(db_authority_readback,evidence),
    runtime:normalizeRuntime(runtime_readback,evidence),
  });
  const blockers=freshnessBlockers(readbacks,evaluated);
  if(evidence.source_identity_converged!==true) blockers.push('SOURCE_IDENTITY_NOT_CONVERGED');
  const unique=Object.freeze([...new Set(blockers)].sort());
  const fresh=unique.length===0;
  const core=zero({
    schema:RSI_SOURCE_IDENTITY_FRESHNESS_SCHEMA,
    version:1,
    certificate_id:boundedId(certificate_id,'certificate_id'),
    convergence_evidence:evidence,
    readbacks,
    evaluated_at:evaluated.text,
    freshness_policy:Object.freeze({
      max_readback_age_ms:MAX_READBACK_AGE_MS,
      max_readback_span_ms:MAX_READBACK_SPAN_MS,
      max_future_skew_ms:MAX_FUTURE_SKEW_MS,
      caller_configurable:false,
      runtime_incarnation_required:true,
      typed_source_kind_required:true,
    }),
    blockers:unique,
    state:fresh?'FRESH_SOURCE_IDENTITY_CONVERGED':'SOURCE_IDENTITY_FRESHNESS_BLOCKED',
    fresh_source_identity_converged:fresh,
    eligible_for_external_admission_review:fresh,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiFreshSourceIdentityConvergenceCertificate(certificate){
  if(!certificate||typeof certificate!=='object'||Array.isArray(certificate)
    ||certificate.schema!==RSI_SOURCE_IDENTITY_FRESHNESS_SCHEMA||certificate.version!==1){
    throw new Error('rsi_source_freshness_certificate_invalid');
  }
  assertZero(certificate,'certificate');
  const canonical=createRsiFreshSourceIdentityConvergenceCertificate({
    certificate_id:certificate.certificate_id,
    convergence_evidence:certificate.convergence_evidence,
    github_readback:certificate.readbacks?.github,
    db_authority_readback:certificate.readbacks?.db_authority,
    runtime_readback:certificate.readbacks?.runtime,
    evaluated_at:certificate.evaluated_at,
    authored_by_candidate:false,
  });
  if(stableJson({...canonical,certificate_digest:undefined})!==stableJson({...certificate,certificate_digest:undefined})){
    throw new Error('rsi_source_freshness_certificate_canonical_mismatch');
  }
  if(canonical.certificate_digest!==exactDigest(certificate.certificate_digest,'certificate')){
    throw new Error('rsi_source_freshness_certificate_digest_mismatch');
  }
  return canonical;
}

export function rsiSourceIdentityFreshnessTrustRootSnapshot(){
  const core=zero({
    schema:'metaengine.rsi.source-identity-freshness-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-source-identity-freshness.mjs',
    trusted_repository:TRUSTED_REPOSITORY,
    trusted_supabase_project:TRUSTED_SUPABASE_PROJECT,
    max_readback_age_ms:MAX_READBACK_AGE_MS,
    max_readback_span_ms:MAX_READBACK_SPAN_MS,
    max_future_skew_ms:MAX_FUTURE_SKEW_MS,
    exact_parent_convergence_evidence_required:true,
    typed_source_kind_required:true,
    runtime_process_incarnation_required:true,
    candidate_cannot_configure_freshness:true,
    candidate_cannot_author_certificate:true,
    stale_or_future_readback_blocks_admission:true,
  });
  return Object.freeze({...core,trust_root_digest:digest(core)});
}
