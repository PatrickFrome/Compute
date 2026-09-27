import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ME2_PRIMARY_BROWSER_STATUS_HEIGHT,
  ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT,
  ME2_PRIMARY_BROWSER_TABSTRIP_HEIGHT,
  ME2_PRIMARY_BROWSER_URLBAR_HEIGHT,
  ME2_PRIMARY_PAGEBAR_HEIGHT,
  ME2_PRIMARY_PAGE_PADDING,
  ME2_PRIMARY_RUN_INSPECTOR_GAP,
  ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH,
  ME2_PRIMARY_RUN_INSPECTOR_WIDTH,
  ME2_PRIMARY_STATUSBAR_HEIGHT,
  ME2_PRIMARY_TOP_HEIGHT,
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');

const store = await read('../../me2-ui/src/components/me2/store.tsx');
const shell = await read('../../me2-ui/src/components/me2/shell/me2-shell.tsx');
const pagebar = await read('../../me2-ui/src/components/me2/shell/pagebar.tsx');
const topbar = await read('../../me2-ui/src/components/me2/shell/topbar.tsx');
const statusbar = await read('../../me2-ui/src/components/me2/shell/statusbar.tsx');
const palette = await read('../../me2-ui/src/components/me2/shell/command-palette.tsx');
const command = await read('../../me2-ui/src/components/me2/pages/command.tsx');
const browserPage = await read('../../me2-ui/src/components/me2/pages/browser.tsx');
const fleetPage = await read('../../me2-ui/src/components/me2/pages/fleet.tsx');
const observePage = await read('../../me2-ui/src/components/me2/pages/observe.tsx');
const systemSuite = await read('../../me2-ui/src/components/me2/pages/system-suite.tsx');
const moduleSuite = await read('../../me2-ui/src/components/me2/pages/module-suite.tsx');
const main = await read('../src/main.mjs');
const visualHarness = await read('./me2-r85-visual-evidence.mjs');

const WORKFLOW_PAGES = ['command', 'plan', 'build', 'run', 'fleet', 'observe', 'system'];
const LEGACY_ALIASES = {
  agents: 'fleet', browser: 'run', code: 'build', tasks: 'plan',
  supervisor: 'fleet', compute: 'system', memory: 'observe', observability: 'observe',
};

test('R95 store declares seven workflow Pages in production-loop order with legacy alias migration', () => {
  for (const key of WORKFLOW_PAGES) {
    assert.match(store, new RegExp(`\\{ key: "${key}", label: "[A-Z]+", num: "\\d+" \\}`));
  }
  // exact order: COMMAND → PLAN → BUILD → RUN → FLEET → OBSERVE → SYSTEM
  const order = [...store.matchAll(/\{ key: "(\w+)", label: "[A-Z]+", num: "\d" \}/g)].map((m) => m[1]);
  assert.deepEqual(order, WORKFLOW_PAGES);
  // every legacy module key migrates onto its workflow host
  for (const [legacy, host] of Object.entries(LEGACY_ALIASES)) {
    assert.match(store, new RegExp(`${legacy}: "${host}"`));
  }
  assert.match(store, /export function normalizePageKey/);
  assert.match(store, /normalizePageKey\(h\) \?\? normalizePageKey\(stored\)/);
  assert.match(store, /const page = normalizePageKey\(p\.key\)/);
  // ModuleKey union keeps all ten legacy surfaces
  for (const key of ['command', 'agents', 'browser', 'code', 'tasks', 'supervisor', 'compute', 'memory', 'observability', 'system']) {
    assert.match(store, new RegExp(`\\| "${key}"`));
  }
});

