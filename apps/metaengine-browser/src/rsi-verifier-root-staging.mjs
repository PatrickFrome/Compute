import crypto from 'node:crypto';

import {
  verifyRsiVerifierRootChangeProposal,
  verifyRsiVerifierRootChangeApproval,
  verifyRsiVerifierRootChangeReview,
} from './rsi-verifier-root-change-review.mjs';

export const RSI_VERIFIER_ROOT_STAGING_MANIFEST_SCHEMA='metaengine.rsi.verifier-root-staging-manifest.v1';
export const RSI_VERIFIER_ROOT_PROPAGATION_RECEIPT_SCHEMA='metaengine.rsi.verifier-root-propagation-receipt.v1';
export const RSI_VERIFIER_ROOT_STAGING_REVIEW_SCHEMA='metaengine.rsi.verifier-root-staging-review.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const DOMAINS=Object.freeze(['PROMOTION','RUNTIME','TOURNAMENT']);

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactDigest(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA256_RE.test(x))throw new Error(`rsi_root_staging_${l}_digest_invalid`);
  return x;
}
function id(v,l){
  const x=String(v||'').trim();
  if(!SAFE_ID_RE.test(x))throw new Error(`rsi_root_staging_${l}_invalid`);
  return x;
}
function positiveInt(v,l){
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_root_staging_${l}_invalid`);
  return n;
}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_root_staging_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_root_staging_${l}_retry_invalid`);
}
function verifyDigestObject(row,schema,digestField,label){
  if(!row||row.schema!==schema||row.version!==1)throw new Error(`rsi_root_staging_${label}_invalid`);
  assertZero(row,label);
  const clone=structuredClone(row);delete clone[digestField];
  if(dg(clone)!==exactDigest(row[digestField],label))throw new Error(`rsi_root_staging_${label}_digest_mismatch`);
  return Object.freeze(structuredClone(row));
}
function rootChangeBundle({review,proposal,predecessor_approval,secondary_approval}={}){
  const p=verifyRsiVerifierRootChangeProposal(proposal);
  const predecessor=verifyRsiVerifierRootChangeApproval(predecessor_approval,{proposal:p});
  const secondary=verifyRsiVerifierRootChangeApproval(secondary_approval,{proposal:p});
  const r=verifyRsiVerifierRootChangeReview(review,{
    proposal:p,predecessor_approval:predecessor,secondary_approval:secondary,
  });
  if(r.state!=='READY_FOR_EXTERNAL_TRUST_ROOT_CONTROLLER_REVIEW'||r.ready_for_external_trust_root_controller_review!==true){
    throw new Error('rsi_root_staging_root_change_review_not_ready');
  }
  return Object.freeze({proposal:p,review:r,predecessor_approval:predecessor,secondary_approval:secondary});
}
function validatorRoots(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('rsi_root_staging_validator_roots_invalid');
  const keys=Object.keys(value).sort();
  if(keys.length!==DOMAINS.length||keys.some((x,i)=>x!==DOMAINS[i]))throw new Error('rsi_root_staging_validator_domains_invalid');
  return Object.freeze(Object.fromEntries(DOMAINS.map(domain=>[domain,exactDigest(value[domain],`validator_${domain.toLowerCase()}`)])));
}

