import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT,
  ME2_PRIMARY_CONTEXT_DRAWER_WIDTH,
  ME2_PRIMARY_PAGE_PADDING,
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');
const shell = await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../../me2-ui/src/components/me2/shell/context-drawer.tsx', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const visualHarness = await readFile(new URL('./me2-r85-visual-evidence.mjs', import.meta.url), 'utf8');

test('R95 bottom Utility Panel preserves the proven R85 native height reservation', () => {
  const plan = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'BOTTOM',
    me2_context_drawer_height: ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT,
  });
  assert.equal(plan.me2_context_drawer_requested_dock, 'BOTTOM');
  assert.equal(plan.me2_context_drawer_effective_dock, 'BOTTOM');
  assert.equal(plan.me2_context_drawer_effective_open, true);
  assert.equal(plan.me2_context_drawer_height, ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT);
  assert.equal(plan.me2_context_drawer_width, 0);
  assert.ok(plan.remote_bounds.height >= 320);
  assert.equal(plan.overlay_remote_content, false);
  assert.equal(plan.authority_effect, false);
});

test('R95 right Utility Panel reserves native width instead of overlaying Browser pixels', () => {
  const closed = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_context_drawer_open: false,
  });
  const right = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'RIGHT',
    me2_context_drawer_width: ME2_PRIMARY_CONTEXT_DRAWER_WIDTH,
  });
  assert.equal(right.me2_context_drawer_requested_dock, 'RIGHT');
  assert.equal(right.me2_context_drawer_effective_dock, 'RIGHT');
  assert.equal(right.me2_context_drawer_effective_open, true);
  assert.equal(right.me2_context_drawer_width, ME2_PRIMARY_CONTEXT_DRAWER_WIDTH);
  assert.equal(right.me2_context_drawer_height, 0);
  assert.equal(right.remote_bounds.width, closed.remote_bounds.width - ME2_PRIMARY_CONTEXT_DRAWER_WIDTH);
  assert.equal(right.reserved_bottom_height, closed.reserved_bottom_height);
  assert.ok(right.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(right.overlay_remote_content, false);
});

test('R95 right Utility Panel fails closed before starving the active native Browser surface', () => {
  const constrained = planShellLayout({
    width: 1100,
    height: 800,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_context_drawer_open: true,
    me2_context_drawer_dock: 'RIGHT',
    me2_context_drawer_width: 380,
  });
  assert.equal(constrained.me2_context_drawer_effective_open, false);
  assert.equal(constrained.me2_context_drawer_width, 0);
  assert.ok(constrained.adaptations.includes('ME2_CONTEXT_DRAWER_CLOSED_FOR_ACTIVE_SURFACE'));
  assert.ok(constrained.remote_bounds.width >= Math.min(SHELL_MIN_REMOTE_WIDTH, 1100));
  assert.equal(constrained.remote_bounds.x >= ME2_PRIMARY_PAGE_PADDING, true);
});

test('R95 workspace persistence stores dock and both independent dimensions', () => {
  assert.match(store, /drawerDock: ContextDrawerDock/);
  assert.match(store, /drawerWidth: number/);
  assert.match(store, /drawerHeight: number/);
  assert.match(store, /writeWorkspaceLayout\(get\(\)\.workspace, \{ drawerDock: dock \}\)/);
  assert.match(store, /writeWorkspaceLayout\(get\(\)\.workspace, \{ drawerWidth: wantedWidth \}\)/);
  assert.match(store, /drawerDock: row\.drawerDock === "right" \? "right" : "bottom"/);
});

test('R97 keeps Utility Panel implementation available but unmounted from the persistent Chat Fleet shell', () => {
  assert.doesNotMatch(shell, /<ContextDrawer \/>/);
  assert.match(shell, /case "observability": return <ObservabilityPage \/>/);
  assert.match(shell, /case "system": return <SystemPage \/>/);
  assert.match(panel, /aria-label="Utility Panel"/);
  assert.match(panel, /data-drawer-dock=\{dock\}/);
  assert.match(panel, /data-testid="utility-panel-dock-bottom"/);
  assert.match(panel, /data-testid="utility-panel-dock-right"/);
});

test('R95 right dock lays panel body beside the full-height splitter instead of behind it', () => {
  assert.match(panel, /dock === "right" \? "flex-row border-l border-zinc-800"/);
  assert.match(panel, /data-testid="utility-panel-body"/);
  assert.match(panel, /flex min-h-0 min-w-0 flex-1 flex-col/);
});

