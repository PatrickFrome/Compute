import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import test from 'node:test';

import {
  ExactBrowserTabViewMap,
  resolveExactWebContentsTabBinding,
  resolveTabIdForWebContents,
  resolveWebContentsIdForTab,
  webContentsTabIndexSnapshot,
} from '../src/browser-webcontents-tab-index.mjs';

const TAB_A = 'tab_00000000-0000-4000-8000-000000000201';
const TAB_B = 'tab_00000000-0000-4000-8000-000000000202';

function fakeWebContents(id) {
  const emitter = new EventEmitter();
  emitter.id = id;
  emitter.isDestroyed = () => false;
  return emitter;
}

test('tab view map maintains exact O(1) reverse identity across set/delete/clear', () => {
  const views = new ExactBrowserTabViewMap();
  const a = fakeWebContents(201);
  const b = fakeWebContents(202);

  views.set(TAB_A, { webContents: a });
  views.set(TAB_B, { webContents: b });
  assert.equal(resolveTabIdForWebContents(a), TAB_A);
  assert.equal(resolveTabIdForWebContents(202), TAB_B);
  assert.equal(resolveWebContentsIdForTab(TAB_A), 201);
  assert.ok(resolveExactWebContentsTabBinding(TAB_A).binding_generation > 0);
  assert.equal(webContentsTabIndexSnapshot().lookup_complexity, 'O(1)');
  assert.equal(webContentsTabIndexSnapshot().binding_count, 2);

  views.delete(TAB_A);
  assert.equal(resolveTabIdForWebContents(201), null);
  assert.equal(resolveWebContentsIdForTab(TAB_A), null);

  views.clear();
  assert.equal(resolveTabIdForWebContents(b), null);
  assert.equal(webContentsTabIndexSnapshot().binding_count, 0);
});

test('WebContents destruction removes stale reverse binding immediately', () => {
  const views = new ExactBrowserTabViewMap();
  const wc = fakeWebContents(203);
  views.set(TAB_A, { webContents: wc });
  assert.equal(resolveTabIdForWebContents(203), TAB_A);
  wc.emit('destroyed');
  assert.equal(resolveTabIdForWebContents(203), null);
  assert.equal(views.has(TAB_A), false);
});

test('replacing a tab view fences the old WebContents id', () => {
  const views = new ExactBrowserTabViewMap();
  const oldWc = fakeWebContents(204);
  const newWc = fakeWebContents(205);
  views.set(TAB_A, { webContents: oldWc });
  const oldGeneration = resolveExactWebContentsTabBinding(TAB_A).binding_generation;
  views.set(TAB_A, { webContents: newWc });
  assert.equal(resolveTabIdForWebContents(204), null);
  assert.equal(resolveTabIdForWebContents(205), TAB_A);
  assert.equal(resolveWebContentsIdForTab(TAB_A), 205);
  assert.ok(resolveExactWebContentsTabBinding(TAB_A).binding_generation > oldGeneration);
  views.clear();
});

test('main and process plane use exact index with no selected/url/title fallback', () => {
  const main = fs.readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const plane = fs.readFileSync(new URL('../src/browser-realtime-process-plane.mjs', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../src/browser-webcontents-tab-index.mjs', import.meta.url), 'utf8');

  assert.match(main, /const views = new ExactBrowserTabViewMap\(\)/);
  assert.match(plane, /resolveTabId = resolveTabIdForWebContents/);
  assert.match(plane, /tab_identity_source: 'EXACT_WEBCONTENTS_TAB_INDEX_O1'/);
  assert.match(index, /selected_tab_fallback: false/);
  assert.match(index, /url_fallback: false/);
  assert.match(index, /title_fallback: false/);
  assert.doesNotMatch(index, /getURL|getTitle|selected\(/);
});
