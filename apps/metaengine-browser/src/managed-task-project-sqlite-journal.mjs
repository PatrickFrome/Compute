import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createWorkspaceReservation, recordWorkspaceMaterializationReadback } from './workspace-manager.mjs';

const ENTRY_SCHEMA = 'metaengine.devos.managed-task-project-runtime.v1';
const APPLICATION_ID = 0x4d50524a;
const MAX_ENTRY_BYTES = 16384;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const ENTRY_KEYS = ['schema', 'idempotency_key', 'binding_digest', 'state', 'reservation', 'proof', 'reason', 'automatic_retry_allowed', 'authority_effect', 'recorded_at'];
const BINDING_KEYS = ['workspace_id', 'worktree_id', 'workspace_generation', 'coordination_workspace_id', 'task_id', 'agent_id', 'lease_generation', 'branch_name', 'claim_id', 'point_id', 'agent_generation_epoch', 'tab_id', 'target_id', 'base_sha', 'repo_id', 'repo_root', 'managed_root', 'worktree_path'];
const TABLE_SQL = `CREATE TABLE effect_entries (
  idempotency_key TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence IN (1, 2)),
  state TEXT NOT NULL CHECK ((sequence = 1 AND state = 'RESERVED') OR (sequence = 2 AND state IN ('PROVEN', 'AMBIGUOUS', 'FAILED'))),
  binding_digest TEXT NOT NULL CHECK (length(binding_digest) = 64),
  payload TEXT NOT NULL CHECK (length(CAST(payload AS BLOB)) <= ${MAX_ENTRY_BYTES}),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  PRIMARY KEY (idempotency_key, sequence)
) STRICT`;
const TRIGGER_SQL = [
  `CREATE TRIGGER effect_entries_no_update BEFORE UPDATE ON effect_entries BEGIN SELECT RAISE(ABORT, 'managed_project_journal_immutable'); END`,
  `CREATE TRIGGER effect_entries_no_delete BEFORE DELETE ON effect_entries BEGIN SELECT RAISE(ABORT, 'managed_project_journal_immutable'); END`,
  `CREATE TRIGGER effect_entries_terminal_guard BEFORE INSERT ON effect_entries WHEN NEW.sequence = 2 BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM effect_entries WHERE idempotency_key = NEW.idempotency_key AND sequence = 1 AND binding_digest = NEW.binding_digest)
    THEN RAISE(ABORT, 'managed_project_journal_append_conflict') END;
  END`,
];
const SCHEMA_SQL = [TABLE_SQL, ...TRIGGER_SQL];

