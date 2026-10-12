// The packaged compatibility probe can be healthy while it has no task
// content. Its empty arrays must never replace the client's actual history.
export function taskContentSnapshotForDisplay(value) {
  if (!value || typeof value !== 'object' || value.ok !== true
    || value.task_content_authority !== true
    || value.browser_probe?.read_only === true
    || value.meta?.projection === 'BROWSER_PROBE_ONLY'
    || !Array.isArray(value.tasks)
    || (value.archived != null && !Array.isArray(value.archived))) return null;
  return value;
}

// Browser owns the current task, model and effect plane. The packaged daemon
// advertises no write operations; historical controls are inspection only.
export const LEGACY_DAEMON_EFFECTS_AVAILABLE = false;
export const LEGACY_DAEMON_EFFECT_ACTIONS = new Set([
  'BUDGET_FLUSH', 'ENVIRONMENT_RESET', 'COMMAND_CANCEL', 'DB_HYGIENE', 'EVAL_RUN',
  'OBJECTIVE_CREATE', 'OBJECTIVE_STATUS', 'OBJECTIVE_DELETE', 'TASK_HANDOFF', 'REVIEW_RUN',
  'APPROVAL_POLICY', 'APPROVAL_APPROVE', 'APPROVAL_DENY', 'DEMAND_CONFIG', 'DEMAND_TICK',
  'BRAIN_THINK',
]);

// The compatibility daemon is not the authority for task/model/effect work.
// Keep only the Browser tab controls and the read-only diagnostics that the
// current UI still uses. Unknown actions from /actions fail closed as well.
export const SUPPORTED_LEGACY_DAEMON_ACTIONS = new Set([
  'BROWSER_TABS', 'BROWSER_SELECT_TAB', 'BROWSER_CLOSE', 'BROWSER_OPEN', 'BROWSER_NAVIGATE',
  'PING', 'STATE_SNAPSHOT', 'EVENTS_TAIL', 'WORKERS_LIST', 'ACTIONS_LIST', 'EVENTS_SEARCH',
]);

export function isSupportedLegacyDaemonAction(action) {
  return typeof action === 'string' && SUPPORTED_LEGACY_DAEMON_ACTIONS.has(action);
}

export function filterSupportedLegacyDaemonActionCatalog(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => row && isSupportedLegacyDaemonAction(row.action))
    : [];
}

export const LEGACY_DAEMON_EFFECTS_UNAVAILABLE = 'This command is not available in the current Browser command bridge.';
