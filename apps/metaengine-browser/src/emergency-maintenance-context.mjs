import crypto from 'node:crypto';
import {
  GLOBAL_OPERATIONAL_OVERRIDE,
  verifyEmergencyMaintenanceGrant,
} from './emergency-maintenance-policy.mjs';

export const EMERGENCY_MAINTENANCE_RUNTIME_SCHEMA = 'metaengine.emergency-maintenance-runtime-state.v1';
const MAX_CONSUMED_GRANTS = 128;

function clone(value) { return value == null ? value : structuredClone(value); }
function iso(clock) {
  const now = Number(clock());
  if (!Number.isFinite(now)) throw new Error('emergency_maintenance_runtime_clock_invalid');
  return new Date(now).toISOString();
}
function nonceDigest(nonce) {
  return crypto.createHash('sha256').update(String(nonce || ''), 'utf8').digest('hex');
}
function freshState() {
  return {
    schema: EMERGENCY_MAINTENANCE_RUNTIME_SCHEMA,
    version: 1,
    consumed: [],
    last_receipt: null,
    updated_at: null,
    authority_effect: false,
  };
}
function sanitizeState(input) {
  const state = freshState();
  if (!input || input.schema !== EMERGENCY_MAINTENANCE_RUNTIME_SCHEMA || !Array.isArray(input.consumed)) return state;
  state.consumed = input.consumed.slice(-MAX_CONSUMED_GRANTS).flatMap((row) => {
    const grantId = String(row?.grant_id || '');
    const digest = String(row?.nonce_sha256 || '');
    const expiresAt = String(row?.expires_at || '');
    const consumedAt = String(row?.consumed_at || '');
    if (!grantId || !/^[a-f0-9]{64}$/.test(digest)) return [];
    if (!Number.isFinite(Date.parse(expiresAt)) || !Number.isFinite(Date.parse(consumedAt))) return [];
    return [{ grant_id: grantId, nonce_sha256: digest, expires_at: expiresAt, consumed_at: consumedAt }];
  });
  state.last_receipt = input.last_receipt && typeof input.last_receipt === 'object' ? clone(input.last_receipt) : null;
  state.updated_at = input.updated_at || null;
  return state;
}

export class EmergencyMaintenanceContext {
  #registry;
  #load;
  #save;
  #publicKey;
  #buildSha;
  #clock;
  #state = freshState();
  #ready = false;
  #mutex = Promise.resolve();

  constructor({
    ownerGateRegistry,
    loadState,
    saveState,
    publicKey,
    expectedBuildSha,
    clock = () => Date.now(),
  } = {}) {
    if (!ownerGateRegistry || typeof ownerGateRegistry.disable !== 'function' || typeof ownerGateRegistry.enable !== 'function' || typeof ownerGateRegistry.snapshot !== 'function') {
      throw new Error('emergency_maintenance_owner_gate_registry_required');
    }
    if (typeof loadState !== 'function' || typeof saveState !== 'function') throw new Error('emergency_maintenance_runtime_persistence_required');
    if (typeof clock !== 'function') throw new Error('emergency_maintenance_runtime_clock_invalid');
    this.#registry = ownerGateRegistry;
    this.#load = loadState;
    this.#save = saveState;
    this.#publicKey = publicKey;
    this.#buildSha = String(expectedBuildSha || '').toLowerCase();
    this.#clock = clock;
  }

  async init() {
    this.#state = sanitizeState(await this.#load());
    this.#ready = true;
    this.#pruneExpiredConsumed();
    await this.#persist();
    return this.snapshot();
  }

