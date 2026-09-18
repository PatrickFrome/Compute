import crypto from 'node:crypto';

import { RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import { RSI_MUTATION_SURFACES } from './rsi-shadow-core.mjs';
import {
  RSI_REVISION_ENVELOPE_SCHEMA,
  RSI_REVISION_PROPOSAL_SCHEMA,
  verifyRsiBoundedRevisionEnvelope,
  verifyRsiBoundedRevisionProposal,
} from './rsi-bounded-revision-proposal.mjs';
import {
  verifyRsiIsolatedCandidateBuildPlan,
  finalizeRsiIsolatedCandidateBuild,
} from './rsi-isolated-candidate-builder.mjs';

export const RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA='metaengine.rsi.bounded-revision-devos-bridge.v1';
export const RSI_BOUNDED_REVISION_ARTIFACT_RECEIPT_SCHEMA='metaengine.rsi.bounded-revision-artifact-receipt.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CHANGE_TYPES=new Set(['CREATE','MODIFY','DELETE']);
const SLSA_PREDICATE='https://slsa.dev/provenance/v1';

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function digest(v){return `sha256:${hash(v)}`;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_revision_bridge_${l}_digest_invalid`);return x;}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_revision_bridge_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_revision_bridge_${l}_retry_invalid`);}
function positiveInt(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_revision_bridge_${l}_invalid`);return n;}
function normalizePath(value){
  const p=String(value||'').trim().replaceAll('\\','/');
  if(!p||p.startsWith('/')||p.includes('//')||p.split('/').some(part=>!part||part==='.'||part==='..'||part==='.git'))throw new Error('rsi_revision_bridge_mutation_path_invalid');
  return p;
}
function mutations(value,maxFiles){
  if(!Array.isArray(value)||value.length<1||value.length>maxFiles)throw new Error('rsi_revision_bridge_mutations_invalid');
  const seen=new Set();
  return Object.freeze(value.map(entry=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('rsi_revision_bridge_mutation_invalid');
    const path=normalizePath(entry.path);
    if(seen.has(path))throw new Error('rsi_revision_bridge_mutation_duplicate');
    seen.add(path);
    const change=String(entry.change||'').trim().toUpperCase();
    if(!CHANGE_TYPES.has(change))throw new Error('rsi_revision_bridge_mutation_change_invalid');
    return Object.freeze({path,change});
  }).sort((a,b)=>a.path.localeCompare(b.path)||a.change.localeCompare(b.change)));
}
function verifyDigestObject(row,schema,digestField,label){
  if(!row||row.schema!==schema||row.version!==1)throw new Error(`rsi_revision_bridge_${label}_invalid`);
  assertZero(row,label);
  const core=structuredClone(row);delete core[digestField];
  if(digest(core)!==exactDigest(row[digestField],label))throw new Error(`rsi_revision_bridge_${label}_digest_mismatch`);
  return Object.freeze(structuredClone(row));
}

export function createRsiBoundedRevisionDevosBridge({
  envelope,
  proposal,
  experiment_intent,
  experiment_receipt,
  mutation_surface,
  approved_mutations,
  approved_mutation_manifest_digest,
  implementation_reviewer_root_digest,
  artifact_provenance_policy_digest,
  external_implementation_reviewer=false,
}={}){
  if(external_implementation_reviewer!==true)throw new Error('rsi_revision_bridge_external_reviewer_required');
  if(!envelope||envelope.schema!==RSI_REVISION_ENVELOPE_SCHEMA)throw new Error('rsi_revision_bridge_envelope_invalid');
  if(!proposal||proposal.schema!==RSI_REVISION_PROPOSAL_SCHEMA)throw new Error('rsi_revision_bridge_proposal_invalid');
  const checkedEnvelope=verifyRsiBoundedRevisionEnvelope(envelope,{intent:experiment_intent,receipt:experiment_receipt});
  const checkedProposal=verifyRsiBoundedRevisionProposal(proposal,{envelope:checkedEnvelope});
  const surface=String(mutation_surface||'').trim().toUpperCase();
  if(!RSI_MUTATION_SURFACES.includes(surface))throw new Error('rsi_revision_bridge_mutation_surface_invalid');
  const approved=mutations(approved_mutations,checkedEnvelope.max_mutated_files);
  const manifestDigest=digest(approved);
  if(manifestDigest!==exactDigest(approved_mutation_manifest_digest,'approved_mutation_manifest'))throw new Error('rsi_revision_bridge_mutation_manifest_digest_mismatch');
  const reviewerRoot=exactDigest(implementation_reviewer_root_digest,'reviewer_root');
  const provenancePolicy=exactDigest(artifact_provenance_policy_digest,'artifact_provenance_policy');
  const seed={
    source_sha:checkedEnvelope.source_sha,
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    mutation_surface:surface,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
    artifact_provenance_policy_digest:provenancePolicy,
  };
  const seedHash=hash(seed);
  const experimentId=`rsi_exp_${seedHash.slice(0,24)}`;
  const targetBranch=`work/rsi/revision-${checkedEnvelope.source_sha.slice(0,8)}-${seedHash.slice(0,8)}`;
  const limits=Object.freeze({
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
    artifact_provenance_policy_digest:provenancePolicy,
    max_mutated_files:checkedEnvelope.max_mutated_files,
    max_edit_operations:checkedEnvelope.max_edit_operations,
    max_changed_bytes:checkedEnvelope.max_changed_bytes,
    protected_policy_roots_digest:digest(checkedEnvelope.protected_policy_roots),
    editable_scope_digest:checkedEnvelope.editable_scope_digest,
    preserved_behavior_digest:checkedEnvelope.preserved_behavior_digest,
    negative_evidence_root_digest:checkedEnvelope.negative_evidence_root_digest,
    regression_budget_digest:checkedEnvelope.regression_budget_digest,
    validation_plan_digest:checkedEnvelope.validation_plan_digest,
  });
  const constraints=Object.freeze([
    `exact_base_sha=${checkedEnvelope.source_sha}`,
    `revision_envelope_digest=${checkedEnvelope.envelope_digest}`,
    `revision_proposal_digest=${checkedProposal.proposal_digest}`,
    `approved_mutation_manifest_digest=${manifestDigest}`,
    `artifact_provenance_policy_digest=${provenancePolicy}`,
    `max_mutated_files=${limits.max_mutated_files}`,
    `max_edit_operations=${limits.max_edit_operations}`,
    `max_changed_bytes=${limits.max_changed_bytes}`,
    'existing_devos_scheduler_only',
    'existing_isolated_candidate_builder_only',
    'branch_local_only',
    'private_writable_layer_required',
    'no_host_repository_mount',
    'network_deny_by_default',
    'protected_policy_roots_immutable',
    'external_provenance_attestation_required',
    'external_signature_and_transparency_evidence_required',
    'no_candidate_self_attestation',
    'no_main_or_production_promotion',
    'no_direct_self_update',
    'no_live_process_self_modification',
    'no_second_scheduler',
    'no_blind_retry_after_ambiguous_effect',
    'external_materialization_receipt_required',
    'paired_validation_after_materialization_required',
  ]);
  const taskSpec=Object.freeze({
    schema:RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
    objective:`Materialize bounded RSI revision proposal ${checkedProposal.proposal_id} in the existing isolated candidate pipeline without changing protected policy roots.`,
    constraints,
    deliverable:'Produce one exact candidate SHA plus externally attested provenance-bound materialization receipt. Do not promote, install, activate, self-update, or bypass paired validation.',
    source_branch:'',
    target_branch:targetBranch,
    rsi:Object.freeze({
      experiment_id:experimentId,
      signal:'BOUNDED_REVISION_MATERIALIZATION',
      mutation_surface:surface,
      source_sha:checkedEnvelope.source_sha,
      shadow_only:true,
      revision_envelope_digest:checkedEnvelope.envelope_digest,
      revision_proposal_digest:checkedProposal.proposal_digest,
      revision_limits:limits,
    }),
  });
  const plan={
    schema:RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
    experiment_id:experimentId,
    source_sha:checkedEnvelope.source_sha,
    target_branch:targetBranch,
    hypothesis_id:null,
    hypothesis_digest:null,
    task_spec:taskSpec,
    requires_existing_devos_scheduler:true,
    lease_created:false,
    agent_assigned:false,
    workspace_bound:false,
    command_created:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  plan.plan_digest=hash(plan);
  const core={
    schema:RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA,
    version:1,
    source_sha:checkedEnvelope.source_sha,
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    approved_mutations:approved,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
    artifact_provenance_policy_digest:provenancePolicy,
    mutation_surface:surface,
    revision_limits:limits,
    devos_experiment_plan:Object.freeze(plan),
    provenance_predicate_type:SLSA_PREDICATE,
    external_implementation_reviewer:true,
    authored_by_optimizer:false,
    uses_existing_devos_scheduler:true,
    uses_existing_isolated_candidate_builder:true,
    bridge_can_create_workspace:false,
    bridge_can_materialize_candidate:false,
    bridge_can_execute_commands:false,
    bridge_can_promote:false,
    candidate_can_self_attest:false,
    second_scheduler_created:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,bridge_digest:digest(core)});
}

export function verifyRsiBoundedRevisionDevosBridge(bridge,{envelope,proposal,experiment_intent,experiment_receipt}={}){
  const row=verifyDigestObject(bridge,RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA,'bridge_digest','bridge');
  if(row.external_implementation_reviewer!==true||row.authored_by_optimizer!==false
    ||row.uses_existing_devos_scheduler!==true||row.uses_existing_isolated_candidate_builder!==true
    ||row.bridge_can_create_workspace!==false||row.bridge_can_materialize_candidate!==false
    ||row.bridge_can_execute_commands!==false||row.bridge_can_promote!==false
    ||row.candidate_can_self_attest!==false||row.second_scheduler_created!==false
    ||row.provenance_predicate_type!==SLSA_PREDICATE)throw new Error('rsi_revision_bridge_policy_invalid');
  const canonical=createRsiBoundedRevisionDevosBridge({
    envelope,proposal,experiment_intent,experiment_receipt,
    mutation_surface:row.mutation_surface,
    approved_mutations:row.approved_mutations,
    approved_mutation_manifest_digest:row.approved_mutation_manifest_digest,
    implementation_reviewer_root_digest:row.implementation_reviewer_root_digest,
    artifact_provenance_policy_digest:row.artifact_provenance_policy_digest,
    external_implementation_reviewer:true,
  });
  if(canonical.bridge_digest!==row.bridge_digest)throw new Error('rsi_revision_bridge_digest_mismatch');
  return canonical;
}

export function createRsiBoundedRevisionArtifactReceipt({
  receipt_id,
  bridge,
  envelope,
  proposal,
  experiment_intent,
  experiment_receipt,
  build_plan,
  materialization_receipt,
  builder_identity_digest,
  worker_image_digest,
  toolchain_digest,
  dependency_materials_digest,
  build_definition_digest,
  artifact_digest,
  provenance_attestation_digest,
  signature_bundle_digest,
  transparency_log_entry_digest,
  reproducibility_evidence_digest,
  hermetic_build=false,
  network_denied=false,
  external_attestor=false,
  authored_by_candidate=true,
}={}){
  if(external_attestor!==true||authored_by_candidate!==false)throw new Error('rsi_revision_bridge_external_attestor_required');
  const checkedBridge=verifyRsiBoundedRevisionDevosBridge(bridge,{envelope,proposal,experiment_intent,experiment_receipt});
  verifyRsiIsolatedCandidateBuildPlan(build_plan);
  if(build_plan.experiment_id!==checkedBridge.devos_experiment_plan.experiment_id
    ||build_plan.source?.parent_sha!==checkedBridge.source_sha
    ||build_plan.target_branch!==checkedBridge.devos_experiment_plan.target_branch)throw new Error('rsi_revision_bridge_build_plan_binding_mismatch');
  const buildManifestDigest=digest(build_plan.mutation_manifest);
  if(buildManifestDigest!==checkedBridge.approved_mutation_manifest_digest)throw new Error('rsi_revision_bridge_build_mutation_manifest_mismatch');
  const limits=build_plan.materialization_contract?.revision_limits;
  if(!limits
    ||limits.envelope_digest!==checkedBridge.envelope_digest
    ||limits.proposal_digest!==checkedBridge.proposal_digest
    ||limits.approved_mutation_manifest_digest!==checkedBridge.approved_mutation_manifest_digest
    ||limits.implementation_reviewer_root_digest!==checkedBridge.implementation_reviewer_root_digest
    ||limits.artifact_provenance_policy_digest!==checkedBridge.artifact_provenance_policy_digest)throw new Error('rsi_revision_bridge_build_revision_limits_mismatch');
  const handoff=finalizeRsiIsolatedCandidateBuild({build_plan,materialization_receipt});
  if(handoff.eligible_for_evaluation!==true||handoff.eligible_for_promotion!==false||handoff.authority_effect!==false)throw new Error('rsi_revision_bridge_candidate_handoff_policy_invalid');
  const workspaceId=String(materialization_receipt?.workspace?.workspace_id||'').toLowerCase();
  const bindings=materialization_receipt?.workspace?.binding_snapshot?.bindings;
  const matches=Array.isArray(bindings)?bindings.filter(x=>String(x?.workspace_id||'').toLowerCase()===workspaceId):[];
  if(matches.length!==1)throw new Error('rsi_revision_bridge_workspace_binding_missing');
  const binding=matches[0];
  const workspaceGeneration=positiveInt(binding.workspace_generation,'workspace_generation');
  const leaseGeneration=positiveInt(binding.lease_generation,'lease_generation');
  const materializedOps=positiveInt(materialization_receipt.materialized_edit_operations,'materialized_edit_operations');
  if(materializedOps>checkedBridge.revision_limits.max_edit_operations)throw new Error('rsi_revision_bridge_edit_operation_budget_exceeded');
  const core={
    schema:RSI_BOUNDED_REVISION_ARTIFACT_RECEIPT_SCHEMA,
    version:1,
    receipt_id:String(receipt_id||'').trim(),
    source_sha:checkedBridge.source_sha,
    candidate_sha:handoff.candidate_sha,
    target_branch:handoff.target_branch,
    envelope_digest:checkedBridge.envelope_digest,
    proposal_digest:checkedBridge.proposal_digest,
    bridge_digest:checkedBridge.bridge_digest,
    build_plan_digest:build_plan.plan_digest,
    candidate_handoff_digest:handoff.handoff_digest,
    approved_mutation_manifest_digest:checkedBridge.approved_mutation_manifest_digest,
    artifact_provenance_policy_digest:checkedBridge.artifact_provenance_policy_digest,
    workspace_id:workspaceId,
    workspace_generation:workspaceGeneration,
    lease_generation:leaseGeneration,
    materialized_file_count:Number(materialization_receipt.materialized_file_count),
    materialized_edit_operations:materializedOps,
    materialized_bytes:Number(materialization_receipt.materialized_bytes),
    output_manifest_digest:exactDigest(materialization_receipt.output_manifest_digest,'output_manifest'),
    provenance_predicate_type:SLSA_PREDICATE,
    builder_identity_digest:exactDigest(builder_identity_digest,'builder_identity'),
    worker_image_digest:exactDigest(worker_image_digest,'worker_image'),
    toolchain_digest:exactDigest(toolchain_digest,'toolchain'),
    dependency_materials_digest:exactDigest(dependency_materials_digest,'dependency_materials'),
    build_definition_digest:exactDigest(build_definition_digest,'build_definition'),
    artifact_digest:exactDigest(artifact_digest,'artifact'),
    provenance_attestation_digest:exactDigest(provenance_attestation_digest,'provenance_attestation'),
    signature_bundle_digest:exactDigest(signature_bundle_digest,'signature_bundle'),
    transparency_log_entry_digest:exactDigest(transparency_log_entry_digest,'transparency_log_entry'),
    reproducibility_evidence_digest:exactDigest(reproducibility_evidence_digest,'reproducibility_evidence'),
    hermetic_build:hermetic_build===true,
    network_denied:network_denied===true,
    exact_source_bound:true,
    exact_workspace_lease_bound:true,
    exact_builder_materials_bound:true,
    signature_identity_bound:true,
    transparency_inclusion_required:true,
    candidate_self_attestation_accepted:false,
    candidate_artifact_is_active:false,
    candidate_artifact_replaces_parent:false,
    eligible_for_fresh_paired_evaluation:true,
    eligible_for_promotion:false,
    external_attestor:true,
    authored_by_candidate:false,
    second_builder_created:false,
    second_scheduler_created:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  if(!core.receipt_id)throw new Error('rsi_revision_bridge_receipt_id_required');
  if(core.hermetic_build!==true||core.network_denied!==true)throw new Error('rsi_revision_bridge_build_isolation_required');
  return Object.freeze({...core,artifact_receipt_digest:digest(core)});
}

export function verifyRsiBoundedRevisionArtifactReceipt(row,args={}){
  const receipt=verifyDigestObject(row,RSI_BOUNDED_REVISION_ARTIFACT_RECEIPT_SCHEMA,'artifact_receipt_digest','artifact_receipt');
  if(receipt.provenance_predicate_type!==SLSA_PREDICATE
    ||receipt.hermetic_build!==true||receipt.network_denied!==true
    ||receipt.exact_source_bound!==true||receipt.exact_workspace_lease_bound!==true
    ||receipt.exact_builder_materials_bound!==true||receipt.signature_identity_bound!==true
    ||receipt.transparency_inclusion_required!==true
    ||receipt.candidate_self_attestation_accepted!==false
    ||receipt.candidate_artifact_is_active!==false
    ||receipt.candidate_artifact_replaces_parent!==false
    ||receipt.eligible_for_fresh_paired_evaluation!==true
    ||receipt.eligible_for_promotion!==false
    ||receipt.external_attestor!==true||receipt.authored_by_candidate!==false
    ||receipt.second_builder_created!==false||receipt.second_scheduler_created!==false)throw new Error('rsi_revision_bridge_artifact_receipt_policy_invalid');
  const canonical=createRsiBoundedRevisionArtifactReceipt({
    ...args,
    receipt_id:receipt.receipt_id,
    builder_identity_digest:receipt.builder_identity_digest,
    worker_image_digest:receipt.worker_image_digest,
    toolchain_digest:receipt.toolchain_digest,
    dependency_materials_digest:receipt.dependency_materials_digest,
    build_definition_digest:receipt.build_definition_digest,
    artifact_digest:receipt.artifact_digest,
    provenance_attestation_digest:receipt.provenance_attestation_digest,
    signature_bundle_digest:receipt.signature_bundle_digest,
    transparency_log_entry_digest:receipt.transparency_log_entry_digest,
    reproducibility_evidence_digest:receipt.reproducibility_evidence_digest,
    hermetic_build:true,
    network_denied:true,
    external_attestor:true,
    authored_by_candidate:false,
  });
  if(canonical.artifact_receipt_digest!==receipt.artifact_receipt_digest)throw new Error('rsi_revision_bridge_artifact_receipt_mismatch');
  return canonical;
}


export function rsiBoundedRevisionDevosBridgeTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.bounded-revision-devos-bridge-root.v1',
    version:1,
    existing_devos_scheduler_only:true,
    existing_isolated_candidate_builder_only:true,
    second_scheduler_allowed:false,
    second_builder_allowed:false,
    exact_phase27_envelope_required:true,
    exact_phase27_proposal_required:true,
    approved_mutation_manifest_required:true,
    bounded_files_operations_bytes_required:true,
    protected_policy_roots_immutable:true,
    private_writable_layer_required:true,
    host_repository_mount_allowed:false,
    network_deny_by_default_required:true,
    provenance_predicate_type:SLSA_PREDICATE,
    external_provenance_attestation_required:true,
    external_signature_bundle_required:true,
    transparency_log_inclusion_required:true,
    candidate_self_attestation_allowed:false,
    builder_identity_binding_required:true,
    worker_image_binding_required:true,
    toolchain_binding_required:true,
    dependency_materials_binding_required:true,
    build_definition_binding_required:true,
    workspace_generation_binding_required:true,
    lease_generation_binding_required:true,
    fresh_paired_evaluation_required:true,
    direct_active_replacement_allowed:false,
    direct_promotion_allowed:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,bridge_root_digest:digest(root)});
}
