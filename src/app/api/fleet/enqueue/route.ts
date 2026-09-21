import { query } from "@/lib/pg";

export const dynamic = "force-dynamic";

const POINT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,119}$/;
const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SHA_RE = /^[0-9a-f]{7,64}$/;

/**
 * R3 closure (operator-side): enqueue a DevOS fleet task through the CANONICAL
 * RPC path (public.devos_fleet_enqueue_v1) — the same admission path the
 * browser meta-orchestrator uses. Admission fence (runtime control) decides
 * READY vs QUEUED; idempotency key prevents duplicate tasks.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const point = String(body.point ?? "").trim();
    const role = String(body.role ?? "").trim().toUpperCase();
    const claimClass = String(body.claimClass ?? "TASK").trim().toUpperCase() || "TASK";
    const priority = Number.isFinite(Number(body.priority)) ? Math.min(99, Math.max(1, Math.trunc(Number(body.priority)))) : 50;
    const baseSha = String(body.baseSha ?? "6bf173c7").trim().toLowerCase();
    const branch = String(body.branch ?? "").trim();
    const enqueueKey = String(body.enqueueKey ?? "").trim() || `mc-${crypto.randomUUID()}`;
    const objective = String(body.objective ?? "").trim().slice(0, 400);

    if (!POINT_RE.test(point)) {
      return Response.json({ ok: false, error: "point_invalid (3-120 chars: letters, digits, . _ : / -)" }, { status: 400 });
    }
    if (!ROLE_RE.test(role)) {
      return Response.json({ ok: false, error: "role_invalid (^[A-Z][A-Z0-9_]{1,63}$)" }, { status: 400 });
    }
    if (!SHA_RE.test(baseSha)) {
      return Response.json({ ok: false, error: "base_sha_invalid" }, { status: 400 });
    }

    const spec: Record<string, unknown> = {
      claim_class: claimClass,
      enqueue_key: enqueueKey,
      objective: objective || `Operator task ${point}`,
      source: "MISSION_CONTROL_CONSOLE",
    };

    const res = await query(
      `select public.devos_fleet_enqueue_v1($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8) as result`,
      [
        "2de9f84b-7c0a-4091-911c-894ff1d6eaf4",
        point,
        role,
        baseSha,
        JSON.stringify(spec),
        enqueueKey,
        branch || null,
        priority,
      ],
    );
    const result = (res.rows[0]?.result ?? {}) as Record<string, unknown>;

    // canonical readback: task row after admission
    let task: Record<string, unknown> | null = null;
    if (result.task_id) {
      const t = await query(
        `select task_id, point_id, role, state, priority, claim_class, base_sha,
                idempotency_key, created_at
         from destruktion_meta.devos_fleet_task_h205f22 where task_id = $1`,
        [result.task_id],
      );
      task = t.rows[0] ?? null;
    }

    return Response.json({ ok: result.accepted === true, result, task });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
