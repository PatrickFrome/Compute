import { query } from "@/lib/pg";
import { CLOUD_FLEET_WORKSPACE } from "@/lib/cloud";
import { fleetEnqueue, fleetSnapshot, type FleetPlane } from "@/lib/fleet-plane";

export const dynamic = "force-dynamic";

/**
 * Milestone Runner — Roadmap → Fleet execution bridge (R3 closure, operator side).
 *
 * EXECUTION PLANE (2026-09-21 pivot): the cloud Supabase project was DELETED
 * (DNS dead); the operator's backup lives in the local Pigsty replica with the
 * SAME devos_fleet_* RPC surface. Dispatch/sync therefore go through the
 * plane-aware fleet module: cloud (if ever re-provisioned) → local Pigsty.
 * The UI badges which plane actually served each call.
 *
 *   dispatch        milestone → devos_fleet_enqueue_v1 (plane-aware)
 *                   (point_id = 'roadmap.<key>', plane lowercases it)
 *                   idempotent via enqueue_key 'mc-milestone:<key>';
 *                   a deliberate re-run after DONE/BLOCKED stamps a fresh key
 *   dispatch-phase  bulk dispatch every PLANNED milestone of a phase
 *   sync            fleet task state → milestone status transition
 *                   (in-flight → IN_PROGRESS, COMPLETED/RESULT_READY → DONE,
 *                    FAILED/BLOCKED/AMBIGUOUS → BLOCKED)
 *   set-status      manual operator override (console-local roadmap store)
 */

const MILESTONE_TABLE = "destruktion_meta.compute_fabric_roadmap_milestone_h205f22";
const POINT_PREFIX = "roadmap.";

const SETTABLE_STATUSES = new Set(["PLANNED", "IN_PROGRESS", "DONE", "BLOCKED"]);
const TASK_INFLIGHT = new Set(["QUEUED", "READY", "LEASED", "RUNNING"]);
const TASK_SUCCESS = new Set(["COMPLETED", "RESULT_READY"]);
const TASK_FAILURE = new Set(["FAILED", "BLOCKED", "AMBIGUOUS"]);

/** Deterministic role assignment by milestone family (first char of key). */
function deriveRole(key: string): string {
  const family = key.charAt(0).toUpperCase();
  switch (family) {
    case "A": return "IMPLEMENTER"; // agent adapters — build work
    case "B": return "PLANNER";     // control/trust baseline — planning work
    case "C": return "IMPLEMENTER"; // fabric features — build work
    case "D": return "RESEARCHER";
    case "E": return "SYNTHESIZER";
    case "F": return "FALSIFIER";
    default: return "IMPLEMENTER";
  }
}

interface MilestoneRow {
  roadmap_id: string;
  milestone_key: string;
  status: string;
  phase_order: number;
  priority: number;
}

async function loadMilestone(key: string): Promise<MilestoneRow | null> {
  const res = await query(
    `select roadmap_id, milestone_key, status, phase_order, priority
     from ${MILESTONE_TABLE} where milestone_key = $1 limit 1`,
    [key],
  );
  return (res.rows[0] as MilestoneRow) ?? null;
}

