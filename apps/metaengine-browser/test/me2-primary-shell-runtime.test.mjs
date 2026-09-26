import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ME2_PRIMARY_PAGEBAR_HEIGHT,
  ME2_PRIMARY_STATUSBAR_HEIGHT,
  ME2_PRIMARY_TOP_HEIGHT,
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');
const integration = await readFile(new URL('../src/me2/me2-integration-entry.mjs', import.meta.url), 'utf8');
const uiHost = await readFile(new URL('../src/me2/me2-ui-host.mjs', import.meta.url), 'utf8');

test('R75 primary shell keeps ME2 chrome and agent rail outside the native Browser surface', () => {
  const plan = planShellLayout({
    width: 1440,
    height: 960,
    state: normalizeShellLayoutState(),
    surface_profile: 'ME2_R75_COMMAND',
  });
  assert.equal(plan.surface_profile, 'ME2_R75_COMMAND');
  assert.equal(plan.remote_bounds.x, 280);
  assert.equal(plan.remote_bounds.y, ME2_PRIMARY_TOP_HEIGHT + 8 + 32 + 8);
  assert.equal(plan.remote_bounds.width, 1440 - 280 - 8);
  assert.equal(plan.reserved_bottom_height, ME2_PRIMARY_PAGEBAR_HEIGHT + ME2_PRIMARY_STATUSBAR_HEIGHT + 8);
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
  assert.equal(plan.remote_bounds.x, 8);
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