  snapshot() {
    this.#assertReady();
    this.#pruneExpiredConsumed();
    const gates = this.#registry.snapshot();
    const activeOverride = gates.overrides?.find?.((row) => String(row?.override_id || '').startsWith('emergency.')) || null;
    return Object.freeze({
      schema: 'metaengine.emergency-maintenance-runtime.snapshot.v1',
      active: gates.wildcard_disabled === true && activeOverride != null,
      wildcard_disabled: gates.wildcard_disabled === true,
      active_override: activeOverride ? clone(activeOverride) : null,
      consumed_grant_count: this.#state.consumed.length,
      last_receipt: clone(this.#state.last_receipt),
      arbitrary_execution_allowed: false,
      blind_retry_allowed: false,
      page_model_text_authority: false,
      authority_effect: false,
    });
  }

  async activateGlobal(grant) {
    return this.#serial(async () => {
      this.#assertReady();
      const now = Number(this.#clock());
      const verified = verifyEmergencyMaintenanceGrant({
        grant,
        public_key: this.#publicKey,
        expected_build_sha: this.#buildSha,
        now_ms: now,
      });
      if (verified.global_operational_override !== true || !verified.scopes.includes(GLOBAL_OPERATIONAL_OVERRIDE)) {
        throw new Error('emergency_maintenance_global_override_required');
      }
      const remainingMs = Date.parse(verified.expires_at) - now;
      if (remainingMs < 1_000) throw new Error('emergency_maintenance_activation_window_too_short');
      const nonceSha256 = nonceDigest(verified.nonce);
      this.#pruneExpiredConsumed();
      if (this.#state.consumed.some((row) => row.grant_id === verified.grant_id || row.nonce_sha256 === nonceSha256)) {
        throw new Error('emergency_maintenance_grant_replay');
      }

      const consumedAt = iso(this.#clock);
      this.#state.consumed.push({
        grant_id: verified.grant_id,
        nonce_sha256: nonceSha256,
        expires_at: verified.expires_at,
        consumed_at: consumedAt,
      });
      this.#state.consumed = this.#state.consumed.slice(-MAX_CONSUMED_GRANTS);
      await this.#persist();

      const ttlSeconds = Math.floor(remainingMs / 1_000);
      const overrideId = `emergency.${verified.grant_id}`;
      let result;
      try {
        result = await this.#registry.disable({
          gate_id: '*',
          ttl_seconds: ttlSeconds,
          reason: `SIGNED_EMERGENCY:${verified.reason}`,
          override_id: overrideId,
        });
      } catch (error) {
        this.#state.last_receipt = {
          schema: 'metaengine.emergency-maintenance-activation-receipt.v1',
          state: 'EFFECT_UNCONFIRMED',
          grant_id: verified.grant_id,
          override_id: overrideId,
          recorded_at: iso(this.#clock),
          automatic_retry_allowed: false,
          authority_effect: false,
        };
        await this.#persist().catch(() => {});
        throw error;
      }

      const gates = this.#registry.snapshot();
      const exact = gates.overrides?.find?.((row) => row?.gate_id === '*' && row?.override_id === overrideId) || null;
      if (gates.wildcard_disabled !== true || !exact || result?.disabled !== true) {
        this.#state.last_receipt = {
          schema: 'metaengine.emergency-maintenance-activation-receipt.v1',
          state: 'EFFECT_AMBIGUOUS',
          grant_id: verified.grant_id,
          override_id: overrideId,
          recorded_at: iso(this.#clock),
          automatic_retry_allowed: false,
          authority_effect: false,
        };
        await this.#persist();
        throw new Error('emergency_maintenance_registry_readback_ambiguous');
      }

      const receipt = Object.freeze({
        schema: 'metaengine.emergency-maintenance-activation-receipt.v1',
        state: 'ACTIVE',
        grant_id: verified.grant_id,
        subject_build_sha: verified.subject_build_sha,
        override_id: overrideId,
        scopes: clone(verified.effective_scopes),
        expires_at: exact.expires_at,
        activated_at: exact.disabled_at,
        signature_verified: true,
        replay_fence_persisted_before_effect: true,
        audit_receipt_persisted: true,
        automatic_reclose: true,
        arbitrary_execution_allowed: false,
        blind_retry_allowed: false,
        authority_effect: true,
      });
      this.#state.last_receipt = clone(receipt);
      await this.#persist();
      return receipt;
    });
  }

  async reclose({ reason = 'EMERGENCY_RECLOSED' } = {}) {
    return this.#serial(async () => {
      this.#assertReady();
      const current = this.#registry.snapshot();
      const active = current.overrides?.find?.((row) => row?.gate_id === '*' && String(row?.override_id || '').startsWith('emergency.')) || null;
      if (!active) return Object.freeze({ reclosed: false, reason: 'NO_ACTIVE_EMERGENCY_OVERRIDE', authority_effect: false });
      const result = await this.#registry.enable({
        gate_id: '*',
        reason: String(reason || 'EMERGENCY_RECLOSED').slice(0, 500),
        override_id: `emergency.reclose.${Date.now()}`,
      });
      this.#state.last_receipt = {
        schema: 'metaengine.emergency-maintenance-activation-receipt.v1',
        state: 'RECLOSED',
        grant_id: active.override_id.replace(/^emergency\./, ''),
        override_id: active.override_id,
        recorded_at: iso(this.#clock),
        authority_effect: true,
      };
      await this.#persist();
      return Object.freeze({ reclosed: result?.disabled === false, override_id: active.override_id, authority_effect: true });
    });
  }

  #pruneExpiredConsumed() {
    const now = Number(this.#clock());
    if (!Number.isFinite(now)) throw new Error('emergency_maintenance_runtime_clock_invalid');
    this.#state.consumed = this.#state.consumed
      .filter((row) => Date.parse(row.expires_at) > now)
      .slice(-MAX_CONSUMED_GRANTS);
  }

  async #persist() {
    this.#state.updated_at = iso(this.#clock);
    await this.#save(clone(this.#state));
  }

  #assertReady() { if (!this.#ready) throw new Error('emergency_maintenance_runtime_not_initialized'); }
  #serial(fn) {
    const next = this.#mutex.then(fn, fn);
    this.#mutex = next.catch(() => {});
    return next;
  }
}
