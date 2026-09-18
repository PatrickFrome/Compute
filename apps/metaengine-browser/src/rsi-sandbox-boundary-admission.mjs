import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {
  validateBackendObservation,
}=require('./verification-sandbox-backend-binding.cjs');

export const RSI_SANDBOX_BOUNDARY_RECEIPT_SCHEMA='metaengine.rsi.sandbox-boundary-receipt.v1';
export const RSI_SANDBOX_BOUNDARY_ASSESSMENT_SCHEMA='metaengine.rsi.sandbox-boundary-assessment.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function exactDigest(value,label){
  const out=String(value||'').toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_sandbox_${label}_digest_invalid`);
  return out;
}
function zeroAuthority(value,label){
  for(const field of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']){
    if(value?.[field]!==false)throw new Error(`rsi_sandbox_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_sandbox_${label}_automatic_retry_invalid`);
}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>32)throw new Error('rsi_sandbox_evidence_refs_invalid');
  const seen=new Set();
  return value.map((entry)=>{
    const out=String(entry||'').trim();
    if(!out||out.length>220||seen.has(out))throw new Error('rsi_sandbox_evidence_ref_invalid');
    seen.add(out);return out;
  }).sort();
}
function candidateIdentity(candidateHandoff){
  const candidateId=String(candidateHandoff?.candidate_capsule?.candidate_id||'').toLowerCase();
  const candidateSha=String(candidateHandoff?.candidate_sha||'').toLowerCase();
  const handoffDigest=String(candidateHandoff?.handoff_digest||'').toLowerCase();
  if(!CANDIDATE_ID_RE.test(candidateId)||!SHA40_RE.test(candidateSha)||!SHA256_RE.test(handoffDigest))throw new Error('rsi_sandbox_candidate_identity_invalid');
  zeroAuthority(candidateHandoff,'candidate_handoff');
  return {candidate_id:candidateId,candidate_sha:candidateSha,handoff_digest:handoffDigest};
}

export function createRsiSandboxBoundaryReceipt({
  candidate_handoff,
  backend_binding,
  backend_observation,
  filesystem_probe_digest,
  tool_inventory_digest,
  credential_probe_digest,
  network_probe_digest,
  host_source_absent=false,
  host_project_cache_absent=false,
  host_management_tools_absent=false,
  unexpected_privileged_tool_count=1,
  credential_material_absent=false,
  network_egress_observed=true,
  external_boundary_monitor=false,
  authored_by_candidate=true,
  evidence_refs=[],
}={}){
  const candidate=candidateIdentity(candidate_handoff);
  const verified=validateBackendObservation(backend_binding,backend_observation);
  if(verified.plan_id!==candidate_handoff?.sandbox_plan?.plan_id)throw new Error('rsi_sandbox_plan_binding_mismatch');
  if(backend_binding?.plan?.candidate_id!==candidate.candidate_id||backend_binding?.plan?.source_head!==candidate.candidate_sha){
    throw new Error('rsi_sandbox_candidate_binding_mismatch');
  }
  if(external_boundary_monitor!==true||authored_by_candidate!==false)throw new Error('rsi_sandbox_external_monitor_required');
  const privilegedCount=Number(unexpected_privileged_tool_count);
  if(!Number.isSafeInteger(privilegedCount)||privilegedCount<0||privilegedCount>1024)throw new Error('rsi_sandbox_privileged_tool_count_invalid');
  if(
    host_source_absent!==true
    || host_project_cache_absent!==true
    || host_management_tools_absent!==true
    || privilegedCount!==0
    || credential_material_absent!==true
    || network_egress_observed!==false
  )throw new Error('rsi_sandbox_boundary_violation');

  const core={
    schema:RSI_SANDBOX_BOUNDARY_RECEIPT_SCHEMA,version:1,
    candidate_id:candidate.candidate_id,candidate_sha:candidate.candidate_sha,handoff_digest:candidate.handoff_digest,
    sandbox_plan_id:candidate_handoff.sandbox_plan.plan_id,
    sandbox_plan_digest:candidate_handoff.sandbox_plan.digest,
    backend_binding_candidate_id:backend_binding.binding_candidate_id,
    backend_binding_digest:backend_binding.digest,
    backend_observation_digest:verified.observation_digest,
    provider:verified.provider,
    session_id:verified.session_id,
    isolation_class:verified.isolation_class,
    runtime_digest:verified.runtime_digest,
    image_digest:verified.image_digest,
    input_manifest_digest:verified.input_manifest_digest,
    output_manifest_digest:verified.output_manifest_digest,
    teardown_receipt_digest:verified.teardown_receipt_digest,
    filesystem_probe_digest:exactDigest(filesystem_probe_digest,'filesystem_probe'),
    tool_inventory_digest:exactDigest(tool_inventory_digest,'tool_inventory'),
    credential_probe_digest:exactDigest(credential_probe_digest,'credential_probe'),
    network_probe_digest:exactDigest(network_probe_digest,'network_probe'),
    host_source_absent:true,
    host_project_cache_absent:true,
    host_management_tools_absent:true,
    unexpected_privileged_tool_count:0,
    credential_material_absent:true,
    network_egress_observed:false,
    provider_observation_trust_state:verified.trust_state,
    provider_observation_alone_sufficient:false,
    external_boundary_monitor:true,
    authored_by_candidate:false,
    evidence_refs:refs(evidence_refs),
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiSandboxBoundaryReceipt(row,inputs={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_SANDBOX_BOUNDARY_RECEIPT_SCHEMA)throw new Error('rsi_sandbox_receipt_invalid');
  zeroAuthority(row,'receipt');
  const expected=createRsiSandboxBoundaryReceipt({...inputs,
    filesystem_probe_digest:row.filesystem_probe_digest,
    tool_inventory_digest:row.tool_inventory_digest,
    credential_probe_digest:row.credential_probe_digest,
    network_probe_digest:row.network_probe_digest,
    host_source_absent:true,host_project_cache_absent:true,host_management_tools_absent:true,
    unexpected_privileged_tool_count:0,credential_material_absent:true,network_egress_observed:false,
    external_boundary_monitor:true,authored_by_candidate:false,evidence_refs:row.evidence_refs,
  });
  if(JSON.stringify(stable(row))!==JSON.stringify(stable(expected)))throw new Error('rsi_sandbox_receipt_mismatch');
  return expected;
}

export function assessRsiSandboxBoundary({receipt,candidate_handoff,backend_binding,backend_observation}={}){
  const verified=verifyRsiSandboxBoundaryReceipt(receipt,{candidate_handoff,backend_binding,backend_observation});
  const core={
    schema:RSI_SANDBOX_BOUNDARY_ASSESSMENT_SCHEMA,version:1,
    candidate_id:verified.candidate_id,candidate_sha:verified.candidate_sha,handoff_digest:verified.handoff_digest,
    receipt_digest:verified.receipt_digest,
    state:'BOUNDARY_VERIFIED',
    host_source_absent:true,
    host_project_cache_absent:true,
    host_management_tools_absent:true,
    unexpected_privileged_tool_count:0,
    credential_material_absent:true,
    network_egress_observed:false,
    provider_observation_alone_sufficient:false,
    eligible_for_archive_evidence:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,assessment_digest:digest(core)});
}
