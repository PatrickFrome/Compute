import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEVELOPMENT_CHECKPOINT_SCHEMA = 'metaengine.development-checkpoint.v1';
export const DEVELOPMENT_CHECKPOINT_PROJECT = 'jhriwwsryeqsvvvufkok';
export const DEVELOPMENT_CHECKPOINT_SUMMARIES = Object.freeze([
  'SOURCE_AUDIT', 'SOURCE_RECOVERY', 'DATABASE_AUDIT', 'DATABASE_CONNECTIVITY',
  'LOCAL_PROVIDER_COMPATIBILITY', 'CLIENT_UI', 'CLIENT_CONTINUITY', 'CLIENT_STARTUP',
  'SECURITY_REPAIR', 'REGRESSION_VALIDATION', 'CHECKPOINT_PERSISTENCE', 'GITHUB_PUBLICATION',
]);
export const DEVELOPMENT_CHECKPOINT_SUITES = Object.freeze([
  'BROWSER_PROVIDER', 'BROWSER_SECURITY', 'BROWSER_CONTINUITY', 'BROWSER_FULL',
  'CLIENT_UI', 'CLIENT_STATE_RUNTIME', 'CHECKPOINT', 'SOURCE_CHECK', 'INTEGRATION',
]);
const STATES = ['LIVE_DB_ONLY', 'EVIDENCE_READY', 'PARTIAL'];
const STATUSES = ['VERIFIED', 'PARTIAL', 'FAILED', 'NOT_RUN'];
const MAX_BYTES = 262144;
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const immutableKeys = ['checkpoint_id', 'project_ref', 'source_parent_sha', 'evidence_state',
  'scope', 'canonical_checkpoint', 'authority_effect', 'payload', 'canonical_payload_sha256'];
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
class CheckpointError extends Error {}
function fail(code) { throw new CheckpointError(`development_checkpoint_${code}`); }
function shape(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('fields_invalid');
}
function member(value, values) { if (!values.includes(value)) fail('value_invalid'); return value; }
function exactHash(value, pattern) { if (typeof value !== 'string' || !pattern.test(value)) fail('digest_invalid'); return value; }
function count(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 10000000) fail('test_count_invalid'); return value; }
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function unique(rows, key) { if (new Set(rows.map(key)).size !== rows.length) fail('duplicate_evidence'); return rows; }
function publicGithubUrl(value) {
  // Only public provenance locations in this repository. No query, fragment,
  // userinfo, arbitrary labels or opaque token-shaped path components.
  if (typeof value !== 'string' || !/^https:\/\/github\.com\/PatrickFrome\/Compute\/(?:commit\/[a-f0-9]{40}|pull\/[1-9][0-9]{0,14}|actions\/runs\/[1-9][0-9]{0,14}(?:\/job\/[1-9][0-9]{0,14})?)$/.test(value)) fail('github_url_invalid');
  return value;
}
function publicPayload(value) {
  shape(value, ['source_sha', 'summaries', 'tests', 'github_urls']);
  if (!Array.isArray(value.summaries) || value.summaries.length < 1 || value.summaries.length > DEVELOPMENT_CHECKPOINT_SUMMARIES.length
    || !Array.isArray(value.tests) || value.tests.length > DEVELOPMENT_CHECKPOINT_SUITES.length
    || !Array.isArray(value.github_urls) || value.github_urls.length > 32) fail('evidence_bounds_invalid');
  const summaries = unique(value.summaries.map(row => {
    shape(row, ['code', 'status']);
    return { code: member(row.code, DEVELOPMENT_CHECKPOINT_SUMMARIES), status: member(row.status, STATUSES) };
  }), row => row.code).sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const tests = unique(value.tests.map(row => {
    shape(row, ['suite', 'total', 'passed', 'failed', 'skipped']);
    const result = { suite: member(row.suite, DEVELOPMENT_CHECKPOINT_SUITES), total: count(row.total),
      passed: count(row.passed), failed: count(row.failed), skipped: count(row.skipped) };
    if (result.total !== result.passed + result.failed + result.skipped) fail('test_count_mismatch');
    return result;
  }), row => row.suite).sort((a, b) => a.suite < b.suite ? -1 : a.suite > b.suite ? 1 : 0);
  return {
    schema: DEVELOPMENT_CHECKPOINT_SCHEMA,
    source_sha: exactHash(value.source_sha, SHA), summaries, tests,
    github_urls: unique(value.github_urls.map(publicGithubUrl), row => row).sort(),
  };
}

/** Build public, typed audit evidence. No free text, paths, credentials or logs. */
export function buildDevelopmentCheckpoint(input) {
  shape(input, ['source_parent_sha', 'evidence_state', 'payload'], ['checkpoint_id']);
  const payload = publicPayload(input.payload);
  const serialized = canonical(payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) fail('payload_too_large');
  const core = {
    project_ref: DEVELOPMENT_CHECKPOINT_PROJECT,
    source_parent_sha: exactHash(input.source_parent_sha, SHA),
    evidence_state: member(input.evidence_state, STATES),
    scope: 'OPERATIONAL_AUDIT_ONLY', canonical_checkpoint: false, authority_effect: false,
    payload, canonical_payload_sha256: hash(serialized),
  };
  const checkpoint_id = Object.hasOwn(input, 'checkpoint_id') ? exactHash(input.checkpoint_id, HASH) : hash(canonical(core));
  return deepFreeze({ checkpoint_id, ...core });
}

