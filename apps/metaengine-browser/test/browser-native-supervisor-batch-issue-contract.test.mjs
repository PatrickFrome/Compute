import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(HERE, '../../..', 'supabase/migrations/20260908143500_browser_supervisor_issue_batch_v1.sql');

test('native supervisor batch issue delegates to the existing typed issuer and remains non-authoritative', async () => {
  const sql = await fs.readFile(MIGRATION, 'utf8');
  assert.match(sql, /h205f22_a2_browser_supervisor_issue_batch_v1/);
  assert.match(sql, /jsonb_array_length\(p_commands\)/);
  assert.match(sql, /v_count < 1 or v_count > 64/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /h205f22_a2_browser_supervisor_issue_native_v1/);
  assert.match(sql, /native_supervisor_batch_idempotency_collision/);
  assert.match(sql, /'command_leasing',false/);
  assert.match(sql, /'execution_authority',false/);
  assert.match(sql, /'automatic_retry_allowed',false/);
  assert.match(sql, /'authority_effect',false/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.compute_fabric_a2_browser_supervisor_command_h205f22/i);
});
