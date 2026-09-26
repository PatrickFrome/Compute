import assert from 'node:assert/strict';
import test from 'node:test';
import { TabRegistry } from '../src/tab-registry.mjs';

test('tab registry uses stable logical ids and deterministic selection on close', () => {
  const r = new TabRegistry();
  const a = r.create({ url: 'https://chatgpt.com/', kind: 'CHATGPT' });
  const b = r.create({ url: 'https://github.com/', kind: 'USER_WEB' });
  assert.notEqual(a.tab_id, b.tab_id);
  r.select(b.tab_id);
  r.update(b.tab_id, { title: 'GitHub' });
  assert.equal(r.selected().title, 'GitHub');
  r.close(b.tab_id);
  assert.equal(r.selected().tab_id, a.tab_id);
});


test('tab registry allocates one immutable canonical BrowserCell per logical tab', () => {
  const r = new TabRegistry();
  const a = r.create({ url: 'https://chat.z.ai/', kind: 'GLM_CHAT', role: 'FLEET' });
  const b = r.create({ url: 'https://chatgpt.com/', kind: 'CHATGPT', role: 'USER' });

  assert.match(a.browser_cell_id, /^cell:[0-9a-f-]{36}$/i);
  assert.match(b.browser_cell_id, /^cell:[0-9a-f-]{36}$/i);
  assert.notEqual(a.browser_cell_id, b.browser_cell_id);
  assert.equal(a.browser_cell_generation, 1);
  assert.equal(b.browser_cell_generation, 1);

  const updated = r.update(a.tab_id, {
    title: 'renamed',
    browser_cell_id: 'cell:forged',
    browser_cell_generation: 99,
  });
  assert.equal(updated.browser_cell_id, a.browser_cell_id);
  assert.equal(updated.browser_cell_generation, 1);
  assert.equal(r.get(a.tab_id).browser_cell_id, a.browser_cell_id);

  r.select(a.tab_id);
  assert.equal(r.selected().browser_cell_id, a.browser_cell_id);
  r.close(a.tab_id);
  assert.equal(r.get(a.tab_id), null);
});
