import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiRevisionLibraryAdmission,
  verifyRsiRevisionLibraryAdmission,
  rsiRevisionLibraryAdmissionTrustRootSnapshot,
} from '../src/rsi-revision-library-admission.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function skill({id='skill.library.parent',version=1,parent=null,source='b',impl='c',role='ANALYZER',capabilities=['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES']}={}){
  return createRsiSkillCapsule({
    skill_id:id,version,parent_skill_digest:parent,source_candidate_sha:source.repeat(40),role,
    input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(impl),
    components:[{component_id:`${id}.component.v${version}`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities,max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
}
function evidence(capsule,holdout='3'){
  return createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d(holdout),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:24,success_count:22,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${capsule.skill_id}_v${capsule.skill_version}`],
    external_evaluator:true,authored_by_candidate:false,
  });
}
function scopeAdmission(parent,successor){
  const core={
    schema:'metaengine.rsi.revision-scope-admission.v1',version:1,source_sha:SOURCE,
    admission_id:'revision.scope.library.1',
    reliability_binding_digest:d('7'),
    parent_skill_digest:parent.skill_digest,
    successor_skill_digest:successor.skill_digest,
    scope_candidate_digest:d('8'),
    compatibility_digest:d('9'),
    preservation_digest:d('a'),
    scope_result_digest:d('b'),
    target_scope_level:'FUNCTIONAL_SKILL',
    source_instance_count:2,
    source_preservation_verified:true,
    behavioral_integrity_verified:true,
    state:'ELIGIBLE_FOR_EXTERNAL_LIBRARY_EVIDENCE',
    eligible_for_external_library_evidence:true,
    prior_reliability_gate_required:true,
    exact_successor_skill_binding_required:true,
    cross_instance_replay_required:true,
    exact_capability_set_required:true,
    semantic_similarity_is_authority:false,
    model_mechanism_judgment_is_authority:false,
    external_library_evidence_still_required:true,
    direct_library_replacement_allowed:false,
    candidate_can_self_commit:false,
    admission_is_execution_authority:false,
    external_scope_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:dg(core)});
}
function fixture(){
  const parent=skill();
  const parentEvidence=evidence(parent,'3');
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.skill.library.admission',
    entries:[{capsule:parent,evidence:parentEvidence}],
    external_library_owner:true,authored_by_candidate:false,
  });
  const successor=skill({version:2,parent:parent.skill_digest,source:'c',impl:'d'});
  const successorEvidence=evidence(successor,'e');
  return {parent,parentEvidence,library,successor,successorEvidence,scope:scopeAdmission(parent,successor)};
}

test('scope-qualified successor becomes only an append-only proposed library update',()=>{
  const fx=fixture();
  const admission=createRsiRevisionLibraryAdmission({
    source_sha:SOURCE,admission_id:'revision.library.admission.1',
    scope_admission:fx.scope,current_library:fx.library,
    successor_skill:fx.successor,successor_evidence:fx.successorEvidence,
    sealed_library_holdout:true,external_library_owner:true,authored_by_candidate:false,
  });
  verifyRsiRevisionLibraryAdmission(admission,{
    scope_admission:fx.scope,current_library:fx.library,
    successor_skill:fx.successor,successor_evidence:fx.successorEvidence,
  });
  assert.equal(admission.parent_retained,true);
  assert.equal(admission.append_only_library_update,true);
  assert.equal(admission.proposed_library.entry_count,2);
  assert.ok(admission.proposed_library.entries.some(row=>row.skill_digest===fx.parent.skill_digest));
  assert.ok(admission.proposed_library.entries.some(row=>row.skill_digest===fx.successor.skill_digest));
  assert.equal(admission.candidate_can_replace_parent_in_place,false);
  assert.equal(admission.direct_browser_execution_authority,false);
  assert.equal(admission.authority_effect,false);
});

test('library admission requires a sealed external holdout and exact parent lineage',()=>{
  const fx=fixture();
  assert.throws(()=>createRsiRevisionLibraryAdmission({
    source_sha:SOURCE,admission_id:'revision.library.unsealed',
    scope_admission:fx.scope,current_library:fx.library,
    successor_skill:fx.successor,successor_evidence:fx.successorEvidence,
    sealed_library_holdout:false,external_library_owner:true,authored_by_candidate:false,
  }),/sealed_holdout_required/);

  const wrongParent=skill({version:2,parent:d('f'),source:'c',impl:'d'});
  const wrongEvidence=evidence(wrongParent,'e');
  const wrongScope=scopeAdmission(fx.parent,wrongParent);
  assert.throws(()=>createRsiRevisionLibraryAdmission({
    source_sha:SOURCE,admission_id:'revision.library.wrong-parent',
    scope_admission:wrongScope,current_library:fx.library,
    successor_skill:wrongParent,successor_evidence:wrongEvidence,
    sealed_library_holdout:true,external_library_owner:true,authored_by_candidate:false,
  }),/parent_lineage_mismatch/);
});

test('interface capability and version drift fail closed before proposed library creation',()=>{
  const fx=fixture();

  const capabilityDrift=skill({
    version:2,parent:fx.parent.skill_digest,source:'c',impl:'d',
    capabilities:['READ_VERIFIED_CONTEXT'],
  });
  assert.throws(()=>createRsiRevisionLibraryAdmission({
    source_sha:SOURCE,admission_id:'revision.library.capability-drift',
    scope_admission:scopeAdmission(fx.parent,capabilityDrift),current_library:fx.library,
    successor_skill:capabilityDrift,successor_evidence:evidence(capabilityDrift,'e'),
    sealed_library_holdout:true,external_library_owner:true,authored_by_candidate:false,
  }),/capability_drift/);

  const versionJump=skill({version:3,parent:fx.parent.skill_digest,source:'c',impl:'d'});
  assert.throws(()=>createRsiRevisionLibraryAdmission({
    source_sha:SOURCE,admission_id:'revision.library.version-jump',
    scope_admission:scopeAdmission(fx.parent,versionJump),current_library:fx.library,
    successor_skill:versionJump,successor_evidence:evidence(versionJump,'e'),
    sealed_library_holdout:true,external_library_owner:true,authored_by_candidate:false,
  }),/non_adjacent_version/);
});

test('tampered scope admission cannot authorize library growth',()=>{
  const fx=fixture();
  const tampered={...fx.scope,state:'ELIGIBLE_FOR_EXTERNAL_LIBRARY_EVIDENCE',source_preservation_verified:false};
  assert.throws(()=>createRsiRevisionLibraryAdmission({
    source_sha:SOURCE,admission_id:'revision.library.tampered',
    scope_admission:tampered,current_library:fx.library,
    successor_skill:fx.successor,successor_evidence:fx.successorEvidence,
    sealed_library_holdout:true,external_library_owner:true,authored_by_candidate:false,
  }),/scope_admission_digest_mismatch/);
});

test('library admission trust root keeps append-only evolution outside Browser authority',()=>{
  const root=rsiRevisionLibraryAdmissionTrustRootSnapshot();
  assert.equal(root.prior_scope_preservation_required,true);
  assert.equal(root.independent_external_skill_evidence_required,true);
  assert.equal(root.sealed_external_library_holdout_required,true);
  assert.equal(root.append_only_library_update,true);
  assert.equal(root.parent_retained,true);
  assert.equal(root.parent_activation_state_unchanged,true);
  assert.equal(root.candidate_can_read_library_holdout,false);
  assert.equal(root.candidate_can_self_certify_skill,false);
  assert.equal(root.candidate_can_replace_parent_in_place,false);
  assert.equal(root.direct_browser_execution_authority,false);
  assert.equal(root.admission_is_promotion_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.library_admission_root_digest,/^sha256:[0-9a-f]{64}$/);
});
