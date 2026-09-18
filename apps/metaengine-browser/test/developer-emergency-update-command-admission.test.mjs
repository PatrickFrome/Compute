import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  COMMAND_LANES,
  classifyNativeSupervisorCommand,
} from '../src/native-supervisor-command-lanes.mjs';
import {
  NativeSupervisorClient,
  nativeSupervisorEmergencyProductionWiringContract,
} from '../src/native-supervisor-client-core.mjs';

const migration = fs.readFileSync(
  new URL('../../../supabase/migrations/20260918015500_browser_developer_emergency_update_command_admission_v1.sql', import.meta.url),
  'utf8',
);

test('migration admits exactly the typed developer emergency update action without execution authority', () => {
  assert.match(migration, /'DEVELOPER_EMERGENCY_UPDATE'/);
  assert.match(migration, /create or replace function public\.h205f22_a2_browser_supervisor_issue_developer_emergency_update_v1/);
  assert.match(migration, /'schema','metaengine\.developer-emergency-update\.v1'/);
  assert.match(migration, /'release_mode','LATEST_TRUSTED'/);
  assert.match(migration, /'expected_git_sha',v_expected_git_sha/);
  assert.match(migration, /'command_leasing',false/);
  assert.match(migration, /'execution_authority',false/);
  assert.match(migration, /'installer_dispatch_authority',false/);
  assert.match(migration, /'automatic_retry_allowed',false/);
  assert.match(migration, /'authority_effect',false/);
});

test('emergency issuer has no caller supplied URL path executable or shell surface', () => {
  const signature = migration.match(
    /h205f22_a2_browser_supervisor_issue_developer_emergency_update_v1\(([\s\S]*?)\)\s*returns jsonb/i,
  )?.[1] || '';
  assert.match(signature, /p_client_id text/);
  assert.match(signature, /p_request_nonce text/);
  assert.match(signature, /p_expected_git_sha text default null/);
  assert.doesNotMatch(signature, /url|path|exe|executable|shell|installer/i);

  const payloadBuild = migration.match(/v_payload := jsonb_build_object\(([\s\S]*?)\);/)?.[1] || '';
  assert.match(payloadBuild, /metaengine\.developer-emergency-update\.v1/);
  assert.match(payloadBuild, /LATEST_TRUSTED/);
  assert.doesNotMatch(payloadBuild, /url|path|exe|executable|shell|installer/i);
});

test('issuer requires a fresh live native Browser and exact idempotency readback', () => {
  assert.match(migration, /where client_id=v_client and workspace_id=v_workspace/);
  assert.match(migration, /last_seen_at < clock_timestamp\(\)-interval '45 seconds'/);
  assert.match(migration, /METAENGINE_BROWSER_ELECTRON_NATIVE/);
  assert.match(migration, /on conflict \(workspace_id,idempotency_key\) where idempotency_key is not null do nothing/);
  assert.match(migration, /developer_emergency_update_idempotency_collision/);
  assert.match(migration, /v_existing\.payload is distinct from v_payload/);
});

test('emergency issuer is service-role only', () => {
  assert.match(
    migration,
    /revoke all on function public\.h205f22_a2_browser_supervisor_issue_developer_emergency_update_v1\([\s\S]*?\)\s+from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.h205f22_a2_browser_supervisor_issue_developer_emergency_update_v1\([\s\S]*?\)\s+to service_role;/,
  );
});

test('Browser runtime classifies the admitted action as exclusive emergency even though DB issuance has zero execution authority', () => {
  const descriptor = classifyNativeSupervisorCommand({
    command_id: '11111111-1111-4111-8111-111111111111',
    action: 'DEVELOPER_EMERGENCY_UPDATE',
    payload: {
      schema: 'metaengine.developer-emergency-update.v1',
      request_nonce: 'A'.repeat(32),
      release_mode: 'LATEST_TRUSTED',
    },
  });
  assert.equal(descriptor.lane, COMMAND_LANES.EMERGENCY);
  assert.equal(descriptor.exclusive, true);
  assert.equal(descriptor.priority, 0);
  assert.equal(descriptor.effect_key, 'global:emergency');
  assert.equal(descriptor.authority_effect, false);
});

test('release NativeSupervisor auto-wires only through enrolled Guardian proof surface and keeps no blind retry', () => {
  const identity = {
    async ensure() { return { client_id: 'client-test', device_id: 'device-test' }; },
    snapshot() { return { client_id: 'client-test', device_id: 'device-test' }; },
    async deviceHeaders() { return { 'content-type': 'application/json' }; },
    async guardianOwnerChallenge() { return {}; },
    async guardianUpdateActuatorProof() { return {}; },
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl: async () => new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } }),
    getState: async () => ({ tabs: [], active_tab: null }),
    executeCommand: async () => ({ ok: true }),
    version: '0.7.0-dev.999.1',
  });
  assert.equal(client.snapshot().developer_emergency_update.configured, true);

  const contract = nativeSupervisorEmergencyProductionWiringContract();
  assert.equal(contract.native_guardian_actuator_only, true);
  assert.equal(contract.electron_updater_fallback_allowed, false);
  assert.equal(contract.automatic_retry_allowed, false);
});
