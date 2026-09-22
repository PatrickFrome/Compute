import { query } from "@/lib/pg";
import { jsonError } from "@/lib/edge";
import { edgeDevicePost, getProbeDevice, resetProbeDevice } from "@/lib/probe-device";

export const dynamic = "force-dynamic";

/** In-memory ring of the last emergency-wait runs (per dev-server process). */
const globalForEmergency = globalThis as unknown as {
  __mcEmergencyLog?: EmergencyRun[];
};
interface EmergencyRun {
  at: string;
  action: "wait" | "issue" | "cleanup";
  wakeReason?: string | null;
  leasedCount?: number;
  dbReads?: number;
  latencyMs?: number;
  commandId?: string | null;
  ok: boolean;
  detail?: string;
}
function logRun(run: EmergencyRun): EmergencyRun[] {
  const log = globalForEmergency.__mcEmergencyLog ?? (globalForEmergency.__mcEmergencyLog = []);
  log.unshift(run);
  if (log.length > 12) log.length = 12;
  return log;
}

export async function GET() {
  try {
    const [identity, emergencyRows] = await Promise.all([
      getProbeDevice(),
      query(
        `select command_id, action, status, command_lane, target_client_id, issued_by,
                issued_at, completed_at, expires_at, leased_by,
                left(error, 80) as error
           from public.compute_fabric_a2_browser_supervisor_command_h205f22
          where command_lane = 'EMERGENCY'
          order by issued_at desc limit 20`,
      ),
    ]);
    const deviceActive = await query(
      `select active, revoked_at, enrolled_at, last_used_at
         from public.compute_fabric_a2_browser_device_h205f22 where device_id = $1`,
      [identity.deviceId],
    );
    return Response.json({
      ok: true,
      probe: {
        clientId: identity.clientId,
        deviceId: identity.deviceId,
        fingerprint: identity.fingerprint,
        active: deviceActive.rows[0]?.active === true,
        revokedAt: deviceActive.rows[0]?.revoked_at ?? null,
        enrolledAt: deviceActive.rows[0]?.enrolled_at ?? null,
      },
      emergencyCommands: emergencyRows.rows.map((r) => ({
        commandId: r.command_id != null ? String(r.command_id) : null,
        action: r.action != null ? String(r.action) : "",
        status: r.status != null ? String(r.status) : "",
        commandLane: r.command_lane != null ? String(r.command_lane) : null,
        targetClientId: r.target_client_id != null ? String(r.target_client_id) : null,
        issuedBy: r.issued_by != null ? String(r.issued_by) : "",
        issuedAt: r.issued_at != null ? new Date(String(r.issued_at)).toISOString() : null,
        completedAt: r.completed_at != null ? new Date(String(r.completed_at)).toISOString() : null,
        expiresAt: r.expires_at != null ? new Date(String(r.expires_at)).toISOString() : null,
        leasedBy: r.leased_by != null ? String(r.leased_by) : null,
        error: r.error != null ? String(r.error) : null,
      })),
      runs: globalForEmergency.__mcEmergencyLog ?? [],
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function POST(req: Request) {
  let body: { action?: string; wait_ms?: number; expected_git_sha?: string; ttl_seconds?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("invalid_json", 400);
  }

  try {
    if (body.action === "issue") {
      // Canonical supervisor-side issue RPC — the same chat-plane entry point a
      // real developer emergency update uses (no lease/execution authority here).
      const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
      const sha = typeof body.expected_git_sha === "string" && /^[0-9a-f]{40}$/i.test(body.expected_git_sha.trim())
        ? body.expected_git_sha.trim().toLowerCase()
        : "175c86ce5e24edce2f08a8bc2e4977b337042740"; // rail tip (merge PR #945)
      const ttl = Math.max(60, Math.min(900, Number(body.ttl_seconds) || 300));
      const identity = await getProbeDevice();
      // The issue RPC requires the target client to be "seen" — send a signed
      // heartbeat first so the probe registers in supervisor_state (canonical /v1/state).
      const hb = await edgeDevicePost("/v1/state", {
        state: {
          shell_version: "0.7.0-dev.35625473710.1",
          supervisor_mode: "CONTROL",
          armed: true,
          operator_mode: "MC_CONSOLE_PROBE",
        },
      });
      if (hb.status !== 202) {
        return jsonError("probe_heartbeat_failed", 502, { heartbeat: hb.json, http: hb.status });
      }
      const res = await query(
        `select h205f22_a2_browser_supervisor_issue_developer_emergency_update_(
            p_client_id => $1, p_request_nonce => $2, p_expected_git_sha => $3,
            p_ttl_seconds => $4, p_issued_by => 'MC_CONSOLE_SUPERVISOR') as issued`,
        [identity.clientId, nonce, sha, ttl],
      );
      const issued = res.rows[0]?.issued as Record<string, unknown> | undefined;
      if (!issued?.command_id) return jsonError("issue_rpc_rejected", 502, { issued: issued ?? null });
      return Response.json({
        ok: true,
        issued,
        run: logRun({
          at: new Date().toISOString(),
          action: "issue",
          commandId: String(issued.command_id),
          ok: true,
          detail: `DEVELOPER_EMERGENCY_UPDATE sha=${sha} ttl=${ttl}`,
        }),
      });
    }

    if (body.action === "wait") {
      // Canonical T8: POST /v1/commands/wait-emergency with device signature.
      const waitMs = Math.max(250, Math.min(15000, Number(body.wait_ms) || 4000));
      const t0 = Date.now();
      const r = await edgeDevicePost("/v1/commands/wait-emergency", { wait_ms: waitMs });
      const latencyMs = Date.now() - t0;
      const j = r.json as {
        command?: { command_id?: string; action?: string } | null;
        leased_count?: number;
        wake_reason?: string;
        authoritative_db_reads?: number;
        polling_loop?: boolean;
        transport_delivery_is_authority?: boolean;
        authority_effect?: boolean;
        error?: string;
      };
      const okHttp = r.status === 200;
      if (!okHttp && !j.error) return jsonError(`edge_wait_http_${r.status}`, 502, { edge: j });
      const run = logRun({
        at: new Date().toISOString(),
        action: "wait",
        wakeReason: (j.wake_reason as string) ?? null,
        leasedCount: Number(j.leased_count ?? 0),
        dbReads: Number(j.authoritative_db_reads ?? 0),
        latencyMs,
        commandId: j.command?.command_id ?? null,
        ok: okHttp,
        detail: okHttp ? undefined : String(j.error ?? "unknown"),
      });
      return Response.json({
        ok: okHttp,
        httpStatus: r.status,
        latencyMs,
        envelope: j,
        run,
      });
    }

    if (body.action === "cleanup") {
      // Console-issued emergency commands + probe leases → CANCELLED (audit keeps rows).
      const identity = await getProbeDevice();
      const res = await query(
        `update public.compute_fabric_a2_browser_supervisor_command_h205f22
            set status='CANCELLED', completed_at=now(),
                error='mc-console-cleanup (lease returned to plane)'
          where command_lane='EMERGENCY'
            and status in ('PENDING','LEASED')
            and (target_client_id=$1 or issued_by='MC_CONSOLE_SUPERVISOR')
          returning command_id`,
        [identity.clientId],
      );
      return Response.json({
        ok: true,
        cancelled: res.rowCount,
        ids: res.rows.map((r) => r.command_id),
        run: logRun({
          at: new Date().toISOString(),
          action: "cleanup",
          ok: true,
          detail: `cancelled=${res.rowCount}`,
        }),
      });
    }

    if (body.action === "reset-probe") {
      await resetProbeDevice();
      const identity = await getProbeDevice();
      return Response.json({ ok: true, probe: { clientId: identity.clientId, deviceId: identity.deviceId } });
    }

    return jsonError("unknown_action", 400);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}
