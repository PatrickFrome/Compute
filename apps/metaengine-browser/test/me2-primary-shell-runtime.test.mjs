import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ME2_PRIMARY_BROWSER_STATUS_HEIGHT,
  ME2_PRIMARY_BROWSER_TABSTRIP_HEIGHT,
  ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT,
  ME2_PRIMARY_CONTEXT_DRAWER_MIN_HEIGHT,
  ME2_PRIMARY_CONTEXT_DRAWER_MAX_HEIGHT,
  ME2_PRIMARY_MIN_BROWSER_HEIGHT,
  ME2_PRIMARY_BROWSER_URLBAR_HEIGHT,
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
import {
  presentationSyncStillCurrent,
  resolveExactAgentTab,
  zAiUrlContainsExactSession,
} from '../../me2-ui/src/lib/r85-ui-contracts.mjs';

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
const me2RunPage = await readFile(new URL('../../me2-ui/src/components/me2/pages/browser.tsx', import.meta.url), 'utf8');
const me2BrowserStage = await readFile(new URL('../../me2-ui/src/components/me2/stages/browser-stage.tsx', import.meta.url), 'utf8');
const me2Observability = await readFile(new URL('../../me2-ui/src/components/me2/pages/observability.tsx', import.meta.url), 'utf8');
const me2AgentChatFeed = await readFile(new URL('../../me2-ui/src/hooks/use-agentchat-sessions.ts', import.meta.url), 'utf8');
const me2CodePage = await readFile(new URL('../../me2-ui/src/components/me2/pages/code.tsx', import.meta.url), 'utf8');
const me2TasksPage = await readFile(new URL('../../me2-ui/src/components/me2/pages/tasks.tsx', import.meta.url), 'utf8');
const me2Dialogs = await readFile(new URL('../../me2-ui/src/components/me2/shell/dialogs.tsx', import.meta.url), 'utf8');
const me2ContextDrawer = await readFile(new URL('../../me2-ui/src/components/me2/shell/context-drawer.tsx', import.meta.url), 'utf8');
const r85VisualHarness = await readFile(new URL('./me2-r85-visual-evidence.mjs', import.meta.url), 'utf8');
const packageSmokeWorkflow = await readFile(new URL('../../../.github/workflows/browser-windows-package-smoke.yml', import.meta.url), 'utf8');

test('R75 primary shell keeps ME2 chrome and agent rail outside the native Browser surface', () => {
  const plan = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
  });
  assert.equal(plan.surface_profile, 'ME2_R75_COMMAND');
  assert.equal(plan.remote_bounds.x, ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH + ME2_PRIMARY_COMMAND_GAP);
  assert.equal(
    plan.remote_bounds.y,
    ME2_PRIMARY_TOP_HEIGHT
      + ME2_PRIMARY_PAGE_PADDING
      + ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT
      + ME2_PRIMARY_COMMAND_GAP
      + ME2_PRIMARY_BROWSER_TABSTRIP_HEIGHT
      + ME2_PRIMARY_BROWSER_URLBAR_HEIGHT,
  );
  assert.equal(
    plan.remote_bounds.width,
    1440 - (ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH + ME2_PRIMARY_COMMAND_GAP) - ME2_PRIMARY_PAGE_PADDING,
  );
  assert.equal(
    plan.reserved_bottom_height,
    ME2_PRIMARY_PAGEBAR_HEIGHT
      + ME2_PRIMARY_STATUSBAR_HEIGHT
      + ME2_PRIMARY_PAGE_PADDING
      + ME2_PRIMARY_BROWSER_STATUS_HEIGHT,
  );
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

test('R85 command rail visibility and native Browser bounds share one presentation state', () => {
  const open = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_command_rail_open: true,
  });
  const closed = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_command_rail_open: false,
  });
  assert.equal(open.effective_sidebar, 'EXPANDED');
  assert.equal(open.remote_bounds.x, ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH + ME2_PRIMARY_COMMAND_GAP);
  assert.equal(closed.effective_sidebar, 'HIDDEN');
  assert.equal(closed.remote_bounds.x, ME2_PRIMARY_PAGE_PADDING);
  assert.ok(closed.remote_bounds.width > open.remote_bounds.width);
  assert.ok(closed.adaptations.includes('ME2_AGENT_RAIL_HIDDEN_BY_PRESENTATION'));
  assert.equal(closed.authority_effect, false);
});

