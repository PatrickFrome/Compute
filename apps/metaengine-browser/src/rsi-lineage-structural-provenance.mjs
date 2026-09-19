import crypto from 'node:crypto';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';

export const RSI_LINEAGE_BUILD_RECEIPT_SCHEMA='metaengine.rsi.lineage-build-receipt.v1';
export const RSI_LINEAGE_STRUCTURAL_PROVENANCE_SCHEMA='metaengine.rsi.lineage-structural-provenance.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_lineage_provenance_${label}_sha_invalid`);return out;}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_lineage_provenance_${label}_digest_invalid`);return out;}
function boundedId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_lineage_provenance_${label}_invalid`);return out;}
function assertFalse(value,label){if(value!==false)throw new Error(`rsi_lineage_provenance_${label}_must_be_false`);}
function zero(extra={}){
  return Object.freeze({
    ...extra,
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
  });
}

function entryFor(library,skillDigest){
  const skill=exactDigest(skillDigest,'skill');
  const entry=library.entries.find((row)=>row.skill_digest===skill);
  if(!entry)throw new Error('rsi_lineage_provenance_skill_not_in_library');
  return entry;
}

function componentRoot(capsule){
  const rows=[...capsule.components]
    .map((row)=>({
      component_id:row.component_id,
      artifact_digest:row.artifact_digest,
      kind:row.kind,
    }))
    .sort((a,b)=>a.component_id.localeCompare(b.component_id)
      ||a.artifact_digest.localeCompare(b.artifact_digest)
      ||a.kind.localeCompare(b.kind));
  return digest(rows);
}

function parentMaterial(capsule){
  return capsule.parent_skill_digest==null?null:exactDigest(capsule.parent_skill_digest,'parent_material');
}

export function createRsiLineageBuildReceipt({
  receipt_id,
  subject_skill_digest,
  source_candidate_sha,
  implementation_digest,
  component_root_digest,
  parent_material_skill_digest=null,
  material_manifest_digest,
  product_manifest_digest,
  build_recipe_digest,
  builder_identity_digest,
  external_builder=false,
  authored_by_candidate=true,
}={}){
  if(external_builder!==true||authored_by_candidate!==false){
    throw new Error('rsi_lineage_provenance_external_builder_required');
  }
  const core=zero({
    schema:RSI_LINEAGE_BUILD_RECEIPT_SCHEMA,
    version:1,
    receipt_id:boundedId(receipt_id,'receipt_id'),
    subject_skill_digest:exactDigest(subject_skill_digest,'subject_skill'),
    source_candidate_sha:exactSha(source_candidate_sha,'source_candidate'),
    implementation_digest:exactDigest(implementation_digest,'implementation'),
    component_root_digest:exactDigest(component_root_digest,'component_root'),
    parent_material_skill_digest:parent_material_skill_digest==null?null:exactDigest(parent_material_skill_digest,'parent_material'),
    material_manifest_digest:exactDigest(material_manifest_digest,'material_manifest'),
    product_manifest_digest:exactDigest(product_manifest_digest,'product_manifest'),
    build_recipe_digest:exactDigest(build_recipe_digest,'build_recipe'),
    builder_identity_digest:exactDigest(builder_identity_digest,'builder_identity'),
    external_builder:true,
    authored_by_candidate:false,
    candidate_can_edit_receipt:false,
    receipt_is_effect_authority:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiLineageBuildReceipt(receipt){
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)
    ||receipt.schema!==RSI_LINEAGE_BUILD_RECEIPT_SCHEMA||receipt.version!==1){
    throw new Error('rsi_lineage_provenance_build_receipt_invalid');
  }
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','signing_authority','automatic_retry_allowed','authority_effect']){
    assertFalse(receipt[field],`receipt_${field}`);
  }
  if(receipt.external_builder!==true||receipt.authored_by_candidate!==false
    ||receipt.candidate_can_edit_receipt!==false||receipt.receipt_is_effect_authority!==false){
    throw new Error('rsi_lineage_provenance_build_receipt_policy_invalid');
  }
  const canonical=createRsiLineageBuildReceipt({
    receipt_id:receipt.receipt_id,
    subject_skill_digest:receipt.subject_skill_digest,
    source_candidate_sha:receipt.source_candidate_sha,
    implementation_digest:receipt.implementation_digest,
    component_root_digest:receipt.component_root_digest,
    parent_material_skill_digest:receipt.parent_material_skill_digest,
    material_manifest_digest:receipt.material_manifest_digest,
    product_manifest_digest:receipt.product_manifest_digest,
    build_recipe_digest:receipt.build_recipe_digest,
    builder_identity_digest:receipt.builder_identity_digest,
    external_builder:true,
    authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'receipt')){
    throw new Error('rsi_lineage_provenance_build_receipt_digest_mismatch');
  }
  return canonical;
}

export function createRsiLineageStructuralProvenance({
  attestation_id,
  library,
  skill_digest,
  build_receipt,
  expected_builder_identity_digest,
  expected_build_recipe_digest,
  expected_material_manifest_digest,
  provenance_reviewer_identity_digest,
  effect_executor_identity_digest,
  external_provenance_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_provenance_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_lineage_provenance_external_owner_required');
  }
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const entry=entryFor(checkedLibrary,skill_digest);
  const receipt=verifyRsiLineageBuildReceipt(build_receipt);
  const expectedBuilder=exactDigest(expected_builder_identity_digest,'expected_builder_identity');
  const expectedRecipe=exactDigest(expected_build_recipe_digest,'expected_build_recipe');
  const expectedMaterials=exactDigest(expected_material_manifest_digest,'expected_material_manifest');
  const reviewer=exactDigest(provenance_reviewer_identity_digest,'provenance_reviewer_identity');
  const effectExecutor=exactDigest(effect_executor_identity_digest,'effect_executor_identity');
  if(reviewer===effectExecutor||reviewer===expectedBuilder){
    throw new Error('rsi_lineage_provenance_reviewer_separation_required');
  }

  const expectedComponentRoot=componentRoot(entry.capsule);
  const expectedParent=parentMaterial(entry.capsule);
  const checks=Object.freeze({
    subject_skill_match:receipt.subject_skill_digest===entry.skill_digest,
    source_candidate_match:receipt.source_candidate_sha===entry.capsule.source_candidate_sha,
    implementation_match:receipt.implementation_digest===entry.capsule.implementation_digest,
    component_root_match:receipt.component_root_digest===expectedComponentRoot,
    parent_material_match:receipt.parent_material_skill_digest===expectedParent,
    builder_identity_match:receipt.builder_identity_digest===expectedBuilder,
    build_recipe_match:receipt.build_recipe_digest===expectedRecipe,
    material_manifest_match:receipt.material_manifest_digest===expectedMaterials,
  });
  const blockers=[];
  for(const [key,pass] of Object.entries(checks)){
    if(!pass)blockers.push(key.toUpperCase());
  }
  const provenanceState=blockers.length===0?'PASS':'FAIL';
  const core=zero({
    schema:RSI_LINEAGE_STRUCTURAL_PROVENANCE_SCHEMA,
    version:1,
    attestation_id:boundedId(attestation_id,'attestation_id'),
    library_digest:checkedLibrary.library_digest,
    skill_digest:entry.skill_digest,
    source_candidate_sha:entry.capsule.source_candidate_sha,
    implementation_digest:entry.capsule.implementation_digest,
    component_root_digest:expectedComponentRoot,
    parent_material_skill_digest:expectedParent,
    build_receipt_digest:receipt.receipt_digest,
    expected_builder_identity_digest:expectedBuilder,
    expected_build_recipe_digest:expectedRecipe,
    expected_material_manifest_digest:expectedMaterials,
    provenance_reviewer_identity_digest:reviewer,
    effect_executor_identity_digest:effectExecutor,
    checks,
    blockers:Object.freeze(blockers.sort()),
    provenance_integrity_state:provenanceState,
    structurally_verified:provenanceState==='PASS',
    exact_subject_and_material_binding_required:true,
    builder_identity_bound_to_external_expectation:true,
    build_recipe_bound_to_external_expectation:true,
    material_manifest_bound_to_external_expectation:true,
    provenance_is_structural_not_signature_authority:true,
    cryptographic_signature_verified:false,
    slsa_or_in_toto_compliance_claimed:false,
    external_provenance_owner:true,
    authored_by_candidate:false,
    candidate_can_author_attestation:false,
    attestation_is_effect_authority:false,
  });
  return Object.freeze({...core,attestation_digest:digest(core)});
}

export function verifyRsiLineageStructuralProvenance(attestation,args={}){
  if(!attestation||typeof attestation!=='object'||Array.isArray(attestation)
    ||attestation.schema!==RSI_LINEAGE_STRUCTURAL_PROVENANCE_SCHEMA||attestation.version!==1){
    throw new Error('rsi_lineage_provenance_attestation_invalid');
  }
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','signing_authority','automatic_retry_allowed','authority_effect']){
    assertFalse(attestation[field],`attestation_${field}`);
  }
  if(attestation.exact_subject_and_material_binding_required!==true
    ||attestation.builder_identity_bound_to_external_expectation!==true
    ||attestation.build_recipe_bound_to_external_expectation!==true
    ||attestation.material_manifest_bound_to_external_expectation!==true
    ||attestation.provenance_is_structural_not_signature_authority!==true
    ||attestation.cryptographic_signature_verified!==false
    ||attestation.slsa_or_in_toto_compliance_claimed!==false
    ||attestation.external_provenance_owner!==true
    ||attestation.authored_by_candidate!==false
    ||attestation.candidate_can_author_attestation!==false
    ||attestation.attestation_is_effect_authority!==false){
    throw new Error('rsi_lineage_provenance_attestation_policy_invalid');
  }
  const canonical=createRsiLineageStructuralProvenance({
    ...args,
    attestation_id:attestation.attestation_id,
    provenance_reviewer_identity_digest:attestation.provenance_reviewer_identity_digest,
    effect_executor_identity_digest:attestation.effect_executor_identity_digest,
    external_provenance_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.attestation_digest!==exactDigest(attestation.attestation_digest,'attestation')){
    throw new Error('rsi_lineage_provenance_attestation_digest_mismatch');
  }
  return canonical;
}

export function rsiLineageStructuralProvenanceTrustRootSnapshot(){
  const root=zero({
    schema:'metaengine.rsi.lineage-structural-provenance-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-lineage-structural-provenance.mjs',
    exact_library_subject_required:true,
    exact_source_candidate_required:true,
    exact_implementation_required:true,
    exact_component_root_required:true,
    exact_parent_material_required:true,
    external_expected_builder_required:true,
    external_expected_build_recipe_required:true,
    external_expected_material_manifest_required:true,
    provenance_reviewer_separate_from_builder_and_effect_executor:true,
    candidate_can_author_attestation:false,
    structural_attestation_is_not_signature_authority:true,
    slsa_or_in_toto_compliance_claimed:false,
    attestation_is_effect_authority:false,
  });
  return Object.freeze({...root,root_digest:digest(root)});
}

export function rsiLineageComponentRootForCapsule(capsule){
  return componentRoot(capsule);
}
