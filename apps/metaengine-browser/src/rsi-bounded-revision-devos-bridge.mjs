import crypto from 'node:crypto';

import { RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import { RSI_MUTATION_SURFACES } from './rsi-shadow-core.mjs';
import {
  RSI_REVISION_ENVELOPE_SCHEMA,
  RSI_REVISION_PROPOSAL_SCHEMA,
  verifyRsiBoundedRevisionEnvelope,
  verifyRsiBoundedRevisionProposal,
} from './rsi-bounded-revision-proposal.mjs';

export const RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA='metaengine.rsi.bounded-revision-devos-bridge.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CHANGE_TYPES=new Set(['CREATE','MODIFY','DELETE']);

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function digest(v){return `sha256:${hash(v)}`;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_revision_bridge_${l}_digest_invalid`);return x;}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_revision_bridge_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_revision_bridge_${l}_retry_invalid`);}
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
function branchSlug(value){
  return String(value||'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-').slice(0,120)||'revision';
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
  const seed={
    source_sha:checkedEnvelope.source_sha,
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    mutation_surface:surface,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
  };
  const seedHash=hash(seed);
  const experimentId=`rsi_exp_${seedHash.slice(0,24)}`;
  const targetBranch=`work/rsi/revision-${checkedEnvelope.source_sha.slice(0,8)}-${seedHash.slice(0,8)}`;
  const limits=Object.freeze({
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
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
    deliverable:'Produce one exact candidate SHA and materialization receipt in the existing isolated DevOS workspace plane. Do not promote, install, activate, self-update, or bypass paired validation.',
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
    mutation_surface:surface,
    revision_limits:limits,
    devos_experiment_plan:Object.freeze(plan),
    external_implementation_reviewer:true,
    authored_by_optimizer:false,
    uses_existing_devos_scheduler:true,
    uses_existing_isolated_candidate_builder:true,
    bridge_can_create_workspace:false,
    bridge_can_materialize_candidate:false,
    bridge_can_execute_commands:false,
    bridge_can_promote:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,bridge_digest:digest(core)});
}

export function verifyRsiBoundedRevisionDevosBridge(bridge,{envelope,proposal,experiment_intent,experiment_receipt}={}){
  if(!bridge||bridge.schema!==RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA||bridge.version!==1)throw new Error('rsi_revision_bridge_invalid');
  assertZero(bridge,'bridge');
  if(bridge.external_implementation_reviewer!==true||bridge.authored_by_optimizer!==false
    ||bridge.uses_existing_devos_scheduler!==true||bridge.uses_existing_isolated_candidate_builder!==true
    ||bridge.bridge_can_create_workspace!==false||bridge.bridge_can_materialize_candidate!==false
    ||bridge.bridge_can_execute_commands!==false||bridge.bridge_can_promote!==false)throw new Error('rsi_revision_bridge_policy_invalid');
  const canonical=createRsiBoundedRevisionDevosBridge({
    envelope,proposal,experiment_intent,experiment_receipt,
    mutation_surface:bridge.mutation_surface,
    approved_mutations:bridge.approved_mutations,
    approved_mutation_manifest_digest:bridge.approved_mutation_manifest_digest,
    implementation_reviewer_root_digest:bridge.implementation_reviewer_root_digest,
    external_implementation_reviewer:true,
  });
  if(canonical.bridge_digest!==exactDigest(bridge.bridge_digest,'bridge'))throw new Error('rsi_revision_bridge_digest_mismatch');
  return canonical;
}