function fail(code, cause) { throw new Error(`managed_project_sqlite_journal_${code}`, cause ? { cause } : undefined); }
function hash(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function plain(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('shape_invalid');
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(value, key)))) fail('shape_invalid');
}
function exact(value, expected) {
  plain(value);
  if (Object.keys(value).sort().join('|') !== Object.keys(expected).sort().join('|') ||
      Object.values(value).some(item => item !== null && !['string', 'number', 'boolean'].includes(typeof item))) fail('binding_or_proof_invalid');
  if (canonical(value) !== canonical(expected)) fail('binding_or_proof_invalid');
}
function bindingDigest(reservation) {
  return hash(JSON.stringify(Object.fromEntries(BINDING_KEYS.map(key => [key, reservation[key]]))));
}
function baseReservation(reservation) {
  plain(reservation);
  if (Object.keys(reservation).length > 36 || Object.values(reservation).some(item => item !== null && !['string', 'number', 'boolean'].includes(typeof item))) fail('binding_or_proof_invalid');
  // Derive the complete normalized shape using the existing workspace contract.
  const base = createWorkspaceReservation({ claim: reservation,
    trusted_repo: { repo_id: reservation.repo_id, repo_root: reservation.repo_root },
    workspace_root: reservation.managed_root, workspace_id: reservation.workspace_id,
    worktree_id: reservation.worktree_id, workspace_generation: reservation.workspace_generation });
  if (!Number.isFinite(Date.parse(base.lease_expires_at))) fail('lease_invalid');
  return base;
}
function validateEntry(entry) {
  plain(entry);
  if (Object.keys(entry).sort().join('|') !== [...ENTRY_KEYS].sort().join('|') || entry.schema !== ENTRY_SCHEMA ||
      typeof entry.idempotency_key !== 'string' || !KEY_RE.test(entry.idempotency_key) ||
      typeof entry.binding_digest !== 'string' || !DIGEST_RE.test(entry.binding_digest) ||
      !['RESERVED', 'PROVEN', 'AMBIGUOUS', 'FAILED'].includes(entry.state) ||
      entry.automatic_retry_allowed !== false || entry.authority_effect !== false ||
      typeof entry.recorded_at !== 'string' || !Number.isFinite(Date.parse(entry.recorded_at)) ||
      new Date(entry.recorded_at).toISOString() !== entry.recorded_at ||
      !(entry.reason === null || (typeof entry.reason === 'string' && entry.reason.length > 0 && entry.reason.length <= 240 && !entry.reason.includes('\0')))) fail('entry_invalid');
  const base = baseReservation(entry.reservation);
  if (bindingDigest(base) !== entry.binding_digest) fail('binding_digest_invalid');
  if (entry.state === 'RESERVED' && (entry.proof !== null || entry.reason !== null)) fail('reserved_invalid');
  if (entry.proof !== null) {
    exact(entry.proof, {
      schema: 'metaengine.devos.workspace-git-inventory-proof.v1',
      workspace_id: base.workspace_id, workspace_generation: base.workspace_generation,
      task_id: base.task_id, lease_generation: base.lease_generation,
      worktree_path: base.worktree_path, head_sha: base.base_sha,
      branch_ref: `refs/heads/${base.branch_name}`, locked: true, prunable: false,
      automatic_retry_allowed: false, authority_effect: false,
    });
  }
  if (entry.state === 'PROVEN') {
    if (entry.proof === null) fail('proof_required');
    exact(entry.reservation, recordWorkspaceMaterializationReadback(base, {
      effect_state: 'PROVEN', initial_head_sha: entry.proof.head_sha, worktree_realpath: entry.proof.worktree_path,
    }));
  } else {
    exact(entry.reservation, base);
  }
  const payload = canonical(entry);
  if (Buffer.byteLength(payload, 'utf8') > MAX_ENTRY_BYTES) fail('entry_too_large');
  return { entry: JSON.parse(payload), base, payload };
}
function transition(prior, next) {
  const { lease_expires_at: previousDeadline, ...previousBinding } = prior.base;
  const { lease_expires_at: nextDeadline, ...nextBinding } = next.base;
  if (prior.entry.state !== 'RESERVED' || next.entry.state === 'RESERVED' ||
      canonical(previousBinding) !== canonical(nextBinding) ||
      Date.parse(nextDeadline) < Date.parse(previousDeadline) ||
      next.entry.recorded_at < prior.entry.recorded_at) fail('append_conflict');
}
function decode(row) {
  if (!row || typeof row.payload !== 'string' || Buffer.byteLength(row.payload, 'utf8') > MAX_ENTRY_BYTES ||
      !DIGEST_RE.test(String(row.payload_sha256)) || hash(row.payload) !== row.payload_sha256) fail('corrupt');
  const parsed = validateEntry(JSON.parse(row.payload));
  if (parsed.payload !== row.payload || parsed.entry.idempotency_key !== row.idempotency_key ||
      parsed.entry.state !== row.state || parsed.entry.binding_digest !== row.binding_digest ||
      row.sequence !== (parsed.entry.state === 'RESERVED' ? 1 : 2)) fail('corrupt');
  return parsed;
}
function boundedInteger(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
}
function normalizeSQL(sql) { return sql.trim().replace(/\s+/g, ' '); }
function assertSchema(database) {
  const schema = database.prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if (database.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
      database.prepare('PRAGMA user_version').get().user_version !== 1 ||
      canonical(schema.map(row => normalizeSQL(row.sql)).sort()) !== canonical(SCHEMA_SQL.map(normalizeSQL).sort())) fail('schema_invalid');
}

/** Local write-ahead effect receipts only; this journal confers no lease authority.
 * The caller supplies an existing private directory. No runtime mount or ACL setup
 * is performed here. SQLite corruption, capacity exhaustion and contention reject;
 * no repair, rotation, retry, replayed append or in-memory fallback is attempted.
 * FULL commits protect process-crash durability; power-loss guarantees still depend
 * on the host filesystem/device. Proof validation checks shape and binding only.
 */
