import crypto from 'node:crypto';

import {
  createRsiSkillCapsule,
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
} from './rsi-verified-skill-library.mjs';

export const RSI_SKILL_SCOPE_UNIT_SCHEMA = 'metaengine.rsi.skill-scope-unit.v1';
export const RSI_SKILL_COMPATIBILITY_SCHEMA = 'metaengine.rsi.skill-compatibility.v1';
export const RSI_SKILL_ABSTRACTION_CANDIDATE_SCHEMA = 'metaengine.rsi.skill-abstraction-candidate.v1';
export const RSI_SKILL_SCOPE_PRESERVATION_SCHEMA = 'metaengine.rsi.skill-scope-preservation.v1';
export const RSI_SKILL_SCOPE_EXPANSION_RESULT_SCHEMA = 'metaengine.rsi.skill-scope-expansion-result.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_UNITS = 8;
const MAX_INSTANCES = 64;
const MAX_EVIDENCE_REFS = 32;

const SCOPE_LEVELS = Object.freeze([
  'INSTANCE_PATCH',
  'FUNCTIONAL_SKILL',
  'STRATEGIC_SKILL',
]);
const SCOPE_RANK = Object.freeze(Object.fromEntries(SCOPE_LEVELS.map((level,index)=>[level,index])));
const MECHANISM_METHODS = new Set([
  'EXTERNAL_LLM_MECHANISM_CHECK_V1',
  'STRUCTURAL_MECHANISM_CHECK_V1',
  'HYBRID_MECHANISM_CHECK_V1',
]);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}

function exactDigest(value,label) {
  const out=String(value||'').toLowerCase();
  if(!SHA256_RE.test(out)) throw new Error(`rsi_scope_${label}_digest_invalid`);
  return out;
}

function boundedId(value,label) {
  const out=String(value||'').trim();
  if(!SAFE_ID_RE.test(out)) throw new Error(`rsi_scope_${label}_invalid`);
  return out;
}

function boundedToken(value,label) {
  const out=String(value||'').trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/.test(out)) throw new Error(`rsi_scope_${label}_invalid`);
  return out;
}

function exactKeys(value,required,optional,label) {
  if(!plainObject(value)) throw new Error(`rsi_scope_${label}_invalid`);
  const allowed=new Set([...required,...optional]);
  for(const key of required){
    if(!Object.prototype.hasOwnProperty.call(value,key)) throw new Error(`rsi_scope_${label}_fields_invalid`);
  }
  for(const key of Object.keys(value)){
    if(!allowed.has(key)) throw new Error(`rsi_scope_${label}_fields_invalid`);
  }
}