/** Fleet enqueue — plane-aware (cloud if configured, else local Pigsty replica). */
async function enqueueFleet(m: MilestoneRow): Promise<{
  accepted: boolean;
  taskId: string | null;
  state: string | null;
  duplicate: boolean;
  enqueueKey: string;
  plane: FleetPlane;
  error?: string;
}> {
  // Idempotency: bare key for the first run; a deliberate re-run after a
  // terminal milestone status stamps a unique key (rapid double-clicks with
  // a non-terminal milestone reuse the bare key → duplicate, by design).
  const rerun = m.status === "DONE" || m.status === "BLOCKED";
  const enqueueKey = rerun
    ? `mc-milestone:${m.milestone_key}:${Date.now().toString(36)}`
    : `mc-milestone:${m.milestone_key}`;
  const spec = {
    claim_class: "TASK",
    enqueue_key: enqueueKey,
    objective: `Execute roadmap milestone ${m.milestone_key} (phase ${m.phase_order}) — deliver artifact + checkpoint evidence`,
    source: "MISSION_CONTROL_ROADMAP_RUNNER",
    milestone_key: m.milestone_key,
    roadmap_id: m.roadmap_id,
  };
  try {
    const { plane, result } = await fleetEnqueue({
      workspace: CLOUD_FLEET_WORKSPACE,
      point: `${POINT_PREFIX}${m.milestone_key}`,
      role: deriveRole(m.milestone_key),
      base: "db5c83db806197b38b37338cdaff1ce69b825c08",
      spec,
      key: enqueueKey,
      priority: Math.min(99, Math.max(1, m.priority || 50)),
    });
    return {
      accepted: result.task_id != null,
      taskId: result.task_id ? String(result.task_id) : null,
      state: result.state ? String(result.state) : null,
      duplicate: result.duplicate === true,
      enqueueKey,
      plane,
    };
  } catch (e) {
    return { accepted: false, taskId: null, state: null, duplicate: false, enqueueKey, plane: cloudConfiguredFallbackPlane(), error: e instanceof Error ? e.message : String(e) };
  }
}

/** When enqueue itself throws before a plane was chosen, report the fallback plane. */
function cloudConfiguredFallbackPlane(): FleetPlane {
  return "local-pigsty";
}

interface CloudTaskView {
  taskId: string;
  keyLower: string;
  state: string;
  role: string;
  updatedAt: string | null;
}

/** Latest fleet task state per roadmap milestone (active rows + terminal events). */
async function fleetTaskStates(): Promise<{ plane: FleetPlane; states: Map<string, CloudTaskView> }> {
  const { plane, snap } = await fleetSnapshot();
  const latest = new Map<string, CloudTaskView>();

  const touch = (rawPoint: unknown, taskId: unknown, state: string, role: unknown, at: unknown, priority: unknown) => {
    const point = String(rawPoint ?? "");
    if (!point.toLowerCase().startsWith(POINT_PREFIX)) return;
    const keyLower = point.slice(POINT_PREFIX.length).toLowerCase();
    const prev = latest.get(keyLower);
    // active/terminal readbacks are appended in order; later rows win
    latest.set(keyLower, {
      taskId: String(taskId ?? prev?.taskId ?? ""),
      keyLower,
      state,
      role: String(role ?? prev?.role ?? "").toUpperCase(),
      updatedAt: at ? new Date(String(at)).toISOString() : prev?.updatedAt ?? null,
      priority: Number.isFinite(Number(priority)) ? Number(priority) : prev?.priority ?? null,
    } as CloudTaskView & { priority: number | null });
  };

  for (const t of snap.active_tasks ?? []) {
    touch(t.point_id, t.task_id, String(t.state ?? "?").toUpperCase(), t.role, t.updated_at ?? t.created_at, t.priority);
  }
  for (const e of snap.recent_events ?? []) {
    const type = String(e.event_type ?? "");
    const terminal = type.startsWith("TASK_RESULT_")
      ? type.slice("TASK_RESULT_".length)
      : type === "TASK_LEASE_EXPIRED_AMBIGUOUS"
        ? "AMBIGUOUS"
        : null;
    if (!terminal) continue;
    touch(e.point_id, e.task_id, terminal.toUpperCase(), e.role, e.created_at, null);
  }
  return { plane, states: latest };
}

