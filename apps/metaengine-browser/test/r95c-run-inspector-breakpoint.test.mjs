import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ME2_PRIMARY_PAGE_PADDING,
  ME2_PRIMARY_RUN_INSPECTOR_GAP,
  ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH,
  ME2_PRIMARY_RUN_INSPECTOR_WIDTH,
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const browserPage = await read('../../me2-ui/src/components/me2/pages/browser.tsx');
const store = await read('../../me2-ui/src/components/me2/store.tsx');
const main = await read('../src/main.mjs');
const visualHarness = await read('./me2-r85-visual-evidence.mjs');

test('R95C.2 native layout is the single authority for RUN telemetry visibility', () => {
  assert.equal(ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH, 1124);

  const narrow = planShellLayout({
    width: 1100,
    height: 900,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: false,
  });
  assert.equal(narrow.me2_run_inspector_effective_visible, false);
  assert.equal(narrow.remote_bounds.x, ME2_PRIMARY_PAGE_PADDING);
  assert.equal(narrow.remote_bounds.width, 1100 - (ME2_PRIMARY_PAGE_PADDING * 2));
  assert.ok(narrow.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);

  const exact = planShellLayout({
    width: 1124,
    height: 900,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: false,
  });
  const reservedRight = ME2_PRIMARY_PAGE_PADDING
    + ME2_PRIMARY_RUN_INSPECTOR_WIDTH
    + ME2_PRIMARY_RUN_INSPECTOR_GAP;
  assert.equal(exact.me2_run_inspector_effective_visible, true);
  assert.equal(exact.remote_bounds.width, 1124 - ME2_PRIMARY_PAGE_PADDING - reservedRight);
  assert.ok(exact.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(exact.overlay_remote_content, false);
});

test('R95C.2 requested Right Utility Panel suppresses telemetry before native Browser width', () => {
  const plan = planShellLayout({
    width: 1400,
    height: 900,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'RIGHT',
    me2_context_drawer_width: 380,
  });
  assert.equal(plan.me2_context_drawer_effective_open, true);
  assert.equal(plan.me2_run_inspector_effective_visible, false);
  assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.ok(plan.adaptations.includes('ME2_RUN_INSPECTOR_RELEASED_FOR_UTILITY_PANEL'));
});

test('R95C.2 IPC readback carries native telemetry decision without authority widening', () => {
  assert.match(main, /run_inspector_visible: shellLayoutPlan\?\.me2_run_inspector_effective_visible === true/);
  const handlerStart = main.indexOf("ipcMain.handle('metaengine:shell:primary-context-drawer'");
  const handlerEnd = main.indexOf("ipcMain.handle('metaengine:shell:primary-agent-session-select'", handlerStart);
  const handler = main.slice(handlerStart, handlerEnd);
  assert.match(handler, /presentation_only:\s*true/);
  assert.match(handler, /browser_command_authority:\s*false/);
  assert.match(handler, /update_authority:\s*false/);
  assert.match(handler, /release_authority:\s*false/);
  assert.match(handler, /authority_effect:\s*false/);
});

test('R95C.2 renderer consumes native visibility readback instead of owning a media breakpoint', () => {
  assert.match(store, /runTelemetryInspectorVisible: boolean/);
  assert.match(store, /run_inspector_visible\?: boolean/);
  assert.match(store, /runTelemetryInspectorVisible: result\?\.run_inspector_visible === true/);
  assert.match(store, /runTelemetryInspectorVisible: false/);
  assert.match(browserPage, /const telemetryInspectorVisible = useMe2/);
  assert.match(browserPage, /data-inspector-visible=\{telemetryInspectorVisible \? "true" : "false"\}/);
  assert.doesNotMatch(browserPage, /min-\[1124px\]:flex|\blg:flex\b|\bxl:flex\b/);
  assert.doesNotMatch(browserPage, /utilityRightOpen/);
});


test('R95C.2 RUN geometry readback is causally ordered after the primary-page IPC acknowledgement', () => {
  assert.match(store, /function syncPagePresentation\(p: PageKey\): Promise<unknown> \| null/);
  assert.match(store, /primaryPageAck = Promise\.resolve\(result\)/);
  assert.match(store, /return primaryPageAck/);

  const setPageStart = store.indexOf('setPage: (p) => {');
  const setPageEnd = store.indexOf('setWorkspace: (w) => {', setPageStart);
  const setPageBlock = store.slice(setPageStart, setPageEnd);
  const invokeAt = setPageBlock.indexOf('const primaryPageAck = syncPagePresentation(p)');
  const awaitAt = setPageBlock.indexOf('primaryPageAck.then(reconcileRunGeometry)');
  const geometryAt = setPageBlock.indexOf('get().syncContextDrawer()');
  assert.ok(invokeAt >= 0 && awaitAt > invokeAt && geometryAt > invokeAt);
  assert.ok(setPageBlock.indexOf('reconcileRunGeometry', invokeAt) >= 0);
  assert.match(setPageBlock, /if \(get\(\)\.page === "browser"\)/);

  const restoreStart = store.indexOf('const restoredPage: PageKey');
  const restoreEnd = store.indexOf('// WS-шина', restoreStart);
  const restoreBlock = store.slice(restoreStart, restoreEnd);
  assert.match(restoreBlock, /const primaryPageAck = syncPagePresentation\(restoredPage\)/);
  assert.match(restoreBlock, /restoredPage === "browser" && primaryPageAck/);
  assert.match(restoreBlock, /primaryPageAck\.then\(reconcileRestoredGeometry\)/);
});


test('R95C.2 physical visual harness exercises the Main-to-renderer telemetry decision', () => {
  assert.match(visualHarness, /run_inspector_visible: page === 'browser'/);
  assert.match(visualHarness, /run_telemetry_inspector: rect\('run-telemetry-inspector'\)/);
  assert.match(visualHarness, /r95c2_visual_native_readback_telemetry_missing/);
  assert.match(visualHarness, /r95c2_visual_right_utility_must_release_telemetry/);
});


test('R95C.2 history navigation advances the geometry generation before an ABA return to RUN', () => {
  const historyStart = store.indexOf('const target = st.recentPages[nextIndex]');
  const historyEnd = store.indexOf('// Electron-мост', historyStart);
  const historyBlock = store.slice(historyStart, historyEnd);
  const targetAt = historyBlock.indexOf('const target = st.recentPages[nextIndex]');
  const generationAt = historyBlock.indexOf('contextDrawerSyncSeq += 1');
  const pageSetAt = historyBlock.indexOf('set({ page: target, pageHistoryIndex: nextIndex })');
  const pageAckAt = historyBlock.indexOf('syncPagePresentation(target)');
  assert.ok(targetAt >= 0 && generationAt > targetAt && pageSetAt > generationAt && pageAckAt > pageSetAt);
  assert.match(historyBlock, /old[\s\S]{0,80}RUN geometry reply pass the page\/workspace ABA fence/);
});


test('R95C.2 physical harness cannot let last-window cleanup mask a failing assertion as exit zero', () => {
  assert.match(visualHarness, /app\.on\('window-all-closed', \(\) => \{\}\)/);
  const cleanupAt = visualHarness.indexOf('windowRef.destroy()');
  const catchAt = visualHarness.indexOf('main().catch(async (error) =>');
  assert.ok(cleanupAt >= 0 && catchAt > cleanupAt);
  assert.match(visualHarness, /phase: visualPhase/);
  assert.match(visualHarness, /r85-visual-failure\.json/);
  assert.match(visualHarness, /app\.exit\(1\)/);
});


test('R95C.2 physical visibility proof distinguishes a hidden mounted telemetry node from rendered pixels', () => {
  assert.match(visualHarness, /const visibleRect = \(id\) =>/);
  assert.match(visualHarness, /el\.getClientRects\(\)\.length === 0/);
  assert.match(visualHarness, /run_telemetry_inspector: visibleRect\('run-telemetry-inspector'\)/);
  assert.match(visualHarness, /run_telemetry_inspector_dom_present/);
  assert.match(visualHarness, /data-inspector-visible/);
});

test('R95C.2 Right Utility capture waits for asynchronous native readback convergence', () => {
  const dockAt = visualHarness.indexOf("data-drawer-dock') === 'right'");
  const readbackAt = visualHarness.indexOf("data-inspector-visible') === 'false'", dockAt);
  const captureAt = visualHarness.indexOf("r95c-run-utility-right-1440x960", readbackAt);
  assert.ok(dockAt >= 0 && readbackAt > dockAt && captureAt > readbackAt);
});
