import { query } from "@/lib/pg";
import { cloudConfigured, cloudFleetSnapshot, type CloudFleetSnapshot } from "@/lib/cloud";

export const dynamic = "force-dynamic";

/**
 * GET /api/roadmap — canonical roadmap + execution plane task states.
 *
 * Milestone statuses live in the console-local roadmap store; the LINKED
 * fleet task states come from the CLOUD execution plane when reachable
 * (the plane the live browser leases from) and degrade to the local
 * rehearsal plane otherwise.
 */
export async function GET() {
  try {
    const [milestones, releases, fleetTasks] = await Promise.all([
      query(
        `select roadmap_id, milestone_key, status, phase_order, priority, updated_at,
                verified_checkpoint_id
         from destruktion_meta.compute_fabric_roadmap_milestone_h205f22
         order by phase_order nulls last, milestone_key`,
      ),
      query(
        `select roadmap_key, version, title, source_git_commit, sealed, is_active, created_at
         from destruktion_meta.compute_fabric_canonical_roadmap_release_h205f22
         order by created_at desc limit 10`,
      ),
      query(
        `select task_id, point_id, role, state, priority, created_at, updated_at, finished_at,
                left(coalesce(task_spec->>'objective',''), 160) as objective
         from destruktion_meta.devos_fleet_task_h205f22
         where point_id like 'roadmap.%'
         order by created_at desc
         limit 200`,
      ).catch(() => ({ rows: [], rowCount: 0 })),
    ]);

    interface MilestoneTask {
      taskId: string;
      milestoneKey: string;
      role: string;
      state: string;
      priority: number | null;
      createdAt: string | null;
      updatedAt: string | null;
      finishedAt: string | null;
      objective: string | null;
      plane: "cloud" | "local";
    }

    const tasks: MilestoneTask[] = [];
    let plane: "cloud" | "local" = "local";
    let cloudError: string | null = null;

    // Preferred: cloud execution plane (browser leases HERE).
    if (cloudConfigured()) {
      try {
        const snap: CloudFleetSnapshot = await cloudFleetSnapshot();
        plane = "cloud";
        for (const t of snap.active_tasks ?? []) {
          const point = String(t.point_id ?? "");
          if (!point.toLowerCase().startsWith("roadmap.")) continue;
          tasks.push({
            taskId: String(t.task_id ?? ""),
            milestoneKey: point.slice("roadmap.".length),
            role: String(t.role ?? "").toUpperCase(),
            state: String(t.state ?? "?").toUpperCase(),
            priority: Number.isFinite(Number(t.priority)) ? Number(t.priority) : null,
            createdAt: t.created_at ? new Date(String(t.created_at)).toISOString() : null,
            updatedAt: t.updated_at ? new Date(String(t.updated_at)).toISOString() : null,
            finishedAt: t.finished_at ? new Date(String(t.finished_at)).toISOString() : null,
            objective: null,
            plane: "cloud",
          });
        }
        for (const e of snap.recent_events ?? []) {
          const type = String(e.event_type ?? "");
          const terminal = type.startsWith("TASK_RESULT_")
            ? type.slice("TASK_RESULT_".length)
            : type === "TASK_LEASE_EXPIRED_AMBIGUOUS"
              ? "AMBIGUOUS"
              : null;
          const point = String(e.point_id ?? "");
          if (!terminal || !point.toLowerCase().startsWith("roadmap.")) continue;
          tasks.push({
            taskId: String(e.task_id ?? ""),
            milestoneKey: point.slice("roadmap.".length),
            role: String(e.role ?? "").toUpperCase(),
            state: terminal.toUpperCase(),
            priority: null,
            createdAt: e.created_at ? new Date(String(e.created_at)).toISOString() : null,
            updatedAt: e.created_at ? new Date(String(e.created_at)).toISOString() : null,
            finishedAt: e.created_at ? new Date(String(e.created_at)).toISOString() : null,
            objective: null,
            plane: "cloud",
          });
        }
      } catch (e) {
        cloudError = e instanceof Error ? e.message : String(e);
      }
    }

    // Fallback/degraded: local rehearsal plane rows.
    if (plane === "local") {
      for (const r of fleetTasks.rows) {
        tasks.push({
          taskId: String(r.task_id ?? ""),
          milestoneKey: String(r.point_id ?? "").replace(/^roadmap\./i, ""),
          role: String(r.role ?? "").toUpperCase(),
          state: String(r.state ?? "?").toUpperCase(),
          priority: r.priority === null ? null : Number(r.priority),
          createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
          updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : null,
          finishedAt: r.finished_at ? new Date(String(r.finished_at)).toISOString() : null,
          objective: r.objective ? String(r.objective) : null,
          plane: "local",
        });
      }
    }

    // latest task per milestone (case-insensitive: cloud lowercases point_id)
    const latestByMilestone = new Map<string, MilestoneTask>();
    for (const t of tasks) {
      const k = t.milestoneKey.toLowerCase();
      if (!latestByMilestone.has(k)) latestByMilestone.set(k, t);
    }

    const byStatus: Record<string, number> = {};
    for (const m of milestones.rows) {
      const s = String(m.status ?? "UNKNOWN");
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }

    return Response.json({
      ok: true,
      plane,
      cloudError,
      milestones: milestones.rows.map((r) => {
        const key = String(r.milestone_key);
        const t = latestByMilestone.get(key.toLowerCase()) ?? null;
        return {
          key,
          status: String(r.status ?? "UNKNOWN"),
          phase: r.phase_order === null ? null : Number(r.phase_order),
          priority: r.priority === null ? null : String(r.priority),
          updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : null,
          verifiedCheckpointId: r.verified_checkpoint_id ? String(r.verified_checkpoint_id) : null,
          task: t
            ? {
                taskId: t.taskId,
                role: t.role,
                state: t.state,
                priority: t.priority,
                updatedAt: t.updatedAt,
                finishedAt: t.finishedAt,
                plane: t.plane,
              }
            : null,
        };
      }),
      statusSummary: byStatus,
      tasks,
      releases: releases.rows.map((r) => ({
        roadmapKey: String(r.roadmap_key ?? ""),
        version: r.version === null ? null : String(r.version),
        title: r.title === null ? null : String(r.title),
        commit: r.source_git_commit === null ? null : String(r.source_git_commit),
        sealed: r.sealed === true,
        isActive: r.is_active === true,
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
      })),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
