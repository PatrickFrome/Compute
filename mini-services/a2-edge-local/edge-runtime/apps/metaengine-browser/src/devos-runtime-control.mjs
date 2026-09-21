export const DEVOS_ENVIRONMENT_STATE_SCHEMA = 'metaengine.devos.environment-state.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function unavailableDevosRuntimeControl(reason = 'NOT_OBSERVED') {
  return Object.freeze({
    schema: DEVOS_ENVIRONMENT_STATE_SCHEMA,
    state: 'UNAVAILABLE',
    reason: String(reason || 'NOT_OBSERVED').slice(0, 160),
    workspace_id: null,
    generation_floor: null,
    refill_enabled: null,
    supervisor_admission_enabled: null,
    continuous_service_allowed: false,
    authoritative: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function normalizeDevosRuntimeControl(value, { workspaceId = null } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return unavailableDevosRuntimeControl('READBACK_MISSING');
  }
  if (String(value.schema || '') !== DEVOS_ENVIRONMENT_STATE_SCHEMA || value.authority_effect !== false) {
    return unavailableDevosRuntimeControl('READBACK_SCHEMA_INVALID');
  }
  const observedWorkspace = String(value.workspace_id || '').toLowerCase();
  const expectedWorkspace = workspaceId == null ? null : String(workspaceId).toLowerCase();
  const generationFloor = value.generation_floor;
  if (!UUID_RE.test(observedWorkspace)
    || (expectedWorkspace != null && observedWorkspace !== expectedWorkspace)
    || typeof generationFloor !== 'number'
    || !Number.isSafeInteger(generationFloor)
    || generationFloor < 0
    || typeof value.refill_enabled !== 'boolean'
    || typeof value.supervisor_admission_enabled !== 'boolean') {
    return unavailableDevosRuntimeControl('READBACK_FIELDS_INVALID');
  }
  const allowed = value.refill_enabled === true && value.supervisor_admission_enabled === true;
  return Object.freeze({
    schema: DEVOS_ENVIRONMENT_STATE_SCHEMA,
    state: allowed ? 'OPEN' : 'CLOSED',
    reason: allowed ? null : 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
    workspace_id: observedWorkspace,
    generation_floor: generationFloor,
    refill_enabled: value.refill_enabled,
    supervisor_admission_enabled: value.supervisor_admission_enabled,
    reset_at: value.reset_at || null,
    reset_reason: value.reset_reason ? String(value.reset_reason).slice(0, 240) : null,
    continuous_service_allowed: allowed,
    authoritative: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function devosRuntimeControlAllowsContinuousService(value) {
  return value?.schema === DEVOS_ENVIRONMENT_STATE_SCHEMA
    && value?.authoritative === true
    && value?.state === 'OPEN'
    && value?.continuous_service_allowed === true
    && value?.refill_enabled === true
    && value?.supervisor_admission_enabled === true;
}
