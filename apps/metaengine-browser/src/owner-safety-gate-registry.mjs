const GATE_ID_RE = /^(?:\*|[a-z0-9][a-z0-9._:-]{2,127})$/;
const MAX_AUDIT = 256;

export const OWNER_INTERNAL_GATE_CATALOG = Object.freeze([
  { gate_id:'authority.control_mode', domain:'AUTHORITY', enforcement:'BROWSER_AND_SERVER' },
  { gate_id:'authority.armed', domain:'AUTHORITY', enforcement:'BROWSER' },
  { gate_id:'self_update.restart_safety', domain:'SELF_UPDATE', enforcement:'BROWSER' },
  { gate_id:'self_update.current_command', domain:'SELF_UPDATE', enforcement:'BROWSER' },
  { gate_id:'self_update.packaged_required', domain:'SELF_UPDATE', enforcement:'BROWSER' },
  { gate_id:'self_update.primary_instance_lock', domain:'SELF_UPDATE', enforcement:'BROWSER' },
  { gate_id:'fleet.ambiguous_compensating_fanout', domain:'FLEET', enforcement:'BROWSER' },
  { gate_id:'supervisor.action_budget', domain:'SUPERVISOR', enforcement:'SERVER' },
  { gate_id:'supervisor.failure_circuit', domain:'SUPERVISOR', enforcement:'SERVER' },
  { gate_id:'supervisor.shared_actuation_lease', domain:'SUPERVISOR_MESH', enforcement:'SERVER' },
  { gate_id:'browser.navigation_policy', domain:'NAVIGATION', enforcement:'BROWSER' },
  { gate_id:'browser.new_window_policy', domain:'NAVIGATION', enforcement:'BROWSER' },
  { gate_id:'browser.site_permission_policy', domain:'SESSION', enforcement:'BROWSER' },
  { gate_id:'browser.semantic_target_uniqueness', domain:'PAGE_INPUT', enforcement:'BROWSER' },
  { gate_id:'browser.semantic_role_allowlist', domain:'PAGE_INPUT', enforcement:'BROWSER' },
]);

let GLOBAL_REGISTRY = null;

function clone(value) { return value == null ? value : structuredClone(value); }
function nowIso(clock) {
  const d = new Date(clock());
  if (!Number.isFinite(d.getTime())) throw new Error('owner_gate_clock_invalid');
  return d.toISOString();
}
function normalizeGateId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!GATE_ID_RE.test(id)) throw new Error('owner_gate_id_invalid');
  return id;
}
function normalizeReason(value) {
  const reason = String(value || '').trim();
  if (!reason || reason.length > 500) throw new Error('owner_gate_reason_invalid');
  return reason;
}
function normalizeTtl(value) {
  if (value == null) return null;
  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 86400) throw new Error('owner_gate_ttl_invalid');
  return ttl;
}
function freshState() {
  return {
    schema: 'metaengine.owner-safety-gates.state.v1',
    version: '1.1.0',
    overrides: {},
    audit: [],
    updated_at: null,
    authority_effect: false,
  };
}
function sanitizeState(input) {
  const state = freshState();
  if (!input || input.schema !== state.schema || typeof input.overrides !== 'object' || Array.isArray(input.overrides)) return state;
  for (const [rawId, row] of Object.entries(input.overrides)) {
    try {
      const gateId = normalizeGateId(rawId);
      if (!row || typeof row !== 'object') continue;
      const disabledAt = String(row.disabled_at || '');
      const expiresAt = row.expires_at == null ? null : String(row.expires_at);
      const reason = String(row.reason || '').slice(0, 500);
      const overrideId = String(row.override_id || '').slice(0, 160);
      if (!disabledAt || !reason || !overrideId) continue;
      state.overrides[gateId] = { gate_id: gateId, disabled_at: disabledAt, expires_at: expiresAt, reason, override_id: overrideId };
    } catch {}
  }
  state.audit = Array.isArray(input.audit) ? input.audit.slice(-MAX_AUDIT).map(clone) : [];
  state.updated_at = input.updated_at || null;
  return state;
}

export function bindGlobalOwnerSafetyGateRegistry(registry) {
  if (!(registry instanceof OwnerSafetyGateRegistry)) throw new Error('owner_gate_global_registry_invalid');
  GLOBAL_REGISTRY = registry;
  return registry.snapshot();
}

export function globalOwnerGateDisabled(gateId) {
  return GLOBAL_REGISTRY?.isDisabledSync(gateId) === true;
}

export function globalOwnerGateDecision(gateId, defaultAllowed = false) {
  const disabled = globalOwnerGateDisabled(gateId);
  return Object.freeze({
    gate_id: normalizeGateId(gateId),
    gate_disabled_by_owner: disabled,
    allowed: disabled ? true : defaultAllowed === true,
    authority_effect: false,
  });
}

export class OwnerSafetyGateRegistry {
  #load;
  #save;
  #clock;
  #state = freshState();
  #ready = false;
  #mutex = Promise.resolve();

  constructor({ loadState, saveState, clock = () => Date.now() } = {}) {
    if (typeof loadState !== 'function' || typeof saveState !== 'function') throw new Error('owner_gate_persistence_required');
    if (typeof clock !== 'function') throw new Error('owner_gate_clock_invalid');
    this.#load = loadState;
    this.#save = saveState;
    this.#clock = clock;
  }

