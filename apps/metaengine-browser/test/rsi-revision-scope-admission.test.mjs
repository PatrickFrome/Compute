import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiSkillScopeUnit,
  createRsiSkillCompatibilityReceipt,
  createRsiSkillAbstractionCandidate,
  createRsiSkillScopePreservationReceipt,
  finalizeRsiSkillScopeExpansion,
} from '../src/rsi-skill-scope-expansion.mjs';
import {
  RsiRevisionScopeLedger,
  createRsiRevisionScopeAdmission,
  verifyRsiRevisionScopeAdmission,
  rsiRevisionScopeAdmissionTrustRootSnapshot,
} from '../src/rsi-revision-scope-admission.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function makeSkill({id,version=1,parent=null,source='b',impl='c'}){
  return createRsiSkillCapsule({
    skill_id:id,version,parent_skill_digest:parent,source_candidate_sha:source.repeat(40),
    role:'ANALYZER',input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(impl),
    components:[{component_id:`${id}.component.v${version}`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
}
function evidence(skill,mark){
  return createRsiSkillEvidence({
    capsule:skill,hidden_holdout_digest:d(mark),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:12,success_count:10,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${skill.skill_id}`],external_evaluator:true,authored_by_candidate:false,
  });
}
function reliabilityBinding(successor,parent){
  const core={
    schema:'metaengine.rsi.integrity-bound-skill-reliability.v1',version:1,
    source_sha:SOURCE,binding_id:'binding.scope.1',integrity_admission_digest:d('7'),
    integrity_state:'INTEGRITY_VERIFIED',parent_skill_digest:parent.skill_digest,
    successor_skill_digest:successor.skill_digest,
    revision:{schema:'opaque.test.revision.v1'},
    reliability_evaluation:{schema:'opaque.test.reliability-eval.v1',reliability_gate_pass:true},
    reliability_result:{schema:'opaque.test.reliability-result.v1',state:'ELIGIBLE_FOR_V126_SCOPE_PRESERVATION'},
    hidden_repeated_trial_set_digest:d('8'),
    hidden_trial_distinct_from_curation_and_integrity_holdouts:true,
    integrity_admission_required:true,repeated_trial_consistency_required:true,limit_awareness_required:true,
    pass_any_alone_is_not_sufficient:true,eligible_for_existing_scope_preservation_gate:true,
    state:'ELIGIBLE_FOR_EXISTING_SCOPE_PRESERVATION_GATE',
    existing_scope_preservation_gate_required:true,existing_external_library_evidence_required:true,
    direct_library_replacement_allowed:false,self_authored_reliability_sufficient:false,
    candidate_can_self_certify_reliability:false,binding_is_execution_authority:false,
    external_curator:true,external_evaluator:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,binding_digest:dg(core)});
}
function scopeFixture(){
  const sourceA=makeSkill({id:'skill.scope.source.a',source:'b',impl:'b'});
  const sourceB=makeSkill({id:'skill.scope.source.b',source:'c',impl:'c'});
  const sourceAEvidence=evidence(sourceA,'9');
  const sourceBEvidence=evidence(sourceB,'a');
  const parent=makeSkill({id:'skill.scope.parent',source:'d',impl:'d'});
  const successor=makeSkill({id:'skill.scope.parent',version:2,parent:parent.skill_digest,source:'e',impl:'e'});
  const units=[
    createRsiSkillScopeUnit({
      unit_id:'scope.unit.a',skill:sourceA,evidence:sourceAEvidence,scope_level:'INSTANCE_PATCH',
      validated_instance_digests:[d('b')],mechanism_signature_digest:d('c'),evidence_refs:['scope:unit:a'],
      external_scope_owner:true,authored_by_candidate:false,
    }),
    createRsiSkillScopeUnit({
      unit_id:'scope.unit.b',skill:sourceB,evidence:sourceBEvidence,scope_level:'INSTANCE_PATCH',
      validated_instance_digests:[d('d')],mechanism_signature_digest:d('c'),evidence_refs:['scope:unit:b'],
      external_scope_owner:true,authored_by_candidate:false,
    }),
  ];
  const compatibility=createRsiSkillCompatibilityReceipt({
    compatibility_id:'scope.compatibility.1',units,
    directed_cross_replays:[
      {source_unit_id:'scope.unit.a',target_unit_id:'scope.unit.b',success:true,evidence_digest:d('e')},
      {source_unit_id:'scope.unit.b',target_unit_id:'scope.unit.a',success:true,evidence_digest:d('f')},
    ],
    mechanism_check_method:'HYBRID_MECHANISM_CHECK_V1',shared_mechanism_digest:d('c'),mechanism_compatible:true,
    mechanism_evidence_digest:d('1'),evidence_refs:['scope:compatibility:1'],
    external_replay_evaluator:true,external_mechanism_assessor:true,authored_by_candidate:false,
  });
  const candidate=createRsiSkillAbstractionCandidate({
    candidate_id:'scope.abstraction.1',units,compatibility_receipt:compatibility,
    abstract_skill:successor,target_scope_level:'FUNCTIONAL_SKILL',
    external_abstraction_builder:true,authored_by_candidate:false,
  });
  const preservation=createRsiSkillScopePreservationReceipt({
    preservation_id:'scope.preservation.1',candidate,units,compatibility_receipt:compatibility,
    source_replays:[
      {source_instance_digest:d('b'),success:true,evidence_digest:d('2')},
      {source_instance_digest:d('d'),success:true,evidence_digest:d('3')},
    ],
    observed_capabilities:successor.capabilities,capability_analysis_digest:d('4'),
    evidence_refs:['scope:preservation:1'],external_source_replay_evaluator:true,
    external_capability_analyzer:true,authored_by_candidate:false,
  });
  const result=finalizeRsiSkillScopeExpansion({candidate,units,compatibility_receipt:compatibility,preservation_receipt:preservation});
  return {sourceA,sourceB,parent,successor,units,compatibility,candidate,preservation,result};
}

test('reliable successor crosses existing V1.26 source-preservation gate before library evidence',()=>{
  const fx=scopeFixture();
  const reliability=reliabilityBinding(fx.successor,fx.parent);
  const admission=createRsiRevisionScopeAdmission({
    source_sha:SOURCE,admission_id:'revision.scope.admission.1',reliability_binding:reliability,
    units:fx.units,compatibility_receipt:fx.compatibility,scope_candidate:fx.candidate,
    preservation_receipt:fx.preservation,scope_result:fx.result,
    external_scope_owner:true,authored_by_candidate:false,
  });
  verifyRsiRevisionScopeAdmission(admission,{
    reliability_binding:reliability,units:fx.units,compatibility_receipt:fx.compatibility,
    scope_candidate:fx.candidate,preservation_receipt:fx.preservation,scope_result:fx.result,
  });
  assert.equal(admission.state,'ELIGIBLE_FOR_EXTERNAL_LIBRARY_EVIDENCE');
  assert.equal(admission.source_preservation_verified,true);
  assert.equal(admission.behavioral_integrity_verified,true);
  assert.equal(admission.external_library_evidence_still_required,true);
  assert.equal(admission.direct_library_replacement_allowed,false);
  assert.equal(admission.authority_effect,false);
});

test('scope bridge rejects forged reliability digest and successor mismatch',()=>{
  const fx=scopeFixture();
  const reliability=reliabilityBinding(fx.successor,fx.parent);
  assert.throws(()=>createRsiRevisionScopeAdmission({
    source_sha:SOURCE,admission_id:'revision.scope.forged',
    reliability_binding:{...reliability,state:'REJECTED_RELIABILITY_REVISION'},
    units:fx.units,compatibility_receipt:fx.compatibility,scope_candidate:fx.candidate,
    preservation_receipt:fx.preservation,scope_result:fx.result,
    external_scope_owner:true,authored_by_candidate:false,
  }),/reliability_binding_digest_mismatch/);

  const other=makeSkill({id:'skill.scope.other',version:2,parent:fx.parent.skill_digest,source:'f',impl:'9'});
  const otherCandidate=createRsiSkillAbstractionCandidate({
    candidate_id:'scope.abstraction.other',units:fx.units,compatibility_receipt:fx.compatibility,
    abstract_skill:other,target_scope_level:'FUNCTIONAL_SKILL',external_abstraction_builder:true,authored_by_candidate:false,
  });
  const otherPreservation=createRsiSkillScopePreservationReceipt({
    preservation_id:'scope.preservation.other',candidate:otherCandidate,units:fx.units,compatibility_receipt:fx.compatibility,
    source_replays:[
      {source_instance_digest:d('b'),success:true,evidence_digest:d('2')},
      {source_instance_digest:d('d'),success:true,evidence_digest:d('3')},
    ],
    observed_capabilities:other.capabilities,capability_analysis_digest:d('4'),evidence_refs:['scope:preservation:other'],
    external_source_replay_evaluator:true,external_capability_analyzer:true,authored_by_candidate:false,
  });
  const otherResult=finalizeRsiSkillScopeExpansion({
    candidate:otherCandidate,units:fx.units,compatibility_receipt:fx.compatibility,preservation_receipt:otherPreservation,
  });
  assert.throws(()=>createRsiRevisionScopeAdmission({
    source_sha:SOURCE,admission_id:'revision.scope.other',reliability_binding:reliability,
    units:fx.units,compatibility_receipt:fx.compatibility,scope_candidate:otherCandidate,
    preservation_receipt:otherPreservation,scope_result:otherResult,
    external_scope_owner:true,authored_by_candidate:false,
  }),/successor_skill_mismatch/);
});

test('failed source replay cannot become external-library evidence',()=>{
  const fx=scopeFixture();
  const reliability=reliabilityBinding(fx.successor,fx.parent);
  const failed=createRsiSkillScopePreservationReceipt({
    preservation_id:'scope.preservation.failed',candidate:fx.candidate,units:fx.units,compatibility_receipt:fx.compatibility,
    source_replays:[
      {source_instance_digest:d('b'),success:true,evidence_digest:d('2')},
      {source_instance_digest:d('d'),success:false,evidence_digest:d('3')},
    ],
    observed_capabilities:fx.successor.capabilities,capability_analysis_digest:d('4'),
    evidence_refs:['scope:preservation:failed'],external_source_replay_evaluator:true,
    external_capability_analyzer:true,authored_by_candidate:false,
  });
  const result=finalizeRsiSkillScopeExpansion({candidate:fx.candidate,units:fx.units,compatibility_receipt:fx.compatibility,preservation_receipt:failed});
  const admission=createRsiRevisionScopeAdmission({
    source_sha:SOURCE,admission_id:'revision.scope.failed',reliability_binding:reliability,
    units:fx.units,compatibility_receipt:fx.compatibility,scope_candidate:fx.candidate,preservation_receipt:failed,scope_result:result,
    external_scope_owner:true,authored_by_candidate:false,
  });
  assert.equal(admission.state,'REJECTED_SCOPE_PRESERVATION');
  assert.equal(admission.eligible_for_external_library_evidence,false);
});

test('scope admission ledger is append-only, idempotent and durable',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-revision-scope-'));
  try{
    const fx=scopeFixture();
    const reliability=reliabilityBinding(fx.successor,fx.parent);
    const admission=createRsiRevisionScopeAdmission({
      source_sha:SOURCE,admission_id:'revision.scope.persist',reliability_binding:reliability,
      units:fx.units,compatibility_receipt:fx.compatibility,scope_candidate:fx.candidate,
      preservation_receipt:fx.preservation,scope_result:fx.result,external_scope_owner:true,authored_by_candidate:false,
    });
    const statePath=path.join(root,'scope.json');
    const ledger=new RsiRevisionScopeLedger({statePath,source_sha:SOURCE});
    await ledger.init();
    const first=await ledger.append(admission);
    const again=await ledger.append(admission);
    assert.equal(first.state,'ELIGIBLE_FOR_EXTERNAL_LIBRARY_EVIDENCE');
    assert.equal(again.state,'IDEMPOTENT');
    assert.equal(ledger.snapshot().eligible_count,1);
    assert.equal(ledger.eligible().length,1);

    const restored=new RsiRevisionScopeLedger({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().row_count,1);
    assert.equal(restored.snapshot().eligible_count,1);

    const raw=JSON.parse(await fs.readFile(statePath,'utf8'));
    raw.rows[0].state='REJECTED_SCOPE_PRESERVATION';
    await fs.writeFile(statePath,JSON.stringify(raw));
    const tampered=new RsiRevisionScopeLedger({statePath,source_sha:SOURCE});
    await assert.rejects(()=>tampered.init(),/row_digest_mismatch|state_digest_mismatch/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('scope admission trust root preserves external source replay and zero authority',()=>{
  const root=rsiRevisionScopeAdmissionTrustRootSnapshot();
  assert.equal(root.existing_scope_expansion_gate_reused,true);
  assert.equal(root.prior_reliability_gate_required,true);
  assert.equal(root.exact_successor_skill_binding_required,true);
  assert.equal(root.cross_instance_replay_required,true);
  assert.equal(root.exact_capability_set_required,true);
  assert.equal(root.semantic_similarity_is_authority,false);
  assert.equal(root.model_mechanism_judgment_is_authority,false);
  assert.equal(root.external_library_evidence_still_required,true);
  assert.equal(root.direct_library_replacement_allowed,false);
  assert.equal(root.candidate_can_self_commit,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.scope_admission_root_digest,/^sha256:[0-9a-f]{64}$/);
});
