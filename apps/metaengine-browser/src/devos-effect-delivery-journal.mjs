import fs from 'node:fs/promises';
import path from 'node:path';

export const DEVOS_EFFECT_DELIVERY_JOURNAL_SCHEMA = 'metaengine.devos.effect-delivery-journal.v1';
export const DEVOS_EFFECT_DELIVERY_JOURNAL_VERSION = '1.0.0';
export const DEVOS_EFFECT_DELIVERY_JOURNAL_FILE = 'metaengine-devos-effect-delivery-journal-v1.json';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_RE = /^agent_[a-z0-9-]{8,64}$/;
const TAB_RE = /^tab_[0-9a-f-]{36}$/i;
const TARGET_RE = /^webcontents:[1-9][0-9]*$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const STATES = new Set(['EXECUTION_STARTED', 'DELIVERY_PENDING', 'CONFIRMED', 'AMBIGUOUS']);
const NON_TERMINAL = new Set(['EXECUTION_STARTED', 'DELIVERY_PENDING', 'AMBIGUOUS']);
const TRANSITIONS = new Map([
  ['EXECUTION_STARTED', new Set(['DELIVERY_PENDING', 'CONFIRMED', 'AMBIGUOUS'])],
  ['DELIVERY_PENDING', new Set(['CONFIRMED', 'AMBIGUOUS'])],
  ['CONFIRMED', new Set([])],
  ['AMBIGUOUS', new Set(['CONFIRMED'])],
]);

function clip(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`devos_effect_journal_${name}_invalid`);
  return n;
}

function normalizeBinding(value = {}) {
  const binding = {
    task_id: String(value.task_id || '').toLowerCase(),
    lease_generation: positiveInt(value.lease_generation, 'lease_generation'),
    agent_id: String(value.agent_id || '').toLowerCase(),
    tab_id: String(value.tab_id || ''),
    target_id: String(value.target_id || '').toLowerCase(),
    agent_generation_epoch: positiveInt(value.agent_generation_epoch, 'agent_generation_epoch'),
    prompt_sha256: String(value.prompt_sha256 || '').toLowerCase(),
  };
  if (!UUID_RE.test(binding.task_id)) throw new Error('devos_effect_journal_task_id_invalid');
  if (!AGENT_RE.test(binding.agent_id)) throw new Error('devos_effect_journal_agent_id_invalid');
  if (!TAB_RE.test(binding.tab_id)) throw new Error('devos_effect_journal_tab_id_invalid');
  if (!TARGET_RE.test(binding.target_id)) throw new Error('devos_effect_journal_target_id_invalid');
  if (!HASH_RE.test(binding.prompt_sha256)) throw new Error('devos_effect_journal_prompt_sha256_invalid');
  return Object.freeze(binding);
}

function exactKey(binding) {
  const b = normalizeBinding(binding);
  return [b.task_id, b.lease_generation, b.agent_id, b.tab_id, b.target_id, b.agent_generation_epoch, b.prompt_sha256].join(':');
}

function leaseKey(binding) {
  const b = normalizeBinding(binding);
  return `${b.task_id}:${b.lease_generation}`;
}

function safeEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-z0-9_]{1,64}$/i.test(key)) continue;
    if (typeof raw === 'boolean' || typeof raw === 'number' || raw == null) out[key] = raw;
    else if (typeof raw === 'string') out[key] = raw.slice(0, 300);
  }
  return out;
}

function validateEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('devos_effect_journal_entry_invalid');
  const binding = normalizeBinding(value);
  const state = String(value.state || '').toUpperCase();
  if (!STATES.has(state)) throw new Error('devos_effect_journal_state_invalid');
  if (String(value.effect_key || '') !== exactKey(binding)) throw new Error('devos_effect_journal_effect_key_invalid');
  if (value.authority_effect !== false || value.automatic_retry_allowed !== false) throw new Error('devos_effect_journal_authority_invalid');
  const createdAt = Date.parse(String(value.created_at || ''));
  const updatedAt = Date.parse(String(value.updated_at || ''));
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) throw new Error('devos_effect_journal_timestamp_invalid');
  return Object.freeze({
    ...binding,
    effect_key: exactKey(binding),
    state,
    created_at: new Date(createdAt).toISOString(),
    updated_at: new Date(updatedAt).toISOString(),
    evidence: safeEvidence(value.evidence),
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function validateDocument(value) {
  if (!value || value.schema !== DEVOS_EFFECT_DELIVERY_JOURNAL_SCHEMA || value.version !== DEVOS_EFFECT_DELIVERY_JOURNAL_VERSION) {
    throw new Error('devos_effect_journal_schema_invalid');
  }
  if (value.authority_effect !== false || value.automatic_retry_allowed !== false) throw new Error('devos_effect_journal_authority_invalid');
  if (!Array.isArray(value.entries)) throw new Error('devos_effect_journal_entries_invalid');
  const entries = value.entries.map(validateEntry);
  const exact = new Set();
  const leases = new Map();
  for (const entry of entries) {
    if (exact.has(entry.effect_key)) throw new Error('devos_effect_journal_duplicate_effect_key');
    exact.add(entry.effect_key);
    const lk = leaseKey(entry);
    const prior = leases.get(lk);
    if (prior && prior.effect_key !== entry.effect_key) throw new Error('devos_effect_journal_binding_drift');
    leases.set(lk, entry);
  }
  return entries;
}

async function atomicWrite(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(temp, 'w', 0o600);
  try {
    await handle.write(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, target);
}

export class DevOsEffectDeliveryJournal {
  #statePath;
  #maxEntries;
  #entries = [];
  #initialized = false;
  #tail = Promise.resolve();

  constructor({ statePath, maxEntries = 256 } = {}) {
    if (!statePath) throw new Error('devos_effect_journal_path_required');
    this.#statePath = String(statePath);
    this.#maxEntries = Math.max(32, Math.min(2048, Number(maxEntries) || 256));
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    let raw;
    try {
      raw = await fs.readFile(this.#statePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#entries = [];
      this.#initialized = true;
      return this.snapshot();
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('devos_effect_journal_json_invalid'); }
    this.#entries = validateDocument(parsed).map((entry) => structuredClone(entry));
    this.#initialized = true;
    return this.snapshot();
  }

  #assertInitialized() {
    if (!this.#initialized) throw new Error('devos_effect_journal_not_initialized');
  }

  #document() {
    return {
      schema: DEVOS_EFFECT_DELIVERY_JOURNAL_SCHEMA,
      version: DEVOS_EFFECT_DELIVERY_JOURNAL_VERSION,
      entries: this.#entries.map((entry) => structuredClone(entry)),
      automatic_retry_allowed: false,
      authority_effect: false,
    };
  }

  snapshot() {
    this.#assertInitialized();
    return structuredClone(this.#document());
  }

  find(binding) {
    this.#assertInitialized();
    const key = exactKey(binding);
    return structuredClone(this.#entries.find((entry) => entry.effect_key === key) || null);
  }

  async #mutate(binding, nextState, evidence = {}) {
    const b = normalizeBinding(binding);
    const key = exactKey(b);
    const lk = leaseKey(b);
    const state = String(nextState || '').toUpperCase();
    if (!STATES.has(state)) throw new Error('devos_effect_journal_state_invalid');
    this.#tail = this.#tail.then(async () => {
      this.#assertInitialized();
      const drift = this.#entries.find((entry) => leaseKey(entry) === lk && entry.effect_key !== key);
      if (drift) throw new Error('devos_effect_journal_binding_drift');
      const index = this.#entries.findIndex((entry) => entry.effect_key === key);
      const now = new Date().toISOString();
      if (index < 0) {
        if (state !== 'EXECUTION_STARTED') throw new Error(`devos_effect_journal_transition_invalid:NEW:${state}`);
        this.#entries.push({
          ...b,
          effect_key: key,
          state,
          created_at: now,
          updated_at: now,
          evidence: safeEvidence(evidence),
          automatic_retry_allowed: false,
          authority_effect: false,
        });
      } else {
        const current = this.#entries[index];
        if (state !== current.state && !(TRANSITIONS.get(current.state) || new Set()).has(state)) {
          throw new Error(`devos_effect_journal_transition_invalid:${current.state}:${state}`);
        }
        this.#entries[index] = {
          ...current,
          state,
          updated_at: now,
          evidence: { ...safeEvidence(current.evidence), ...safeEvidence(evidence) },
          automatic_retry_allowed: false,
          authority_effect: false,
        };
      }
      const live = this.#entries.filter((entry) => NON_TERMINAL.has(entry.state));
      const terminal = this.#entries.filter((entry) => !NON_TERMINAL.has(entry.state));
      terminal.sort((a, b2) => Date.parse(b2.updated_at) - Date.parse(a.updated_at));
      this.#entries = [...live, ...terminal.slice(0, Math.max(0, this.#maxEntries - live.length))];
      await atomicWrite(this.#statePath, this.#document());
      return structuredClone(this.#entries.find((entry) => entry.effect_key === key));
    });
    return this.#tail;
  }

  beginExecution(binding, evidence = {}) { return this.#mutate(binding, 'EXECUTION_STARTED', evidence); }
  markDeliveryPending(binding, evidence = {}) { return this.#mutate(binding, 'DELIVERY_PENDING', evidence); }
  markConfirmed(binding, evidence = {}) { return this.#mutate(binding, 'CONFIRMED', evidence); }
  markAmbiguous(binding, evidence = {}) { return this.#mutate(binding, 'AMBIGUOUS', evidence); }
}
