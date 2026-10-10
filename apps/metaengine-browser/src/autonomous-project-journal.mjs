import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const fail = code => { throw new Error(`autonomous_project_journal_${code}`); };
const table = `CREATE TABLE project_effects (
  effect_key TEXT PRIMARY KEY, binding_sha256 TEXT NOT NULL, intent TEXT NOT NULL,
  receipt TEXT, receipt_sha256 TEXT
) STRICT`;
const triggers = [
  `CREATE TRIGGER project_effects_no_delete BEFORE DELETE ON project_effects BEGIN SELECT RAISE(ABORT,'immutable'); END`,
  `CREATE TRIGGER project_effects_receipt_guard BEFORE UPDATE ON project_effects WHEN OLD.receipt IS NOT NULL OR NEW.effect_key<>OLD.effect_key OR NEW.binding_sha256<>OLD.binding_sha256 OR NEW.intent<>OLD.intent BEGIN SELECT RAISE(ABORT,'immutable'); END`,
];

/** Private local write-ahead records. The host supplies an existing private
 * directory; PostgreSQL alone admits tasks. FULL commits precede spawn POSTs. */
export function createAutonomousProjectJournal({ filePath, maxEntries = 10000 } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.resolve(filePath) !== filePath
      || fs.realpathSync(path.dirname(filePath)) !== path.dirname(filePath)
      || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100000) fail('configuration_invalid');
  const newFile = !fs.existsSync(filePath);
  const assertSchema = db => {
    const schema = db.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const normalize = sql => sql.trim().replace(/\s+/g, ' ');
    if (JSON.stringify(schema.map(row => normalize(row.sql)).sort()) !== JSON.stringify([table, ...triggers].map(normalize).sort())
        || db.prepare('PRAGMA application_id').get().application_id !== 1095782986
        || db.prepare('PRAGMA user_version').get().user_version !== 1) fail('schema_invalid');
  };
  if (!newFile) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size === 0 || stat.size > 32 * 1024 * 1024) fail('file_invalid');
    const probe = new DatabaseSync(filePath, { readOnly: true, timeout: 0, allowExtension: false });
    try { assertSchema(probe); if (probe.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('foreign_mode'); }
    finally { probe.close(); }
  }
  const db = new DatabaseSync(filePath, { timeout: 0, allowExtension: false });
  try {
    const schema = db.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    if (newFile && schema.length === 0) {
      db.exec(`BEGIN IMMEDIATE; ${table}; ${triggers.join(';')}; PRAGMA application_id=1095782986; PRAGMA user_version=1; COMMIT;`);
    } else {
      assertSchema(db);
    }
    db.exec('PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA trusted_schema=OFF; PRAGMA max_page_count=8192');
    if (db.prepare('PRAGMA synchronous').get().synchronous !== 2 || db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('durability_invalid');
  } catch (error) { db.close(); throw error; }
  let closed = false;
  const available = () => { if (closed) fail('closed'); };
  const key = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9:._-]{4,256}$/.test(value)) fail('key_invalid'); return value; };
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
  };
  // Canonical payload bytes make crash/restart replay independent of object
  // insertion order across provider/host processes.
  const encode = value => { const text = JSON.stringify(stable(value)); if (!text || Buffer.byteLength(text) > 65536) fail('payload_invalid'); return text; };
  const digestPayload = text => hash(JSON.stringify(stable(JSON.parse(text))));
  function decode(row) {
    if (!row) return null;
    if (digestPayload(row.intent) !== row.binding_sha256 || (row.receipt && digestPayload(row.receipt) !== row.receipt_sha256)) fail('corrupt');
    return { effect_key: row.effect_key, binding_sha256: row.binding_sha256,
      intent: JSON.parse(row.intent), receipt: row.receipt ? JSON.parse(row.receipt) : null };
  }
  return Object.freeze({
    async find(effectKey) { available(); return decode(db.prepare('SELECT * FROM project_effects WHERE effect_key=?').get(key(effectKey))); },
    async latestConversationTurn({ task_id, lease_generation } = {}) {
      available();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(task_id || '')
          || !Number.isSafeInteger(lease_generation) || lease_generation < 1) fail('lease_invalid');
      return decode(db.prepare('SELECT * FROM project_effects WHERE effect_key GLOB ? ORDER BY rowid DESC LIMIT 1')
        .get(`turn:${task_id}:${lease_generation}:*`));
    },
    async pending({ limit = 16 } = {}) {
      available(); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) fail('limit_invalid');
      return db.prepare('SELECT * FROM project_effects WHERE receipt IS NULL ORDER BY effect_key LIMIT ?').all(limit).map(decode);
    },
    async begin(effectKey, intent) {
      available(); key(effectKey); const text = encode(intent); const digest = digestPayload(text);
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = decode(db.prepare('SELECT * FROM project_effects WHERE effect_key=?').get(effectKey));
        if (prior && prior.binding_sha256 !== digest) fail('binding_conflict');
        if (!prior) {
          if (db.prepare('SELECT count(*) count FROM project_effects').get().count >= maxEntries) fail('capacity_exceeded');
          db.prepare('INSERT INTO project_effects VALUES(?,?,?,NULL,NULL)').run(effectKey, digest, text);
        }
        db.exec('COMMIT'); return prior || { effect_key: effectKey, binding_sha256: digest, intent: JSON.parse(text), receipt: null };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async confirm(effectKey, receipt) {
      available(); key(effectKey); const text = encode(receipt);
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = decode(db.prepare('SELECT * FROM project_effects WHERE effect_key=?').get(effectKey));
        if (!prior) fail('intent_missing');
        if (prior.receipt && JSON.stringify(prior.receipt) !== text) fail('receipt_conflict');
        if (!prior.receipt) db.prepare('UPDATE project_effects SET receipt=?,receipt_sha256=? WHERE effect_key=?').run(text, digestPayload(text), effectKey);
        db.exec('COMMIT'); return structuredClone(receipt);
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async close() { if (!closed) { db.close(); closed = true; } },
  });
}
