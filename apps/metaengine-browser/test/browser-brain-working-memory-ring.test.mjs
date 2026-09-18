import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';

const TAB = 'tab_00000000-0000-4000-8000-000000000001';

test('recent event memory stays fixed-size with exact drop accounting under 100k append burst', () => {
  const memory = new BrowserBrainWorkingMemory({ maxEvents: 64, maxCells: 8 });
  const total = 100_000;
  for (let i = 1; i <= total; i += 1) {
    memory.ingestEvent({
      seq: i,
      type: 'SEMANTIC_EVENT',
      tab_id: TAB,
      semantic_method: 'Accessibility.nodesUpdated',
      semantic_sequence: i,
      observed_at: new Date(1_800_000_000_000 + i).toISOString(),
    });
  }
  const snapshot = memory.snapshot();
  assert.equal(snapshot.recent_event_count, 64);
  assert.equal(snapshot.global.dropped_events, total - 64);
  assert.equal(snapshot.recent_event_storage, 'FIXED_CIRCULAR_BUFFER');
  assert.equal(snapshot.recent_event_append_complexity, 'O(1)');
  assert.equal(snapshot.cells[0].last_semantic_sequence, total);
  assert.equal(snapshot.raw_dom_stored, false);
  assert.equal(snapshot.execution_authority, false);
});

test('checkpoint restore intentionally clears transient ring while preserving bounded causal cell state', () => {
  const memory = new BrowserBrainWorkingMemory({ maxEvents: 64, maxCells: 8 });
  for (let i = 1; i <= 80; i += 1) {
    memory.ingestEvent({ seq: i, type: 'SEMANTIC_EVENT', tab_id: TAB, semantic_sequence: i });
  }
  const checkpoint = memory.checkpoint();
  const restored = new BrowserBrainWorkingMemory({ maxEvents: 64, maxCells: 8 });
  restored.restore(checkpoint);
  const snapshot = restored.snapshot();
  assert.equal(snapshot.recent_event_count, 0);
  assert.equal(snapshot.global.dropped_events, 16);
  assert.equal(snapshot.cells[0].last_semantic_sequence, 80);
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.authority_effect, false);
});

test('mixed-case critical lifecycle events are normalized before state transition checks', () => {
  const memory = new BrowserBrainWorkingMemory({ maxEvents: 64, maxCells: 8 });
  memory.rememberBinding({
    valid: true,
    tab_id: TAB,
    binding_generation: 1,
    web_contents_id: 7,
    renderer_pid: 77,
    renderer_process_key: '77:1234',
    target_id: 'target-7',
    document_generation: 1,
    semantic_revision: 1,
  });
  assert.equal(memory.context(TAB).status, 'READY');

  const projected = memory.ingestEvent({
    seq: 2,
    type: 'web_contents_destroyed',
    tab_id: TAB,
    web_contents_id: 7,
    reason: 'closed',
  });
  const context = memory.context(TAB);
  assert.equal(projected.type, 'WEB_CONTENTS_DESTROYED');
  assert.equal(context.status, 'GONE');
  assert.equal(context.binding, null);
  assert.equal(memory.snapshot().lifecycle_event_type_normalized, true);
  assert.equal(memory.snapshot().authority_effect, false);
});
