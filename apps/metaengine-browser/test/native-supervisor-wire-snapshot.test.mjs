import assert from 'node:assert/strict';
import test from 'node:test';

import { nativeSupervisorTransportState } from '../src/native-supervisor-client-base.mjs';
import { buildSupervisorLifecycleStatusSnapshot } from '../src/supervisor-lifecycle-runtime.mjs';

test('heartbeat perception projection is bounded while retaining exact target and content digest', () => {
  const semanticTargets = Array.from({ length: 200 }, (_, index) => ({
    role: 'button',
    name: `control-${index}-${'n'.repeat(400)}`,
    backend_node_id: index + 1,
    value_sha256: 'a'.repeat(64),
  }));
  const source = {
    tabs: [{ tab_id: 'tab_a', url: 'https://chatgpt.com/c/a' }],
    perception: {
      schema: 'metaengine.native-browser.perception.v1',
      tab_id: 'tab_a',
      target_id: 'webcontents:7',
      process_incarnation_id: 'process_a',
      text_excerpt: 'x'.repeat(20_000),
      semantic_targets: semanticTargets,
      authority_effect: false,
    },
  };
  const projected = nativeSupervisorTransportState(source);
  assert.equal(projected.tabs.length, 1);
  assert.equal(projected.perception.semantic_target_count, 200);
  assert.equal(projected.perception.semantic_targets.length, 24);
  assert.equal(projected.perception.semantic_targets_truncated, true);
  assert.equal(projected.perception.text_excerpt.length, 2048);
  assert.equal(projected.perception.text_excerpt_bytes, 20_000);
  assert.match(projected.perception.text_excerpt_sha256, /^[a-f0-9]{64}$/);
  assert.equal(projected.perception.target_id, 'webcontents:7');
  assert.ok(Buffer.byteLength(JSON.stringify(projected.perception), 'utf8') < 16_384);
});

test('lifecycle wire snapshot bounds history and session telemetry below Edge admission ceiling', () => {
  const wake = (index) => ({
    wake_id: `wake_${index}`,
    reason: 'CONTINUE_DEVELOPMENT',
    queue_key: 'q'.repeat(1000),
    supervisor_epoch: 1,
    cycle_seq: index,
    ambiguous_reason: 'a'.repeat(4000),
    retired_reason: 'r'.repeat(4000),
    arbitrary_payload: 'z'.repeat(20_000),
    automatic_retry_allowed: false,
  });
  const tab = (index) => ({
    tab_id: `tab_${index}`,
    state: index % 2 ? 'IDLE' : 'GENERATING',
    generation_epoch: index,
    physical_health: 'HEALTHY',
    controls: { stop: index % 2, continue: 0, retry: 0, send: 1 },
    last_digest: 'd'.repeat(20_000),
    recent_generation_ms: Array(1000).fill(25),
    terminal_ready: index % 2 === 1,
    authority_effect: false,
  });
  const full = {
    schema: 'metaengine.supervisor-lifecycle-runtime.v4',
    keepalive: {
      schema: 'metaengine.supervisor-keepalive.state.v1',
      queued_wakes: Array.from({ length: 32 }, (_, index) => wake(index)),
      ambiguous_history: Array.from({ length: 32 }, (_, index) => wake(index)),
      predecessor_wake_history: Array.from({ length: 32 }, (_, index) => wake(index)),
      previous_worker_generation: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`agent_${index}`, 'IDLE'])),
      authority_effect: false,
    },
    supervisor_session: {
      schema: 'metaengine.chatgpt-session-monitor.snapshot.v1',
      version: '1.2.0',
      tabs: Array.from({ length: 64 }, (_, index) => tab(index)),
      persisted_response_text: false,
      authority_effect: false,
    },
    worker_signals: Array.from({ length: 100 }, (_, index) => ({ agent_id: `agent_${index}`, lifecycle_state: 'ACTIVE', generation_state: 'IDLE' })),
    continuous_service: { enabled: true },
    arbitrary_payload: 'must-not-cross-wire'.repeat(20_000),
    authority_effect: false,
  };
  const wire = buildSupervisorLifecycleStatusSnapshot(full);
  assert.equal(wire.keepalive.ambiguous_history_count, 32);
  assert.equal(wire.keepalive.ambiguous_history.length, 4);
  assert.equal(wire.keepalive.predecessor_wake_history.length, 4);
  assert.equal(Object.keys(wire.keepalive.previous_worker_generation).length, 32);
  assert.equal(wire.supervisor_session.tab_count, 64);
  assert.equal(wire.supervisor_session.tabs.length, 32);
  assert.equal(wire.supervisor_session.tabs[0].last_digest, undefined);
  assert.equal(wire.worker_signals.length, 32);
  assert.equal(wire.arbitrary_payload, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(wire), 'utf8') < 32_768);
});
