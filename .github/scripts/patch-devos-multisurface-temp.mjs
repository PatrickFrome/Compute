import { readFile, writeFile } from 'node:fs/promises';

const paths = {
  main: 'apps/metaengine-browser/src/main.mjs',
  app: 'apps/metaengine-browser/ui/app.js',
  css: 'apps/metaengine-browser/ui/dark-workspace.css',
  shellViewModel: 'apps/metaengine-browser/src/metaengine-devos-shell-view-model.mjs',
};

function replaceOne(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}:expected_1:got_${count}`);
  return source.replace(before, after);
}

function replaceRegex(source, regex, after, label) {
  const matches = source.match(regex);
  if (!matches) throw new Error(`${label}:missing`);
  const probe = new RegExp(regex.source, regex.flags.replace('g', '') + (regex.flags.includes('g') ? '' : ''));
  const first = source.match(probe);
  if (!first) throw new Error(`${label}:missing_probe`);
  const tail = source.slice((first.index || 0) + first[0].length);
  if (tail.match(probe)) throw new Error(`${label}:multiple`);
  return source.replace(probe, after);
}

let main = await readFile(paths.main, 'utf8');
main = replaceOne(main,
  "import { normalizeShellLayoutState, planShellLayout, SHELL_TOP_HEIGHT } from './shell-layout.mjs';\nimport { createDevOSPresentationFocusState } from './metaengine-devos-presentation-focus.mjs';",
  "import { normalizeShellLayoutState, planShellLayout, SHELL_TOP_HEIGHT } from './shell-layout.mjs';\nimport { createDevOSSessionLayoutRegistry } from './metaengine-devos-session-layout.mjs';\nimport { planDevOSSurfaceGrid } from './metaengine-devos-surface-grid.mjs';\nimport { createDevOSPresentationFocusState } from './metaengine-devos-presentation-focus.mjs';",
  'main_imports');
main = replaceOne(main,
  "const devosPresentationFocus = createDevOSPresentationFocusState();\nlet shellLayoutState = normalizeShellLayoutState();\nlet shellLayoutPlan = null;",
  "const devosPresentationFocus = createDevOSPresentationFocusState();\nconst devosSessionLayouts = createDevOSSessionLayoutRegistry({ max_sessions: 128 });\nlet shellLayoutState = normalizeShellLayoutState();\nlet shellLayoutPlan = null;\nlet devosSurfaceGridPlan = null;\nlet devosSessionLayoutsLoaded = false;",
  'main_globals');
main = replaceOne(main,
  "function supervisorIdentityPath() {\n  return path.join(app.getPath('userData'), 'metaengine-native-supervisor-device-v1.json');\n}\n",
  "function supervisorIdentityPath() {\n  return path.join(app.getPath('userData'), 'metaengine-native-supervisor-device-v1.json');\n}\n\nfunction devosSessionLayoutStatePath() {\n  return path.join(app.getPath('userData'), 'metaengine-devos-session-layout-registry-v1.json');\n}\n\nasync function initDevOSSessionLayouts() {\n  if (devosSessionLayoutsLoaded) return devosSessionLayouts.snapshot();\n  devosSessionLayoutsLoaded = true;\n  try {\n    const snapshot = JSON.parse(await fs.readFile(devosSessionLayoutStatePath(), 'utf8'));\n    devosSessionLayouts.restore(snapshot);\n  } catch (error) {\n    if (error?.code !== 'ENOENT') {\n      console.error(JSON.stringify({ schema: 'metaengine.devos.session-layout-load.v1', state: 'DEGRADED', reason: String(error?.message || error).slice(0, 240), fallback: 'IN_MEMORY_DEFAULTS', authority_effect: false }));\n    }\n  }\n  return devosSessionLayouts.snapshot();\n}\n\nasync function saveDevOSSessionLayouts() {\n  const target = devosSessionLayoutStatePath();\n  const temp = target + '.tmp';\n  await fs.mkdir(path.dirname(target), { recursive: true });\n  await fs.writeFile(temp, JSON.stringify(devosSessionLayouts.snapshot(), null, 2) + '\\n', { mode: 0o600 });\n  await fs.rename(temp, target);\n  return devosSessionLayouts.snapshot();\n}\n",
  'layout_persistence');
main = replaceOne(main,
  "    presentation_focus: devosPresentationFocus.snapshot(),\n  }).devos;",
  "    presentation_focus: devosPresentationFocus.snapshot(),\n    session_layouts: devosSessionLayouts.snapshot(),\n  }).devos;",
  'current_projection_layout');
main = replaceOne(main,
  "  registry.select(id);\n  attachSelected();\n  invalidatePerception();",
  "  registry.select(id);\n  attachSelected({ force_single_selected: true });\n  invalidatePerception();",
  'presentation_exact_activation');
main = replaceOne(main,
  "  const presentationFocus = devosPresentationFocus.snapshot();\n  const workspaces = projectWorkspaceWorkbench({",
  "  const presentationFocus = devosPresentationFocus.snapshot();\n  const sessionLayouts = devosSessionLayouts.snapshot();\n  const workspaces = projectWorkspaceWorkbench({",
  'snapshot_layout_local');
main = replaceOne(main,
  "    compute,\n    presentation_focus: presentationFocus,\n  });",
  "    compute,\n    presentation_focus: presentationFocus,\n    session_layouts: sessionLayouts,\n  });",
  'snapshot_projection_layout');
main = replaceOne(main,
  "    compute,\n    layout: shellLayoutPlan ? structuredClone(shellLayoutPlan) : null,",
  "    compute,\n    layout: shellLayoutPlan ? structuredClone(shellLayoutPlan) : null,\n    surface_grid: devosSurfaceGridPlan ? structuredClone(devosSurfaceGridPlan) : null,\n    session_layouts: structuredClone(sessionLayouts),",
  'snapshot_surface_grid');

const newLayout = [
  "function currentDevOSPresentationShellView() {",
  "  return projectWorkspaceWorkbench({",
  "    tabs: registry.snapshot(),",
  "    fleet: fleet?.snapshot() || null,",
  "    supervisor: nativeSupervisor?.snapshot() || null,",
  "    presentation_focus: devosPresentationFocus.snapshot(),",
  "    session_layouts: devosSessionLayouts.snapshot(),",
  "  }).devos_shell;",
  "}",
  "",
  "function fallbackSelectedSurface() {",
  "  const selected = registry.selected();",
  "  if (!selected) return [];",
  "  return [{",
  "    surface_id: 'browser:' + selected.tab_id,",
  "    session_id: 'session:browser-fallback',",
  "    type: 'BROWSER',",
  "    title: selected.title || 'Browser',",
  "    tab_id: selected.tab_id,",
  "    projection_is_authority: false, scheduler_authority: false, execution_authority: false, command_leasing: false,",
  "    automatic_effect_retry_allowed: false, page_model_authority: false, authority_effect: false,",
  "  }];",
  "}",
  "",
  "function computeDevOSSurfaceGrid() {",
  "  if (!shellLayoutPlan) return null;",
  "  const shell = currentDevOSPresentationShellView();",
  "  const focusedSession = shell?.valid === true && shell.selected_session ? shell.selected_session : null;",
  "  const surfaces = focusedSession ? shell.selected_session_surfaces : fallbackSelectedSurface();",
  "  const preferredSurfaceId = focusedSession ? (shell.selected_surface?.surface_id || shell.layout_preferences?.stored_surface_id || null) : null;",
  "  const focusedSurfaceId = preferredSurfaceId && surfaces.some((row) => row.surface_id === preferredSurfaceId) ? preferredSurfaceId : null;",
  "  const requestedLayout = focusedSession ? (shell.layout_preferences?.requested_surface_layout || 'AUTO') : 'SINGLE';",
  "  return planDevOSSurfaceGrid({ bounds: shellLayoutPlan.remote_bounds, surfaces, focused_surface_id: focusedSurfaceId, requested_layout: requestedLayout });",
  "}",
  "",
  "function layout() {",
  "  if (!windowRef || windowRef.isDestroyed()) return;",
  "  const { width, height } = windowRef.getContentBounds();",
  "  shellLayoutPlan = planShellLayout({ width, height, state: shellLayoutState });",
  "  shellView?.setBounds(shellLayoutPlan.shell_bounds);",
  "  if (shellView) { try { windowRef.contentView.addChildView(shellView); } catch {} }",
  "  devosSurfaceGridPlan = computeDevOSSurfaceGrid();",
  "  const browserPaneByTab = new Map((devosSurfaceGridPlan?.browser_panes || []).map((pane) => [String(pane.tab_id || ''), pane]));",
  "  for (const [tabId, view] of views) {",
  "    const pane = browserPaneByTab.get(String(tabId));",
  "    if (pane && !view.webContents.isDestroyed()) {",
  "      try { windowRef.contentView.addChildView(view); } catch {}",
  "      view.setBounds(pane.content_bounds);",
  "    } else {",
  "      try { windowRef.contentView.removeChildView(view); } catch {}",
  "    }",
  "  }",
  "}",
  "",
  "function attachSelected({ force_single_selected = false } = {}) {",
  "  if (!windowRef) return;",
  "  if (shellView) { try { windowRef.contentView.addChildView(shellView); } catch {} }",
  "  if (!shellLayoutPlan) {",
  "    const { width, height } = windowRef.getContentBounds();",
  "    shellLayoutPlan = planShellLayout({ width, height, state: shellLayoutState });",
  "    shellView?.setBounds(shellLayoutPlan.shell_bounds);",
  "  }",
  "  if (force_single_selected) {",
  "    const selected = registry.selected();",
  "    for (const [tabId, view] of views) {",
  "      if (tabId === selected?.tab_id && !view.webContents.isDestroyed()) {",
  "        try { windowRef.contentView.addChildView(view); } catch {}",
  "        view.setBounds(shellLayoutPlan.remote_bounds);",
  "      } else {",
  "        try { windowRef.contentView.removeChildView(view); } catch {}",
  "      }",
  "    }",
  "    return;",
  "  }",
  "  layout();",
  "}",
  "",
  "function invalidatePerception",
].join('\n');
main = replaceRegex(main, /function layout\(\) \{[\s\S]*?function invalidatePerception/, newLayout, 'main_multisurface_layout');
main = replaceOne(main,
  "  if (command === 'SHELL_LAYOUT_SET') {\n    shellLayoutState = normalizeShellLayoutState(payload);\n    layout();\n    await publishSnapshot();\n    return shellLayoutPlan ? structuredClone(shellLayoutPlan) : null;\n  }",
  "  if (command === 'SHELL_LAYOUT_SET') {\n    shellLayoutState = normalizeShellLayoutState(payload);\n    layout();\n    await publishSnapshot();\n    return shellLayoutPlan ? structuredClone(shellLayoutPlan) : null;\n  }\n  if (command === 'DEVOS_SURFACE_LAYOUT_SET') {\n    const sessionId = String(payload?.session_id || '');\n    const devos = currentDevOSPresentationProjection();\n    if (!devos.sessions.some((row) => String(row.session_id) === sessionId)) throw new Error('devos_surface_layout_session_not_found');\n    const entry = devosSessionLayouts.setSurfaceLayout(sessionId, payload?.layout);\n    await saveDevOSSessionLayouts();\n    layout();\n    await publishSnapshot();\n    return entry;\n  }",
  'layout_command');
main = replaceOne(main,
  "ipcMain.handle('metaengine:shell:presentation-focus:select-session', async (event, sessionId) => {\n  assertShellSender(event);\n  const result = applyPresentationFocusIntent({ intent: 'SESSION', session_id: sessionId });\n  if (result.applied || result.browser_activation_performed) await publishSnapshot();\n  return result;\n});",
  "ipcMain.handle('metaengine:shell:presentation-focus:select-session', async (event, sessionId) => {\n  assertShellSender(event);\n  const result = applyPresentationFocusIntent({ intent: 'SESSION', session_id: sessionId });\n  if (result.applied) {\n    devosSessionLayouts.activate(String(sessionId));\n    await saveDevOSSessionLayouts();\n    layout();\n  }\n  if (result.applied || result.browser_activation_performed) await publishSnapshot();\n  return result;\n});",
  'focus_session_layout');
main = replaceOne(main,
  "ipcMain.handle('metaengine:shell:presentation-focus:select-surface', async (event, sessionId, surfaceId) => {\n  assertShellSender(event);\n  const result = applyPresentationFocusIntent({ intent: 'SURFACE', session_id: sessionId, surface_id: surfaceId });\n  if (result.applied || result.browser_activation_performed) await publishSnapshot();\n  return result;\n});",
  "ipcMain.handle('metaengine:shell:presentation-focus:select-surface', async (event, sessionId, surfaceId) => {\n  assertShellSender(event);\n  const result = applyPresentationFocusIntent({ intent: 'SURFACE', session_id: sessionId, surface_id: surfaceId });\n  if (result.applied) {\n    devosSessionLayouts.activate(String(sessionId));\n    devosSessionLayouts.setActiveSurface(String(sessionId), String(surfaceId));\n    await saveDevOSSessionLayouts();\n    layout();\n  }\n  if (result.applied || result.browser_activation_performed) await publishSnapshot();\n  return result;\n});",
  'focus_surface_layout');
main = replaceOne(main,
  "  const state = devosPresentationFocus.clear();\n  await publishSnapshot();",
  "  const state = devosPresentationFocus.clear();\n  layout();\n  await publishSnapshot();",
  'clear_layout');
main = replaceOne(main,
  "async function startAfterReady() {\n  await registerShellProtocol();",
  "async function startAfterReady() {\n  await registerShellProtocol();\n  await initDevOSSessionLayouts();",
  'startup_layout_restore');
await writeFile(paths.main, main);

let app = await readFile(paths.app, 'utf8');
app = replaceOne(app,
  "const opsContent = document.getElementById('opsContent');\n",
  "const opsContent = document.getElementById('opsContent');\nconst devosSurfaceGrid = document.createElement('div');\ndevosSurfaceGrid.id = 'devosSurfaceGrid';\ndevosSurfaceGrid.setAttribute('aria-label', 'DevOS Surface Grid');\nbody.append(devosSurfaceGrid);\n",
  'app_grid_root');
app = replaceOne(app,
  "function renderActive(next) {\n  const tab = selectedTab(next);\n  const agent = tab ? fleetAgentForTab(next, tab.tab_id) : null;",
  "function renderActive(next) {\n  const focusedView = devosShellView(next);\n  const focusedSurface = focusedView?.selected_surface || null;\n  const focusedSession = focusedView?.selected_session || null;\n  const tab = selectedTab(next);\n  const agent = tab ? fleetAgentForTab(next, tab.tab_id) : null;",
  'app_active_focus');
app = replaceOne(app,
  "  if (!tab) {\n    activeKind.textContent = '—';",
  "  if (focusedSurface) {\n    activeKind.textContent = text(focusedSurface.type, 'S').slice(0, 1);\n    activeTitle.textContent = text(focusedSurface.title, focusedSurface.surface_id);\n    activeMeta.textContent = text(focusedSurface.type, 'SURFACE') + ' · DevOS Surface';\n    if (focusedSurface.type === 'BROWSER' && focusedSurface.tab_id) {\n      const focusedTab = (next?.tabs?.tabs || []).find((row) => String(row.tab_id) === String(focusedSurface.tab_id));\n      if (focusedTab && document.activeElement !== address) address.value = focusedTab.url || '';\n      routeKind.textContent = focusedTab?.kind === 'CHATGPT' ? 'CHAT' : 'WEB';\n      routeKind.classList.toggle('chat', focusedTab?.kind === 'CHATGPT');\n    } else {\n      routeKind.textContent = 'SURFACE';\n      routeKind.classList.remove('chat');\n    }\n    return;\n  }\n  if (focusedSession) {\n    activeKind.textContent = 'S';\n    activeTitle.textContent = text(focusedSession.title, focusedSession.session_id);\n    activeMeta.textContent = String(focusedSession.surface_ids?.length || 0) + ' surfaces · Session focus';\n  }\n  if (!tab) {\n    activeKind.textContent = '—';",
  'app_active_surface');
app = replaceOne(app,
  "      tab_id: row.tab_id ? String(row.tab_id) : null,\n      authority_effect: false,",
  "      tab_id: row.tab_id ? String(row.tab_id) : null,\n      runtime_bound: row.runtime_bound === true,\n      presentation_only: row.presentation_only === true,\n      artifact_id: row.artifact_id ? String(row.artifact_id) : null,\n      artifact_ref: row.artifact_ref ? String(row.artifact_ref) : null,\n      immutable_reference: row.immutable_reference === true,\n      timeline_entries: Array.isArray(row.timeline_entries) ? row.timeline_entries.slice(0, 32) : [],\n      timeline_entry_count: Math.max(0, Number(row.timeline_entry_count || 0)),\n      episode_count: Math.max(0, Number(row.episode_count || 0)),\n      semantic_fact_count: Math.max(0, Number(row.semantic_fact_count || 0)),\n      procedural_playbook_count: Math.max(0, Number(row.procedural_playbook_count || 0)),\n      authority_effect: false,",
  'app_surface_payload');

const gridHelpers = [
  "function validSurfaceGrid(next) {",
  "  const grid = next?.surface_grid;",
  "  if (!grid || grid.schema !== 'metaengine.devos.surface-grid.v1' || grid.authority_effect !== false",
  "    || grid.execution_authority !== false || grid.scheduler_authority !== false",
  "    || grid.renderer_dimensions_authoritative !== false || grid.browser_views_owned_by_main !== true",
  "    || !Array.isArray(grid.panes)) return null;",
  "  return grid;",
  "}",
  "",
  "function renderNativeSurfaceBody(surface) {",
  "  const bodyNode = el('div', 'devosSurfaceBody');",
  "  if (!surface) { bodyNode.append(el('span', 'surfaceEmpty', 'Surface payload unavailable')); return bodyNode; }",
  "  if (surface.type === 'TIMELINE') {",
  "    const list = el('div', 'surfaceTimeline');",
  "    for (const row of surface.timeline_entries || []) list.append(entityRow(text(row.title, row.task_id || 'Task'), text(row.status, 'UNKNOWN'), row.blocker ? [{ value: compact(row.blocker, 36), tone: 'warn' }] : []));",
  "    if (!list.childNodes.length) list.append(el('span', 'surfaceEmpty', 'No task timeline entries'));",
  "    bodyNode.append(list);",
  "  } else if (surface.type === 'ARTIFACT') {",
  "    bodyNode.append(kvRow('Reference', surface.artifact_ref || surface.artifact_id || 'UNKNOWN', surface.immutable_reference ? 'good' : 'neutral'));",
  "    bodyNode.append(kvRow('Mutation authority', 'NONE', 'good'));",
  "  } else if (surface.type === 'MEMORY') {",
  "    bodyNode.append(kvRow('Episodes', surface.episode_count, 'neutral'));",
  "    bodyNode.append(kvRow('Semantic facts', surface.semantic_fact_count, 'neutral'));",
  "    bodyNode.append(kvRow('Playbooks', surface.procedural_playbook_count, 'neutral'));",
  "  } else {",
  "    bodyNode.append(kvRow('Type', surface.type, 'neutral'));",
  "    bodyNode.append(kvRow('Runtime source', 'NOT EXPOSED', 'neutral'));",
  "  }",
  "  return bodyNode;",
  "}",
  "",
  "function renderDevOSSurfaceGrid(next) {",
  "  const grid = validSurfaceGrid(next);",
  "  devosSurfaceGrid.replaceChildren();",
  "  devosSurfaceGrid.hidden = !grid;",
  "  if (!grid) return;",
  "  const surfaces = new Map(devosSelectedSurfaceRows(next).map((row) => [row.surface_id, row]));",
  "  for (const pane of grid.panes) {",
  "    const className = ('devosSurfacePane ' + String(pane.type || '').toLowerCase() + ' ' + (pane.focused ? 'focused' : '')).trim();",
  "    const node = el('section', className);",
  "    const b = pane.pane_bounds || {};",
  "    node.style.left = String(Math.max(0, Number(b.x || 0))) + 'px';",
  "    node.style.top = String(Math.max(0, Number(b.y || 0))) + 'px';",
  "    node.style.width = String(Math.max(0, Number(b.width || 0))) + 'px';",
  "    node.style.height = String(Math.max(0, Number(b.height || 0))) + 'px';",
  "    const header = el('button', 'devosSurfaceHeader');",
  "    header.type = 'button';",
  "    header.append(el('strong', '', text(pane.title, pane.surface_id)), el('span', '', text(pane.type, 'SURFACE') + (pane.focused ? ' · focused' : '')));",
  "    const exact = surfaces.get(String(pane.surface_id));",
  "    if (exact?.session_id) header.onclick = () => api.presentationFocus.selectSurface(exact.session_id, exact.surface_id).catch(() => {});",
  "    node.append(header);",
  "    if (pane.renderer_content_required === true) node.append(renderNativeSurfaceBody(exact));",
  "    else node.append(el('div', 'devosSurfaceBody browserNative', 'Native Browser Surface'));",
  "    devosSurfaceGrid.append(node);",
  "  }",
  "}",
  "",
  "function renderSessions(next) {",
].join('\n');
app = replaceOne(app, 'function renderSessions(next) {', gridHelpers, 'app_grid_helpers');
app = replaceOne(app,
  "  if (selectedSession) {\n    const focusActions = el('div', 'commandList');\n    focusActions.append(commandButton('Clear Session focus', 'Presentation focus only', () => api.presentationFocus.clear()));\n    fragment.append(focusActions);\n  }",
  "  if (selectedSession) {\n    const focusActions = el('div', 'commandList');\n    focusActions.append(commandButton('Clear Session focus', 'Presentation focus only', () => api.presentationFocus.clear()));\n    fragment.append(focusActions);\n    const requestedSurfaceLayout = view.layout_preferences?.requested_surface_layout || 'AUTO';\n    const effectiveSurfaceLayout = next?.surface_grid?.effective_layout || 'UNKNOWN';\n    const layoutActions = section('Surface layout', 'requested ' + requestedSurfaceLayout + ' · effective ' + effectiveSurfaceLayout);\n    layoutActions.list.className = 'commandList surfaceLayoutCommands';\n    for (const mode of ['AUTO', 'SINGLE', 'SPLIT_VERTICAL', 'SPLIT_HORIZONTAL', 'TRIPLE_RIGHT', 'GRID_2X2']) {\n      layoutActions.list.append(commandButton(mode.replaceAll('_', ' '), mode === requestedSurfaceLayout ? 'requested' : 'layout preference', () => api.command('DEVOS_SURFACE_LAYOUT_SET', { session_id: selectedSession.session_id, layout: mode })));\n    }\n    fragment.append(layoutActions.wrap);\n  }",
  'app_layout_controls');
app = replaceOne(app,
  "  renderActive(next);\n  renderContextRail(next);\n  setSystemStatus(statusEls.fleet, fleetStatus(next));",
  "  renderActive(next);\n  renderContextRail(next);\n  renderDevOSSurfaceGrid(next);\n  setSystemStatus(statusEls.fleet, fleetStatus(next));",
  'app_render_grid');
await writeFile(paths.app, app);

let css = await readFile(paths.css, 'utf8');
if (!css.includes('DevOS Multi-Surface V1')) {
  css += [
    '',
    '',
    '/* DevOS Multi-Surface V1: geometry is supplied by trusted main-process surface_grid. */',
    '#devosSurfaceGrid{position:fixed;inset:0;z-index:5;pointer-events:none;overflow:hidden}',
    '#devosSurfaceGrid[hidden]{display:none}',
    '.devosSurfacePane{position:absolute;box-sizing:border-box;border:1px solid var(--border);background:var(--panel);overflow:hidden;pointer-events:none}',
    '.devosSurfacePane.focused{box-shadow:inset 0 0 0 1px var(--focus)}',
    '.devosSurfaceHeader{height:28px;width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 9px;border:0;border-bottom:1px solid var(--border);background:var(--panel-2);color:var(--text);font:inherit;text-align:left;pointer-events:auto}',
    '.devosSurfaceHeader strong{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.devosSurfaceHeader span{font-size:9px;color:var(--muted);white-space:nowrap}',
    '.devosSurfaceBody{position:absolute;left:0;right:0;top:28px;bottom:0;overflow:auto;padding:10px;background:var(--bg);pointer-events:auto}',
    '.devosSurfaceBody.browserNative{pointer-events:none;color:transparent;padding:0;background:transparent}',
    '.surfaceTimeline{display:grid;gap:6px}',
    '.surfaceEmpty{font-size:11px;color:var(--muted)}',
    '.surfaceLayoutCommands{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '',
  ].join('\n');
}
await writeFile(paths.css, css);

let shellViewModel = await readFile(paths.shellViewModel, 'utf8');
const selectedLayoutReplacement = [
  "function selectedLayout(devos, selectedSessionId) {",
  "  const prefs = devos?.layout_preferences;",
  "  if (!prefs || !selectedSessionId) return null;",
  "  if (prefs.schema !== 'metaengine.devos.session-layout-projection.v1' || !hasZeroAuthorityContract(prefs) || !Array.isArray(prefs.entries)) return null;",
  "  const active = prefs.entries.find((entry) => text(entry?.session_id, 200) === selectedSessionId) || null;",
  "  if (active && (active.schema !== 'metaengine.devos.session-layout-preference.v1' || !hasZeroAuthorityContract(active) || active.stored_surface_is_selection_authority !== false)) return null;",
  "  return freezeRow({",
  "    source_state: text(prefs.source_state, 48) || 'UNKNOWN',",
  "    selection_alignment: text(prefs.selection_alignment, 80) || 'UNKNOWN',",
  "    requested_sidebar: text(active?.requested_sidebar, 32) || 'EXPANDED',",
  "    requested_inspector: text(active?.requested_inspector, 32) || 'CLOSED',",
  "    requested_surface_layout: text(active?.requested_surface_layout, 40) || 'AUTO',",
  "    stored_surface_id: text(active?.stored_surface_id, 240),",
  "    stored_surface_is_focus_preference: active ? active.stored_surface_is_focus_preference === true : true,",
  "    stored_surface_is_selection_authority: false,",
  "  });",
  "}",
  "",
  "export function projectDevOSShellViewModel",
].join('\n');
shellViewModel = replaceRegex(shellViewModel, /function selectedLayout\(devos, selectedSessionId\) \{[\s\S]*?export function projectDevOSShellViewModel/, selectedLayoutReplacement, 'shell_view_model_explicit_session_layout');
await writeFile(paths.shellViewModel, shellViewModel);

console.log(JSON.stringify({ schema: 'metaengine.devos.multisurface-patcher.v2', files: Object.values(paths), authority_effect: false }));
