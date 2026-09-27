export const DEVOS_RECOVERY_DEBT_PRESSURE_SCHEMA = 'metaengine.devos.recovery-debt-pressure.v1';

function integer(value, name, max = 10_000_000) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) {
    throw new Error(`devos_recovery_pressure_${name}_invalid`);
  }
  return out;
}

export function validateDevosRecoveryDebtPressure(value, { workspaceId } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('devos_recovery_pressure_invalid');
  }
  if (value.schema !== DEVOS_RECOVERY_DEBT_PRESSURE_SCHEMA) {
    throw new Error('devos_recovery_pressure_schema_invalid');
  }
  if (workspaceId && String(value.workspace_id || '').toLowerCase() !== String(workspaceId).toLowerCase()) {
    throw new Error('devos_recovery_pressure_workspace_drift');
  }
  if (!['CLEAR', 'EFFECT_UNKNOWN_PRESENT'].includes(String(value.state || ''))) {
    throw new Error('devos_recovery_pressure_state_invalid');
  }

  const ambiguousTotal = integer(value.ambiguous_total, 'ambiguous_total');
  const effectProvenCount = integer(value.effect_proven_count, 'effect_proven_count');
  const effectUnknownCount = integer(value.effect_unknown_count, 'effect_unknown_count');
  const unknown15m = integer(value.effect_unknown_last_15m, 'effect_unknown_last_15m');
  const unknown60m = integer(value.effect_unknown_last_60m, 'effect_unknown_last_60m');
  const oldestUnknownAge = integer(value.oldest_effect_unknown_age_seconds, 'oldest_effect_unknown_age_seconds', 315_360_000);

  if (effectProvenCount + effectUnknownCount !== ambiguousTotal) {
    throw new Error('devos_recovery_pressure_partition_invalid');
  }
  if (unknown15m > unknown60m || unknown60m > effectUnknownCount) {
    throw new Error('devos_recovery_pressure_window_invalid');
  }
  if ((effectUnknownCount === 0) !== (value.state === 'CLEAR')) {
    throw new Error('devos_recovery_pressure_state_count_drift');
  }
  if (effectUnknownCount === 0 && oldestUnknownAge !== 0) {
    throw new Error('devos_recovery_pressure_oldest_clear_invalid');
  }
  if (
    value.task_content_returned !== false
    || value.physical_effect_replayed !== false
    || value.automatic_retry_allowed !== false
    || value.scheduler_authority !== false
    || value.browser_authority !== false
    || value.release_authority !== false
    || value.authority_effect !== false
  ) {
    throw new Error('devos_recovery_pressure_authority_invalid');
  }

  return Object.freeze({
    schema: DEVOS_RECOVERY_DEBT_PRESSURE_SCHEMA,
    workspace_id: value.workspace_id,
    observed_at: value.observed_at ?? null,
    state: value.state,
    ambiguous_total: ambiguousTotal,
    effect_proven_count: effectProvenCount,
    effect_unknown_count: effectUnknownCount,
    effect_unknown_last_15m: unknown15m,
    effect_unknown_last_60m: unknown60m,
    oldest_effect_unknown_age_seconds: oldestUnknownAge,
    task_content_returned: false,
    physical_effect_replayed: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}

export async function probeDevosRecoveryDebtPressure({ rpc, workspaceId } = {}) {
  if (typeof rpc !== 'function') throw new Error('devos_recovery_pressure_rpc_required');
  if (!workspaceId) throw new Error('devos_recovery_pressure_workspace_required');
  const value = await rpc('devos_recovery_debt_pressure_v1', { p_workspace: workspaceId });
  return validateDevosRecoveryDebtPressure(value, { workspaceId });
}
