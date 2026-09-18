import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserRuntimeBindingIndex } from '../src/browser-runtime-binding-index.mjs';
import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';

const TAB_A = 'tab_00000000-0000-4000-8000-000000000001';
const TAB_B = 'tab_00000000-0000-4000-8000-000000000002';

function processSnapshot({ processKey = '200:1725520000100', observedAt = '2026-09-06T00:00:00.000Z' } = {}) {
  return {
    observed_at: observedAt,
    processes: [
      { pid: 200, process_key: processKey, process_identity_complete: true, type: 'Tab' },
      { pid: 300, process_key: '300:1725520000200', process_identity_complete: true, type: 'GPU' },
    ],
    web_contents: [
      { web_contents_id: 7, os_pid: 200, process_key: processKey, tab_id: TAB_A },
      { web_contents_id: 8, os_pid: 200, process_key: processKey, tab_id: TAB_B },
    ],
    semantic_plane: {
      targets: [
        { tab_id: TAB_A, target_id: 'target-a', document_generation: 4, semantic_revision: 12 },
        { tab_id: TAB_B, target_id: 'target-b', document_generation: 2, semantic_revision: 5 },
      ],
    },
  };
}

test('runtime binding index resolves exact tab/webContents/process/target identity in O(1)', () => {
  let now = Date.parse('2026-09-06T00:00:00.000Z');
  const index = new BrowserRuntimeBindingIndex({ clock: () => now });
  const snapshot = index.reconcile({
    tabs: [{ tab_id: TAB_A }, { tab_id: TAB_B }],
    process_snapshot: processSnapshot(),
    cell_by_tab: new Map([
      [TAB_A, { cell_id: 'cell:a', cell_generation: 3, provider: 'CHATGPT', role: 'AUTHENTICATED_WORKER' }],
      [TAB_B, { cell_id: 'cell:b', cell_generation: 9, provider: 'CLAUDE', role: 'EPHEMERAL_RESEARCH' }],
    ]),
  });

  assert.equal(snapshot.exact_lookup_complexity, 'O(1)');
  assert.equal(snapshot.pid_reuse_protection, 'PID_PLUS_PROCESS_CREATION_TIME');
  assert.equal(snapshot.live_binding_count, 2);
  const a = index.resolveTab(TAB_A, { require_complete_process_identity: true });
  assert.equal(a.web_contents_id, 7);
  assert.equal(a.renderer_pid, 200);
  assert.equal(a.renderer_process_key, '200:1725520000100');
  assert.equal(a.target_id, 'target-a');
  assert.equal(a.document_generation, 4);
  assert.equal(a.semantic_revision, 12);
  assert.equal(a.cell_id, 'cell:a');
  assert.equal(index.tabIdForWebContents(7), TAB_A);
  assert.deepEqual(index.bindingsForProcess('200:1725520000100').map((row) => row.tab_id).sort(), [TAB_A, TAB_B]);
  assert.equal(a.execution_authority, false);
  assert.equal(a.authority_effect, false);

  const exact = index.assertExactRuntimeTarget({
    tab_id: TAB_A,
    binding_generation: a.binding_generation,
    web_contents_id: 7,
    renderer_process_key: '200:1725520000100',
    target_id: 'target-a',
  });
  assert.equal(exact.tab_id, TAB_A);
});

test('PID reuse or renderer reincarnation fences the old target instead of silently reusing it', () => {
  let now = Date.parse('2026-09-06T00:00:00.000Z');
  const index = new BrowserRuntimeBindingIndex({ clock: () => now });
  index.reconcile({ tabs: [{ tab_id: TAB_A }], process_snapshot: processSnapshot() });
  const before = index.resolveTab(TAB_A, { require_complete_process_identity: true });

  now += 1000;
  index.reconcile({
    tabs: [{ tab_id: TAB_A }],
    process_snapshot: {
      ...processSnapshot({ processKey: '200:1725529999999', observedAt: '2026-09-06T00:00:01.000Z' }),
      web_contents: [{ web_contents_id: 7, os_pid: 200, process_key: '200:1725529999999', tab_id: TAB_A }],
      semantic_plane: { targets: [{ tab_id: TAB_A, target_id: 'target-a2', document_generation: 1, semantic_revision: 1 }] },
    },
  });
  const after = index.resolveTab(TAB_A, { require_complete_process_identity: true });
  assert.ok(after.binding_generation > before.binding_generation);
  assert.notEqual(after.renderer_process_key, before.renderer_process_key);
  assert.throws(() => index.assertExactRuntimeTarget({
    tab_id: TAB_A,
    binding_generation: before.binding_generation,
    web_contents_id: before.web_contents_id,
    renderer_process_key: before.renderer_process_key,
    target_id: before.target_id,
  }), /generation_mismatch|process_incarnation_mismatch|target_id_mismatch/);
});