function normalizeRefs(value) {
  if(!Array.isArray(value)||value.length<1||value.length>MAX_EVIDENCE_REFS) throw new Error('rsi_scope_evidence_refs_invalid');
  const seen=new Set();
  return Object.freeze(value.map((raw)=>{
    const ref=boundedId(raw,'evidence_ref');
    if(seen.has(ref)) throw new Error('rsi_scope_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort());
}

function normalizeDigestList(value,label,{min=1,max=MAX_INSTANCES}={}) {
  if(!Array.isArray(value)||value.length<min||value.length>max) throw new Error(`rsi_scope_${label}_invalid`);
  const seen=new Set();
  return Object.freeze(value.map((raw)=>{
    const d=exactDigest(raw,label);
    if(seen.has(d)) throw new Error(`rsi_scope_${label}_duplicate`);
    seen.add(d);
    return d;
  }).sort());
}

function normalizeCapabilities(value,label='capability') {
  if(!Array.isArray(value)||value.length<1||value.length>32) throw new Error(`rsi_scope_${label}_invalid`);
  const seen=new Set();
  return Object.freeze(value.map((raw)=>{
    const token=boundedToken(raw,label);
    if(seen.has(token)) throw new Error(`rsi_scope_${label}_duplicate`);
    seen.add(token);
    return token;
  }).sort());
}

function zeroAuthority(extra={}) {
  return Object.freeze({
    ...extra,
    execution_authority:false,
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

function assertZeroAuthority(value,label) {
  for(const field of [
    'execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','scheduler_authority','signing_authority',
    'direct_tool_execution_authority','authority_effect',
  ]){
    if(value?.[field]!==false) throw new Error(`rsi_scope_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false) throw new Error(`rsi_scope_${label}_automatic_retry_invalid`);
}

function scopeLevel(value) {
  const out=boundedToken(value,'scope_level');
  if(!SCOPE_LEVELS.includes(out)) throw new Error('rsi_scope_level_invalid');
  return out;
}

function sameArray(a,b) {
  return a.length===b.length&&a.every((value,index)=>value===b[index]);
}

export function createRsiSkillScopeUnit({
  unit_id,
  skill,
  evidence,
  scope_level,
  validated_instance_digests,
  mechanism_signature_digest,
  evidence_refs,
  external_scope_owner=false,
  authored_by_candidate=true,
}={}) {
  const checkedSkill=verifyRsiSkillCapsule(skill);
  const checkedEvidence=verifyRsiSkillEvidence(evidence,checkedSkill);
  if(external_scope_owner!==true||authored_by_candidate!==false) throw new Error('rsi_scope_unit_external_origin_required');
  if(checkedEvidence.verified_for_library!==true||checkedEvidence.hard_invariants_pass!==true) throw new Error('rsi_scope_unit_skill_not_verified');
  const level=scopeLevel(scope_level);
  const instances=normalizeDigestList(validated_instance_digests,'validated_instance');
  if(level==='INSTANCE_PATCH'&&instances.length!==1) throw new Error('rsi_scope_instance_patch_cardinality_invalid');
  if(level==='FUNCTIONAL_SKILL'&&instances.length<2) throw new Error('rsi_scope_functional_cardinality_invalid');
  if(level==='STRATEGIC_SKILL'&&instances.length<3) throw new Error('rsi_scope_strategic_cardinality_invalid');

  const core={
    schema:RSI_SKILL_SCOPE_UNIT_SCHEMA,
    version:1,
    unit_id:boundedId(unit_id,'unit_id'),
    skill_id:checkedSkill.skill_id,
    skill_version:checkedSkill.skill_version,
    skill_digest:checkedSkill.skill_digest,
    skill_evidence_digest:checkedEvidence.evidence_digest,
    source_candidate_sha:checkedSkill.source_candidate_sha,
    role:checkedSkill.role,
    input_schema_digest:checkedSkill.input_schema_digest,
    output_schema_digest:checkedSkill.output_schema_digest,
    capabilities:checkedSkill.capabilities,
    scope_level:level,
    scope_rank:SCOPE_RANK[level],
    validated_instance_digests:instances,
    validated_instance_count:instances.length,
    mechanism_signature_digest:exactDigest(mechanism_signature_digest,'mechanism_signature'),
    evidence_refs:normalizeRefs(evidence_refs),
    source_behavior_preserved:true,
    scope_portability_claimed:false,
    semantic_similarity_is_compatibility_authority:false,
    model_mechanism_judgment_is_compatibility_authority:false,
    external_scope_owner:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,unit_digest:digest(core)});
}

export function verifyRsiSkillScopeUnit(unit,skill,evidence) {
  if(!plainObject(unit)||unit.schema!==RSI_SKILL_SCOPE_UNIT_SCHEMA||unit.version!==1) throw new Error('rsi_scope_unit_invalid');
  assertZeroAuthority(unit,'unit');
  if(
    unit.source_behavior_preserved!==true
    ||unit.scope_portability_claimed!==false
    ||unit.semantic_similarity_is_compatibility_authority!==false
    ||unit.model_mechanism_judgment_is_compatibility_authority!==false
    ||unit.external_scope_owner!==true
    ||unit.authored_by_candidate!==false
  ) throw new Error('rsi_scope_unit_policy_invalid');
  const canonical=createRsiSkillScopeUnit({
    unit_id:unit.unit_id,
    skill,
    evidence,
    scope_level:unit.scope_level,
    validated_instance_digests:unit.validated_instance_digests,
    mechanism_signature_digest:unit.mechanism_signature_digest,
    evidence_refs:unit.evidence_refs,
    external_scope_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.unit_digest!==exactDigest(unit.unit_digest,'unit')) throw new Error('rsi_scope_unit_digest_mismatch');
  return canonical;
}

function normalizeUnits(units) {
  if(!Array.isArray(units)||units.length<2||units.length>MAX_UNITS) throw new Error('rsi_scope_units_invalid');
  const ids=new Set();
  const digests=new Set();
  const checked=units.map((row)=>{
    if(!plainObject(row)||row.schema!==RSI_SKILL_SCOPE_UNIT_SCHEMA||row.version!==1) throw new Error('rsi_scope_unit_invalid');
    assertZeroAuthority(row,'unit');
    exactDigest(row.unit_digest,'unit');
    exactDigest(row.skill_digest,'unit_skill');
    exactDigest(row.skill_evidence_digest,'unit_evidence');
    scopeLevel(row.scope_level);
    normalizeDigestList(row.validated_instance_digests,'validated_instance');
    normalizeCapabilities(row.capabilities);
    if(ids.has(row.unit_id)||digests.has(row.unit_digest)) throw new Error('rsi_scope_unit_duplicate');
    ids.add(row.unit_id); digests.add(row.unit_digest);
    return row;
  });
  const first=checked[0];
  for(const row of checked.slice(1)){
    if(row.role!==first.role) throw new Error('rsi_scope_unit_role_mismatch');
    if(row.input_schema_digest!==first.input_schema_digest||row.output_schema_digest!==first.output_schema_digest) throw new Error('rsi_scope_unit_interface_mismatch');
    if(!sameArray([...row.capabilities].sort(),[...first.capabilities].sort())) throw new Error('rsi_scope_unit_capability_mismatch');
  }
  return Object.freeze(checked.slice().sort((a,b)=>a.unit_id.localeCompare(b.unit_id)));
}

function replayKey(sourceUnitId,targetUnitId) {
  return `${sourceUnitId}->${targetUnitId}`;
}

export function createRsiSkillCompatibilityReceipt({
  compatibility_id,
  units,
  directed_cross_replays,
  mechanism_check_method,
  shared_mechanism_digest,
  mechanism_compatible,
  mechanism_evidence_digest,
  evidence_refs,
  external_replay_evaluator=false,
  external_mechanism_assessor=false,
  authored_by_candidate=true,
}={}) {
  if(external_replay_evaluator!==true||external_mechanism_assessor!==true||authored_by_candidate!==false) {
    throw new Error('rsi_scope_compatibility_external_origin_required');
  }
  const checkedUnits=normalizeUnits(units);
  const method=boundedToken(mechanism_check_method,'mechanism_check_method');
  if(!MECHANISM_METHODS.has(method)) throw new Error('rsi_scope_mechanism_method_invalid');

  const expected=new Set();
  for(const source of checkedUnits){
    for(const target of checkedUnits){
      if(source.unit_id!==target.unit_id) expected.add(replayKey(source.unit_id,target.unit_id));
    }
  }
  if(!Array.isArray(directed_cross_replays)||directed_cross_replays.length!==expected.size) throw new Error('rsi_scope_cross_replay_matrix_incomplete');
  const seen=new Set();
  const replays=directed_cross_replays.map((row)=>{
    exactKeys(row,['source_unit_id','target_unit_id','success','evidence_digest'],[], 'cross_replay');
    const key=replayKey(boundedId(row.source_unit_id,'cross_replay_source'),boundedId(row.target_unit_id,'cross_replay_target'));
    if(!expected.has(key)||seen.has(key)) throw new Error('rsi_scope_cross_replay_matrix_invalid');
    seen.add(key);
    if(row.success!==true&&row.success!==false) throw new Error('rsi_scope_cross_replay_success_invalid');
    return Object.freeze({
      source_unit_id:row.source_unit_id,
      target_unit_id:row.target_unit_id,
      success:row.success,
      evidence_digest:exactDigest(row.evidence_digest,'cross_replay_evidence'),
    });
  }).sort((a,b)=>replayKey(a.source_unit_id,a.target_unit_id).localeCompare(replayKey(b.source_unit_id,b.target_unit_id)));

  const allReplayPass=replays.every((row)=>row.success===true);
  const mechanismCompatible=mechanism_compatible===true;
  const compatible=allReplayPass&&mechanismCompatible;
  const core={
    schema:RSI_SKILL_COMPATIBILITY_SCHEMA,
    version:1,
    compatibility_id:boundedId(compatibility_id,'compatibility_id'),
    unit_digests:checkedUnits.map((row)=>row.unit_digest),
    unit_ids:checkedUnits.map((row)=>row.unit_id),
    role:checkedUnits[0].role,
    input_schema_digest:checkedUnits[0].input_schema_digest,
    output_schema_digest:checkedUnits[0].output_schema_digest,
    capabilities:checkedUnits[0].capabilities,
    directed_cross_replays:Object.freeze(replays),
    directed_cross_replay_count:replays.length,
    all_directed_cross_replays_pass:allReplayPass,
    mechanism_check_method:method,
    shared_mechanism_digest:exactDigest(shared_mechanism_digest,'shared_mechanism'),
    mechanism_compatible:mechanismCompatible,
    mechanism_evidence_digest:exactDigest(mechanism_evidence_digest,'mechanism_evidence'),
    compatible_for_abstraction:compatible,
    semantic_similarity_used_for_candidate_retrieval_only:true,
    semantic_similarity_is_compatibility_authority:false,
    mechanism_judgment_alone_is_compatibility_authority:false,
    cross_instance_replay_required:true,
    external_replay_evaluator:true,
    external_mechanism_assessor:true,
    authored_by_candidate:false,
    evidence_refs:normalizeRefs(evidence_refs),
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,compatibility_digest:digest(core)});
}

export function verifyRsiSkillCompatibilityReceipt(receipt,units) {
  if(!plainObject(receipt)||receipt.schema!==RSI_SKILL_COMPATIBILITY_SCHEMA||receipt.version!==1) throw new Error('rsi_scope_compatibility_invalid');
  assertZeroAuthority(receipt,'compatibility');
  if(
    receipt.semantic_similarity_used_for_candidate_retrieval_only!==true
    ||receipt.semantic_similarity_is_compatibility_authority!==false
    ||receipt.mechanism_judgment_alone_is_compatibility_authority!==false
    ||receipt.cross_instance_replay_required!==true
    ||receipt.external_replay_evaluator!==true
    ||receipt.external_mechanism_assessor!==true
    ||receipt.authored_by_candidate!==false
  ) throw new Error('rsi_scope_compatibility_policy_invalid');
  const canonical=createRsiSkillCompatibilityReceipt({
    compatibility_id:receipt.compatibility_id,
    units,
    directed_cross_replays:receipt.directed_cross_replays,
    mechanism_check_method:receipt.mechanism_check_method,
    shared_mechanism_digest:receipt.shared_mechanism_digest,
    mechanism_compatible:receipt.mechanism_compatible,
    mechanism_evidence_digest:receipt.mechanism_evidence_digest,
    evidence_refs:receipt.evidence_refs,
    external_replay_evaluator:true,
    external_mechanism_assessor:true,
    authored_by_candidate:false,
  });
  if(canonical.compatibility_digest!==exactDigest(receipt.compatibility_digest,'compatibility')) throw new Error('rsi_scope_compatibility_digest_mismatch');
  return canonical;
}

export function createRsiSkillAbstractionCandidate({
  candidate_id,
  units,
  compatibility_receipt,
  abstract_skill,
  target_scope_level,
  external_abstraction_builder=false,
  authored_by_candidate=true,
}={}) {
  const checkedUnits=normalizeUnits(units);
  const compatibility=verifyRsiSkillCompatibilityReceipt(compatibility_receipt,checkedUnits);
  if(external_abstraction_builder!==true||authored_by_candidate!==false) throw new Error('rsi_scope_abstraction_external_origin_required');
  if(compatibility.compatible_for_abstraction!==true) throw new Error('rsi_scope_abstraction_incompatible_units');
  const skill=verifyRsiSkillCapsule(abstract_skill);
  const targetLevel=scopeLevel(target_scope_level);
  const maxSourceRank=Math.max(...checkedUnits.map((row)=>SCOPE_RANK[row.scope_level]));
  if(SCOPE_RANK[targetLevel]!==maxSourceRank+1) throw new Error('rsi_scope_abstraction_level_not_adjacent');
  if(skill.role!==compatibility.role) throw new Error('rsi_scope_abstraction_role_mismatch');
  if(skill.input_schema_digest!==compatibility.input_schema_digest||skill.output_schema_digest!==compatibility.output_schema_digest) throw new Error('rsi_scope_abstraction_interface_mismatch');
  if(!sameArray([...skill.capabilities].sort(),[...compatibility.capabilities].sort())) throw new Error('rsi_scope_abstraction_capability_widening');

  const sourceInstances=[...new Set(checkedUnits.flatMap((row)=>row.validated_instance_digests))].sort();
  if(targetLevel==='FUNCTIONAL_SKILL'&&sourceInstances.length<2) throw new Error('rsi_scope_abstraction_functional_coverage_insufficient');
  if(targetLevel==='STRATEGIC_SKILL'&&sourceInstances.length<3) throw new Error('rsi_scope_abstraction_strategic_coverage_insufficient');

  const core={
    schema:RSI_SKILL_ABSTRACTION_CANDIDATE_SCHEMA,
    version:1,
    candidate_id:boundedId(candidate_id,'abstraction_candidate_id'),
    compatibility_digest:compatibility.compatibility_digest,
    constituent_unit_digests:checkedUnits.map((row)=>row.unit_digest),
    constituent_skill_digests:checkedUnits.map((row)=>row.skill_digest),
    source_instance_digests:Object.freeze(sourceInstances),
    source_instance_count:sourceInstances.length,
    source_max_scope_rank:maxSourceRank,
    target_scope_level:targetLevel,
    target_scope_rank:SCOPE_RANK[targetLevel],
    abstract_skill:skill,
    abstract_skill_digest:skill.skill_digest,
    shared_mechanism_digest:compatibility.shared_mechanism_digest,
    source_preservation_required:true,
    behavioral_integrity_required:true,
    v124_library_evidence_still_required:true,
    candidate_can_self_commit:false,
    candidate_can_skip_source_replay:false,
    candidate_can_widen_capabilities:false,
    external_abstraction_builder:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,candidate_digest:digest(core)});
}

export function verifyRsiSkillAbstractionCandidate(candidate,units,compatibility_receipt) {
  if(!plainObject(candidate)||candidate.schema!==RSI_SKILL_ABSTRACTION_CANDIDATE_SCHEMA||candidate.version!==1) throw new Error('rsi_scope_abstraction_candidate_invalid');
  assertZeroAuthority(candidate,'abstraction_candidate');
  if(
    candidate.source_preservation_required!==true
    ||candidate.behavioral_integrity_required!==true
    ||candidate.v124_library_evidence_still_required!==true
    ||candidate.candidate_can_self_commit!==false
    ||candidate.candidate_can_skip_source_replay!==false
    ||candidate.candidate_can_widen_capabilities!==false
    ||candidate.external_abstraction_builder!==true
    ||candidate.authored_by_candidate!==false
  ) throw new Error('rsi_scope_abstraction_candidate_policy_invalid');
  const canonical=createRsiSkillAbstractionCandidate({
    candidate_id:candidate.candidate_id,
    units,
    compatibility_receipt,
    abstract_skill:candidate.abstract_skill,
    target_scope_level:candidate.target_scope_level,
    external_abstraction_builder:true,
    authored_by_candidate:false,
  });
  if(canonical.candidate_digest!==exactDigest(candidate.candidate_digest,'abstraction_candidate')) throw new Error('rsi_scope_abstraction_candidate_digest_mismatch');
  return canonical;
}

export function createRsiSkillScopePreservationReceipt({
  preservation_id,
  candidate,
  units,
  compatibility_receipt,
  source_replays,
  observed_capabilities,
  capability_analysis_digest,
  evidence_refs,
  external_source_replay_evaluator=false,
  external_capability_analyzer=false,
  authored_by_candidate=true,
}={}) {
  const checked=verifyRsiSkillAbstractionCandidate(candidate,units,compatibility_receipt);
  if(external_source_replay_evaluator!==true||external_capability_analyzer!==true||authored_by_candidate!==false) {
    throw new Error('rsi_scope_preservation_external_origin_required');
  }
  const expected=new Set(checked.source_instance_digests);
  if(!Array.isArray(source_replays)||source_replays.length!==expected.size) throw new Error('rsi_scope_source_replay_set_incomplete');
  const seen=new Set();
  const replays=source_replays.map((row)=>{
    exactKeys(row,['source_instance_digest','success','evidence_digest'],[], 'source_replay');
    const instance=exactDigest(row.source_instance_digest,'source_instance');
    if(!expected.has(instance)||seen.has(instance)) throw new Error('rsi_scope_source_replay_set_invalid');
    seen.add(instance);
    if(row.success!==true&&row.success!==false) throw new Error('rsi_scope_source_replay_success_invalid');
    return Object.freeze({
      source_instance_digest:instance,
      success:row.success,
      evidence_digest:exactDigest(row.evidence_digest,'source_replay_evidence'),
    });
  }).sort((a,b)=>a.source_instance_digest.localeCompare(b.source_instance_digest));
  const declared=[...checked.abstract_skill.capabilities].sort();
  const observed=[...normalizeCapabilities(observed_capabilities,'observed_capability')].sort();
  const undeclared=observed.filter((capability)=>!declared.includes(capability));
  const overdeclared=declared.filter((capability)=>!observed.includes(capability));
  const behavioralIntegrityPass=undeclared.length===0&&overdeclared.length===0;
  const sourcePreservationPass=replays.every((row)=>row.success===true);
  const core={
    schema:RSI_SKILL_SCOPE_PRESERVATION_SCHEMA,
    version:1,
    preservation_id:boundedId(preservation_id,'preservation_id'),
    candidate_digest:checked.candidate_digest,
    abstract_skill_digest:checked.abstract_skill_digest,
    source_replays:Object.freeze(replays),
    source_replay_count:replays.length,
    all_source_replays_pass:sourcePreservationPass,
    declared_capabilities:Object.freeze(declared),
    observed_capabilities:Object.freeze(observed),
    undeclared_capabilities:Object.freeze(undeclared),
    overdeclared_capabilities:Object.freeze(overdeclared),
    capability_analysis_digest:exactDigest(capability_analysis_digest,'capability_analysis'),
    behavioral_integrity_pass:behavioralIntegrityPass,
    exact_capability_set_required:true,
    semantic_similarity_is_preservation_evidence:false,
    model_claim_is_preservation_evidence:false,
    external_source_replay_evaluator:true,
    external_capability_analyzer:true,
    authored_by_candidate:false,
    evidence_refs:normalizeRefs(evidence_refs),
    eligible_for_scope_commit:sourcePreservationPass&&behavioralIntegrityPass,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,preservation_digest:digest(core)});
}

export function verifyRsiSkillScopePreservationReceipt(receipt,candidate,units,compatibility_receipt) {
  if(!plainObject(receipt)||receipt.schema!==RSI_SKILL_SCOPE_PRESERVATION_SCHEMA||receipt.version!==1) throw new Error('rsi_scope_preservation_invalid');
  assertZeroAuthority(receipt,'preservation');
  if(
    receipt.exact_capability_set_required!==true
    ||receipt.semantic_similarity_is_preservation_evidence!==false
    ||receipt.model_claim_is_preservation_evidence!==false
    ||receipt.external_source_replay_evaluator!==true
    ||receipt.external_capability_analyzer!==true
    ||receipt.authored_by_candidate!==false
  ) throw new Error('rsi_scope_preservation_policy_invalid');
  const canonical=createRsiSkillScopePreservationReceipt({
    preservation_id:receipt.preservation_id,
    candidate,
    units,
    compatibility_receipt,
    source_replays:receipt.source_replays,
    observed_capabilities:receipt.observed_capabilities,
    capability_analysis_digest:receipt.capability_analysis_digest,
    evidence_refs:receipt.evidence_refs,
    external_source_replay_evaluator:true,
    external_capability_analyzer:true,
    authored_by_candidate:false,
  });
  if(canonical.preservation_digest!==exactDigest(receipt.preservation_digest,'preservation')) throw new Error('rsi_scope_preservation_digest_mismatch');
  return canonical;
}

export function finalizeRsiSkillScopeExpansion({
  candidate,
  units,
  compatibility_receipt,
  preservation_receipt,
}={}) {
  const checkedCandidate=verifyRsiSkillAbstractionCandidate(candidate,units,compatibility_receipt);
  const compatibility=verifyRsiSkillCompatibilityReceipt(compatibility_receipt,units);
  const preservation=verifyRsiSkillScopePreservationReceipt(preservation_receipt,checkedCandidate,units,compatibility);
  const eligible=compatibility.compatible_for_abstraction===true&&preservation.eligible_for_scope_commit===true;
  const core={
    schema:RSI_SKILL_SCOPE_EXPANSION_RESULT_SCHEMA,
    version:1,
    candidate_digest:checkedCandidate.candidate_digest,
    abstract_skill_digest:checkedCandidate.abstract_skill_digest,
    compatibility_digest:compatibility.compatibility_digest,
    preservation_digest:preservation.preservation_digest,
    target_scope_level:checkedCandidate.target_scope_level,
    source_instance_count:checkedCandidate.source_instance_count,
    state:eligible?'ELIGIBLE_FOR_V124_LIBRARY_EVIDENCE':'REJECTED_SCOPE_EXPANSION',
    eligible_for_v124_library_evidence:eligible,
    directly_committed_to_library:false,
    v124_external_skill_evidence_required:true,
    source_preservation_verified:preservation.all_source_replays_pass,
    behavioral_integrity_verified:preservation.behavioral_integrity_pass,
    semantic_similarity_is_commit_authority:false,
    mechanism_judgment_is_commit_authority:false,
    source_replay_is_commit_prerequisite:true,
    skill_scope_expansion_is_promotion_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,result_digest:digest(core)});
}

export function rsiSkillScopeExpansionTrustRootSnapshot() {
  const root={
    schema:'metaengine.rsi.skill-scope-expansion-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-skill-scope-expansion.mjs',
    scope_levels:Object.freeze([...SCOPE_LEVELS]),
    mechanism_check_methods:Object.freeze([...MECHANISM_METHODS].sort()),
    instance_patch_first:true,
    cross_instance_replay_required:true,
    source_preserving_consolidation_required:true,
    exact_capability_set_required:true,
    semantic_similarity_is_authority:false,
    llm_mechanism_judgment_is_authority:false,
    v124_external_library_evidence_required:true,
    candidate_can_self_commit:false,
    candidate_can_widen_capabilities:false,
    behavioral_integrity_analysis_required:true,
    arbitrary_code_execution_surface:false,
    direct_tool_execution_allowed:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,scope_root_digest:digest(root)});
}
