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