test('R85 contextual drawer reserves native Browser height and degrades before starving the active surface', () => {
  const closed = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_context_drawer_open: false,
  });
  const open = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_context_drawer_open: true,
  });
  assert.equal(open.me2_context_drawer_effective_open, true);
  assert.equal(open.me2_context_drawer_requested_height, ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT);
  assert.equal(open.me2_context_drawer_height, ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT);
  assert.equal(open.remote_bounds.height, closed.remote_bounds.height - ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT);
  assert.ok(open.remote_bounds.height >= ME2_PRIMARY_MIN_BROWSER_HEIGHT);
  assert.equal(open.authority_effect, false);

  const large = planShellLayout({
    width: 1440,
    height: 800,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_context_drawer_open: true,
    me2_context_drawer_height: ME2_PRIMARY_CONTEXT_DRAWER_MAX_HEIGHT,
  });
  assert.equal(large.me2_context_drawer_effective_open, true);
  assert.equal(large.me2_context_drawer_requested_height, ME2_PRIMARY_CONTEXT_DRAWER_MAX_HEIGHT);
  assert.ok(large.me2_context_drawer_height >= ME2_PRIMARY_CONTEXT_DRAWER_MIN_HEIGHT);
  assert.ok(large.me2_context_drawer_height < ME2_PRIMARY_CONTEXT_DRAWER_MAX_HEIGHT);
  assert.ok(large.adaptations.includes('ME2_CONTEXT_DRAWER_CLAMPED_FOR_ACTIVE_SURFACE'));
  assert.equal(large.remote_bounds.height, ME2_PRIMARY_MIN_BROWSER_HEIGHT);

  const short = planShellLayout({
    width: 1440,
    height: 640,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
    me2_context_drawer_open: true,
  });
  assert.equal(short.me2_context_drawer_effective_open, false);
  assert.equal(short.me2_context_drawer_height, 0);
  assert.ok(short.adaptations.includes('ME2_CONTEXT_DRAWER_CLOSED_FOR_ACTIVE_SURFACE'));
  assert.ok(short.remote_bounds.height >= ME2_PRIMARY_MIN_BROWSER_HEIGHT);
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
  assert.match(store, /metaengineShell\?: \{[\s\S]{0,220}setPrimaryPage\?: \(page: string\) => Promise<unknown> \| unknown/);
  assert.match(store, /const result = shell\?\.setPrimaryPage\?\.\(p\)/);
  assert.match(store, /primaryPageAck = Promise\.resolve\(result\)/);
  assert.match(store, /return primaryPageAck/);
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


test('R97 CDP proof converges only inside a bounded read-only window', () => {
  assert.match(main, /probeMe2R97InstalledDomOnce/);
  assert.match(main, /timeoutMs = 12000/);
  assert.match(main, /intervalMs = 150/);
  assert.match(main, /MAIN_PROCESS_CDP_DOM_BOX_MODEL_BOUNDED_CONVERGENCE/);
  assert.match(main, /probe_attempts:/);
  assert.match(main, /probe_elapsed_ms:/);
  assert.match(main, /automatic_effect_retry_allowed:\s*false/);
  assert.match(main, /Date\.now\(\) >= deadline/);
  assert.doesNotMatch(main, /setInterval\([^\n]*probeMe2R97InstalledDom/);
});

test('installed ME2 primary shell is attested from main-process CDP DOM geometry', () => {
  assert.match(main, /probeMe2R97InstalledDom/);
  assert.match(main, /DOM\.getDocument/);
  assert.match(main, /DOM\.querySelector/);
  assert.match(main, /DOM\.getBoxModel/);
  assert.match(main, /MAIN_PROCESS_CDP_DOM_BOX_MODEL/);
  assert.match(main, /ME2_R97_UI_CONTRACT_CONFIRMED/);
  assert.match(main, /ME2_R97_UI_CONTRACT_INCOMPLETE/);
  assert.doesNotMatch(main, /executeJavaScript/);
  assert.doesNotMatch(preload, /reportUiContract/);
  assert.doesNotMatch(preload, /ui-contract-readback/);
  for (const id of ['me2-shell', 'topbar', 'primary-chat-fleet', 'chat-fleet-rail', 'global-cmdbar', 'settings-button']) {
    assert.match(main, new RegExp(id));
  }
  assert.match(main, /legacy_shell_is_normal_path:\s*false/);
  assert.match(main, /scheduler_authority:\s*false/);
  assert.match(main, /browser_command_authority:\s*false/);
  assert.match(main, /update_authority:\s*false/);
  assert.match(main, /release_authority:\s*false/);
});



test('R97 Package Smoke captures the actual single-main ME2 surface, not legacy shell fixtures', () => {
  assert.match(packageSmokeWorkflow, /Capture R97 primary chat-fleet visual evidence/);
  assert.match(packageSmokeWorkflow, /test\\me2-r85-visual-evidence\.mjs|test\/me2-r85-visual-evidence\.mjs/);
  assert.match(packageSmokeWorkflow, /r85-primary-visual\/r85-visual-evidence\.json/);
  assert.match(packageSmokeWorkflow, /r85-primary-visual\/\*\.png/);
  assert.match(packageSmokeWorkflow, /WaitForExit\(135000\)/);
  assert.match(packageSmokeWorkflow, /r85_visual_evidence_process_timeout/);
  assert.match(packageSmokeWorkflow, /r85-primary-visual\.stderr\.log/);
  assert.match(r85VisualHarness, /metaengine\.browser\.r97-visual-evidence\.v1/);
  assert.match(r85VisualHarness, /primary_me2_ui_captured:\s*true/);
  assert.match(r85VisualHarness, /legacy_shell_captured:\s*false/);
  assert.match(r85VisualHarness, /remote_browser_content_captured:\s*false/);
  assert.match(r85VisualHarness, /remote_browser_transport_blocked:\s*true/);
  assert.match(r85VisualHarness, /exact_main_workspace:\s*false/);
  assert.match(r85VisualHarness, /advanced_surfaces_settings_only:\s*false/);
  assert.match(r85VisualHarness, /capturePage\(\)/);
  assert.match(r85VisualHarness, /ME2_UI_HEALTH_URL/);
  assert.match(r85VisualHarness, /VISUAL_PHASE_TIMEOUT_MS = 120_000/);
  assert.match(r85VisualHarness, /r97_visual_phase_watchdog/);
  assert.match(r85VisualHarness, /withTimeout\(view\.webContents\.capturePage/);
  assert.match(r85VisualHarness, /r97-chat-fleet-main-1440x960/);
  assert.match(r85VisualHarness, /r97-settings-advanced-surface-1440x960/);
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
  assert.doesNotMatch(me2Palette, /window\.confirm\(|window\.prompt\(/);
  assert.match(me2Palette, /BUDGET_FLUSH:\s*confirmBudgetFlush/);
  assert.match(me2Palette, /data-testid="emergency-flush-confirm"/);
  assert.match(me2Palette, /setConfirmFlush\(true\)/);
});

test('R95C COMMAND is mission control and RUN owns the compact Browser stage', () => {
  assert.match(me2Command, /data-testid="page-command"/);
  assert.match(me2Command, /data-testid="agent-sidebar"/);
  assert.match(me2Command, /data-testid="mission-objective-card"/);
  assert.match(me2Command, /data-testid="mission-active-work"/);
  assert.doesNotMatch(me2Command, /BrowserStage/);
  assert.match(me2RunPage, /data-testid="page-browser"/);
  assert.match(me2RunPage, /<BrowserStage compact defaultCastOn \/>/);
  assert.match(me2Topbar, /data-testid="topbar"/);
  assert.match(me2Pagebar, /data-testid="pagebar"/);
  assert.match(me2Statusbar, /data-testid="statusbar"/);
});

test('R85 agent tab binding is exact-session-only and rejects similar-title fallbacks', () => {
  const sessionId = 'sess-abc-123';
  const exact = resolveExactAgentTab([
    { id: 'tab-a', url: 'https://chat.z.ai/c/sess-abc-123', title: 'Refactor auth' },
    { id: 'tab-b', url: 'https://chat.z.ai/c/other-session', title: 'Refactor auth v2' },
  ], sessionId);
  assert.equal(exact.kind, 'exact');
  assert.equal(exact.tab.id, 'tab-a');

  const titleOnly = resolveExactAgentTab([
    { id: 'tab-title', url: 'https://chat.z.ai/c/other-session', title: 'Refactor auth' },
  ], sessionId);
  assert.equal(titleOnly.kind, 'missing');
  assert.equal(titleOnly.zai.length, 1);

  assert.equal(zAiUrlContainsExactSession('https://chat.z.ai/c/sess-abc-1234', sessionId), false);
  assert.equal(zAiUrlContainsExactSession('https://example.com/?session=sess-abc-123', sessionId), false);

  const duplicate = resolveExactAgentTab([
    { id: 'tab-1', url: 'https://chat.z.ai/c/sess-abc-123', title: 'one' },
    { id: 'tab-2', url: 'https://chat.z.ai/session/sess-abc-123?view=2', title: 'two' },
  ], sessionId);
  assert.equal(duplicate.kind, 'ambiguous');
  assert.equal(duplicate.matches.length, 2);

  // R93 moved COMMAND off daemon tab census entirely. Keep the pure R85
  // resolver regression above as a historical fail-closed contract, but the
  // primary renderer now consumes only Browser's canonical session->tab binding.
  assert.match(me2Command, /selectPrimaryAgentSession\(s\.id\)/);
  assert.doesNotMatch(me2Command, /resolveExactAgentTab/);
  assert.doesNotMatch(me2Command, /loadBrowserTabs/);
  assert.doesNotMatch(me2Command, /BROWSER_SELECT_TAB/);
});

test('R85 semantic workbench avoids nested interactive agent rows', () => {
  assert.doesNotMatch(me2Command, /role="button"\s+tabIndex=\{0\}[\s\S]{0,1200}<button/);
  assert.match(me2Command, /type="button"\s+aria-current=\{chatId === s\.id\}/);
  assert.match(me2Command, /aria-label=\{\`Открыть вкладку z\.ai агента/);
});

test('R85 Browser tabs use sibling controls instead of nested interactive semantics', () => {
  assert.match(me2BrowserStage, /type="button"\s+title=\{\`\$\{t\.title\}\\n\$\{t\.url\}\`}\s+role="tab"/);
  assert.match(me2BrowserStage, /aria-label=\{\`Закрыть вкладку/);
  assert.doesNotMatch(me2BrowserStage, /<span[\s\S]{0,240}role="tab"[\s\S]{0,900}<button/);
});

test('R85 Command hides browser transport tuning while full Browser retains it', () => {
  assert.match(me2BrowserStage, /\{!compact && \(\s*<div role="group" aria-label="Профиль полосы стрима"/);
  assert.match(me2BrowserStage, /compact \? \(\s*<span className="ml-auto text-zinc-600">/);
  assert.match(me2BrowserStage, /\[30, 55, 85\]\.map/);
  assert.match(me2BrowserStage, /\[480, 640, 960\]\.map/);
});

test('R85 Browser image fallbacks never expose broken-image text in the primary surface', () => {
  assert.match(me2BrowserStage, /data-testid="browser-cast-image"/);
  assert.match(me2BrowserStage, /data-testid="browser-cdp-fallback-image"/);
  assert.match(me2BrowserStage, /alt=""\s+aria-hidden="true"\s+className="block h-full w-full object-contain opacity-0"/);
  assert.match(me2BrowserStage, /alt=""\s+aria-hidden="true"\s+className="absolute inset-0 h-full w-full object-contain opacity-0"/);
  assert.match(me2BrowserStage, /onLoad=\{\(e\) => \{ e\.currentTarget\.style\.opacity = "1"; \}\}/);
  assert.match(me2BrowserStage, /onError=\{\(e\) => \{ e\.currentTarget\.style\.opacity = "0"; \}\}/);
  assert.match(me2BrowserStage, /onLoad=\{\(e\) => \{ e\.currentTarget\.style\.opacity = "1"; cdpNextTick\(2000\); \}\}/);
  assert.match(me2BrowserStage, /onError=\{\(e\) => \{ e\.currentTarget\.style\.opacity = "0"; cdpNextTick\(6000\); \}\}/);
});

test('R85 native Browser overlays only the viewport and preserves compact Browser chrome', () => {
  assert.match(me2BrowserStage, /compact \? "h-7 pt-1" : "pt-1\.5"/);
  assert.match(me2BrowserStage, /compact \? "h-9 py-0" : "py-1\.5"/);
  assert.match(me2BrowserStage, /compact \? "h-6 py-0" : "py-1"/);
  const plan = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
  });
  assert.ok(plan.remote_bounds.y > ME2_PRIMARY_TOP_HEIGHT + ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT);
  assert.ok(plan.reserved_bottom_height > ME2_PRIMARY_PAGEBAR_HEIGHT + ME2_PRIMARY_STATUSBAR_HEIGHT);
  assert.equal(plan.authority_effect, false);
});

test('R85 Observability exposes persisted operator view presets without new effect authority', () => {
  assert.match(me2Observability, /data-testid="event-view-presets"/);
  assert.match(me2Observability, /me2\.obs\.events\.preset\.v1/);
  assert.match(me2Observability, /EVENT_ATTENTION_TOKENS/);
  assert.match(me2Observability, /applyViewPreset/);
  assert.match(me2Observability, /localStorage\.setItem\(EVENT_VIEW_PRESET_LS, key\)/);
  assert.doesNotMatch(me2Observability, /setPrimaryCommandRail|metaengine:shell:primary-overlay/);
});

test('R97 attention and observability are advanced-only and keep zero effect authority', () => {
  assert.doesNotMatch(me2Topbar, /data-testid="attention-button"|data-testid="attention-center"/);
  assert.match(me2Topbar, /data-testid="settings-button"/);
  assert.match(me2Topbar, /data-testid="global-cmdbar"/);
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

test('R85 Tasks is task-focused and does not duplicate Browser or Mirror control planes', () => {
  assert.match(me2TasksPage, /data-testid="page-tasks"/);
  assert.match(me2TasksPage, /title={`ВЕТКИ · ЗАДАЧИ/);
  assert.doesNotMatch(me2TasksPage, /loadBrowserTabs|type BrowserTab|me2:cast-toggle|me2:cast-ctl/);
  assert.doesNotMatch(me2TasksPage, /<MirrorPanel|mirror-panel/);
  assert.doesNotMatch(me2TasksPage, /MonitorPlay|MousePointerClick|AppWindow/);
  assert.match(me2TasksPage, /me2\.tasks\.branch-view\.v1/);
  assert.match(me2TasksPage, /localStorage\.setItem\(TASKS_BRANCH_VIEW_LS, branchTab\)/);
});

test('R97 persistent chrome avoids duplicate task, mirror and attention telemetry', () => {
  assert.doesNotMatch(me2Topbar, /useKpis|kpi\.ready|kpi\.running|kpi\.fail/);
  assert.doesNotMatch(me2Topbar, /data-testid="attention-button"/);
  assert.doesNotMatch(me2Shell, /<StatusBar\s*\/>/);
  assert.match(me2Statusbar, /connected \? "runtime live" : snap \? "runtime cached" : "runtime offline"/);
});

test('R85 Task Sheet schedules scroll after commit, never during render', () => {
  assert.match(me2Dialogs, /useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(me2Dialogs, /requestAnimationFrame\(\(\) => \{/);
  assert.match(me2Dialogs, /\[detail\?\.id, stream\.length\]/);
  assert.doesNotMatch(me2Dialogs, /if \(detail\) setTimeout\(/);
});

test('R85 registry command arguments stay inside the semantic palette', () => {
  assert.match(me2Palette, /data-testid="registry-action-args"/);
  assert.match(me2Palette, /JSON\.parse\(pendingArgs\)/);
  assert.match(me2Palette, /sendCommand\(pendingAction\.action, payload/);
  assert.doesNotMatch(me2Palette, /window\.prompt\(/);
});

test('R85 command palette exposes full authority lanes instead of abbreviated color-only hints', () => {
  assert.match(me2Palette, /Authority lane: \$\{m\.lane\}/);
  assert.match(me2Palette, /aria-label=\{\`Authority lane \$\{m\.lane\}\`\}/);
  assert.match(me2Palette, /m\.lane\.replace\("_", " "\)/);
  assert.doesNotMatch(me2Palette, /m\.lane\.slice\(0, 4\)/);
});

test('R85 native open-site intent uses the ME2 overlay plane instead of window.prompt', () => {
  assert.match(store, /type === "open-site-prompt"[\s\S]{0,240}dialog: "openSite"/);
  assert.doesNotMatch(store, /window\.prompt\("URL сайта для нативной вкладки/);
  assert.match(me2Dialogs, /data-testid="open-site-dialog"/);
  assert.match(me2Dialogs, /desktop\.tabs\.openSite\(value\)/);
  assert.match(me2Dialogs, /https\?:/);
  assert.match(me2Dialogs, /\.test\(value\)/);
});

test('R97 retains bounded page-history metadata without a direct Alt navigation path', () => {
  assert.match(store, /pageHistoryIndex:\s*number/);
  assert.match(store, /const prefix = st\.recentPages\.slice\(0, st\.pageHistoryIndex \+ 1\)/);
  assert.doesNotMatch(store, /nextIndex = st\.pageHistoryIndex \+ delta/);
  assert.doesNotMatch(store, /set\(\{ page: target, pageHistoryIndex: nextIndex \}\)/);
  assert.doesNotMatch(store, /e\.key === "ArrowLeft" \|\| e\.key === "ArrowRight"/);
  assert.doesNotMatch(store, /rp\.length - 2/);
});

test('R85 workspace switch restores workspace-scoped layout preferences', () => {
  assert.match(store, /me2\.workspace-layouts\.v1/);
  assert.match(store, /readWorkspaceLayout\(workspace: WorkspaceKey\)/);
  assert.match(store, /writeWorkspaceLayout\(get\(\)\.workspace, \{ drawerOpen: open \}\)/);
  assert.match(store, /const layoutPreference = readWorkspaceLayout\(w\)/);
  assert.match(store, /contextDrawerPreferredOpen: layoutPreference\.drawerOpen/);
  assert.match(store, /contextDrawerTab: layoutPreference\.drawerTab/);
  assert.match(store, /commandRailPreferredOpen: layoutPreference\.commandRailOpen/);
  assert.match(store, /setCommandRailPreference/);
  assert.match(store, /me2\.command\.agent-rail\.v2:/);
  assert.match(me2Command, /commandRailPreferredOpen/);
  assert.match(me2Command, /storeCommandRailPreference\(open\)/);
});

test('R97 retains workspace reset capability without a persistent topbar control', () => {
  assert.match(store, /resetWorkspaceLayout/);
  assert.match(store, /drawerHeight: CONTEXT_DRAWER_DEFAULT_HEIGHT/);
  assert.match(store, /drawerFollowSelection: true/);
  assert.match(store, /commandRailOpen: true/);
  assert.match(store, /me2:workspace-layout-reset/);
  assert.doesNotMatch(me2Topbar, /data-testid="workspace-reset-layout"/);
  assert.match(me2Topbar, /data-testid="settings-button"/);
});

test('R85 Context Drawer exposes selection-driven inspection without a second data plane', () => {
  assert.match(store, /ContextDrawerTab = "selection" \| "events" \| "commands" \| "runtime"/);
  assert.match(store, /inspectedTaskId:\s*string \| null/);
  assert.match(store, /inspectedTaskId: task\?\.id \?\? id/);
  assert.match(me2ContextDrawer, /data-testid="context-drawer-selection"/);
  assert.match(me2ContextDrawer, /useAgentChatSessions\(\)/);
  assert.match(me2ContextDrawer, /Selected agent/);
  assert.match(me2ContextDrawer, /Last inspected task/);
  assert.doesNotMatch(me2ContextDrawer, /me2Fetch\(|sendCommand\(|agentChatOp\(/);
});

test('R85 Context Drawer follows selection only when explicitly enabled and already open', () => {
  assert.match(store, /drawerFollowSelection:\s*boolean/);
  assert.match(store, /contextDrawerFollowSelection:\s*boolean/);
  assert.match(store, /setContextDrawerFollowSelection/);
  assert.match(store, /contextDrawerPreferredOpen && state\.contextDrawerFollowSelection \? "selection"/);
  assert.match(store, /writeWorkspaceLayout\(get\(\)\.workspace, \{ drawerTab: "selection" \}\)/);
  assert.doesNotMatch(store, /setContextDrawer\(true\)[\s\S]{0,120}drawerTab: "selection"/);
  assert.match(me2ContextDrawer, /data-testid="context-drawer-follow-selection"/);
  assert.match(me2ContextDrawer, /Drawer никогда не открывается автоматически/);
});

test('R85 late drawer replies are rejected after page or workspace transitions', () => {
  const request = { seq: 41, workspace: 'development', page: 'command' };
  assert.equal(presentationSyncStillCurrent(request, { seq: 41, workspace: 'development', page: 'command' }), true);
  assert.equal(presentationSyncStillCurrent(request, { seq: 42, workspace: 'development', page: 'command' }), false);
  assert.equal(presentationSyncStillCurrent(request, { seq: 41, workspace: 'development', page: 'tasks' }), false);
  assert.equal(presentationSyncStillCurrent(request, { seq: 41, workspace: 'browser-ops', page: 'command' }), false);

  assert.match(store, /presentationSyncStillCurrent/);
  assert.match(store, /workspace: get\(\)\.workspace,\s*page: get\(\)\.page/);
  const setPageStart = store.indexOf('setPage: (p) => {');
  const setWorkspaceStart = store.indexOf('setWorkspace: (w) => {');
  assert.ok(setPageStart >= 0 && setWorkspaceStart > setPageStart);
  assert.ok(
    store.indexOf('contextDrawerSyncSeq += 1;', setPageStart) > setPageStart
      && store.indexOf('contextDrawerSyncSeq += 1;', setPageStart) < setWorkspaceStart,
    'page transition must advance the drawer request generation',
  );
  assert.ok(
    store.indexOf('contextDrawerSyncSeq += 1;', setWorkspaceStart) > setWorkspaceStart,
    'workspace transition must advance the drawer request generation',
  );
  assert.match(store, /if \(!presentationSyncStillCurrent\(request,/);
});

test('R95 Utility Panel splitter is keyboard-accessible in bottom and right docks and native-sync fenced', () => {
  assert.match(me2ContextDrawer, /data-testid="context-drawer-resizer"/);
  assert.match(me2ContextDrawer, /role="separator"/);
  assert.match(me2ContextDrawer, /aria-orientation=\{dock === "right" \? "vertical" : "horizontal"\}/);
  assert.match(me2ContextDrawer, /event\.key === "ArrowUp"/);
  assert.match(me2ContextDrawer, /event\.key === "ArrowDown"/);
  assert.match(me2ContextDrawer, /event\.key === "ArrowLeft"/);
  assert.match(me2ContextDrawer, /event\.key === "ArrowRight"/);
  assert.match(me2ContextDrawer, /event\.key === "Home"/);
  assert.match(me2ContextDrawer, /event\.key === "End"/);
  assert.match(me2ContextDrawer, /setHeight\(nextHeight, false\)/);
  assert.match(me2ContextDrawer, /setWidth\(nextWidth, false\)/);
  assert.match(store, /let contextDrawerSyncSeq = 0/);
  assert.match(store, /seq:\s*\+\+contextDrawerSyncSeq/);
  assert.match(store, /presentationSyncStillCurrent\(request,/);
  assert.match(store, /setContextDrawerHeight: \(height: number, persist\?: boolean\)/);
  assert.match(store, /setContextDrawerWidth: \(width: number, persist\?: boolean\)/);
  assert.match(store, /setContextDrawerDock: \(dock: ContextDrawerDock\)/);
});

test('R95 Utility Panel remains a read-only presentation plane with native geometry reconciliation', () => {
  assert.match(preload, /const setPrimaryContextDrawer = \(open, dock, height, width\) => ipcRenderer\.invoke\(/);
  assert.match(preload, /'metaengine:shell:primary-context-drawer'/);
  const primaryBranch = preload.slice(
    preload.indexOf('if (isPrimaryMe2PresentationDocument())'),
    preload.indexOf('} else {', preload.indexOf('if (isPrimaryMe2PresentationDocument())')),
  );
  assert.match(primaryBranch, /setPrimaryContextDrawer/);
  assert.doesNotMatch(primaryBranch, /snapshot:\s*\(\)|command:\s*\(/);

  assert.match(main, /let primaryContextDrawerOpen = false/);
  assert.match(main, /let primaryContextDrawerDock = 'BOTTOM'/);
  assert.match(main, /let primaryContextDrawerHeight = 200/);
  assert.match(main, /let primaryContextDrawerWidth = 380/);
  assert.match(main, /me2_context_drawer_dock: primaryContextDrawerDock/);
  assert.match(main, /me2_context_drawer_width: primaryContextDrawerWidth/);
  assert.match(main, /ipcMain\.handle\('metaengine:shell:primary-context-drawer'/);
  const drawerHandler = main.slice(
    main.indexOf("ipcMain.handle('metaengine:shell:primary-context-drawer'"),
    main.indexOf("ipcMain.handle('metaengine:shell:system-deltas'", main.indexOf("ipcMain.handle('metaengine:shell:primary-context-drawer'")),
  );
  assert.match(drawerHandler, /presentation_only:\s*true/);
  assert.match(drawerHandler, /scheduler_authority:\s*false/);
  assert.match(drawerHandler, /browser_command_authority:\s*false/);
  assert.match(drawerHandler, /update_authority:\s*false/);
  assert.match(drawerHandler, /release_authority:\s*false/);
  assert.match(drawerHandler, /authority_effect:\s*false/);

  assert.match(store, /drawerDock: ContextDrawerDock/);
  assert.match(store, /drawerWidth: number/);
  assert.doesNotMatch(store, /Ctrl\/Cmd\+J|e\.key === "j"/);
  assert.match(store, /only global UI shortcut is Ctrl\/Cmd\+K/);
  assert.match(store, /setPrimaryContextDrawer/);
  assert.doesNotMatch(me2Topbar, /data-testid="context-drawer-toggle"/);
  assert.doesNotMatch(me2Shell, /<ContextDrawer \/>/);
  assert.match(me2ContextDrawer, /data-testid="context-drawer"/);
  assert.match(me2ContextDrawer, /data-drawer-dock=\{dock\}/);
  assert.match(me2ContextDrawer, /data-testid="utility-panel-dock-bottom"/);
  assert.match(me2ContextDrawer, /data-testid="utility-panel-dock-right"/);
  assert.match(store, /setContextDrawerHeight/);
  assert.match(store, /setContextDrawerWidth/);
  assert.doesNotMatch(me2ContextDrawer, /sendCommand\(|me2Fetch\(|agentChatOp\(/);
});

test('R85 command rail bridge is presentation-only and reconciles effective geometry', () => {
  assert.match(preload, /const setPrimaryCommandRail = \(open\) => ipcRenderer\.invoke\('metaengine:shell:primary-command-rail'/);
  const primaryBranch = preload.slice(
    preload.indexOf('if (isPrimaryMe2PresentationDocument())'),
    preload.indexOf('} else {', preload.indexOf('if (isPrimaryMe2PresentationDocument())')),
  );
  assert.match(primaryBranch, /setPrimaryCommandRail/);
  assert.match(main, /let primaryCommandRailOpen = true/);
  assert.match(main, /me2_command_rail_open: primaryCommandRailOpen/);
  assert.match(main, /ipcMain\.handle\('metaengine:shell:primary-command-rail'/);
  const railHandler = main.slice(
    main.indexOf("ipcMain.handle('metaengine:shell:primary-command-rail'"),
    main.indexOf("ipcMain.handle('metaengine:shell:system-deltas'", main.indexOf("ipcMain.handle('metaengine:shell:primary-command-rail'")),
  );
  assert.match(railHandler, /presentation_only:\s*true/);
  assert.match(railHandler, /scheduler_authority:\s*false/);
  assert.match(railHandler, /browser_command_authority:\s*false/);
  assert.match(railHandler, /update_authority:\s*false/);
  assert.match(railHandler, /release_authority:\s*false/);
  assert.match(railHandler, /authority_effect:\s*false/);
  assert.match(me2Command, /commandRailPreferredOpen/);
  assert.match(me2Command, /storeCommandRailPreference/);
  assert.match(me2Command, /setPrimaryCommandRail/);
  assert.match(me2Command, /effective_open/);
  assert.match(me2Command, /window\.addEventListener\("resize", onResize\)/);
  assert.match(me2Command, /COMMAND_RAIL_WEB_MIN_WIDTH = 984/);
  assert.match(me2Command, /aria-disabled=\{railConstrained\}/);
  assert.doesNotMatch(me2Command, /window\.innerWidth < 768/);
});

test('R85 presentation overlays temporarily remove the native Browser surface without gaining authority', () => {
  assert.match(preload, /const setPrimaryOverlay = \(active\) => ipcRenderer\.invoke\('metaengine:shell:primary-overlay'/);
  const primaryBranch = preload.slice(
    preload.indexOf('if (isPrimaryMe2PresentationDocument())'),
    preload.indexOf('} else {', preload.indexOf('if (isPrimaryMe2PresentationDocument())')),
  );
  assert.match(primaryBranch, /setPrimaryOverlay/);
  assert.doesNotMatch(primaryBranch, /snapshot:\s*\(\)|command:\s*\(/);

  assert.match(main, /let primaryShellOverlayActive = false/);
  assert.match(main, /primaryShellPage === 'browser'\s*&& primaryShellOverlayActive !== true/);
  assert.match(main, /ipcMain\.handle\('metaengine:shell:primary-overlay'/);
  assert.match(main, /typeof rawActive !== 'boolean'/);

  const overlayHandler = main.slice(
    main.indexOf("ipcMain.handle('metaengine:shell:primary-overlay'"),
    main.indexOf("ipcMain.handle('metaengine:shell:system-deltas'", main.indexOf("ipcMain.handle('metaengine:shell:primary-overlay'")),
  );
  assert.match(overlayHandler, /presentation_only:\s*true/);
  assert.match(overlayHandler, /scheduler_authority:\s*false/);
  assert.match(overlayHandler, /browser_command_authority:\s*false/);
  assert.match(overlayHandler, /update_authority:\s*false/);
  assert.match(overlayHandler, /release_authority:\s*false/);
  assert.match(overlayHandler, /authority_effect:\s*false/);

  assert.match(store, /setChromeOverlay/);
  assert.match(me2Shell, /setPrimaryOverlay\(nativeOverlayOpen\)/);
  assert.doesNotMatch(me2Topbar, /setChromeOverlay\("attention"|setChromeOverlay\("workspace-menu"/);
  assert.match(me2Topbar, /setPalette\(true\)/);
  assert.match(me2Pagebar, /setChromeOverlay\("stage-menu"/);
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

test('R90 BrowserStage clears stale live frames before degraded fallback becomes visible', () => {
  assert.match(me2BrowserStage, /const hideCastImage = \(\) => \{[\s\S]{0,220}img\.style\.opacity = "0";[\s\S]{0,120}img\.removeAttribute\("src"\)/);
  assert.match(me2BrowserStage, /ws\.onerror = \(\) => \{[\s\S]{0,180}hideCastImage\(\)/);
  assert.match(me2BrowserStage, /ws\.onclose = \(\) => \{[\s\S]{0,180}hideCastImage\(\)/);
  assert.match(me2BrowserStage, /return \(\) => \{[\s\S]{0,220}hideCastImage\(\)[\s\S]{0,180}ws\?\.close\(\)/);
});

test('R90 physical ME2 visual qualification blocks live Browser transports and records zero remote pixels', () => {
  assert.match(r85VisualHarness, /blockedRemoteBrowserPorts = new Set\(\)/);
  assert.match(r85VisualHarness, /webRequest\.onBeforeRequest/);
  assert.match(r85VisualHarness, /port === '3042' \|\| port === '3043'/);
  assert.match(r85VisualHarness, /remote_browser_content_captured:\s*false/);
  assert.match(r85VisualHarness, /remote_browser_transport_blocked:\s*true/);
  assert.match(r85VisualHarness, /blocked_remote_browser_ports:\s*\['3042','3043'\]/);
  assert.match(packageSmokeWorkflow, /remote_browser_transport_blocked -ne \$true/);
  assert.match(packageSmokeWorkflow, /blocked_remote_browser_ports\) -contains '3042'/);
  assert.match(packageSmokeWorkflow, /blocked_remote_browser_ports\) -contains '3043'/);
});
