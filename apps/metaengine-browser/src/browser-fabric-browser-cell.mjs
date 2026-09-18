export const BROWSER_CELL_SCHEMA = 'metaengine.browser-fabric.browser-cell.v1';
export const BROWSER_CELL_TYPES = Object.freeze({
  HUMAN: 'HUMAN',
  AUTHENTICATED_WORKER: 'AUTHENTICATED_WORKER',
  EPHEMERAL_RESEARCH: 'EPHEMERAL_RESEARCH',
  RECOVERY_PROBE: 'RECOVERY_PROBE',
});

export const BROWSER_CELL_RUNTIME_READBACK_MAX_AGE_MS = 30_000;
export const BROWSER_CELL_LEDGER_RESERVATION_SCHEMA = 'metaengine.browser-fabric.capability-reservation.v1';
export const BROWSER_CELL_RESOURCE_BUDGET_LIMITS = Object.freeze({
  max_tabs: 16,
  max_targets: 32,
  max_memory_mb: 4096,
  max_wall_time_ms: 60 * 60_000,
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const PRIVATE_NAME_SUFFIXES = Object.freeze(['.internal', '.local', '.localhost', '.home', '.lan', '.onion']);
const RESERVATION_KEYS = new Set([
  'schema', 'effect_id', 'capability_digest', 'nonce', 'task_id',
  'claim_generation', 'cell_id', 'cell_generation', 'reservation_generation',
  'deadline', 'reserved', 'consumed', 'automatic_retry_allowed', 'authority_effect',
]);
const ALLOWED_RECOVERY_ACTIONS = new Set(['HEALTH', 'VERSION_READBACK', 'OWNER_SESSION_HANDSHAKE', 'TARGET_READBACK']);
const ALLOWED_RESEARCH_ACTIONS = new Set(['READ_WEB', 'NAVIGATE_ALLOWLISTED', 'CAPTURE_EVIDENCE', 'EXTRACT_PUBLIC_TEXT']);

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

function validHostname(value) {
  if (typeof value !== 'string' || value !== value.toLowerCase() || value.length > 253) return false;
  if (value === 'localhost' || value.endsWith('.localhost') || value.includes(':') || value.includes('/')) return false;
  if (IPV4_LITERAL.test(value) || PRIVATE_NAME_SUFFIXES.some((suffix) => value.endsWith(suffix))) return false;
  const labels = value.split('.');
  return labels.length >= 2 && labels.every((label) => HOST_LABEL.test(label));
}

function validNetworkAllowlist(value, { allowEmpty = false } = {}) {
  return Array.isArray(value)
    && value.length <= 32
    && (allowEmpty || value.length > 0)
    && new Set(value).size === value.length
    && value.every(validHostname);
}

export function validBrowserCellResourceBudget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(BROWSER_CELL_RESOURCE_BUDGET_LIMITS);
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) return false;
  const withinLimits = keys.every((key) => Number.isSafeInteger(value[key])
    && value[key] > 0
    && value[key] <= BROWSER_CELL_RESOURCE_BUDGET_LIMITS[key]);
  return withinLimits && value.max_targets >= value.max_tabs;
}

function ttlValid(cell, nowMs) {
  if (cell.type === BROWSER_CELL_TYPES.HUMAN) return cell.expires_at == null;
  if (typeof cell.expires_at !== 'string' || !UTC.test(cell.expires_at)) return false;
  const expires = Date.parse(cell.expires_at);
  return Number.isFinite(expires) && expires > nowMs;
}

function runtimeIdentityValid(cell, nowMs) {
  if (!Number.isSafeInteger(cell.cell_generation) || cell.cell_generation <= 0) return false;
  if (!safe(cell.browser_process_incarnation)) return false;
  if (!UTC.test(String(cell.runtime_observed_at || ''))) return false;
  const observedAt = Date.parse(cell.runtime_observed_at);
  return Number.isFinite(observedAt)
    && observedAt <= nowMs
    && nowMs - observedAt <= BROWSER_CELL_RUNTIME_READBACK_MAX_AGE_MS;
}

