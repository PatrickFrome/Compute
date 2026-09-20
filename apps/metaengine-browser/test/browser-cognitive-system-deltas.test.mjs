import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserCognitiveDeltaBus, classifyCognitiveDeltaPriority } from '../src/browser-cognitive-delta-bus.mjs';
import {
  COGNITIVE_SYSTEM_DELTA_KINDS,
  BrowserCognitiveSystemDeltaRing,
  normalizeSystemDeltaInput,
  publishCognitiveSystemDelta,
  publishFleetAgentLifecycle,
  publishSupervisorCommand,
  publishArtifactRecorded,
  publishComputeBridgeHealth,
  projectSystemDeltaTail,
} from '../src/browser-cognitive-system-deltas.mjs';

test('system delta classification: fleet/supervisor are P1, artifact/compute are P2', () => {
  assert.equal(classifyCognitiveDeltaPriority({ type: 'SYSTEM_EVENT', system_kind: 'FLEET_AGENT_LIFECYCLE' }), 'P1');
  assert.equal(classifyCognitiveDeltaPriority({ type: 'SYSTEM_EVENT', system_kind: 'SUPERVISOR_COMMAND' }), 'P1');
  assert.equal(classifyCognitiveDeltaPriority({ type: 'SYSTEM_EVENT', system_kind: 'ARTIFACT_RECORDED' }), 'P2');
  assert.equal(classifyCognitiveDeltaPriority({ type: 'SYSTEM_EVENT', system_kind: 'COMPUTE_BRIDGE_HEALTH' }), 'P2');
});

test('system deltas ride the real cognitive bus with SYSTEM source and bounded projection', () => {
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 64 });
  const accepted = publishCognitiveSystemDelta(bus, null, {
    system_kind: 'SUPERVISOR_COMMAND',
    subject_id: 'cmd-123',
    detail: 'CAPTURE/OK/12ms',
  });
  assert.equal(accepted.accepted, true);
  const read = bus.readSince(0, 16);
  const event = read.events.find((row) => row.type === 'SYSTEM_EVENT');
  assert.ok(event, 'system event retained');
  assert.equal(event.source, 'SYSTEM');
  assert.equal(event.system_kind, 'SUPERVISOR_COMMAND');
  assert.equal(event.subject_id, 'cmd-123');
  assert.equal(event.detail, 'CAPTURE/OK/12ms');
  assert.equal(event.priority, 'P1');
  assert.equal(event.raw_payload_exposed, false);
  assert.equal(event.authority_effect, false);
  assert.equal(event.command_leasing, false);
});

test('normalize rejects unknown kinds and missing subjects, clips long values', () => {
  assert.throws(() => normalizeSystemDeltaInput({ system_kind: 'NOT_A_KIND', subject_id: 'x' }), /cognitive_system_delta_kind_invalid/);
  assert.throws(() => normalizeSystemDeltaInput({ system_kind: 'ARTIFACT_RECORDED' }), /cognitive_system_delta_subject_required/);
  assert.throws(() => normalizeSystemDeltaInput('nope'), /cognitive_system_delta_input_invalid/);
  const normalized = normalizeSystemDeltaInput({
    system_kind: 'ARTIFACT_RECORDED',
    subject_id: 'a'.repeat(400),
    detail: 'd'.repeat(400),
  });
  assert.equal(normalized.subject_id.length, 160);
  assert.equal(normalized.detail.length, 240);
  assert.equal(normalized.type, 'SYSTEM_EVENT');
});

test('typed publishers produce the expected shapes', () => {
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 64 });
  publishFleetAgentLifecycle(bus, null, { agent_id: 'agent-1', role: 'worker', lifecycle_state: 'ACTIVE', generation_epoch: 3 });
  publishSupervisorCommand(bus, null, { command_id: 'cmd-9', action: 'NAVIGATE', status: 'FAILED', duration_ms: 42 });
  publishArtifactRecorded(bus, null, { artifact_id: 'art-1', kind: 'task-result-COMPLETED', task_id: 'task-7' });
  publishComputeBridgeHealth(bus, null, { state: 'DEGRADED', reason_code: 'EPIPE' });
  const events = bus.readSince(0, 32).events.filter((row) => row.type === 'SYSTEM_EVENT');
  assert.equal(events.length, 4);
  const byKind = new Map(events.map((row) => [row.system_kind, row]));
  assert.equal(byKind.get('FLEET_AGENT_LIFECYCLE').subject_id, 'agent-1');
  assert.equal(byKind.get('FLEET_AGENT_LIFECYCLE').detail, 'worker/ACTIVE/g3');
  assert.equal(byKind.get('SUPERVISOR_COMMAND').priority, 'P1');
  assert.equal(byKind.get('SUPERVISOR_COMMAND').subject_id, 'cmd-9');
  assert.equal(byKind.get('SUPERVISOR_COMMAND').detail, 'NAVIGATE/FAILED/42ms');
  assert.ok(byKind.get('ARTIFACT_RECORDED').detail.includes('task:task-7'));
  assert.equal(byKind.get('COMPUTE_BRIDGE_HEALTH').subject_id, 'DEGRADED');
});

test('ring keeps a bounded tail and never lets semantic noise drown system rows', () => {
  const ring = new BrowserCognitiveSystemDeltaRing({ maxEntries: 4 });
  for (let index = 0; index < 10; index += 1) {
    ring.push(normalizeSystemDeltaInput({ system_kind: 'ARTIFACT_RECORDED', subject_id: `art-${index}` }));
  }
  const snapshot = ring.snapshot();
  assert.equal(snapshot.entries, 4);
  assert.ok(snapshot.dropped_total >= 6);
  const tail = projectSystemDeltaTail(ring, 2);
  assert.equal(tail.length, 2);
  assert.equal(tail[0].subject_id, 'art-8');
  assert.equal(tail[1].subject_id, 'art-9');
  for (const row of tail) {
    assert.equal(row.authority_effect, false);
    assert.ok(COGNITIVE_SYSTEM_DELTA_KINDS[row.system_kind]);
  }
  assert.throws(() => ring.push({ system_kind: 'BOGUS', subject_id: 'x' }), /cognitive_system_ring_entry_invalid/);
});

test('publisher tolerates a null bus (ring-only) and a null ring (bus-only)', () => {
  const ring = new BrowserCognitiveSystemDeltaRing({ maxEntries: 8 });
  const result = publishCognitiveSystemDelta(null, ring, { system_kind: 'COMPUTE_BRIDGE_HEALTH', subject_id: 'OFFLINE' });
  assert.equal(result, null);
  assert.equal(projectSystemDeltaTail(ring, 8).length, 1);
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 8 });
  assert.equal(publishCognitiveSystemDelta(bus, null, { system_kind: 'COMPUTE_BRIDGE_HEALTH', subject_id: 'OFFLINE' }).accepted, true);
});
