import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const APPLICATION_ID = 0x4456504a;
const MAX_EVENT_BYTES = 32768;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RUN = /^verification_[0-9a-f]{64}$/;
const KINDS = new Set(['INTENT', 'SESSION', 'STEP_INTENT', 'STEP_RESULT', 'TERMINAL']);
const TABLE = `CREATE TABLE verification_events (
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 68),
  idempotency_key TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('INTENT','SESSION','STEP_INTENT','STEP_RESULT','TERMINAL')),
  payload TEXT NOT NULL CHECK (length(CAST(payload AS BLOB)) <= ${MAX_EVENT_BYTES}),
  payload_digest TEXT NOT NULL,
  PRIMARY KEY(run_id, sequence)
) STRICT`;
const SCHEMA = [TABLE,
  'CREATE UNIQUE INDEX verification_intent_key ON verification_events(idempotency_key) WHERE sequence=1',
  `CREATE TRIGGER verification_no_update BEFORE UPDATE ON verification_events BEGIN SELECT RAISE(ABORT, 'verification_journal_immutable'); END`,
  `CREATE TRIGGER verification_no_delete BEFORE DELETE ON verification_events BEGIN SELECT RAISE(ABORT, 'verification_journal_immutable'); END`,
];

export function verificationCanonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(verificationCanonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${verificationCanonical(value[key])}`).join(',')}}`;
  }
  throw new Error('verification_value_invalid');
}

export function verificationDigest(value) {
  return `sha256:${crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : verificationCanonical(value)).digest('hex')}`;
}

function fail(code, cause) { throw new Error(`verification_journal_${code}`, cause ? { cause } : undefined); }
function sql(value) { return value.trim().replace(/\s+/g, ' '); }
function validate(event) {
  const keys = ['schema', 'run_id', 'sequence', 'idempotency_key', 'binding_digest', 'kind', 'at', 'data'];
  if (!event || Object.getPrototypeOf(event) !== Object.prototype ||
      Object.keys(event).sort().join('|') !== keys.sort().join('|') ||
      event.schema !== 'metaengine.development-verification.journal-event.v1' ||
      !RUN.test(event.run_id) || !KEY.test(event.idempotency_key) || !DIGEST.test(event.binding_digest) ||
      !Number.isSafeInteger(event.sequence) || event.sequence < 1 || event.sequence > 68 || !KINDS.has(event.kind) ||
      typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at)) || new Date(event.at).toISOString() !== event.at ||
      !event.data || Object.getPrototypeOf(event.data) !== Object.prototype) fail('event_invalid');
  if (event.sequence === 1 && event.kind !== 'INTENT') fail('intent_required');
  const encoded = verificationCanonical(event);
  if (Buffer.byteLength(encoded) > MAX_EVENT_BYTES) fail('event_too_large');
  return encoded;
}

