import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SELF_UPDATE_COMMANDS } from '../src/self-update-runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const migrationPath = resolve(repo, 'supabase/migrations/20260829190500_h205f22_native_browser_self_update_control_v1.sql');
const edgePath = resolve(repo, 'supabase/functions/a2-browser-native-supervisor-v1/index.ts');
const nativeClientPath = resolve(here, '../src/native-supervisor-client.mjs');

async function read(path) { return fs.readFile(path, 'utf8'); }

test('runtime DB and Edge expose the same finite self-update action vocabulary', async () => {
  const [migration, edge, nativeClient] = await Promise.all([read(migrationPath), read(edgePath), read(nativeClientPath)]);
  for (const action of SELF_UPDATE_COMMANDS) {
    assert.match(migration, new RegExp(`['\"]${action}['\"]`), `migration missing ${action}`);
    assert.match(edge, new RegExp(`['\"]${action}['\"]`), `edge missing ${action}`);
  }
  assert.match(nativeClient, /SELF_UPDATE_COMMANDS/);
  assert.match(nativeClient, /SELF_UPDATE_ACTIONS\.has\(action\)/);
  assert.match(nativeClient, /persistPreInstallReceipt/);
});

test('server rollout is versioned and update payloads cannot carry arbitrary URL path or script fields', async () => {
  const [migration, edge] = await Promise.all([read(migrationPath), read(edgePath)]);
  assert.match(migration, /h205f22_a2_browser_supervisor_issue_native_v2/);
  assert.match(migration, /h205f22_a2_browser_supervisor_lease_v4/);
  assert.match(migration, /h205f22_a2_browser_supervisor_complete_v6/);
  assert.match(edge, /LEASE_RPC='h205f22_a2_browser_supervisor_lease_v4'/);
  assert.match(edge, /COMPLETE_RPC='h205f22_a2_browser_supervisor_complete_v6'/);
  assert.match(migration, /native_supervisor_self_update_platform_must_be_null/);
  assert.match(migration, /native_supervisor_self_update_payload_must_be_empty/);
  assert.match(migration, /array\['enabled'\]::text\[\]/);
  assert.doesNotMatch(migration, /SELF_UPDATE_EXEC/);
  assert.doesNotMatch(migration, /SELF_UPDATE_RUN/);
  assert.doesNotMatch(edge, /\beval\s*\(/);
  assert.doesNotMatch(edge, /new Function\s*\(/);
});

test('Edge persists bounded updater telemetry rather than dropping update and lifecycle state', async () => {
  const edge = await read(edgePath);
  assert.match(edge, /function boundedSelfUpdate/);
  assert.match(edge, /function boundedLifecycle/);
  assert.match(edge, /automatic_update_enabled:s\.automatic_update_enabled===true/);
  assert.match(edge, /metadata_verified:s\.metadata_verified===true/);
  assert.match(edge, /pre_install_receipt_persisted:s\.pre_install_receipt_persisted===true/);
  assert.match(edge, /installer_handoff_prepared:s\.installer_handoff_prepared===true/);
  assert.match(edge, /supervisor_lifecycle:boundedLifecycle\(s\.supervisor_lifecycle\)/);
  assert.match(edge, /self_update:boundedSelfUpdate\(s\.self_update\)/);
});
