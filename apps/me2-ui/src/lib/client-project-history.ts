export type ProjectOverview = {
  project_id: string;
  root_task_id: string;
  state: string;
  goal: string;
  last_seq: number;
  total_tasks: number;
  tasks: { task_id: string; parent_task_id: string | null; depth: number; state: string; role: string }[];
  tasks_have_more: boolean;
  selected_task: { task_id: string; parent_task_id: string | null; depth: number; state: string; role: string } | null;
  immediate_children: { task_id: string; parent_task_id: string | null; depth: number; state: string; role: string }[];
  children_truncated: boolean;
};
export type ProjectHistoryEntry = {
  project_id: string;
  seq: number;
  causal_parent_seq: number | null;
  task_id: string | null;
  attempt: number | null;
  actor: string | null;
  event_type: string;
  content: unknown;
  source: string;
  created_at: string;
  verified_evidence: false;
  receipt_reference_verified?: boolean;
  tool?: string | null;
  artifact?: string | null;
};
export type ProjectHistoryCursor = { after_seq: number; through_seq: number; next_seq: number; has_more: boolean; commit_ordered: true };
export type ProjectHistoryFilters = { task_id: string | null; attempt: number | null; event_type: string | null };
export type ProjectHistoryRequest = ProjectHistoryFilters & { project_id: string; after_seq: number; through_seq: number | null; limit: number };
export type ProjectHistoryBridge = {
  projectOverview: () => Promise<unknown>;
  projectHistory: (request: ProjectHistoryRequest) => Promise<unknown>;
  projectSnapshot?: (request: { task_id: string; task_after_seq: number; limit: number }) => Promise<unknown>;
};
type HistoryView = {
  overview: ProjectOverview | null;
  entries: ProjectHistoryEntry[];
  cursor: ProjectHistoryCursor | null;
  filters: ProjectHistoryFilters;
  state: "UNBOUND" | "LOADING" | "READY" | "DEGRADED" | "RESYNC_REQUIRED";
  busy: boolean;
  capacityReached: boolean;
  windowStart: number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown, limit = 256): value is string => typeof value === "string" && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const flags = (value: { authority_effect?: unknown; automatic_retry_allowed?: unknown; scheduler_authority?: unknown }) => value.authority_effect === false && value.automatic_retry_allowed === false && value.scheduler_authority === false;

export function readProjectOverview(value: unknown, expectedTaskId: string | null = null): ProjectOverview | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("project_overview_invalid");
  const v = value as Record<string, any>;
  if (v.schema !== "metaengine.devos.project-snapshot.v1" || typeof v.found !== "boolean" || v.authority_effect !== false || v.automatic_retry_allowed !== false) throw new Error("project_overview_invalid");
  if (!v.found) return null;
  if (!flags(v) || !UUID.test(v.project_id ?? "") || !UUID.test(v.root_task_id ?? "")
    || !text(v.state) || !text(v.goal, 12_000) || !integer(v.last_seq) || !integer(v.total_tasks)
    || !Array.isArray(v.tasks) || v.tasks.length > 128 || typeof v.task_cursor?.has_more !== "boolean") throw new Error("project_overview_invalid");
  const seen = new Set();
  const tasks = v.tasks.map((row: Record<string, any>) => {
    if (!row || !UUID.test(row.task_id ?? "") || seen.has(row.task_id) || !integer(row.depth)
      || !(row.parent_task_id === null || UUID.test(row.parent_task_id ?? "")) || !text(row.state) || !text(row.role)) throw new Error("project_overview_invalid");
    seen.add(row.task_id);
    return { task_id: row.task_id, parent_task_id: row.parent_task_id, depth: row.depth, state: row.state, role: row.role };
  });
  const selected = v.selected_task == null ? null : v.selected_task;
  const readRelated = (row: Record<string, any>) => {
    if (!row || !UUID.test(row.task_id ?? "") || !integer(row.depth)
      || !(row.parent_task_id === null || UUID.test(row.parent_task_id ?? "")) || !text(row.state) || !text(row.role)) throw new Error("project_overview_invalid");
    return { task_id: row.task_id, parent_task_id: row.parent_task_id, depth: row.depth, state: row.state, role: row.role };
  };
  if (expectedTaskId && selected?.task_id !== expectedTaskId) throw new Error("project_overview_task_binding_invalid");
  const children = v.immediate_children ?? [];
  if (!Array.isArray(children) || children.length > 128 || children.some(row => row.parent_task_id !== selected?.task_id)
    || new Set(children.map(row => row.task_id)).size !== children.length) throw new Error("project_overview_invalid");
  return { project_id: v.project_id, root_task_id: v.root_task_id, state: v.state, goal: v.goal,
    last_seq: v.last_seq, total_tasks: v.total_tasks, tasks, tasks_have_more: v.task_cursor.has_more,
    selected_task: selected ? readRelated(selected) : null, immediate_children: children.map(readRelated), children_truncated: v.children_truncated === true };
}