function transition(events, next) {
  const prior = events.at(-1);
  if (!prior) {
    if (next.kind !== 'INTENT' || next.sequence !== 1) fail('transition_invalid');
    const data = next.data;
    const fields = ['owner_pid', 'owner_token', 'session_key', 'candidate_id', 'source_head', 'executor_id', 'executor_configuration_digest', 'snapshot_root', 'step_ids'];
    if (Object.keys(data).sort().join('|') !== fields.sort().join('|') ||
        !Number.isSafeInteger(data.owner_pid) || data.owner_pid < 1 ||
        typeof data.owner_token !== 'string' || !/^[0-9a-f]{32}$/.test(data.owner_token) ||
        !/^candidate_sha256_[0-9a-f]{64}$/.test(data.candidate_id) || !/^[0-9a-f]{40}$/.test(data.source_head) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(data.executor_id) || !DIGEST.test(data.executor_configuration_digest) ||
        typeof data.snapshot_root !== 'string' || !path.isAbsolute(data.snapshot_root) || path.resolve(data.snapshot_root) !== data.snapshot_root ||
        !Array.isArray(data.step_ids) || data.step_ids.length < 1 || data.step_ids.length > 32 ||
        new Set(data.step_ids).size !== data.step_ids.length || data.step_ids.some(id => !/^[A-Z][A-Z0-9_.:-]{0,63}$/.test(id)) ||
        data.session_key !== `verify_${next.run_id.slice('verification_'.length)}` ||
        next.run_id !== `verification_${verificationDigest({ idempotency_key: next.idempotency_key, binding_digest: next.binding_digest }).slice(7)}`) fail('intent_invalid');
    return;
  }
  if (prior.kind === 'TERMINAL' || next.kind === 'INTENT' || next.sequence !== prior.sequence + 1 ||
      next.run_id !== prior.run_id || next.idempotency_key !== prior.idempotency_key ||
      next.binding_digest !== prior.binding_digest || next.at < prior.at) fail('transition_invalid');
  if (next.kind === 'TERMINAL') {
    const receipt = next.data.receipt;
    const intent = events[0];
    const results = events.filter(event => event.kind === 'STEP_RESULT').map(event => event.data);
    const receiptKeys = ['schema', 'run_id', 'candidate_id', 'source_head', 'binding_digest', 'executor_id', 'executor_configuration_digest',
      'state', 'reason', 'input_manifest_digest', 'output_manifest_digest', 'steps', 'pending_step_id', 'teardown', 'started_at', 'completed_at',
      'evidence_origin', 'isolation_qualification', 'automatic_retry_allowed', 'promotion_authorized', 'authority_effect', 'receipt_digest'];
    if (Object.keys(next.data).join('|') !== 'receipt' || !receipt || Object.getPrototypeOf(receipt) !== Object.prototype ||
        Object.keys(receipt).sort().join('|') !== receiptKeys.sort().join('|') || receipt.schema !== 'metaengine.development-verification.receipt.v1' ||
        receipt.run_id !== next.run_id || receipt.binding_digest !== next.binding_digest ||
        !['PASSED', 'FAILED', 'AMBIGUOUS'].includes(receipt.state) ||
        receipt.promotion_authorized !== false || receipt.authority_effect !== false || receipt.automatic_retry_allowed !== false ||
        receipt.source_head !== intent.data.source_head || receipt.candidate_id !== intent.data.candidate_id ||
        receipt.executor_id !== intent.data.executor_id || receipt.executor_configuration_digest !== intent.data.executor_configuration_digest ||
        !(receipt.reason === null || typeof receipt.reason === 'string' && receipt.reason.length > 0 && receipt.reason.length <= 240) ||
        !(receipt.input_manifest_digest === null || DIGEST.test(receipt.input_manifest_digest)) ||
        !(receipt.output_manifest_digest === null || DIGEST.test(receipt.output_manifest_digest)) ||
        typeof receipt.completed_at !== 'string' || !Number.isFinite(Date.parse(receipt.completed_at)) || new Date(receipt.completed_at).toISOString() !== receipt.completed_at ||
        verificationCanonical(receipt.steps) !== verificationCanonical(results) || receipt.started_at !== intent.at ||
        receipt.completed_at < intent.at || receipt.completed_at > next.at ||
        receipt.pending_step_id !== (prior.kind === 'STEP_INTENT' ? prior.data.step_id : null) ||
        receipt.evidence_origin !== 'HOST_OBSERVED_TRUSTED_EXECUTOR' || receipt.isolation_qualification !== 'NOT_ESTABLISHED_BY_THIS_RECEIPT' ||
        !DIGEST.test(receipt.receipt_digest)) fail('receipt_invalid');
    const { receipt_digest, ...core } = receipt;
    if (verificationDigest(core) !== receipt_digest) fail('receipt_digest_invalid');
    if (receipt.teardown !== null && (Object.keys(receipt.teardown).sort().join('|') !== ['stopped', 'persistent_state_deleted', 'observation_digest'].sort().join('|') ||
        receipt.teardown.stopped !== true || receipt.teardown.persistent_state_deleted !== true || !DIGEST.test(receipt.teardown.observation_digest))) fail('receipt_teardown_invalid');
    if (receipt.state === 'PASSED' && (receipt.reason !== null || results.length !== intent.data.step_ids.length ||
        results.some(row => !row.passed) || !DIGEST.test(receipt.input_manifest_digest) || !DIGEST.test(receipt.output_manifest_digest) ||
        receipt.teardown?.stopped !== true || receipt.teardown?.persistent_state_deleted !== true || !DIGEST.test(receipt.teardown?.observation_digest))) fail('passing_evidence_incomplete');
    return;
  }
  if (next.kind === 'SESSION') {
    if (Object.keys(next.data).join('|') !== 'session_id' || prior.kind !== 'INTENT' || typeof next.data.session_id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(next.data.session_id)) fail('session_invalid');
    return;
  }
  const completed = events.filter(event => event.kind === 'STEP_RESULT').length;
  const expectedId = events[0].data.step_ids[completed];
  if (next.data.step_id !== expectedId) fail('step_invalid');
  if (next.kind === 'STEP_INTENT' && (Object.keys(next.data).join('|') !== 'step_id' || !['SESSION', 'STEP_RESULT'].includes(prior.kind))) fail('step_invalid');
  if (next.kind === 'STEP_RESULT' && (prior.kind !== 'STEP_INTENT' || prior.data.step_id !== next.data.step_id)) fail('step_invalid');
  if (next.kind === 'STEP_RESULT') {
    const row = next.data;
    const fields = ['step_id', 'exit_code', 'timed_out', 'output_limit_exceeded', 'passed', 'stdout_bytes', 'stdout_digest', 'stderr_bytes', 'stderr_digest'];
    if (Object.keys(row).sort().join('|') !== fields.sort().join('|') ||
        !(row.exit_code === null || Number.isSafeInteger(row.exit_code) && row.exit_code >= 0 && row.exit_code <= 255) ||
        typeof row.timed_out !== 'boolean' || typeof row.output_limit_exceeded !== 'boolean' ||
        row.passed !== (row.exit_code === 0 && !row.timed_out && !row.output_limit_exceeded) ||
        !Number.isSafeInteger(row.stdout_bytes) || row.stdout_bytes < 0 || !DIGEST.test(row.stdout_digest) ||
        !Number.isSafeInteger(row.stderr_bytes) || row.stderr_bytes < 0 || !DIGEST.test(row.stderr_digest)) fail('step_result_invalid');
  }
}

