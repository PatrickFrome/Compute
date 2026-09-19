import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentObservationPlane, AGENT_OBSERVATION_PLANE_SCHEMA } from '../src/agent-observation-plane.mjs';
import { TabNetworkActivityRegistry } from '../src/tab-network-activity.mjs';
import { renderDevosTaskPrompt } from '../src/devos-native-task-cycle-core.mjs';
import { classifyNativeSupervisorCommand } from '../src/native-supervisor-command-lanes.mjs';

// 2026-09-19 operator directive: browser, supervisors and agents must see all
// browser processes in real time and act with maximum variability. Contract
// tests for the agent observation plane, the new read/mutation lanes and the
// prompt telemetry injection.

function fakeWebContents(id) {
  const listeners = new Map();
  return {
    id,
    isDestroyed: () => false,
    on: (name, fn) => { listeners.set(name, fn); },
    once: (name, fn) => { listeners.set(`once:${name}`, fn); },
    emit: (name, ...args) => listeners.get(name)?.(...args),
  };
}

test('console-message observations land in the bounded ring buffer with clipped payloads', () => {
  const plane = new AgentObservationPlane();
  const wc = fakeWebContents(7);
  plane.observe(wc);
  wc.emit('console-message', {}, 'error', 'x'.repeat(900), 12, 'https://chat.z.ai/app.js');
  wc.emit('console-message', {}, 3, 'numeric level error', 1, '');
  const telemetry = plane.telemetryFor(7);
  assert.equal(telemetry.schema, AGENT_OBSERVATION_PLANE_SCHEMA);
  assert.equal(telemetry.observed, true);
  assert.equal(telemetry.console.length, 2);
  assert.equal(telemetry.console[0].level, 'error');
  assert.equal(telemetry.console[0].message.length, 500, 'message clipped to 500');
  assert.equal(telemetry.console[1].level, 'error', 'numeric level 3 normalized');
  assert.equal(telemetry.page_content_exposed, false);
  assert.equal(telemetry.authority_effect, false);
});

test('network sink entries are bounded, metadata-only and cap at 64 per tab', () => {
  const plane = new AgentObservationPlane();
  for (let i = 0; i < 80; i += 1) {
    plane.recordNetwork(9, {
      method: 'POST',
      url: `https://chat.z.ai/api/chat/${i}`,
      resource_type: 'xhr',
      status: 200,
      duration_ms: 42 + i,
      error: false,
    });
  }
  const telemetry = plane.telemetryFor(9, { network_limit: 10 });
  assert.equal(telemetry.network_count, 64, 'ring capped at 64');
  assert.equal(telemetry.network.length, 10, 'requested tail honored');
  assert.equal(telemetry.network[0].url.endsWith('/70'), true, 'tail keeps newest entries');
  assert.equal(telemetry.network[0].duration_ms, 112);
  assert.deepEqual(Object.keys(telemetry.network[0]).sort(),
    ['at', 'duration_ms', 'error', 'method', 'resource_type', 'seq', 'status', 'url']);
});

