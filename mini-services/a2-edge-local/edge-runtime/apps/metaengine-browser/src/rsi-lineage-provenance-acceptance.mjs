import crypto from 'node:crypto';

import { verifyRsiLineageStructuralProvenance } from './rsi-lineage-structural-provenance.mjs';
import { verifyRsiGithubAttestationVerificationReceipt } from './rsi-github-attestation-verification-receipt.mjs';

export const RSI_LINEAGE_PROVENANCE_ACCEPTANCE_SCHEMA='metaengine.rsi.lineage-provenance-acceptance.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_lineage_provenance_acceptance_${label}_digest_invalid`);return out;}
function boundedId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_lineage_provenance_acceptance_${label}_invalid`);return out;}
function assertFalse(value,label){if(value!==false)throw new Error(`rsi_lineage_provenance_acceptance_${label}_must_be_false`);}

export function createRsiLineageProvenanceAcceptance({
  acceptance_id,
  library,
  skill_digest,
  structural_attestation,
  github_verification_receipt=null,
  external_provenance_acceptor=false,
  authored_by_candidate=true,
}={}){
  if(external_provenance_acceptor!==true||authored_by_candidate!==false){
    throw new Error('rsi_lineage_provenance_acceptance_external_acceptor_required');
  }
  const structural=verifyRsiLineageStructuralProvenance(structural_attestation,{
    library,
    skill_digest,
  });

  let github=null;
  const blockers=[];
  let provenanceState='UNKNOWN';
  if(structural.provenance_integrity_state!=='PASS'){
    blockers.push('STRUCTURAL_PROVENANCE_FAILED');
    provenanceState='FAIL';
  }else if(github_verification_receipt==null){
    blockers.push('CRYPTOGRAPHIC_PROVENANCE_VERIFICATION_MISSING');
    provenanceState='UNKNOWN';
  }else{
    github=verifyRsiGithubAttestationVerificationReceipt(github_verification_receipt);
    if(github.structural_attestation_digest!==structural.attestation_digest){
      blockers.push('CRYPTOGRAPHIC_STRUCTURAL_ATTESTATION_BINDING_MISMATCH');
      provenanceState='FAIL';
    }else{
      provenanceState='PASS';
    }
  }

  const core={
    schema:RSI_LINEAGE_PROVENANCE_ACCEPTANCE_SCHEMA,
    version:1,
    acceptance_id:boundedId(acceptance_id,'acceptance_id'),
    skill_digest:exactDigest(structural.skill_digest,'skill'),
    library_digest:exactDigest(structural.library_digest,'library'),
    structural_attestation:structuredClone(structural),
    structural_attestation_digest:structural.attestation_digest,
    github_verification_receipt:github?structuredClone(github):null,
    github_verification_receipt_digest:github?github.receipt_digest:null,
    provenance_integrity_state:provenanceState,
    blockers:Object.freeze(blockers.sort()),
    structural_and_cryptographic_conjunction_required:true,
    structural_pass_required:true,
    external_github_attestation_verification_required:true,
    missing_cryptographic_proof_is_unknown_not_clean:true,
    cryptographic_binding_mismatch_is_failure:true,
    provenance_does_not_imply_semantic_or_security_acceptance:true,
    candidate_can_author_acceptance:false,
    acceptance_is_effect_authority:false,
    external_provenance_acceptor:true,
    authored_by_candidate:false,
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
  return Object.freeze({...core,acceptance_digest:digest(core)});
}

export function verifyRsiLineageProvenanceAcceptance(row,{library,skill_digest}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)
    ||row.schema!==RSI_LINEAGE_PROVENANCE_ACCEPTANCE_SCHEMA||row.version!==1){
    throw new Error('rsi_lineage_provenance_acceptance_invalid');
  }
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','signing_authority','automatic_retry_allowed','authority_effect']){
    assertFalse(row[field],field);
  }
  if(row.structural_and_cryptographic_conjunction_required!==true
    ||row.structural_pass_required!==true
    ||row.external_github_attestation_verification_required!==true
    ||row.missing_cryptographic_proof_is_unknown_not_clean!==true
    ||row.cryptographic_binding_mismatch_is_failure!==true
    ||row.provenance_does_not_imply_semantic_or_security_acceptance!==true
    ||row.candidate_can_author_acceptance!==false
    ||row.acceptance_is_effect_authority!==false
    ||row.external_provenance_acceptor!==true
    ||row.authored_by_candidate!==false){
    throw new Error('rsi_lineage_provenance_acceptance_policy_invalid');
  }
  const canonical=createRsiLineageProvenanceAcceptance({
    acceptance_id:row.acceptance_id,
    library,
    skill_digest,
    structural_attestation:row.structural_attestation,
    github_verification_receipt:row.github_verification_receipt,
    external_provenance_acceptor:true,
    authored_by_candidate:false,
  });
  if(canonical.acceptance_digest!==exactDigest(row.acceptance_digest,'acceptance')){
    throw new Error('rsi_lineage_provenance_acceptance_digest_mismatch');
  }
  return canonical;
}

export function rsiLineageProvenanceAcceptanceTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.lineage-provenance-acceptance-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-lineage-provenance-acceptance.mjs',
    structural_and_cryptographic_conjunction_required:true,
    structural_pass_required:true,
    existing_github_attestation_verification_required:true,
    missing_crypto_proof_maps_to_unknown:true,
    mismatched_crypto_binding_maps_to_failure:true,
    provenance_does_not_imply_semantic_or_security_acceptance:true,
    second_signing_authority_created:false,
    candidate_can_author_acceptance:false,
    acceptance_is_effect_authority:false,
    execution_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,root_digest:digest(root)});
}
