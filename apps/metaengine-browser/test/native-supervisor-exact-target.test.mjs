import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import test from 'node:test';

import { ExactBrowserTabViewMap } from '../src/browser-webcontents-tab-index.mjs';
import {
  assertExactNativeSupervisorMutationTargetCurrent,
  resolveExactNativeSupervisorMutationTarget,
} from '../src/native-supervisor-exact-target.mjs';

const TAB_A = 'tab_00000000-0000-4000-8000-000000000401';
const TAB_B = 'tab_00000000-0000-4000-8000-000000000402';

function webContents(id) {
  const row = new EventEmitter();
  row.id = id;
  row.destroyed = false;
  row.isDestroyed = () => row.destroyed;
  return row;
}

function harness() {
  const registryRows = new Map([
    [TAB_A, { tab_id: TAB_A, url: 'https://chatgpt.com/c/a' }],
    [TAB_B, { tab_id: TAB_B, url: 'https://chatgpt.com/c/b' }],
  ]);
  const registry = { get: (tabId) => registryRows.get(String(tabId).toLowerCase()) || null };
  const views = new ExactBrowserTabViewMap();
  const wcA = webContents(401);
  const wcB = webContents(402);
  views.set(TAB_A, { webContents: wcA });
  views.set(TAB_B, { webContents: wcB });
  return { registry, views, wcA, wcB };
}

test('existing-tab mutations require explicit exact tab identity and ignore selected/platform hints', () => {
  const h = harness();
  try {
    for (const action of ['SCROLL','SEMANTIC_TYPE','TYPED_CLICK','NAVIGATE','BACK','FORWARD','RELOAD','CLOSE_TAB','SELECT_TAB']) {
      assert.throws(
        () => resolveExactNativeSupervisorMutationTarget({ action, platform: 'CHATGPT', payload: {} }, h),
        /native_supervisor_exact_tab_required/,
        action,
      );
    }
    const target = resolveExactNativeSupervisorMutationTarget({
      action: 'SCROLL',
      platform: 'GLM_ZAI',
      payload: { tab_id: TAB_B, delta_y: 100 },
    }, h);
    assert.equal(target.tab_id, TAB_B);
    assert.equal(target.web_contents_id, 402);
    assert.equal(target.selected_tab_fallback, false);
    assert.equal(target.platform_fallback, false);
  } finally {
    h.views.clear();
  }
});

test('read-only commands do not acquire mutation-target authority', () => {
  const h = harness();
  try {
    assert.equal(resolveExactNativeSupervisorMutationTarget({ action: 'CAPTURE', payload: {} }, h), null);
    assert.equal(resolveExactNativeSupervisorMutationTarget({ action: 'PROCESS_CENSUS', payload: {} }, h), null);
  } finally {
    h.views.clear();
  }
});

test('WebContents replacement invalidates an admitted mutation target by generation', () => {
  const h = harness();
  try {
    const target = resolveExactNativeSupervisorMutationTarget({ action: 'NAVIGATE', payload: { tab_id: TAB_A } }, h);
    const replacement = webContents(499);
    h.views.set(TAB_A, { webContents: replacement });
    assert.throws(
      () => assertExactNativeSupervisorMutationTargetCurrent(target, h),
      /native_supervisor_exact_target_generation_mismatch/,
    );
  } finally {
    h.views.clear();
  }
});

test('main mutation path uses exact target helper and keeps platform fallback read-only', () => {
  const source = fs.readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const mutationResolve = source.indexOf('resolveExactNativeSupervisorMutationTarget(command, { registry, views })');
  const semanticDispatch = source.indexOf('executeSemanticCommand(view.webContents, command)');
  assert.ok(mutationResolve > 0);
  assert.ok(semanticDispatch > mutationResolve);
  assert.match(source, /function targetTabForSupervisorRead\(command\)/);
  assert.doesNotMatch(source, /function targetTabForSupervisor\(command\)/);
  assert.match(source, /\['SELECT_TAB','CLOSE_TAB','NAVIGATE'\]/);
});