export function createManagedTaskProjectSqliteJournal({ filePath, maxEntries = 10000, maxBytes = 16 * 1024 * 1024 } = {}) {
  boundedInteger(maxEntries, 1, 100000, 'capacity_invalid');
  boundedInteger(maxBytes, 65536, 256 * 1024 * 1024, 'size_invalid');
  if (typeof filePath !== 'string' || filePath.length > 4096 || filePath.includes('\0') ||
      !path.isAbsolute(filePath) || path.resolve(filePath) !== filePath) fail('path_invalid');
  let database;
  let closed = false;
  try {
    const parent = path.dirname(filePath);
    if (fs.realpathSync(parent) !== parent) fail('path_invalid');
    const newFile = !fs.existsSync(filePath);
    if (!newFile) {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size === 0 || stat.size > maxBytes) fail('file_invalid');
      // Refuse foreign/WAL files before issuing any mutating PRAGMA. A rejected
      // pathname must not silently convert another application's SQLite file.
      const probe = new DatabaseSync(filePath, { readOnly: true, timeout: 0, allowExtension: false });
      try {
        assertSchema(probe);
        if (probe.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('durability_unconfirmed');
      } finally { probe.close(); }
    }
    database = new DatabaseSync(filePath, { timeout: 0, allowExtension: false, enableDoubleQuotedStringLiterals: false });
    database.exec('PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON');
    const mode = database.prepare('PRAGMA journal_mode=DELETE').get();
    if (mode.journal_mode !== 'delete' || database.prepare('PRAGMA synchronous').get().synchronous !== 2) fail('durability_unconfirmed');
    const pageSize = database.prepare('PRAGMA page_size').get().page_size;
    const maxPages = Math.floor(maxBytes / pageSize);
    if (database.prepare('PRAGMA page_count').get().page_count > maxPages) fail('size_exceeded');
    database.exec(`PRAGMA max_page_count=${maxPages}`);
    database.exec('BEGIN IMMEDIATE');
    try {
      const existingSchema = database.prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const applicationId = database.prepare('PRAGMA application_id').get().application_id;
      const version = database.prepare('PRAGMA user_version').get().user_version;
      if (newFile && existingSchema.length === 0 && applicationId === 0 && version === 0) {
        SCHEMA_SQL.forEach(sql => database.exec(sql));
        database.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1`);
      } else { assertSchema(database); }
      if (database.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('corrupt');
      const count = database.prepare('SELECT count(*) count FROM effect_entries WHERE sequence=1').get().count;
      if (count > maxEntries) fail('capacity_exceeded');
      // Inspect bounded rows on open, including the reservation behind every receipt.
      let prior = null;
      for (const row of database.prepare('SELECT * FROM effect_entries ORDER BY idempotency_key, sequence').iterate()) {
        const decoded = decode(row);
        if (row.sequence === 2) {
          if (!prior || prior.entry.idempotency_key !== row.idempotency_key) fail('corrupt');
          transition(prior, decoded);
        }
        prior = decoded;
      }
      database.exec('COMMIT');
    } catch (error) { try { database.exec('ROLLBACK'); } catch { /* SQLite may already have rolled back. */ } throw error; }
  } catch (error) {
    try { database?.close(); } catch { /* Preserve the original refusal. */ }
    fail('open_failed', error);
  }
  const select = database.prepare('SELECT * FROM effect_entries WHERE idempotency_key=? ORDER BY sequence');
  function available() { if (closed) fail('closed'); }
  function read(key) {
    const rows = select.all(key);
    const entries = rows.map(decode);
    if (entries.length === 2) transition(entries[0], entries[1]);
    if (entries.length && entries[0].entry.state !== 'RESERVED') fail('corrupt');
    return entries.at(-1) || null;
  }
  return Object.freeze({
    async find(key) {
      available();
      if (typeof key !== 'string' || !KEY_RE.test(key)) fail('key_invalid');
      try { return read(key)?.entry || null; } catch (error) { fail('read_failed', error); }
    },
    async append(value) {
      available();
      const next = validateEntry(value);
      database.exec('BEGIN IMMEDIATE');
      try {
        const prior = read(next.entry.idempotency_key);
        if (prior) transition(prior, next);
        else {
          if (next.entry.state !== 'RESERVED') fail('append_conflict');
          if (Date.parse(next.base.lease_expires_at) <= Math.max(Date.now(), Date.parse(next.entry.recorded_at))) fail('lease_stale');
          if (database.prepare('SELECT count(*) count FROM effect_entries WHERE sequence=1').get().count >= maxEntries) fail('capacity_exceeded');
        }
        database.prepare('INSERT INTO effect_entries VALUES (?,?,?,?,?,?)').run(next.entry.idempotency_key,
          prior ? 2 : 1, next.entry.state, next.entry.binding_digest, next.payload, hash(next.payload));
        database.exec('COMMIT');
        return JSON.parse(next.payload);
      } catch (error) {
        try { database.exec('ROLLBACK'); } catch { /* Preserve capacity/I/O failures after an automatic rollback. */ }
        throw error;
      }
    },
    async close() {
      if (closed) return;
      database.close(); closed = true;
    },
  });
}