export function validateBrowserCellEnvelope(cell, { now = new Date() } = {}) {
  if (!cell || cell.schema !== BROWSER_CELL_SCHEMA) return 'CELL_SCHEMA_INVALID';
  if (!Object.values(BROWSER_CELL_TYPES).includes(cell.type)) return 'CELL_TYPE_INVALID';
  if (!safe(cell.cell_id) || !safe(cell.browser_context_id)) return 'CELL_IDENTITY_INVALID';
  if (cell.isolated_from_human !== true) return 'CELL_HUMAN_ISOLATION_UNPROVEN';
  if (cell.active_claim_count !== 0 && cell.active_claim_count !== 1) return 'CELL_CLAIM_CARDINALITY_INVALID';
  if (cell.active_claim_count === 0
      && (cell.active_task_id != null || cell.active_claim_generation != null)) return 'IDLE_CELL_HAS_ACTIVE_CLAIM_IDENTITY';
  if (cell.active_claim_count === 1
      && (!safe(cell.active_task_id)
        || !Number.isSafeInteger(cell.active_claim_generation)
        || cell.active_claim_generation <= 0)) return 'ACTIVE_CELL_CLAIM_IDENTITY_INVALID';
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs) || !ttlValid(cell, nowMs)) return 'CELL_TTL_INVALID_OR_EXPIRED';
  if (!runtimeIdentityValid(cell, nowMs)) return 'CELL_RUNTIME_IDENTITY_STALE_OR_INVALID';
  if (cell.type !== BROWSER_CELL_TYPES.HUMAN && !validBrowserCellResourceBudget(cell.resource_budget)) {
    return 'CELL_RESOURCE_BUDGET_INVALID';
  }
  if (cell.type !== BROWSER_CELL_TYPES.HUMAN
      && Date.parse(cell.expires_at) - nowMs > cell.resource_budget.max_wall_time_ms) {
    return 'CELL_WALL_TIME_BUDGET_EXCEEDED';
  }
  return null;
}

function claimIdentityViolation(cell, claim) {
  if (!claim || typeof claim !== 'object') return 'CELL_CLAIM_REQUIRED';
  if (!safe(claim.task_id) || !Number.isSafeInteger(claim.claim_generation) || claim.claim_generation <= 0) {
    return 'CELL_CLAIM_IDENTITY_INVALID';
  }
  if (cell.active_claim_count === 1 && cell.active_task_id !== claim.task_id) return 'CELL_ALREADY_OWNS_DIFFERENT_CLAIM';
  if (cell.active_claim_count === 1 && cell.active_claim_generation !== claim.claim_generation) return 'CELL_CLAIM_GENERATION_DRIFT';
  if (claim.browser_context_id !== cell.browser_context_id) return 'CELL_CONTEXT_BINDING_MISMATCH';
  if (claim.cell_generation !== cell.cell_generation
      || claim.browser_process_incarnation !== cell.browser_process_incarnation) {
    return 'CELL_RUNTIME_BINDING_MISMATCH';
  }
  return null;
}

function requestedActions(claim, allowed) {
  const requested = Array.isArray(claim.requested_actions) ? claim.requested_actions : [];
  if (requested.length === 0 || new Set(requested).size !== requested.length) return null;
  return requested.every((action) => allowed.has(action)) ? requested : null;
}

