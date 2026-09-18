export const NATIVE_SUPERVISOR_RUNTIME_CAPABILITY_SCHEMA = 'metaengine.native-browser-supervisor.capabilities.v1';
export const NATIVE_SUPERVISOR_PROTOCOL_GENERATION = 2;

export const NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES = Object.freeze({
  schema: NATIVE_SUPERVISOR_RUNTIME_CAPABILITY_SCHEMA,
  protocol_generation: NATIVE_SUPERVISOR_PROTOCOL_GENERATION,
  features: Object.freeze({
    signed_device_auth_v1: true,
    typed_commands_only_v1: true,
    devos_cycle_v1: true,
    devos_ambiguity_reconcile_v2: true,
    devos_transport_promotion_v1: true,
    devos_scheduler_capacity_v1: true,
    meta_orchestrator_superstep_v1: true,
    meta_orchestrator_controller_lease_v1: true,
    meta_atomic_frontier_v2: true,
    post_lock_transport_revalidation_v1: true,
  }),
  ambiguity_recovery_classes: Object.freeze(['PRE_EFFECT_ABORTED', 'EFFECT_PROVEN']),
  scheduler_source: 'NATIVE_SUPERVISOR_HEARTBEAT',
  second_scheduler_loop: false,
  automatic_retry_allowed: false,
  arbitrary_eval: false,
  page_model_text_authority: false,
  authority_effect: false,
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function exactRuntimeAttestation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('native_runtime_capability_attestation_invalid');
  const expected = JSON.stringify(stable(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES));
  const actual = JSON.stringify(stable(value));
  if (actual !== expected) throw new Error('native_runtime_capability_attestation_drift');
  return NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES;
}

export async function probeNativeSupervisorRuntimeCapabilities({ rpc } = {}) {
  if (typeof rpc !== 'function') throw new Error('native_runtime_capability_rpc_required');
  const attested = await rpc('devos_runtime_capabilities_v1', {});
  return exactRuntimeAttestation(attested);
}

export function validateDevosRecoveryDebtSnapshot(value, { workspaceId } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('devos_recovery_debt_invalid');
  if (value.schema !== 'metaengine.devos.recovery-debt.v1') throw new Error('devos_recovery_debt_schema_invalid');
  if (workspaceId && String(value.workspace_id || '').toLowerCase() !== String(workspaceId).toLowerCase()) throw new Error('devos_recovery_debt_workspace_drift');
  const fields = ['ambiguous_total','effect_proven_count','effect_unknown_count','lease_expired_effect_unknown_count','ready_backlog','inflight_backlog','active_claims'];
  const out = {};
  for (const field of fields) {
    const n = Number(value[field]);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`devos_recovery_debt_${field}_invalid`);
    out[field] = n;
  }
  if (out.effect_proven_count + out.effect_unknown_count !== out.ambiguous_total) throw new Error('devos_recovery_debt_partition_invalid');
  if (!['CLEAR','EFFECT_PROVEN_ONLY','EFFECT_UNKNOWN_PRESENT'].includes(String(value.state || ''))) throw new Error('devos_recovery_debt_state_invalid');
  if (value.task_content_returned !== false || value.physical_effect_replayed !== false || value.automatic_retry_allowed !== false || value.scheduler_authority !== false || value.browser_authority !== false || value.release_authority !== false || value.authority_effect !== false) throw new Error('devos_recovery_debt_authority_invalid');
  return Object.freeze({ schema: value.schema, workspace_id: value.workspace_id, state: value.state, ...out, task_content_returned: false, physical_effect_replayed: false, automatic_retry_allowed: false, scheduler_authority: false, browser_authority: false, release_authority: false, authority_effect: false });
}