export function readProjectHistoryPage(value: unknown, request: ProjectHistoryRequest): { entries: ProjectHistoryEntry[]; cursor: ProjectHistoryCursor } {
  if (!value || typeof value !== "object") throw new Error("project_history_invalid");
  const v = value as Record<string, any>, c = v.cursor;
  if (v.schema !== "metaengine.devos.project-history.v1" || v.project_id !== request.project_id || !flags(v) || v.content_is_authority !== false
    || !Array.isArray(v.entries) || v.entries.length > request.limit || !c || c.commit_ordered !== true
    || c.after_seq !== request.after_seq || !integer(c.through_seq) || !integer(c.next_seq) || typeof c.has_more !== "boolean"
    || c.through_seq < c.after_seq || c.next_seq < c.after_seq || c.next_seq > c.through_seq
    || (request.through_seq !== null && c.through_seq !== request.through_seq)) throw new Error("project_history_invalid");
  let previous = request.after_seq;
  const entries = v.entries.map((row: Record<string, any>) => {
    if (!row || row.project_id !== request.project_id || !integer(row.seq) || row.seq <= previous || row.seq > c.next_seq
      || !(row.causal_parent_seq === null || integer(row.causal_parent_seq) && row.causal_parent_seq > 0 && row.causal_parent_seq < row.seq)
      || !(row.task_id === null || UUID.test(row.task_id ?? "")) || !(row.attempt === null || integer(row.attempt))
      || !(row.actor === null || text(row.actor, 1024)) || !/^[A-Z][A-Z0-9_]{0,95}$/.test(row.event_type ?? "")
      || !text(row.source) || !text(row.created_at, 64) || !Number.isFinite(Date.parse(row.created_at))
      || row.verified_evidence !== false || !(row.receipt_reference_verified === undefined || typeof row.receipt_reference_verified === "boolean")
      || !Object.hasOwn(row, "content") || typeof JSON.stringify(row.content) !== "string" || (JSON.stringify(row.content) as string).length > 32_768
      || (request.task_id !== null && row.task_id !== request.task_id) || (request.attempt !== null && row.attempt !== request.attempt)
      || (request.event_type !== null && row.event_type !== request.event_type)) throw new Error("project_history_invalid");
    previous = row.seq;
    return { project_id: row.project_id, seq: row.seq, causal_parent_seq: row.causal_parent_seq, task_id: row.task_id,
      attempt: row.attempt, actor: row.actor, event_type: row.event_type, content: row.content, source: row.source,
      created_at: row.created_at, verified_evidence: false as const, receipt_reference_verified: row.receipt_reference_verified,
      tool: text(row.tool) ? row.tool : null, artifact: text(row.artifact, 2048) ? row.artifact : null };
  });
  if (c.has_more && (entries.length === 0 || c.next_seq !== previous || c.next_seq >= c.through_seq)
    || !c.has_more && c.next_seq !== c.through_seq) throw new Error("project_history_cursor_invalid");
  return { entries, cursor: { after_seq: c.after_seq, through_seq: c.through_seq, next_seq: c.next_seq, has_more: c.has_more, commit_ordered: true } };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Shared read-only view. Failed reads retain rows; only an explicit window
 * change or filter reset discards presentation rows. PostgreSQL owns history. */
export function createProjectHistoryView({ bridge, expectedTaskId = null, maxRows = 2000, maxPages = 4, deadlineMs = 8_000,
  schedule = setTimeout, cancel = clearTimeout }: { bridge: () => ProjectHistoryBridge | null;
  expectedTaskId?: string | null;
  maxRows?: number; maxPages?: number; deadlineMs?: number; schedule?: typeof setTimeout; cancel?: typeof clearTimeout }) {
  if (!integer(maxRows) || maxRows < 128 || maxRows > 2000 || !integer(maxPages) || maxPages < 1 || maxPages > 4) throw new Error("project_history_configuration_invalid");
  let current: HistoryView = { overview: null, entries: [], cursor: null,
    filters: { task_id: null, attempt: null, event_type: null }, state: "UNBOUND", busy: false, capacityReached: false, windowStart: 0 };
  let generation = 0;
  let pending: { generation: number; promise: Promise<void> } | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<HistoryView>) => { current = { ...current, ...patch }; for (const listener of listeners) listener(); };
  const bounded = async <T,>(read: () => Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([read(), new Promise<never>((_, reject) => { timer = schedule(() => reject(new Error("project_history_deadline")), deadlineMs); })]); }
    finally { if (timer !== undefined) cancel(timer); }
  };
  const refresh = () => {
    if (pending?.generation === generation) return pending.promise;
    const requestGeneration = generation;
    publish({ busy: true, state: current.entries.length ? current.state : "LOADING" });
    const promise = (async () => {
      await Promise.resolve();
      try {
        const native = bridge(); if (!native?.projectOverview || !native.projectHistory) throw new Error("project_history_unavailable");
        const overview = readProjectOverview(await bounded(native.projectOverview), expectedTaskId);
        if (requestGeneration !== generation) return;
        if (!overview) { publish({ overview: null, entries: [], cursor: null, state: "UNBOUND", capacityReached: false, windowStart: 0 }); return; }
        if (current.overview?.project_id !== overview.project_id) publish({ overview, entries: [], cursor: null, capacityReached: false, windowStart: 0 });
        else publish({ overview });
        if (current.state === "RESYNC_REQUIRED" || current.capacityReached) return;
        for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
          const free = maxRows - current.entries.length;
          if (!free) { publish({ capacityReached: true }); break; }
          const priorCursor = current.cursor;
          const request: ProjectHistoryRequest = { project_id: overview.project_id, after_seq: priorCursor?.next_seq ?? current.windowStart,
            through_seq: priorCursor?.has_more ? priorCursor.through_seq : null, limit: Math.min(128, free), ...current.filters };
          const page = readProjectHistoryPage(await bounded(() => native.projectHistory(request)), request);
          if (requestGeneration !== generation) return;
          const known = new Map(current.entries.map(row => [row.seq, row]));
          if (page.entries.some(row => known.has(row.seq) && canonical(known.get(row.seq)) !== canonical(row))) {
            publish({ state: "RESYNC_REQUIRED" }); return;
          }
          for (const row of page.entries) if (!known.has(row.seq)) known.set(row.seq, row);
          publish({ entries: [...known.values()].sort((a, b) => a.seq - b.seq), cursor: page.cursor, state: "READY",
            capacityReached: known.size >= maxRows });
          if (!page.cursor.has_more) break;
        }
      } catch {
        if (requestGeneration === generation) publish({ state: "DEGRADED" });
      } finally {
        if (requestGeneration === generation) publish({ busy: false });
        if (pending?.generation === requestGeneration) pending = null;
      }
    })();
    pending = { generation: requestGeneration, promise }; return promise;
  };
  const reset = (after: number, filters = current.filters) => {
    generation++;
    publish({ entries: [], cursor: after === 0 ? null : { after_seq: after, next_seq: after, through_seq: current.cursor?.through_seq ?? after,
      has_more: current.cursor?.has_more ?? false, commit_ordered: true }, filters,
      state: "LOADING", busy: false, capacityReached: false, windowStart: after });
    return refresh();
  };
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    restart: () => reset(0),
    nextWindow: () => reset(current.cursor?.next_seq ?? 0),
    setFilters: (filters: ProjectHistoryFilters) => {
      if (!(filters.task_id === null || UUID.test(filters.task_id)) || !(filters.attempt === null || integer(filters.attempt))
        || !(filters.event_type === null || /^[A-Z][A-Z0-9_]{0,95}$/.test(filters.event_type))) throw new Error("project_history_filter_invalid");
      return reset(0, filters);
    },
  };
}

// Code and reopened Task Sheets reuse the same cursor for their exact source.
// The bounded cache is presentation memory; PostgreSQL remains the source.
const clientViews = new Map<string, ReturnType<typeof createProjectHistoryView>>();
export function getClientProjectHistoryView(taskId: string | null = null) {
  const key = taskId === null ? "latest" : `task:${taskId}`;
  const existing = clientViews.get(key);
  if (existing) return existing;
  const view = createProjectHistoryView({ expectedTaskId: taskId,
    bridge: () => {
      const native = (window as Window & { metaengineClient?: ProjectHistoryBridge }).metaengineClient;
      if (!native) return null;
      if (taskId === null) return native;
      return { projectHistory: native.projectHistory,
        projectOverview: () => UUID.test(taskId) && native.projectSnapshot
          ? native.projectSnapshot({ task_id: taskId, task_after_seq: 0, limit: 128 }) : Promise.resolve(null) };
    },
  });
  if (clientViews.size >= 33) {
    const oldestTaskKey = [...clientViews.keys()].find(value => value !== "latest");
    if (oldestTaskKey) clientViews.delete(oldestTaskKey);
  }
  clientViews.set(key, view);
  return view;
}
