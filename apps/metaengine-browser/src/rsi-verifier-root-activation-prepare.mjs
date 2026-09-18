import crypto from 'node:crypto';

import {
  verifyRsiVerifierRootStagingManifest,
  verifyRsiVerifierRootPropagationReceipt,
  verifyRsiVerifierRootStagingReview,
} from './rsi-verifier-root-staging.mjs';

export const RSI_VERIFIER_ROOT_ACTIVATION_PREPARE_SCHEMA='metaengine.rsi.verifier-root-activation-prepare.v1';
export const RSI_VERIFIER_ROOT_ACTIVATION_READINESS_SCHEMA='metaengine.rsi.verifier-root-activation-readiness.v1';
export const RSI_VERIFIER_ROOT_ACTIVATION_PREPARE_REVIEW_SCHEMA='metaengine.rsi.verifier-root-activation-prepare-review.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const DOMAINS=Object.freeze(['PROMOTION','RUNTIME','TOURNAMENT']);
const REQUIRED_CHECKS=Object.freeze([
  'predecessor_liveness_pass',
  'candidate_catchup_pass',
  'joint_validation_pass',
  'rollback_path_pass',
  'root_history_freshness_pass',
  'incident_free',
  'no_pending_effect',
]);

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactDigest(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA256_RE.test(x))throw new Error(`rsi_root_prepare_${l}_digest_invalid`);
  return x;
}
function id(v,l){
  const x=String(v||'').trim();
  if(!SAFE_ID_RE.test(x))throw new Error(`rsi_root_prepare_${l}_invalid`);
  return x;
}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_root_prepare_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_root_prepare_${l}_retry_invalid`);
}
function verifyDigestObject(row,schema,digestField,label){
  if(!row||row.schema!==schema||row.version!==1)throw new Error(`rsi_root_prepare_${label}_invalid`);
  assertZero(row,label);
  const clone=structuredClone(row);delete clone[digestField];
  if(dg(clone)!==exactDigest(row[digestField],label))throw new Error(`rsi_root_prepare_${label}_digest_mismatch`);
  return Object.freeze(structuredClone(row));
}
function stagingBundle({staging_review,manifest,propagation_receipts}={}){
  const m=verifyRsiVerifierRootStagingManifest(manifest);
  const receipts=propagation_receipts.map(row=>verifyRsiVerifierRootPropagationReceipt(row,{manifest:m}));
  const review=verifyRsiVerifierRootStagingReview(staging_review,{manifest:m,propagation_receipts:receipts});
  if(review.state!=='READY_FOR_EXTERNAL_ROOT_ACTIVATION_REVIEW'||review.ready_for_external_root_activation_review!==true){
    throw new Error('rsi_root_prepare_staging_review_not_ready');
  }
  if(review.active_verifier_root_digest!==m.predecessor_verifier_root_digest||review.candidate_root_staged_only!==true){
    throw new Error('rsi_root_prepare_staging_identity_invalid');
  }
  return Object.freeze({manifest:m,staging_review:review,propagation_receipts:Object.freeze(receipts)});
}
function readinessRoots(value,manifest){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('rsi_root_prepare_readiness_roots_invalid');
  const keys=Object.keys(value).sort();
  if(keys.length!==DOMAINS.length||keys.some((x,i)=>x!==DOMAINS[i]))throw new Error('rsi_root_prepare_readiness_domains_invalid');
  const roots=Object.fromEntries(DOMAINS.map(domain=>[domain,exactDigest(value[domain],`readiness_${domain.toLowerCase()}`)]));
  for(const domain of DOMAINS){
    if(roots[domain]===manifest.candidate_verifier_root_digest)throw new Error('rsi_root_prepare_candidate_cannot_be_readiness_root');
  }
  return Object.freeze(roots);
}

export function createRsiVerifierRootActivationPrepare({
  prepare_id,
  staging_review,
  manifest,
  propagation_receipts,
  readiness_roots,
  external_prepare_owner=false,
  authored_by_candidate=true,
}={}){
  const bundle=stagingBundle({staging_review,manifest,propagation_receipts});
  if(external_prepare_owner!==true||authored_by_candidate!==false)throw new Error('rsi_root_prepare_external_owner_required');
  const roots=readinessRoots(readiness_roots,bundle.manifest);
  const core={
    schema:RSI_VERIFIER_ROOT_ACTIVATION_PREPARE_SCHEMA,version:1,
    prepare_id:id(prepare_id,'prepare_id'),
    source_sha:bundle.manifest.source_sha,
    staging_review_digest:bundle.staging_review.review_digest,
    staging_manifest_digest:bundle.manifest.manifest_digest,
    staging_bundle_digest:bundle.manifest.staging_bundle_digest,
    root_change_review_digest:bundle.manifest.root_change_review_digest,
    current_root_generation:bundle.manifest.current_root_generation,
    prepared_root_generation:bundle.manifest.staging_bundle_generation,
    predecessor_verifier_root_digest:bundle.manifest.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:bundle.manifest.candidate_verifier_root_digest,
    secondary_verifier_root_digest:bundle.manifest.secondary_verifier_root_digest,
    next_root_history_digest:bundle.manifest.next_root_history_digest,
    overlap_root_digests:bundle.manifest.overlap_root_digests,
    readiness_roots:roots,
    required_readiness_domains:DOMAINS,
    required_checks:REQUIRED_CHECKS,
    mode:'JOINT_TRUST_PREPARE',
    candidate_role:'LEARNER_NON_AUTHORITATIVE',
    active_verifier_root_digest:bundle.manifest.predecessor_verifier_root_digest,
    joint_old_new_validation_required:true,
    predecessor_liveness_required:true,
    candidate_catchup_required:true,
    rollback_path_required:true,
    root_history_freshness_required:true,
    incident_free_required:true,
    no_pending_effect_required:true,
    candidate_can_vote:false,
    candidate_can_be_active:false,
    candidate_can_self_promote:false,
    candidate_can_choose_readiness_roots:false,
    predecessor_retirement_authorized:false,
    root_activation_commit_authorized:false,
    verifier_activation_authorized:false,
    activation_commit_token:null,
    external_commit_controller_required:true,
    external_prepare_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,prepare_digest:dg(core)});
}

export function verifyRsiVerifierRootActivationPrepare(row){
  const p=verifyDigestObject(row,RSI_VERIFIER_ROOT_ACTIVATION_PREPARE_SCHEMA,'prepare_digest','prepare');
  if(
    p.prepared_root_generation!==p.current_root_generation+1
    ||p.mode!=='JOINT_TRUST_PREPARE'
    ||p.candidate_role!=='LEARNER_NON_AUTHORITATIVE'
    ||p.active_verifier_root_digest!==p.predecessor_verifier_root_digest
    ||p.joint_old_new_validation_required!==true
    ||p.predecessor_liveness_required!==true
    ||p.candidate_catchup_required!==true
    ||p.rollback_path_required!==true
    ||p.root_history_freshness_required!==true
    ||p.incident_free_required!==true
    ||p.no_pending_effect_required!==true
    ||p.candidate_can_vote!==false
    ||p.candidate_can_be_active!==false
    ||p.candidate_can_self_promote!==false
    ||p.candidate_can_choose_readiness_roots!==false
    ||p.predecessor_retirement_authorized!==false
    ||p.root_activation_commit_authorized!==false
    ||p.verifier_activation_authorized!==false
    ||p.activation_commit_token!==null
    ||p.external_commit_controller_required!==true
    ||p.external_prepare_owner!==true||p.authored_by_candidate!==false
  )throw new Error('rsi_root_prepare_policy_invalid');
  if(JSON.stringify(p.required_readiness_domains)!==JSON.stringify(DOMAINS))throw new Error('rsi_root_prepare_domains_invalid');
  if(JSON.stringify(p.required_checks)!==JSON.stringify(REQUIRED_CHECKS))throw new Error('rsi_root_prepare_checks_invalid');
  readinessRoots(p.readiness_roots,p);
  return p;
}

export function createRsiVerifierRootActivationReadinessReceipt({
  receipt_id,
  prepare,
  readiness_domain,
  readiness_root_digest,
  predecessor_liveness_pass=false,
  candidate_catchup_pass=false,
  joint_validation_pass=false,
  rollback_path_pass=false,
  root_history_freshness_pass=false,
  incident_free=false,
  no_pending_effect=false,
  observed_active_verifier_root_digest,
  observed_staging_bundle_digest,
  readiness_evidence_digest,
  evidence_refs,
  external_readiness_auditor=false,
  authored_by_candidate=true,
}={}){
  const p=verifyRsiVerifierRootActivationPrepare(prepare);
  if(external_readiness_auditor!==true||authored_by_candidate!==false)throw new Error('rsi_root_prepare_external_readiness_auditor_required');
  const domain=String(readiness_domain||'').trim().toUpperCase();
  if(!DOMAINS.includes(domain))throw new Error('rsi_root_prepare_readiness_domain_invalid');
  const root=exactDigest(readiness_root_digest,'readiness_root');
  if(root!==p.readiness_roots[domain])throw new Error('rsi_root_prepare_readiness_root_mismatch');
  const observedActive=exactDigest(observed_active_verifier_root_digest,'observed_active');
  const observedBundle=exactDigest(observed_staging_bundle_digest,'observed_bundle');
  const checks={
    predecessor_liveness_pass:predecessor_liveness_pass===true,
    candidate_catchup_pass:candidate_catchup_pass===true,
    joint_validation_pass:joint_validation_pass===true,
    rollback_path_pass:rollback_path_pass===true,
    root_history_freshness_pass:root_history_freshness_pass===true,
    incident_free:incident_free===true,
    no_pending_effect:no_pending_effect===true,
  };
  const identityPass=observedActive===p.predecessor_verifier_root_digest&&observedBundle===p.staging_bundle_digest;
  const overallPass=identityPass&&REQUIRED_CHECKS.every(k=>checks[k]===true);
  const refs=Array.isArray(evidence_refs)?[...new Set(evidence_refs.map(x=>id(x,'evidence_ref')))].sort():[];
  if(refs.length<1||refs.length!==evidence_refs.length)throw new Error('rsi_root_prepare_evidence_refs_invalid');
  const core={
    schema:RSI_VERIFIER_ROOT_ACTIVATION_READINESS_SCHEMA,version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:p.source_sha,
    prepare_digest:p.prepare_digest,
    readiness_domain:domain,
    readiness_root_digest:root,
    predecessor_verifier_root_digest:p.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:p.candidate_verifier_root_digest,
    prepared_root_generation:p.prepared_root_generation,
    next_root_history_digest:p.next_root_history_digest,
    observed_active_verifier_root_digest:observedActive,
    observed_staging_bundle_digest:observedBundle,
    active_root_identity_pass:observedActive===p.predecessor_verifier_root_digest,
    staging_bundle_identity_pass:observedBundle===p.staging_bundle_digest,
    ...checks,
    overall_pass:overallPass,
    readiness_evidence_digest:exactDigest(readiness_evidence_digest,'readiness_evidence'),
    evidence_refs:Object.freeze(refs),
    candidate_role:'LEARNER_NON_AUTHORITATIVE',
    receipt_is_activation_authority:false,
    candidate_cannot_self_report_readiness:true,
    external_readiness_auditor:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:dg(core)});
}

export function verifyRsiVerifierRootActivationReadinessReceipt(row,{prepare}={}){
  const p=verifyRsiVerifierRootActivationPrepare(prepare);
  const r=verifyDigestObject(row,RSI_VERIFIER_ROOT_ACTIVATION_READINESS_SCHEMA,'receipt_digest','readiness');
  if(
    r.prepare_digest!==p.prepare_digest
    ||r.source_sha!==p.source_sha
    ||!DOMAINS.includes(r.readiness_domain)
    ||r.readiness_root_digest!==p.readiness_roots[r.readiness_domain]
    ||r.predecessor_verifier_root_digest!==p.predecessor_verifier_root_digest
    ||r.candidate_verifier_root_digest!==p.candidate_verifier_root_digest
    ||r.prepared_root_generation!==p.prepared_root_generation
    ||r.next_root_history_digest!==p.next_root_history_digest
    ||r.candidate_role!=='LEARNER_NON_AUTHORITATIVE'
    ||r.receipt_is_activation_authority!==false
    ||r.candidate_cannot_self_report_readiness!==true
    ||r.external_readiness_auditor!==true||r.authored_by_candidate!==false
  )throw new Error('rsi_root_prepare_readiness_policy_invalid');
  const expectedIdentity=r.observed_active_verifier_root_digest===p.predecessor_verifier_root_digest
    &&r.observed_staging_bundle_digest===p.staging_bundle_digest;
  const expectedPass=expectedIdentity&&REQUIRED_CHECKS.every(k=>r[k]===true);
  if(r.overall_pass!==expectedPass)throw new Error('rsi_root_prepare_readiness_pass_mismatch');
  return r;
}

export function createRsiVerifierRootActivationPrepareReview({
  review_id,prepare,readiness_receipts,
  external_review_owner=false,authored_by_candidate=true,
}={}){
  const p=verifyRsiVerifierRootActivationPrepare(prepare);
  if(external_review_owner!==true||authored_by_candidate!==false)throw new Error('rsi_root_prepare_external_review_owner_required');
  if(!Array.isArray(readiness_receipts)||readiness_receipts.length!==DOMAINS.length)throw new Error('rsi_root_prepare_all_readiness_receipts_required');
  const rows=readiness_receipts.map(row=>verifyRsiVerifierRootActivationReadinessReceipt(row,{prepare:p}))
    .sort((a,b)=>a.readiness_domain.localeCompare(b.readiness_domain));
  const domains=rows.map(x=>x.readiness_domain);
  if(JSON.stringify(domains)!==JSON.stringify(DOMAINS))throw new Error('rsi_root_prepare_readiness_coverage_invalid');
  if(new Set(rows.map(x=>x.receipt_digest)).size!==rows.length)throw new Error('rsi_root_prepare_duplicate_readiness_receipt');
  const allReady=rows.every(x=>x.overall_pass===true);
  const state=allReady?'PREPARED_FOR_EXTERNAL_ROOT_ACTIVATION_COMMIT_REVIEW':'REJECTED_ROOT_ACTIVATION_PREPARE';
  const core={
    schema:RSI_VERIFIER_ROOT_ACTIVATION_PREPARE_REVIEW_SCHEMA,version:1,
    review_id:id(review_id,'review_id'),
    source_sha:p.source_sha,
    prepare_digest:p.prepare_digest,
    staging_review_digest:p.staging_review_digest,
    staging_bundle_digest:p.staging_bundle_digest,
    current_root_generation:p.current_root_generation,
    prepared_root_generation:p.prepared_root_generation,
    predecessor_verifier_root_digest:p.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:p.candidate_verifier_root_digest,
    next_root_history_digest:p.next_root_history_digest,
    readiness_domains:DOMAINS,
    readiness_receipt_digests:Object.freeze(rows.map(x=>x.receipt_digest)),
    all_readiness_domains_pass:allReady,
    state,
    prepared_for_external_root_activation_commit_review:allReady,
    active_verifier_root_digest:p.predecessor_verifier_root_digest,
    candidate_role:'LEARNER_NON_AUTHORITATIVE',
    joint_trust_prepare_complete:allReady,
    candidate_can_vote:false,
    candidate_can_self_promote:false,
    predecessor_retirement_authorized:false,
    root_activation_commit_authorized:false,
    verifier_activation_authorized:false,
    activation_commit_token:null,
    external_commit_controller_required:true,
    review_is_activation_authority:false,
    external_review_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,review_digest:dg(core)});
}

export function verifyRsiVerifierRootActivationPrepareReview(row,{prepare,readiness_receipts}={}){
  const r=verifyDigestObject(row,RSI_VERIFIER_ROOT_ACTIVATION_PREPARE_REVIEW_SCHEMA,'review_digest','review');
  const canonical=createRsiVerifierRootActivationPrepareReview({
    review_id:r.review_id,prepare,readiness_receipts,external_review_owner:true,authored_by_candidate:false,
  });
  if(canonical.review_digest!==r.review_digest)throw new Error('rsi_root_prepare_review_mismatch');
  return canonical;
}

export function rsiVerifierRootActivationPrepareTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.verifier-root-activation-prepare-root.v1',version:1,
    phase24_staging_review_required:true,
    mode:'JOINT_TRUST_PREPARE',
    candidate_role:'LEARNER_NON_AUTHORITATIVE',
    required_readiness_domains:DOMAINS,
    required_checks:REQUIRED_CHECKS,
    all_readiness_domains_required:true,
    predecessor_must_remain_active:true,
    joint_old_new_validation_required:true,
    candidate_catchup_required:true,
    rollback_path_required:true,
    root_history_freshness_required:true,
    incident_free_required:true,
    no_pending_effect_required:true,
    candidate_can_vote:false,
    candidate_can_self_promote:false,
    predecessor_retirement_authorized:false,
    root_activation_commit_authorized:false,
    verifier_activation_authorized:false,
    external_commit_controller_required:true,
    existing_runtime_ledger_is_only_prepare_review_receipt_plane:true,
    second_scheduler_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,root_activation_prepare_root_digest:dg(root)});
}