async function syncMilestones(): Promise<{ plane: FleetPlane; changed: { key: string; from: string; to: string; taskId: string | null }[] }> {
  const [milestonesRes, fleet] = await Promise.all([
    query(`select milestone_key, status from ${MILESTONE_TABLE}`),
    fleetTaskStates(),
  ]);
  const states = fleet.states;

  const changed: { key: string; from: string; to: string; taskId: string | null }[] = [];
  for (const m of milestonesRes.rows) {
    const key = String(m.milestone_key);
    const from = String(m.status ?? "PLANNED");
    const t = states.get(key.toLowerCase());
    if (!t) continue;

    let to: string | null = null;
    if (TASK_SUCCESS.has(t.state) && from !== "DONE" && from !== "BLOCKED") to = "DONE";
    else if (TASK_FAILURE.has(t.state) && from !== "DONE") to = "BLOCKED";
    else if (TASK_INFLIGHT.has(t.state) && from === "PLANNED") to = "IN_PROGRESS";
    if (!to || to === from) continue;

    await query(
      `update ${MILESTONE_TABLE}
       set status = $2, verified_checkpoint_id = $3, updated_at = clock_timestamp()
       where milestone_key = $1`,
      [key, to, to === "DONE" ? t.taskId : null],
    );
    changed.push({ key, from, to, taskId: t.taskId });
  }
  return { plane: fleet.plane, changed };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();

    if (action === "dispatch") {
      const key = String(body.key ?? "").trim();
      if (!key) return Response.json({ ok: false, error: "key_required" }, { status: 400 });
      const m = await loadMilestone(key);
      if (!m) return Response.json({ ok: false, error: "milestone_not_found" }, { status: 404 });
      const r = await enqueueFleet(m);
      if (!r.accepted) {
        return Response.json({ ok: false, error: r.error ?? "enqueue_rejected", result: r }, { status: 502 });
      }
      // milestone stays PLANNED here — sync flips it to IN_PROGRESS once the
      // fleet lease materializes (single source of truth = execution plane)
      return Response.json({ ok: true, action, milestone: key, taskId: r.taskId, state: r.state, duplicate: r.duplicate, enqueueKey: r.enqueueKey, plane: r.plane });
    }

    if (action === "dispatch-phase") {
      const phase = Number(body.phase);
      if (!Number.isFinite(phase)) return Response.json({ ok: false, error: "phase_required" }, { status: 400 });
      const res = await query(
        `select roadmap_id, milestone_key, status, phase_order, priority
         from ${MILESTONE_TABLE}
         where phase_order = $1 and status = 'PLANNED'
         order by priority asc, milestone_key`,
        [phase],
      );
      const dispatched: { key: string; taskId: string | null }[] = [];
      const failed: { key: string; error: string }[] = [];
      let plane: FleetPlane = "local-pigsty";
      for (const row of res.rows as MilestoneRow[]) {
        const r = await enqueueFleet(row);
        plane = r.plane;
        if (r.accepted) dispatched.push({ key: row.milestone_key, taskId: r.taskId });
        else failed.push({ key: row.milestone_key, error: r.error ?? "enqueue_rejected" });
      }
      return Response.json({ ok: failed.length === 0, action, phase, dispatchedCount: dispatched.length, dispatched, failed, plane });
    }

    if (action === "sync") {
      const { plane, changed } = await syncMilestones();
      return Response.json({ ok: true, action, changedCount: changed.length, changed, plane });
    }

    if (action === "set-status") {
      const key = String(body.key ?? "").trim();
      const status = String(body.status ?? "").trim().toUpperCase();
      if (!key || !SETTABLE_STATUSES.has(status)) {
        return Response.json({ ok: false, error: "key_and_valid_status_required", allowed: [...SETTABLE_STATUSES] }, { status: 400 });
      }
      const m = await loadMilestone(key);
      if (!m) return Response.json({ ok: false, error: "milestone_not_found" }, { status: 404 });
      await query(
        `update ${MILESTONE_TABLE}
         set status = $2,
             verified_checkpoint_id = case when $2 = 'DONE' then verified_checkpoint_id else null end,
             updated_at = clock_timestamp()
         where milestone_key = $1`,
        [key, status],
      );
      return Response.json({ ok: true, action, milestone: key, from: m.status, to: status });
    }

    return Response.json({ ok: false, error: "unknown_action", allowed: ["dispatch", "dispatch-phase", "sync", "set-status"] }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