  async init() {
    this.#state = sanitizeState(await this.#load());
    this.#ready = true;
    await this.#expire();
    await this.#persist();
    return this.snapshot();
  }

  snapshot() {
    this.#assertReady();
    const wildcardDisabled = Boolean(this.#activeOverride('*'));
    return Object.freeze({
      schema: 'metaengine.owner-safety-gates.snapshot.v1',
      version: '1.1.0',
      wildcard_disabled: wildcardDisabled,
      registered_gates: OWNER_INTERNAL_GATE_CATALOG.map((gate) => ({
        ...gate,
        disabled: wildcardDisabled || Boolean(this.#activeOverride(gate.gate_id)),
      })),
      overrides: Object.values(this.#state.overrides).filter((row) => this.#rowActive(row)).map(clone),
      audit: this.#state.audit.slice(-64).map(clone),
      external_platform_gates_overridable: false,
      authority_effect: false,
    });
  }

  async disable({ gate_id, ttl_seconds = null, reason, override_id } = {}) {
    return this.#serial(async () => {
      this.#assertReady();
      const gateId = normalizeGateId(gate_id);
      const ttl = normalizeTtl(ttl_seconds);
      const why = normalizeReason(reason);
      const overrideId = String(override_id || '').trim();
      if (!/^[A-Za-z0-9._:-]{8,160}$/.test(overrideId)) throw new Error('owner_gate_override_id_invalid');
      const disabledAt = nowIso(this.#clock);
      const expiresAt = ttl == null ? null : new Date(new Date(disabledAt).getTime() + ttl * 1000).toISOString();
      this.#state.overrides[gateId] = { gate_id: gateId, disabled_at: disabledAt, expires_at: expiresAt, reason: why, override_id: overrideId };
      this.#record('DISABLED', gateId, overrideId, why, expiresAt);
      await this.#persist();
      return { gate_id: gateId, disabled: true, expires_at: expiresAt, override_id: overrideId, authority_effect: true };
    });
  }

  async enable({ gate_id, reason = 'OWNER_REENABLED', override_id } = {}) {
    return this.#serial(async () => {
      this.#assertReady();
      const gateId = normalizeGateId(gate_id);
      const overrideId = String(override_id || '').trim();
      if (!/^[A-Za-z0-9._:-]{8,160}$/.test(overrideId)) throw new Error('owner_gate_override_id_invalid');
      const why = normalizeReason(reason);
      delete this.#state.overrides[gateId];
      this.#record('ENABLED', gateId, overrideId, why, null);
      await this.#persist();
      return { gate_id: gateId, disabled: false, override_id: overrideId, authority_effect: true };
    });
  }

  async enableAll({ reason = 'OWNER_REENABLED_ALL', override_id } = {}) {
    return this.#serial(async () => {
      this.#assertReady();
      const overrideId = String(override_id || '').trim();
      if (!/^[A-Za-z0-9._:-]{8,160}$/.test(overrideId)) throw new Error('owner_gate_override_id_invalid');
      const why = normalizeReason(reason);
      this.#state.overrides = {};
      this.#record('ENABLED_ALL', '*', overrideId, why, null);
      await this.#persist();
      return { all_internal_gates_disabled: false, override_id: overrideId, authority_effect: true };
    });
  }

  isDisabledSync(gateId) {
    this.#assertReady();
    const id = normalizeGateId(gateId);
    return Boolean(this.#activeOverride(id) || this.#activeOverride('*'));
  }

  async isDisabled(gateId) {
    this.#assertReady();
    await this.#expire();
    return this.isDisabledSync(gateId);
  }

  async decision(gateId, { default_allowed = false } = {}) {
    const disabled = await this.isDisabled(gateId);
    return Object.freeze({
      gate_id: normalizeGateId(gateId),
      gate_disabled_by_owner: disabled,
      allowed: disabled ? true : default_allowed === true,
      authority_effect: false,
    });
  }

  #rowActive(row) {
    if (!row) return false;
    if (!row.expires_at) return true;
    return new Date(row.expires_at).getTime() > new Date(this.#clock()).getTime();
  }

  #activeOverride(gateId) {
    const row = this.#state.overrides[gateId];
    return this.#rowActive(row) ? row : null;
  }

  async #expire() {
    let changed = false;
    for (const [gateId, row] of Object.entries(this.#state.overrides)) {
      if (!this.#rowActive(row)) {
        delete this.#state.overrides[gateId];
        this.#record('EXPIRED', gateId, row.override_id, 'TTL_EXPIRED', null);
        changed = true;
      }
    }
    if (changed) await this.#persist();
  }

  #record(event, gateId, overrideId, reason, expiresAt) {
    this.#state.audit.push({
      event,
      gate_id: gateId,
      override_id: overrideId,
      reason,
      expires_at: expiresAt,
      recorded_at: nowIso(this.#clock),
      authority_effect: false,
    });
    this.#state.audit = this.#state.audit.slice(-MAX_AUDIT);
  }

  async #persist() {
    this.#state.updated_at = nowIso(this.#clock);
    await this.#save(clone(this.#state));
  }

  #assertReady() { if (!this.#ready) throw new Error('owner_gate_registry_not_initialized'); }
  #serial(fn) {
    const next = this.#mutex.then(fn, fn);
    this.#mutex = next.catch(() => {});
    return next;
  }
}