test('R95 splitter follows WAI window-splitter direction semantics for both dock orientations', () => {
  assert.match(panel, /role="separator"/);
  assert.match(panel, /aria-orientation=\{dock === "right" \? "vertical" : "horizontal"\}/);
  assert.match(panel, /event\.key === "ArrowLeft"/);
  assert.match(panel, /event\.key === "ArrowRight"/);
  assert.match(panel, /event\.key === "ArrowUp"/);
  assert.match(panel, /event\.key === "ArrowDown"/);
  assert.match(panel, /event\.key === "Home"/);
  assert.match(panel, /event\.key === "End"/);
});

test('R95 Browser-owned bridge remains narrow presentation-only geometry synchronization', () => {
  assert.match(preload, /const setPrimaryContextDrawer = \(open, dock, height, width\)/);
  assert.match(main, /schema: 'metaengine\.browser\.me2-primary-context-drawer\.v3'/);
  assert.match(main, /primary_shell_context_drawer_dock_invalid/);
  assert.match(main, /presentation_only:\s*true/);
  assert.match(main, /browser_command_authority:\s*false/);
  assert.match(main, /scheduler_authority:\s*false/);
  assert.match(main, /authority_effect:\s*false/);
});


test('R97 physical visual harness proves advanced surfaces leave the persistent Chat Fleet workspace', () => {
  assert.match(visualHarness, /r97-chat-fleet-main-1440x960/);
  assert.match(visualHarness, /r97-settings-advanced-surface-1440x960/);
  assert.match(visualHarness, /r97-command-search-1440x960/);
  assert.match(visualHarness, /context_drawer_present/);
  assert.match(visualHarness, /run_inspector_present/);
  assert.match(visualHarness, /r97_visual_legacy_persistent_chrome_present/);
});


test('R97 main Chat Fleet geometry suppresses Utility Panel requests instead of shrinking the native site', () => {
  for (const dock of ['RIGHT', 'BOTTOM']) {
    const plan = planShellLayout({
      width: 1440,
      height: 960,
      state: normalizeShellLayoutState(),
      surface_profile: 'ME2_R95_RUN',
      me2_context_drawer_open: true,
      me2_context_drawer_dock: dock,
      me2_context_drawer_width: 380,
      me2_context_drawer_height: 200,
    });
    assert.equal(plan.surface_profile, 'ME2_R95_RUN');
    assert.equal(plan.me2_context_drawer_effective_open, false);
    assert.equal(plan.me2_run_inspector_effective_visible, false);
    assert.ok(plan.adaptations.includes('ME2_ADVANCED_DRAWER_HIDDEN_ON_CHAT_FLEET_MAIN'));
    assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
    assert.equal(plan.overlay_remote_content, false);
  }
});

test('R95C native Utility sync runs only on RUN and waits for the primary-page acknowledgement', () => {
  assert.match(store, /if \(request\.page !== "browser"\)/);
  const setPageStart = store.indexOf('setPage: (p) => {');
  const setPageEnd = store.indexOf('setWorkspace: (w) => {', setPageStart);
  const setPageBlock = store.slice(setPageStart, setPageEnd);
  assert.match(setPageBlock, /if \(nextPage === "browser"\)/);
  assert.match(setPageBlock, /primaryPageAck\.then\(reconcileRunGeometry\)/);
  assert.match(setPageBlock, /if \(get\(\)\.page === "browser"\) get\(\)\.syncContextDrawer\(\)/);
  assert.doesNotMatch(store, /if \(request\.page !== "command"\)/);
  assert.match(main, /primaryShellPage === 'browser' && primaryShellOverlayActive !== true/);
  assert.match(main, /primaryShellPage === 'browser'[\s\S]{0,120}\? 'ME2_R95_RUN'/);
});

test('R95C splitter Escape-cancel and double-click reset are fenced across both dock axes', () => {
  assert.match(panel, /const restore = \(\) => \{/);
  assert.match(panel, /const cancel = restore/);
  assert.match(panel, /window\.addEventListener\("keydown", onKey\)/);
  assert.match(panel, /if \(keyEvent\.key !== "Escape"\) return/);
  assert.match(panel, /onDoubleClick=\{resetByDoubleTap\}/);
  assert.match(panel, /state\.workspace !== workspace \|\| state\.contextDrawerDock !== dock/);
  assert.match(panel, /setWidth\(preferredWidth, true\)/);
  assert.match(panel, /setHeight\(preferredHeight, true\)/);
  assert.match(panel, /before:-inset-x-1\.5/);
  assert.match(panel, /before:-inset-y-1\.5/);
  assert.match(panel, /group-focus-visible:bg-cyan-500/);
});
