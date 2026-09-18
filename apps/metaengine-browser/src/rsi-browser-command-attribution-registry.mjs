import crypto from 'node:crypto';

export const RSI_BROWSER_COMMAND_ATTRIBUTION_SCHEMA = 'metaengine.rsi.browser-command-attribution.v1';
export const RSI_BROWSER_COMMAND_ATTRIBUTION_EVENT_SCHEMA = 'metaengine.rsi.browser-command-attribution-event.v1';
export const RSI_BROWSER_COMMAND_ATTRIBUTION_REGISTRY_SCHEMA = 'metaengine.rsi.browser-command-attribution-registry.v1';
export const RSI_BROWSER_COMMAND_ATTRIBUTION_ROOT_SCHEMA = 'metaengine.rsi.browser-command-attribution-root.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_ACTIVE = 4096;
const MAX_SKILLS = 32;
const PRODUCERS = new Set([
  'DB_LEASE_SUPERVISOR',
  'RSI_SANDBOX_EVALUATOR',
  'DEVOS_EXPERIMENT_ORCHESTRATOR',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertZeroAuthority(value, label) {
  for (const key of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']) {
    if (value?.[key] !== false) throw new Error(`rsi_command_attribution_${label}_${key}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_command_attribution_${label}_retry_invalid`);
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_command_attribution_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_command_attribution_${label}_digest_invalid`);
  return out;
}

function uuid(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(out)) throw new Error(`rsi_command_attribution_${label}_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_command_attribution_${label}_invalid`);
  return out;
}

function token(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_command_attribution_${label}_invalid`);
  return out;
}

function candidateId(value) {
  const out = String(value || '').trim().toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error('rsi_command_attribution_candidate_id_invalid');
  return out;
}

function normalizeSkills(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_SKILLS) throw new Error('rsi_command_attribution_skill_digests_invalid');
  const out = value.map((item) => exactDigest(item, 'skill')).sort();
  if (new Set(out).size !== out.length) throw new Error('rsi_command_attribution_skill_digest_duplicate');
  return Object.freeze(out);
}

function normalizeRegistration(input, sourceSha) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('rsi_command_attribution_input_invalid');
  if (input.external_attribution !== true || input.authored_by_candidate !== false) {
    throw new Error('rsi_command_attribution_external_origin_required');
  }
  const producer = token(input.producer, 'producer');
  if (!PRODUCERS.has(producer)) throw new Error('rsi_command_attribution_producer_invalid');
  const candidatePresent = input.candidate_id != null || input.candidate_sha != null || input.proposal_digest != null;
  let candidate_id = null;
  let candidate_sha = null;
  let proposal_digest = null;
  if (candidatePresent) {
    if (input.candidate_id == null || input.candidate_sha == null || input.proposal_digest == null) {
      throw new Error('rsi_command_attribution_candidate_binding_incomplete');
    }
    candidate_id = candidateId(input.candidate_id);
    candidate_sha = exactSha(input.candidate_sha, 'candidate');
    proposal_digest = exactDigest(input.proposal_digest, 'proposal');
  }
  const core = zeroAuthority({
    schema: RSI_BROWSER_COMMAND_ATTRIBUTION_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    command_id: uuid(input.command_id, 'command_id'),
    task_id: boundedId(input.task_id, 'task_id'),
    task_signature_digest: exactDigest(input.task_signature_digest, 'task_signature'),
    environment_fingerprint: boundedId(input.environment_fingerprint, 'environment_fingerprint'),
    model_family: token(input.model_family, 'model_family'),
    producer,
    lease_evidence_digest: exactDigest(input.lease_evidence_digest, 'lease_evidence'),
    candidate_id,
    candidate_sha,
    proposal_digest,
    skill_digests: normalizeSkills(input.skill_digests),
    external_attribution: true,
    authored_by_candidate: false,
    db_lease_is_execution_authority: true,
    registry_is_execution_authority: false,
    candidate_can_register_mapping: false,
    candidate_can_replace_mapping: false,
    page_model_text_authority: false,
  });
  return Object.freeze({ ...core, attribution_digest: digest(core) });
}

function verifyAttribution(row, sourceSha) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.schema !== RSI_BROWSER_COMMAND_ATTRIBUTION_SCHEMA || row.version !== 1) {
    throw new Error('rsi_command_attribution_row_invalid');
  }
  assertZeroAuthority(row, 'row');
  if (
    row.external_attribution !== true
    || row.authored_by_candidate !== false
    || row.db_lease_is_execution_authority !== true
    || row.registry_is_execution_authority !== false
    || row.candidate_can_register_mapping !== false
    || row.candidate_can_replace_mapping !== false
    || row.page_model_text_authority !== false
  ) throw new Error('rsi_command_attribution_policy_invalid');
  const canonical = normalizeRegistration(row, sourceSha);
  if (canonical.attribution_digest !== exactDigest(row.attribution_digest, 'attribution')) {
    throw new Error('rsi_command_attribution_digest_mismatch');
  }
  return canonical;
}

function eventCore(type, payload, sourceSha) {
  const core = zeroAuthority({
    schema: RSI_BROWSER_COMMAND_ATTRIBUTION_EVENT_SCHEMA,
    version: 1,
    event_type: type,
    source_sha: sourceSha,
    ...payload,
  });
  return Object.freeze({ ...core, event_digest: digest(core) });
}

