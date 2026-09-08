import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(HERE, '../../..', 'supabase/migrations/20260908204500_browser_supervisor_issuer_replay_v2.sql');

test('native issuer returns exact existing command for a semantic idempotent replay', async () => {
  const sql = await fs.readFile(MIGRATION, 'utf8');

  assert.match(sql, /set search_path = pg_catalog, public, pg_temp/);
  assert.match(sql, /on conflict \(workspace_id,idempotency_key\) where idempotency_key is not null do nothing/);
  assert.match(sql, /where workspace_id=v_workspace and idempotency_key=v_key/);
  assert.match(sql, /v_existing\.target_client_id is distinct from v_client/);
  assert.match(sql, /v_existing\.action is distinct from v_action/);
  assert.match(sql, /coalesce\(v_existing\.platform,''\) is distinct from coalesce\(v_platform,''\)/);
  assert.match(sql, /v_existing\.payload is distinct from p_payload/);
  assert.match(sql, /native_supervisor_idempotency_collision/);
  assert.match(sql, /'replayed',not v_inserted/);
  assert.match(sql, /'command_id',v_existing\.command_id/);
  assert.match(sql, /'expires_at',v_existing\.expires_at/);
  assert.match(sql, /'command_leasing',false/);
  assert.match(sql, /'execution_authority',false/);
  assert.match(sql, /'automatic_retry_allowed',false/);
  assert.match(sql, /'authority_effect',false/);
});

test('native issuer preserves deployed state transport repairs and rejects unsupported prompt gate action', async () => {
  const sql = await fs.readFile(MIGRATION, 'utf8');
  const actionAllowlist = sql.match(/if v_action not in \(([\s\S]*?)\) then raise exception 'native_supervisor_action_invalid'/)?.[1] || '';

  assert.match(sql, /jsonb_typeof\(v_state_json\)='string'/);
  assert.match(sql, /native_supervisor_state_transport_invalid/);
  assert.match(sql, /char_length\(v_url\)>4096/);
  assert.doesNotMatch(actionAllowlist, /RESOLVE_PROMPT/);
});
