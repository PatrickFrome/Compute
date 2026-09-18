import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainA2AAdapter } from '../src/browser-brain-a2a-adapter.mjs';

const SAFE_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,191}$/;

test('A2A ingress converts unsafe external identifiers into deterministic safe internal ids', () => {
  const adapter = new BrowserBrainA2AAdapter();
  const first = adapter.fromA2AMessage({
    messageId: 'Message With Spaces/Slash?And Unicode ✓',
    contextId: 'Context With Spaces',
    taskId: 'Task/With/Slash',
    parts: [{ text: 'bounded external data' }],
  }, {
    source_agent_id: 'External Agent/One',
    source_generation: 2,
    target: 'Topic With Spaces',
  });
  const second = adapter.fromA2AMessage({
    messageId: 'Message With Spaces/Slash?And Unicode ✓',
    contextId: 'Context With Spaces',
    taskId: 'Task/With/Slash',
    parts: [{ text: 'bounded external data' }],
  }, {
    source_agent_id: 'External Agent/One',
    source_generation: 2,
    target: 'Topic With Spaces',
  });

  for (const value of [first.message_id, first.context_id, first.task_id, first.source_agent_id, first.target]) {
    assert.match(value, SAFE_ID_RE);
    assert.ok(value.length <= 192);
  }
  assert.equal(first.message_id, second.message_id);
  assert.equal(first.context_id, second.context_id);
  assert.equal(first.task_id, second.task_id);
  assert.equal(first.external_data_untrusted, true);
  assert.equal(first.execution_authority, false);
});

test('A2A long identifiers retain a hash suffix and do not collide after bounding', () => {
  const adapter = new BrowserBrainA2AAdapter();
  const prefix = 'x'.repeat(300);
  const first = adapter.fromA2AMessage({ messageId: `${prefix}a`, parts: [] });
  const second = adapter.fromA2AMessage({ messageId: `${prefix}b`, parts: [] });

  assert.notEqual(first.message_id, second.message_id);
  assert.match(first.message_id, SAFE_ID_RE);
  assert.match(second.message_id, SAFE_ID_RE);
  assert.ok(first.message_id.length <= 192);
  assert.ok(second.message_id.length <= 192);
});

test('A2A ingress rejects oversized payloads, invalid generations and unsupported message kinds', () => {
  const adapter = new BrowserBrainA2AAdapter();
  assert.throws(() => adapter.fromA2AMessage({
    messageId: 'external.parts-overflow',
    parts: Array.from({ length: 33 }, () => ({})),
  }), /ingress_parts_invalid/);

  assert.throws(() => adapter.fromA2AMessage({ messageId: 'external.bad-generation', parts: [] }, {
    source_generation: 1.5,
  }), /agent_generation_invalid/);

  assert.throws(() => adapter.fromA2AMessage({ messageId: 'external.bad-kind', parts: [] }, {
    kind: 'EXECUTE_ARBITRARY_EFFECT',
  }), /ingress_kind_invalid/);

  assert.throws(() => adapter.fromA2AMessage({
    messageId: 'external.payload-too-large',
    parts: [{ text: 'x'.repeat(70_000) }],
  }), /material_too_large/);
});

test('A2A task ingress also bounds unsafe identifiers without granting scheduler authority', () => {
  const adapter = new BrowserBrainA2AAdapter();
  const task = adapter.fromA2ATask({
    id: 'External Task/With Spaces/'.repeat(20),
    contextId: 'External Context/Unsafe',
    status: { state: 'working' },
  });

  assert.match(task.task_id, SAFE_ID_RE);
  assert.match(task.context_id, SAFE_ID_RE);
  assert.ok(task.task_id.length <= 192);
  assert.ok(task.context_id.length <= 192);
  assert.equal(task.status, 'ACTIVE');
  assert.equal(task.external_data_untrusted, true);
  assert.equal(task.scheduler_authority, false);
  assert.equal(task.execution_authority, false);
});
