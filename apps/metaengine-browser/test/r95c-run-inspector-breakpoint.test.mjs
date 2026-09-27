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

const browserPage = await readFile(
  new URL('../../me2-ui/src/components/me2/pages/browser.tsx', import.meta.url),
  'utf8',
);

test('R95C renderer and main process share one exact RUN telemetry breakpoint', () => {
  assert.equal(ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH, 1280);
  assert.match(browserPage, /overflow-y-auto xl:flex/);
  assert.doesNotMatch(browserPage, /overflow-y-auto lg:flex/);
});

test('R95C 1100px RUN never releases a renderer-visible inspector over native Browser pixels', () => {
  const plan = planShellLayout({
    width: 1100,
    height: 900,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: false,
  });
  assert.equal(1100 < ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH, true);
  assert.equal(plan.remote_bounds.x, ME2_PRIMARY_PAGE_PADDING);
  assert.equal(plan.remote_bounds.width, 1100 - (ME2_PRIMARY_PAGE_PADDING * 2));
  assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(plan.overlay_remote_content, false);
});

test('R95C xl RUN reserves exactly the renderer telemetry width plus gap', () => {
  const plan = planShellLayout({
    width: 1280,
    height: 900,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: false,
  });
  const reservedRight = ME2_PRIMARY_PAGE_PADDING
    + ME2_PRIMARY_RUN_INSPECTOR_WIDTH
    + ME2_PRIMARY_RUN_INSPECTOR_GAP;
  assert.equal(plan.remote_bounds.width, 1280 - ME2_PRIMARY_PAGE_PADDING - reservedRight);
  assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(plan.overlay_remote_content, false);
});

test('R95C Right Utility Panel can use sub-xl width only because renderer telemetry is also absent', () => {
  const plan = planShellLayout({
    width: 1100,
    height: 900,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'RIGHT',
    me2_context_drawer_width: 380,
  });
  assert.equal(plan.me2_context_drawer_effective_open, true);
  assert.ok(plan.me2_context_drawer_width >= 320);
  assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.match(browserPage, /utilityRightOpen \? "hidden"/);
});
