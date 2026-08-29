import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedNativeSupervisorState,
  boundedSelfUpdateState,
} from '../../../supabase/functions/a2-browser-native-supervisor-v1/state-projection.mjs';

test('self-update observer keeps only bounded zero-authority telemetry', () => {
  const projected = boundedSelfUpdateState({
    state: 'RESTART_GRACE',
    available_version: '0.6.3-dev.57.1',
    downloaded_version: '0.6.3-dev.57.1',
    install_attempted_version: null,
    metadata_verified: true,
    trusted_channel: 'dev',
    candidate_file_count: 1,
    staging_percentage: 100,
    download_percent: 100,
    restart_gate_safe: true,
    restart_gate_since: '2026-08-29T18:00:00.000Z',
    restart_grace_ms: 12000,
    ci_test_feed_active: false,
    pre_install_receipt_persisted: false,
    installer_handoff_prepared: false,
    publisher_verified: false,
    authority_effect: true,
    feed_url: 'https://user:secret@example.invalid/dev.yml?token=secret',
    command: { action: 'ARM' },
    secret: 'should-never-persist',
    host_resilience: { executable: 'C:\\secret\\browser.exe' },
  });

  assert.deepEqual(Object.keys(projected).sort(), [
    'authority_effect',
    'available_version',
    'candidate_file_count',
    'ci_test_feed_active',
    'download_percent',
    'downloaded_version',
    'install_attempted_version',
    'installer_handoff_prepared',
    'metadata_verified',
    'pre_install_receipt_persisted',
    'publisher_verified',
    'restart_gate_safe',
    'restart_gate_since',
    'restart_grace_ms',
    'schema',
    'staging_percentage',
    'state',
    'trusted_channel',
  ].sort());
  assert.equal(projected.authority_effect, false);
  assert.equal(projected.state, 'RESTART_GRACE');
  assert.equal(projected.available_version, '0.6.3-dev.57.1');
  assert.equal(JSON.stringify(projected).includes('secret'), false);
  assert.equal(JSON.stringify(projected).includes('example.invalid'), false);
  assert.equal(JSON.stringify(projected).includes('ARM'), false);
});

test('invalid self-update states fail closed instead of persisting attacker-shaped objects', () => {
  assert.equal(boundedSelfUpdateState(null), null);
  assert.equal(boundedSelfUpdateState([]), null);
  assert.equal(boundedSelfUpdateState({ state: 'REMOTE_EXECUTE', authority_effect: true }), null);
  assert.equal(boundedSelfUpdateState({ state: { nested: true } }), null);
});

test('malformed optional telemetry becomes null and cannot expand its schema', () => {
  const projected = boundedSelfUpdateState({
    state: 'DOWNLOADING',
    available_version: 'https://evil.invalid/update.exe',
    downloaded_version: '../candidate.exe',
    install_attempted_version: 'x'.repeat(100),
    metadata_verified: 'true',
    trusted_channel: 'dev?token=secret',
    candidate_file_count: 999,
    staging_percentage: -1,
    download_percent: 101,
    restart_gate_safe: 1,
    restart_gate_since: 'not-a-time',
    restart_grace_ms: 999999999,
    ci_test_feed_active: 'false',
    pre_install_receipt_persisted: {},
    installer_handoff_prepared: [],
    publisher_verified: 'yes',
  });
  for (const [key, value] of Object.entries(projected)) {
    if (['schema', 'state', 'authority_effect'].includes(key)) continue;
    assert.equal(value, null, key);
  }
  assert.equal(projected.authority_effect, false);
});

test('native heartbeat projection includes only the bounded self-update projection', () => {
  const state = boundedNativeSupervisorState({
    shell_version: '0.6.3-dev.57.1',
    supervisor_mode: 'CONTROL',
    armed: true,
    self_update: {
      state: 'READY_RESTART',
      available_version: '0.6.3-dev.57.2',
      metadata_verified: true,
      trusted_channel: 'dev',
      secret: 'drop-me',
      authority_effect: true,
    },
  }, { now: () => '2026-08-29T18:00:10.000Z' });

  assert.equal(state.self_update.state, 'READY_RESTART');
  assert.equal(state.self_update.available_version, '0.6.3-dev.57.2');
  assert.equal(state.self_update.authority_effect, false);
  assert.equal('secret' in state.self_update, false);
  assert.equal(state.heartbeat_at, '2026-08-29T18:00:10.000Z');
});