export function createRsiVerifierRootStagingManifest({
  staging_id,
  review,
  proposal,
  predecessor_approval,
  secondary_approval,
  validator_roots,
  external_staging_owner=false,
  authored_by_candidate=true,
}={}){
  const bundle=rootChangeBundle({review,proposal,predecessor_approval,secondary_approval});
  if(external_staging_owner!==true||authored_by_candidate!==false)throw new Error('rsi_root_staging_external_owner_required');
  const roots=validatorRoots(validator_roots);
  const orderedOverlap=Object.freeze([
    bundle.review.predecessor_verifier_root_digest,
    bundle.review.candidate_verifier_root_digest,
  ].sort());
  const bundleCore={
    bundle_generation:bundle.review.next_root_generation,
    active_verifier_root_digest:bundle.review.predecessor_verifier_root_digest,
    staged_candidate_root_digest:bundle.review.candidate_verifier_root_digest,
    overlap_root_digests:orderedOverlap,
    root_history_digest:bundle.review.next_root_history_digest,
    constitution_digest:bundle.review.constitution_digest,
  };
  const stagingBundleDigest=dg(bundleCore);
  const core={
    schema:RSI_VERIFIER_ROOT_STAGING_MANIFEST_SCHEMA,version:1,
    staging_id:id(staging_id,'staging_id'),
    source_sha:bundle.review.source_sha,
    root_change_review_digest:bundle.review.review_digest,
    root_change_proposal_digest:bundle.review.proposal_digest,
    qualification_digest:bundle.review.qualification_digest,
    constitution_digest:bundle.review.constitution_digest,
    current_root_generation:positiveInt(bundle.review.current_root_generation,'current_generation'),
    staging_bundle_generation:positiveInt(bundle.review.next_root_generation,'staging_generation'),
    predecessor_verifier_root_digest:bundle.review.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:bundle.review.candidate_verifier_root_digest,
    secondary_verifier_root_digest:bundle.review.secondary_verifier_root_digest,
    prior_root_history_digest:bundle.review.prior_root_history_digest,
    next_root_history_digest:bundle.review.next_root_history_digest,
    overlap_root_digests:orderedOverlap,
    active_verifier_root_digest:bundle.review.predecessor_verifier_root_digest,
    staged_candidate_root_digest:bundle.review.candidate_verifier_root_digest,
    staging_bundle_digest:stagingBundleDigest,
    required_validator_domains:DOMAINS,
    validator_roots:roots,
    overlap_mode:'PREDECESSOR_ACTIVE_CANDIDATE_STAGED',
    predecessor_must_remain_active:true,
    candidate_must_be_preloaded_before_activation:true,
    candidate_only_bundle_forbidden:true,
    predecessor_retirement_authorized:false,
    root_change_authorized:false,
    verifier_activation_authorized:false,
    staging_write_authorized:false,
    external_staging_controller_required:true,
    propagation_readback_required:true,
    candidate_can_choose_validator_domains:false,
    candidate_can_choose_validator_roots:false,
    candidate_can_change_overlap:false,
    external_staging_owner:true,
    authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,manifest_digest:dg(core)});
}

export function verifyRsiVerifierRootStagingManifest(row){
  const m=verifyDigestObject(row,RSI_VERIFIER_ROOT_STAGING_MANIFEST_SCHEMA,'manifest_digest','manifest');
  if(
    m.staging_bundle_generation!==m.current_root_generation+1
    ||m.overlap_mode!=='PREDECESSOR_ACTIVE_CANDIDATE_STAGED'
    ||m.predecessor_must_remain_active!==true
    ||m.active_verifier_root_digest!==m.predecessor_verifier_root_digest
    ||m.staged_candidate_root_digest!==m.candidate_verifier_root_digest
    ||m.candidate_must_be_preloaded_before_activation!==true
    ||m.candidate_only_bundle_forbidden!==true
    ||m.predecessor_retirement_authorized!==false
    ||m.root_change_authorized!==false
    ||m.verifier_activation_authorized!==false
    ||m.staging_write_authorized!==false
    ||m.external_staging_controller_required!==true
    ||m.propagation_readback_required!==true
    ||m.candidate_can_choose_validator_domains!==false
    ||m.candidate_can_choose_validator_roots!==false
    ||m.candidate_can_change_overlap!==false
    ||m.external_staging_owner!==true
    ||m.authored_by_candidate!==false
  )throw new Error('rsi_root_staging_manifest_policy_invalid');
  const overlap=[m.predecessor_verifier_root_digest,m.candidate_verifier_root_digest].sort();
  if(JSON.stringify(m.overlap_root_digests)!==JSON.stringify(overlap))throw new Error('rsi_root_staging_overlap_invalid');
  const expectedBundle=dg({
    bundle_generation:m.staging_bundle_generation,
    active_verifier_root_digest:m.active_verifier_root_digest,
    staged_candidate_root_digest:m.staged_candidate_root_digest,
    overlap_root_digests:m.overlap_root_digests,
    root_history_digest:observedHistory,
    constitution_digest:m.constitution_digest,
  });
  if(expectedBundle!==m.staging_bundle_digest)throw new Error('rsi_root_staging_bundle_digest_mismatch');
  validatorRoots(m.validator_roots);
  return m;
}

