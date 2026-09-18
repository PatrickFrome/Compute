import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserRuntimeBindingIndex } from '../src/browser-runtime-binding-index.mjs';

const TAB = 'tab_00000000-0000-4000-8000-0000000000aa';

function bind(index, overrides = {}) {
  return index.bind({
    tab_id: TAB,
    cell_id: 'cell:worker-a',
    cell_generation: 1,
    web_contents_id: 9,
    renderer_pid: 501,
    renderer_process_key: '501:1725520000100',
    target_id: 'devtools-target-a',
    document_generation: 1,
    semantic_revision: 1,
    ...overrides,
  });
}

test('document generation change advances the exact runtime binding generation', () => {
  const index = new BrowserRuntimeBindingIndex();
  const before = bind(index);
  const sameDocument = bind(index, { semantic_revision: 99 });
  assert.equal(sameDocument.binding_generation, before.binding_generation);

  const afterNavigation = bind(index, { document_generation: 2, semantic_revision: 1 });
  assert.ok(afterNavigation.binding_generation > before.binding_generation);
  assert.throws(() => index.assertExactRuntimeTarget({
    tab_id: TAB,
    binding_generation: before.binding_generation,
    web_contents_id: before.web_contents_id,
    renderer_process_key: before.renderer_process_key,
    target_id: before.target_id,
  }), /generation_mismatch/);
});

test('cell rebinding advances generation even when renderer identity is unchanged', () => {
  const index = new BrowserRuntimeBindingIndex();
  const before = bind(index);
  const after = bind(index, { cell_id: 'cell:worker-b', cell_generation: 2 });
  assert.ok(after.binding_generation > before.binding_generation);
  assert.equal(after.web_contents_id, before.web_contents_id);
  assert.equal(after.renderer_process_key, before.renderer_process_key);
});
