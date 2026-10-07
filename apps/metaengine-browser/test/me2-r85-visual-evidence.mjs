import { app, BaseWindow, WebContentsView, ipcMain, session } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeShellLayoutState, planShellLayout } from '../src/shell-layout.mjs';
import { projectClientWorkReadiness } from '../src/client-work-readiness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const PRELOAD = path.join(APP_ROOT, 'src', 'preload-shell.cjs');
const OUTPUT_ROOT = path.resolve(
  process.env.METAENGINE_R85_VISUAL_EVIDENCE_DIR || path.join(APP_ROOT, 'r85-visual-evidence'),
);
const UI_DIR = path.resolve(
  process.env.METAENGINE_R85_VISUAL_UI_DIR || path.join(APP_ROOT, 'me2-ui-dist'),
);

process.env.ME2_UI_DIR = UI_DIR;
process.env.ME2_UI_PORT = process.env.ME2_UI_PORT || '39100';
process.env.ME2_UI_HEALTH_URL = process.env.ME2_UI_HEALTH_URL || `http://127.0.0.1:${process.env.ME2_UI_PORT}/`;
process.env.ME2_UI_GATEWAY_PORT = process.env.ME2_UI_GATEWAY_PORT || '39101';
process.env.ME2_ALLOW_EXTERNAL_UI_ADOPT = '0';

app.enableSandbox();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const VISUAL_PHASE_TIMEOUT_MS = 120_000;
let phase = 'BOOT';
const blockedRemoteBrowserPorts = new Set();
let geometryFixture = null;
let rejectNextAgentSelection = false;
let goalSubmitCount = 0;
let runtimeFixtureMode = 'RECOVERY';

// Controlled presentation fixtures, never a claim of live Agent execution.
function fixtureWorkReadiness() {
  if (runtimeFixtureMode === 'UNAVAILABLE') throw new Error('visual_native_readback_unavailable');
  const paused = runtimeFixtureMode === 'PAUSED';
  return projectClientWorkReadiness({
    connection: { local_runtime_ready: true, admin_ready: true, cloud_control_state: 'CONNECTED' },
    snapshot: {
      supervisor_mode: 'CONTROL', armed: true,
      last_heartbeat_at: new Date().toISOString(),
      continuous_service: { actuation_allowed: !paused, runtime_control: { state: paused ? 'CLOSED' : 'OPEN', authoritative: true,
        generation_floor: 28, refill_enabled: !paused, supervisor_admission_enabled: !paused,
        continuous_service_allowed: !paused, authority_effect: false } },
      lifecycle: { keepalive: { state: runtimeFixtureMode === 'RECOVERY' ? 'ROLLOVER_AMBIGUOUS' : 'WAITING',
        admission_state: 'OPEN', admission_generation_floor: 28, cycle_seq: 2109,
        tab_id: 'tab_supervisor_visual', conversation_url: 'https://chat.z.ai/c/visual-fixture' } },
    },
    fleet: { counts: { ACTIVE: 1, BOUND_UNVERIFIED: 0 }, agents: [{ lifecycle_state: 'ACTIVE',
      tab_id: 'tab_planner_visual', target_id: 'target_planner_visual', generation_epoch: 28,
      transport_proof: { tab_id: 'tab_planner_visual', target_id: 'target_planner_visual', generation_epoch: 28,
        agent_surface_sha256: 'a'.repeat(64), conversation_url_sha256: 'b'.repeat(64) } }] },
    isCurrentBinding: () => true,
  });
}

function installRemoteBrowserTransportFence() {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      const url = new URL(String(details?.url || ''));
      const port = url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80');
      if (port === '3042' || port === '3043') {
        blockedRemoteBrowserPorts.add(port);
        callback({ cancel: true });
        return;
      }
    } catch {}
    callback({ cancel: false });
  });
}