test('system telemetry is a bounded single-trace digest of every process surface', () => {
  const plane = new AgentObservationPlane();
  const state = {
    shell_version: '0.7.0-dev.test',
    heartbeat_at: '2026-09-19T03:00:00.000Z',
    tabs: [
      { tab_id: 'tab_1', kind: 'GLM_CHAT', role: 'FLEET', url: 'https://chat.z.ai/c/abc', selected: false, webcontents_id: 3 },
      { tab_id: 'tab_2', kind: 'GLM_CHAT', role: 'USER', url: 'https://chat.z.ai/', selected: true, webcontents_id: 4 },
    ],
    tab_census: { by_role: { FLEET: 1, USER: 1 }, fleet_tab_ceiling: 16 },
    fleet: { counts: { ACTIVE: 1 }, policy: { desired_agents: 7 } },
    supervisor_lifecycle: {
      keepalive: { state: 'WAITING', cycle_seq: 502, admission_state: 'OPEN', conversation_url: 'https://chat.z.ai/c/x' },
      devos_runtime: { execution_mode: 'BOUNDED_RUN_ONCE', admission: { runtime_control_state: 'OPEN', actuation_allowed: true }, idle: { in_flight: false } },
    },
    control_latency: { fast_lane: { scheduler: { pressure_band: 'GREEN' }, maintenance_in_flight: false } },
    realtime_process_plane: { running: true, sequence: 42, events: [{ semantic_method: 'Network.dataReceived' }] },
  };
  plane.observe(fakeWebContents(3));
  const digest = plane.systemTelemetry(state);
  assert.equal(digest.schema, AGENT_OBSERVATION_PLANE_SCHEMA);
  assert.equal(digest.tabs.total, 2);
  assert.equal(digest.tabs.per_tab[0].tab_id, 'tab_1');
  assert.equal(digest.supervisor.keepalive_state, 'WAITING');
  assert.equal(digest.devos.actuation_allowed, true);
  assert.equal(digest.realtime_plane.running, true);
  assert.equal(digest.authority_effect, false);
  const text = plane.promptDigest(state);
  assert.ok(text.includes('SYSTEM TELEMETRY'));
  assert.ok(text.includes('supervisor=WAITING'));
  assert.ok(text.length <= 1800, 'prompt digest bounded');
});

test('new observation actions classify as READ_ONLY and PRESS_KEY as effect-bound TAB_MUTATION', () => {
  const tab = { tab_id: 'tab_11111111-2222-4333-8444-555555555555' };
  for (const action of ['TAB_TELEMETRY', 'SYSTEM_TELEMETRY', 'READ_TRANSCRIPT']) {
    const descriptor = classifyNativeSupervisorCommand({ action, payload: action === 'SYSTEM_TELEMETRY' ? {} : tab });
    assert.equal(descriptor.lane, 'READ_ONLY', `${action} is read-only`);
    assert.equal(descriptor.read_only, true);
  }
  const press = classifyNativeSupervisorCommand({ action: 'PRESS_KEY', payload: { ...tab, key: 'Escape' } });
  assert.equal(press.lane, 'TAB_MUTATION');
  assert.equal(press.read_only, false);
});

test('task prompt embeds the telemetry digest and keeps it bounded', () => {
  const lease = {
    task_id: '194686c8-d12a-48a5-82a4-8a6db7e403e4',
    agent_id: 'agent_12345678-1234-1234-1234-123456789012',
    role: 'RESEARCHER',
    lease_generation: 1,
    base_sha: 'a'.repeat(40),
    tab_id: 'tab_1',
    target_id: 'webcontents:3',
    agent_generation_epoch: 28,
    task_spec: { objective: 'Research the repo' },
  };
  const digest = 'SYSTEM TELEMETRY (live browser process digest)\nfleet={"ACTIVE":7}\nsupervisor=WAITING';
  const withTelemetry = renderDevosTaskPrompt(lease, { telemetry_digest: digest });
  const without = renderDevosTaskPrompt(lease);
  assert.ok(withTelemetry.includes('SYSTEM TELEMETRY'));
  assert.ok(withTelemetry.includes('fleet={"ACTIVE":7}'));
  assert.ok(!without.includes('SYSTEM TELEMETRY'));
  assert.ok(withTelemetry.length <= 24000);
  assert.notEqual(withTelemetry, without);
});

test('network registry mirrors completions into the observation plane sink', () => {
  const registry = new TabNetworkActivityRegistry();
  const mirrored = [];
  registry.setCompletionSink((entry) => mirrored.push(entry));
  const details = {
    id: 100,
    webContentsId: 5,
    url: 'https://chat.z.ai/api/chat/completions',
    method: 'POST',
    resourceType: 'xhr',
  };
  registry.onBeforeRequest(details);
  registry.onCompleted({ ...details, statusCode: 200 });
  assert.equal(mirrored.length, 1);
  assert.equal(mirrored[0].status, 200);
  assert.equal(mirrored[0].method, 'POST');
  assert.equal(mirrored[0].url, 'https://chat.z.ai/api/chat/completions');
  assert.equal(mirrored[0].error, false);
  assert.equal(typeof mirrored[0].duration_ms, 'number');
});
