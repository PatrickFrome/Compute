import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_SHADOW_PROFILE_BINDING_SCHEMA = 'metaengine.rsi.shadow-profile-binding.v1';
export const RSI_SHADOW_PROFILE_BINDING_LEDGER_SCHEMA = 'metaengine.rsi.shadow-profile-binding-ledger.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS = 256;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactSha(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(normalized)) throw new Error(`rsi_shadow_profile_${label}_sha_invalid`);
  return normalized;
}

function exactDigest(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new Error(`rsi_shadow_profile_${label}_digest_invalid`);
  return normalized;
}

function boundedId(value, label) {
  const normalized = String(value || '').trim();
  if (!SAFE_ID_RE.test(normalized)) throw new Error(`rsi_shadow_profile_${label}_invalid`);
  return normalized;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_shadow_profile_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_shadow_profile_${label}_automatic_retry_invalid`);
  }
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function verifyQualifiedMetaProfile(qualification) {
  if (
    !qualification ||
    qualification.schema !== 'metaengine.rsi.meta-profile-qualification.v1' ||
    qualification.version !== 1
  ) {
    throw new Error('rsi_shadow_profile_qualification_invalid');
  }
  assertZeroAuthority(qualification, 'qualification');
  if (
    qualification.state !== 'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION' ||
    qualification.qualified_for_shadow_profile_selection !== true ||
    qualification.live_profile_activation_authorized !== false ||
    qualification.profile_replacement_authorized !== false ||
    qualification.canary_activation_authorized !== false ||
    qualification.external_activation_gate_still_required !== true
  ) {
    throw new Error('rsi_shadow_profile_qualification_policy_invalid');
  }
  const sourceSha = exactSha(qualification.source_sha, 'qualification_source');
  const parentDigest = exactDigest(qualification.parent_profile_digest, 'parent_profile');
  const successorDigest = exactDigest(qualification.successor_profile_digest, 'successor_profile');
  if (parentDigest === successorDigest) throw new Error('rsi_shadow_profile_parent_successor_alias');
  const clone = structuredClone(qualification);
  delete clone.qualification_digest;
  if (digest(clone) !== exactDigest(qualification.qualification_digest, 'qualification')) {
    throw new Error('rsi_shadow_profile_qualification_digest_mismatch');
  }
  return Object.freeze({
    ...structuredClone(qualification),
    source_sha: sourceSha,
    parent_profile_digest: parentDigest,
    successor_profile_digest: successorDigest,
  });
}

export function createRsiShadowProfileBinding({
  binding_id,
  qualification,
  verified_context_digest,
  comparator_root_digest,
  external_shadow_owner = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyQualifiedMetaProfile(qualification);
  if (external_shadow_owner !== true || authored_by_candidate !== false) {
    throw new Error('rsi_shadow_profile_external_owner_required');
  }

  const core = {
    schema: RSI_SHADOW_PROFILE_BINDING_SCHEMA,
    version: 1,
    source_sha: checked.source_sha,
    binding_id: boundedId(binding_id, 'binding_id'),
    qualification_id: boundedId(checked.qualification_id, 'qualification_id'),
    qualification_digest: exactDigest(checked.qualification_digest, 'qualification'),
    champion_profile_digest: exactDigest(checked.parent_profile_digest, 'champion_profile'),
    challenger_profile_digest: exactDigest(checked.successor_profile_digest, 'challenger_profile'),
    verified_context_digest: exactDigest(verified_context_digest, 'verified_context'),
    comparator_root_digest: exactDigest(comparator_root_digest, 'comparator_root'),
    comparison_mode: 'READ_ONLY_DUAL_PLAN',
    same_verified_context_required: true,
    champion_challenger_roles_fixed: true,
    candidate_can_choose_context: false,
    candidate_can_choose_comparator: false,
    candidate_can_swap_roles: false,
    raw_context_exposed_to_candidate: false,
    browser_effects_allowed: false,
    plan_execution_allowed: false,
    active_profile_replaced: false,
    shadow_profile_activation_authorized: false,
    canary_activation_authorized: false,
    external_canary_gate_still_required: true,
    external_shadow_owner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };

  return Object.freeze({ ...core, binding_digest: digest(core) });
}

export function verifyRsiShadowProfileBinding(binding, qualification) {
  if (
    !binding ||
    binding.schema !== RSI_SHADOW_PROFILE_BINDING_SCHEMA ||
    binding.version !== 1
  ) {
    throw new Error('rsi_shadow_profile_binding_invalid');
  }
  assertZeroAuthority(binding, 'binding');
  if (
    binding.comparison_mode !== 'READ_ONLY_DUAL_PLAN' ||
    binding.same_verified_context_required !== true ||
    binding.champion_challenger_roles_fixed !== true ||
    binding.candidate_can_choose_context !== false ||
    binding.candidate_can_choose_comparator !== false ||
    binding.candidate_can_swap_roles !== false ||
    binding.raw_context_exposed_to_candidate !== false ||
    binding.browser_effects_allowed !== false ||
    binding.plan_execution_allowed !== false ||
    binding.active_profile_replaced !== false ||
    binding.shadow_profile_activation_authorized !== false ||
    binding.canary_activation_authorized !== false ||
    binding.external_canary_gate_still_required !== true ||
    binding.external_shadow_owner !== true ||
    binding.authored_by_candidate !== false
  ) {
    throw new Error('rsi_shadow_profile_binding_policy_invalid');
  }

  const canonical = createRsiShadowProfileBinding({
    binding_id: binding.binding_id,
    qualification,
    verified_context_digest: binding.verified_context_digest,
    comparator_root_digest: binding.comparator_root_digest,
    external_shadow_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.binding_digest !== exactDigest(binding.binding_digest, 'binding')) {
    throw new Error('rsi_shadow_profile_binding_digest_mismatch');
  }
  return canonical;
}

function ledgerState(sourceSha, rows) {
  const core = {
    schema: RSI_SHADOW_PROFILE_BINDING_LEDGER_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    rows,
    row_count: rows.length,
    append_only: true,
    active_profile_digest: null,
    canary_profile_digest: null,
    candidate_can_delete_rows: false,
    candidate_can_rewrite_rows: false,
    ledger_can_activate_profile: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, state_digest: digest(core) };
}

export class RsiShadowProfileBindingLedger {
  #path;
  #sourceSha;
  #rows = [];
  #initialized = false;

  constructor({ statePath, source_sha } = {}) {
    if (!statePath) throw new Error('rsi_shadow_profile_ledger_path_required');
    this.#path = path.resolve(statePath);
    this.#sourceSha = exactSha(source_sha, 'ledger_source');
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    try {
      const persisted = JSON.parse(await fs.readFile(this.#path, 'utf8'));
      assertZeroAuthority(persisted, 'ledger');
      if (
        persisted.schema !== RSI_SHADOW_PROFILE_BINDING_LEDGER_SCHEMA ||
        persisted.version !== 1 ||
        persisted.source_sha !== this.#sourceSha ||
        persisted.append_only !== true ||
        persisted.ledger_can_activate_profile !== false ||
        !Array.isArray(persisted.rows) ||
        persisted.rows.length > MAX_ROWS
      ) {
        throw new Error('rsi_shadow_profile_ledger_state_invalid');
      }
      const clone = structuredClone(persisted);
      delete clone.state_digest;
      if (digest(clone) !== exactDigest(persisted.state_digest, 'ledger')) {
        throw new Error('rsi_shadow_profile_ledger_digest_mismatch');
      }
      for (const row of persisted.rows) {
        if (row.source_sha !== this.#sourceSha) {
          throw new Error('rsi_shadow_profile_ledger_row_source_mismatch');
        }
        assertZeroAuthority(row, 'ledger_row');
        const rowClone = structuredClone(row);
        delete rowClone.binding_digest;
        if (digest(rowClone) !== exactDigest(row.binding_digest, 'binding')) {
          throw new Error('rsi_shadow_profile_ledger_row_digest_mismatch');
        }
      }
      this.#rows = persisted.rows;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async #persist() {
    const state = ledgerState(this.#sourceSha, this.#rows);
    const tempPath = `${this.#path}.tmp`;
    const handle = await fs.open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, this.#path);
  }

  async add(binding, qualification) {
    if (!this.#initialized) throw new Error('rsi_shadow_profile_ledger_not_initialized');
    const checked = verifyRsiShadowProfileBinding(binding, qualification);
    if (checked.source_sha !== this.#sourceSha) {
      throw new Error('rsi_shadow_profile_binding_source_mismatch');
    }

    const byId = this.#rows.find((row) => row.binding_id === checked.binding_id);
    if (byId) {
      if (byId.binding_digest !== checked.binding_digest) {
        throw new Error('rsi_shadow_profile_binding_conflict');
      }
      return zeroAuthority({ state: 'IDEMPOTENT', binding_digest: checked.binding_digest });
    }

    if (this.#rows.length >= MAX_ROWS) {
      throw new Error('rsi_shadow_profile_ledger_capacity_exceeded');
    }
    this.#rows.push(structuredClone(checked));
    await this.#persist();
    return zeroAuthority({ state: 'SHADOW_BOUND', binding_digest: checked.binding_digest });
  }

  bindings() {
    if (!this.#initialized) throw new Error('rsi_shadow_profile_ledger_not_initialized');
    return Object.freeze(this.#rows.map((row) => Object.freeze(structuredClone(row))));
  }

  snapshot() {
    const state = ledgerState(this.#sourceSha, this.#rows);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      initialized: this.#initialized,
      row_count: state.row_count,
      append_only: true,
      active_profile_digest: null,
      canary_profile_digest: null,
      ledger_can_activate_profile: false,
      authority_effect: false,
    });
  }
}

export function rsiShadowProfileBindingTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.shadow-profile-binding-root.v1',
    version: 1,
    qualified_meta_profile_required: true,
    exact_source_sha_required: true,
    same_verified_context_required: true,
    champion_is_parent_profile: true,
    challenger_is_qualified_successor: true,
    comparison_mode: 'READ_ONLY_DUAL_PLAN',
    external_shadow_owner_required: true,
    candidate_can_choose_context: false,
    candidate_can_choose_comparator: false,
    candidate_can_swap_roles: false,
    raw_context_exposed_to_candidate: false,
    browser_effects_allowed: false,
    plan_execution_allowed: false,
    active_profile_replacement_authorized: false,
    canary_activation_authorized: false,
    external_canary_gate_still_required: true,
    append_only_shadow_binding_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, shadow_binding_root_digest: digest(root) });
}
