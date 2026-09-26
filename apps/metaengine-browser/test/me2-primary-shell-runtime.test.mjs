import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT,
  ME2_PRIMARY_COMMAND_GAP,
  ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH,
  ME2_PRIMARY_PAGEBAR_HEIGHT,
  ME2_PRIMARY_PAGE_PADDING,
  ME2_PRIMARY_STATUSBAR_HEIGHT,
  ME2_PRIMARY_TOP_HEIGHT,
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';
import { projectMe2UiRoutingAuthority } from '../src/me2/me2-ui-host.mjs';

const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');
const integration = await readFile(new URL('../src/me2/me2-integration-entry.mjs', import.meta.url), 'utf8');
const uiHost = await readFile(new URL('../src/me2/me2-ui-host.mjs', import.meta.url), 'utf8');
const me2Shell = await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8');
const me2Topbar = await readFile(new URL('../../me2-ui/src/components/me2/shell/topbar.tsx', import.meta.url), 'utf8');
const me2Pagebar = await readFile(new URL('../../me2-ui/src/components/me2/shell/pagebar.tsx', import.meta.url), 'utf8');
const me2Statusbar = await readFile(new URL('../../me2-ui/src/components/me2/shell/statusbar.tsx', import.meta.url), 'utf8');
const me2Palette = await readFile(new URL('../../me2-ui/src/components/me2/shell/command-palette.tsx', import.meta.url), 'utf8');
const me2Command = await readFile(new URL('../../me2-ui/src/components/me2/pages/command.tsx', import.meta.url), 'utf8');
const me2BrowserStage = await readFile(new URL('../../me2-ui/src/components/me2/stages/browser-stage.tsx', import.meta.url), 'utf8');
const me2Observability = await readFile(new URL('../../me2-ui/src/components/me2/pages/observability.tsx', import.meta.url), 'utf8');
const me2AgentChatFeed = await readFile(new URL('../../me2-ui/src/hooks/use-agentchat-sessions.ts', import.meta.url), 'utf8');
const me2CodePage = await readFile(new URL('../../me2-ui/src/components/me2/pages/code.tsx', import.meta.url), 'utf8');

test('R75 primary shell keeps ME2 chrome and agent rail outside the native Browser surface', () => {
  const plan = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
  });
  assert.equal(plan.surface_profile, 'ME2_R75_COMMAND');
  assert.equal(plan.remote_bounds.x, ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH + ME2_PRIMARY_COMMAND_GAP);
  assert.equal(plan.remote_bounds.y, ME2_PRIMARY_TOP_HEIGHT + ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT + ME2_PRIMARY_COMMAND_GAP);
  assert.equal(
    plan.remote_bounds.width,
    1440 - (ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH + ME2_PRIMARY_COMMAND_GAP) - ME2_PRIMARY_PAGE_PADDING,
  );
  assert.equal(plan.reserved_bottom_height, ME2_PRIMARY_PAGEBAR_HEIGHT + ME2_PRIMARY_STATUSBAR_HEIGHT + ME2_PRIMARY_PAGE_PADDING);
  assert.equal(plan.remote_bounds.height, 960 - plan.remote_bounds.y - plan.reserved_bottom_height);
  assert.equal(plan.overlay_remote_content, false);
  assert.equal(plan.renderer_dimensions_authoritative, false);
  assert.equal(plan.authority_effect, false);
});

