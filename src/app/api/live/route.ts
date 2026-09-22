import { cloudConfigured, cloudLatestState } from "@/lib/cloud";
import { getLiveSnapshot, setLiveSnapshot } from "@/lib/live-cache";
import { query } from "@/lib/pg";

export const dynamic = "force-dynamic";

/**
 * GET /api/live — live browser supervisor snapshot (plane-resilient).
 *
 * Plane chain (2026-09-21 pivot: cloud Supabase project was DELETED, local
 * Pigsty replica is the surviving contour):
 *   1. cloud (if creds configured) — canonical historical plane;
 *   2. local Pigsty `public.compute_fabric_a2_browser_supervisor_state_h205f22`
 *      — same table/RPC surface restored from the operator's backup;
 *   3. last-known-good in-memory snapshot (stale:true) — never blank out a
 *      console that was healthy a minute ago.
 */

interface StateRow {
  client_id: string;
  state: Record<string, unknown> | null;
  last_seen_at: string;
}

async function latestLocalStateRow(): Promise<StateRow | null> {
  const res = await query(
    `select client_id, state, last_seen_at
       from public.compute_fabric_a2_browser_supervisor_state_h205f22
      order by last_seen_at desc limit 1`,
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    client_id: String(r.client_id ?? "unknown"),
    state: (r.state ?? null) as Record<string, unknown> | null,
    last_seen_at: new Date(r.last_seen_at as string).toISOString(),
  };
}