test('R95 module hosting keeps all ten legacy module surfaces alive', () => {
  assert.match(store, /fleet: \["agents", "supervisor"\]/);
  assert.match(store, /observe: \["observability", "memory"\]/);
  assert.match(store, /system: \["system", "compute"\]/);
  assert.match(store, /plan: \["tasks"\]/);
  assert.match(store, /build: \["code"\]/);
  assert.match(store, /run: \["browser"\]/);

  assert.match(shell, /case "plan": return <TasksPage \/>/);
  assert.match(shell, /case "build": return <CodePage \/>/);
  assert.match(shell, /case "run": return <BrowserPage \/>/);
  assert.match(shell, /case "fleet": return <FleetPage \/>/);
  assert.match(shell, /case "observe": return <ObservePage \/>/);
  assert.match(shell, /case "system": return <SystemSuitePage \/>/);

  assert.match(fleetPage, /<AgentsPage \/>/);
  assert.match(fleetPage, /<SupervisorPage \/>/);
  assert.match(observePage, /<ObservabilityPage \/>/);
  assert.match(observePage, /<MemoryPage \/>/);
  assert.match(systemSuite, /<SystemPage \/>/);
  assert.match(systemSuite, /<ComputePage \/>/);

  // closed module surfaces are not mounted (semantic tree stays honest)
  assert.match(moduleSuite, /\{current\?\.content\}/);
  assert.doesNotMatch(moduleSuite, /modules\.map\(\(m\) => m\.content/);
  // module selection persists and restores only after hydration
  assert.match(moduleSuite, /localStorage\.setItem\(storageKey, m\.key\)/);
  assert.match(moduleSuite, /useEffect\(/);
});

test('R95 COMMAND is a mission control stage, not a browser host', () => {
  assert.match(command, /data-testid="page-command"/);
  assert.match(command, /data-testid="mission-objective-card"/);
  assert.match(command, /data-testid="mission-active-work"/);
  assert.match(command, /data-testid="mission-attention"/);
  assert.match(command, /data-testid="mission-outcomes"/);
  assert.match(command, /data-testid="mission-offline-banner"/);
  assert.doesNotMatch(command, /BrowserStage/);
  // read-only + navigation intents only: no authority lanes in mission stage
  assert.doesNotMatch(command, /sendCommand\(|BUDGET_FLUSH|ENVIRONMENT_RESET/);
});

test('R95 R93 session-selection contracts survive the mission-control rebuild', () => {
  assert.match(command, /selectPrimaryAgentSession\(s\.id\)/);
  assert.doesNotMatch(command, /BROWSER_SELECT_TAB/);
  assert.doesNotMatch(command, /loadBrowserTabs/);
  assert.doesNotMatch(command, /resolveExactAgentTab/);
  assert.match(command, /type="button"\s+aria-current=\{chatId === s\.id\}/);
  assert.match(command, /aria-label=\{\`Открыть вкладку z\.ai агента/);
  assert.match(command, /useAgentChatSessions/);
  assert.doesNotMatch(command, /setInterval\([^\n]*agentchat/);
});

test('R95 native surface follows RUN and legacy page keys normalize onto hosts', () => {
  assert.match(main, /new Set\(\['command','plan','build','run','fleet','observe','system'\]\)/);
  for (const [legacy, host] of Object.entries(LEGACY_ALIASES)) {
    assert.match(main, new RegExp(`\\['${legacy}', '${host}'\\]`));
  }
  assert.match(main, /ME2_PRIMARY_PAGE_ALIASES\.get\(requested\)/);
  assert.match(main, /primaryShellPage === 'run'\s*&& primaryShellOverlayActive !== true/);
  assert.match(main, /primaryShellPage === 'run'\s*\n\s*\?\s*'ME2_R95_RUN'/);
  assert.doesNotMatch(main, /primaryShellPage === 'command'/);
  // visual evidence harness models the same truth
  assert.match(visualHarness, /native_browser_surface_visible: !overlay && page === 'run'/);
});

test('R95 ME2_R95_RUN geometry reserves exact RUN chrome and degrades the inspector first', () => {
  const top = ME2_PRIMARY_TOP_HEIGHT + ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT
    + ME2_PRIMARY_BROWSER_TABSTRIP_HEIGHT + ME2_PRIMARY_BROWSER_URLBAR_HEIGHT;
  const baseBottom = ME2_PRIMARY_PAGEBAR_HEIGHT + ME2_PRIMARY_STATUSBAR_HEIGHT
    + ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_BROWSER_STATUS_HEIGHT;
  assert.equal(top, 144);

  const plan = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
    me2_context_drawer_height: 200,
  });
  assert.equal(plan.surface_profile, 'ME2_R95_RUN');
  assert.equal(plan.remote_bounds.x, ME2_PRIMARY_PAGE_PADDING);
  assert.equal(plan.remote_bounds.width, 1440 - ME2_PRIMARY_PAGE_PADDING - (ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_RUN_INSPECTOR_WIDTH + ME2_PRIMARY_RUN_INSPECTOR_GAP));
  assert.equal(plan.remote_bounds.y, top);
  assert.equal(plan.reserved_bottom_height, baseBottom + 200);
  assert.equal(plan.remote_bounds.height, 960 - top - baseBottom - 200);
  assert.equal(plan.me2_context_drawer_effective_open, true);
  assert.equal(plan.me2_context_drawer_height, 200);
  assert.equal(plan.authority_effect, false);

  // inspector release before the active surface (window fits the breakpoint but not the inspector)
  const released = planShellLayout({
    width: 1100,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
  });
  assert.ok(1100 >= ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH);
  assert.ok(1100 - ME2_PRIMARY_PAGE_PADDING * 2 - (ME2_PRIMARY_RUN_INSPECTOR_WIDTH + ME2_PRIMARY_RUN_INSPECTOR_GAP) < SHELL_MIN_REMOTE_WIDTH);
  assert.ok(released.adaptations.includes('ME2_RUN_INSPECTOR_RELEASED_FOR_ACTIVE_SURFACE'));
  assert.equal(released.remote_bounds.width, 1100 - ME2_PRIMARY_PAGE_PADDING * 2);

  // drawer closes when the Browser minimum height would be violated
  const clamped = planShellLayout({
    width: 1440,
    height: 560,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R95_RUN',
    me2_context_drawer_open: true,
    me2_context_drawer_height: 200,
  });
  assert.ok(clamped.adaptations.includes('ME2_CONTEXT_DRAWER_CLOSED_FOR_ACTIVE_SURFACE'));
  assert.equal(clamped.me2_context_drawer_effective_open, false);
  assert.equal(clamped.remote_bounds.height, 560 - top - baseBottom);
  assert.ok(clamped.remote_bounds.height >= 320);
});

test('R95 navigation chrome routes to workflow pages and hosts module tabs', () => {
  for (const key of WORKFLOW_PAGES) {
    assert.match(pagebar, new RegExp(`data-testid=\\{?\\\`page-tab-\\\$\{p\\.key\\\}\\\`\\}?`));
  }
  assert.match(pagebar, /Alt\+1…7/);
  assert.match(palette, /Pages · Alt\+1\.\.7/);
  for (const key of WORKFLOW_PAGES) {
    assert.match(palette, new RegExp(`${key}: \\{ icon: LucideIcon|${key}: \\{ icon:`));
  }
  // attention routes land on workflow hosts
  assert.match(topbar, /page: "observe" as const/);
  assert.match(topbar, /page: "plan" as const/);
  assert.match(topbar, /page: "system" as const/);
  assert.doesNotMatch(topbar, /page: "observability" as const|page: "tasks" as const|page: "compute" as const/);
  assert.match(statusbar, /setPage\("observe"\)/);
  assert.match(statusbar, /setPage\("plan"\)/);
  assert.match(statusbar, /setPage\("fleet"\)/);
  assert.doesNotMatch(statusbar, /setPage\("observability"\)|setPage\("tasks"\)|setPage\("agents"\)/);
  // drawer native sync only matters where native pixels live (RUN)
  assert.match(store, /if \(request\.page !== "run"\)/);
  assert.match(topbar, /page === "run"/);
});

test('R95 workspaces map onto workflow stages', () => {
  assert.match(store, /"development", label: "Development", page: "command"/);
  assert.match(store, /"browser-ops", label: "Browser Ops", page: "run"/);
  assert.match(store, /"debugging", label: "Debugging", page: "build"/);
  assert.match(store, /"monitoring", label: "Monitoring", page: "observe"/);
  assert.match(store, /"supervise", label: "Supervisor", page: "fleet"/);
});
