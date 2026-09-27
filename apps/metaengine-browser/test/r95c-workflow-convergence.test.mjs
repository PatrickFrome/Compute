import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ME2_PRIMARY_CONTEXT_DRAWER_WIDTH,
  ME2_PRIMARY_PAGE_PADDING,
  ME2_PRIMARY_RUN_INSPECTOR_GAP,
  ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH,
  ME2_PRIMARY_RUN_INSPECTOR_WIDTH,
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const store = await read('../../me2-ui/src/components/me2/store.tsx');
const command = await read('../../me2-ui/src/components/me2/pages/command.tsx');
const browserPage = await read('../../me2-ui/src/components/me2/pages/browser.tsx');
const main = await read('../src/main.mjs');
const harness = await read('./me2-r85-visual-evidence.mjs');

test('R95C reuses R94 stage mapping instead of rewriting the ten durable PageKeys', () => {
  assert.match(store, /run[^\n]+primaryPage: "browser"/);
  assert.match(store, /plan[^\n]+primaryPage: "tasks"/);
  assert.match(store, /observe[^\n]+primaryPage: "observability"/);
  assert.match(store, /fleet[^\n]+primaryPage: "agents"/);
  assert.match(store, /export type PageKey =[\s\S]{0,220}"command"[\s\S]{0,220}"browser"/);
  assert.doesNotMatch(store, /export type PageKey =[\s\S]{0,220}\| "run"/);
});

test('R95C COMMAND is mission control and owns no BrowserStage or effect path', () => {
  assert.match(command, /data-testid="page-command"/);
  assert.match(command, /data-testid="mission-objective-card"/);
  assert.match(command, /data-testid="mission-active-work"/);
  assert.match(command, /data-testid="mission-attention"/);
  assert.match(command, /data-testid="mission-outcomes"/);
  assert.doesNotMatch(command, /BrowserStage/);
  assert.doesNotMatch(command, /sendCommand\(|BUDGET_FLUSH|ENVIRONMENT_RESET/);
  assert.match(command, /setPage\("browser"\)/);
  assert.match(command, /setPage\("tasks"\)/);
  assert.match(command, /setPage\("observability"\)/);
  assert.doesNotMatch(command, /setPage\("(run|plan|observe|fleet)"\)/);
});

test('R95C legacy browser module is the compact RUN execution surface', () => {
  assert.match(browserPage, /data-testid="run-page-strip"/);
  assert.match(browserPage, /<BrowserStage compact defaultCastOn \/>/);
  assert.match(browserPage, /data-testid="run-telemetry-inspector"/);
  assert.match(browserPage, /xl:flex/);
});

test('R95C main process projects native Browser pixels only on legacy browser/RUN host', () => {
  assert.match(main, /primaryShellPage === 'browser'\s*&& primaryShellOverlayActive !== true/);
  assert.match(main, /primaryShellPage === 'browser'\s*\n\s*\? 'ME2_R95_RUN'/);
  assert.doesNotMatch(main, /primaryShellPage === 'command'\s*&& primaryShellOverlayActive !== true/);
  assert.match(store, /if \(request\.page !== "browser"\)/);
});

test('R95C RUN layout reserves the xl telemetry inspector before native Browser pixels', () => {
  assert.equal(ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH, 1280);
  const plan = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
  });
  const inspectorRight = ME2_PRIMARY_PAGE_PADDING
    + ME2_PRIMARY_RUN_INSPECTOR_WIDTH
    + ME2_PRIMARY_RUN_INSPECTOR_GAP;
  assert.equal(plan.remote_bounds.x, ME2_PRIMARY_PAGE_PADDING);
  assert.equal(plan.remote_bounds.width, 1440 - ME2_PRIMARY_PAGE_PADDING - inspectorRight);
  assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(plan.authority_effect, false);
  assert.equal(plan.overlay_remote_content, false);
});

test('R95C RUN Bottom Utility Panel preserves Browser width and reserves height', () => {
  const closed = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
  });
  const bottom = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'BOTTOM',
    me2_context_drawer_height: 200,
  });
  assert.equal(bottom.me2_context_drawer_effective_open, true);
  assert.equal(bottom.me2_context_drawer_effective_dock, 'BOTTOM');
  assert.equal(bottom.me2_context_drawer_height, 200);
  assert.equal(bottom.me2_context_drawer_width, 0);
  assert.equal(bottom.remote_bounds.width, closed.remote_bounds.width);
  assert.equal(bottom.remote_bounds.height, closed.remote_bounds.height - 200);
});

test('R95C RUN Right Utility Panel fails closed at 1440 when xl telemetry already owns the side region', () => {
  const right = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'RIGHT',
    me2_context_drawer_width: ME2_PRIMARY_CONTEXT_DRAWER_WIDTH,
  });
  assert.equal(right.me2_context_drawer_effective_open, false);
  assert.equal(right.me2_context_drawer_width, 0);
  assert.ok(right.adaptations.includes('ME2_CONTEXT_DRAWER_CLOSED_FOR_ACTIVE_SURFACE'));
  assert.ok(right.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
});

test('R95C RUN Right Utility Panel opens on a wide surface without overlapping telemetry or Browser', () => {
  const right = planShellLayout({
    width: 1680,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'RIGHT',
    me2_context_drawer_width: ME2_PRIMARY_CONTEXT_DRAWER_WIDTH,
  });
  assert.equal(right.me2_context_drawer_effective_open, true);
  assert.equal(right.me2_context_drawer_effective_dock, 'RIGHT');
  assert.equal(right.me2_context_drawer_width, ME2_PRIMARY_CONTEXT_DRAWER_WIDTH);
  assert.ok(right.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(right.overlay_remote_content, false);
});

test('R95C below xl renderer hides telemetry and Right Utility Panel may consume the freed region', () => {
  const right = planShellLayout({
    width: 1100,
    height: 900,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'RIGHT',
    me2_context_drawer_width: ME2_PRIMARY_CONTEXT_DRAWER_WIDTH,
  });
  assert.ok(1100 < ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH);
  assert.equal(right.me2_context_drawer_effective_open, true);
  assert.ok(right.me2_context_drawer_width >= 320);
  assert.ok(right.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
});

test('R95C physical visual harness proves COMMAND mission plus RUN Bottom/Right states', () => {
  assert.match(harness, /native_browser_surface_visible: !overlay && page === 'browser'/);
  assert.match(harness, /r95c-command-mission-1440x960/);
  assert.match(harness, /r95c-run-1440x960/);
  assert.match(harness, /r95c-run-utility-bottom-1440x960/);
  assert.match(harness, /r95c-run-utility-right-1680x960/);
  assert.match(harness, /command_mission_control_verified:\s*true/);
  assert.match(harness, /run_native_surface_host_verified:\s*true/);
});