test('render-process-gone invalidates the exact binding immediately and never authorizes a stale mutation', () => {
  const index = new BrowserRuntimeBindingIndex();
  index.reconcile({ tabs: [{ tab_id: TAB_A }], process_snapshot: processSnapshot() });
  const before = index.resolveTab(TAB_A, { require_complete_process_identity: true });
  assert.ok(before);
  index.applyLifecycleEvent({ type: 'RENDER_PROCESS_GONE', tab_id: TAB_A, web_contents_id: 7, reason: 'crashed' });
  assert.equal(index.resolveTab(TAB_A), null);
  assert.equal(index.tabIdForWebContents(7), null);
  assert.throws(() => index.assertExactRuntimeTarget({
    tab_id: TAB_A,
    binding_generation: before.binding_generation,
    web_contents_id: 7,
    renderer_process_key: before.renderer_process_key,
    target_id: before.target_id,
  }), /target_not_live/);
});

test('working memory stores compact causal facts and strips raw page/network/command payloads', () => {
  let now = Date.parse('2026-09-06T00:00:00.000Z');
  const index = new BrowserRuntimeBindingIndex({ clock: () => now });
  index.reconcile({ tabs: [{ tab_id: TAB_A }], process_snapshot: processSnapshot() });
  const memory = new BrowserBrainWorkingMemory({ clock: () => now, maxEvents: 64 });
  memory.reconcileBindings(index.snapshot());

  now += 1;
  memory.ingestEvent({
    seq: 17,
    type: 'SEMANTIC_EVENT',
    priority: 'P1',
    tab_id: TAB_A,
    web_contents_id: 7,
    os_pid: 200,
    process_key: '200:1725520000100',
    target_id: 'target-a',
    semantic_method: 'Accessibility.nodesUpdated',
    semantic_sequence: 91,
    observed_at: new Date(now).toISOString(),
    raw_payload: { secret: 'must-not-survive' },
    text_excerpt: 'must-not-survive',
    input_value: 'must-not-survive',
  });
  memory.rememberCommandOutcome({
    command_id: 'cmd-1',
    action: 'NAVIGATE',
    tab_id: TAB_A,
    status: 'COMPLETED',
    effect_outcome: 'CONFIRMED',
    payload: { url: 'https://secret.example/' },
    result: { page: 'must-not-survive' },
    recorded_at: new Date(now + 1).toISOString(),
  });

  const context = memory.context(TAB_A);
  assert.equal(context.status, 'READY');
  assert.equal(context.last_semantic_sequence, 91);
  assert.equal(context.last_event.raw_payload_exposed, false);
  assert.equal(context.last_event.page_text_exposed, false);
  assert.equal(context.last_command.result_payload_exposed, false);
  assert.equal('payload' in context.last_command, false);
  assert.equal('result' in context.last_command, false);
  const serialized = JSON.stringify(memory.snapshot());
  assert.equal(serialized.includes('must-not-survive'), false);
  assert.equal(serialized.includes('secret.example'), false);
  assert.equal(memory.snapshot().poll_timer_required, false);
  assert.equal(memory.snapshot().execution_authority, false);
});

test('AMBIGUOUS command outcome becomes durable attention state in a hash-verified compact checkpoint', () => {
  const index = new BrowserRuntimeBindingIndex();
  index.reconcile({ tabs: [{ tab_id: TAB_A }], process_snapshot: processSnapshot() });
  const memory = new BrowserBrainWorkingMemory({ maxEvents: 64 });
  memory.reconcileBindings(index.snapshot());
  memory.rememberCommandOutcome({
    command_id: 'cmd-ambiguous',
    action: 'TYPED_CLICK',
    tab_id: TAB_A,
    status: 'AMBIGUOUS',
    effect_outcome: 'AMBIGUOUS',
    recorded_at: '2026-09-06T00:00:03.000Z',
  });
  assert.equal(memory.context(TAB_A).status, 'NEEDS_ATTENTION');
  assert.equal(memory.context(TAB_A).attention_reason, 'COMMAND_OUTCOME_AMBIGUOUS');

  const checkpoint = memory.checkpoint();
  assert.match(checkpoint.checkpoint_sha256, /^[a-f0-9]{64}$/);
  assert.equal(checkpoint.page_text_exposed, false);
  assert.equal(checkpoint.execution_authority, false);

  const restored = new BrowserBrainWorkingMemory({ maxEvents: 64 });
  restored.restore(checkpoint);
  assert.equal(restored.context(TAB_A).status, 'NEEDS_ATTENTION');
  assert.equal(restored.context(TAB_A).binding.renderer_process_key, '200:1725520000100');
  const tampered = structuredClone(checkpoint);
  tampered.cells[0].status = 'READY';
  assert.throws(() => new BrowserBrainWorkingMemory().restore(tampered), /checkpoint_hash_mismatch/);
});

test('working memory event ring is bounded without creating a retry or scheduler loop', () => {
  const memory = new BrowserBrainWorkingMemory({ maxEvents: 64 });
  for (let i = 1; i <= 200; i += 1) {
    memory.ingestEvent({ seq: i, type: 'METRICS_SAMPLE', observed_at: `2026-09-06T00:00:${String(i % 60).padStart(2, '0')}.000Z` });
  }
  const snapshot = memory.snapshot();
  assert.equal(snapshot.recent_event_count, 64);
  assert.equal(snapshot.global.dropped_events, 136);
  assert.equal(snapshot.poll_timer_required, false);
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.automatic_effect_retry_allowed, false);
});
