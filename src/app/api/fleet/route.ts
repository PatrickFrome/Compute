import { query, T } from "@/lib/pg";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [tasks, claims, events, counts] = await Promise.all([
      query(
        `select task_id, point_id, role, state, priority, claim_class, base_sha,
                lease_generation, lease_agent_id, error_code, idempotency_key,
                created_at, updated_at, finished_at,
                left(coalesce(task_spec->>'objective',''), 120) as objective
         from ${T.fleetTask} order by created_at desc limit 50`,
      ).catch(() => ({ rows: [], rowCount: 0 })),
      query(
        `select claim_id, task_id, agent_id, role, state, lease_generation,
                tab_id, target_id, expires_at, created_at, updated_at
         from ${T.fleetClaim} order by claim_id desc limit 30`,
      ).catch(() => ({ rows: [], rowCount: 0 })),
      query(
        `select event_id, task_id, event_type, lease_generation,
                left(coalesce(payload::text,''), 160) as payload_preview, created_at
         from ${T.fleetEvent} order by event_id desc limit 40`,
      ).catch(() => ({ rows: [], rowCount: 0 })),
      query(
        `select
           count(*) filter (where state = 'QUEUED') as queued,
           count(*) filter (where state = 'READY') as ready,
           count(*) filter (where state in ('LEASED','RUNNING')) as inflight,
           count(*) filter (where state in ('COMPLETED','RESULT_READY')) as completed,
           count(*) filter (where state in ('FAILED','BLOCKED','AMBIGUOUS')) as failed
         from ${T.fleetTask}`,
      ).catch(() => ({ rows: [{ queued: 0, ready: 0, inflight: 0, completed: 0, failed: 0 }], rowCount: 1 })),
    ]);

    const c = (counts.rows[0] ?? {}) as Record<string, unknown>;
    return Response.json({
      ok: true,
      tasks: tasks.rows.map((r) => ({
        ...r,
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
        updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : null,
        finishedAt: r.finished_at ? new Date(String(r.finished_at)).toISOString() : null,
      })),
      claims: claims.rows.map((r) => ({
        claimId: String(r.claim_id ?? ""),
        taskId: r.task_id ? String(r.task_id) : null,
        agentId: r.agent_id ? String(r.agent_id) : null,
        role: r.role ? String(r.role) : null,
        state: r.state ? String(r.state) : null,
        leaseGeneration: r.lease_generation ?? null,
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
      })),
      events: events.rows.map((r) => ({
        eventId: String(r.event_id ?? ""),
        taskId: r.task_id ? String(r.task_id) : null,
        kind: r.event_type ? String(r.event_type) : null,
        leaseGeneration: r.lease_generation ?? null,
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
        payloadPreview: r.payload_preview ? String(r.payload_preview) : null,
      })),
      counts: {
        tasks: tasks.rowCount,
        claims: claims.rowCount,
        events: events.rowCount,
        queued: Number(c.queued ?? 0),
        ready: Number(c.ready ?? 0),
        inflight: Number(c.inflight ?? 0),
        completed: Number(c.completed ?? 0),
        failed: Number(c.failed ?? 0),
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
