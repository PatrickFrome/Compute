import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_RUNTIME_LEDGER_EVENT_SCHEMA = 'metaengine.rsi.runtime-ledger-event.v1';
export const RSI_RUNTIME_LEDGER_SNAPSHOT_SCHEMA = 'metaengine.rsi.runtime-ledger-snapshot.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST64 = /^[0-9a-f]{64}$/;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENT_TYPE = 96;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'page_text',
  'raw_dom',
  'raw_html',
  'prompt',
  'prompt_plaintext',
  'input_value',
  'input_values',
  'cookie',
  'cookies',
  'authorization',
  'access_token',
  'refresh_token',
  'secret',
  'password',
]);
const AUTHORITY_BOOLEAN_KEYS = new Set([
  'authority_effect',
  'execution_authority',
  'browser_authority',
  'scheduler_authority',
  'task_authority',
  'promotion_authority',
  'self_update_authority',
  'production_mutation_authority',
  'automatic_retry_allowed',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function exactSha(value, field = 'source_sha') {
  const sha = String(value || '').trim().toLowerCase();
  if (!SHA40.test(sha)) throw new Error(`rsi_runtime_ledger_${field}_invalid`);
  return sha;
}

function eventType(value) {
  const type = String(value || '').trim().toUpperCase();
  if (!type || type.length > MAX_EVENT_TYPE || !/^[A-Z0-9_.:-]+$/.test(type)) {
    throw new Error('rsi_runtime_ledger_event_type_invalid');
  }
  return type;
}

function assertZeroAuthorityPayload(value, pathParts = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) assertZeroAuthorityPayload(value[i], [...pathParts, String(i)]);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = String(key).toLowerCase();
    if (FORBIDDEN_PAYLOAD_KEYS.has(normalized)) {
      throw new Error(`rsi_runtime_ledger_sensitive_payload_forbidden:${[...pathParts, key].join('.')}`);
    }
    if (AUTHORITY_BOOLEAN_KEYS.has(normalized) && child === true) {
      throw new Error(`rsi_runtime_ledger_authority_escalation_forbidden:${[...pathParts, key].join('.')}`);
    }
    assertZeroAuthorityPayload(child, [...pathParts, key]);
  }
}

function normalizePayload(payload) {
  if (payload == null) return Object.freeze({});
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('rsi_runtime_ledger_payload_object_required');
  const clone = structuredClone(payload);
  assertZeroAuthorityPayload(clone);
  const bytes = Buffer.byteLength(canonical(clone), 'utf8');
  if (bytes > MAX_EVENT_BYTES) throw new Error('rsi_runtime_ledger_payload_too_large');
  return Object.freeze(clone);
}

function parseLine(line, lineNumber) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    throw new Error(`rsi_runtime_ledger_json_invalid:${lineNumber}`);
  }
  if (row?.schema !== RSI_RUNTIME_LEDGER_EVENT_SCHEMA) throw new Error(`rsi_runtime_ledger_schema_invalid:${lineNumber}`);
  if (!Number.isSafeInteger(row.seq) || row.seq < 1) throw new Error(`rsi_runtime_ledger_seq_invalid:${lineNumber}`);
  exactSha(row.source_sha);
  eventType(row.type);
  if (typeof row.at !== 'string' || Number.isNaN(Date.parse(row.at))) throw new Error(`rsi_runtime_ledger_timestamp_invalid:${lineNumber}`);
  if (row.previous_digest != null && !DIGEST64.test(String(row.previous_digest))) throw new Error(`rsi_runtime_ledger_previous_digest_invalid:${lineNumber}`);
  if (!DIGEST64.test(String(row.event_digest || ''))) throw new Error(`rsi_runtime_ledger_event_digest_invalid:${lineNumber}`);
  normalizePayload(row.payload || {});
  const core = {
    schema: RSI_RUNTIME_LEDGER_EVENT_SCHEMA,
    seq: row.seq,
    type: row.type,
    at: row.at,
    source_sha: row.source_sha,
    previous_digest: row.previous_digest ?? null,
    payload: row.payload || {},
    authority_effect: false,
  };
  if (digest(core) !== row.event_digest) throw new Error(`rsi_runtime_ledger_digest_mismatch:${lineNumber}`);
  return Object.freeze({ ...core, event_digest: row.event_digest });
}

