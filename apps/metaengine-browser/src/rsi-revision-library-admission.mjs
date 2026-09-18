import crypto from 'node:crypto';

import {
  createRsiVerifiedSkillLibrary,
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';

export const RSI_REVISION_LIBRARY_ADMISSION_SCHEMA='metaengine.rsi.revision-library-admission.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_revision_library_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_revision_library_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_revision_library_${l}_invalid`);return o}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_revision_library_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_revision_library_${l}_automatic_retry_invalid`);
}

function verifyScopeAdmission(admission){
  if(!admission||typeof admission!=='object'||Array.isArray(admission)||admission.schema!=='metaengine.rsi.revision-scope-admission.v1'||admission.version!==1){
    throw new Error('rsi_revision_library_scope_admission_invalid');
  }
  assertZero(admission,'scope_admission');
  const admissionDigest=exactDigest(admission.admission_digest,'scope_admission');
  const clone=structuredClone(admission);delete clone.admission_digest;
  if(digest(clone)!==admissionDigest)throw new Error('rsi_revision_library_scope_admission_digest_mismatch');
  if(admission.state!=='ELIGIBLE_FOR_EXTERNAL_LIBRARY_EVIDENCE'||admission.eligible_for_external_library_evidence!==true){
    throw new Error('rsi_revision_library_scope_admission_required');
  }
  if(admission.external_library_evidence_still_required!==true||admission.direct_library_replacement_allowed!==false
    ||admission.admission_is_execution_authority!==false){
    throw new Error('rsi_revision_library_scope_policy_invalid');
  }
  return admission;
}