test('R75 primary shell releases rail reservation before starving the Browser center', () => {
  const plan = planShellLayout({
    width: 900,
    height: 640,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
  });
  assert.equal(plan.effective_sidebar, 'HIDDEN');
  assert.equal(plan.remote_bounds.x, ME2_PRIMARY_PAGE_PADDING);
  assert.ok(plan.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.ok(plan.adaptations.includes('ME2_AGENT_RAIL_RESERVED_SPACE_RELEASED_FOR_ACTIVE_SURFACE'));
  assert.equal(plan.authority_effect, false);
});

test('normal Browser startup prefers packaged ME2 and retains legacy shell only as recovery', () => {
  assert.match(main, /await preparePrimaryShellTarget\(\)/);
  assert.match(main, /PACKAGED_ME2_UI_PROVEN/);
  assert.match(main, /ME2_PRIMARY_SHELL_VISIBLE/);
  assert.match(main, /LEGACY_RECOVERY_SHELL_VISIBLE/);
  assert.match(main, /legacy_shell_is_normal_path:\s*false/);
  assert.match(main, /loadURL\('metaengine:\/\/shell\/'\)/);
  assert.match(main, /surface_profile:\s*primaryShellMode === 'ME2_PRIMARY'/);
});

test('ME2 page navigation controls presentation only through the trusted preload bridge', () => {
  assert.match(preload, /const setPrimaryPage = \(page\) => ipcRenderer\.invoke\('metaengine:shell:primary-page'/);
  assert.match(preload, /if \(isPrimaryMe2PresentationDocument\(\)\)/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('metaengineShell', Object\.freeze\(\{[\s\S]*setPrimaryPage,[\s\S]*presentation_only:\s*true,[\s\S]*browser_command_authority:\s*false,[\s\S]*scheduler_authority:\s*false,[\s\S]*update_authority:\s*false,[\s\S]*release_authority:\s*false,[\s\S]*authority_effect:\s*false/);
  const primaryBranch = preload.slice(
    preload.indexOf('if (isPrimaryMe2PresentationDocument())'),
    preload.indexOf('} else {', preload.indexOf('if (isPrimaryMe2PresentationDocument())')),
  );
  assert.doesNotMatch(primaryBranch, /snapshot:\s*\(\)|command:\s*\(|presentationFocus|onBrainDelta|brainStreamStatus/);
  assert.match(store, /metaengineShell\?: \{ setPrimaryPage\?:/);
  assert.match(store, /shell\?\.setPrimaryPage\?\.\(p\)/);
  assert.match(main, /presentation_only:\s*true/);
  assert.match(main, /scheduler_authority:\s*false/);
  assert.match(main, /browser_command_authority:\s*false/);
  assert.match(main, /release_authority:\s*false/);
  assert.match(main, /authority_effect:\s*false/);
});


test('packaged ME2 UI routing waits for bounded initial readiness', () => {
  assert.match(uiHost, /export async function waitForMe2UiReady/);
  assert.match(uiHost, /attempts = 60/);
  assert.match(uiHost, /intervalMs = 250/);
  assert.match(uiHost, /const ready = await waitForMe2UiReady\(\)/);
  assert.match(uiHost, /event: 'UI_HEALTHY', readiness_attempt: ready\.attempt/);
  assert.match(uiHost, /event: 'UI_INITIAL_READINESS_FAILED'/);
  assert.match(uiHost, /\.\.\.projectMe2UiRoutingAuthority\(\{ mode, state, child, stopped,/);
});

test('concurrent primary-window startup joins the same ME2 readiness barrier', () => {
  const inflight = integration.indexOf('if (startPromise) return startPromise;');
  const startedGuard = integration.indexOf('if (started || stoppedFlag) return me2IntegrationStatus();', inflight);
  assert.ok(inflight >= 0);
  assert.ok(startedGuard > inflight);
  assert.match(integration, /startPromise = startMe2IntegrationOnce\(\{ app \}\)/);
  assert.match(integration, /return await startPromise/);
  assert.match(integration, /finally \{[\s\S]*startPromise = null/);
});


test('R75 CDP proof converges only inside a bounded read-only window', () => {
  assert.match(main, /probeMe2R75InstalledDomOnce/);
  assert.match(main, /timeoutMs = 12000/);
  assert.match(main, /intervalMs = 150/);
  assert.match(main, /MAIN_PROCESS_CDP_DOM_BOX_MODEL_BOUNDED_CONVERGENCE/);
  assert.match(main, /probe_attempts:/);
  assert.match(main, /probe_elapsed_ms:/);
  assert.match(main, /automatic_effect_retry_allowed:\s*false/);
  assert.match(main, /Date\.now\(\) >= deadline/);
  assert.doesNotMatch(main, /setInterval\([^\n]*probeMe2R75InstalledDom/);
});

test('installed ME2 primary shell is attested from main-process CDP DOM geometry', () => {
  assert.match(main, /probeMe2R75InstalledDom/);
  assert.match(main, /DOM\.getDocument/);
  assert.match(main, /DOM\.querySelector/);
  assert.match(main, /DOM\.getBoxModel/);
  assert.match(main, /MAIN_PROCESS_CDP_DOM_BOX_MODEL/);
  assert.match(main, /ME2_R75_UI_CONTRACT_CONFIRMED/);
  assert.match(main, /ME2_R75_UI_CONTRACT_INCOMPLETE/);
  assert.doesNotMatch(main, /executeJavaScript/);
  assert.doesNotMatch(preload, /reportUiContract/);
  assert.doesNotMatch(preload, /ui-contract-readback/);
  for (const id of ['me2-shell', 'topbar', 'page-command', 'agent-sidebar', 'pagebar', 'statusbar']) {
    assert.match(main, new RegExp(id));
  }
  assert.match(main, /legacy_shell_is_normal_path:\s*false/);
  assert.match(main, /scheduler_authority:\s*false/);
  assert.match(main, /browser_command_authority:\s*false/);
  assert.match(main, /update_authority:\s*false/);
  assert.match(main, /release_authority:\s*false/);
});



test('R85 control-room chrome keeps closed overlays out of the semantic tree', () => {
  assert.match(me2Shell, /\{paletteOpen \? <CommandPalette \/> : null\}/);
  assert.match(me2Shell, /\{overlaysOpen \? <GlobalDialogs \/> : null\}/);
  assert.doesNotMatch(me2Shell, /<CommandPalette \/>\s*<GlobalDialogs \/>/);
});

test('R85 persistent chrome is compact and cannot directly fire emergency flush', () => {
  assert.match(me2Topbar, /h-\[42px\]/);
  assert.match(me2Pagebar, /className="flex h-9/);
  assert.match(me2Statusbar, /h-\[22px\]/);
  assert.doesNotMatch(me2Statusbar, /budgetFlush|BUDGET_FLUSH|EMERGENCY/);
  assert.match(me2Palette, /window\.confirm\("Сбросить очередь command bus\?/);
  assert.match(me2Palette, /BUDGET_FLUSH:\s*confirmBudgetFlush/);
});

test('R85 Command remains an integrated native-stage workbench with R75 anchors', () => {
  assert.match(me2Command, /data-testid="page-command"/);
  assert.match(me2Command, /data-testid="agent-sidebar"/);
  assert.match(me2Command, /w-\[252px\]/);
  assert.match(me2Command, /<BrowserStage compact defaultCastOn \/>/);
  assert.match(me2Topbar, /data-testid="topbar"/);
  assert.match(me2Pagebar, /data-testid="pagebar"/);
  assert.match(me2Statusbar, /data-testid="statusbar"/);
});

test('R85 semantic workbench avoids nested interactive agent rows', () => {
  assert.doesNotMatch(me2Command, /role="button"\s+tabIndex=\{0\}[\s\S]{0,1200}<button/);
  assert.match(me2Command, /type="button"\s+aria-current=\{chatId === s\.id\}/);
  assert.match(me2Command, /aria-label=\{\`Открыть вкладку z\.ai агента/);
});

test('R85 Command hides browser transport tuning while full Browser retains it', () => {
  assert.match(me2BrowserStage, /\{!compact && \(\s*<div role="group" aria-label="Профиль полосы стрима"/);
  assert.match(me2BrowserStage, /compact \? \(\s*<span className="ml-auto text-zinc-600">/);
  assert.match(me2BrowserStage, /\[30, 55, 85\]\.map/);
  assert.match(me2BrowserStage, /\[480, 640, 960\]\.map/);
});

test('R85 attention and observability use progressive disclosure without effect authority', () => {
  assert.match(me2Topbar, /data-testid="attention-button"/);
  assert.match(me2Topbar, /data-testid="attention-center"/);
  assert.doesNotMatch(me2Topbar, /sendCommand\(|BUDGET_FLUSH|EMERGENCY/);
  assert.match(me2Observability, /"compact" \| "full"/);
  assert.match(me2Observability, /me2\.obs\.events\.view\.v1/);
  assert.match(me2Observability, /prev\.event\.type === event\.type/);
});

test('R85 agent chat feed is shared and background-aware', () => {
  assert.match(me2AgentChatFeed, /useSyncExternalStore/);
  assert.match(me2AgentChatFeed, /document\.visibilityState === "visible"/);
  assert.match(me2AgentChatFeed, /inFlight/);
  assert.match(me2Command, /useAgentChatSessions/);
  assert.doesNotMatch(me2Command, /setInterval\([^\n]*agentchat/);
});

test('R85 unavailable legacy sandbox plane is fail-close and collapsed by default', () => {
  assert.match(me2CodePage, /title="SANDBOXES · LEGACY LOCKED"/);
  assert.match(me2CodePage, /defaultOpen=\{false\}/);
  assert.match(me2CodePage, /legacy capability unavailable/);
});

test('ME2 UI routing authority is revoked on stop, degradation, or owned-process loss', () => {
  const liveChild = { pid: 4242, exitCode: null, signalCode: null };
  const healthy = projectMe2UiRoutingAuthority({
    mode: 'spawned',
    state: 'HEALTHY',
    child: liveChild,
    stopped: false,
    allowExternalAdopt: false,
  });
  assert.equal(healthy.child_owned, true);
  assert.equal(healthy.routing_authorized, true);
  assert.equal(healthy.initial_readiness_confirmed, true);

  const stopped = projectMe2UiRoutingAuthority({
    mode: 'spawned',
    state: 'HEALTHY',
    child: liveChild,
    stopped: true,
    allowExternalAdopt: false,
  });
  assert.equal(stopped.child_owned, false);
  assert.equal(stopped.routing_authorized, false);
  assert.equal(stopped.initial_readiness_confirmed, false);

  const degraded = projectMe2UiRoutingAuthority({
    mode: 'spawned',
    state: 'DEGRADED',
    child: liveChild,
    stopped: false,
    allowExternalAdopt: false,
  });
  assert.equal(degraded.routing_authorized, false);

  const exited = projectMe2UiRoutingAuthority({
    mode: 'spawned',
    state: 'HEALTHY',
    child: { pid: 4242, exitCode: 1, signalCode: null },
    stopped: false,
    allowExternalAdopt: false,
  });
  assert.equal(exited.child_owned, false);
  assert.equal(exited.routing_authorized, false);

  const adopted = projectMe2UiRoutingAuthority({
    mode: 'adopted',
    state: 'ADOPTED',
    child: null,
    stopped: false,
    allowExternalAdopt: true,
  });
  assert.equal(adopted.external_adopt_authorized, true);
  assert.equal(adopted.routing_authorized, true);

  const adoptedStopped = projectMe2UiRoutingAuthority({
    mode: 'adopted',
    state: 'STOPPED',
    child: null,
    stopped: true,
    allowExternalAdopt: true,
  });
  assert.equal(adoptedStopped.external_adopt_authorized, false);
  assert.equal(adoptedStopped.routing_authorized, false);
});
