/**
 * Plane-aware DevOS fleet access — cloud first (if configured), local Pigsty
 * replica as the surviving contour (2026-09-21 pivot: the cloud Supabase
 * project was deleted; the operator's backup was restored into the rootless
 * PG17 cluster with the SAME table/RPC surface, so the console can keep
 * dispatching against `devos_fleet_enqueue_v1` locally).
 *
 * Every function returns which plane actually served the call so the UI can
 * badge the execution plane truthfully.
 */
import { query } from "@/lib/pg";
import {
  cloudConfigured,
  cloudFleetSnapshot,
  cloudRpc,
  CLOUD_FLEET_WORKSPACE,
  type CloudFleetSnapshot,
} from "@/lib/cloud";

export type FleetPlane = "cloud" | "local-pigsty";

async function localFleetSnapshot(workspace: string): Promise<CloudFleetSnapshot> {
  const res = await query(`select public.devos_fleet_snapshot_v1($1::uuid) as snap`, [workspace]);
  return (res.rows[0]?.snap ?? {}) as CloudFleetSnapshot;
}

/** Fleet snapshot: active tasks/claims + recent events (cloud → local fallback). */
export async function fleetSnapshot(
  workspace: string = CLOUD_FLEET_WORKSPACE,
): Promise<{ plane: FleetPlane; snap: CloudFleetSnapshot }> {
  if (cloudConfigured()) {
    try {
      return { plane: "cloud", snap: await cloudFleetSnapshot(workspace) };
    } catch {
      // cloud unreachable/dead → local plane
    }
  }
  return { plane: "local-pigsty", snap: await localFleetSnapshot(workspace) };
}

export interface FleetEnqueueArgs {
  workspace?: string;
  point: string;
  role: string;
  base: string;
  spec: Record<string, unknown>;
  key: string;
  priority: number;
}

async function localEnqueue(args: FleetEnqueueArgs): Promise<Record<string, unknown>> {
  const res = await query(
    `select public.devos_fleet_enqueue_v1($1::uuid, $2, $3, $4, $5::jsonb, $6, null, $7) as task`,
    [
      args.workspace ?? CLOUD_FLEET_WORKSPACE,
      args.point,
      args.role,
      args.base,
      JSON.stringify(args.spec),
      args.key,
      args.priority,
    ],
  );
  return (res.rows[0]?.task ?? {}) as Record<string, unknown>;
}

/**
 * Canonical admission into the DevOS execution plane (cloud → local fallback).
 * Same admission contract on both planes: idempotency via p_key, zero raw
 * secrets in spec, generation fence handled inside the RPC.
 */
export async function fleetEnqueue(
  args: FleetEnqueueArgs,
): Promise<{ plane: FleetPlane; result: Record<string, unknown> }> {
  if (cloudConfigured()) {
    try {
      const result = await cloudRpc<Record<string, unknown>>("devos_fleet_enqueue_v1", {
        p_workspace: args.workspace ?? CLOUD_FLEET_WORKSPACE,
        p_point: args.point,
        p_role: args.role,
        p_base: args.base,
        p_spec: args.spec,
        p_key: args.key,
        p_priority: args.priority,
      });
      return { plane: "cloud", result };
    } catch {
      // cloud unreachable/dead → local plane
    }
  }
  return { plane: "local-pigsty", result: await localEnqueue(args) };
}
