import { app, BaseWindow, WebContentsView, ipcMain, protocol } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeShellLayoutState, planShellLayout } from '../src/shell-layout.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(APP_ROOT, 'ui');
const PRELOAD = path.join(APP_ROOT, 'src', 'preload-shell.cjs');
const OUTPUT_ROOT = path.resolve(process.env.METAENGINE_VISUAL_EVIDENCE_DIR || path.join(APP_ROOT, 'visual-evidence'));

protocol.registerSchemesAsPrivileged([{ scheme: 'metaengine', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);
app.enableSandbox();

function mimeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

function tab(tab_id, title, url, kind = 'WEB') {
  return Object.freeze({ tab_id, title, url, kind, role: 'USER' });
}

const TABS = Object.freeze([
  tab('tab_visual_chat', 'Collaboration runtime verification', 'https://chatgpt.com/c/visual-evidence', 'CHATGPT'),
  tab('tab_visual_docs', 'Electron capturePage docs', 'https://www.electronjs.org/docs/latest/api/web-contents'),
  tab('tab_visual_ci', 'Windows package evidence', 'https://github.com/PatrickFrome/Compute/actions'),
  tab('tab_visual_agent_a', 'Research agent', 'https://chatgpt.com/c/research-agent', 'CHATGPT'),
  tab('tab_visual_agent_b', 'Verifier agent', 'https://chatgpt.com/c/verifier-agent', 'CHATGPT'),
  tab('tab_visual_agent_c', 'Implementation agent', 'https://chatgpt.com/c/implementation-agent', 'CHATGPT'),
]);

function task(task_id, objective, status, owner_agent_id, progress_revision, extra = {}) {
  return Object.freeze({
    context_id: 'ctx.visual.integration',
    task_id,
    objective,
    status,
    owner_agent_id,
    progress_revision,
    dependencies: Object.freeze(extra.dependencies || []),
    required_capabilities: Object.freeze(extra.required_capabilities || []),
    blocker: extra.blocker || null,
    created_at: '2026-09-07T04:00:00.000Z',
    updated_at: extra.updated_at || '2026-09-07T04:20:00.000Z',
    assignment_is_advisory: true,
    execution_authority: false,
    scheduler_authority: false,
    authority_effect: false,
  });
}

function brainProjection() {
  const tasks = Object.freeze([
    task('task.visual.active', 'Converge Browser Brain around task-first Now view', 'ACTIVE', 'agent_visual_impl', 4, { required_capabilities: ['implementation', 'ui'] }),
    task('task.visual.blocked', 'Validate the integrated shell on Windows package smoke', 'BLOCKED', 'agent_visual_verify', 3, { blocker: 'Physical package evidence pending', dependencies: ['task.visual.active'], required_capabilities: ['verification'] }),
    task('task.visual.ready', 'Review task-first information hierarchy and accessibility evidence', 'READY', 'agent_visual_research', 2, { dependencies: ['task.visual.active'], required_capabilities: ['research', 'accessibility'] }),
  ]);
  const workbench = Object.freeze({
    schema: 'metaengine.browser-brain.collaboration-workbench.v1',
    contexts: Object.freeze([Object.freeze({
      context_id: 'ctx.visual.integration',
      context_revision: 9,
      last_activity_seq: 27,
      last_activity_at: '2026-09-07T04:22:00.000Z',
      progress: Object.freeze({ ready: 1, active: 1, blocked: 1, completed: 2, failed: 0, active_agents: Object.freeze(['agent_visual_impl', 'agent_visual_verify']), advisory_work_claim_count: 2 }),
      blockers: Object.freeze([Object.freeze({ task_id: 'task.visual.blocked', blocker: 'Physical package evidence pending', progress_revision: 3 })]),
      artifact_refs: Object.freeze(['artifact:visual-shell-png', 'artifact:critical-audit', 'artifact:windows-soak']),
      tasks,
      task_count: tasks.length,
      tasks_truncated: false,
      authority_effect: false,
    })]),
    context_count: 1,
    visible_context_count: 1,
    total_task_count: 5,
    visible_task_count: 3,
    contexts_truncated: false,
    bounded: true,
    message_bodies_exposed: false,
    raw_page_content_exposed: false,
    projection_is_authority: false,
    advisory_only: true,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    work_cycle_limit: null,
    authority_effect: false,
  });
  return Object.freeze({
    schema: 'metaengine.browser-brain.continuous-coordinator.v1',
    collaboration_fabric: Object.freeze({
      schema: 'metaengine.browser-brain.collaboration-runtime.v2',
      workbench,
      episodic_memory: Object.freeze({
        schema: 'metaengine.browser-brain.episodic-memory.v1',
        episode_count: 18,
        semantic_fact_count: 6,
        procedural_playbook_count: 4,
        immutable_provenance: true,
        bounded_memory: true,
        scheduler_authority: false,
        execution_authority: false,
        authority_effect: false,
      }),
      continuous_autonomous_work: true,
      work_cycle_limit: null,
      second_scheduler: false,
      command_leasing: false,
      scheduler_authority: false,
      execution_authority: false,
      authority_effect: false,
    }),
    continuous_autonomous_work: true,
    work_cycle_limit: null,
    second_scheduler: false,
    command_leasing: false,
    scheduler_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}

function snapshotFor(width, height) {
  const layout = planShellLayout({
    width,
    height,
    state: normalizeShellLayoutState({ sidebar: 'EXPANDED', operations: 'OPEN' }),
  });
  return Object.freeze({
    schema: 'metaengine.browser-shell.snapshot.v3',
    version: 'visual-evidence',
    tabs: Object.freeze({ selected_tab_id: 'tab_visual_chat', tabs: TABS, census: Object.freeze({ total: TABS.length, fleet_tabs: 3, user_tabs: 3 }) }),
    downloads: Object.freeze({ active: null, last: null, arbitrary_execution: false, install_authority: false }),
    fleet: Object.freeze({
      counts: Object.freeze({ ACTIVE: 2, BOUND_UNVERIFIED: 1, PROVISIONING_AMBIGUOUS: 0, LOST: 0 }),
      readiness_contract: 'EXACT_TRANSPORT_BINDING_V1',
      policy: Object.freeze({ profile: 'BALANCED' }),
      agents: Object.freeze([
        Object.freeze({ agent_id: 'agent_visual_research', tab_id: 'tab_visual_agent_a', role: 'RESEARCHER', lifecycle_state: 'ACTIVE', generation_epoch: 4, transport_proof: Object.freeze({ state: 'PROVEN' }) }),
        Object.freeze({ agent_id: 'agent_visual_verify', tab_id: 'tab_visual_agent_b', role: 'VERIFIER', lifecycle_state: 'ACTIVE', generation_epoch: 3, transport_proof: Object.freeze({ state: 'PROVEN' }) }),
        Object.freeze({ agent_id: 'agent_visual_impl', tab_id: 'tab_visual_agent_c', role: 'IMPLEMENTER', lifecycle_state: 'BOUND_UNVERIFIED', generation_epoch: 2, transport_proof: null }),
      ]),
    }),
    owner_safety_gates: Object.freeze({ wildcard_disabled: false, overrides: Object.freeze([]), external_platform_gates_overridable: false }),
    development_plane: Object.freeze({ state: 'READY', version: 'visual', browser_actuation_authority: false, direct_promote_current: false }),
    supervisor: Object.freeze({
      supervisor_mode: 'CONTROL', armed: true, running: true, last_error: null, devos_last_error: null,
      last_command_status: 'COMPLETED', generic_tab_effect_binding: 'EXACT_TAB_GENERATION_V1',
      devos_scheduler_source: 'CURRENT_NATIVE_SUPERVISOR', devos_second_polling_loop: false,
      workspace_binding_second_polling_loop: false, arbitrary_eval: false, os_shell_authority: false,
      self_update: Object.freeze({ state: 'CURRENT', current_version: 'visual-evidence', automatic_effect_retry: false, install_effect_barrier_mode: 'DURABLE' }),
      devos_task_cycle: Object.freeze({ state: 'READY', backlog: Object.freeze({ ready: 2, running: 1 }), bound_unverified_dispatch_allowed: false, fleet_transport_proof_before_physical_dispatch: true, durable_effect_delivery_journal: true }),
      supervisor_mesh: Object.freeze({ running: true, last_error: null, mesh: Object.freeze({ mesh_epoch: 12, counts: Object.freeze({ total: 3, active: 3, ambiguous_incarnation: 0 }), actuation_policy: 'EXACT_BINDING_ONLY' }) }),
      worker_observer: Object.freeze({ last_error: null }),
      current_command: null,
      realtime_process_plane: Object.freeze({ schema: 'metaengine.browser.realtime-process-plane.v1', browser_brain: brainProjection(), authority_effect: false }),
    }),
    workspaces: Object.freeze({
      schema: 'metaengine.browser.workspace-workbench-projection.v1', source_state: 'AVAILABLE', source_implemented: true, runtime_deployed: true,
      groups: Object.freeze([]), sessions: TABS, issues: Object.freeze([]),
      counts: Object.freeze({ workspaces: 0, sessions: TABS.length, issues: 0, ready: 0, frozen: 0, reserved: 0 }),
      grouping_authority: 'DURABLE_WORKSPACE_BINDING_ONLY', url_heuristic_grouping: false, title_heuristic_grouping: false,
      automatic_retry_allowed: false, browser_actuation_authority: false, authority_effect: false,
    }),
    compute: Object.freeze({ available: true, result: Object.freeze({ runtime: 'ready' }) }),
    layout,
    policy: Object.freeze({}),
    authority_effect: false,
  });
}

let currentSnapshot = snapshotFor(1440, 960);

ipcMain.handle('metaengine:shell:snapshot', () => currentSnapshot);
ipcMain.handle('metaengine:shell:command', (_event, request = {}) => {
  if (request?.command === 'SHELL_LAYOUT_SET') {
    const requested = request?.payload || {};
    currentSnapshot = Object.freeze({
      ...currentSnapshot,
      layout: Object.freeze({
        ...currentSnapshot.layout,
        requested: Object.freeze({
          sidebar: String(requested.sidebar || currentSnapshot.layout.requested.sidebar).toUpperCase(),
          operations: String(requested.operations || currentSnapshot.layout.requested.operations).toUpperCase(),
        }),
      }),
    });
  }
  return Object.freeze({ ok: true, visual_evidence_only: true, authority_effect: false });
});

async function registerShellProtocol() {
  await protocol.handle('metaengine', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'shell') return new Response('not found', { status: 404 });
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    if (!['index.html', 'app.js', 'app.css', 'dark-workspace.css'].includes(rel)) return new Response('not found', { status: 404 });
    const body = await fs.readFile(path.join(UI_ROOT, rel));
    return new Response(body, { status: 200, headers: { 'content-type': mimeFor(rel), 'cache-control': 'no-store' } });
  });
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function waitForStableShell(contents) {
  await contents.executeJavaScript(`document.fonts?.ready ? document.fonts.ready.then(() => true) : true`);
  await contents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
}

async function routeResetEvidence(contents) {
  return contents.executeJavaScript(`(() => {
    const address = document.getElementById('address');
    const route = document.getElementById('routeKind');
    address.focus();
    address.value = '>status';
    address.dispatchEvent(new Event('input', { bubbles: true }));
    const commandMode = route.textContent;
    address.value = 'https://chatgpt.com/c/visual-evidence';
    address.dispatchEvent(new Event('input', { bubbles: true }));
    return { command_mode: commandMode, restored_mode: route.textContent, restored_chat_class: route.classList.contains('chat') };
  })()`);
}

async function shellMetrics(contents) {
  return contents.executeJavaScript(`(() => {
    const systems = document.getElementById('systems');
    const route = document.getElementById('routeKind');
    const ops = document.getElementById('opsContent');
    const now = document.querySelector('button[data-brain-now="true"]');
    const health = document.querySelector('[data-health-summary]');
    const presence = document.querySelector('.brainPresence');
    const rect = systems.getBoundingClientRect();
    const style = getComputedStyle(systems);
    const opsText = (ops.textContent || '').trim();
    return {
      systems_display: style.display,
      systems_width: rect.width,
      systems_height: rect.height,
      systems_visible: style.display !== 'none' && rect.width > 0 && rect.height > 0,
      health_summary: (health?.textContent || '').trim(),
      brain_presence: (presence?.textContent || '').trim(),
      now_visible: Boolean(now && !now.hidden),
      now_active: now?.classList.contains('active') === true,
      task_first_sections: ['Current work', 'Why / current binding', 'Blockers', 'Team', 'Artifacts', 'Timeline', 'Memory'].every((label) => opsText.includes(label)),
      task_objective_visible: opsText.includes('Converge Browser Brain around task-first Now view'),
      blocker_visible: opsText.includes('Physical package evidence pending'),
      route_mode: route.textContent,
      ops_text_length: opsText.length,
      body_sidebar: document.body.dataset.sidebar || null,
      body_operations: document.body.dataset.operations || null,
    };
  })()`);
}

async function capture(shellView, windowRef, name, width, height) {
  currentSnapshot = snapshotFor(width, height);
  windowRef.setBounds({ x: 40, y: 40, width, height });
  shellView.setBounds({ x: 0, y: 0, width, height });
  shellView.webContents.send('metaengine:shell:snapshot', currentSnapshot);
  await waitForStableShell(shellView.webContents);
  const image = await shellView.webContents.capturePage();
  const png = image.toPNG();
  if (png.length < 4096) throw new Error(`visual_evidence_png_too_small:${name}:${png.length}`);
  const file = path.join(OUTPUT_ROOT, `${name}.png`);
  await fs.writeFile(file, png);
  return Object.freeze({ name, width, height, file: path.basename(file), bytes: png.length, sha256: digest(png), metrics: await shellMetrics(shellView.webContents) });
}

async function main() {
  await app.whenReady();
  await registerShellProtocol();
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });

  const windowRef = new BaseWindow({ width: 1440, height: 960, show: false, backgroundColor: '#090c11', title: 'METAENGINE Browser Visual Evidence' });
  const shellView = new WebContentsView({ webPreferences: { preload: PRELOAD, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  windowRef.contentView.addChildView(shellView);
  shellView.setBounds({ x: 0, y: 0, width: 1440, height: 960 });

  try {
    await shellView.webContents.loadURL('metaengine://shell/');
    shellView.webContents.setZoomFactor(1);
    windowRef.show();
    await waitForStableShell(shellView.webContents);

    const routeReset = await routeResetEvidence(shellView.webContents);
    if (routeReset.command_mode !== 'CMD' || routeReset.restored_mode !== 'CHAT' || routeReset.restored_chat_class !== true) {
      throw new Error(`visual_evidence_route_reset_invalid:${JSON.stringify(routeReset)}`);
    }

    const allCaptures = [
      await capture(shellView, windowRef, 'shell-1920x1080', 1920, 1080),
      await capture(shellView, windowRef, 'shell-1440x960', 1440, 960),
      await capture(shellView, windowRef, 'shell-1100x760', 1100, 760),
      await capture(shellView, windowRef, 'shell-1024x720', 1024, 720),
    ];
    if (!allCaptures.every((row) => row.metrics.systems_visible === true)) throw new Error('visual_evidence_health_hidden');
    if (!allCaptures.every((row) => row.metrics.health_summary.length > 0)) throw new Error('visual_evidence_health_summary_missing');
    if (!allCaptures.every((row) => row.metrics.now_visible === true && row.metrics.now_active === true)) throw new Error('visual_evidence_now_not_primary');
    if (!allCaptures.every((row) => row.metrics.task_first_sections === true && row.metrics.task_objective_visible === true && row.metrics.blocker_visible === true)) throw new Error('visual_evidence_task_first_brain_missing');
    if (!allCaptures.every((row) => row.metrics.ops_text_length > 400)) throw new Error('visual_evidence_brain_not_rendered');
    const byName = Object.fromEntries(allCaptures.map((row) => [row.name, row]));
    if (byName['shell-1920x1080']?.metrics.body_sidebar !== 'EXPANDED' || byName['shell-1920x1080']?.metrics.body_operations !== 'OPEN') throw new Error('visual_evidence_wide_layout_not_exact');
    if (byName['shell-1100x760']?.metrics.body_sidebar !== 'COMPACT' || byName['shell-1100x760']?.metrics.body_operations !== 'OPEN') throw new Error('visual_evidence_1100_layout_not_exact');
    if (byName['shell-1024x720']?.metrics.body_sidebar !== 'COMPACT' || byName['shell-1024x720']?.metrics.body_operations !== 'CLOSED') throw new Error('visual_evidence_1024_layout_not_exact');

    const captures = allCaptures.filter((row) => row.name === 'shell-1440x960' || row.name === 'shell-1100x760');
    if (captures.length !== 2) throw new Error('visual_evidence_legacy_capture_projection_invalid');
    const evidence = Object.freeze({
      schema: 'metaengine.browser-shell.visual-evidence.v1',
      visual_evidence_version: 2,
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      route_reset: routeReset,
      captures,
      extended_captures: allCaptures,
      extended_viewport_count: allCaptures.length,
      task_first_brain_proven: true,
      textual_health_summary_proven: true,
      shell_only_capture: true,
      remote_browser_content_captured: false,
      golden_comparison_enabled: false,
      authority_effect: false,
    });
    const evidencePath = path.join(OUTPUT_ROOT, 'visual-evidence.json');
    await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence));
  } finally {
    try { shellView.webContents.close(); } catch {}
    try { windowRef.destroy(); } catch {}
    app.exit(0);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ schema: 'metaengine.browser-shell.visual-evidence.v1', visual_evidence_version: 2, ok: false, error: String(error?.stack || error), authority_effect: false }));
  app.exit(1);
});
