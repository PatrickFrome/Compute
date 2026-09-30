import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ME2_PRIMARY_CHAT_FLEET_RAIL_WIDTH,
  ME2_PRIMARY_TOP_HEIGHT,
  ME2_PRIMARY_GOAL_HEIGHT,
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const store = await read('../../me2-ui/src/components/me2/store.tsx');
const shell = await read('../../me2-ui/src/components/me2/shell/me2-shell.tsx');
const main = await read('../src/main.mjs');
const visualHarness = await read('./me2-r85-visual-evidence.mjs');

test('R97 native layout is the single authority and never reserves persistent RUN inspector space', () => {
  for (const width of [1000, 1124, 1440, 1800]) {
    const plan = planShellLayout({
      width,
      height: 900,
      state: normalizeShellLayoutState(),
      surface_profile: 'ME2_R95_RUN',
      me2_context_drawer_open: false,
    });
    assert.equal(plan.me2_run_inspector_effective_visible, false);
    assert.equal(plan.me2_context_drawer_effective_open, false);
    assert.ok(plan.remote_bounds.width >= Math.min(SHELL_MIN_REMOTE_WIDTH, width));
    assert.equal(plan.remote_bounds.y, ME2_PRIMARY_TOP_HEIGHT + ME2_PRIMARY_GOAL_HEIGHT);
    if (width >= ME2_PRIMARY_CHAT_FLEET_RAIL_WIDTH + SHELL_MIN_REMOTE_WIDTH) {
      assert.equal(plan.remote_bounds.x, ME2_PRIMARY_CHAT_FLEET_RAIL_WIDTH);
    }
    assert.equal(plan.overlay_remote_content, false);
  }
});

test('R97 requested Utility Panel cannot displace native Browser pixels in the main workspace', () => {
  const plan = planShellLayout({
    width: 1400,
    height: 900,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'RIGHT',
    me2_context_drawer_width: 380,
  });
  assert.equal(plan.me2_context_drawer_effective_open, false);
  assert.equal(plan.me2_run_inspector_effective_visible, false);
  assert.ok(plan.adaptations.includes('ME2_ADVANCED_DRAWER_HIDDEN_ON_CHAT_FLEET_MAIN'));
  assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
});

test('R97 IPC readback carries native telemetry decision without authority widening', () => {
  assert.match(main, /run_inspector_visible: shellLayoutPlan\?\.me2_run_inspector_effective_visible === true/);
  const handlerStart = main.indexOf("ipcMain.handle('metaengine:shell:primary-context-drawer'");
  const handlerEnd = main.indexOf("ipcMain.handle('metaengine:shell:primary-chat-fleet-roster'", handlerStart);
  const handler = main.slice(handlerStart, handlerEnd);
  assert.match(handler, /presentation_only:\s*true/);
  assert.match(handler, /browser_command_authority:\s*false/);
  assert.match(handler, /update_authority:\s*false/);
  assert.match(handler, /release_authority:\s*false/);
  assert.match(handler, /authority_effect:\s*false/);
});

test('R108 native telemetry readback survives physical removal of the daemon Browser page', () => {
  assert.match(store, /runTelemetryInspectorVisible: boolean/);
  assert.match(store, /run_inspector_visible\?: boolean/);
  assert.match(store, /runTelemetryInspectorVisible: result\?\.run_inspector_visible === true/);
  assert.equal(fs.existsSync(new URL('../../me2-ui/src/components/me2/pages/browser.tsx', import.meta.url)), false);
  assert.doesNotMatch(shell, /BrowserPage|pages\/browser|run-telemetry-inspector/);
  assert.match(shell, /data-testid="native-chat-surface-slot"/);
});

test('R97 physical visual harness proves no persistent RUN inspector or Context Drawer', () => {
  assert.match(visualHarness, /run_inspector_present/);
  assert.match(visualHarness, /context_drawer_present/);
  assert.match(visualHarness, /r97_visual_legacy_persistent_chrome_present/);
  assert.match(visualHarness, /r97-chat-fleet-main-1440x960/);
  assert.match(visualHarness, /r97-settings-advanced-surface-1440x960/);
});

test('R97 physical harness cannot let window cleanup mask a failing assertion as exit zero', () => {
  assert.match(visualHarness, /app\.on\('window-all-closed', \(\) => \{\}\)/);
  const cleanupAt = visualHarness.indexOf('windowRef.destroy()');
  const catchAt = visualHarness.indexOf('main().then(() => app.exit(0)).catch');
  assert.ok(cleanupAt >= 0 && catchAt > cleanupAt);
  assert.match(visualHarness, /phase,/);
  assert.match(visualHarness, /app\.exit\(1\)/);
});
