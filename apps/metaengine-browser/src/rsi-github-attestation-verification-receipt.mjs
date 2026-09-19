import crypto from 'node:crypto';

export const RSI_GITHUB_ATTESTATION_VERIFICATION_RECEIPT_SCHEMA='metaengine.rsi.github-attestation-verification-receipt.v1';
export const RSI_GITHUB_ATTESTATION_EXPECTED_REPOSITORY='PatrickFrome/Compute';
export const RSI_GITHUB_ATTESTATION_EXPECTED_ISSUER='https://token.actions.githubusercontent.com';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const WORKFLOW_RE=/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/;
const REF_RE=/^refs\/(heads|tags)\/[A-Za-z0-9._\/-]+$/;
const TYPE_URI_RE=/^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_github_attestation_${label}_sha_invalid`);return out;}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_github_attestation_${label}_digest_invalid`);return out;}
function boundedId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_github_attestation_${label}_invalid`);return out;}
function workflow(value){const out=String(value||'').trim();if(!WORKFLOW_RE.test(out))throw new Error('rsi_github_attestation_signer_workflow_invalid');return out;}
function sourceRef(value){const out=String(value||'').trim();if(!REF_RE.test(out)||out.includes('..')||out.includes('//'))throw new Error('rsi_github_attestation_source_ref_invalid');return out;}
function typeUri(value){const out=String(value||'').trim();if(!TYPE_URI_RE.test(out))throw new Error('rsi_github_attestation_predicate_type_invalid');return out;}
function assertFalse(value,label){if(value!==false)throw new Error(`rsi_github_attestation_${label}_must_be_false`);}

export function createRsiGithubAttestationVerificationReceipt({
  verification_id,
  subject_digest,
  provenance_bundle_digest,
  structural_attestation_digest,
  repository,
  signer_workflow,
  signer_digest,
  source_ref,
  source_digest,
  cert_oidc_issuer,
  predicate_type,
  trusted_root_digest,
  verification_json_digest,
  verification_result_count,
  gh_attestation_verify_executed=false,
  signature_verified=false,
  signer_identity_verified=false,
  subject_digest_verified=false,
  trusted_root_verified=false,
  deny_self_hosted_runners=false,
  external_attestation_verifier=false,
  authored_by_candidate=true,
}={}){
  if(external_attestation_verifier!==true||authored_by_candidate!==false){
    throw new Error('rsi_github_attestation_external_verifier_required');
  }
  if(repository!==RSI_GITHUB_ATTESTATION_EXPECTED_REPOSITORY){
    throw new Error('rsi_github_attestation_repository_mismatch');
  }
  if(String(cert_oidc_issuer||'')!==RSI_GITHUB_ATTESTATION_EXPECTED_ISSUER){
    throw new Error('rsi_github_attestation_oidc_issuer_mismatch');
  }
  const signerSha=exactSha(signer_digest,'signer');
  const sourceSha=exactSha(source_digest,'source');
  if(signerSha!==sourceSha)throw new Error('rsi_github_attestation_signer_source_digest_mismatch');
  if(gh_attestation_verify_executed!==true
    ||signature_verified!==true
    ||signer_identity_verified!==true
    ||subject_digest_verified!==true
    ||trusted_root_verified!==true
    ||deny_self_hosted_runners!==true){
    throw new Error('rsi_github_attestation_external_verification_incomplete');
  }
  if(Number(verification_result_count)!==1){
    throw new Error('rsi_github_attestation_verification_result_count_invalid');
  }

  const core={
    schema:RSI_GITHUB_ATTESTATION_VERIFICATION_RECEIPT_SCHEMA,
    version:1,
    verification_id:boundedId(verification_id,'verification_id'),
    subject_digest:exactDigest(subject_digest,'subject'),
    provenance_bundle_digest:exactDigest(provenance_bundle_digest,'provenance_bundle'),
    structural_attestation_digest:exactDigest(structural_attestation_digest,'structural_attestation'),
    repository:RSI_GITHUB_ATTESTATION_EXPECTED_REPOSITORY,
    signer_workflow:workflow(signer_workflow),
    signer_digest:signerSha,
    source_ref:sourceRef(source_ref),
    source_digest:sourceSha,
    cert_oidc_issuer:RSI_GITHUB_ATTESTATION_EXPECTED_ISSUER,
    predicate_type:typeUri(predicate_type),
    trusted_root_digest:exactDigest(trusted_root_digest,'trusted_root'),
    verification_json_digest:exactDigest(verification_json_digest,'verification_json'),
    verification_result_count:1,
    gh_attestation_verify_executed:true,
    signature_verified:true,
    signer_identity_verified:true,
    subject_digest_verified:true,
    trusted_root_verified:true,
    deny_self_hosted_runners:true,
    external_attestation_verifier:true,
    authored_by_candidate:false,
    verification_receipt_is_effect_authority:false,
    verification_receipt_is_semantic_acceptance:false,
    provenance_does_not_imply_safety:true,
    cryptographic_verification_delegated_to_existing_github_attestation_gate:true,
    this_module_does_not_verify_signature_bytes:true,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    scheduler_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiGithubAttestationVerificationReceipt(receipt){
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)
    ||receipt.schema!==RSI_GITHUB_ATTESTATION_VERIFICATION_RECEIPT_SCHEMA||receipt.version!==1){
    throw new Error('rsi_github_attestation_receipt_invalid');
  }
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','signing_authority','automatic_retry_allowed','authority_effect']){
    assertFalse(receipt[field],field);
  }
  if(receipt.verification_receipt_is_effect_authority!==false
    ||receipt.verification_receipt_is_semantic_acceptance!==false
    ||receipt.provenance_does_not_imply_safety!==true
    ||receipt.cryptographic_verification_delegated_to_existing_github_attestation_gate!==true
    ||receipt.this_module_does_not_verify_signature_bytes!==true){
    throw new Error('rsi_github_attestation_receipt_policy_invalid');
  }
  const canonical=createRsiGithubAttestationVerificationReceipt({
    verification_id:receipt.verification_id,
    subject_digest:receipt.subject_digest,
    provenance_bundle_digest:receipt.provenance_bundle_digest,
    structural_attestation_digest:receipt.structural_attestation_digest,
    repository:receipt.repository,
    signer_workflow:receipt.signer_workflow,
    signer_digest:receipt.signer_digest,
    source_ref:receipt.source_ref,
    source_digest:receipt.source_digest,
    cert_oidc_issuer:receipt.cert_oidc_issuer,
    predicate_type:receipt.predicate_type,
    trusted_root_digest:receipt.trusted_root_digest,
    verification_json_digest:receipt.verification_json_digest,
    verification_result_count:receipt.verification_result_count,
    gh_attestation_verify_executed:receipt.gh_attestation_verify_executed,
    signature_verified:receipt.signature_verified,
    signer_identity_verified:receipt.signer_identity_verified,
    subject_digest_verified:receipt.subject_digest_verified,
    trusted_root_verified:receipt.trusted_root_verified,
    deny_self_hosted_runners:receipt.deny_self_hosted_runners,
    external_attestation_verifier:true,
    authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'receipt')){
    throw new Error('rsi_github_attestation_receipt_digest_mismatch');
  }
  return canonical;
}

export function rsiGithubAttestationVerificationReceiptTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.github-attestation-verification-receipt-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-github-attestation-verification-receipt.mjs',
    existing_github_attestation_plane_reused:true,
    second_signing_authority_created:false,
    expected_repository:RSI_GITHUB_ATTESTATION_EXPECTED_REPOSITORY,
    expected_oidc_issuer:RSI_GITHUB_ATTESTATION_EXPECTED_ISSUER,
    exact_signer_workflow_required:true,
    exact_signer_digest_required:true,
    exact_source_ref_and_digest_required:true,
    custom_predicate_type_required:true,
    fresh_trusted_root_digest_required:true,
    deny_self_hosted_runners_required:true,
    exactly_one_verification_result_required:true,
    signature_and_signer_identity_verification_required:true,
    subject_digest_verification_required:true,
    provenance_does_not_imply_safety:true,
    this_module_does_not_verify_signature_bytes:true,
    browser_identity_signer_reused_for_arbitrary_rsi_signing:false,
    verification_receipt_is_effect_authority:false,
    execution_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,root_digest:digest(root)});
}