function markPhase(next) {
  phase = next;
  console.error(JSON.stringify({
    schema: 'metaengine.browser.r97-visual-phase.v1',
    phase,
    authority_effect: false,
  }));
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`r97_visual_timeout:${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fixtureRoster(selected = 'supervisor:sup_visual') {
  const actors = [
    {
      actor_id: 'supervisor:sup_visual',
      actor_type: 'SUPERVISOR',
      role: 'SUPERVISOR',
      state: 'ACTIVE',
      tab_id: 'tab_supervisor_visual',
      selected: selected === 'supervisor:sup_visual',
      title: 'GLM Supervisor',
      model: 'GLM-5.3-Flash',
      exact_native_binding: true,
    },
    {
      actor_id: 'agent:agent_planner_visual',
      actor_type: 'AGENT',
      role: 'PLANNER',
      state: 'ACTIVE',
      tab_id: 'tab_planner_visual',
      selected: selected === 'agent:agent_planner_visual',
      title: 'Planner',
      model: 'GLM-5.3-Flash',
      exact_native_binding: true,
    },
    {
      actor_id: 'agent:agent_impl_visual',
      actor_type: 'AGENT',
      role: 'IMPLEMENTER',
      state: 'ACTIVE',
      tab_id: 'tab_impl_visual',
      selected: selected === 'agent:agent_impl_visual',
      title: 'Implementer',
      model: 'GLM-5.3-Flash',
      exact_native_binding: true,
    },
  ];
  return Object.freeze({
    schema: 'metaengine.browser.primary-chat-fleet-roster.v1',
    actors: Object.freeze(actors),
    actor_count: actors.length,
    supervisor_count: 1,
    agent_count: 2,
    selected_actor_id: selected,
    bounded: true,
    renderer_routing_authority: false,
    browser_command_authority: false,
    scheduler_authority: false,
    update_authority: false,
    authority_effect: false,
  });
}

function registerPresentationIpc() {
  let page = 'browser';
  let overlay = false;
  let selectedActor = 'supervisor:sup_visual';
  let latestGoal = null;

  ipcMain.handle('metaengine:client:connection-status', () => Object.freeze({
    schema: 'metaengine.client.connection-status.v1', local_runtime_ready: true,
    admin_ready: true, cloud_control_state: 'CONNECTED', authority_effect: false,
  }));
  ipcMain.handle('metaengine:client:work-readiness', () => fixtureWorkReadiness());

  ipcMain.handle('metaengine:shell:primary-page', (_event, rawPage) => {
    page = String(rawPage || 'browser');
    geometryFixture?.setVisible(!overlay && page === 'browser');
    return Object.freeze({
      schema: 'metaengine.browser.r97-visual.primary-page.v1',
      page,
      native_browser_surface_visible: !overlay && page === 'browser',
      presentation_only: true,
      authority_effect: false,
    });
  });
  ipcMain.handle('metaengine:shell:primary-overlay', (_event, rawActive) => {
    overlay = rawActive === true;
    geometryFixture?.setVisible(!overlay && page === 'browser');
    return Object.freeze({
      schema: 'metaengine.browser.r97-visual.primary-overlay.v1',
      active: overlay,
      native_browser_surface_visible: !overlay && page === 'browser',
      presentation_only: true,
      authority_effect: false,
    });
  });
  ipcMain.handle('metaengine:shell:primary-command-rail', () => Object.freeze({
    schema: 'metaengine.browser.r97-visual.legacy-command-rail.v1',
    requested_open: false,
    effective_open: false,
    presentation_only: true,
    authority_effect: false,
  }));
  ipcMain.handle('metaengine:shell:primary-context-drawer', () => Object.freeze({
    schema: 'metaengine.browser.r97-visual.legacy-context-drawer.v1',
    requested_open: false,
    effective_open: false,
    presentation_only: true,
    authority_effect: false,
  }));
  ipcMain.handle('metaengine:shell:primary-chat-fleet-roster', () => fixtureRoster(selectedActor));
  ipcMain.handle('metaengine:shell:primary-chat-actor-select', (_event, rawActorId) => {
    const actorId = String(rawActorId || '');
    const match = fixtureRoster(selectedActor).actors.find((row) => row.actor_id === actorId);
    if (!match) throw new Error('visual_actor_not_bound');
    selectedActor = actorId;
    return Object.freeze({
      schema: 'metaengine.browser.primary-chat-actor-selection.v1',
      actor_id: actorId,
      actor_type: match.actor_type,
      tab_id: match.tab_id,
      selection_applied: true,
      exact_native_binding: true,
      presentation_only: true,
      authority_effect: false,
    });
  });
  ipcMain.handle('metaengine:client:select-agent', (_event, rawAgentId) => {
    const agentId = String(rawAgentId || '').trim().toLowerCase();
    const actorId = `agent:${agentId}`;
    const match = fixtureRoster(selectedActor).actors.find(
      (row) => row.actor_id === actorId && row.actor_type === 'AGENT',
    );
    if (!match) throw new Error('visual_client_agent_not_bound');
    if (rejectNextAgentSelection) {
      rejectNextAgentSelection = false;
      return Object.freeze({ schema:'metaengine.client.agent-selection.v1', agent_id:agentId,
        actor_id:'agent:stale_actor', tab_id:match.tab_id, selection_applied:true, exact_native_binding:true,
        presentation_only:true, authority_effect:false });
    }
    selectedActor = actorId;
    return Object.freeze({
      schema: 'metaengine.client.agent-selection.v1',
      agent_id: agentId,
      actor_id: actorId,
      tab_id: match.tab_id,
      selection_applied: true,
      exact_native_binding: true,
      presentation_only: true,
      scheduler_authority: false,
      browser_actuation_authority: false,
      update_authority: false,
      authority_effect: false,
    });
  });
  ipcMain.handle('metaengine:client:submit-goal', (_event, rawGoal) => {
    const goal = String(rawGoal || '').trim();
    if (!goal || goal.length > 480) throw new Error('visual_client_goal_invalid');
    goalSubmitCount += 1;
    const taskId = '11111111-1111-4111-8111-111111111112';
    const pointId = 'obj.visual-client-goal.v1';
    const receipt = Object.freeze({
      schema: 'metaengine.client.goal-submission.v1',
      request_id: '11111111-1111-4111-8111-111111111111',
      request_replayed: false,
      exact_request_correlation: true,
      goal,
      objective_id: 'metaengine-client-v1:g1',
      roadmap_id: 'metaengine-client-v1',
      plan_generation: 1,
      point_ids: Object.freeze([pointId]),
      node_count: 1,
      task_id: taskId,
      task_ids: Object.freeze([taskId]),
      task_admission_state: 'ADMITTED',
      atomic_plan_and_admission: true,
      exact_activation_readback: true,
      operator_initiated: true,
      automatic_retry_allowed: false,
      scheduler_authority: false,
      browser_actuation_authority: false,
      release_authority: false,
      authority_effect: false,
    });
    latestGoal = { schema: 'metaengine.client.goal-journal-entry.v1', request_id: receipt.request_id,
      goal, state: 'ADMITTED', receipt, progress: null, execution_proof: null, last_error: null,
      automatic_retry_allowed: false, authority_effect: false };
    return receipt;
  });
  ipcMain.handle('metaengine:client:latest-goal', () => latestGoal);
  ipcMain.handle('metaengine:client:goal-status', () => {
    if (!latestGoal) return null;
    const progress = { schema: 'metaengine.client.goal-progress.v1', request_id: latestGoal.request_id,
      task_id: latestGoal.receipt.task_id, found: true, task_state: 'READY', terminal: false,
      reconciliation_required: false, automatic_retry_allowed: false, authority_effect: false };
    latestGoal = { ...latestGoal, progress };
    return progress;
  });
}

async function waitFor(contents, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await contents.executeJavaScript(`Boolean(${expression})`);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`r97_visual_wait_timeout:${expression}`);
}

async function settle(contents) {
  await withTimeout(contents.executeJavaScript(`Promise.race([
    document.fonts?.ready ? document.fonts.ready.then(() => 'fonts-ready') : Promise.resolve('fonts-unavailable'),
    new Promise((resolve) => setTimeout(() => resolve('fonts-timeout'), 3000))
  ])`), 5000, 'fonts');
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function metrics(contents) {
  return contents.executeJavaScript(`(() => {
    const rect = (id) => {
      const el = document.querySelector('[data-testid="' + id + '"]');
      if (!el || el.getClientRects().length === 0) return null;
      const r = el.getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height };
    };
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    const rgba = (color) => { ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data]; };
    const composite = (fg,bg) => fg.slice(0,3).map((v,i) => v*fg[3]/255+bg[i]*(1-fg[3]/255));
    const luminance = (rgb) => rgb.map((v) => { const c=v/255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }).reduce((n,v,i)=>n+v*[0.2126,0.7152,0.0722][i],0);
    const paletteTextStyles = [...document.querySelectorAll('[data-palette-detail], [data-palette-scope]')].filter((el)=>el.getClientRects().length).map((el)=>{
      const ancestors=[]; for(let n=el;n;n=n.parentElement) ancestors.unshift(n);
      let bg=[0,0,0]; for(const n of ancestors) bg=composite(rgba(getComputedStyle(n).backgroundColor),bg);
      const style=getComputedStyle(el); const fg=composite(rgba(style.color),bg);
      const a=luminance(fg), b=luminance(bg);
      return { text:el.textContent, font_size:parseFloat(style.fontSize), contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05) };
    });
    return {
      palette_text_styles: paletteTextStyles,
      palette_svg_count: document.querySelectorAll('[cmdk-root] svg').length,
      topbar: rect('topbar'),
      primary: rect('primary-chat-fleet'),
      rail: rect('chat-fleet-rail'),
      native_slot: rect('native-chat-surface-slot'),
      cmdbar: rect('global-cmdbar'),
      settings: rect('settings-button'),
      goal_composer: rect('client-goal-composer'),
      goal_input: rect('client-goal-input'),
      goal_submit: rect('client-goal-submit'),
      goal_readback: document.querySelector('[data-testid="client-goal-readback"]')?.textContent || null,
      supervisor_rows: document.querySelectorAll('[data-testid="chat-supervisor-row"]').length,
      agent_rows: document.querySelectorAll('[data-testid="chat-agent-row"]').length,
      page: document.querySelector('[data-testid="page-outlet"]')?.getAttribute('data-page') || null,
      pagebar_present: Boolean(document.querySelector('[data-testid="pagebar"]')),
      statusbar_present: Boolean(document.querySelector('[data-testid="statusbar"]')),
      context_drawer_present: Boolean(document.querySelector('[data-testid="context-drawer"]')),
      run_inspector_present: Boolean(document.querySelector('[data-testid="run-telemetry-inspector"]')),
      palette_present: Boolean(document.querySelector('[cmdk-root], [role="dialog"]')),
      focused_test_id: document.activeElement?.getAttribute('data-testid') || null,
      settings_area_count: document.querySelectorAll('[data-testid="settings-areas"] [role="tab"]').length,
      settings_route_count: document.querySelectorAll('[data-testid^="settings-open-"]').length,
      task_details: document.querySelector('[data-testid="client-goal-status-dialog"]')?.textContent || null,
      native_work_readiness: document.querySelector('[data-testid="native-work-readiness"]')?.textContent || null,
      work_badge: (() => { const badge = document.querySelector('[data-testid="admin-connection-badge"]');
        return badge ? { text: badge.textContent, admin_ready: badge.getAttribute('data-admin-ready'),
          state: badge.getAttribute('data-work-state'), reason: badge.getAttribute('data-work-reason'),
          autonomous_ready_color: badge.classList.contains('text-emerald-300') } : null; })(),
      legacy_runtime_panels_present: Boolean(document.querySelector('#sys-mech, #sys-contract, [data-testid="me-matrix"]')),
      horizontal_overflow: document.documentElement.scrollWidth > innerWidth,
      body_background: getComputedStyle(document.body).backgroundColor,
    };
  })()`);
}

async function capture(view, name) {
  await settle(view.webContents);
  const image = await withTimeout(view.webContents.capturePage(), 10_000, `capture:${name}`);
  const png = image.toPNG();
  if (png.length < 4096) throw new Error(`r97_visual_png_too_small:${name}:${png.length}`);
  const file = path.join(OUTPUT_ROOT, `${name}.png`);
  await fs.writeFile(file, png);
  return Object.freeze({
    name,
    file: path.basename(file),
    bytes: png.length,
    sha256: digest(png),
    metrics: await metrics(view.webContents),
  });
}

function assertMain(row) {
  const m = row.metrics;
  if (Math.round(m?.topbar?.height || 0) !== 42) throw new Error(`r97_visual_topbar_height:${m?.topbar?.height}`);
  if (m?.page !== 'browser') throw new Error(`r97_visual_start_page:${m?.page}`);
  if (!m?.primary || !m?.rail || !m?.native_slot) throw new Error('r97_visual_primary_workspace_missing');
  if (Math.round(m.rail.width || 0) !== 288) throw new Error(`r97_visual_rail_width:${m.rail.width}`);
  if (Math.round(m.native_slot.x || 0) !== 288) throw new Error(`r97_visual_native_slot_x:${m.native_slot.x}`);
  if (Math.round(m.native_slot.width || 0) !== 1152) throw new Error(`r97_visual_native_slot_width:${m.native_slot.width}`);
  if (m.supervisor_rows !== 1 || m.agent_rows !== 2) {
    throw new Error(`r97_visual_actor_rows:${m.supervisor_rows}:${m.agent_rows}`);
  }
  if (!m.cmdbar || !m.settings) throw new Error('r97_visual_global_search_or_settings_missing');
  if (!m.goal_composer || !m.goal_input || !m.goal_submit) throw new Error('r97_visual_client_goal_composer_missing');
  const plan = planShellLayout({ width:1440, height:960, state:normalizeShellLayoutState(), surface_profile:'ME2_R95_RUN' });
  for (const key of ['x','y','width','height']) {
    if (Math.round(m.native_slot[key]) !== plan.remote_bounds[key]) throw new Error(`ui1_native_renderer_geometry_drift:${key}`);
  }
  if (Math.round(m.goal_composer.y + m.goal_composer.height) !== plan.remote_bounds.y) throw new Error('ui1_native_view_covers_goal_composer');
  if (m.horizontal_overflow) throw new Error('ui1_main_horizontal_overflow');
  if (m.pagebar_present || m.statusbar_present || m.context_drawer_present || m.run_inspector_present) {
    throw new Error(`r97_visual_legacy_persistent_chrome_present:${JSON.stringify(m)}`);
  }
  if (m.palette_present) throw new Error('r97_visual_palette_should_start_closed');
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error(JSON.stringify({
      schema: 'metaengine.browser.r97-visual-evidence.v1',
      ok: false,
      error: `r97_visual_phase_watchdog:${phase}`,
      authority_effect: false,
    }));
    app.exit(2);
  }, VISUAL_PHASE_TIMEOUT_MS);

  await withTimeout(app.whenReady(), 20_000, 'app_ready');
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  installRemoteBrowserTransportFence();
  registerPresentationIpc();

  markPhase('START_UI_HOST');
  const { startMe2UiHost, stopMe2UiHostAndWait } = await import('../src/me2/me2-ui-host.mjs');
  const { startMe2UiGateway, stopMe2UiGateway } = await import('../src/me2/me2-ui-gateway.mjs');
  const host = await withTimeout(startMe2UiHost(), 25_000, 'start_ui_host');
  if (!['HEALTHY','ADOPTED'].includes(host.state)) throw new Error(`r97_visual_ui_host_not_ready:${JSON.stringify(host)}`);
  const gateway = await withTimeout(startMe2UiGateway(), 10_000, 'start_gateway');
  if (gateway.state !== 'LIVE' || !gateway.url) throw new Error(`r97_visual_gateway_not_ready:${JSON.stringify(gateway)}`);

  const windowRef = new BaseWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: '#09090b',
    title: 'METAENGINE R97 Visual Qualification',
  });
  const shellView = new WebContentsView({
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  windowRef.contentView.addChildView(shellView);
  shellView.setBounds({ x:0, y:0, width:1440, height:960 });

  const evidence = {
    schema: 'metaengine.browser.r97-visual-evidence.v1',
    source_head: String(process.env.ME2_BUILD_SHA || ''),
    ok: false,
    captures: [],
    exact_main_workspace: false,
    advanced_surfaces_settings_only: false,
    command_search_available: false,
    primary_me2_ui_captured: true,
    legacy_shell_captured: false,
    remote_browser_content_captured: false,
    remote_browser_transport_blocked: true,
    blocked_remote_browser_ports: ['3042','3043'],
    presentation_only: true,
    authority_effect: false,
  };

  try {
    markPhase('LOAD_PRIMARY_CHAT_FLEET');
    await withTimeout(shellView.webContents.loadURL(`${gateway.url}/#browser`), 25_000, 'load_primary');
    shellView.webContents.setZoomFactor(1);
    windowRef.show();

    await waitFor(shellView.webContents, "document.querySelector('[data-testid=primary-chat-fleet]')");
    await waitFor(shellView.webContents, "document.querySelectorAll('[data-testid=chat-agent-row]').length === 2");
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=admin-connection-badge]')?.getAttribute('data-admin-ready') === 'true' && document.querySelector('[data-testid=admin-connection-badge]')?.getAttribute('data-work-reason') === 'SUPERVISOR_RECOVERY_REQUIRED'");
    const mainCapture = await capture(shellView, 'r97-chat-fleet-main-1440x960');
    assertMain(mainCapture);
    if (mainCapture.metrics.work_badge?.state !== 'BLOCKED' || mainCapture.metrics.work_badge?.text !== 'Recovery required') throw new Error('ui1_admin_connection_masquerades_as_execution_ready');
    evidence.captures.push(mainCapture);
    evidence.exact_main_workspace = true;
    evidence.connected_not_ready_verified = true;
    evidence.readiness_subject = { kind: 'CONTROLLED_NATIVE_IPC_FIXTURE', live_agent_execution: false };

    markPhase('POSITIVE_READINESS_READBACK');
    runtimeFixtureMode = 'READY';
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=admin-connection-badge]')?.getAttribute('data-work-state') === 'READY'");
    const readyCapture = await capture(shellView, 'ui1-readiness-ready-1440x960');
    if (readyCapture.metrics.work_badge?.text !== 'Chats ready') throw new Error('ui1_positive_chat_readiness_label_missing');
    if (readyCapture.metrics.work_badge?.autonomous_ready_color === true) throw new Error('ui1_chat_readiness_masquerades_as_autonomous_coding');
    evidence.captures.push(readyCapture);
    evidence.positive_readiness_verified = true;

    markPhase('NATIVE_COMPOSER_GEOMETRY');
    geometryFixture = new WebContentsView({ webPreferences:{ nodeIntegration:false, contextIsolation:true, sandbox:true } });
    windowRef.contentView.addChildView(geometryFixture);
    const physicalPlan = planShellLayout({ width:1440, height:960, state:normalizeShellLayoutState(), surface_profile:'ME2_R95_RUN' });
    geometryFixture.setBounds(physicalPlan.remote_bounds);
    await geometryFixture.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#151518;color:#a1a1aa;font:14px Arial;padding:24px"><h1>Native geometry fixture</h1><p>Local test content. This is not a live z.ai conversation.</p></body>'));
    if (!Object.entries(physicalPlan.remote_bounds).every(([key,value]) => geometryFixture.getBounds()[key] === value)) throw new Error('ui1_native_bounds_readback_failed');
    evidence.native_geometry_verified = true;
    evidence.native_geometry_subject = { kind:'LOCAL_WEB_CONTENTS_VIEW_FIXTURE', bounds:geometryFixture.getBounds(), live_agent_execution:false };

    markPhase('SUBMIT_TYPED_GOAL');
    await shellView.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('[data-testid="client-goal-input"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Qualify the typed Client goal bridge');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=client-goal-input]')?.value === 'Qualify the typed Client goal bridge'");
    await shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="client-goal-input"]')?.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', isComposing:true, bubbles:true })); true`);
    await settle(shellView.webContents);
    if (goalSubmitCount !== 0) throw new Error('ui1_ime_enter_submitted_goal');
    evidence.ime_submission_guard_verified = true;
    await shellView.webContents.executeJavaScript(
      `document.querySelector('[data-testid="client-goal-submit"]')?.click(); true`,
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=client-goal-readback]')?.textContent?.includes('Queued')");
    const goalCapture = await capture(shellView, 'r97-client-goal-admitted-1440x960');
    if (!String(goalCapture.metrics.goal_readback || '').includes('Queued') || String(goalCapture.metrics.goal_readback || '').includes('verified')) {
      throw new Error(`r97_visual_client_goal_readback_invalid:${goalCapture.metrics.goal_readback}`);
    }
    evidence.captures.push(goalCapture);

    markPhase('TASK_STATUS_FOCUS');
    await shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="client-goal-details"]')?.focus(); document.querySelector('[data-testid="client-goal-details"]')?.click(); true`);
    await waitFor(shellView.webContents, "Boolean(document.querySelector('[data-testid=client-goal-status-dialog]'))");
    const detailCapture = await capture(shellView, 'ui1-task-status-1440x960');
    if (!detailCapture.metrics.task_details?.includes('Not yet verified') || !detailCapture.metrics.task_details?.includes('11111111-1111-4111-8111-111111111112')) throw new Error('ui1_task_status_readback_missing');
    if (geometryFixture.getVisible()) throw new Error('ui1_native_fixture_overlays_task_status');
    evidence.captures.push(detailCapture);
    shellView.webContents.focus();
    shellView.webContents.sendInputEvent({ type:'keyDown', keyCode:'Escape' });
    shellView.webContents.sendInputEvent({ type:'keyUp', keyCode:'Escape' });
    await waitFor(shellView.webContents, "!document.querySelector('[data-testid=client-goal-status-dialog]') && document.activeElement?.getAttribute('data-testid') === 'client-goal-details'");
    evidence.goal_status_focus_verified = true;

    markPhase('SELECT_AGENT');
    await shellView.webContents.executeJavaScript(
      `document.querySelector('[data-testid="chat-agent-row"]')?.click(); true`,
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=chat-agent-row]')?.getAttribute('aria-current') === 'page'");
    evidence.captures.push(await capture(shellView, 'r97-chat-fleet-agent-selected-1440x960'));

    markPhase('REJECT_STALE_SELECTION');
    rejectNextAgentSelection = true;
    await shellView.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="chat-agent-row"]')[1]?.click(); true`);
    await waitFor(shellView.webContents, "document.body.textContent.includes('Agent selection was not confirmed')");
    const selectionPreserved = await shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="chat-agent-row"]')?.getAttribute('aria-current') === 'page' && document.querySelectorAll('[data-testid="chat-agent-row"]')[1]?.getAttribute('aria-current') !== 'page'`);
    if (!selectionPreserved) throw new Error('ui1_stale_selection_changed_current_actor');
    evidence.selection_fail_closed = true;
    evidence.captures.push(await capture(shellView, 'ui1-selection-rejected-1440x960'));

    markPhase('OPEN_SETTINGS');
    await shellView.webContents.executeJavaScript(
      `document.querySelector('[data-testid="settings-button"]')?.click(); true`,
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=page-outlet]')?.getAttribute('data-page') === 'system'");
    await waitFor(shellView.webContents, "document.querySelectorAll('[data-testid^=settings-open-]').length === 5");
    const settingsCapture = await capture(shellView, 'r97-settings-advanced-surface-1440x960');
    if (settingsCapture.metrics.primary != null || settingsCapture.metrics.rail != null) {
      throw new Error('r97_visual_main_rail_persisted_inside_settings');
    }
    evidence.captures.push(settingsCapture);
    evidence.advanced_surfaces_settings_only = true;
    if (settingsCapture.metrics.settings_area_count !== 5) throw new Error('ui1_settings_areas_missing');
    if (geometryFixture.getVisible()) throw new Error('ui1_native_fixture_visible_in_settings');

    for (const target of ['tasks','code','supervisor','memory','observability']) {
      await shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-open-${target}"]')?.click(); true`);
      await waitFor(shellView.webContents, `Boolean(document.querySelector('[data-testid="page-${target}"]'))`);
      await shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-button"]')?.click(); true`);
      await waitFor(shellView.webContents, "Boolean(document.querySelector('[data-testid=settings-advanced-surfaces]'))");
    }
    evidence.settings_routes_verified = true;

    markPhase('SETTINGS_OFFLINE_READBACK');
    await shellView.webContents.executeJavaScript(`document.getElementById('settings-tab-runtime')?.click(); true`);
    runtimeFixtureMode = 'PAUSED';
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=admin-connection-badge]')?.getAttribute('data-work-state') === 'PAUSED' && document.querySelector('[data-testid=native-work-readiness]')?.textContent.includes('Execution paused')");
    const pausedCapture = await capture(shellView, 'ui1-settings-runtime-paused-1440x960');
    if (!pausedCapture.metrics.native_work_readiness?.includes('Connected') || pausedCapture.metrics.legacy_runtime_panels_present) throw new Error('ui1_native_runtime_owner_not_distinct');
    evidence.captures.push(pausedCapture);
    evidence.paused_readiness_verified = true;
    runtimeFixtureMode = 'UNAVAILABLE';
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=admin-connection-badge]')?.getAttribute('data-work-state') === 'UNAVAILABLE' && document.querySelector('[data-testid=admin-connection-badge]')?.getAttribute('data-admin-ready') === 'false' && document.querySelector('[data-testid=native-work-readiness]')?.textContent.includes('Status unavailable')");
    const unavailableCapture = await capture(shellView, 'ui1-settings-runtime-unavailable-1440x960');
    if (unavailableCapture.metrics.native_work_readiness?.includes('Chats ready') || unavailableCapture.metrics.native_work_readiness?.includes('profile 28') || unavailableCapture.metrics.legacy_runtime_panels_present) throw new Error('ui1_stale_native_readiness_retained');
    evidence.captures.push(unavailableCapture);
    evidence.stale_readiness_cleared = true;
    evidence.settings_loading_bounded = true;
    runtimeFixtureMode = 'RECOVERY';
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=admin-connection-badge]')?.getAttribute('data-work-reason') === 'SUPERVISOR_RECOVERY_REQUIRED'");

    markPhase('RETURN_MAIN_AND_OPEN_SEARCH');
    await shellView.webContents.executeJavaScript(
      `document.querySelector('[data-testid="brand"]')?.click(); true`,
    );
    await waitFor(shellView.webContents, "document.querySelector('[data-testid=page-outlet]')?.getAttribute('data-page') === 'browser'");

    markPhase('NARROW_AGENT_PICKER');
    windowRef.setContentSize(900, 720);
    shellView.setBounds({ x:0, y:0, width:900, height:720 });
    geometryFixture.setBounds(planShellLayout({ width:900, height:720, state:normalizeShellLayoutState(), surface_profile:'ME2_R95_RUN' }).remote_bounds);
    await settle(shellView.webContents);
    await shellView.webContents.executeJavaScript(`document.querySelector('[data-testid="fleet-picker-toggle"]')?.focus(); document.querySelector('[data-testid="fleet-picker-toggle"]')?.click(); true`);
    await waitFor(shellView.webContents, "Boolean(document.querySelector('[data-testid=fleet-picker]'))");
    if (geometryFixture.getVisible()) throw new Error('ui1_native_fixture_overlays_fleet_picker');
    const narrowCapture = await capture(shellView, 'ui1-agent-picker-900x720');
    if (narrowCapture.metrics.horizontal_overflow) throw new Error('ui1_narrow_horizontal_overflow');
    evidence.captures.push(narrowCapture);
    shellView.webContents.focus();
    shellView.webContents.sendInputEvent({ type:'keyDown', keyCode:'Escape' });
    shellView.webContents.sendInputEvent({ type:'keyUp', keyCode:'Escape' });
    await waitFor(shellView.webContents, "!document.querySelector('[data-testid=fleet-picker]') && document.activeElement?.getAttribute('data-testid') === 'fleet-picker-toggle'");
    evidence.narrow_agent_picker_verified = true;
    windowRef.setContentSize(1440, 960);
    shellView.setBounds({ x:0, y:0, width:1440, height:960 });
    geometryFixture.setBounds(physicalPlan.remote_bounds);
    await settle(shellView.webContents);
    await shellView.webContents.executeJavaScript(
      `document.querySelector('[data-testid="global-cmdbar"]')?.click(); true`,
    );
    await waitFor(shellView.webContents, "Boolean(document.querySelector('[cmdk-root], [role=dialog]'))");
    const searchCapture = await capture(shellView, 'r97-command-search-1440x960');
    if (!searchCapture.metrics.palette_present) throw new Error('r97_visual_command_search_not_visible');
    evidence.captures.push(searchCapture);
    evidence.command_search_available = true;
    if (searchCapture.metrics.palette_text_styles.length < 4 || searchCapture.metrics.palette_text_styles.some((row) => row.font_size < 12 || row.contrast < 4.5) || searchCapture.metrics.palette_svg_count !== 0) throw new Error('ui1_palette_legibility_failed');
    evidence.command_palette_legibility_verified = true;
    if (geometryFixture.getVisible()) throw new Error('ui1_native_fixture_overlays_command_palette');
    shellView.webContents.focus();
    shellView.webContents.sendInputEvent({ type:'keyDown', keyCode:'Escape' });
    shellView.webContents.sendInputEvent({ type:'keyUp', keyCode:'Escape' });
    await waitFor(shellView.webContents, "!document.querySelector('[cmdk-root]') && document.activeElement?.getAttribute('data-testid') === 'global-cmdbar'");
    evidence.command_palette_focus_verified = true;
    if (goalSubmitCount !== 1) throw new Error(`ui1_goal_submission_replayed:${goalSubmitCount}`);
    evidence.goal_submit_once_verified = true;

    // The R97 shell never needs the old remote Browser streaming endpoints.
    // The qualification session blocks both ports for the whole capture window;
    // evidence records the policy even when no request was attempted. Any actual
    // request is cancelled above and observed in blockedRemoteBrowserPorts.
    evidence.remote_browser_transport_blocked = true;
    evidence.blocked_remote_browser_ports = ['3042','3043'];
    evidence.observed_blocked_remote_browser_ports = [...blockedRemoteBrowserPorts].sort();
    evidence.ok = true;
    evidence.capture_count = evidence.captures.length;
    evidence.generated_at = new Date().toISOString();
    await fs.writeFile(path.join(OUTPUT_ROOT, 'r85-visual-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    clearTimeout(watchdog);
    try { if (geometryFixture && !geometryFixture.webContents.isDestroyed()) geometryFixture.webContents.close(); } catch {}
    try { if (!shellView.webContents.isDestroyed()) shellView.webContents.close(); } catch {}
    try { windowRef.destroy(); } catch {}
    try { await stopMe2UiGateway(); } catch {}
    try { await stopMe2UiHostAndWait(); } catch {}
  }
}

main().then(() => app.exit(0)).catch(async (error) => {
  console.error(JSON.stringify({
    schema: 'metaengine.browser.r97-visual-evidence.v1',
    ok: false,
    phase,
    error: String(error?.stack || error?.message || error).slice(0, 4000),
    authority_effect: false,
  }));
  app.exit(1);
});
