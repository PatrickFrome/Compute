'use strict';

const METAENGINE_DEVOS_PROJECTION_SCHEMA = 'metaengine.devos.projection.v1';
const METAENGINE_DEVOS_SURFACE_REGISTRY_SCHEMA = 'metaengine.devos.surface-registry.v1';
const METAENGINE_DEVOS_SURFACE_TYPES = Object.freeze([
  'BROWSER', 'CODE', 'TERMINAL', 'DIFF', 'TESTS', 'LOGS', 'ARTIFACT', 'TIMELINE', 'MEMORY', 'GRAPH', 'CANVAS', 'DATABASE',
]);
const TASK_PRIORITY = Object.freeze({ ACTIVE: 0, BLOCKED: 1, READY: 2, FAILED: 3, COMPLETED: 4, CANCELLED: 5 });
const UNBOUND_BROWSER_SESSION_ID = 'session:browser-unbound';

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
function text(value, max = 240) {
  const out = String(value ?? '').trim();
  return out ? out.slice(0, max) : null;
}
function safeArray(value) { return Array.isArray(value) ? value : []; }
function freezeRows(rows) { return Object.freeze(rows.map((row) => Object.freeze(row))); }
function zeroAuthorityContract() {
  return Object.freeze({
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  });
}
function normalizeTask(task = {}) {
  return Object.freeze({
    task_id: text(task.task_id, 160),
    objective: text(task.objective, 600),
    status: text(task.status, 48)?.toUpperCase() || 'UNKNOWN',
    owner_agent_id: text(task.owner_agent_id, 160),
    progress_revision: Number.isSafeInteger(Number(task.progress_revision)) ? Number(task.progress_revision) : 0,
    blocker: text(task.blocker, 600),
    dependencies: Object.freeze(safeArray(task.dependencies).map((value) => text(value, 160)).filter(Boolean).slice(0, 64)),
    required_capabilities: Object.freeze(safeArray(task.required_capabilities).map((value) => text(value, 96)).filter(Boolean).slice(0, 64)),
    updated_at: text(task.updated_at, 80),
    ...zeroAuthorityContract(),
  });
}
function deriveAttention(contexts, system = {}, workspaceIssues = []) {
  const rows = [];
  for (const context of contexts) {
    for (const task of context.tasks) {
      if (!['BLOCKED', 'FAILED'].includes(task.status)) continue;
      rows.push(Object.freeze({
        kind: task.status === 'FAILED' ? 'TASK_FAILED' : 'TASK_BLOCKED',
        severity: task.status === 'FAILED' ? 'ERROR' : 'WARNING',
        objective_id: context.objective_id,
        session_id: context.session_id,
        task_id: task.task_id,
        title: task.objective,
        reason: task.blocker || task.status,
        ...zeroAuthorityContract(),
      }));
    }
  }
  for (const issue of safeArray(workspaceIssues).slice(0, 128)) {
    rows.push(Object.freeze({
      kind: 'WORKSPACE_BINDING_ISSUE',
      severity: 'WARNING',
      objective_id: null,
      session_id: null,
      task_id: text(issue?.task_id, 160),
      title: 'Workspace binding requires attention',
      reason: text(issue?.reason, 600) || 'WORKSPACE_BINDING_ISSUE',
      workspace_id: text(issue?.workspace_id, 200),
      tab_id: text(issue?.tab_id, 160),
      ...zeroAuthorityContract(),
    }));
  }
  if (system.owner_safety_wildcard_disabled === true) {
    rows.push(Object.freeze({ kind: 'SAFETY_OVERRIDE', severity: 'ERROR', title: 'Owner safety wildcard override active', reason: 'Safety state requires operator attention', ...zeroAuthorityContract() }));
  }
  if (system.supervisor_error) {
    rows.push(Object.freeze({ kind: 'SUPERVISOR_ERROR', severity: 'ERROR', title: 'Supervisor degraded', reason: text(system.supervisor_error, 600), ...zeroAuthorityContract() }));
  }
  return rows;
}
function browserSurfaces(snapshot, sessionOwnership, maxSurfaces) {
  const tabs = safeArray(snapshot?.tabs?.tabs);
  const selectedId = text(snapshot?.tabs?.selected_tab_id, 160);
  return tabs.slice(0, maxSurfaces).map((tab) => {
    const tabId = text(tab?.tab_id, 160);
    const sessionId = sessionOwnership.get(tabId) || UNBOUND_BROWSER_SESSION_ID;
    return Object.freeze({
      surface_id: `browser:${tabId || 'unknown'}`,
      session_id: sessionId,
      type: 'BROWSER',
      title: text(tab?.title, 240) || 'Browser',
      tab_id: tabId,
      url: text(tab?.url, 1400),
      selected: tabId === selectedId,
      state: text(tab?.state ?? tab?.kind, 64)?.toUpperCase() || 'AVAILABLE',
      source: sessionId === UNBOUND_BROWSER_SESSION_ID ? 'BROWSER_TAB_REGISTRY' : 'DURABLE_WORKSPACE_BINDING',
      ownership: sessionId === UNBOUND_BROWSER_SESSION_ID ? 'UNBOUND_BROWSER_SURFACE' : 'EXACT_SESSION_BINDING',
      browsercell_identity: tabId,
      ...zeroAuthorityContract(),
    });
  });
}
function existingWorkspaceProjection(snapshot) {
  const projection = snapshot?.workspaces;
  if (!projection || projection.schema !== 'metaengine.browser.workspace-workbench-projection.v1') return null;
  if (
    projection.grouping_authority !== 'DURABLE_WORKSPACE_BINDING_ONLY'
    || projection.url_heuristic_grouping !== false
    || projection.title_heuristic_grouping !== false
    || projection.browser_actuation_authority !== false
    || projection.authority_effect !== false
  ) return null;
  return projection;
}
function objectiveContexts(snapshot, maxObjectives, maxTasksPerSession) {
  const workbench = snapshot?.supervisor?.realtime_process_plane?.browser_brain?.collaboration_fabric?.workbench;
  if (!workbench || workbench.schema !== 'metaengine.browser-brain.collaboration-workbench.v1') return [];
  if (
    workbench.bounded !== true
    || workbench.advisory_only !== true
    || workbench.projection_is_authority !== false
    || workbench.scheduler_authority !== false
    || workbench.execution_authority !== false
    || workbench.command_leasing !== false
    || workbench.authority_effect !== false
  ) return [];
  return safeArray(workbench.contexts).slice(0, maxObjectives).map((context) => {
    const tasks = safeArray(context.tasks)
      .map(normalizeTask)
      .sort((a, b) => (TASK_PRIORITY[a.status] ?? 99) - (TASK_PRIORITY[b.status] ?? 99)
        || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
        || String(a.task_id || '').localeCompare(String(b.task_id || '')))
      .slice(0, maxTasksPerSession);
    const contextId = text(context.context_id, 160) || 'unknown';
    return Object.freeze({
      objective_id: `objective:${contextId}`,
      session_id: `session:${contextId}`,
      context_id: contextId,
      title: tasks[0]?.objective || contextId,
      status: tasks.find((row) => row.status === 'ACTIVE')?.status
        || tasks.find((row) => row.status === 'BLOCKED')?.status
        || tasks.find((row) => row.status === 'READY')?.status
        || tasks[0]?.status || 'IDLE',
      progress: Object.freeze({
        ready: Number(context?.progress?.ready || 0), active: Number(context?.progress?.active || 0), blocked: Number(context?.progress?.blocked || 0),
        completed: Number(context?.progress?.completed || 0), failed: Number(context?.progress?.failed || 0),
        active_agents: Object.freeze(safeArray(context?.progress?.active_agents).map((value) => text(value, 160)).filter(Boolean).slice(0, 64)),
      }),
      artifact_refs: Object.freeze(safeArray(context.artifact_refs).map((value) => text(value, 240)).filter(Boolean).slice(0, 128)),
      tasks: Object.freeze(tasks),
      tasks_truncated: safeArray(context.tasks).length > tasks.length,
      last_activity_at: text(context.last_activity_at, 80),
      ...zeroAuthorityContract(),
    });
  });
}
function contextForDurableGroup(group, contexts) {
  const taskId = text(group?.task_id, 160);
  if (!taskId) return null;
  const matches = contexts.filter((context) => context.tasks.some((task) => task.task_id === taskId));
  return matches.length === 1 ? matches[0] : null;
}
function buildSurfaceOwnership(durableGroups, contexts) {
  const ownership = new Map();
  const ambiguous = new Set();
  for (const group of durableGroups) {
    const tabId = text(group?.tab_id, 160);
    const context = contextForDurableGroup(group, contexts);
    if (!tabId || !context) continue;
    const prior = ownership.get(tabId);
    if (prior && prior !== context.session_id) {
      ownership.delete(tabId);
      ambiguous.add(tabId);
      continue;
    }
    if (!ambiguous.has(tabId)) ownership.set(tabId, context.session_id);
  }
  return ownership;
}
function createMetaengineDevOSSurfaceRegistry() {
  return Object.freeze({
    schema: METAENGINE_DEVOS_SURFACE_REGISTRY_SCHEMA,
    types: Object.freeze(METAENGINE_DEVOS_SURFACE_TYPES.map((type) => Object.freeze({
      type, runtime_bound: type === 'BROWSER', default_role: type === 'BROWSER' ? 'EXECUTION_SURFACE' : 'PRESENTATION_SURFACE', authority_effect: false,
    }))),
    browser_is_shell: false,
    browser_is_surface: true,
    extension_surface_registration_enabled: false,
    dynamic_surface_execution_enabled: false,
    ...zeroAuthorityContract(),
  });
}
function projectMetaengineDevOS(snapshot = {}, options = {}) {
  const maxObjectives = boundedInt(options.max_objectives, 32, 1, 128);
  const maxTasksPerSession = boundedInt(options.max_tasks_per_session, 64, 1, 256);
  const maxSurfaces = boundedInt(options.max_surfaces, 64, 1, 256);
  const contexts = objectiveContexts(snapshot, maxObjectives, maxTasksPerSession);
  const workspaceProjection = existingWorkspaceProjection(snapshot);
  const durableGroups = safeArray(workspaceProjection?.groups);
  const workspaces = contexts.map((context) => {
    const durable = durableGroups.find((group) => contextForDurableGroup(group, [context]) != null);
    return Object.freeze({
      workspace_id: text(durable?.workspace_id ?? durable?.workspace_key, 200) || `workspace:${context.context_id}`,
      objective_id: context.objective_id, session_id: context.session_id,
      title: text(durable?.title ?? durable?.branch_name, 240) || context.title,
      binding: durable ? 'DURABLE_WORKSPACE_BINDING' : 'COLLABORATION_CONTEXT_VIRTUAL',
      branch_name: text(durable?.branch_name, 240), base_sha: text(durable?.base_sha, 80),
      state: text(durable?.state, 64)?.toUpperCase() || 'AVAILABLE', ...zeroAuthorityContract(),
    });
  });
  const sessionOwnership = buildSurfaceOwnership(durableGroups, contexts);
  const browser = browserSurfaces(snapshot, sessionOwnership, maxSurfaces);
  const artifacts = [];
  for (const context of contexts) {
    for (const ref of context.artifact_refs) {
      artifacts.push(Object.freeze({ artifact_id: ref, objective_id: context.objective_id, session_id: context.session_id, ref, kind: 'REFERENCE', immutable_reference: true, ...zeroAuthorityContract() }));
    }
  }
  const sessions = contexts.map((context) => Object.freeze({
    session_id: context.session_id, objective_id: context.objective_id,
    workspace_id: workspaces.find((workspace) => workspace.session_id === context.session_id)?.workspace_id || null,
    title: context.title, status: context.status, task_count: context.tasks.length, tasks: context.tasks, progress: context.progress,
    artifact_count: context.artifact_refs.length, last_activity_at: context.last_activity_at,
    surface_ids: Object.freeze(browser.filter((surface) => surface.session_id === context.session_id).map((surface) => surface.surface_id)),
    ...zeroAuthorityContract(),
  }));
  const unboundSurfaceIds = browser.filter((surface) => surface.session_id === UNBOUND_BROWSER_SESSION_ID).map((surface) => surface.surface_id);
  if (unboundSurfaceIds.length > 0) {
    sessions.push(Object.freeze({
      session_id: UNBOUND_BROWSER_SESSION_ID,
      objective_id: null,
      workspace_id: null,
      title: 'Unbound Browser',
      status: 'AVAILABLE',
      task_count: 0,
      tasks: Object.freeze([]),
      progress: Object.freeze({ ready: 0, active: 0, blocked: 0, completed: 0, failed: 0, active_agents: Object.freeze([]) }),
      artifact_count: 0,
      last_activity_at: null,
      surface_ids: Object.freeze(unboundSurfaceIds),
      browser_only: true,
      ...zeroAuthorityContract(),
    }));
  }
  const attention = deriveAttention(contexts, {
    owner_safety_wildcard_disabled: snapshot?.owner_safety_gates?.wildcard_disabled === true,
    supervisor_error: snapshot?.supervisor?.last_error || snapshot?.supervisor?.devos_last_error || null,
  }, workspaceProjection?.issues);
  const selectedSurface = browser.find((surface) => surface.selected) || browser[0] || null;
  const selectedSessionId = selectedSurface?.session_id || contexts[0]?.session_id || sessions[0]?.session_id || null;
  const selectedSession = sessions.find((session) => session.session_id === selectedSessionId) || sessions[0] || null;
  const selectedObjective = selectedSession?.objective_id ? contexts.find((context) => context.objective_id === selectedSession.objective_id) || null : null;
  const selectedWorkspace = selectedSession?.workspace_id ? workspaces.find((workspace) => workspace.workspace_id === selectedSession.workspace_id) || null : null;
  return Object.freeze({
    schema: METAENGINE_DEVOS_PROJECTION_SCHEMA, mode: 'DEVELOPMENT_OS', primary_object: 'SESSION',
    hierarchy: Object.freeze(['OBJECTIVE', 'WORKSPACE', 'SESSION', 'TASK', 'SURFACE', 'ARTIFACT']),
    objectives: freezeRows(contexts.map((context) => ({ objective_id: context.objective_id, context_id: context.context_id, title: context.title, status: context.status, session_ids: Object.freeze([context.session_id]), attention_count: attention.filter((row) => row.objective_id === context.objective_id).length, ...zeroAuthorityContract() }))),
    workspaces: freezeRows(workspaces), sessions: freezeRows(sessions), surfaces: freezeRows(browser), artifacts: freezeRows(artifacts.slice(0, 512)), attention: freezeRows(attention.slice(0, 256)),
    selected: Object.freeze({ objective_id: selectedObjective?.objective_id || null, workspace_id: selectedWorkspace?.workspace_id || null, session_id: selectedSession?.session_id || null, surface_id: selectedSurface?.surface_id || null }),
    active_session: selectedSession ? Object.freeze({ session_id: selectedSession.session_id, objective_id: selectedSession.objective_id, workspace_id: selectedSession.workspace_id, title: selectedSession.title, status: selectedSession.status, surface_count: selectedSession.surface_ids.length, task_count: selectedSession.task_count, attention_count: attention.filter((row) => row.session_id === selectedSession.session_id).length, ...zeroAuthorityContract() }) : null,
    surface_registry: createMetaengineDevOSSurfaceRegistry(),
    counts: Object.freeze({ objectives: contexts.length, workspaces: workspaces.length, sessions: sessions.length, tasks: sessions.reduce((sum, session) => sum + session.task_count, 0), surfaces: browser.length, artifacts: Math.min(artifacts.length, 512), attention: Math.min(attention.length, 256) }),
    bounded: true, max_objectives: maxObjectives, max_tasks_per_session: maxTasksPerSession, max_surfaces: maxSurfaces,
    no_url_heuristic_grouping: true, no_title_heuristic_grouping: true, browser_is_shell: false, browser_is_surface: true,
    ...zeroAuthorityContract(),
  });
}

module.exports = Object.freeze({
  METAENGINE_DEVOS_PROJECTION_SCHEMA,
  METAENGINE_DEVOS_SURFACE_REGISTRY_SCHEMA,
  METAENGINE_DEVOS_SURFACE_TYPES,
  createMetaengineDevOSSurfaceRegistry,
  projectMetaengineDevOS,
});
