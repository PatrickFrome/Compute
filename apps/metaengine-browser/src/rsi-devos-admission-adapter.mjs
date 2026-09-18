
import crypto from 'node:crypto';

export const RSI_DEVOS_ADMISSION_ENVELOPE_SCHEMA = 'metaengine.rsi.devos-admission-envelope.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^(?:sha256:)?[0-9a-f]{64}$/;
const REQUEST_SCHEMA = 'metaengine.rsi.episode-devos-candidate-request.v1';
const CYCLE_SCHEMA = 'metaengine.rsi.autonomous-episode-runtime-cycle.v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function digestText(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function digestValue(value) {
  return digestText(stableJson(value));
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!DIGEST_RE.test(out)) throw new Error('rsi_admission_' + label + '_digest_invalid');
  return out.startsWith('sha256:') ? out.slice(7) : out;
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error('rsi_admission_' + label + '_sha_invalid');
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'browser_authority',
    'scheduler_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (Object.hasOwn(value || {}, field) && value[field] !== false) {
      throw new Error('rsi_admission_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_admission_' + label + '_automatic_retry_invalid');
  }
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function requestMaterial(request) {
  return {
    episode_id: request.episode_id,
    source_sha: request.source_sha,
    trust_root_set_digest: request.trust_root_set_digest,
    experiment_id: request.experiment_id,
    plan_digest: request.plan_digest,
    task_spec_digest: request.task_spec_digest,
    target_branch: request.target_branch,
    request_generation: request.request_generation,
  };
}

function verifyPreparedRequest(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('rsi_admission_request_row_invalid');
  const request = row.request;
  const variant = row.search_variant;
  if (!request || request.schema !== REQUEST_SCHEMA || request.version !== 1) throw new Error('rsi_admission_request_schema_invalid');
  assertZeroAuthority(request, 'request');
  if (
    request.requires_existing_devos_scheduler !== true
    || request.external_scheduler_owner_required !== true
    || request.dispatch_authorized !== false
    || request.lease_created !== false
    || request.workspace_created !== false
    || request.task_created !== false
    || request.one_attempt_effect_semantics_required !== true
    || request.ambiguous_result_requires_reconciliation !== true
    || request.repeat_after_ambiguous_result_allowed !== false
    || request.candidate_effect_executor_exposed !== false
  ) throw new Error('rsi_admission_request_policy_invalid');

  exactSha(request.source_sha, 'request_source');
  const material = requestMaterial(request);
  const materialJson = stableJson(material);
  const computedRequestDigest = digestText(materialJson);
  if (computedRequestDigest !== exactDigest(request.request_digest, 'request')) {
    throw new Error('rsi_admission_request_digest_mismatch');
  }

  const taskSpecJson = stableJson(request.task_spec);
  const computedTaskSpecDigest = digestText(taskSpecJson);
  if (computedTaskSpecDigest !== exactDigest(request.task_spec_digest, 'task_spec')) {
    throw new Error('rsi_admission_task_spec_digest_mismatch');
  }
  if (String(request.task_spec?.target_branch || '') !== String(request.target_branch || '')) {
    throw new Error('rsi_admission_target_branch_mismatch');
  }
  if (String(request.task_spec?.rsi?.source_sha || '').toLowerCase() !== String(request.source_sha || '').toLowerCase()) {
    throw new Error('rsi_admission_task_source_mismatch');
  }
  if (!String(request.target_branch || '').startsWith('work/rsi/')) {
    throw new Error('rsi_admission_target_branch_namespace_invalid');
  }

  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) throw new Error('rsi_admission_variant_invalid');
  if (
    variant.scheduler_action_authorized !== false
    || variant.candidate_can_choose_search_mode !== false
    || variant.authority_effect !== false
  ) throw new Error('rsi_admission_variant_policy_invalid');
  if (request.task_spec?.rsi?.search_variant?.variant_digest !== variant.variant_digest) {
    throw new Error('rsi_admission_variant_digest_mismatch');
  }
  if (request.task_spec?.rsi?.search_variant?.search_mode !== variant.search_mode) {
    throw new Error('rsi_admission_variant_mode_mismatch');
  }
  if (request.task_spec?.rsi?.search_variant?.allocation_role !== variant.allocation_role) {
    throw new Error('rsi_admission_variant_role_mismatch');
  }

  return Object.freeze({
    request,
    variant,
    request_material_canonical_json: materialJson,
    task_spec_canonical_json: taskSpecJson,
  });
}

