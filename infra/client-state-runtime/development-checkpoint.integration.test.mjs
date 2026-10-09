import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import {
  buildDevelopmentCheckpoint,
  validateCheckpointDatabaseUrl,
  writeDevelopmentCheckpoint,
} from './development-checkpoint.mjs';

const adminUrl = process.env.LOCAL_STATE_TEST_ADMIN_DATABASE_URL;
const productionTable = 'destruktion_meta.metaengine_audit_checkpoint_v1';
const fixtureTable = 'pg_temp.development_checkpoint_fixture';

test('postgres.js checkpoint binding preserves JSONB, generated digest, replay and conflict rejection', {
  skip: !adminUrl,
  timeout: 30000,
}, async t => {
  validateCheckpointDatabaseUrl(adminUrl);
  // One connection keeps the fixture session-local across real transactions.
  const driver = postgres(adminUrl, {
    max: 1, prepare: false, idle_timeout: 0, max_lifetime: 0, connect_timeout: 5,
  });
  t.after(() => driver.end({ timeout: 5 }));
  const [encoding] = await driver.unsafe("SELECT current_setting('server_encoding') AS encoding");
  assert.equal(encoding.encoding, 'UTF8');
  // convert_to is catalogued STABLE, though conversion to UTF8 in this UTF8
  // fixture is deterministic. Keep the helper in the temporary schema too.
  await driver.unsafe(`CREATE FUNCTION pg_temp.checkpoint_payload_sha256(payload jsonb)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
      SELECT encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')
    $$`);
  await driver.unsafe(`CREATE TEMP TABLE development_checkpoint_fixture (
    checkpoint_id text PRIMARY KEY CHECK (checkpoint_id ~ '^[0-9a-f]{64}$'),
    project_ref text NOT NULL CHECK (project_ref = 'jhriwwsryeqsvvvufkok'),
    source_parent_sha text NOT NULL CHECK (source_parent_sha ~ '^[0-9a-f]{40}$'),
    evidence_state text NOT NULL CHECK (evidence_state IN ('LIVE_DB_ONLY', 'EVIDENCE_READY', 'PARTIAL')),
    scope text NOT NULL DEFAULT 'OPERATIONAL_AUDIT_ONLY' CHECK (scope = 'OPERATIONAL_AUDIT_ONLY'),
    canonical_checkpoint boolean NOT NULL DEFAULT false CHECK (canonical_checkpoint = false),
    authority_effect boolean NOT NULL DEFAULT false CHECK (authority_effect = false),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144),
    payload_sha256 text GENERATED ALWAYS AS (pg_temp.checkpoint_payload_sha256(payload)) STORED,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  ) ON COMMIT PRESERVE ROWS`);
  const [fixture] = await driver.unsafe(`SELECT pg_backend_pid() AS pid,
    relpersistence FROM pg_class WHERE oid = '${fixtureTable}'::regclass`);
  assert.equal(fixture.relpersistence, 't');

  // Only substitute the fixed table identifier. postgres.js still receives
  // the production SQL casts and untouched bound values inside sql.begin.
  const sql = {
    begin: (options, callback) => driver.begin(options, tx => callback({
      unsafe: (query, values) => tx.unsafe(query.replaceAll(productionTable, fixtureTable), values),
    })),
  };
  const input = {
    source_parent_sha: 'a'.repeat(40),
    evidence_state: 'EVIDENCE_READY',
    payload: {
      source_sha: 'b'.repeat(40),
      summaries: [{ code: 'CHECKPOINT_PERSISTENCE', status: 'VERIFIED' }],
      tests: [{ suite: 'CHECKPOINT', total: 3, passed: 3, failed: 0, skipped: 0 }],
      github_urls: ['https://github.com/PatrickFrome/Compute/pull/1176'],
    },
  };
  const checkpoint = buildDevelopmentCheckpoint(input);
  let receipt;
  let initialRow;

  await t.test('insert binds an object and readback verifies the database-generated digest', async () => {
    receipt = await writeDevelopmentCheckpoint({ sql, checkpoint });
    assert.equal(receipt.state, 'INSERTED');
    [initialRow] = await driver.unsafe(`SELECT checkpoint_id, payload,
      jsonb_typeof(payload) AS payload_type, payload::text AS payload_json,
      payload_sha256, pg_backend_pid() AS pid FROM ${fixtureTable}`);
    assert.equal(initialRow.pid, fixture.pid);
    assert.equal(initialRow.checkpoint_id, checkpoint.checkpoint_id);
    assert.equal(initialRow.payload_type, 'object');
    assert.deepEqual(initialRow.payload, checkpoint.payload);
    assert.equal(initialRow.payload_sha256,
      createHash('sha256').update(initialRow.payload_json, 'utf8').digest('hex'));
    assert.equal(receipt.payload_sha256, initialRow.payload_sha256);
    assert.equal(receipt.canonical_payload_sha256, checkpoint.canonical_payload_sha256);
    assert.notEqual(receipt.payload_sha256, receipt.canonical_payload_sha256);
  });

  await t.test('replay returns the exact receipt without a second insert', async () => {
    const replay = await writeDevelopmentCheckpoint({ sql, checkpoint });
    assert.deepEqual(replay, { ...receipt, state: 'ALREADY_PRESENT' });
    const [count] = await driver.unsafe(`SELECT count(*)::int AS rows FROM ${fixtureTable}`);
    assert.equal(count.rows, 1);
  });

  await t.test('same id with changed immutable evidence rolls back and preserves the original row', async () => {
    const conflict = buildDevelopmentCheckpoint({ ...input,
      checkpoint_id: checkpoint.checkpoint_id, evidence_state: 'PARTIAL',
      payload: { ...input.payload, summaries: [{ code: 'CHECKPOINT_PERSISTENCE', status: 'FAILED' }] },
    });
    await assert.rejects(writeDevelopmentCheckpoint({ sql, checkpoint: conflict }),
      { message: 'development_checkpoint_id_conflict' });
    const rows = await driver.unsafe(`SELECT checkpoint_id, payload,
      jsonb_typeof(payload) AS payload_type, payload::text AS payload_json,
      payload_sha256, pg_backend_pid() AS pid FROM ${fixtureTable}`);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], initialRow);
    assert.deepEqual(await writeDevelopmentCheckpoint({ sql, checkpoint }),
      { ...receipt, state: 'ALREADY_PRESENT' });
  });
});
