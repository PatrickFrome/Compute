import { query, T } from "@/lib/pg";

export const dynamic = "force-dynamic";

const TERMINAL = ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lane = url.searchParams.get("lane");
    const status = url.searchParams.get("status");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 40), 1), 200);
    const includeTerminal = url.searchParams.get("active") === "1";

    const where: string[] = [];
    const params: unknown[] = [];
    if (lane && lane !== "ALL") {
      params.push(lane);
      where.push(`command_lane = $${params.length}`);
    }
    if (status && status !== "ALL") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (includeTerminal) {
      where.push(`status not in ('${TERMINAL.join("','")}')`);
    }
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    const [rows, laneDist, statusDist] = await Promise.all([
      query(
        `select command_id, workspace_id, target_client_id, issued_by, action, status,
                command_lane, authority_effect, issued_at, leased_at, completed_at,
                leased_by, error,
                left(effect_key, 24) as effect_key,
                case when receipt is null then null else receipt->>'ok' end as receipt_ok,
                receipt->>'schema' as receipt_schema
         from ${T.command} ${whereSql}
         order by issued_at desc limit ${limit}`,
        params,
      ),
      query(`select coalesce(command_lane,'—') as lane, count(*) as n,
                    count(*) filter (where status = 'PENDING') as pending
             from ${T.command} group by 1 order by 2 desc`),
      query(`select status, count(*) as n from ${T.command} group by 1 order by 2 desc`),
    ]);

    return Response.json({
      ok: true,
      commands: rows.rows.map(normalize),
      laneDist: laneDist.rows,
      statusDist: statusDist.rows,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function normalize(r: Record<string, unknown>) {
  return {
    commandId: String(r.command_id ?? ""),
    target: r.target_client_id ? String(r.target_client_id) : null,
    issuedBy: r.issued_by ? String(r.issued_by) : null,
    action: String(r.action ?? ""),
    status: String(r.status ?? ""),
    lane: r.command_lane ? String(r.command_lane) : null,
    authorityEffect: r.authority_effect === true,
    issuedAt: r.issued_at ? new Date(String(r.issued_at)).toISOString() : null,
    completedAt: r.completed_at ? new Date(String(r.completed_at)).toISOString() : null,
    receiptOk: r.receipt_ok === null ? null : r.receipt_ok === true || r.receipt_ok === "true",
    receiptSchema: r.receipt_schema ? String(r.receipt_schema) : null,
    error: r.error ? String(r.error) : null,
  };
}
