// R81-PHASE1: donor action registry — recovered verbatim from the donor
// lineage GitHub sandbox/me2-os @ 56ba1b87e71d0e95c1adb8a2c4e5640629d4cfd8
// (path: mini-services/me2-daemon/src/actions.ts, donor daemon v0.57.1).
// The donor file declares itself a faithful port of the legacy 47-action
// control surface (apps/metaengine-browser/src/control-actions-manifest.mjs)
// with the legacy 4-lane scheduler semantics; the donor manifest itself
// carries 57 entries. Honest reporting only: recovered ≠ implemented locally.

export type Lane = "EMERGENCY" | "READ_ONLY" | "TAB_MUTATION" | "GLOBAL_MUTATION";

export interface DonorActionSpec {
  action: string;
  lane: Lane;
  cost: number;
  desc: string;
}

export const LANE_PRIORITY: Record<Lane, number> = {
  EMERGENCY: 0,
  GLOBAL_MUTATION: 2,
  TAB_MUTATION: 4,
  READ_ONLY: 9,
};

export const BUDGET = { limit: 24, windowMs: 60_000 } as const;

export const DONOR_PROVENANCE = {
  source_ref: "sandbox/me2-os",
  source_sha: "56ba1b87e71d0e95c1adb8a2c4e5640629d4cfd8",
  source_path: "mini-services/me2-daemon/src/actions.ts",
  donor_daemon_version: "0.57.1",
  legacy_surface: "apps/metaengine-browser/src/control-actions-manifest.mjs (47 actions)",
  recovered_at: "2026-09-26T07:00:00Z",
  recovered_via: "GitHub contents API (PAT, /home/z/.a2/.github.env)",
} as const;

export const DONOR_ACTIONS: DonorActionSpec[] = [
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

// Reconciliation against the local recovery-build surface. Mode:
//  full    — local action covers the donor semantics within sandbox scope
//  partial — local action covers a meaningful subset (noted)
const COUNTERPARTS: { donor: string; local: string; mode: "full" | "partial"; note: string }[] = [
  { donor: "POLL", local: "health.check", mode: "full", note: "daemon liveness" },
  { donor: "CONTROL_CAPABILITIES", local: "capabilities.list", mode: "full", note: "registry listing" },
  { donor: "WORKTREE_LIST", local: "worktrees.list", mode: "full", note: "managed worktrees" },
  { donor: "WORKTREE_CREATE", local: "worktrees.create", mode: "full", note: "wt-<name> whitelist" },
  { donor: "WORKTREE_REMOVE", local: "worktrees.remove", mode: "full", note: "fail-closed if dirty" },
  { donor: "DEV_PLANE_CAPABILITIES", local: "controlplane.capabilities", mode: "full", note: "devos_runtime_capabilities_v1 RPC" },
  { donor: "DEV_PLANE_STATUS", local: "controlplane.supervisor", mode: "partial", note: "supervisor/dev-plane snapshot via Supabase read model" },
  { donor: "MIRROR_STATUS", local: "controlplane.mirror-tail", mode: "partial", note: "tail read vs full outbox status" },
  { donor: "MIRROR_FLUSH", local: "controlplane.mirror-anchor", mode: "partial", note: "operator anchor write vs force flush" },
];

export interface DonorRegistryReport {
  provenance: typeof DONOR_PROVENANCE;
  lanes: Record<Lane, number>;
  total: number;
  legacy_surface_count: number;
  budget: typeof BUDGET;
  lane_priority: Record<Lane, number>;
  actions: DonorActionSpec[];
  reconciliation: {
    counterparts: typeof COUNTERPARTS;
    counterparts_count: number;
    full: number;
    partial: number;
    pending_count: number;
    pending_by_lane: Record<Lane, string[]>;
    local_only_count: number;
    local_only: string[];
    note: string;
  };
}

export function donorRegistry(localActions: { name: string; family: string }[]): DonorRegistryReport {
  const byLane = (l: Lane) => DONOR_ACTIONS.filter((a) => a.lane === l);
  const mappedDonor = new Set(COUNTERPARTS.map((c) => c.donor));
  const mappedLocal = new Set(COUNTERPARTS.map((c) => c.local));
  const pendingOf = (l: Lane) => byLane(l).filter((a) => !mappedDonor.has(a.action)).map((a) => a.action);
  const localOnly = localActions.filter((a) => !mappedLocal.has(a.name)).map((a) => a.name);
  return {
    provenance: DONOR_PROVENANCE,
    lanes: {
      EMERGENCY: byLane("EMERGENCY").length,
      READ_ONLY: byLane("READ_ONLY").length,
      TAB_MUTATION: byLane("TAB_MUTATION").length,
      GLOBAL_MUTATION: byLane("GLOBAL_MUTATION").length,
    },
    total: DONOR_ACTIONS.length,
    legacy_surface_count: 47,
    budget: BUDGET,
    lane_priority: LANE_PRIORITY,
    actions: DONOR_ACTIONS,
    reconciliation: {
      counterparts: COUNTERPARTS,
      counterparts_count: COUNTERPARTS.length,
      full: COUNTERPARTS.filter((c) => c.mode === "full").length,
      partial: COUNTERPARTS.filter((c) => c.mode === "partial").length,
      pending_count: DONOR_ACTIONS.length - COUNTERPARTS.length,
      pending_by_lane: {
        READ_ONLY: pendingOf("READ_ONLY"),
        TAB_MUTATION: pendingOf("TAB_MUTATION"),
        GLOBAL_MUTATION: pendingOf("GLOBAL_MUTATION"),
        EMERGENCY: pendingOf("EMERGENCY"),
      },
      local_only_count: localOnly.length,
      local_only: localOnly,
      note:
        "Donor bus — это Browser control surface (4-lane scheduler, budget 24/60s). Локальный recovery-daemon покрывает только sandbox-подмножество (REST-семейства); полная реализация pending-действий требует installed Browser control plane (R84–R86) и не может быть честно заявлена из песочницы.",
    },
  };
}
