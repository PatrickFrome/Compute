import test from 'node:test';
import assert from 'node:assert/strict';
import { planPostRestoreBlankTabCleanup } from '../src/native-supervisor-client.mjs';

test('closes only unbound ChatGPT root tabs created after restart', () => {
  const plan = planPostRestoreBlankTabCleanup({
    continuityRow: {
      tabs: [
        { url: 'https://chatgpt.com/c/current' },
        { url: 'https://chatgpt.com/c/supervisor' },
      ],
    },
    bindings: [
      { tab_id: 'tab_current' },
      { tab_id: 'tab_supervisor' },
    ],
    currentTabs: [
      { tab_id: 'tab_current', url: 'https://chatgpt.com/c/current', selected: true },
      { tab_id: 'tab_supervisor', url: 'https://chatgpt.com/c/supervisor', selected: false },
      { tab_id: 'tab_bootstrap', url: 'https://chatgpt.com/', selected: false },
      { tab_id: 'tab_warm_1', url: 'https://chatgpt.com/', selected: false },
      { tab_id: 'tab_other', url: 'https://example.com/', selected: false },
    ],
  });
  assert.deepEqual(plan.close_tab_ids.sort(), ['tab_bootstrap', 'tab_warm_1']);
  assert.equal(plan.arbitrary_tab_close, false);
});

test('preserves a root ChatGPT tab that existed before update', () => {
  const plan = planPostRestoreBlankTabCleanup({
    continuityRow: {
      tabs: [
        { url: 'https://chatgpt.com/' },
        { url: 'https://chatgpt.com/c/supervisor' },
      ],
    },
    bindings: [
      { tab_id: 'tab_existing_root' },
      { tab_id: 'tab_supervisor' },
    ],
    currentTabs: [
      { tab_id: 'tab_existing_root', url: 'https://chatgpt.com/', selected: false },
      { tab_id: 'tab_supervisor', url: 'https://chatgpt.com/c/supervisor', selected: true },
      { tab_id: 'tab_new_extra', url: 'https://chatgpt.com/', selected: false },
    ],
  });
  assert.deepEqual(plan.close_tab_ids, ['tab_new_extra']);
  assert.equal(plan.desired_root_count, 1);
});

test('never closes non-root or bound conversation tabs', () => {
  const plan = planPostRestoreBlankTabCleanup({
    continuityRow: { tabs: [{ url: 'https://chatgpt.com/c/a' }] },
    bindings: [{ tab_id: 'tab_a' }],
    currentTabs: [
      { tab_id: 'tab_a', url: 'https://chatgpt.com/c/a', selected: true },
      { tab_id: 'tab_unknown_chat', url: 'https://chatgpt.com/c/unknown', selected: false },
      { tab_id: 'tab_zai', url: 'https://chat.z.ai/', selected: false },
    ],
  });
  assert.deepEqual(plan.close_tab_ids, []);
});
