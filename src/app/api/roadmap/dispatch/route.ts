import { query } from "@/lib/pg";
import { cloudConfigured, cloudFleetSnapshot, cloudRpc, CLOUD_FLEET_WORKSPACE } from "@/lib/cloud";

export const dynamic = "force-dynamic";

/**
 * Milestone Runner — Roadmap → Fleet execution bridge (R3 closure, operator side).
 *
 * EXECUTION PLANE (2026-09-21 fix): the live browser is CLOUD-FIRST — its
 * supervisor cycle leases DevOS tasks from the CLOUD database (Supabase),
 * not from the local Pigsty contour. Milestone tasks enqueued into local PG
 * sat READY forever (zero lease attempts in 5h) while an identical task
 * enqueued into the cloud was LEASED within ~12s by a live GLM agent tab.
 * Therefore dispatch/sync below target the CLOUD plane as the single
 * authority; the local contour remains a rehearsal plane (Drive full cycle).
 *
 *   dispatch        milestone → cloud devos_fleet_enqueue_v1
 *                   (point_id = 'roadmap.<key>', cloud lowercases it)
 *                   idempotent via enqueue_key 'mc-milestone:<key>';
 *                   a deliberate re-run after DONE/BLOCKED stamps a fresh key
 *   dispatch-phase  bulk dispatch every PLANNED milestone of a phase
 *   sync            cloud task state → milestone status transition
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

/** Cloud enqueue — the plane the live browser actually leases from. */
async function enqueueCloud(m: MilestoneRow): Promise<{
  accepted: boolean;
  taskId: string | null;
  state: string | null;
  duplicate: boolean;
  enqueueKey: string;
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
    const result = await cloudRpc<Record<string, unknown>>("devos_fleet_enqueue_v1", {
      p_workspace: CLOUD_FLEET_WORKSPACE,
      p_point: `${POINT_PREFIX}${m.milestone_key}`,
      p_role: deriveRole(m.milestone_key),
      p_base: "db5c83db806197b38b37338cdaff1ce69b825c08",
      p_spec: spec,
      p_key: enqueueKey,
      p_priority: Math.min(99, Math.max(1, m.priority || 50)),
    });
    return {
      accepted: result.task_id != null,
      taskId: result.task_id ? String(result.task_id) : null,
      state: result.state ? String(result.state) : null,
      duplicate: result.duplicate === true,
      enqueueKey,
    };
  } catch (e) {
    return { accepted: false, taskId: null, state: null, duplicate: false, enqueueKey, error: e instanceof Error ? e.message : String(e) };
  }
}

interface CloudTaskView {
  taskId: string;
  keyLower: string;
  state: string;
  role: string;
  updatedAt: string | null;
}

/** Latest cloud task state per roadmap milestone (active rows + terminal events). */
async function cloudTaskStates(): Promise<Map<string, CloudTaskView>> {
  const snap = await cloudFleetSnapshot();
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
  return latest;
}

async function syncMilestones(): Promise<{ changed: { key: string; from: string; to: string; taskId: string | null }[] }> {
  const [milestonesRes, states] = await Promise.all([
    query(`select milestone_key, status from ${MILESTONE_TABLE}`),
    cloudTaskStates(),
  ]);

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
  return { changed };
}

export async function POST(req: Request) {
  try {
    if (!cloudConfigured()) {
      return Response.json({ ok: false, error: "cloud creds unavailable — dispatch targets the CLOUD execution plane" }, { status: 503 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();

    if (action === "dispatch") {
      const key = String(body.key ?? "").trim();
      if (!key) return Response.json({ ok: false, error: "key_required" }, { status: 400 });
      const m = await loadMilestone(key);
      if (!m) return Response.json({ ok: false, error: "milestone_not_found" }, { status: 404 });
      const r = await enqueueCloud(m);
      if (!r.accepted) {
        return Response.json({ ok: false, error: r.error ?? "enqueue_rejected", result: r }, { status: 502 });
      }
      // milestone stays PLANNED here — sync flips it to IN_PROGRESS once the
      // cloud lease materializes (single source of truth = execution plane)
      return Response.json({ ok: true, action, milestone: key, taskId: r.taskId, state: r.state, duplicate: r.duplicate, enqueueKey: r.enqueueKey, plane: "cloud" });
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
      for (const row of res.rows as MilestoneRow[]) {
        const r = await enqueueCloud(row);
        if (r.accepted) dispatched.push({ key: row.milestone_key, taskId: r.taskId });
        else failed.push({ key: row.milestone_key, error: r.error ?? "enqueue_rejected" });
      }
      return Response.json({ ok: failed.length === 0, action, phase, dispatchedCount: dispatched.length, dispatched, failed, plane: "cloud" });
    }

    if (action === "sync") {
      const { changed } = await syncMilestones();
      return Response.json({ ok: true, action, changedCount: changed.length, changed, plane: "cloud" });
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
