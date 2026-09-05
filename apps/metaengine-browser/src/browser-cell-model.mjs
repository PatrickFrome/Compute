export const BROWSER_CELL_TYPES = Object.freeze({
  HUMAN: 'HUMAN',
  AUTHENTICATED_WORKER: 'AUTHENTICATED_WORKER',
  EPHEMERAL_RESEARCH: 'EPHEMERAL_RESEARCH',
  RECOVERY_PROBE: 'RECOVERY_PROBE',
});

const TYPE_POLICY = Object.freeze({
  [BROWSER_CELL_TYPES.HUMAN]: Object.freeze({
    persistent: true,
    fleet_capacity: false,
    max_claims: 0,
    page_effects: 'LOCAL_OPERATOR_ONLY',
    network_mode: 'USER_POLICY',
  }),
  [BROWSER_CELL_TYPES.AUTHENTICATED_WORKER]: Object.freeze({
    persistent: true,
    fleet_capacity: true,
    max_claims: 1,
    page_effects: 'SCOPED_CAPABILITY_ONLY',
    network_mode: 'TASK_POLICY',
  }),
  [BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH]: Object.freeze({
    persistent: false,
    fleet_capacity: true,
    max_claims: 1,
    page_effects: 'READ_ONLY',
    network_mode: 'ALLOWLIST_ONLY',
  }),
  [BROWSER_CELL_TYPES.RECOVERY_PROBE]: Object.freeze({
    persistent: false,
    fleet_capacity: false,
    max_claims: 0,
    page_effects: 'HEALTH_READBACK_ONLY',
    network_mode: 'CONTROL_PLANE_ONLY',
  }),
});

function required(value, reason) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(reason);
  return normalized;
}

export function browserCellPolicy(type) {
  const normalized = String(type ?? '').trim().toUpperCase();
  const policy = TYPE_POLICY[normalized];
  if (!policy) throw new Error('browser_cell_type_invalid');
  return Object.freeze({ type: normalized, ...policy });
}

export function createBrowserCellDescriptor(value = {}) {
  const policy = browserCellPolicy(value.type);
  const descriptor = {
    schema: 'metaengine.browser-cell.v1',
    cell_id: required(value.cell_id, 'browser_cell_id_required'),
    type: policy.type,
    browser_context_id: required(value.browser_context_id, 'browser_cell_context_required'),
    storage_partition: required(value.storage_partition, 'browser_cell_partition_required'),
    created_at_ms: Number(value.created_at_ms ?? Date.now()),
    expires_at_ms: value.expires_at_ms == null ? null : Number(value.expires_at_ms),
    active_claim: value.active_claim ?? null,
    target: value.target ?? null,
    network_allowlist: Object.freeze([...(value.network_allowlist ?? [])].map((item) => String(item).trim()).filter(Boolean)),
    policy,
  };
  if (!Number.isSafeInteger(descriptor.created_at_ms) || descriptor.created_at_ms < 0) throw new Error('browser_cell_created_at_invalid');
  if (!policy.persistent) {
    if (!Number.isSafeInteger(descriptor.expires_at_ms) || descriptor.expires_at_ms <= descriptor.created_at_ms) {
      throw new Error('browser_cell_ttl_required');
    }
  }
  if (policy.type === BROWSER_CELL_TYPES.AUTHENTICATED_WORKER && !descriptor.storage_partition.startsWith('persist:')) {
    throw new Error('browser_cell_worker_partition_must_be_persistent');
  }
  if (!policy.persistent && descriptor.storage_partition.startsWith('persist:')) {
    throw new Error('browser_cell_ephemeral_partition_must_not_persist');
  }
  if (policy.network_mode === 'ALLOWLIST_ONLY' && descriptor.network_allowlist.length === 0) {
    throw new Error('browser_cell_network_allowlist_required');
  }
  return Object.freeze(descriptor);
}

export function assignClaim(cell, claim) {
  const descriptor = createBrowserCellDescriptor(cell);
  if (descriptor.policy.max_claims < 1) throw new Error('browser_cell_claims_forbidden');
  if (descriptor.active_claim) throw new Error('browser_cell_claim_already_active');
  const exactClaim = Object.freeze({
    task_id: required(claim?.task_id, 'browser_cell_task_required'),
    claim_generation: Number(claim?.claim_generation),
    capability_digest: required(claim?.capability_digest, 'browser_cell_capability_required'),
    claimed_at_ms: Number(claim?.claimed_at_ms ?? Date.now()),
  });
  if (!Number.isSafeInteger(exactClaim.claim_generation) || exactClaim.claim_generation < 1) throw new Error('browser_cell_claim_generation_invalid');
  return Object.freeze({ ...descriptor, active_claim: exactClaim });
}

export function bindCellTarget(cell, target) {
  const descriptor = createBrowserCellDescriptor(cell);
  if (!descriptor.active_claim && descriptor.policy.type !== BROWSER_CELL_TYPES.RECOVERY_PROBE) {
    throw new Error('browser_cell_target_requires_claim');
  }
  const exactTarget = Object.freeze({
    target_id: required(target?.target_id, 'browser_cell_target_id_required'),
    incarnation: required(target?.incarnation, 'browser_cell_target_incarnation_required'),
  });
  return Object.freeze({ ...descriptor, target: exactTarget });
}

export function retireBrowserCell(cell, { now_ms = Date.now(), evidence_uploaded = false } = {}) {
  const descriptor = createBrowserCellDescriptor(cell);
  const now = Number(now_ms);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('browser_cell_retire_time_invalid');
  if (descriptor.policy.persistent && descriptor.active_claim) throw new Error('browser_cell_active_claim_retire_forbidden');
  if (descriptor.type === BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH && evidence_uploaded !== true) {
    throw new Error('browser_cell_research_evidence_required_before_destroy');
  }
  return Object.freeze({
    cell_id: descriptor.cell_id,
    browser_context_id: descriptor.browser_context_id,
    dispose_context: !descriptor.policy.persistent,
    clear_ephemeral_storage: !descriptor.policy.persistent,
    retired_at_ms: now,
    authority_effect: false,
  });
}

export function planCdpIsolatedContext({ cell_type, browser_context_id, target_url = 'about:blank', network_allowlist = [] } = {}) {
  const policy = browserCellPolicy(cell_type);
  if (![BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH, BROWSER_CELL_TYPES.RECOVERY_PROBE].includes(policy.type)) {
    throw new Error('browser_cell_cdp_isolated_context_ephemeral_only');
  }
  return Object.freeze({
    create: Object.freeze({ method: 'Target.createBrowserContext', params: { disposeOnDetach: true } }),
    target: Object.freeze({ method: 'Target.createTarget', params: { url: target_url, browserContextId: browser_context_id } }),
    dispose: Object.freeze({ method: 'Target.disposeBrowserContext', params: { browserContextId: browser_context_id } }),
    network_allowlist: Object.freeze([...network_allowlist]),
    page_effect_authority: false,
    task_authority: false,
    automatic_retry_allowed: false,
  });
}

export const BROWSER_CELL_CONTRACT = Object.freeze({
  schema: 'metaengine.browser-cell-contract.v1',
  one_claim_per_worker_cell: true,
  isolated_browser_context_required: true,
  isolated_storage_partition_required: true,
  ephemeral_research_read_only: true,
  recovery_probe_has_no_prompt_send_authority: true,
  human_cell_not_fleet_capacity: true,
  blast_radius_claims_max: 1,
});
