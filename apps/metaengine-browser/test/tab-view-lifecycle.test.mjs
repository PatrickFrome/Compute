import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TabRegistry } from '../src/tab-registry.mjs';
import { reconcileDestroyedTabView } from '../src/tab-view-lifecycle.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('destroyed WebContents reconciliation removes the logical tab exactly once', async () => {
  const registry = new TabRegistry();
  const first = registry.create({ url: 'https://chat.z.ai/', kind: 'GLM_CHAT', role: 'USER' });
  const second = registry.create({ url: 'https://chat.z.ai/c/second', kind: 'GLM_CHAT', role: 'USER' });
  registry.select(first.tab_id);

  const fleetCalls = [];
  const invalidated = [];
  let attachCalls = 0;
  let publishCalls = 0;
  const fleet = {
    async onTabClosed(tabId, reason) {
      fleetCalls.push({ tabId, reason });
    },
  };

  const result = await reconcileDestroyedTabView({
    tabId: first.tab_id,
    registry,
    fleet,
    invalidatePerception: (tabId) => invalidated.push(tabId),
    attachSelected: () => { attachCalls += 1; },
    publishSnapshot: async () => { publishCalls += 1; },
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.fleet_notified, true);
  assert.equal(result.projection_published, true);
  assert.equal(registry.get(first.tab_id), null);
  assert.equal(registry.selected()?.tab_id, second.tab_id);
  assert.deepEqual(fleetCalls, [{
    tabId: first.tab_id,
    reason: 'PHYSICAL_WEBCONTENTS_DESTROYED',
  }]);
  assert.deepEqual(invalidated, [first.tab_id]);
  assert.equal(attachCalls, 1);
  assert.equal(publishCalls, 1);

  const replay = await reconcileDestroyedTabView({
    tabId: first.tab_id,
    registry,
    fleet,
    invalidatePerception: (tabId) => invalidated.push(tabId),
    attachSelected: () => { attachCalls += 1; },
    publishSnapshot: async () => { publishCalls += 1; },
  });
  assert.equal(replay.reconciled, false);
  assert.equal(replay.registry_already_absent, true);
  assert.equal(fleetCalls.length, 1, 'explicit close/destroy races must not double-retire fleet state');
  assert.equal(invalidated.length, 1);
  assert.equal(attachCalls, 1);
  assert.equal(publishCalls, 1);
});

test('main shell wires Electron destroyed proof into logical tab reconciliation', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'main.mjs'), 'utf8');
  assert.match(source, /webContents\.once\('destroyed'/);
  assert.match(source, /reconcileDestroyedTabView\(\{/);
  assert.match(source, /tabId:\s*tab\.tab_id/);
});

test('render-process-gone stays observational and does not retire the logical tab by itself', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'main.mjs'), 'utf8');
  const begin = source.indexOf("view.webContents.on('render-process-gone'");
  const end = source.indexOf("view.webContents.once('destroyed'", begin);
  assert.ok(begin >= 0 && end > begin);
  const renderGone = source.slice(begin, end);
  assert.doesNotMatch(renderGone, /registry\.close/);
  assert.doesNotMatch(renderGone, /reconcileDestroyedTabView/);
});