function verifyEvent(event, sourceSha) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || event.schema !== RSI_BROWSER_COMMAND_ATTRIBUTION_EVENT_SCHEMA || event.version !== 1) {
    throw new Error('rsi_command_attribution_event_invalid');
  }
  assertZeroAuthority(event, 'event');
  if (event.source_sha !== sourceSha) throw new Error('rsi_command_attribution_event_source_mismatch');
  const expected = { ...event };
  delete expected.event_digest;
  if (digest(expected) !== exactDigest(event.event_digest, 'event')) throw new Error('rsi_command_attribution_event_digest_mismatch');
  return event;
}

export class RsiBrowserCommandAttributionRegistry {
  #sourceSha;
  #active = new Map();
  #registeredCount = 0;
  #consumedCount = 0;

  constructor({ source_sha } = {}) {
    this.#sourceSha = exactSha(source_sha, 'source');
  }

  prepareRegister(input = {}) {
    const attribution = normalizeRegistration(input, this.#sourceSha);
    const existing = this.#active.get(attribution.command_id);
    if (existing) {
      if (existing.attribution_digest === attribution.attribution_digest) {
        throw new Error('rsi_command_attribution_duplicate_registration');
      }
      throw new Error('rsi_command_attribution_replacement_forbidden');
    }
    if (this.#active.size >= MAX_ACTIVE) throw new Error('rsi_command_attribution_active_capacity_exhausted');
    return eventCore('REGISTERED', { attribution }, this.#sourceSha);
  }

  prepareConsume({ command_id, outcome_episode_digest } = {}) {
    const commandId = uuid(command_id, 'consume_command_id');
    const current = this.#active.get(commandId);
    if (!current) throw new Error('rsi_command_attribution_active_mapping_missing');
    return eventCore('CONSUMED', {
      command_id: commandId,
      attribution_digest: current.attribution_digest,
      outcome_episode_digest: exactDigest(outcome_episode_digest, 'outcome_episode'),
    }, this.#sourceSha);
  }

  apply(rawEvent) {
    const event = verifyEvent(rawEvent, this.#sourceSha);
    if (event.event_type === 'REGISTERED') {
      const attribution = verifyAttribution(event.attribution, this.#sourceSha);
      if (this.#active.has(attribution.command_id)) throw new Error('rsi_command_attribution_replay_duplicate_active');
      if (this.#active.size >= MAX_ACTIVE) throw new Error('rsi_command_attribution_replay_capacity_exhausted');
      this.#active.set(attribution.command_id, attribution);
      this.#registeredCount += 1;
      return attribution;
    }
    if (event.event_type === 'CONSUMED') {
      const commandId = uuid(event.command_id, 'consume_command_id');
      const current = this.#active.get(commandId);
      if (!current) throw new Error('rsi_command_attribution_replay_active_mapping_missing');
      if (current.attribution_digest !== exactDigest(event.attribution_digest, 'consume_attribution')) {
        throw new Error('rsi_command_attribution_consume_digest_mismatch');
      }
      exactDigest(event.outcome_episode_digest, 'consume_outcome_episode');
      this.#active.delete(commandId);
      this.#consumedCount += 1;
      return null;
    }
    throw new Error('rsi_command_attribution_event_type_invalid');
  }

  lookup(commandId) {
    const id = uuid(commandId, 'lookup_command_id');
    const row = this.#active.get(id);
    return row ? Object.freeze(structuredClone(row)) : null;
  }

  replay(events = []) {
    if (!Array.isArray(events) || events.length > 100_000) throw new Error('rsi_command_attribution_replay_invalid');
    for (const event of events) this.apply(event);
    return this.snapshot();
  }

  snapshot() {
    return zeroAuthority({
      schema: RSI_BROWSER_COMMAND_ATTRIBUTION_REGISTRY_SCHEMA,
      version: 1,
      source_sha: this.#sourceSha,
      active_count: this.#active.size,
      max_active: MAX_ACTIVE,
      registered_count: this.#registeredCount,
      consumed_count: this.#consumedCount,
      durable_event_replay_required: true,
      db_lease_is_execution_authority: true,
      registry_is_execution_authority: false,
      candidate_can_register_mapping: false,
      candidate_can_replace_mapping: false,
      second_scheduler: false,
    });
  }
}

export function rsiBrowserCommandAttributionTrustRootSnapshot() {
  const root = zeroAuthority({
    schema: RSI_BROWSER_COMMAND_ATTRIBUTION_ROOT_SCHEMA,
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-browser-command-attribution-registry.mjs',
    max_active: MAX_ACTIVE,
    allowed_producers: [...PRODUCERS].sort(),
    exact_source_sha_binding: true,
    db_lease_evidence_required: true,
    candidate_binding_all_or_none: true,
    mapping_append_only_until_consume: true,
    durable_event_replay_required: true,
    db_lease_is_execution_authority: true,
    registry_is_execution_authority: false,
    candidate_can_register_mapping: false,
    candidate_can_replace_mapping: false,
    page_model_text_authority: false,
    second_scheduler: false,
  });
  return Object.freeze({ ...root, registry_root_digest: digest(root) });
}
