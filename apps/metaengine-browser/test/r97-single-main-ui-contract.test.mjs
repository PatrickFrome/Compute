import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  ME2_PRIMARY_CHAT_FLEET_RAIL_WIDTH,
  ME2_PRIMARY_TOP_HEIGHT,
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = await fs.readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const shell = await fs.readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8');
const topbar = await fs.readFile(new URL('../../me2-ui/src/components/me2/shell/topbar.tsx', import.meta.url), 'utf8');
const palette = await fs.readFile(new URL('../../me2-ui/src/components/me2/shell/command-palette.tsx', import.meta.url), 'utf8');
const store = await fs.readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');
const settings = await fs.readFile(new URL('../../me2-ui/src/components/me2/pages/system.tsx', import.meta.url), 'utf8');
const legacyApp = await fs.readFile(new URL('../ui/app.js', import.meta.url), 'utf8');

test('R97 primary geometry reserves only top bar plus chat fleet rail for one native site', () => {
  const plan = planShellLayout({
    width: 1440,
    height: 900,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
  });
  assert.equal(ME2_PRIMARY_CHAT_FLEET_RAIL_WIDTH, 288);
  assert.deepEqual(plan.remote_bounds, {
    x: ME2_PRIMARY_CHAT_FLEET_RAIL_WIDTH,
    y: ME2_PRIMARY_TOP_HEIGHT,
    width: 1440 - ME2_PRIMARY_CHAT_FLEET_RAIL_WIDTH,
    height: 900 - ME2_PRIMARY_TOP_HEIGHT,
  });
  assert.equal(plan.effective_sidebar, 'EXPANDED');
  assert.equal(plan.effective_operations, 'CLOSED');
  assert.equal(plan.me2_run_inspector_effective_visible, false);
  assert.equal(plan.me2_context_drawer_effective_open, false);
  assert.equal(plan.me2_chat_fleet_rail_effective_visible, true);
  assert.match(plan.adaptations.join(','), /ME2_ADVANCED_DRAWER_HIDDEN_ON_CHAT_FLEET_MAIN/);
});

test('R97 primary geometry hides rail before violating native site minimum width', () => {
  const width = ME2_PRIMARY_CHAT_FLEET_RAIL_WIDTH + SHELL_MIN_REMOTE_WIDTH - 1;
  const plan = planShellLayout({
    width,
    height: 720,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
  });
  assert.equal(plan.remote_bounds.x, 0);
  assert.equal(plan.remote_bounds.width, width);
  assert.equal(plan.effective_sidebar, 'HIDDEN');
  assert.equal(plan.me2_chat_fleet_rail_effective_visible, false);
  assert.match(plan.adaptations.join(','), /ME2_CHAT_FLEET_RAIL_HIDDEN_FOR_ACTIVE_SURFACE/);
});

test('R97 primary shell starts on chat fleet and verifies the new installed DOM contract', () => {
  assert.match(main, /let primaryShellPage = 'browser'/);
  assert.match(main, /primaryShellUrl = \x60\$\{gateway\.url\}\/\#browser\x60/);
  assert.match(main, /ME2_R97_DOM_IDS/);
  for (const id of ['primary-chat-fleet','chat-fleet-rail','global-cmdbar','settings-button']) {
    assert.match(main, new RegExp(id));
  }
  assert.match(main, /primaryChatFleetRoster/);
  assert.match(main, /selectPrimaryChatActor/);
  assert.match(main, /requested_layout: 'SINGLE'/);
});

test('R97 presentation bridge exposes bounded roster and exact actor selection without generic command authority', () => {
  assert.match(preload, /primaryChatFleetRoster/);
  assert.match(preload, /selectPrimaryChatActor/);
  assert.match(preload, /presentation_only:\s*true/);
  assert.match(preload, /browser_command_authority:\s*false/);
  assert.match(preload, /scheduler_authority:\s*false/);
});

test('R97 renderer keeps only chat fleet + native site persistent; advanced surfaces are settings/search only', () => {
  assert.match(shell, /data-testid="chat-fleet-rail"/);
  assert.match(shell, /data-testid=\{actor\.actor_type === "SUPERVISOR" \? "chat-supervisor-row" : "chat-agent-row"\}/);
  assert.match(shell, /data-testid="native-chat-surface-slot"/);
  assert.match(shell, /data-testid="chat-actor-short-id"/);
  assert.match(shell, /actor\.actor_id\.split\(":"\)\.at\(-1\)\?\.slice\(0, 18\)/);
  assert.match(shell, /primaryChatFleetRoster/);
  assert.match(shell, /selectPrimaryChatActor/);
  assert.doesNotMatch(shell, /useAgentChatSessions/);
  assert.doesNotMatch(shell, /<PageBar/);
  assert.doesNotMatch(shell, /<StatusBar/);
  assert.doesNotMatch(shell, /<ContextDrawer/);
  assert.doesNotMatch(shell, /<PeekInspector/);
  assert.match(topbar, /data-testid="global-cmdbar"/);
  assert.match(topbar, /data-testid="settings-button"/);
  assert.match(topbar, /setPage\("system"\)/);
  assert.match(store, /page: "browser"/);
  assert.match(store, /const restoredPage: PageKey = "browser"/);
});


test('R97 legacy fallback keeps chat-surface rendering callable', () => {
  assert.match(legacyApp, /isChatSurfaceTab\(row\.tab\)/);
  assert.doesNotMatch(legacyApp, /row\.isChatSurfaceTab\(tab\)/);
});


test('R97 Settings is the explicit directory for every hidden advanced surface', () => {
  assert.match(settings, /data-testid="settings-advanced-surfaces"/);
  for (const page of ['command','agents','code','tasks','supervisor','compute','memory','observability']) {
    assert.match(settings, new RegExp(`page: "${page}"`));
  }
  assert.match(settings, /data-testid=\{\`settings-open-\$\{surface\.page\}\`\}/);
  assert.match(settings, /setPage\(surface\.page\)/);
  assert.match(settings, /Hidden from the main Chat Fleet workspace/);
});


test('R97 command palette advertises search-only advanced navigation, never retired Alt routes', () => {
  assert.match(palette, /Advanced surfaces · search/);
  assert.doesNotMatch(palette, /Pages · Alt\+1\.\.0/);
  assert.doesNotMatch(palette, />Alt\+\{p\.num\}</);
  assert.match(palette, /onSelect=\{\(\) => \{ setPage\(p\.key\); setOpen\(false\); \}\}/);
});
