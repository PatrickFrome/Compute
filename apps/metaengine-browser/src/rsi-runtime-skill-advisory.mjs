import crypto from 'node:crypto';

import {
  verifyRsiLineageSkillAdmission,
} from './rsi-lineage-skill-admission.mjs';
import {
  createRsiSkillActivationView,
  verifyRsiSkillActivationView,
} from './rsi-skill-library-governance.mjs';
import {
  createRsiSkillCompositionPlan,
  verifyRsiSkillCompositionPlan,
} from './rsi-verified-skill-library.mjs';

export const RSI_RUNTIME_SKILL_ADVISORY_SCHEMA='metaengine.rsi.runtime-skill-advisory.v1';

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex');
}
function zeroAuthority(value,label){
  for(const field of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','direct_tool_execution_authority','authority_effect']){
    if(value?.[field]!==false)throw new Error(`rsi_runtime_skill_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_runtime_skill_${label}_automatic_retry_invalid`);
}

export function createRsiRuntimeSkillAdvisory({
  lineage_skill_admission,
  lineage_skill_admission_inputs,
  external_planner=false,
  authored_by_candidate=true,
}={}){
  if(external_planner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_external_planner_required');
  const admission=verifyRsiLineageSkillAdmission(lineage_skill_admission,lineage_skill_admission_inputs);
  zeroAuthority(admission,'lineage_skill_admission');
  if(admission.active_for_composition!==true){
    throw new Error(`rsi_runtime_skill_not_active:${admission.governance_state}`);
  }
  if(!['ACTIVE','EXPLORATION_ACTIVE'].includes(admission.governance_state)){
    throw new Error('rsi_runtime_skill_governance_state_invalid');
  }

  const activation=createRsiSkillActivationView({
    governance:admission.governance,
    library:admission.library,
    requested_skill_digests:[admission.skill_digest],
    external_planner:true,
    authored_by_candidate:false,
  });
  verifyRsiSkillActivationView(activation,admission.governance,admission.library);
  zeroAuthority(activation,'activation_view');

  const libraryEntry=admission.library.entries.find((row)=>row.skill_digest===admission.skill_digest);
  if(!libraryEntry)throw new Error('rsi_runtime_skill_library_entry_missing');
  const compositionPlan=createRsiSkillCompositionPlan({
    plan_id:`runtime.skill.${admission.skill_id}.${admission.skill_version}`,
    library:admission.library,
    input_schema_digest:libraryEntry.input_schema_digest,
    output_schema_digest:libraryEntry.output_schema_digest,
    nodes:[{
      node_id:'skill',
      skill_id:admission.skill_id,
      skill_version:admission.skill_version,
      skill_digest:admission.skill_digest,
      max_invocations:1,
    }],
    edges:[],
    max_total_context_tokens:libraryEntry.max_context_tokens,
    max_total_output_tokens:libraryEntry.max_output_tokens,
    external_planner:true,
    authored_by_candidate:false,
  });
  verifyRsiSkillCompositionPlan(compositionPlan,admission.library);
  zeroAuthority(compositionPlan,'composition_plan');
  const core={
    schema:RSI_RUNTIME_SKILL_ADVISORY_SCHEMA,
    version:1,
    lineage_skill_admission_digest:admission.admission_digest,
    source_parent_sha:admission.source_parent_sha,
    source_candidate_sha:admission.candidate_sha,
    library_id:admission.library_id,
    library_digest:admission.library_digest,
    governance_id:admission.governance_id,
    governance_digest:admission.governance_digest,
    activation_digest:activation.activation_digest,
    composition_plan_id:compositionPlan.plan_id,
    composition_plan_digest:compositionPlan.plan_digest,
    composition_plan:compositionPlan,
    skill_id:admission.skill_id,
    skill_version:admission.skill_version,
    skill_digest:admission.skill_digest,
    governance_state:admission.governance_state,
    role:libraryEntry.role,
    input_schema_digest:libraryEntry.input_schema_digest,
    output_schema_digest:libraryEntry.output_schema_digest,
    capabilities:Object.freeze([...libraryEntry.capabilities]),
    max_context_tokens:libraryEntry.max_context_tokens,
    max_output_tokens:libraryEntry.max_output_tokens,
    max_invocations:libraryEntry.max_invocations,
    source_candidate_sha:libraryEntry.source_candidate_sha,
    verified_transfer_context_count:admission.verified_transfer_context_count,
    verified_transfer_holdout_count:admission.verified_transfer_holdout_count,
    runtime_use_mode:'ADVISORY_CONTEXT_ONLY',
    raw_skill_implementation_exposed:false,
    raw_trajectory_exposed:false,
    raw_model_transcript_exposed:false,
    direct_tool_execution_allowed:false,
    browser_actuation_allowed:false,
    scheduler_dispatch_allowed:false,
    skill_may_write_library:false,
    skill_may_change_governance:false,
    skill_may_self_update:false,
    activation_view_is_execution_authority:false,
    external_planner:true,
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
  return Object.freeze({...core,advisory_digest:digest(core)});
}

export function verifyRsiRuntimeSkillAdvisory(row,inputs={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_RUNTIME_SKILL_ADVISORY_SCHEMA||row.version!==1){
    throw new Error('rsi_runtime_skill_advisory_invalid');
  }
  zeroAuthority(row,'advisory');
  if(
    row.runtime_use_mode!=='ADVISORY_CONTEXT_ONLY'
    ||row.raw_skill_implementation_exposed!==false
    ||row.raw_trajectory_exposed!==false
    ||row.raw_model_transcript_exposed!==false
    ||row.direct_tool_execution_allowed!==false
    ||row.browser_actuation_allowed!==false
    ||row.scheduler_dispatch_allowed!==false
    ||row.skill_may_write_library!==false
    ||row.skill_may_change_governance!==false
    ||row.skill_may_self_update!==false
    ||row.activation_view_is_execution_authority!==false
    ||row.external_planner!==true
    ||row.authored_by_candidate!==false
  )throw new Error('rsi_runtime_skill_advisory_policy_invalid');
  const expected=createRsiRuntimeSkillAdvisory(inputs);
  if(JSON.stringify(stable(row))!==JSON.stringify(stable(expected)))throw new Error('rsi_runtime_skill_advisory_mismatch');
  return expected;
}