export function createRsiRevisionLibraryAdmission({
  source_sha,
  admission_id,
  scope_admission,
  current_library,
  successor_skill,
  successor_evidence,
  sealed_library_holdout=false,
  external_library_owner=false,
  authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const scope=verifyScopeAdmission(scope_admission);
  if(scope.source_sha!==sourceSha)throw new Error('rsi_revision_library_source_mismatch');
  if(external_library_owner!==true||authored_by_candidate!==false)throw new Error('rsi_revision_library_external_owner_required');
  if(sealed_library_holdout!==true)throw new Error('rsi_revision_library_sealed_holdout_required');

  const library=verifyRsiVerifiedSkillLibrary(current_library);
  const skill=verifyRsiSkillCapsule(successor_skill);
  const evidence=verifyRsiSkillEvidence(successor_evidence,skill);
  if(skill.skill_digest!==scope.successor_skill_digest)throw new Error('rsi_revision_library_successor_skill_mismatch');
  if(evidence.verified_for_library!==true||evidence.hard_invariants_pass!==true)throw new Error('rsi_revision_library_external_evidence_not_verified');
  if(evidence.authored_by_candidate!==false||evidence.external_evaluator!==true)throw new Error('rsi_revision_library_external_evidence_origin_invalid');
  if(library.entries.some(row=>row.skill_digest===skill.skill_digest))throw new Error('rsi_revision_library_successor_already_present');
  if(library.entries.some(row=>row.skill_id===skill.skill_id&&row.skill_version===skill.skill_version))throw new Error('rsi_revision_library_version_conflict');

  const parent=library.entries.find(row=>row.skill_digest===scope.parent_skill_digest);
  if(!parent)throw new Error('rsi_revision_library_parent_missing');
  if(evidence.hidden_holdout_digest===parent.evidence.hidden_holdout_digest)throw new Error('rsi_revision_library_parent_holdout_reuse_forbidden');
  if(skill.parent_skill_digest!==parent.skill_digest)throw new Error('rsi_revision_library_parent_lineage_mismatch');
  if(skill.skill_id!==parent.skill_id)throw new Error('rsi_revision_library_skill_id_drift');
  if(skill.skill_version!==parent.skill_version+1)throw new Error('rsi_revision_library_non_adjacent_version');
  if(skill.role!==parent.role||skill.input_schema_digest!==parent.input_schema_digest||skill.output_schema_digest!==parent.output_schema_digest){
    throw new Error('rsi_revision_library_interface_drift');
  }
  if(JSON.stringify(skill.capabilities)!==JSON.stringify(parent.capabilities))throw new Error('rsi_revision_library_capability_drift');

  const proposedLibrary=createRsiVerifiedSkillLibrary({
    library_id:library.library_id,
    entries:[
      ...library.entries.map(row=>({capsule:row.capsule,evidence:row.evidence})),
      {capsule:skill,evidence},
    ],
    external_library_owner:true,
    authored_by_candidate:false,
  });

  const core={
    schema:RSI_REVISION_LIBRARY_ADMISSION_SCHEMA,version:1,
    source_sha:sourceSha,
    admission_id:boundedId(admission_id,'admission_id'),
    scope_admission_digest:scope.admission_digest,
    parent_skill_digest:parent.skill_digest,
    successor_skill_digest:skill.skill_digest,
    successor_evidence_digest:evidence.evidence_digest,
    current_library_id:library.library_id,
    current_library_digest:library.library_digest,
    proposed_library_digest:proposedLibrary.library_digest,
    proposed_library:proposedLibrary,
    append_only_library_update:true,
    parent_retained:true,
    parent_activation_state_unchanged:true,
    stable_versioning_required:true,
    exact_interface_preservation_required:true,
    exact_capability_preservation_required:true,
    sealed_external_library_holdout_required:true,
    successor_holdout_distinct_from_parent:true,
    candidate_can_read_library_holdout:false,
    candidate_can_self_certify_skill:false,
    candidate_can_replace_parent_in_place:false,
    direct_browser_execution_authority:false,
    admission_is_promotion_authority:false,
    external_library_owner:true,
    authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiRevisionLibraryAdmission(row,args={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_REVISION_LIBRARY_ADMISSION_SCHEMA||row.version!==1){
    throw new Error('rsi_revision_library_admission_invalid');
  }
  assertZero(row,'admission');
  if(row.append_only_library_update!==true||row.parent_retained!==true||row.parent_activation_state_unchanged!==true
    ||row.stable_versioning_required!==true||row.exact_interface_preservation_required!==true
    ||row.exact_capability_preservation_required!==true||row.sealed_external_library_holdout_required!==true
    ||row.successor_holdout_distinct_from_parent!==true
    ||row.candidate_can_read_library_holdout!==false||row.candidate_can_self_certify_skill!==false
    ||row.candidate_can_replace_parent_in_place!==false||row.direct_browser_execution_authority!==false
    ||row.admission_is_promotion_authority!==false||row.external_library_owner!==true||row.authored_by_candidate!==false){
    throw new Error('rsi_revision_library_admission_policy_invalid');
  }
  const canonical=createRsiRevisionLibraryAdmission({
    ...args,
    source_sha:row.source_sha,
    admission_id:row.admission_id,
    sealed_library_holdout:true,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.admission_digest!==exactDigest(row.admission_digest,'admission'))throw new Error('rsi_revision_library_admission_digest_mismatch');
  return canonical;
}

export function rsiRevisionLibraryAdmissionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.revision-library-admission-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-revision-library-admission.mjs',
    prior_scope_preservation_required:true,
    independent_external_skill_evidence_required:true,
    sealed_external_library_holdout_required:true,successor_holdout_distinct_from_parent:true,
    append_only_library_update:true,parent_retained:true,
    parent_activation_state_unchanged:true,stable_versioning_required:true,
    exact_interface_preservation_required:true,exact_capability_preservation_required:true,
    candidate_can_read_library_holdout:false,candidate_can_self_certify_skill:false,
    candidate_can_replace_parent_in_place:false,direct_browser_execution_authority:false,
    admission_is_promotion_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,library_admission_root_digest:digest(root)});
}