function buildPayload(
  row: StateRow,
  plane: "cloud" | "local-pigsty",
  extra: Record<string, unknown> = {},
) {
  const s = (row.state ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const heartbeatMs = Math.max(0, now - new Date(row.last_seen_at).getTime());

  const su = (s.self_update ?? {}) as Record<string, unknown>;
  const sr = (su.startup_recovery ?? null) as Record<string, unknown> | null;
  const fleet = (s.fleet ?? {}) as Record<string, unknown>;
  const policy = (fleet.policy ?? {}) as Record<string, unknown>;
  const agentsRaw = (fleet.agents ?? []) as Record<string, unknown>[];

  const byLifecycle: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  const agents = agentsRaw.map((a) => {
    const lc = String(a.lifecycle_state ?? "?");
    const role = String(a.role ?? "?");
    byLifecycle[lc] = (byLifecycle[lc] ?? 0) + 1;
    byRole[role] = (byRole[role] ?? 0) + 1;
    const proof = (a.transport_proof ?? null) as Record<string, unknown> | null;
    return {
      agentId: String(a.agent_id ?? ""),
      role,
      lifecycleState: lc,
      tabId: a.tab_id ? String(a.tab_id) : null,
      ownership: a.ownership ? String(a.ownership) : null,
      createdAt: a.created_at ? String(a.created_at) : null,
      updatedAt: a.updated_at ? String(a.updated_at) : null,
      provenAt: proof?.proven_at ? String(proof.proven_at) : null,
      lostReason: a.lost_reason ? String(a.lost_reason) : null,
    };
  });
  agents.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  const tabsRaw = (s.tabs ?? []) as Record<string, unknown>[];
  const byKind: Record<string, number> = {};
  for (const t of tabsRaw) {
    const k = String(t.kind ?? "?");
    byKind[k] = (byKind[k] ?? 0) + 1;
  }

  // DevOS runtime diagnostics (supervisor_lifecycle.devos_runtime) —
  // surfaces the browser-side dispatch/cycle error for the last idle kick.
  const sl = (s.supervisor_lifecycle ?? {}) as Record<string, unknown>;
  const dr = (sl.devos_runtime ?? {}) as Record<string, unknown>;
  const drIdle = (dr.idle ?? {}) as Record<string, unknown>;
  const drAdmission = (dr.admission ?? {}) as Record<string, unknown>;
  const drToolbelt = (dr.agent_toolbelt ?? {}) as Record<string, unknown>;
  // Root-surface dispatch-effect telemetry (browser 2026-09-21 release):
  // last lease→effect bootstrap/dispatch outcome + bounded counters. Lets
  // the console show WHY a leased task is (not) producing conversations.
  const drDispatch = (dr.dispatch ?? {}) as Record<string, unknown>;
  // CP-W1 (2026-09-21 live incident): heartbeat liveness is NOT control-plane
  // liveness — a wedged cycle keeps the 2s watchdog heartbeat alive while the
  // command lease / maintenance / self-update stay dead for hours. The browser
  // (release with CP-W1) publishes a control_plane projection in its state;
  // the console derives a pump-health verdict from it (null = legacy shell).
  const cp = (s.control_plane ?? null) as Record<string, unknown> | null;
  const intOrNull = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
  const isoOrNull = (v: unknown) => (v ? String(v) : null);

  let controlPlane: {
    schema: string;
    batchTransport: string | null;
    leaseLastAttemptAt: string | null;
    leaseLastOkAt: string | null;
    leaseConsecutiveFailures: number | null;
    leaseLastError: string | null;
    cycleRunning: boolean | null;
    cycleAgeMs: number | null;
    schedulerWatchdogRearmCount: number | null;
    wedgeEscalation: { reason: string; at: string | null } | null;
    /** "ok" | "stalled" | "failing" | null (null = pre-CP-W1 shell, unknown) */
    pumpHealth: "ok" | "stalled" | "failing" | null;
    pumpNote: string | null;
  } | null = null;
  if (cp && typeof cp === "object") {
    const leaseOkAt = isoOrNull(cp.lease_last_ok_at);
    const leaseOkAgeMs = leaseOkAt ? Math.max(0, now - new Date(leaseOkAt).getTime()) : null;
    const wedge = (cp.wedge_escalation ?? null) as Record<string, unknown> | null;
    const cycleRunning = cp.cycle_running === true;
    const cycleAgeMs = intOrNull(cp.cycle_age_ms);
    let pumpHealth: "ok" | "stalled" | "failing" | null = "ok";
    let pumpNote: string | null = null;
    if (wedge) {
      pumpHealth = "stalled";
      pumpNote = `wedge escalation: ${String(wedge.reason ?? "?")}`;
    } else if (leaseOkAgeMs !== null && leaseOkAgeMs > 90000 && heartbeatMs < 15000) {
      // heartbeat fresh but zero successful lease RPC for 90s+ → the zombie
      // divergence exactly as observed live 2026-09-21 14:42→17:40 UTC
      pumpHealth = "stalled";
      pumpNote = `heartbeat alive (${Math.round(heartbeatMs)}ms) but lease silent ${Math.round(leaseOkAgeMs / 1000)}s — control-plane wedge`;
    } else if (intOrNull(cp.lease_consecutive_failures) !== null && Number(cp.lease_consecutive_failures) >= 3) {
      pumpHealth = "failing";
      pumpNote = `lease failing ×${Number(cp.lease_consecutive_failures)}: ${String(cp.lease_last_error ?? "")}`.slice(0, 200);
    } else if (cycleRunning && cycleAgeMs !== null && cycleAgeMs > 120000) {
      pumpHealth = "stalled";
      pumpNote = `cycle in flight ${Math.round(cycleAgeMs / 1000)}s — past every bounded path`;
    }
    controlPlane = {
      schema: String(cp.schema ?? "metaengine.native-supervisor.control-plane.v1"),
      batchTransport: cp.batch_transport ? String(cp.batch_transport) : null,
      leaseLastAttemptAt: isoOrNull(cp.lease_last_attempt_at),
      leaseLastOkAt: leaseOkAt,
      leaseConsecutiveFailures: intOrNull(cp.lease_consecutive_failures),
      leaseLastError: cp.lease_last_error ? String(cp.lease_last_error) : null,
      cycleRunning,
      cycleAgeMs,
      schedulerWatchdogRearmCount: intOrNull(cp.scheduler_watchdog_rearm_count),
      wedgeEscalation: wedge ? { reason: String(wedge.reason ?? "?"), at: wedge.at ? String(wedge.at) : null } : null,
      pumpHealth,
      pumpNote,
    };
  }

  const payload = {
    ok: true,
    configured: cloudConfigured(),
    stale: false,
    plane,
    ...extra,
    live: {
      clientId: row.client_id,
      lastSeenAt: row.last_seen_at,
      heartbeatMs,
      shellVersion: s.shell_version ? String(s.shell_version) : null,
      armed: s.armed === true,
      supervisorMode: s.supervisor_mode ? String(s.supervisor_mode) : null,
      controlPlane,
      selfUpdate: {
        state: su.state ? String(su.state) : null,
        startupRecovery: sr
          ? {
              state: String(sr.state ?? "?"),
              reason: sr.reason ? String(sr.reason) : null,
              targetGitSha: sr.target_git_sha ? String(sr.target_git_sha) : null,
            }
          : null,
      },
      fleet: {
        bootFleetTarget: Number.isFinite(Number(policy.boot_fleet_target)) ? Number(policy.boot_fleet_target) : null,
        desiredAgents: Number.isFinite(Number(policy.desired_agents)) ? Number(policy.desired_agents) : null,
        profile: policy.profile ? String(policy.profile) : null,
        warmAgents: Number.isFinite(Number(policy.warm_agents)) ? Number(policy.warm_agents) : null,
        elastic: policy.elastic === true,
        liveAgents: agents.length,
        byLifecycle,
        byRole,
        agents,
      },
      tabs: {
        total: tabsRaw.length,
        byKind,
        items: tabsRaw.slice(0, 24).map((t) => ({
          tabId: t.tab_id ? String(t.tab_id) : null,
          kind: t.kind ? String(t.kind) : null,
          title: t.title ? String(t.title) : null,
          url: t.url ? String(t.url) : null,
        })),
      },
      devos: {
        lastError: dr.last_error ? String(dr.last_error) : null,
        idleLastError: drIdle.last_error ? String(drIdle.last_error) : null,
        idleLastAt: drIdle.last_at ? String(drIdle.last_at) : null,
        idleInFlight: drIdle.in_flight === true,
        executionMode: dr.execution_mode ? String(dr.execution_mode) : null,
        admissionState: drAdmission.runtime_control_state ? String(drAdmission.runtime_control_state) : null,
        actuationAllowed: drAdmission.actuation_allowed === true,
        generationFloor: Number.isFinite(Number(drAdmission.generation_floor)) ? Number(drAdmission.generation_floor) : null,
        toolbeltRequests: Number.isFinite(Number(drToolbelt.requests_issued)) ? Number(drToolbelt.requests_issued) : null,
        dispatch: drDispatch.last_state
          ? {
              lastState: String(drDispatch.last_state),
              lastStage: drDispatch.last_stage ? String(drDispatch.last_stage) : null,
              lastEffectState: drDispatch.last_effect_state ? String(drDispatch.last_effect_state) : null,
              lastReason: drDispatch.last_reason ? String(drDispatch.last_reason) : null,
              lastTaskId: drDispatch.last_task_id ? String(drDispatch.last_task_id) : null,
              lastAgentId: drDispatch.last_agent_id ? String(drDispatch.last_agent_id) : null,
              lastAt: drDispatch.last_at ? String(drDispatch.last_at) : null,
              lastComposerChars: intOrNull(drDispatch.last_composer_chars_before),
              dispatches: intOrNull(drDispatch.dispatches),
              proven: intOrNull(drDispatch.proven),
              ambiguous: intOrNull(drDispatch.ambiguous),
              seedAttempts: intOrNull(drDispatch.seed_attempts),
              seedProven: intOrNull(drDispatch.seed_proven),
              flushOverLimit: intOrNull(drDispatch.flush_over_limit),
            }
          : null,
      },
    },
    at: new Date().toISOString(),
  };
  return payload;
}

function staleResponse(error: unknown, status = 200) {
  const cached = getLiveSnapshot();
  if (cached.snapshot && !cached.tooOld) {
    return Response.json({
      ...cached.snapshot,
      stale: true,
      staleMs: cached.staleMs,
      staleAt: cached.fetchedAt,
      error: error instanceof Error ? error.message : String(error),
    }, { status });
  }
  return null;
}

export async function GET() {
  // Plane 1 — cloud (historical canonical plane; project currently DEAD).
  if (cloudConfigured()) {
    try {
      const row = await cloudLatestState();
      if (row) {
        const payload = buildPayload(
          { client_id: row.client_id, state: row.state, last_seen_at: row.last_seen_at },
          "cloud",
        );
        setLiveSnapshot(payload);
        return Response.json(payload);
      }
      // cloud reachable but no rows → fall through to local plane
    } catch (e) {
      const stale = staleResponse(e);
      if (stale) return stale;
      // cloud failed without cache → try local plane before giving up
    }
  }

  // Plane 2 — local Pigsty replica (surviving contour).
  try {
    const row = await latestLocalStateRow();
    if (row) {
      const payload = buildPayload(row, "local-pigsty", {
        planeNote: cloudConfigured()
          ? "cloud unreachable — serving latest local Pigsty state"
          : "cloud unconfigured/dead — serving latest local Pigsty state",
      });
      setLiveSnapshot(payload);
      return Response.json(payload);
    }
    return Response.json({
      ok: true,
      configured: cloudConfigured(),
      plane: "local-pigsty",
      live: null,
      planeStatus: { cloud: cloudConfigured() ? "FAIL" : "UNCONFIGURED", local: "UP" },
      note: "no supervisor state rows on any plane yet",
      at: new Date().toISOString(),
    });
  } catch (e) {
    const stale = staleResponse(e);
    if (stale) return stale;
    return Response.json(
      {
        ok: false,
        configured: cloudConfigured(),
        error: e instanceof Error ? e.message : String(e),
        planeStatus: { cloud: cloudConfigured() ? "FAIL" : "UNCONFIGURED", local: "FAIL" },
      },
      { status: 503 },
    );
  }
}
