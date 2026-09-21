import { query } from "@/lib/pg";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [milestones, releases] = await Promise.all([
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
    ]);

    const byStatus: Record<string, number> = {};
    for (const m of milestones.rows) {
      const s = String(m.status ?? "UNKNOWN");
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }

    return Response.json({
      ok: true,
      milestones: milestones.rows.map((r) => ({
        key: String(r.milestone_key),
        status: String(r.status ?? "UNKNOWN"),
        phase: r.phase_order === null ? null : Number(r.phase_order),
        priority: r.priority === null ? null : String(r.priority),
        updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : null,
      })),
      statusSummary: byStatus,
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
