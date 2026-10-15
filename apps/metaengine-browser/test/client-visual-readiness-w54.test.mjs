import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { projectClientWorkBadge } from '../../me2-ui/src/lib/client-work-badge-text.mjs';
import { projectClientWorkReadiness } from '../src/client-work-readiness.mjs';

const connection = { local_runtime_ready: true, admin_ready: true, cloud_control_state: 'CONNECTED' };
const fresh = () => {
  const now = Date.parse('2026-10-15T00:00:00Z');
  return {
    now, connection, isCurrentBinding: () => true,
    snapshot: {
      supervisor_mode: 'CONTROL', armed: true,
      last_heartbeat_at: new Date(now - 1000).toISOString(),
      continuous_service: { actuation_allowed: true, runtime_control: {
        state: 'OPEN', authoritative: true, authority_effect: false,
        generation_floor: 8, refill_enabled: true, supervisor_admission_enabled: true,
        continuous_service_allowed: true } },
      lifecycle: { keepalive: { state: 'WAITING', admission_state: 'OPEN',
        admission_generation_floor: 8, tab_id: 'tab_fixture',
        conversation_url: 'https://chat.z.ai/c/fixture' } },
    },
    fleet: { agents: [{ agent_id: 'fixture', role: 'IMPLEMENTER',
      lifecycle_state: 'ACTIVE', tab_id: 'tab_agent', target_id: 'target_agent',
      generation_epoch: 8, transport_proof: { tab_id: 'tab_agent',
        target_id: 'target_agent', generation_epoch: 8,
        agent_surface_sha256: 'a'.repeat(64), conversation_url_sha256: 'b'.repeat(64) } }] },
  };
};
test('W54 ADMIN connection cannot masquerade as work readiness without Owner/readback', () => {
  const unknown = projectClientWorkBadge({ connection });
  assert.deepEqual([unknown.state, unknown.label, unknown.autonomous_ready_color],
    ['UNAVAILABLE', 'Status unavailable', false]);
  const blockedInput = fresh();
  blockedInput.snapshot.lifecycle.keepalive.state = 'ROLLOVER_AMBIGUOUS';
  const work = projectClientWorkReadiness(blockedInput);
  const badge = projectClientWorkBadge({ connection, work });
  assert.equal(work.recovery.required, true);
  assert.equal(work.automatic_retry_allowed, false);
  assert.deepEqual([badge.state, badge.reason, badge.label, badge.autonomous_ready_color],
    ['BLOCKED', 'SUPERVISOR_RECOVERY_REQUIRED', 'Recovery required', false]);
  assert.equal(badge.authority_effect, false);
});
test('W54 readiness does not confuse chat admission with autonomous coding or updates', () => {
  const chatWork = projectClientWorkReadiness(fresh());
  assert.equal(chatWork.state, 'READY');
  assert.equal(chatWork.capabilities.coding_execution.ready, false);
  const badge = projectClientWorkBadge({ connection, work: chatWork });
  assert.deepEqual([badge.state, badge.label, badge.autonomous_ready_color],
    ['READY', 'Chats ready', false]);
  assert.equal(projectClientWorkBadge({ connection: { ...connection, admin_ready: false }, work: chatWork }).state, 'UNAVAILABLE');
});
test('W54 malformed or forged readiness flags are fail-closed, including false autonomy color', () => {
  const work = projectClientWorkReadiness(fresh());
  const invalid = [
    { ...work, schema: 'forged' },
    { ...work, execution_ready: false },
    { ...work, authority_effect: true },
    { ...work, automatic_retry_allowed: true },
    { ...work, capabilities: { ...work.capabilities, chat_dispatch: { ready: false } } },
  ];
  for (const row of invalid) {
    const badge = projectClientWorkBadge({ connection, work: row });
    assert.equal(badge.state, 'UNAVAILABLE');
    assert.equal(badge.autonomous_ready_color, false);
  }
  const spoof = { ...work, continuous_autonomy_ready: true };
  assert.equal(projectClientWorkBadge({ connection, work: spoof }).autonomous_ready_color, false);
  const pausedInput = fresh();
  pausedInput.snapshot.continuous_service.runtime_control.state = 'CLOSED';
  const paused = projectClientWorkBadge({ connection, work: projectClientWorkReadiness(pausedInput) });
  assert.deepEqual([paused.state, paused.label, paused.autonomous_ready_color], ['PAUSED', 'Execution paused', false]);
});
test('W54 visual renderer consumes the fail-closed projection, never paints ADMIN as execution', async () => {
  const topbar = await readFile(new URL('../../me2-ui/src/components/me2/shell/topbar.tsx', import.meta.url), 'utf8');
  assert.match(topbar, /projectClientWorkBadge\(\{ connection, work \}\)/);
  assert.match(topbar, /data-work-state=\{badge\.state\}/);
  assert.match(topbar, /badge\.autonomous_ready_color/);
  assert.match(topbar, /\{badge\.label\}/);
  assert.doesNotMatch(topbar, />\{connection\?\.admin_ready && connection\?\.local_runtime_ready \? "Connected"/);
});

