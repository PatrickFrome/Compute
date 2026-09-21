import { cloudConfigured, cloudLatestState } from "@/lib/cloud";

export const dynamic = "force-dynamic";

/**
 * GET /api/live — live browser supervisor snapshot (cloud plane).
 * Read-only: latest state row → normalized heartbeat / self-update / fleet / tabs.
 */
export async function GET() {
  if (!cloudConfigured()) {
    return Response.json({ ok: false, configured: false, error: "cloud creds unavailable" }, { status: 503 });
  }
  try {
    const row = await cloudLatestState();
    if (!row) {
      return Response.json({ ok: true, configured: true, live: null, at: new Date().toISOString() });
    }
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

    return Response.json({
      ok: true,
      configured: true,
      live: {
        clientId: row.client_id,
        lastSeenAt: row.last_seen_at,
        heartbeatMs,
        shellVersion: s.shell_version ? String(s.shell_version) : null,
        armed: s.armed === true,
        supervisorMode: s.supervisor_mode ? String(s.supervisor_mode) : null,
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
      },
      at: new Date().toISOString(),
    });
  } catch (e) {
    return Response.json(
      { ok: false, configured: true, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
