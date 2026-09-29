// ME2 command manifest — faithful port of the legacy 47-action surface
// (hostsrc/Compute-rel apps/metaengine-browser/src/control-actions-manifest.mjs)
// with the legacy 4-lane scheduler semantics (EMERGENCY / READ_ONLY / TAB_MUTATION / GLOBAL_MUTATION).

export type Lane = "EMERGENCY" | "READ_ONLY" | "TAB_MUTATION" | "GLOBAL_MUTATION";

export interface ActionSpec {
  action: string;
  lane: Lane;
  cost: number; // budget units consumed (mutation lanes only)
  desc: string;
}

export const LANE_PRIORITY: Record<Lane, number> = {
  EMERGENCY: 0,
  GLOBAL_MUTATION: 2,
  TAB_MUTATION: 4,
  READ_ONLY: 9,
};

export const ACTIONS: ActionSpec[] = [
  // READ_ONLY (cost 0)
  { action: "POLL", lane: "READ_ONLY", cost: 0, desc: "Ping daemon liveness" },
  { action: "CAPTURE", lane: "READ_ONLY", cost: 0, desc: "Capture semantic frame of target tab" },
  { action: "CAPTURE_VIEW", lane: "READ_ONLY", cost: 0, desc: "Capture view thumbnail" },
  { action: "CONTROL_CAPABILITIES", lane: "READ_ONLY", cost: 0, desc: "List control capabilities" },
  { action: "PROCESS_CENSUS", lane: "READ_ONLY", cost: 0, desc: "Census of daemon processes" },
  { action: "PROCESS_EVENTS", lane: "READ_ONLY", cost: 0, desc: "Recent process events" },
  { action: "SEMANTIC_CENSUS", lane: "READ_ONLY", cost: 0, desc: "Semantic census of surfaces" },
  { action: "SEMANTIC_EVENTS", lane: "READ_ONLY", cost: 0, desc: "Recent semantic events" },
  { action: "CONTROL_LATENCY_STATUS", lane: "READ_ONLY", cost: 0, desc: "Command latency p50/p99" },
  { action: "TAB_TELEMETRY", lane: "READ_ONLY", cost: 0, desc: "Per-tab telemetry" },
  { action: "SYSTEM_TELEMETRY", lane: "READ_ONLY", cost: 0, desc: "System telemetry" },
  { action: "READ_TRANSCRIPT", lane: "READ_ONLY", cost: 0, desc: "Read transcript of conversation" },
  { action: "TAB_CENSUS", lane: "READ_ONLY", cost: 0, desc: "Census of browser tabs" },
  { action: "FLEET_STATUS", lane: "READ_ONLY", cost: 0, desc: "Fleet and backlog status" },
  { action: "DOWNLOAD_STATUS", lane: "READ_ONLY", cost: 0, desc: "Downloads status" },
  { action: "SELF_UPDATE_STATUS", lane: "READ_ONLY", cost: 0, desc: "Self-update status" },
  { action: "DEV_PLANE_STATUS", lane: "READ_ONLY", cost: 0, desc: "Development plane status" },
  { action: "DEV_PLANE_HEALTH", lane: "READ_ONLY", cost: 0, desc: "Development plane health" },
  { action: "DEV_PLANE_CAPABILITIES", lane: "READ_ONLY", cost: 0, desc: "Dev plane capabilities" },
  { action: "DEV_PLANE_PROCESS_METRICS", lane: "READ_ONLY", cost: 0, desc: "Dev plane metrics" },
  { action: "DEV_PLANE_REPO_HEAD", lane: "READ_ONLY", cost: 0, desc: "Dev plane repo HEAD" },
  { action: "GATE_STATUS", lane: "READ_ONLY", cost: 0, desc: "Gate policy status" },
  { action: "WORKTREE_LIST", lane: "READ_ONLY", cost: 0, desc: "List git worktrees (dev plane)" },
  { action: "TASK_GET", lane: "READ_ONLY", cost: 0, desc: "Full task detail incl. EARS spec" },
  { action: "MIRROR_STATUS", lane: "READ_ONLY", cost: 0, desc: "Evidence mirror outbox status" },

  // TAB_MUTATION (cost 1)
  { action: "STOP_GENERATION", lane: "TAB_MUTATION", cost: 1, desc: "Stop generation on tab" },
  { action: "SCROLL", lane: "TAB_MUTATION", cost: 1, desc: "Scroll tab content" },
  { action: "SEMANTIC_FOCUS", lane: "TAB_MUTATION", cost: 1, desc: "Focus semantic target" },
  { action: "SEMANTIC_TYPE", lane: "TAB_MUTATION", cost: 1, desc: "Type into semantic composer" },
  { action: "TYPED_CLICK", lane: "TAB_MUTATION", cost: 1, desc: "Typed click on target" },
  { action: "PRESS_KEY", lane: "TAB_MUTATION", cost: 1, desc: "Press whitelisted key" },
  { action: "SELECT_TAB", lane: "TAB_MUTATION", cost: 1, desc: "Select tab" },
  { action: "CLOSE_TAB", lane: "TAB_MUTATION", cost: 1, desc: "Close tab" },
  { action: "NAVIGATE", lane: "TAB_MUTATION", cost: 1, desc: "Navigate tab to URL" },
  { action: "BACK", lane: "TAB_MUTATION", cost: 1, desc: "Navigate back" },
  { action: "FORWARD", lane: "TAB_MUTATION", cost: 1, desc: "Navigate forward" },
  { action: "RELOAD", lane: "TAB_MUTATION", cost: 1, desc: "Reload tab" },

  // GLOBAL_MUTATION (cost 2)
  { action: "ARM", lane: "GLOBAL_MUTATION", cost: 2, desc: "Arm supervisor control" },
  { action: "SET_SUPERVISOR_MODE", lane: "GLOBAL_MUTATION", cost: 2, desc: "Set supervisor mode" },
  { action: "NEW_TAB", lane: "GLOBAL_MUTATION", cost: 2, desc: "Open new browser tab" },
  { action: "FLEET_RECONCILE", lane: "GLOBAL_MUTATION", cost: 2, desc: "Reconcile fleet to target" },
  { action: "FLEET_SET_PROFILE", lane: "GLOBAL_MUTATION", cost: 2, desc: "Set fleet profile" },
  { action: "DOWNLOAD_FILE", lane: "GLOBAL_MUTATION", cost: 2, desc: "Start verified download" },
  { action: "DOWNLOAD_CANCEL", lane: "GLOBAL_MUTATION", cost: 2, desc: "Cancel download" },
  { action: "SELF_UPDATE_CHECK", lane: "GLOBAL_MUTATION", cost: 2, desc: "Check for update" },
  { action: "SELF_UPDATE_APPLY", lane: "GLOBAL_MUTATION", cost: 2, desc: "Apply pending update" },
  { action: "GATE_DISABLE", lane: "GLOBAL_MUTATION", cost: 2, desc: "Disable named gate" },
  { action: "GATE_DISABLE_ALL", lane: "GLOBAL_MUTATION", cost: 2, desc: "Disable all gates" },
  { action: "GATE_ENABLE", lane: "GLOBAL_MUTATION", cost: 2, desc: "Enable named gate" },
  { action: "GATE_ENABLE_ALL", lane: "GLOBAL_MUTATION", cost: 2, desc: "Enable all gates" },
  { action: "WORKTREE_CREATE", lane: "GLOBAL_MUTATION", cost: 2, desc: "Create git worktree (managed root)" },
  { action: "WORKTREE_REMOVE", lane: "GLOBAL_MUTATION", cost: 2, desc: "Remove managed git worktree" },
  { action: "WORKTREE_PRUNE", lane: "GLOBAL_MUTATION", cost: 2, desc: "Prune stale worktree metadata" },
  { action: "MIRROR_FLUSH", lane: "GLOBAL_MUTATION", cost: 1, desc: "Force evidence mirror flush" },

  // EMERGENCY (bypass budget)
  { action: "DISARM", lane: "EMERGENCY", cost: 0, desc: "Disarm supervisor (emergency)" },
  { action: "DEVELOPER_EMERGENCY_UPDATE", lane: "EMERGENCY", cost: 0, desc: "Emergency update" },
  { action: "SET_SUPERVISOR_MODE_OFF", lane: "EMERGENCY", cost: 0, desc: "Supervisor mode OFF" },
];

export const ACTION_MAP: Map<string, ActionSpec> = new Map(
  ACTIONS.map((a) => [a.action, a]),
);

export const BUDGET = { limit: 24, windowMs: 60_000 } as const;
