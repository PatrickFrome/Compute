import { query } from "@/lib/pg";

export const dynamic = "force-dynamic";

/**
 * Milestone Runner — Roadmap → Fleet execution bridge (R3 closure, operator side).
 *
 * The canonical roadmap holds 28 PLANNED milestones but nothing linked them to
 * the DevOS fleet task queue — an empty execution loop with an idle fleet.
 * This route turns roadmap milestones into first-class fleet tasks through the
 * SAME canonical admission path the browser orchestrator uses
 * (public.devos_fleet_enqueue_v1 → admission fence → READY/QUEUED), and syncs
 * fleet task outcomes back onto milestone statuses:
 *
 *   dispatch        milestone PLANNED → fleet task (point_id = 'roadmap.<key>')
 *                   idempotent via enqueue_key 'mc-milestone:<key>'
 *   dispatch-phase  bulk dispatch every PLANNED milestone of a phase
 *   sync            task state → milestone status transition
 *                   (in-flight → IN_PROGRESS, COMPLETED/RESULT_READY → DONE,
 *                    FAILED/BLOCKED/AMBIGUOUS → BLOCKED)
 *   set-status      manual operator override
 */

const WORKSPACE_ID = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4";
const BASE_SHA_DEFAULT = "db5c83db"; // rail head at Milestone Runner introduction
const MILESTONE_TABLE = "destruktion_meta.compute_fabric_roadmap_milestone_h205f22";
const FLEET_TASK_TABLE = "destruktion_meta.devos_fleet_task_h205f22";
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

async function enqueueMilestone(m: MilestoneRow, priorityOverride?: number): Promise<{
  accepted: boolean;
  taskId: string | null;
  state: string | null;
  duplicate: boolean;
  generation: number;
  error?: string;
}> {
  const point = `${POINT_PREFIX}${m.milestone_key}`;
  // generation-based idempotency: the first dispatch uses the bare key; a
  // re-dispatch after the previous task reached a terminal state bumps the
  // generation so the admission fence treats it as a fresh task.
  const prior = await query(
    `select count(*)::int as n from ${FLEET_TASK_TABLE} where point_id = $1`,
    [point],
  );
  const priorCount = Number((prior.rows[0] as { n?: number } | undefined)?.n ?? 0);
  const enqueueKey = priorCount === 0 ? `mc-milestone:${m.milestone_key}` : `mc-milestone:${m.milestone_key}:${priorCount + 1}`;
  const role = deriveRole(m.milestone_key);
  const priority = priorityOverride ?? Math.min(99, Math.max(1, m.priority || 50));
  const spec = {
    claim_class: "TASK",
    enqueue_key: enqueueKey,
    objective: `Execute roadmap milestone ${m.milestone_key} (phase ${m.phase_order}) — deliver artifact + checkpoint evidence`,
    source: "MISSION_CONTROL_ROADMAP_RUNNER",
    milestone_key: m.milestone_key,
    roadmap_id: m.roadmap_id,
  };
  try {
    const res = await query(
      `select public.devos_fleet_enqueue_v1($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8) as result`,
      [WORKSPACE_ID, point, role, BASE_SHA_DEFAULT, JSON.stringify(spec), enqueueKey, null, priority],
    );
    const result = (res.rows[0]?.result ?? {}) as Record<string, unknown>;
    return {
      accepted: result.accepted === true,
      taskId: result.task_id ? String(result.task_id) : null,
      state: result.state ? String(result.state) : null,
      duplicate: result.duplicate === true || result.already_exists === true,
      generation: priorCount + 1,
    };
  } catch (e) {
    return { accepted: false, taskId: null, state: null, duplicate: false, generation: priorCount + 1, error: e instanceof Error ? e.message : String(e) };
  }
}

async function syncMilestones(): Promise<{ changed: { key: string; from: string; to: string; taskId: string | null }[] }> {
  const [milestonesRes, tasksRes] = await Promise.all([
    query(`select milestone_key, status from ${MILESTONE_TABLE}`),
    query(
      `select task_id, point_id, state, created_at
       from ${FLEET_TASK_TABLE}
       where point_id like $1
       order by created_at asc`,
      [`${POINT_PREFIX}%`],
    ),
  ]);

  // latest task per milestone
  const latest = new Map<string, { taskId: string; state: string }>();
  for (const r of tasksRes.rows) {
    const key = String(r.point_id ?? "").replace(/^roadmap\./, "");
    latest.set(key, { taskId: String(r.task_id ?? ""), state: String(r.state ?? "?") });
  }

  const changed: { key: string; from: string; to: string; taskId: string | null }[] = [];
  for (const m of milestonesRes.rows) {
    const key = String(m.milestone_key);
    const from = String(m.status ?? "PLANNED");
    const t = latest.get(key);
    if (!t) continue;

    let to: string | null = null;
    let checkpoint: string | null = null;
    if (TASK_SUCCESS.has(t.state) && from !== "DONE" && from !== "BLOCKED") {
      to = "DONE";
      checkpoint = t.taskId;
    } else if (TASK_FAILURE.has(t.state) && from !== "DONE") {
      to = "BLOCKED";
    } else if (TASK_INFLIGHT.has(t.state) && from === "PLANNED") {
      to = "IN_PROGRESS";
    }
    if (!to || to === from) continue;

    await query(
      `update ${MILESTONE_TABLE}
       set status = $2, verified_checkpoint_id = coalesce($3, verified_checkpoint_id), updated_at = clock_timestamp()
       where milestone_key = $1`,
      [key, to, checkpoint],
    );
    changed.push({ key, from, to, taskId: t.taskId });
  }
  return { changed };
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
      if (m.status === "DONE") {
        return Response.json({ ok: false, error: "milestone_done", detail: "set status back to PLANNED to re-dispatch" }, { status: 409 });
      }
      const r = await enqueueMilestone(m);
      if (!r.accepted) {
        return Response.json({ ok: false, error: r.error ?? "enqueue_rejected", result: r }, { status: 502 });
      }
      // milestone left PLANNED here on purpose — sync flips it to IN_PROGRESS
      // once the admission fence materializes the task (single source of truth)
      return Response.json({ ok: true, action, milestone: key, generation: r.generation, taskId: r.taskId, state: r.state, duplicate: r.duplicate });
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
      const dispatched: { key: string; taskId: string | null; state: string | null }[] = [];
      const failed: { key: string; error: string }[] = [];
      for (const row of res.rows as MilestoneRow[]) {
        const r = await enqueueMilestone(row);
        if (r.accepted) dispatched.push({ key: row.milestone_key, taskId: r.taskId, state: r.state });
        else failed.push({ key: row.milestone_key, error: r.error ?? "enqueue_rejected" });
      }
      return Response.json({ ok: failed.length === 0, action, phase, dispatchedCount: dispatched.length, dispatched, failed });
    }

    if (action === "sync") {
      const { changed } = await syncMilestones();
      return Response.json({ ok: true, action, changedCount: changed.length, changed });
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
