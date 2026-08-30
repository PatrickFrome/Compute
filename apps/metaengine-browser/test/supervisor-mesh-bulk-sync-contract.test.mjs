import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '../../../supabase/migrations/20260830065000_a2_supervisor_mesh_bulk_sync_v1_repair.sql');

async function migration() { return fs.readFile(migrationPath, 'utf8'); }

test('bulk mesh sync is bounded, hash-bound and zero-authority', async () => {
  const sql = await migration();
  assert.match(sql, /jsonb_array_length\(v_mesh->'supervisors'\) > 16/);
  assert.match(sql, /v_id <> 'sup_' \|\| substr\(v_hash,1,24\)/);
  assert.match(sql, /authority_effect[^\n]*false/i);
  assert.match(sql, /extensions\.digest\(v_client::text,'sha256'::text\)/);
  assert.match(sql, /native_browser_discovered',true/);
  assert.doesNotMatch(sql, /h205f22_a2_browser_supervisor_issue_(?:native|mesh)_v1/);
  assert.doesNotMatch(sql, /insert into public\.compute_fabric_a2_browser_supervisor_command_h205f22/i);
});

test('bulk mesh sync keeps narrow security-definer search path and revokes public execution', async () => {
  const sql = await migration();
  assert.match(sql, /security definer[\s\S]*set search_path = public, pg_temp/i);
  assert.match(sql, /revoke all on function public\.h205f22_a2_supervisor_mesh_sync_v1\(text,jsonb\) from public/i);
});
