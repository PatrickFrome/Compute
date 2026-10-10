// Read-only projection helper for the Task Sheet action feed.
//
// The daemon currently exposes task-scoped history through GET /events?task=.
// Keep the projection honest: project/workspace identity is shown only when
// the event carries those fields; this helper never invents a project route or
// turns a task event into a project-wide claim.

const MAX_LIMIT = 200;

function sameEvent(a, b) {
  return ['ts', 'type', 'agent_id', 'task_id', 'data', 'project_id', 'workspace_id'].every((key) => a[key] === b[key]);
}

/** Conflicting bytes at one durable sequence must not be silently overwritten. */
export function taskEventRowsConflict(existing = [], incoming = []) {
  const known = new Map(existing.map((event) => [event.seq, event]));
  return incoming.some((event) => known.has(event.seq) && !sameEvent(known.get(event.seq), event));
}

function safeSeq(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Build a bounded, deduplicated action feed from an /events response.
 *
 * @param {{events?:Array<any>, taskId?:string|null, projectId?:string|null,
 *   workspaceId?:string|null, afterSeq?:number|null, limit?:number,
 *   available?:boolean, resyncRequired?:boolean}} input
 */
export function projectActionFeed({
  events = [],
  taskId = null,
  projectId = null,
  workspaceId = null,
  afterSeq = null,
  limit = 80,
  available = true,
  resyncRequired = false,
} = {}) {
  const exactTask = taskId == null ? null : String(taskId);
  const exactProject = projectId == null ? null : String(projectId);
  const exactWorkspace = workspaceId == null ? null : String(workspaceId);
  const bySeq = new Map();
  let conflict = false;

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue;
    if (exactTask !== null && String(event.task_id ?? '') !== exactTask) continue;
    if (exactProject !== null && String(event.project_id ?? event.projectId ?? '') !== exactProject) continue;
    if (exactWorkspace !== null && String(event.workspace_id ?? event.workspaceId ?? '') !== exactWorkspace) continue;
    const seq = safeSeq(event.seq);
    if (seq === null) continue;
    const previous = bySeq.get(seq);
    if (previous && !sameEvent(previous, event)) conflict = true;
    if (!previous) bySeq.set(seq, event);
  }

  const ordered = [...bySeq.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
  const after = safeSeq(afterSeq);
  const visible = after === null ? ordered : ordered.filter((event) => Number(event.seq) > after);
  const boundedLimit = Math.max(1, Math.min(MAX_LIMIT, Number.isSafeInteger(Number(limit)) ? Number(limit) : 80));
  const bounded = visible.slice(-boundedLimit);
  const observedLatest = ordered.length > 0 ? Number(ordered[ordered.length - 1].seq) : null;
  const latest = after === null ? observedLatest : Math.max(after, observedLatest ?? after);
  // seq is global across tasks. Sparse task rows do not prove a transport gap.
  const needsResync = Boolean(resyncRequired || conflict);

  return Object.freeze({
    events: Object.freeze(bounded),
    cursor: latest === null ? null : Object.freeze({ after_seq: latest, latest_seq: latest }),
    state: !available ? 'UNAVAILABLE' : needsResync ? 'RESYNC_REQUIRED' : 'READY',
    resyncRequired: needsResync,
    scope: exactProject || exactWorkspace ? 'project-workspace' : 'task',
  });
}

/** Validate a real /events page before advancing its server cursor.
 * Legacy responses without pagination remain readable, with no resume claim.
 * @param {any} response
 * @param {{taskId:string,afterSeq?:number|null}} request
 */
export function validateTaskEventPage(response, { taskId, afterSeq = null }) {
  const rejected = { valid: false, cursor: null, resyncRequired: false };
  if (!response || response.ok === false || response.exact_task_history_available === false || !Array.isArray(response.events) || response.events.length > MAX_LIMIT) return rejected;
  if (response.events.some((e) => String(e?.task_id ?? '') !== taskId || !Number.isSafeInteger(e?.seq) || e.seq < 0)) return rejected;
  const c = response.cursor;
  if (!c) return afterSeq === null ? { valid: true, cursor: null, resyncRequired: false } : rejected;
  if (response.scope?.kind !== 'task' || response.scope?.task_id !== taskId) return rejected;
  if (c.mode !== (afterSeq === null ? 'latest' : 'after') || c.after_seq !== afterSeq) return rejected;
  if ([c.returned_through_seq, c.latest_seq, c.log_latest_seq].some(seq => !Number.isSafeInteger(seq) || seq < 0)) return rejected;
  const through = safeSeq(c.returned_through_seq), latest = safeSeq(c.latest_seq), logLatest = safeSeq(c.log_latest_seq);
  if (through === null || latest === null || logLatest === null || latest > logLatest || typeof c.has_more !== 'boolean' || typeof c.has_earlier !== 'boolean' || typeof c.resync_required !== 'boolean') return rejected;
  if (c.resync_required) {
    if (afterSeq === null || afterSeq <= logLatest || response.events.length || c.has_more || c.resync_reason !== 'CURSOR_AHEAD_OF_LOG') return rejected;
  } else {
    if (through > logLatest || (afterSeq !== null && through < afterSeq)) return rejected;
    if (response.events.some((e, i, all) => (afterSeq !== null && e.seq <= afterSeq) || e.seq > latest || (i > 0 && e.seq <= all[i - 1].seq))) return rejected;
    if (through !== (response.events.at(-1)?.seq ?? afterSeq ?? 0)) return rejected;
    if (c.has_more && (!response.events.length || through >= latest)) return rejected;
    if (!c.has_more && through !== Math.max(latest, afterSeq ?? 0)) return rejected;
    if (afterSeq === null && c.has_more) return rejected;
  }
  return { valid: true, cursor: Object.freeze({ ...c }), resyncRequired: c.resync_required };
}

/**
 * Describe the capability boundary rendered beside the feed.
 * @param {{projectId?:string|null, workspaceId?:string|null}} input
 */
export function projectFeedBinding({ projectId = null, workspaceId = null } = {}) {
  const project = projectId == null ? '' : String(projectId).trim();
  const workspace = workspaceId == null ? '' : String(workspaceId).trim();
  if (project || workspace) {
    return Object.freeze({ bound: true, label: project ? `project ${project}` : `workspace ${workspace}`, reason: null });
  }
  return Object.freeze({
    bound: false,
    label: 'task-scoped history',
    reason: 'project/workspace identity is not present in the daemon task-events contract',
  });
}
