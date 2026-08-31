import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSupervisorWatchdogHeartbeatPayload,
  supervisorHeartbeatIsStale,
  DEFAULT_SUPERVISOR_WATCHDOG_STALE_MS,
} from '../src/native-supervisor-client.mjs';

test('watchdog is silent while the primary supervisor heartbeat is fresh', () => {
  const now = Date.parse('2026-08-31T10:00:00.000Z');
  assert.equal(supervisorHeartbeatIsStale({ last_heartbeat_at: '2026-08-31T09:59:58.000Z' }, { nowMs: now }), false);
  assert.equal(supervisorHeartbeatIsStale({ last_heartbeat_at: '2026-08-31T09:59:54.000Z' }, { nowMs: now }), true);
  assert.equal(supervisorHeartbeatIsStale({ last_heartbeat_at: null }, { nowMs: now }), true);
  assert.equal(DEFAULT_SUPERVISOR_WATCHDOG_STALE_MS, 5000);
});

test('successful watchdog heartbeat suppresses repeat pulses while the primary cycle remains stale', () => {
  const now = Date.parse('2026-08-31T10:00:00.000Z');
  const primary = { last_heartbeat_at: '2026-08-31T09:59:50.000Z' };
  assert.equal(supervisorHeartbeatIsStale(primary, {
    nowMs: now,
    watchdogLastAt: '2026-08-31T09:59:58.000Z',
  }), false);
  assert.equal(supervisorHeartbeatIsStale(primary, {
    nowMs: now,
    watchdogLastAt: '2026-08-31T09:59:54.000Z',
  }), true);
});

test('watchdog state carries lifecycle mesh projection and self-update instead of clobbering them null', () => {
  const payload = buildSupervisorWatchdogHeartbeatPayload({
    version: '0.6.3-dev.20260831150000.1',
    startedAt: '2026-08-31T09:59:00.000Z',
    state: {
      tabs: [{ tab_id: 'tab-live', url: 'https://chatgpt.com/c/abc', title: 'Supervisor', kind: 'CHATGPT', selected: true }],
      supervisor_mesh: { schema: 'metaengine.supervisor-mesh-runtime.v1', running: true, authority_effect: false, mesh: { schema: 'metaengine.supervisor-mesh.state.v1', version: '1', mesh_epoch: 2, preferred_supervisor_id: null, supervisors: [], authority_effect: false } },
    },
    supervisor: {
      started_at: '2026-08-31T09:59:00.000Z',
      supervisor_mode: 'CONTROL',
      armed: true,
      last_error: 'self_update_discovery_deadline_exceeded',
      last_command_id: 'cmd-1',
      last_command_status: 'COMPLETED',
      lifecycle: { schema: 'metaengine.supervisor-lifecycle-runtime.v3', continuous_service: { enabled: true }, authority_effect: false },
      self_update: { schema: 'metaengine.self-update-runtime.v8', state: 'DISCOVERY_ERROR', network_discovery_bounded: true, authority_effect: false },
      session_continuity: { state: 'RESTORED', restored_tabs: 1, authority_effect: false },
    },
  });

  assert.equal(payload.state.supervisor_mode, 'CONTROL');
  assert.equal(payload.state.armed, true);
  assert.equal(payload.state.supervisor_lifecycle.continuous_service.enabled, true);
  assert.equal(payload.state.supervisor_mesh.mesh.mesh_epoch, 2);
  assert.equal(payload.state.self_update.network_discovery_bounded, true);
  assert.equal(payload.state.self_update_session_continuity.state, 'RESTORED');
  assert.equal(payload.state.watchdog_heartbeat, true);
  assert.equal(payload.last_command_id, 'cmd-1');
  assert.equal(payload.last_command_status, 'COMPLETED');
  assert.equal(payload.state.authority_effect, false);
});
