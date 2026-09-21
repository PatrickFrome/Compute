import { query, T } from "@/lib/pg";
import { edgeHealth } from "@/lib/edge";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [dbInfo, counts, lanes, statuses, extensions, edge] = await Promise.all([
      query(`select version() as v, pg_postmaster_start_time() as start_time,
             (select count(*) from pg_stat_activity) as connections,
             current_database() as db, inet_server_port() as port`),
      query(`
        select
          (select count(*) from ${T.command}) as commands,
          (select count(*) from ${T.enrollment}) as enrollments,
          (select count(*) from public.compute_fabric_a2_browser_device_h205f22) as devices,
          (select count(*) from ${T.fleetTask}) as fleet_tasks,
          (select count(*) from ${T.fleetEvent}) as fleet_events,
          (select count(*) from ${T.actuationLease}) as actuation_leases,
          (select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')) as tables,
          (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema')) as functions,
          (select count(*) from pg_extension) as extensions
      `),
      query(`select coalesce(command_lane,'—') as lane, count(*) as n from ${T.command} group by 1 order by 2 desc`),
      query(`select status, count(*) as n from ${T.command} group by 1 order by 2 desc`),
      query(`select extname, extversion from pg_extension order by extname`),
      edgeHealth(),
    ]);

    const db = dbInfo.rows[0] ?? {};
    const c = counts.rows[0] ?? {};
    const uptimeMs = db.start_time ? Date.now() - new Date(String(db.start_time)).getTime() : 0;

    return Response.json({
      ok: true,
      db: {
        version: String(db.v ?? "").split(" ").slice(0, 2).join(" "),
        connections: Number(db.connections ?? 0),
        port: Number(db.port ?? 0),
        uptimeMs,
        tables: Number(c.tables ?? 0),
        functions: Number(c.functions ?? 0),
        extensions: extensions.rows,
      },
      counts: {
        commands: Number(c.commands ?? 0),
        enrollments: Number(c.enrollments ?? 0),
        devices: Number(c.devices ?? 0),
        fleetTasks: Number(c.fleet_tasks ?? 0),
        fleetEvents: Number(c.fleet_events ?? 0),
        actuationLeases: Number(c.actuation_leases ?? 0),
      },
      lanes: lanes.rows.map((r) => ({ lane: String(r.lane), n: Number(r.n) })),
      statuses: statuses.rows.map((r) => ({ status: String(r.status), n: Number(r.n) })),
      edge: edge.ok
        ? { ok: true, ms: edge.ms, health: edge.data }
        : { ok: false, ms: edge.ms, error: edge.error ?? "unreachable" },
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
