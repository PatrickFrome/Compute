import { query, T } from "@/lib/pg";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [requests, devices] = await Promise.all([
      query(
        `select request_id, client_id, profile, key_fingerprint_sha256,
                status, authority_effect, requested_at, approved_at, expires_at, device_id,
                public_jwk->>'kty' as jwk_kty, public_jwk->>'crv' as jwk_crv
         from ${T.enrollment}
         order by case when status = 'PENDING' then 0 else 1 end, requested_at desc
         limit 60`,
      ),
      query(
        `select device_id, client_id, active, key_fingerprint_sha256,
                enrolled_at, revoked_at, last_used_at
         from public.compute_fabric_a2_browser_device_h205f22
         order by enrolled_at desc limit 60`,
      ),
    ]);

    return Response.json({
      ok: true,
      requests: requests.rows.map((r) => ({
        requestId: String(r.request_id),
        clientId: String(r.client_id ?? ""),
        profile: r.profile ? String(r.profile) : null,
        fingerprint: r.key_fingerprint_sha256 ? String(r.key_fingerprint_sha256) : null,
        status: String(r.status ?? ""),
        requestedAt: r.requested_at ? new Date(String(r.requested_at)).toISOString() : null,
        approvedAt: r.approved_at ? new Date(String(r.approved_at)).toISOString() : null,
        expiresAt: r.expires_at ? new Date(String(r.expires_at)).toISOString() : null,
        jwkKty: r.jwk_kty ? String(r.jwk_kty) : null,
        jwkCrv: r.jwk_crv ? String(r.jwk_crv) : null,
      })),
      devices: devices.rows.map((r) => ({
        deviceId: String(r.device_id),
        clientId: String(r.client_id ?? ""),
        active: r.active === true,
        fingerprint: r.key_fingerprint_sha256 ? String(r.key_fingerprint_sha256) : null,
        createdAt: r.enrolled_at ? new Date(String(r.enrolled_at)).toISOString() : null,
        revokedAt: r.revoked_at ? new Date(String(r.revoked_at)).toISOString() : null,
        lastSeenAt: r.last_used_at ? new Date(String(r.last_used_at)).toISOString() : null,
      })),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

interface ActionBody {
  requestId?: string;
  action?: "approve" | "reject" | "activate";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ActionBody;
    const requestId = String(body.requestId ?? "").trim();
    const action = String(body.action ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
      return Response.json({ ok: false, error: "REQUEST_ID_INVALID" }, { status: 400 });
    }

    if (action === "approve" || action === "reject") {
      const status = action === "approve" ? "APPROVED" : "REJECTED";
      const res = await query(
        `update ${T.enrollment}
         set status = $1,
             approved_at = case when $1 = 'APPROVED' then clock_timestamp() else approved_at end,
             expires_at = case when $1 = 'APPROVED' and expires_at <= clock_timestamp()
                               then clock_timestamp() + interval '15 minutes' else expires_at end
         where request_id = $2 and status <> $1
         returning request_id, status`,
        [status, requestId],
      );
      if (res.rowCount === 0) {
        return Response.json({ ok: false, error: "NOT_FOUND_OR_SAME_STATE" }, { status: 409 });
      }
      return Response.json({ ok: true, requestId, newStatus: status, gate: "OPERATOR" });
    }

    if (action === "activate") {
      // Operator gate must be passed first; then issue pairing token via canonical RPC.
      const gate = await query(
        `update ${T.enrollment}
         set status = 'APPROVED',
             approved_at = coalesce(approved_at, clock_timestamp()),
             expires_at = case when expires_at <= clock_timestamp()
                               then clock_timestamp() + interval '15 minutes' else expires_at end
         where request_id = $1 returning client_id, profile, key_fingerprint_sha256, public_jwk`,
        [requestId],
      );
      if (gate.rowCount === 0) {
        return Response.json({ ok: false, error: "REQUEST_NOT_FOUND" }, { status: 404 });
      }
      const r = gate.rows[0];
      const rpc = await query(
        `select public.h205f22_a2_browser_device_activate_approved_v1($1, $2, $3, $4, $5) as result`,
        [requestId, String(r.client_id), String(r.profile ?? "A2_DEVICE_HTTP_SIGNATURE_V1"), String(r.key_fingerprint_sha256), r.public_jwk],
      );
      const result = (rpc.rows[0]?.result ?? {}) as Record<string, unknown>;
      return Response.json({
        ok: result.accepted === true,
        requestId,
        accepted: result.accepted === true,
        reason: result.reason ?? null,
        pairingToken: typeof result.pairing_token === "string" ? result.pairing_token : null,
        deviceId: result.device_id ? String(result.device_id) : null,
      });
    }

    return Response.json({ ok: false, error: "ACTION_UNKNOWN" }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
