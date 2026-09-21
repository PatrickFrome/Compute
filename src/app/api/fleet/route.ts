import { query, T } from "@/lib/pg";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [tasks, claims, events] = await Promise.all([
      query(
        `select task_id, role, status, priority, progress_revision, error_code,
                created_at, updated_at, finished_at, lease_generation,
                left(coalesce(task_spec::text,''), 120) as spec_preview
         from ${T.fleetTask} order by coalesce(updated_at, created_at) desc limit 50`,
      ).catch(() => ({ rows: [], rowCount: 0 })),
      query(
        `select * from ${T.fleetClaim} order by 1 desc limit 30`,
      ).catch(() => ({ rows: [], rowCount: 0 })),
      query(
        `select event_id, task_id, event_kind, created_at,
                left(coalesce(payload::text,''), 140) as payload_preview
         from ${T.fleetEvent} order by created_at desc limit 40`,
      ).catch(() => ({ rows: [], rowCount: 0 })),
    ]);

    return Response.json({
      ok: true,
      tasks: tasks.rows,
      claims: claims.rows.slice(0, 20).map((r) => ({
        claimId: String(r.claim_id ?? r.id ?? ""),
        taskId: r.task_id ? String(r.task_id) : null,
        claimedBy: r.claimed_by ? String(r.claimed_by) : null,
        status: r.status ? String(r.status) : null,
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
      })),
      events: events.rows.map((r) => ({
        eventId: String(r.event_id ?? ""),
        taskId: r.task_id ? String(r.task_id) : null,
        kind: r.event_kind ? String(r.event_kind) : null,
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
        payloadPreview: r.payload_preview ? String(r.payload_preview) : null,
      })),
      counts: { tasks: tasks.rowCount, claims: claims.rowCount, events: events.rowCount },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
