export const BROWSER_CELL_SCHEMA = 'metaengine.browser-fabric.browser-cell.v1';
export const BROWSER_CELL_TYPES = Object.freeze({
  HUMAN: 'HUMAN',
  AUTHENTICATED_WORKER: 'AUTHENTICATED_WORKER',
  EPHEMERAL_RESEARCH: 'EPHEMERAL_RESEARCH',
  RECOVERY_PROBE: 'RECOVERY_PROBE',
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const ALLOWED_RECOVERY_ACTIONS = new Set(['HEALTH', 'VERSION_READBACK', 'OWNER_SESSION_HANDSHAKE', 'TARGET_READBACK']);
const FORBIDDEN_LOW_TRUST_ACTIONS = new Set(['SEND', 'SUBMIT', 'PUBLISH_RELEASE', 'INSTALL', 'WTS_SPAWN', 'SCM_MUTATE', 'CLAIM_TASK']);

function hold(reason, extra = {}) {
  return Object.freeze({
    ok: false,
    action: 'HOLD',
    reason,
    fleet_capacity_delta: 0,
    browser_effect_allowed: false,
    send_allowed: false,
    process_effect_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

function safe(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function arrayOfSafeStrings(value, { allowEmpty = false } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((row) => typeof row === 'string' && row.length > 0 && row.length <= 512);
}

function ttlValid(cell, nowMs) {
  if (cell.type === BROWSER_CELL_TYPES.HUMAN) return cell.expires_at == null;
  if (typeof cell.expires_at !== 'string') return false;
  const expires = Date.parse(cell.expires_at);
  return Number.isFinite(expires) && expires > nowMs;
}

/**
 * Validate the target BrowserCell domain object. This intentionally does not
 * create a BrowserContext or attach a target; it is an admission boundary.
 */
export function admitBrowserCell({ cell, claim = null, capability = null, now = new Date() } = {}) {
  if (!cell || cell.schema !== BROWSER_CELL_SCHEMA) return hold('CELL_SCHEMA_INVALID');
  if (!Object.values(BROWSER_CELL_TYPES).includes(cell.type)) return hold('CELL_TYPE_INVALID');
  if (!safe(cell.cell_id) || !safe(cell.browser_context_id)) return hold('CELL_IDENTITY_INVALID');
  if (cell.isolated_from_human !== true) return hold('CELL_HUMAN_ISOLATION_UNPROVEN');
  if (cell.active_claim_count !== 0 && cell.active_claim_count !== 1) return hold('CELL_CLAIM_CARDINALITY_INVALID');
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs) || !ttlValid(cell, nowMs)) return hold('CELL_TTL_INVALID_OR_EXPIRED');

  if (cell.type === BROWSER_CELL_TYPES.HUMAN) {
    if (claim != null || cell.active_claim_count !== 0 || cell.fleet_capacity !== false) return hold('HUMAN_CELL_FLEET_FORBIDDEN');
    if (cell.persistent_partition !== true) return hold('HUMAN_CELL_PROFILE_EXPECTED');
    return Object.freeze({
      ok: true,
      action: 'HUMAN_CONTEXT_ONLY',
      reason: 'HUMAN_CELL_EXCLUDED_FROM_FLEET',
      cell_id: cell.cell_id,
      fleet_capacity_delta: 0,
      browser_effect_allowed: false,
      send_allowed: false,
      process_effect_allowed: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  if (!claim || typeof claim !== 'object') return hold('CELL_CLAIM_REQUIRED');
  if (!safe(claim.task_id) || !Number.isSafeInteger(claim.claim_generation) || claim.claim_generation <= 0) {
    return hold('CELL_CLAIM_IDENTITY_INVALID');
  }
  if (cell.active_claim_count === 1 && cell.active_task_id !== claim.task_id) return hold('CELL_ALREADY_OWNS_DIFFERENT_CLAIM');
  if (cell.active_claim_count === 1 && cell.active_claim_generation !== claim.claim_generation) return hold('CELL_CLAIM_GENERATION_DRIFT');
  if (claim.browser_context_id !== cell.browser_context_id) return hold('CELL_CONTEXT_BINDING_MISMATCH');

  if (cell.type === BROWSER_CELL_TYPES.AUTHENTICATED_WORKER) {
    if (cell.persistent_partition !== true || !safe(cell.storage_partition_id)) return hold('WORKER_PERSISTENT_PARTITION_REQUIRED');
    if (!capability?.ok || capability.execution_authorized !== true) return hold('WORKER_CAPABILITY_UNVERIFIED');
    const material = capability.ledger_material;
    if (!material
        || material.task_id !== claim.task_id
        || material.claim_generation !== claim.claim_generation
        || material.browser_context_id !== cell.browser_context_id) {
      return hold('WORKER_CAPABILITY_CLAIM_MISMATCH');
    }
    if (!safe(claim.target_id) || !safe(claim.target_incarnation)
        || material.target_id !== claim.target_id
        || material.target_incarnation !== claim.target_incarnation) {
      return hold('WORKER_EXACT_TARGET_UNPROVEN');
    }
    return Object.freeze({
      ok: true,
      action: 'ADMIT_AUTHENTICATED_WORKER_CLAIM',
      reason: 'CELL_CLAIM_AND_CAPABILITY_EXACT',
      cell_id: cell.cell_id,
      task_id: claim.task_id,
      claim_generation: claim.claim_generation,
      browser_context_id: cell.browser_context_id,
      target_id: claim.target_id,
      target_incarnation: claim.target_incarnation,
      one_claim_per_cell: true,
      fleet_capacity_delta: cell.active_claim_count === 0 ? 1 : 0,
      browser_effect_allowed: false,
      send_allowed: false,
      process_effect_allowed: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  if (cell.persistent_partition !== false) return hold('LOW_TRUST_CELL_MUST_BE_NON_PERSISTENT');
  if (cell.user_data_allowed !== false || cell.prompt_access_allowed !== false) return hold('LOW_TRUST_USER_DATA_FORBIDDEN');
  if (cell.send_allowed !== false) return hold('LOW_TRUST_SEND_FORBIDDEN');

  if (cell.type === BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH) {
    if (cell.read_only !== true || !arrayOfSafeStrings(cell.network_allowlist)) return hold('RESEARCH_CELL_READ_ONLY_ALLOWLIST_REQUIRED');
    const requested = Array.isArray(claim.requested_actions) ? claim.requested_actions : [];
    if (requested.length === 0 || requested.some((action) => FORBIDDEN_LOW_TRUST_ACTIONS.has(action))) {
      return hold('RESEARCH_CELL_ACTION_SCOPE_INVALID');
    }
    return Object.freeze({
      ok: true,
      action: 'ADMIT_EPHEMERAL_RESEARCH_CLAIM',
      reason: 'RESEARCH_CELL_ISOLATED_READ_ONLY',
      cell_id: cell.cell_id,
      task_id: claim.task_id,
      destroy_after_evidence_upload: true,
      network_allowlist: Object.freeze([...cell.network_allowlist]),
      fleet_capacity_delta: cell.active_claim_count === 0 ? 1 : 0,
      browser_effect_allowed: false,
      send_allowed: false,
      process_effect_allowed: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  if (cell.type === BROWSER_CELL_TYPES.RECOVERY_PROBE) {
    const requested = Array.isArray(claim.requested_actions) ? claim.requested_actions : [];
    if (requested.length === 0 || requested.some((action) => !ALLOWED_RECOVERY_ACTIONS.has(action))) {
      return hold('RECOVERY_PROBE_ACTION_SCOPE_INVALID');
    }
    if (arrayOfSafeStrings(cell.network_allowlist, { allowEmpty: true }) === false) return hold('RECOVERY_PROBE_ALLOWLIST_INVALID');
    return Object.freeze({
      ok: true,
      action: 'ADMIT_RECOVERY_PROBE',
      reason: 'RECOVERY_PROBE_EFFECT_POOR',
      cell_id: cell.cell_id,
      task_id: claim.task_id,
      health_readback_only: true,
      destroy_after_readback: true,
      fleet_capacity_delta: 0,
      browser_effect_allowed: false,
      send_allowed: false,
      process_effect_allowed: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  return hold('CELL_TYPE_UNREACHABLE');
}

export function browserCellContract() {
  return Object.freeze({
    schema: BROWSER_CELL_SCHEMA,
    durable_unit: 'CLAIM_EFFECT_IDENTITY',
    execution_unit: 'BROWSER_CELL',
    one_claim_per_cell: true,
    separate_browser_context_required: true,
    human_cell_in_fleet_capacity: false,
    authenticated_worker_persistent_partition: true,
    ephemeral_research_non_persistent: true,
    ephemeral_research_read_only: true,
    recovery_probe_user_data_allowed: false,
    recovery_probe_send_allowed: false,
    shared_profile_fleet_forbidden: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