function admittedBase(cell, claim, action, reason, capacityDelta) {
  return {
    ok: true,
    action,
    reason,
    cell_id: cell.cell_id,
    task_id: claim == null ? undefined : claim.task_id,
    cell_generation: cell.cell_generation,
    browser_process_incarnation: cell.browser_process_incarnation,
    fleet_capacity_delta: capacityDelta,
    browser_effect_allowed: false,
    send_allowed: false,
    process_effect_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function admitHumanCell(cell, claim) {
  if (claim != null || cell.active_claim_count !== 0 || cell.fleet_capacity !== false) return hold('HUMAN_CELL_FLEET_FORBIDDEN');
  if (cell.persistent_partition !== true) return hold('HUMAN_CELL_PROFILE_EXPECTED');
  return Object.freeze(admittedBase(cell, null, 'HUMAN_CONTEXT_ONLY', 'HUMAN_CELL_EXCLUDED_FROM_FLEET', 0));
}

function workerCapabilityViolation(cell, claim, capability, nowMs) {
  if (!capability || capability.ok !== true || capability.execution_authorized !== true) return 'WORKER_CAPABILITY_UNVERIFIED';
  const material = capability.ledger_material;
  if (!material
      || material.task_id !== claim.task_id
      || material.claim_generation !== claim.claim_generation
      || material.browser_context_id !== cell.browser_context_id) {
    return 'WORKER_CAPABILITY_CLAIM_MISMATCH';
  }
  if (!safe(claim.target_id) || !safe(claim.target_incarnation)
      || material.target_id !== claim.target_id
      || material.target_incarnation !== claim.target_incarnation) {
    return 'WORKER_EXACT_TARGET_UNPROVEN';
  }
  if (!UTC.test(String(material.deadline || '')) || Date.parse(material.deadline) <= nowMs) {
    return 'WORKER_CAPABILITY_EXPIRED';
  }
  return null;
}

function workerReservationViolation(cell, claim, capability, reservation) {
  if (!reservation
      || Object.keys(reservation).length !== RESERVATION_KEYS.size
      || !Object.keys(reservation).every((key) => RESERVATION_KEYS.has(key))
      || reservation.schema !== BROWSER_CELL_LEDGER_RESERVATION_SCHEMA
      || reservation.reserved !== true
      || reservation.consumed !== false
      || reservation.authority_effect !== false
      || reservation.automatic_retry_allowed !== false) return 'WORKER_SINGLE_USE_RESERVATION_REQUIRED';
  const material = capability.ledger_material;
  if (reservation.effect_id !== material.effect_id
      || reservation.capability_digest !== material.capability_digest
      || reservation.nonce !== material.nonce
      || reservation.task_id !== claim.task_id
      || reservation.claim_generation !== claim.claim_generation
      || reservation.cell_id !== cell.cell_id
      || reservation.cell_generation !== cell.cell_generation
      || reservation.deadline !== material.deadline) return 'WORKER_SINGLE_USE_RESERVATION_BINDING_MISMATCH';
  return Number.isSafeInteger(reservation.reservation_generation) && reservation.reservation_generation > 0
    ? null
    : 'WORKER_SINGLE_USE_RESERVATION_GENERATION_INVALID';
}

function admitWorkerCell(cell, claim, capability, ledgerReservation, nowMs) {
  if (cell.fleet_capacity !== true) return hold('WORKER_FLEET_CAPACITY_UNPROVEN');
  if (cell.persistent_partition !== true || !safe(cell.storage_partition_id)) return hold('WORKER_PERSISTENT_PARTITION_REQUIRED');
  const violation = workerCapabilityViolation(cell, claim, capability, nowMs);
  if (violation) return hold(violation);
  const reservationViolation = workerReservationViolation(cell, claim, capability, ledgerReservation);
  if (reservationViolation) return hold(reservationViolation);
  return Object.freeze({
    ...admittedBase(cell, claim, 'ADMIT_AUTHENTICATED_WORKER_CLAIM', 'CELL_CLAIM_AND_CAPABILITY_EXACT', cell.active_claim_count === 0 ? 1 : 0),
    claim_generation: claim.claim_generation,
    browser_context_id: cell.browser_context_id,
    target_id: claim.target_id,
    target_incarnation: claim.target_incarnation,
    one_claim_per_cell: true,
    single_use_ledger_reservation_required: true,
  });
}

function lowTrustIsolationViolation(cell) {
  if (cell.persistent_partition !== false) return 'LOW_TRUST_CELL_MUST_BE_NON_PERSISTENT';
  if (cell.user_data_allowed !== false || cell.prompt_access_allowed !== false) return 'LOW_TRUST_USER_DATA_FORBIDDEN';
  return cell.send_allowed === false ? null : 'LOW_TRUST_SEND_FORBIDDEN';
}

function admitResearchCell(cell, claim) {
  if (cell.fleet_capacity !== true) return hold('RESEARCH_FLEET_CAPACITY_UNPROVEN');
  if (cell.read_only !== true || !validNetworkAllowlist(cell.network_allowlist)) return hold('RESEARCH_CELL_READ_ONLY_ALLOWLIST_REQUIRED');
  const requested = requestedActions(claim, ALLOWED_RESEARCH_ACTIONS);
  if (!requested) return hold('RESEARCH_CELL_ACTION_SCOPE_INVALID');
  return Object.freeze({
    ...admittedBase(cell, claim, 'ADMIT_EPHEMERAL_RESEARCH_CLAIM', 'RESEARCH_CELL_ISOLATED_READ_ONLY', cell.active_claim_count === 0 ? 1 : 0),
    destroy_after_evidence_upload: true,
    allowed_actions: Object.freeze([...requested]),
    network_allowlist: Object.freeze([...cell.network_allowlist]),
  });
}

function admitRecoveryCell(cell, claim) {
  if (cell.fleet_capacity !== false) return hold('RECOVERY_PROBE_FLEET_CAPACITY_FORBIDDEN');
  if (!requestedActions(claim, ALLOWED_RECOVERY_ACTIONS)) return hold('RECOVERY_PROBE_ACTION_SCOPE_INVALID');
  if (!validNetworkAllowlist(cell.network_allowlist, { allowEmpty: true })) return hold('RECOVERY_PROBE_ALLOWLIST_INVALID');
  return Object.freeze({
    ...admittedBase(cell, claim, 'ADMIT_RECOVERY_PROBE', 'RECOVERY_PROBE_EFFECT_POOR', 0),
    health_readback_only: true,
    destroy_after_readback: true,
  });
}

/**
 * Validate the target BrowserCell domain object. This intentionally does not
 * create a BrowserContext or attach a target; it is an admission boundary.
 */
export function admitBrowserCell({
  cell,
  claim = null,
  capability = null,
  ledger_reservation = null,
  now = new Date(),
} = {}) {
  const envelopeViolation = validateBrowserCellEnvelope(cell, { now });
  if (envelopeViolation) return hold(envelopeViolation);
  if (cell.type === BROWSER_CELL_TYPES.HUMAN) return admitHumanCell(cell, claim);

  const identityViolation = claimIdentityViolation(cell, claim);
  if (identityViolation) return hold(identityViolation);
  if (cell.type === BROWSER_CELL_TYPES.AUTHENTICATED_WORKER) {
    const nowMs = now instanceof Date ? now.getTime() : Number(now);
    return admitWorkerCell(cell, claim, capability, ledger_reservation, nowMs);
  }

  const isolationViolation = lowTrustIsolationViolation(cell);
  if (isolationViolation) return hold(isolationViolation);
  if (cell.type === BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH) return admitResearchCell(cell, claim);
  if (cell.type === BROWSER_CELL_TYPES.RECOVERY_PROBE) return admitRecoveryCell(cell, claim);
  return hold('CELL_TYPE_UNREACHABLE');
}

export function browserCellContract() {
  return Object.freeze({
    schema: BROWSER_CELL_SCHEMA,
    durable_unit: 'CLAIM_EFFECT_IDENTITY',
    execution_unit: 'BROWSER_CELL',
    one_claim_per_cell: true,
    durable_single_use_capability_reservation_required: true,
    cell_generation_required: true,
    browser_process_incarnation_required: true,
    fresh_runtime_readback_required: true,
    runtime_readback_max_age_ms: BROWSER_CELL_RUNTIME_READBACK_MAX_AGE_MS,
    explicit_resource_budget_required: true,
    resource_budget_limits: BROWSER_CELL_RESOURCE_BUDGET_LIMITS,
    separate_browser_context_required: true,
    human_cell_in_fleet_capacity: false,
    authenticated_worker_persistent_partition: true,
    ephemeral_research_non_persistent: true,
    ephemeral_research_read_only: true,
    ephemeral_research_explicit_action_allowlist: true,
    network_allowlist_exact_hostnames_only: true,
    network_egress_public_ip_readback_required: true,
    dns_rebinding_protection_required: true,
    recovery_probe_user_data_allowed: false,
    recovery_probe_send_allowed: false,
    shared_profile_fleet_forbidden: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
