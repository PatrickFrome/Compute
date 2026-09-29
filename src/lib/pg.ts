import { Pool } from "pg";

/**
 * METAENGINE local Pigsty (rootless PostgreSQL 17) connection.
 * Canonical credentials from infra/pigstry bootstrap (postgres/postgres).
 */
const globalForPg = globalThis as unknown as { __metaenginePgPool?: Pool };

export const pgPool: Pool =
  globalForPg.__metaenginePgPool ??
  new Pool({
    host: "127.0.0.1",
    port: 55432,
    user: "postgres",
    password: "postgres",
    database: "postgres",
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.__metaenginePgPool = pgPool;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export async function query(text: string, params?: unknown[]): Promise<QueryResult> {
  const res = await pgPool.query(text, params as never[]);
  return { rows: res.rows as Record<string, unknown>[], rowCount: res.rowCount ?? 0 };
}

/** Canonical table names (cloud-era naming, h205f22 = compute fabric hash). */
export const T = {
  command: "public.compute_fabric_a2_browser_supervisor_command_h205f22",
  enrollment: "public.compute_fabric_a2_browser_device_enrollment_request_h205f22",
  actuationLease: "public.compute_fabric_a2_supervisor_actuation_lease_h205f22",
  chatCommand: "public.compute_fabric_a2_chat_bridge_remote_command_h205f22",
  fleetTask: "destruktion_meta.devos_fleet_task_h205f22",
  fleetClaim: "destruktion_meta.devos_fleet_claim_h205f22",
  fleetEvent: "destruktion_meta.devos_fleet_event_h205f22",
  chatReceipt: "destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22",
  roadmapRelease: "destruktion_meta.compute_fabric_canonical_roadmap_release_h205f22",
} as const;