export class RsiRuntimeLedger {
  #path;
  #sourceSha;
  #clock;
  #events = [];
  #initialized = false;

  constructor({ ledgerPath, source_sha, clock = () => Date.now() } = {}) {
    if (!ledgerPath || typeof ledgerPath !== 'string') throw new Error('rsi_runtime_ledger_path_required');
    if (typeof clock !== 'function') throw new Error('rsi_runtime_ledger_clock_required');
    this.#path = path.resolve(ledgerPath);
    this.#sourceSha = exactSha(source_sha);
    this.#clock = clock;
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    let text = '';
    try {
      text = await fs.readFile(this.#path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const lines = text.split(/\r?\n/).filter(Boolean);
    let previous = null;
    for (let i = 0; i < lines.length; i += 1) {
      const row = parseLine(lines[i], i + 1);
      if (row.seq !== i + 1) throw new Error(`rsi_runtime_ledger_sequence_gap:${i + 1}`);
      if ((row.previous_digest ?? null) !== previous) throw new Error(`rsi_runtime_ledger_chain_mismatch:${i + 1}`);
      this.#events.push(row);
      previous = row.event_digest;
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async append(type, payload = {}) {
    if (!this.#initialized) throw new Error('rsi_runtime_ledger_not_initialized');
    const core = {
      schema: RSI_RUNTIME_LEDGER_EVENT_SCHEMA,
      seq: this.#events.length + 1,
      type: eventType(type),
      at: new Date(this.#clock()).toISOString(),
      source_sha: this.#sourceSha,
      previous_digest: this.#events.at(-1)?.event_digest || null,
      payload: normalizePayload(payload),
      authority_effect: false,
    };
    const row = Object.freeze({ ...core, event_digest: digest(core) });
    const serialized = `${JSON.stringify(row)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_BYTES + 8192) throw new Error('rsi_runtime_ledger_event_too_large');

    const handle = await fs.open(this.#path, 'a', 0o600);
    try {
      await handle.write(serialized, null, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.#events.push(row);
    return structuredClone(row);
  }

  events({ limit = 64 } = {}) {
    const bounded = Math.max(0, Math.min(256, Number(limit) || 0));
    return Object.freeze(this.#events.slice(-bounded).map((row) => Object.freeze(structuredClone(row))));
  }

  eventsSince({ after_seq = 0, limit = 256 } = {}) {
    const after = Number(after_seq);
    const bounded = Number(limit);
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('rsi_runtime_ledger_after_seq_invalid');
    if (!Number.isSafeInteger(bounded) || bounded < 1 || bounded > 256) throw new Error('rsi_runtime_ledger_replay_limit_invalid');
    return Object.freeze(
      this.#events
        .slice(after, after + bounded)
        .map((row) => Object.freeze(structuredClone(row))),
    );
  }

  snapshot() {
    return Object.freeze({
      schema: RSI_RUNTIME_LEDGER_SNAPSHOT_SCHEMA,
      source_sha: this.#sourceSha,
      initialized: this.#initialized,
      event_count: this.#events.length,
      last_seq: this.#events.at(-1)?.seq || 0,
      last_event_type: this.#events.at(-1)?.type || null,
      last_event_digest: this.#events.at(-1)?.event_digest || null,
      append_only: true,
      fsync_each_event: true,
      hash_chained: true,
      raw_page_text_allowed: false,
      prompt_plaintext_allowed: false,
      authority_effect: false,
      automatic_retry_allowed: false,
    });
  }
}
