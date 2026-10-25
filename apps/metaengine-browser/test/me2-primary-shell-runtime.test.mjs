import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { projectMe2UiRoutingAuthority } from '../src/me2/me2-ui-host.mjs';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const main = await read('../src/main.mjs');
const preload = await read('../src/preload-shell.cjs');
const store = await read('../../me2-ui/src/components/me2/store.tsx');
const integration = await read('../src/me2/me2-integration-entry.mjs');
const uiHost = await read('../src/me2/me2-ui-host.mjs');
const me2Shell = await read('../../me2-ui/src/components/me2/shell/me2-shell.tsx');
const me2Topbar = await read('../../me2-ui/src/components/me2/shell/topbar.tsx');
const r85VisualHarness = await read('./me2-r85-visual-evidence.mjs');
const packageSmokeWorkflow = await read('../../../.github/workflows/browser-windows-package-smoke.yml');

test('normal Browser startup prefers packaged ME2 and falls back only to generated fail-closed recovery', () => {
  assert.match(main, /await preparePrimaryShellTarget\(\)/);
  assert.match(main, /PACKAGED_ME2_UI_PROVEN/);
  assert.match(main, /ME2_PRIMARY_SHELL_VISIBLE/);
  assert.match(main, /FAIL_CLOSED_RECOVERY_VISIBLE/);
  assert.match(main, /deprecated_shell_bundle_present:\s*false/);
  assert.match(main, /recovery_surface_authority:\s*false/);
  assert.match(main, /metaengine:\/\/recovery\/\?reason=ME2_PRIMARY_DEGRADED/);
  assert.match(main, /metaengine:\/\/recovery\/\?reason=ME2_PRIMARY_LOAD_FAILED/);
  assert.match(main, /legacy_shell_is_normal_path:\s*false/);
  assert.doesNotMatch(main, /LEGACY_RECOVERY_SHELL_VISIBLE|loadURL\('metaengine:\/\/shell\/'\)|metaengine-dark-workspace-v2/);
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
  assert.match(store, /metaengineShell\?:/);
  assert.match(store, /native\?\.setPrimaryPage\?\.\(page\)/);
  assert.doesNotMatch(store, /sendCommand|workspace_bindings|lease_current/);
  assert.match(main, /presentation_only:\s*true/);
  assert.match(main, /scheduler_authority:\s*false/);
  assert.match(main, /browser_command_authority:\s*false/);
  assert.match(main, /release_authority:\s*false/);
  assert.match(main, /authority_effect:\s*false/);
});

test('packaged ME2 UI routing waits for bounded initial readiness', () => {
  assert.match(uiHost, /export async function waitForMe2UiReady/);
  assert.match(uiHost, /attempts = 120/);
  assert.match(uiHost, /intervalMs = 500/);
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
  assert.match(r85VisualHarness, /metaengine\.browser\.r97-visual-evidence\.v2/);
  assert.match(r85VisualHarness, /primary_me2_ui_captured:\s*true/);
  assert.match(r85VisualHarness, /legacy_shell_captured:\s*false/);
  assert.match(r85VisualHarness, /remote_browser_content_captured:\s*false/);
  assert.match(r85VisualHarness, /remote_browser_transport_blocked:\s*true/);
  assert.match(r85VisualHarness, /exact_main_workspace:\s*false/);
  assert.match(r85VisualHarness, /settings_controls_scoped_and_routes_verified:\s*false/);
  assert.match(r85VisualHarness, /capturePage\(\)/);
  assert.match(r85VisualHarness, /ME2_UI_HEALTH_URL/);
  assert.match(r85VisualHarness, /VISUAL_PHASE_TIMEOUT_MS = 120_000/);
  assert.match(r85VisualHarness, /r97_visual_phase_watchdog/);
  assert.match(r85VisualHarness, /withTimeout\(view\.webContents\.capturePage/);
  assert.match(r85VisualHarness, /r97-chat-fleet-main-1440x960/);
  assert.match(r85VisualHarness, /r97-settings-advanced-surface-1440x960/);
});

test('primary shell keeps closed overlays out of the semantic tree', () => {
  assert.match(me2Shell, /\{paletteOpen \? <CommandPalette \/> : null\}/);
  assert.doesNotMatch(me2Shell, /GlobalDialogs|ContextDrawer|PeekInspector/);
});

test('R108 retired COMMAND and daemon Browser pages are absent while native selected-agent slot remains', async () => {
  await assert.rejects(
    readFile(new URL('../../me2-ui/src/components/me2/pages/command.tsx', import.meta.url), 'utf8'),
    { code: 'ENOENT' },
  );
  await assert.rejects(
    readFile(new URL('../../me2-ui/src/components/me2/pages/browser.tsx', import.meta.url), 'utf8'),
    { code: 'ENOENT' },
  );
  assert.match(me2Shell, /data-testid="native-chat-surface-slot"/);
  assert.match(me2Shell, /PrimaryChatFleetWorkspace/);
  assert.doesNotMatch(me2Shell, /BrowserStage|pages\/browser/);
  assert.match(me2Topbar, /data-testid="topbar"/);
});

test('R106 removed COMMAND cannot recreate an interactive Agent authority surface', async () => {
  await assert.rejects(
    readFile(new URL('../../me2-ui/src/components/me2/pages/command.tsx', import.meta.url), 'utf8'),
    { code: 'ENOENT' },
  );
  assert.doesNotMatch(me2Shell, /selectPrimaryAgentSession|agentChatOp|useAgentChatSessions/);
});

test('R106 primary shell consumes no retired COMMAND AgentChat feed', () => {
  assert.doesNotMatch(me2Shell, /useAgentChatSessions|agentChatOp|\/agentchat|WebSocket|me2Fetch/);
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
  const nativeVisibility = main.slice(main.indexOf('function nativeBrowserSurfaceAllowed('), main.indexOf('async function preparePrimaryShellTarget('));
  assert.match(nativeVisibility, /primaryShellPage !== 'browser'\s*\|\| primaryShellOverlayActive === true\) return false/);
  assert.match(nativeVisibility, /const roster = primaryChatFleetRoster\(\)/);
  assert.match(nativeVisibility, /actor\.selected === true[\s\S]*actor\.actor_id === roster\.selected_actor_id && actor\.exact_native_binding === true/);
  const nativeRoster = main.slice(main.indexOf('function primaryChatFleetRoster('), main.indexOf('function selectPrimaryChatActor('));
  assert.match(nativeRoster, /binding\.tab_id !== tabId \|\| binding\.web_contents_id !== Number\(view\.webContents\.id\)/);
  assert.match(nativeRoster, /expectedTargetId[\s\S]*webcontents:\$\{binding\.web_contents_id\}/);
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

  assert.match(me2Shell, /setPrimaryOverlay\(nativeOverlayOpen\)/);
  assert.doesNotMatch(me2Topbar, /setChromeOverlay\("attention"|setChromeOverlay\("workspace-menu"/);
  assert.match(me2Topbar, /setPalette\(true\)/);
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
