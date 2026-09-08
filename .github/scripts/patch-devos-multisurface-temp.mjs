import { readFile, writeFile } from 'node:fs/promises';

const paths = {
  main: 'apps/metaengine-browser/src/main.mjs',
  app: 'apps/metaengine-browser/ui/app.js',
  css: 'apps/metaengine-browser/ui/dark-workspace.css',
};

function replaceOne(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}:expected_1:got_${count}`);
  return source.replace(before, after);
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
  "function supervisorIdentityPath() {\n  return path.join(app.getPath('userData'), 'metaengine-native-supervisor-device-v1.json');\n}\n\nfunction devosSessionLayoutStatePath() {\n  return path.join(app.getPath('userData'), 'metaengine-devos-session-layout-registry-v1.json');\n}\n\nasync function initDevOSSessionLayouts() {\n  if (devosSessionLayoutsLoaded) return devosSessionLayouts.snapshot();\n  devosSessionLayoutsLoaded = true;\n  try {\n    const snapshot = JSON.parse(await fs.readFile(devosSessionLayoutStatePath(), 'utf8'));\n    devosSessionLayouts.restore(snapshot);\n  } catch (error) {\n    if (error?.code !== 'ENOENT') {\n      console.error(JSON.stringify({ schema: 'metaengine.devos.session-layout-load.v1', state: 'DEGRADED', reason: String(error?.message || error).slice(0, 240), fallback: 'IN_MEMORY_DEFAULTS', authority_effect: false }));\n    }\n  }\n  return devosSessionLayouts.snapshot();\n}\n\nasync function saveDevOSSessionLayouts() {\n  const target = devosSessionLayoutStatePath();\n  const temp = `${target}.tmp`;\n  await fs.mkdir(path.dirname(target), { recursive: true });\n  await fs.writeFile(temp, `${JSON.stringify(devosSessionLayouts.snapshot(), null, 2)}\\n`, { mode: 0o600 });\n  await fs.rename(temp, target);\n  return devosSessionLayouts.snapshot();\n}\n",
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

const oldLayout = `function layout() {\n  if (!windowRef || windowRef.isDestroyed()) return;\n  const { width, height } = windowRef.getContentBounds();\n  shellLayoutPlan = planShellLayout({ width, height, state: shellLayoutState });\n  shellView?.setBounds(shellLayoutPlan.shell_bounds);\n  const selected = registry.selected();\n  for (const [tabId, view] of views) {\n    if (tabId === selected?.tab_id) view.setBounds(shellLayoutPlan.remote_bounds);\n  }\n}\n\nfunction attachSelected() {\n  if (!windowRef) return;\n  if (shellView) {\n    try { windowRef.contentView.addChildView(shellView); } catch {}\n  }\n  const selected = registry.selected();\n  for (const [tabId, view] of views) {\n    if (tabId === selected?.tab_id) {\n      try { windowRef.contentView.addChildView(view); } catch {}\n    } else {\n      try { windowRef.contentView.removeChildView(view); } catch {}\n    }\n  }\n  layout();\n}\n`;
const newLayout = `function currentDevOSPresentationShellView() {\n  return projectWorkspaceWorkbench({\n    tabs: registry.snapshot(),\n    fleet: fleet?.snapshot() || null,\n    supervisor: nativeSupervisor?.snapshot() || null,\n    presentation_focus: devosPresentationFocus.snapshot(),\n    session_layouts: devosSessionLayouts.snapshot(),\n  }).devos_shell;\n}\n\nfunction fallbackSelectedSurface() {\n  const selected = registry.selected();\n  if (!selected) return [];\n  return [{\n    surface_id: \`browser:\${selected.tab_id}\`,\n    session_id: 'session:browser-fallback',\n    type: 'BROWSER',\n    title: selected.title || 'Browser',\n    tab_id: selected.tab_id,\n    projection_is_authority: false, scheduler_authority: false, execution_authority: false, command_leasing: false,\n    automatic_effect_retry_allowed: false, page_model_authority: false, authority_effect: false,\n  }];\n}\n\nfunction computeDevOSSurfaceGrid() {\n  if (!shellLayoutPlan) return null;\n  const shell = currentDevOSPresentationShellView();\n  const focusedSession = shell?.valid === true && shell.selected_session ? shell.selected_session : null;\n  const surfaces = focusedSession ? shell.selected_session_surfaces : fallbackSelectedSurface();\n  const focusedSurfaceId = focusedSession ? (shell.selected_surface?.surface_id || shell.layout_preferences?.stored_surface_id || null) : null;\n  const requestedLayout = focusedSession ? (shell.layout_preferences?.requested_surface_layout || 'AUTO') : 'SINGLE';\n  return planDevOSSurfaceGrid({\n    bounds: shellLayoutPlan.remote_bounds,\n    surfaces,\n    focused_surface_id: focusedSurfaceId && surfaces.some((row) => row.surface_id === focusedSurfaceId) ? focusedSurfaceId : null,\n    requested_layout: requestedLayout,\n  });\n}\n\nfunction layout() {\n  if (!windowRef || windowRef.isDestroyed()) return;\n  const { width, height } = windowRef.getContentBounds();\n  shellLayoutPlan = planShellLayout({ width, height, state: shellLayoutState });\n  shellView?.setBounds(shellLayoutPlan.shell_bounds);\n  if (shellView) { try { windowRef.contentView.addChildView(shellView); } catch {} }\n  devosSurfaceGridPlan = computeDevOSSurfaceGrid();\n  const browserPaneByTab = new Map((devosSurfaceGridPlan?.browser_panes || []).map((pane) => [String(pane.tab_id || ''), pane]));\n  for (const [tabId, view] of views) {\n    const pane = browserPaneByTab.get(String(tabId));\n    if (pane && !view.webContents.isDestroyed()) {\n      try { windowRef.contentView.addChildView(view); } catch {}\n      view.setBounds(pane.content_bounds);\n    } else {\n      try { windowRef.contentView.removeChildView(view); } catch {}\n    }\n  }\n}\n\nfunction attachSelected({ force_single_selected = false } = {}) {\n  if (!windowRef) return;\n  if (shellView) { try { windowRef.contentView.addChildView(shellView); } catch {} }\n  if (!shellLayoutPlan) {\n    const { width, height } = windowRef.getContentBounds();\n    shellLayoutPlan = planShellLayout({ width, height, state: shellLayoutState });\n    shellView?.setBounds(shellLayoutPlan.shell_bounds);\n  }\n  if (force_single_selected) {\n    const selected = registry.selected();\n    for (const [tabId, view] of views) {\n      if (tabId === selected?.tab_id && !view.webContents.isDestroyed()) {\n        try { windowRef.contentView.addChildView(view); } catch {}\n        view.setBounds(shellLayoutPlan.remote_bounds);\n      } else {\n        try { windowRef.contentView.removeChildView(view); } catch {}\n      }\n    }\n    return;\n  }\n  layout();\n}\n`;
main = replaceOne(main, oldLayout, newLayout, 'main_multisurface_layout');

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

const activeStart = `function renderActive(next) {\n  const tab = selectedTab(next);\n  const agent = tab ? fleetAgentForTab(next, tab.tab_id) : null;`;
const activeAfter = `function renderActive(next) {\n  const focusedView = devosShellView(next);\n  const focusedSurface = focusedView?.selected_surface || null;\n  const focusedSession = focusedView?.selected_session || null;\n  const tab = selectedTab(next);\n  const agent = tab ? fleetAgentForTab(next, tab.tab_id) : null;`;
app = replaceOne(app, activeStart, activeAfter, 'app_active_focus');
app = replaceOne(app,
  "  if (!tab) {\n    activeKind.textContent = '—';",
  "  if (focusedSurface) {\n    activeKind.textContent = text(focusedSurface.type, 'S').slice(0, 1);\n    activeTitle.textContent = text(focusedSurface.title, focusedSurface.surface_id);\n    activeMeta.textContent = `${text(focusedSurface.type, 'SURFACE')} · DevOS Surface`;\n    if (focusedSurface.type === 'BROWSER' && focusedSurface.tab_id) {\n      const focusedTab = (next?.tabs?.tabs || []).find((row) => String(row.tab_id) === String(focusedSurface.tab_id));\n      if (focusedTab && document.activeElement !== address) address.value = focusedTab.url || '';\n      routeKind.textContent = focusedTab?.kind === 'CHATGPT' ? 'CHAT' : 'WEB';\n      routeKind.classList.toggle('chat', focusedTab?.kind === 'CHATGPT');\n    } else {\n      routeKind.textContent = 'SURFACE';\n      routeKind.classList.remove('chat');\n    }\n    return;\n  }\n  if (focusedSession) {\n    activeKind.textContent = 'S';\n    activeTitle.textContent = text(focusedSession.title, focusedSession.session_id);\n    activeMeta.textContent = `${focusedSession.surface_ids?.length || 0} surfaces · Session focus`;\n  }\n  if (!tab) {\n    activeKind.textContent = '—';",
  'app_active_surface');

app = replaceOne(app,
  "      tab_id: row.tab_id ? String(row.tab_id) : null,\n      authority_effect: false,",
  "      tab_id: row.tab_id ? String(row.tab_id) : null,\n      runtime_bound: row.runtime_bound === true,\n      presentation_only: row.presentation_only === true,\n      artifact_id: row.artifact_id ? String(row.artifact_id) : null,\n      artifact_ref: row.artifact_ref ? String(row.artifact_ref) : null,\n      immutable_reference: row.immutable_reference === true,\n      timeline_entries: Array.isArray(row.timeline_entries) ? row.timeline_entries.slice(0, 32) : [],\n      timeline_entry_count: Math.max(0, Number(row.timeline_entry_count || 0)),\n      episode_count: Math.max(0, Number(row.episode_count || 0)),\n      semantic_fact_count: Math.max(0, Number(row.semantic_fact_count || 0)),\n      procedural_playbook_count: Math.max(0, Number(row.procedural_playbook_count || 0)),\n      authority_effect: false,",
  'app_surface_payload');

const beforeSessions = `function renderSessions(next) {`;
const gridHelpers = `function validSurfaceGrid(next) {\n  const grid = next?.surface_grid;\n  if (!grid || grid.schema !== 'metaengine.devos.surface-grid.v1' || grid.authority_effect !== false\n    || grid.execution_authority !== false || grid.scheduler_authority !== false\n    || grid.renderer_dimensions_authoritative !== false || grid.browser_views_owned_by_main !== true\n    || !Array.isArray(grid.panes)) return null;\n  return grid;\n}\n\nfunction renderNativeSurfaceBody(surface) {\n  const bodyNode = el('div', 'devosSurfaceBody');\n  if (!surface) { bodyNode.append(el('span', 'surfaceEmpty', 'Surface payload unavailable')); return bodyNode; }\n  if (surface.type === 'TIMELINE') {\n    const list = el('div', 'surfaceTimeline');\n    for (const row of surface.timeline_entries || []) list.append(entityRow(text(row.title, row.task_id || 'Task'), text(row.status, 'UNKNOWN'), row.blocker ? [{ value: compact(row.blocker, 36), tone: 'warn' }] : []));\n    if (!list.childNodes.length) list.append(el('span', 'surfaceEmpty', 'No task timeline entries'));\n    bodyNode.append(list);\n  } else if (surface.type === 'ARTIFACT') {\n    bodyNode.append(kvRow('Reference', surface.artifact_ref || surface.artifact_id || 'UNKNOWN', surface.immutable_reference ? 'good' : 'neutral'));\n    bodyNode.append(kvRow('Mutation authority', 'NONE', 'good'));\n  } else if (surface.type === 'MEMORY') {\n    bodyNode.append(kvRow('Episodes', surface.episode_count, 'neutral'));\n    bodyNode.append(kvRow('Semantic facts', surface.semantic_fact_count, 'neutral'));\n    bodyNode.append(kvRow('Playbooks', surface.procedural_playbook_count, 'neutral'));\n  } else {\n    bodyNode.append(kvRow('Type', surface.type, 'neutral'));\n    bodyNode.append(kvRow('Runtime source', 'NOT EXPOSED', 'neutral'));\n  }\n  return bodyNode;\n}\n\nfunction renderDevOSSurfaceGrid(next) {\n  const grid = validSurfaceGrid(next);\n  devosSurfaceGrid.replaceChildren();\n  devosSurfaceGrid.hidden = !grid;\n  if (!grid) return;\n  const surfaces = new Map(devosSelectedSurfaceRows(next).map((row) => [row.surface_id, row]));\n  for (const pane of grid.panes) {\n    const node = el('section', `devosSurfacePane ${String(pane.type || '').toLowerCase()} ${pane.focused ? 'focused' : ''}`.trim());\n    const b = pane.pane_bounds || {};\n    node.style.left = `${Math.max(0, Number(b.x || 0))}px`;\n    node.style.top = `${Math.max(0, Number(b.y || 0))}px`;\n    node.style.width = `${Math.max(0, Number(b.width || 0))}px`;\n    node.style.height = `${Math.max(0, Number(b.height || 0))}px`;\n    const header = el('button', 'devosSurfaceHeader');\n    header.type = 'button';\n    header.append(el('strong', '', text(pane.title, pane.surface_id)), el('span', '', `${text(pane.type, 'SURFACE')}${pane.focused ? ' · focused' : ''}`));\n    const exact = surfaces.get(String(pane.surface_id));\n    if (exact?.session_id) header.onclick = () => api.presentationFocus.selectSurface(exact.session_id, exact.surface_id).catch(() => {});\n    node.append(header);\n    if (pane.renderer_content_required === true) node.append(renderNativeSurfaceBody(exact));\n    else node.append(el('div', 'devosSurfaceBody browserNative', 'Native Browser Surface'));\n    devosSurfaceGrid.append(node);\n  }\n}\n\n${beforeSessions}`;
app = replaceOne(app, beforeSessions, gridHelpers, 'app_grid_helpers');

app = replaceOne(app,
  "  if (selectedSession) {\n    const focusActions = el('div', 'commandList');\n    focusActions.append(commandButton('Clear Session focus', 'Presentation focus only', () => api.presentationFocus.clear()));\n    fragment.append(focusActions);\n  }",
  "  if (selectedSession) {\n    const focusActions = el('div', 'commandList');\n    focusActions.append(commandButton('Clear Session focus', 'Presentation focus only', () => api.presentationFocus.clear()));\n    fragment.append(focusActions);\n    const layoutActions = section('Surface layout', `requested ${view.layout_preferences?.requested_surface_layout || 'AUTO'} · effective ${next?.surface_grid?.effective_layout || 'UNKNOWN'}`);\n    layoutActions.list.className = 'commandList surfaceLayoutCommands';\n    for (const mode of ['AUTO', 'SINGLE', 'SPLIT_VERTICAL', 'SPLIT_HORIZONTAL', 'TRIPLE_RIGHT', 'GRID_2X2']) {\n      layoutActions.list.append(commandButton(mode.replaceAll('_', ' '), mode === view.layout_preferences?.requested_surface_layout ? 'requested' : 'layout preference', () => api.command('DEVOS_SURFACE_LAYOUT_SET', { session_id: selectedSession.session_id, layout: mode })));\n    }\n    fragment.append(layoutActions.wrap);\n  }",
  'app_layout_controls');

app = replaceOne(app,
  "  renderContextRail(next);\n  setSystemStatus(statusEls.fleet, fleetStatus(next));",
  "  renderContextRail(next);\n  renderDevOSSurfaceGrid(next);\n  setSystemStatus(statusEls.fleet, fleetStatus(next));",
  'app_render_grid');
await writeFile(paths.app, app);

let css = await readFile(paths.css, 'utf8');
css += `\n\n/* DevOS Multi-Surface V1: geometry is supplied by trusted main-process surface_grid. */\n#devosSurfaceGrid{position:fixed;inset:0;z-index:5;pointer-events:none;overflow:hidden}\n#devosSurfaceGrid[hidden]{display:none}\n.devosSurfacePane{position:absolute;box-sizing:border-box;border:1px solid var(--border);background:var(--panel);overflow:hidden;pointer-events:none}\n.devosSurfacePane.focused{box-shadow:inset 0 0 0 1px var(--focus)}\n.devosSurfaceHeader{height:28px;width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 9px;border:0;border-bottom:1px solid var(--border);background:var(--panel-2);color:var(--text);font:inherit;text-align:left;pointer-events:auto}\n.devosSurfaceHeader strong{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.devosSurfaceHeader span{font-size:9px;color:var(--muted);white-space:nowrap}\n.devosSurfaceBody{position:absolute;left:0;right:0;top:28px;bottom:0;overflow:auto;padding:10px;background:var(--bg);pointer-events:auto}\n.devosSurfaceBody.browserNative{pointer-events:none;color:transparent;padding:0}\n.surfaceTimeline{display:grid;gap:6px}\n.surfaceEmpty{font-size:11px;color:var(--muted)}\n.surfaceLayoutCommands{grid-template-columns:repeat(2,minmax(0,1fr))}\n`;
await writeFile(paths.css, css);

console.log(JSON.stringify({ schema: 'metaengine.devos.multisurface-patcher.v1', files: Object.values(paths), authority_effect: false }));
