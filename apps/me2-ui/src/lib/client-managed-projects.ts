export type ManagedClientProject = {
  workspace_id: string;
  task_id: string;
  agent_id: string;
  state: "RESERVED" | "READY" | "FROZEN";
  workspace_generation: number;
  repo_id: string;
  branch_name: string;
  can_create: boolean;
  can_open: boolean;
  in_flight: boolean;
  reason: string | null;
};

export type ManagedClientProjectStatus = {
  schema: "metaengine.client.managed-project-status.v1";
  state: "AVAILABLE" | "UNAVAILABLE" | "DEGRADED";
  host_state: string;
  observed_at: string | null;
  reason: string | null;
  projects: ManagedClientProject[];
  authority_effect: false;
};

export type ManagedProjectBridge = {
  projectStatus: () => Promise<unknown>;
  createProject: (request: { workspace_id: string }) => Promise<unknown>;
  openProject: (request: { workspace_id: string }) => Promise<unknown>;
};

type ProjectAction = "create" | "open";
type ProjectView = {
  status: ManagedClientProjectStatus | null;
  loading: boolean;
  pending: { action: ProjectAction; workspaceId: string } | null;
  error: string | null;
  completed: { action: ProjectAction; workspaceId: string } | null;
};

const cleanId = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && value.length <= 192 && !/[\u0000-\u001f]/.test(value);
const cleanText = (value: unknown): value is string => typeof value === "string"
  && value.length <= 256 && !/[\u0000-\u001f]/.test(value);

export function validateManagedProjectStatus(value: unknown, now = Date.now()): value is ManagedClientProjectStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as ManagedClientProjectStatus;
  if (status.schema !== "metaengine.client.managed-project-status.v1" || status.authority_effect !== false
    || !["AVAILABLE", "UNAVAILABLE", "DEGRADED"].includes(status.state)
    || !cleanText(status.host_state) || !(status.reason === null || cleanText(status.reason))
    || !(status.observed_at === null || typeof status.observed_at === "string")
    || !Array.isArray(status.projects) || status.projects.length > 200) return false;
  const observed = Date.parse(status.observed_at ?? "");
  if (status.state === "AVAILABLE" && (status.host_state !== "READY" || status.reason !== null || !Number.isFinite(observed)
    || observed > now + 5_000 || now - observed > 45_000)) return false;
  const seen = new Set<string>();
  return status.projects.every((row) => {
    if (!row || !cleanId(row.workspace_id) || seen.has(row.workspace_id)
      || !cleanId(row.task_id) || !cleanId(row.agent_id) || !cleanId(row.repo_id) || !cleanText(row.branch_name)
      || !["RESERVED", "READY", "FROZEN"].includes(row.state)
      || !Number.isSafeInteger(row.workspace_generation) || row.workspace_generation < 1
      || typeof row.can_create !== "boolean" || typeof row.can_open !== "boolean" || typeof row.in_flight !== "boolean"
      || !(row.reason === null || cleanText(row.reason))) return false;
    if ((status.state !== "AVAILABLE" || row.state === "FROZEN" || row.in_flight) && (row.can_create || row.can_open)) return false;
    if (row.can_open && row.state !== "READY") return false;
    seen.add(row.workspace_id);
    return true;
  });
}

/** Presentation state only. The host revalidates admission on every effect. */
export function createManagedProjectsView({
  bridge,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}: {
  bridge: () => ManagedProjectBridge | null;
  now?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}) {
  let current: ProjectView = { status: null, loading: false, pending: null, error: null, completed: null };
  const listeners = new Set<() => void>();
  let reading: Promise<void> | null = null;
  const publish = (patch: Partial<ProjectView>) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
  };
  const refresh = () => {
    if (reading) return reading;
    publish({ loading: true, status: null });
    reading = (async () => {
      await Promise.resolve();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const native = bridge();
        if (!native?.projectStatus) throw new Error("managed_project_client_unavailable");
        const value = await Promise.race([
          native.projectStatus(),
          new Promise<never>((_, reject) => { timer = schedule(() => reject(new Error("managed_project_client_status_deadline")), 4_000); }),
        ]);
        if (!validateManagedProjectStatus(value, now())) throw new Error("managed_project_client_status_invalid");
        publish({ status: value, loading: false });
      } catch {
        publish({ status: null, loading: false });
      } finally {
        if (timer !== undefined) cancel(timer);
        reading = null;
      }
    })();
    return reading;
  };
  const perform = async (action: ProjectAction, workspaceId: string) => {
    if (current.pending) return false;
    const status = current.status;
    const row = status?.projects.find((project) => project.workspace_id === workspaceId);
    if (!status || !validateManagedProjectStatus(status, now()) || !row
      || !(action === "create" ? row.can_create : row.can_open)) {
      publish({ error: "managed_project_client_action_unavailable", completed: null });
      return false;
    }
    publish({ pending: { action, workspaceId }, error: null, completed: null });
    let proven = false;
    try {
      const native = bridge();
      if (!native) throw new Error("managed_project_client_unavailable");
      const result = await (action === "create" ? native.createProject({ workspace_id: workspaceId }) : native.openProject({ workspace_id: workspaceId })) as {
        schema?: string; ok?: boolean; state?: string; action?: string; workspace_id?: string;
        task_id?: string; workspace_generation?: number; opened?: boolean; authority_effect?: boolean; automatic_retry_allowed?: boolean;
        head_sha?: string; replayed?: boolean;
      };
      if (result?.schema !== "metaengine.client.managed-project-result.v1" || result.ok !== true || result.state !== "PROVEN"
        || result.action !== (action === "create" ? "PROJECT_CREATE" : "PROJECT_OPEN") || result.workspace_id !== workspaceId
        || result.task_id !== row.task_id || result.workspace_generation !== row.workspace_generation
        || typeof result.head_sha !== "string" || !/^[0-9a-f]{40}$/.test(result.head_sha) || typeof result.replayed !== "boolean"
        || typeof result.opened !== "boolean"
        || result.authority_effect !== false || result.automatic_retry_allowed !== false || (action === "open" && result.opened !== true)) {
        throw new Error("managed_project_client_result_invalid");
      }
      proven = true;
      publish({ completed: { action, workspaceId } });
    } catch (error) {
      const reason = error instanceof Error && /^managed_project_client_[a-z_]+$/.test(error.message)
        ? error.message : "managed_project_client_action_failed";
      publish({ error: reason });
    } finally {
      // A read started before the receipt must not count as its final readback.
      if (reading) await reading;
      await refresh();
      publish({ pending: null });
    }
    return proven;
  };
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    create: (workspaceId: string) => perform("create", workspaceId),
    open: (workspaceId: string) => perform("open", workspaceId),
  };
}
