import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '../../../supabase/migrations/20260830061000_a2_supervisor_mesh_actuation_lease_v1.sql');

async function migration() { return fs.readFile(migrationPath, 'utf8'); }

test('mesh migration stores conversation identity only as sha256 and never persists full supervisor URL', async () => {
  const sql = await migration();
  assert.match(sql, /conversation_url_sha256 text not null/);
  assert.doesNotMatch(sql, /conversation_url\s+text/i);
  assert.match(sql, /conversation_url_sha256 ~ '\^\[a-f0-9\]\{64\}\$'/);
});

test('mutating mesh commands require one shared active Browser-client lease and stable idempotency key', async () => {
  const sql = await migration();
  assert.match(sql, /a2_supervisor_actuation_one_active_client_uq/);
  assert.match(sql, /where status = 'ACTIVE'/);
  assert.match(sql, /supervisor_mesh_mutation_requires_stable_idempotency_key/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /effect_scope,'BROWSER_CLIENT_ACTUATION'/);
});

test('read-only observation bypasses actuation lease but still identifies the supervisor peer', async () => {
  const sql = await migration();
  for (const action of ['POLL','CAPTURE','CAPTURE_VIEW','DOWNLOAD_STATUS','SELF_UPDATE_STATUS']) {
    assert.match(sql, new RegExp(`'${action}'`));
  }
  assert.match(sql, /'mesh_actuation_lease',null/);
  assert.match(sql, /'supervisor_instance_id',v_supervisor/);
});

test('non-terminal or ambiguous command cannot be superseded by a second supervisor until terminal readback or TTL', async () => {
  const sql = await migration();
  assert.match(sql, /c\.status in \('COMPLETED','FAILED','EXPIRED','CANCELLED'\)/);
  assert.match(sql, /status = 'ACTIVE'[\s\S]*expires_at <= clock_timestamp\(\)/);
  assert.match(sql, /'reason','MESH_ACTUATION_LEASE_HELD'/);
  assert.doesNotMatch(sql, /command_id[^\n]*is null[^\n]*RELEASED/i);
});

test('mesh migration is additive and does not replace the existing native issue function', async () => {
  const sql = await migration();
  assert.match(sql, /h205f22_a2_browser_supervisor_issue_mesh_v1/);
  assert.match(sql, /h205f22_a2_browser_supervisor_issue_native_v1/);
  assert.doesNotMatch(sql, /create or replace function public\.h205f22_a2_browser_supervisor_issue_native_v1/i);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /truncate/i);
});