/** Append-only local observations, never execution or promotion authority. The
 * caller must supply an existing private directory. Corruption, foreign schemas,
 * contention and capacity exhaustion fail closed; no fallback or repair occurs.
 */
export function createDevelopmentVerificationSqliteJournal({ filePath, maxRuns = 1000, maxBytes = 32 * 1024 * 1024 } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.resolve(filePath) !== filePath || filePath.includes('\0') ||
      !Number.isSafeInteger(maxRuns) || maxRuns < 1 || maxRuns > 100000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 65536 || maxBytes > 256 * 1024 * 1024) fail('configuration_invalid');
  if (fs.realpathSync(path.dirname(filePath)) !== path.dirname(filePath)) fail('path_invalid');
  let database;
  let closed = false;
  const assertSchema = db => {
    const rows = db.prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
        db.prepare('PRAGMA user_version').get().user_version !== 1 ||
        verificationCanonical(rows.map(row => sql(row.sql)).sort()) !== verificationCanonical(SCHEMA.map(sql).sort())) fail('schema_invalid');
  };
  const decode = row => {
    if (typeof row.payload !== 'string' || Buffer.byteLength(row.payload) > MAX_EVENT_BYTES || verificationDigest(row.payload) !== row.payload_digest) fail('corrupt');
    let event;
    try { event = JSON.parse(row.payload); } catch (error) { fail('corrupt', error); }
    if (validate(event) !== row.payload || event.run_id !== row.run_id || event.sequence !== row.sequence ||
        event.kind !== row.kind || event.idempotency_key !== row.idempotency_key || event.binding_digest !== row.binding_digest) fail('corrupt');
    return event;
  };
  try {
    const exists = fs.existsSync(filePath);
    if (exists) {
      const st = fs.lstatSync(filePath);
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || !st.size || st.size > maxBytes) fail('file_invalid');
      const probe = new DatabaseSync(filePath, { readOnly: true, allowExtension: false, timeout: 0 });
      try {
        assertSchema(probe);
        if (probe.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('durability_invalid');
      } finally { probe.close(); }
    }
    database = new DatabaseSync(filePath, { allowExtension: false, timeout: 0, enableDoubleQuotedStringLiterals: false });
    database.exec('PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF');
    if (database.prepare('PRAGMA journal_mode=DELETE').get().journal_mode !== 'delete' || database.prepare('PRAGMA synchronous').get().synchronous !== 2) fail('durability_invalid');
    const pages = Math.floor(maxBytes / database.prepare('PRAGMA page_size').get().page_size);
    if (database.prepare('PRAGMA page_count').get().page_count > pages) fail('size_exceeded');
    database.exec(`PRAGMA max_page_count=${pages}`);
    database.exec('BEGIN IMMEDIATE');
    try {
      if (!exists) {
        SCHEMA.forEach(statement => database.exec(statement));
        database.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1`);
      } else { assertSchema(database); }
      if (database.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
          database.prepare('SELECT count(*) count FROM verification_events WHERE sequence=1').get().count > maxRuns) fail('corrupt_or_capacity');
      let events = [];
      for (const row of database.prepare('SELECT * FROM verification_events ORDER BY run_id, sequence').iterate()) {
        const event = decode(row);
        if (events[0]?.run_id !== event.run_id) events = [];
        transition(events, event);
        events.push(event);
      }
      database.exec('COMMIT');
    } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; }
  } catch (error) { try { database?.close(); } catch {} fail('open_failed', error); }
  const read = runId => {
    if (closed) fail('closed');
    if (!RUN.test(runId)) fail('run_invalid');
    const events = [];
    for (const row of database.prepare('SELECT * FROM verification_events WHERE run_id=? ORDER BY sequence').all(runId)) {
      const event = decode(row);
      transition(events, event);
      events.push(event);
    }
    return events;
  };
  return Object.freeze({
    read,
    find(key) {
      if (closed || !KEY.test(String(key))) fail('key_invalid');
      const row = database.prepare('SELECT run_id FROM verification_events WHERE sequence=1 AND idempotency_key=?').get(key);
      return row ? read(row.run_id) : [];
    },
    unfinished() {
      if (closed) fail('closed');
      return database.prepare("SELECT run_id FROM verification_events WHERE sequence=1 AND run_id NOT IN (SELECT run_id FROM verification_events WHERE kind='TERMINAL') ORDER BY run_id").all().map(row => read(row.run_id));
    },
    append(event) {
      const payload = validate(event);
      if (closed) fail('closed');
      database.exec('BEGIN IMMEDIATE');
      try {
        const events = read(event.run_id);
        transition(events, event);
        if (event.kind === 'INTENT' && database.prepare('SELECT count(*) count FROM verification_events WHERE sequence=1').get().count >= maxRuns) fail('capacity_exceeded');
        database.prepare('INSERT INTO verification_events VALUES (?,?,?,?,?,?,?)').run(event.run_id, event.sequence, event.idempotency_key, event.binding_digest, event.kind, payload, verificationDigest(payload));
        database.exec('COMMIT');
        return JSON.parse(payload);
      } catch (error) { try { database.exec('ROLLBACK'); } catch {} fail('append_failed', error); }
    },
    close() { if (!closed) { closed = true; database.close(); } },
  });
}
