import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserRuntimeBindingIndex } from '../src/browser-runtime-binding-index.mjs';

const TAB = 'tab_00000000-0000-4000-8000-000000000123';

function binding(index, overrides = {}) {
  return index.bind({
    tab_id: TAB,
    cell_id: 'cell:123',
    cell_generation: 1,
    web_contents_id: 77,
    renderer_pid: 1234,
    renderer_process_key: '1234:5678',
    target_id: 'target-123',
    document_generation: 1,
    semantic_revision: 1,
    ...overrides,
  });
}

test('exact runtime binding rejects a process_key whose PID prefix disagrees with renderer_pid', () => {
  const index = new BrowserRuntimeBindingIndex();
  assert.throws(
    () => binding(index, { renderer_process_key: '4321:5678' }),
    /browser_runtime_binding_process_key_pid_mismatch/,
  );
  assert.equal(index.resolveTab(TAB), null);
});

test('matching PID plus process creation identity remains complete and exact', () => {
  const index = new BrowserRuntimeBindingIndex();
  const row = binding(index);
  assert.equal(row.renderer_pid, 1234);
  assert.equal(row.renderer_process_key, '1234:5678');
  assert.equal(row.renderer_process_identity_complete, true);
  assert.equal(index.resolveTab(TAB, { require_complete_process_identity: true })?.target_id, 'target-123');
  assert.equal(index.snapshot().process_key_pid_consistency_required, true);
});

test('reconcile fails closed when WebContents exposes a mismatched process incarnation key', () => {
  const index = new BrowserRuntimeBindingIndex();
  assert.throws(
    () => index.reconcile({
      process_snapshot: {
        observed_at: new Date().toISOString(),
        processes: [{ pid: 1234, process_key: '1234:5678' }],
        web_contents: [{
          web_contents_id: 77,
          os_pid: 1234,
          process_key: '4321:9999',
          tab_id: TAB,
          destroyed: false,
        }],
        semantic_plane: { targets: [{ tab_id: TAB, target_id: 'target-123' }] },
      },
    }),
    /browser_runtime_binding_process_key_pid_mismatch/,
  );
  assert.equal(index.resolveTab(TAB), null);
});