export function createRsiVerifierRootPropagationReceipt({
  receipt_id,
  manifest,
  validator_domain,
  validator_root_digest,
  observed_bundle_generation,
  observed_staging_bundle_digest,
  observed_active_verifier_root_digest,
  observed_root_digests,
  root_history_digest,
  readback_evidence_digest,
  evidence_refs,
  external_validator=false,
  authored_by_candidate=true,
}={}){
  const m=verifyRsiVerifierRootStagingManifest(manifest);
  if(external_validator!==true||authored_by_candidate!==false)throw new Error('rsi_root_staging_external_validator_required');
  const domain=String(validator_domain||'').trim().toUpperCase();
  if(!DOMAINS.includes(domain))throw new Error('rsi_root_staging_validator_domain_invalid');
  const root=exactDigest(validator_root_digest,'validator_root');
  if(root!==m.validator_roots[domain])throw new Error('rsi_root_staging_validator_root_mismatch');
  const generation=positiveInt(observed_bundle_generation,'observed_generation');
  const observedBundle=exactDigest(observed_staging_bundle_digest,'observed_bundle');
  const observedActive=exactDigest(observed_active_verifier_root_digest,'observed_active');
  const observedHistory=exactDigest(root_history_digest,'root_history');
  const observedRoots=Array.isArray(observed_root_digests)?[...new Set(observed_root_digests.map(x=>exactDigest(x,'observed_root')))].sort():[];
  if(observedRoots.length!==2)throw new Error('rsi_root_staging_overlap_readback_required');
  const expectedRoots=[m.predecessor_verifier_root_digest,m.candidate_verifier_root_digest].sort();
  const overlapMatch=JSON.stringify(observedRoots)===JSON.stringify(expectedRoots);
  const generationMatch=generation===m.staging_bundle_generation;
  const bundleMatch=observedBundle===m.staging_bundle_digest;
  const activeMatch=observedActive===m.predecessor_verifier_root_digest;
  const historyMatch=observedHistory===m.next_root_history_digest;
  const propagated=generationMatch&&bundleMatch&&activeMatch&&overlapMatch&&historyMatch;
  const refs=Array.isArray(evidence_refs)?[...new Set(evidence_refs.map(x=>id(x,'evidence_ref')))].sort():[];
  if(refs.length<1||refs.length!==evidence_refs.length)throw new Error('rsi_root_staging_evidence_refs_invalid');
  const core={
    schema:RSI_VERIFIER_ROOT_PROPAGATION_RECEIPT_SCHEMA,version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:m.source_sha,
    manifest_digest:m.manifest_digest,
    staging_id:m.staging_id,
    validator_domain:domain,
    validator_root_digest:root,
    observed_bundle_generation:generation,
    observed_staging_bundle_digest:observedBundle,
    observed_active_verifier_root_digest:observedActive,
    observed_root_digests:Object.freeze(observedRoots),
    root_history_digest:m.next_root_history_digest,
    generation_match:generationMatch,bundle_match:bundleMatch,active_root_match:activeMatch,
    overlap_roots_match:overlapMatch,root_history_match:historyMatch,
    propagation_verified:propagated,
    candidate_root_preloaded:overlapMatch,
    predecessor_remains_active:activeMatch,
    readback_evidence_digest:exactDigest(readback_evidence_digest,'readback_evidence'),
    evidence_refs:Object.freeze(refs),
    readback_source:'EXTERNAL_VALIDATOR_READBACK',
    candidate_can_author_readback:false,
    receipt_is_root_activation_authority:false,
    external_validator:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:dg(core)});
}

export function verifyRsiVerifierRootPropagationReceipt(row,{manifest}={}){
  const m=verifyRsiVerifierRootStagingManifest(manifest);
  const r=verifyDigestObject(row,RSI_VERIFIER_ROOT_PROPAGATION_RECEIPT_SCHEMA,'receipt_digest','receipt');
  if(
    r.manifest_digest!==m.manifest_digest
    ||r.source_sha!==m.source_sha
    ||r.staging_id!==m.staging_id
    ||!DOMAINS.includes(r.validator_domain)
    ||r.validator_root_digest!==m.validator_roots[r.validator_domain]
    ||r.readback_source!=='EXTERNAL_VALIDATOR_READBACK'
    ||r.candidate_can_author_readback!==false
    ||r.receipt_is_root_activation_authority!==false
    ||r.external_validator!==true||r.authored_by_candidate!==false
  )throw new Error('rsi_root_staging_receipt_policy_invalid');
  const expectedRoots=[m.predecessor_verifier_root_digest,m.candidate_verifier_root_digest].sort();
  const expectedPass=
    r.observed_bundle_generation===m.staging_bundle_generation
    &&r.observed_staging_bundle_digest===m.staging_bundle_digest
    &&r.observed_active_verifier_root_digest===m.predecessor_verifier_root_digest
    &&JSON.stringify(r.observed_root_digests)===JSON.stringify(expectedRoots)
    &&r.root_history_digest===m.next_root_history_digest;
  if(r.propagation_verified!==expectedPass)throw new Error('rsi_root_staging_receipt_pass_mismatch');
  return r;
}