function validateCheckpoint(value) {
  shape(value, immutableKeys);
  shape(value.payload, ['schema', 'source_sha', 'summaries', 'tests', 'github_urls']);
  const { schema, ...payload } = value.payload;
  if (schema !== DEVELOPMENT_CHECKPOINT_SCHEMA) fail('schema_invalid');
  const expected = buildDevelopmentCheckpoint({ checkpoint_id: value.checkpoint_id,
    source_parent_sha: value.source_parent_sha, evidence_state: value.evidence_state, payload });
  if (canonical(value) !== canonical(expected)) fail('checkpoint_mismatch');
  return expected;
}

const INSERT = `INSERT INTO destruktion_meta.metaengine_audit_checkpoint_v1
  (checkpoint_id, project_ref, source_parent_sha, evidence_state, scope, canonical_checkpoint, authority_effect, payload)
  VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::boolean, $7::boolean, $8::jsonb)
  ON CONFLICT (checkpoint_id) DO NOTHING RETURNING checkpoint_id`;
const READBACK = `SELECT checkpoint_id, project_ref, source_parent_sha, evidence_state, scope,
  canonical_checkpoint, authority_effect, payload, payload::text AS payload_json, payload_sha256
  FROM destruktion_meta.metaengine_audit_checkpoint_v1 WHERE checkpoint_id = $1::text`;

/** One append-only transaction; even idempotent replays require exact readback. */
export async function writeDevelopmentCheckpoint({ sql, checkpoint } = {}) {
  const expected = validateCheckpoint(checkpoint);
  if (!sql || typeof sql.begin !== 'function') fail('sql_required');
  try {
    return await sql.begin('isolation level read committed read write', async tx => {
      await tx.unsafe("SET LOCAL statement_timeout = '10s'");
      await tx.unsafe("SET LOCAL lock_timeout = '5s'");
      const inserted = await tx.unsafe(INSERT, [expected.checkpoint_id, expected.project_ref, expected.source_parent_sha,
        expected.evidence_state, expected.scope, false, false, canonical(expected.payload)]);
      if (!Array.isArray(inserted) || inserted.length > 1
        || (inserted.length === 1 && inserted[0].checkpoint_id !== expected.checkpoint_id)) fail('insert_readback_invalid');
      const rows = await tx.unsafe(READBACK, [expected.checkpoint_id]);
      if (!Array.isArray(rows) || rows.length !== 1) fail('readback_missing');
      shape(rows[0], [...immutableKeys.filter(key => key !== 'canonical_payload_sha256'), 'payload_json', 'payload_sha256']);
      const { payload_json: pgJson, payload_sha256: pgHash, ...stored } = rows[0];
      const { canonical_payload_sha256: canonicalHash, ...expectedStored } = expected;
      // Compare every immutable column, including the actual JSONB bytes after
      // canonicalization. A copied old hash never validates a changed payload.
      if (canonical(stored) !== canonical(expectedStored)) fail(inserted.length ? 'readback_mismatch' : 'id_conflict');
      // payload_sha256 is GENERATED ALWAYS from PostgreSQL JSONB text. Its
      // spacing/key order differ from the application canonical JSON digest.
      if (typeof pgJson !== 'string' || Buffer.byteLength(pgJson, 'utf8') > MAX_BYTES
        || hash(pgJson) !== pgHash) fail('readback_digest_mismatch');
      let parsed;
      try { parsed = JSON.parse(pgJson); } catch { fail('readback_json_invalid'); }
      if (canonical(parsed) !== canonical(expected.payload)) fail('readback_json_mismatch');
      return Object.freeze({ checkpoint_id: expected.checkpoint_id, payload_sha256: pgHash, canonical_payload_sha256: canonicalHash,
        state: inserted.length ? 'INSERTED' : 'ALREADY_PRESENT', evidence_state: expected.evidence_state,
        scope: expected.scope, canonical_checkpoint: false, authority_effect: false });
    });
  } catch (error) {
    // PostgreSQL errors may contain SQL details or private connection data.
    // A lost COMMIT response remains ambiguous; this function never retries.
    if (error instanceof CheckpointError) throw error;
    fail('transaction_failed');
  }
}

export function validateCheckpointDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('loopback_database_required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.search || url.hash || !url.pathname || url.pathname === '/') fail('loopback_database_required');
  return value;
}

export async function runDevelopmentCheckpointCli({ args = process.argv.slice(2), env = process.env } = {}) {
  let sql;
  try {
    if (args.length !== 2 || args[0] !== '--input') fail('usage_input_required');
    const databaseUrl = validateCheckpointDatabaseUrl(env.LOCAL_STATE_ADMIN_DATABASE_URL);
    const file = await open(args[1], 'r');
    let raw;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_BYTES) fail('input_file_invalid');
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > MAX_BYTES) fail('input_file_invalid');
      raw = bytes.subarray(0, bytesRead).toString('utf8');
    } finally { await file.close(); }
    const checkpoint = buildDevelopmentCheckpoint(JSON.parse(raw));
    const { default: postgres } = await import('postgres');
    sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 5 });
    return await writeDevelopmentCheckpoint({ sql, checkpoint });
  } catch (error) {
    if (error instanceof CheckpointError) throw error;
    fail('cli_failed');
  } finally {
    // A shutdown error after confirmed commit must not erase the receipt.
    if (sql) await sql.end({ timeout: 5 }).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runDevelopmentCheckpointCli())); }
  catch (error) { console.error(JSON.stringify({ error: error instanceof CheckpointError ? error.message : 'development_checkpoint_cli_failed', authority_effect: false })); process.exitCode = 1; }
}