export function createRsiDevosAdmissionEnvelopes({
  runtime_cycle,
  workspace_id,
  priority = 80,
} = {}) {
  if (!runtime_cycle || runtime_cycle.schema !== CYCLE_SCHEMA) throw new Error('rsi_admission_cycle_schema_invalid');
  assertZeroAuthority(runtime_cycle, 'cycle');
  if (
    runtime_cycle.existing_devos_scheduler_required !== true
    || runtime_cycle.scheduler_action_authorized !== false
    || runtime_cycle.task_created !== false
    || runtime_cycle.lease_created !== false
    || runtime_cycle.command_created !== false
  ) throw new Error('rsi_admission_cycle_policy_invalid');

  const workspaceId = String(workspace_id || '').trim().toLowerCase();
  if (!UUID_RE.test(workspaceId)) throw new Error('rsi_admission_workspace_id_invalid');
  const boundedPriority = Number(priority);
  if (!Number.isInteger(boundedPriority) || boundedPriority < 1 || boundedPriority > 100) {
    throw new Error('rsi_admission_priority_invalid');
  }

  const controllerPlan = runtime_cycle.controller_plan;
  if (!controllerPlan || typeof controllerPlan !== 'object') throw new Error('rsi_admission_controller_plan_missing');
  const controllerPlanDigest = exactDigest(controllerPlan.controller_plan_digest, 'controller_plan');
  const routingDigest = exactDigest(controllerPlan.routing_digest, 'routing');

  if (!Array.isArray(runtime_cycle.requests) || runtime_cycle.requests.length < 1 || runtime_cycle.requests.length > 2) {
    throw new Error('rsi_admission_request_count_invalid');
  }

  const envelopes = runtime_cycle.requests.map((row) => {
    const checked = verifyPreparedRequest(row);
    const core = zeroAuthority({
      schema: RSI_DEVOS_ADMISSION_ENVELOPE_SCHEMA,
      version: 1,
      rpc_name: 'rsi_devos_admit_prepared_request_v1',
      workspace_id: workspaceId,
      controller_plan_digest: controllerPlanDigest,
      routing_digest: routingDigest,
      request: checked.request,
      search_variant: checked.variant,
      request_material_canonical_json: checked.request_material_canonical_json,
      task_spec_canonical_json: checked.task_spec_canonical_json,
      priority: boundedPriority,
      existing_devos_scheduler_required: true,
      service_role_execution_required: true,
      runtime_control_admission_required: true,
      task_role: 'IMPLEMENTER',
      task_claim_class: 'MUTATING',
      task_creation_requested: true,
      task_creation_is_browser_effect: false,
      direct_browser_effect_enabled: false,
      admission_retry_idempotent_by_request_digest: true,
      downstream_physical_effect_retry_allowed: false,
    });
    return Object.freeze({ ...core, envelope_digest: digestValue(core) });
  });

  return Object.freeze(envelopes);
}

export function verifyRsiDevosAdmissionEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.schema !== RSI_DEVOS_ADMISSION_ENVELOPE_SCHEMA || envelope.version !== 1) {
    throw new Error('rsi_admission_envelope_schema_invalid');
  }
  assertZeroAuthority(envelope, 'envelope');
  if (
    envelope.rpc_name !== 'rsi_devos_admit_prepared_request_v1'
    || envelope.existing_devos_scheduler_required !== true
    || envelope.service_role_execution_required !== true
    || envelope.runtime_control_admission_required !== true
    || envelope.task_role !== 'IMPLEMENTER'
    || envelope.task_claim_class !== 'MUTATING'
    || envelope.task_creation_requested !== true
    || envelope.task_creation_is_browser_effect !== false
    || envelope.direct_browser_effect_enabled !== false
    || envelope.admission_retry_idempotent_by_request_digest !== true
    || envelope.downstream_physical_effect_retry_allowed !== false
  ) throw new Error('rsi_admission_envelope_policy_invalid');

  const workspaceId = String(envelope.workspace_id || '').toLowerCase();
  if (!UUID_RE.test(workspaceId)) throw new Error('rsi_admission_workspace_id_invalid');
  const checked = verifyPreparedRequest({ request: envelope.request, search_variant: envelope.search_variant });
  if (checked.request_material_canonical_json !== envelope.request_material_canonical_json) {
    throw new Error('rsi_admission_request_material_canonical_mismatch');
  }
  if (checked.task_spec_canonical_json !== envelope.task_spec_canonical_json) {
    throw new Error('rsi_admission_task_spec_canonical_mismatch');
  }
  exactDigest(envelope.controller_plan_digest, 'controller_plan');
  exactDigest(envelope.routing_digest, 'routing');
  const clone = structuredClone(envelope);
  const claimed = exactDigest(clone.envelope_digest, 'envelope');
  delete clone.envelope_digest;
  if (digestValue(clone) !== claimed) throw new Error('rsi_admission_envelope_digest_mismatch');
  return envelope;
}

export function rsiDevosAdmissionAdapterTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.devos-admission-adapter-root.v1',
    version: 1,
    adapter_path: 'apps/metaengine-browser/src/rsi-devos-admission-adapter.mjs',
    rpc_name: 'rsi_devos_admit_prepared_request_v1',
    rpc_migration_path: 'supabase/migrations/20260918171500_rsi_devos_prepared_request_admission_v1.sql',
    existing_devos_scheduler_required: true,
    service_role_execution_required: true,
    runtime_control_admission_required: true,
    idempotency_key_bound_to_request_digest: true,
    canonical_request_material_required: true,
    canonical_task_spec_required: true,
    candidate_can_choose_workspace: false,
    candidate_can_choose_role: false,
    candidate_can_choose_claim_class: false,
    candidate_can_bypass_runtime_control: false,
    direct_browser_effect_enabled: false,
    downstream_physical_effect_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, admission_adapter_root_digest: digestValue(root) });
}