export function createRsiVerifierRootStagingReview({
  review_id,manifest,propagation_receipts,
  external_review_owner=false,authored_by_candidate=true,
}={}){
  const m=verifyRsiVerifierRootStagingManifest(manifest);
  if(external_review_owner!==true||authored_by_candidate!==false)throw new Error('rsi_root_staging_external_review_owner_required');
  if(!Array.isArray(propagation_receipts)||propagation_receipts.length!==DOMAINS.length)throw new Error('rsi_root_staging_all_domain_receipts_required');
  const rows=propagation_receipts.map(row=>verifyRsiVerifierRootPropagationReceipt(row,{manifest:m}))
    .sort((a,b)=>a.validator_domain.localeCompare(b.validator_domain));
  const domains=rows.map(x=>x.validator_domain);
  if(JSON.stringify(domains)!==JSON.stringify(DOMAINS))throw new Error('rsi_root_staging_domain_coverage_invalid');
  if(new Set(rows.map(x=>x.receipt_digest)).size!==rows.length)throw new Error('rsi_root_staging_duplicate_receipt');
  const allPropagated=rows.every(x=>x.propagation_verified===true);
  const state=allPropagated?'READY_FOR_EXTERNAL_ROOT_ACTIVATION_REVIEW':'REJECTED_ROOT_STAGING_PROPAGATION';
  const core={
    schema:RSI_VERIFIER_ROOT_STAGING_REVIEW_SCHEMA,version:1,
    review_id:id(review_id,'review_id'),
    source_sha:m.source_sha,
    manifest_digest:m.manifest_digest,
    root_change_review_digest:m.root_change_review_digest,
    current_root_generation:m.current_root_generation,
    staging_bundle_generation:m.staging_bundle_generation,
    predecessor_verifier_root_digest:m.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:m.candidate_verifier_root_digest,
    overlap_root_digests:m.overlap_root_digests,
    staging_bundle_digest:m.staging_bundle_digest,
    next_root_history_digest:m.next_root_history_digest,
    validator_domains:DOMAINS,
    propagation_receipt_digests:Object.freeze(rows.map(x=>x.receipt_digest)),
    all_validator_domains_propagated:allPropagated,
    state,
    ready_for_external_root_activation_review:allPropagated,
    active_verifier_root_digest:m.predecessor_verifier_root_digest,
    candidate_root_staged_only:true,
    overlap_must_remain_until_separate_activation:true,
    predecessor_retirement_authorized:false,
    root_change_authorized:false,
    verifier_activation_authorized:false,
    root_activation_token:null,
    external_activation_controller_required:true,
    review_is_root_activation_authority:false,
    external_review_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,review_digest:dg(core)});
}

export function verifyRsiVerifierRootStagingReview(row,{manifest,propagation_receipts}={}){
  const r=verifyDigestObject(row,RSI_VERIFIER_ROOT_STAGING_REVIEW_SCHEMA,'review_digest','review');
  const canonical=createRsiVerifierRootStagingReview({
    review_id:r.review_id,manifest,propagation_receipts,external_review_owner:true,authored_by_candidate:false,
  });
  if(canonical.review_digest!==r.review_digest)throw new Error('rsi_root_staging_review_mismatch');
  return canonical;
}

export function rsiVerifierRootStagingTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.verifier-root-staging-root.v1',version:1,
    phase23_root_change_review_required:true,
    required_validator_domains:DOMAINS,
    validator_domain_count:DOMAINS.length,
    overlap_bundle_required:true,
    predecessor_must_remain_active:true,
    candidate_root_must_be_preloaded:true,
    candidate_only_bundle_forbidden:true,
    monotonic_bundle_generation_required:true,
    root_history_continuity_required:true,
    external_validator_readback_required:true,
    all_validator_domains_required:true,
    predecessor_retirement_authorized:false,
    root_change_authorized:false,
    verifier_activation_authorized:false,
    external_activation_controller_required:true,
    existing_runtime_ledger_is_only_staging_review_receipt_plane:true,
    second_scheduler_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,root_staging_root_digest:dg(root)});
}
