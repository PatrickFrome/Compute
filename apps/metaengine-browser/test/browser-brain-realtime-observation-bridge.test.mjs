import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBrainRealtimeObservationBridge } from '../src/browser-brain-realtime-observation-bridge.mjs';

const TAB = 'tab_00000000-0000-4000-8000-000000000077';

function processSnapshot({ processKey = '200:1725520000100', semanticRevision = 4 } = {}) {
  const [pidText, createdText] = processKey.split(':');
  const pid = Number(pidText);
  return {
    observed_at: '2026-09-06T00:00:00.000Z',
    processes: [{ pid, process_key: processKey, creation_time_ms: Number(createdText) }],
    web_contents: [{
      web_contents_id: 77,
      os_pid: pid,
      process_key: processKey,
      tab_id: TAB,
    }],
    semantic_plane: {
      targets: [{
        tab_id: TAB,
        target_id: 'target-77',
        document_generation: 3,
        semantic_revision: semanticRevision,
      }],
    },
  };
}

test('existing metrics cadence reconciles exact BrowserCell/process identity into bounded working memory', () => {
  const bridge = new BrowserBrainRealtimeObservationBridge();
  const cells = new Map([[TAB, { cell_id: 'cell:77', cell_generation: 9, provider: 'openai', role: 'IMPLEMENTER' }]]);

  const result = bridge.observe({ seq: 1, type: 'METRICS_SAMPLE', observed_at: '2026-09-06T00:00:00.000Z' }, {
    process_snapshot: processSnapshot(),
    cell_by_tab: cells,
  });

  assert.equal(result.census_reconciled, true);
  const binding = bridge.binding(TAB, { require_complete_process_identity: true });
  assert.equal(binding.cell_id, 'cell:77');
  assert.equal(binding.cell_generation, 9);
  assert.equal(binding.web_contents_id, 77);
  assert.equal(binding.renderer_pid, 200);
  assert.equal(binding.renderer_process_key, '200:1725520000100');
  assert.equal(binding.target_id, 'target-77');
  assert.equal(binding.semantic_revision, 4);
  assert.equal(bridge.bindingsForProcess('200:1725520000100')[0].tab_id, TAB);

  const context = bridge.context(TAB);
  assert.equal(context.binding.renderer_process_key, '200:1725520000100');
  assert.equal(context.binding.provider, 'openai');
  assert.equal(context.page_text_exposed, false);

  const snapshot = bridge.snapshot();
  assert.equal(snapshot.census_reconciliations, 1);
  assert.equal(snapshot.poll_timer_required, false);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.execution_authority, false);
  assert.equal(snapshot.command_leasing, false);
});

test('semantic deltas update the current exact binding in O(1) without a full census', () => {
  const bridge = new BrowserBrainRealtimeObservationBridge();
  bridge.reconcile(processSnapshot());
  const generation = bridge.binding(TAB).binding_generation;

  const result = bridge.observe({
    seq: 2,
    type: 'SEMANTIC_EVENT',
    tab_id: TAB,
    web_contents_id: 77,
    target_id: 'target-77',
    semantic_method: 'DOM.documentUpdated',
    semantic_sequence: 8,
    observed_at: '2026-09-06T00:00:00.010Z',
  });

  assert.equal(result.census_reconciled, false);
  assert.equal(result.binding.semantic_revision, 8);
  assert.equal(result.binding.binding_generation, generation);
  assert.equal(bridge.context(TAB).last_semantic_sequence, 8);
  assert.equal(bridge.snapshot().census_reconciliations, 1);
  assert.equal(bridge.snapshot().incremental_binding_updates, 1);
});

test('renderer death invalidates exact binding and working memory immediately without retry authority', () => {
  const bridge = new BrowserBrainRealtimeObservationBridge();
  bridge.reconcile(processSnapshot());

  const result = bridge.observe({
    seq: 3,
    type: 'RENDER_PROCESS_GONE',
    tab_id: TAB,
    web_contents_id: 77,
    os_pid: 200,
    reason: 'crashed',
    observed_at: '2026-09-06T00:00:00.020Z',
  });

  assert.equal(result.binding, null);
  assert.equal(bridge.binding(TAB), null);
  assert.equal(bridge.context(TAB).status, 'GONE');
  assert.equal(bridge.context(TAB).binding, null);
  assert.equal(bridge.snapshot().lifecycle_invalidations, 1);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
});

test('PID reuse changes process incarnation and binding generation only on census reconciliation', () => {
  const bridge = new BrowserBrainRealtimeObservationBridge();
  bridge.reconcile(processSnapshot());
  const first = bridge.binding(TAB);

  for (let seq = 10; seq < 110; seq += 1) {
    bridge.observe({ seq, type: seq % 2 ? 'WEB_CONTENTS_FOCUSED' : 'WEB_CONTENTS_BLURRED', tab_id: TAB, web_contents_id: 77 });
  }
  assert.equal(bridge.snapshot().census_reconciliations, 1);

  bridge.observe({ seq: 110, type: 'METRICS_SAMPLE' }, {
    process_snapshot: processSnapshot({ processKey: '200:1725529999999', semanticRevision: 9 }),
  });
  const second = bridge.binding(TAB, { require_complete_process_identity: true });
  assert.equal(second.renderer_process_key, '200:1725529999999');
  assert.ok(second.binding_generation > first.binding_generation);
  assert.equal(bridge.bindingsForProcess('200:1725520000100').length, 0);
  assert.equal(bridge.snapshot().census_reconciliations, 2);
});

test('checkpoint remains privacy bounded and carries no command or effect authority', () => {
  const bridge = new BrowserBrainRealtimeObservationBridge();
  bridge.reconcile(processSnapshot());
  bridge.observe({
    seq: 120,
    type: 'SEMANTIC_EVENT',
    tab_id: TAB,
    semantic_method: 'Network.requestWillBeSent',
    semantic_sequence: 10,
    page_text: 'must not persist',
    input_value: 'must not persist',
    headers: { authorization: 'must not persist' },
    post_data: 'must not persist',
  });

  const serialized = JSON.stringify(bridge.checkpoint());
  assert.equal(serialized.includes('must not persist'), false);
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.raw_dom_stored, false);
  assert.equal(snapshot.raw_network_stored, false);
  assert.equal(snapshot.page_text_stored, false);
  assert.equal(snapshot.input_values_stored, false);
  assert.equal(snapshot.command_payload_stored, false);
  assert.equal(snapshot.execution_authority, false);
  assert.equal(snapshot.authority_effect, false);
});
