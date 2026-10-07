export type ClientConnectionStatus = {
  schema: "metaengine.client.connection-status.v1";
  local_runtime_ready: boolean;
  admin_ready: boolean;
  cloud_control_state: string;
  admin_grant_epoch?: number | null;
  cloud_health?: string;
  authority_effect: false;
};

export type ClientWorkReadiness = {
  schema: "metaengine.client.work-readiness.v1";
  observed_at: string;
  state: "READY" | "PAUSED" | "BLOCKED";
  reason: string | null;
  label: string;
  detail: string;
  execution_ready: boolean;
  readiness_scope: "CHAT_DISPATCH";
  capabilities: Record<"chat_dispatch" | "coding_execution" | "host_continuity" | "continuous_autonomy", { ready: boolean; reason: string | null }>;
  continuous_autonomy_ready: boolean;
  heartbeat_fresh: boolean;
  generation_floor: number | null;
  local_generation_floor: number | null;
  supervisor_state: string | null;
  supervisor_cycle_seq: number | null;
  proven_agent_count: number;
  active_agent_count: number | null;
  bound_unverified_agent_count: number | null;
  ambiguous_agent_count: number;
  useful_work_verified: false;
  verified_self_improvement: false;
  recovery_effect_exposed: false;
  scheduler_authority: false;
  automatic_retry_allowed: false;
  authority_effect: false;
};

type RuntimeReadback = { connection: ClientConnectionStatus; work: ClientWorkReadiness };
type ResourceSnapshot = { state: "LOADING" | "LIVE" | "UNAVAILABLE"; readback: RuntimeReadback | null };
export const INITIAL_CLIENT_RUNTIME: ResourceSnapshot = Object.freeze({ state: "LOADING", readback: null });

function validReadback(value: RuntimeReadback) {
  const connection = value?.connection;
  const work = value?.work;
  const observed = Date.parse(work?.observed_at || '');
  const now = Date.now();
  return connection?.schema === "metaengine.client.connection-status.v1"
    && connection.authority_effect === false
    && typeof connection.admin_ready === "boolean"
    && typeof connection.local_runtime_ready === "boolean"
    && typeof connection.cloud_control_state === "string"
    && work?.schema === "metaengine.client.work-readiness.v1"
    && Number.isFinite(observed) && observed <= now + 5_000 && now - observed <= 30_000
    && ["READY", "PAUSED", "BLOCKED"].includes(work.state)
    && work.execution_ready === (work.state === "READY")
    && work.readiness_scope === "CHAT_DISPATCH"
    && ["chat_dispatch", "coding_execution", "host_continuity", "continuous_autonomy"].every((key) => {
      const value = work.capabilities?.[key as keyof ClientWorkReadiness["capabilities"]];
      return typeof value?.ready === "boolean" && (value.ready ? value.reason === null : typeof value.reason === "string");
    })
    && work.capabilities.chat_dispatch.ready === work.execution_ready
    && work.continuous_autonomy_ready === work.capabilities.continuous_autonomy.ready
    && (!work.capabilities.coding_execution.ready || work.execution_ready)
    && (!work.continuous_autonomy_ready || (work.execution_ready && work.capabilities.coding_execution.ready && work.capabilities.host_continuity.ready))
    && typeof work.label === "string" && work.label.length <= 80
    && typeof work.detail === "string" && work.detail.length <= 320
    && typeof work.heartbeat_fresh === "boolean"
    && (work.state !== "READY" || (work.heartbeat_fresh === true
      && connection.admin_ready === true && connection.cloud_control_state === "CONNECTED"
      && Number.isSafeInteger(work.proven_agent_count) && work.proven_agent_count > 0
      && typeof work.generation_floor === "number" && Number.isSafeInteger(work.generation_floor) && work.generation_floor >= 0
      && typeof work.local_generation_floor === "number" && Number.isSafeInteger(work.local_generation_floor) && work.local_generation_floor >= 0
      && work.generation_floor >= work.local_generation_floor))
    && work.useful_work_verified === false
    && work.verified_self_improvement === false
    && work.recovery_effect_exposed === false && work.scheduler_authority === false
    && work.automatic_retry_allowed === false && work.authority_effect === false;
}

// UI observation only. The Native Supervisor retains every reconnect and
// execution effect. A rejected/hung read must not keep a green cached badge.
export function createClientRuntimeResource({
  read,
  isVisible,
  onVisibilityChange,
  schedule = (fn: () => void, ms: number) => setTimeout(fn, ms),
  cancel = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  intervalMs = 2_000,
  deadlineMs = 4_000,
}: {
  read: () => Promise<RuntimeReadback>;
  isVisible: () => boolean;
  onVisibilityChange: (fn: () => void) => () => void;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  intervalMs?: number;
  deadlineMs?: number;
}) {
  let snapshot = INITIAL_CLIENT_RUNTIME;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let removeVisibility: (() => void) | null = null;
  let epoch = 0;
  let pending: Promise<void> | null = null;

  const publish = (next: ResourceSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const stopTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const refresh = (): Promise<void> => {
    if (listeners.size === 0 || !isVisible()) return Promise.resolve();
    if (pending) return pending;
    stopTimer();
    const requestEpoch = epoch;
    pending = (async () => {
      try {
        const next = await Promise.race([
          Promise.resolve().then(read),
          new Promise<never>((_, reject) => {
            timeout = schedule(() => reject(new Error("client_runtime_read_deadline")), deadlineMs);
          }),
        ]);
        if (!validReadback(next)) throw new Error("client_runtime_readback_invalid");
        if (requestEpoch === epoch) publish({ state: "LIVE", readback: next });
      } catch {
        if (requestEpoch === epoch) publish({ state: "UNAVAILABLE", readback: null });
      } finally {
        if (timeout !== null) cancel(timeout);
        timeout = null;
        pending = null;
        if (listeners.size > 0 && isVisible()) timer = schedule(() => { timer = null; void refresh(); }, intervalMs);
      }
    })();
    return pending;
  };
  const visibilityChanged = () => {
    stopTimer();
    epoch += 1;
    // A cached pre-background success is not current readback.
    publish({ state: "LOADING", readback: null });
    if (isVisible()) void refresh();
  };
  return {
    getSnapshot: () => snapshot,
    refresh,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        removeVisibility = onVisibilityChange(visibilityChanged);
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopTimer();
          epoch += 1;
          snapshot = INITIAL_CLIENT_RUNTIME;
          removeVisibility?.();
          removeVisibility = null;
        }
      };
    },
  };
}
