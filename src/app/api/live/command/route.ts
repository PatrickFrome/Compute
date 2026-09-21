import {
  cloudCommandReceipt,
  cloudConfigured,
  cloudIssueCommand,
} from "@/lib/cloud";

export const dynamic = "force-dynamic";

/**
 * POST /api/live/command — operator lane to the LIVE browser via the canonical
 * cloud command plane (h205f22_a2_browser_supervisor_issue_native_v1).
 *
 * Body: { action: "FLEET_RECONCILE" | "CLOSE_TAB" | "RELOAD_TAB", payload }
 * Responses are zero-authority: the browser decides (admission, fencing, receipts).
 */

const AGENT_ID_RE = /^agent_[0-9a-fA-F-]{6,72}$/;
const TAB_ID_RE = /^tab_[0-9a-fA-F-]{6,72}$/;

function validate(action: string, payload: unknown): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof payload !== "object" || payload === null) return { ok: false, error: "payload_required" };
  const p = payload as Record<string, unknown>;
  switch (action) {
    case "FLEET_RECONCILE": {
      const out: Record<string, unknown> = {
        active: p.active !== false,
        target_agents: Number(p.target_agents ?? 0),
      };
      if (!Number.isInteger(out.target_agents) || (out.target_agents as number) < 0 || (out.target_agents as number) > 28) {
        return { ok: false, error: "target_agents_must_be_integer_0..28" };
      }
      if (Array.isArray(p.retire_agent_ids)) {
        const ids = p.retire_agent_ids.map(String).filter((s) => AGENT_ID_RE.test(s));
        if (ids.length !== p.retire_agent_ids.length) return { ok: false, error: "invalid_agent_id_format" };
        if (ids.length > 16) return { ok: false, error: "too_many_retire_ids" };
        out.retire_agent_ids = ids;
      }
      return { ok: true, payload: out };
    }
    case "CLOSE_TAB":
    case "RELOAD_TAB": {
      const tabId = String(p.tab_id ?? "");
      if (!TAB_ID_RE.test(tabId)) return { ok: false, error: "invalid_tab_id_format" };
      return { ok: true, payload: { tab_id: tabId } };
    }
    default:
      return { ok: false, error: `action_not_allowed:${action}` };
  }
}

function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export async function POST(request: Request) {
  if (!cloudConfigured()) {
    return Response.json({ ok: false, error: "cloud creds unavailable" }, { status: 503 });
  }
  let body: { action?: string; payload?: unknown; waitMs?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const v = validate(action, body.payload);
  if (!v.ok) return Response.json({ ok: false, error: v.error }, { status: 400 });

  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = `mc-console:${action.toLowerCase()}:${nonce}`;

  try {
    const issued = await cloudIssueCommand({
      action,
      payload: v.payload,
      ttlSeconds: 90,
      issuedBy: "MISSION_CONTROL_CONSOLE",
      idempotencyKey,
    });
    const commandId = String(issued.command_id ?? "");
    if (!commandId) {
      return Response.json({ ok: false, error: "no_command_id", issued }, { status: 502 });
    }

    // Wait for the browser to lease/execute and post a receipt (bounded).
    const waitMs = Math.min(Math.max(Number(body.waitMs ?? 12000), 0), 25000);
    const deadline = Date.now() + waitMs;
    let receipt = await cloudCommandReceipt(commandId);
    while (receipt && receipt.status !== "COMPLETED" && receipt.status !== "EXPIRED" && receipt.status !== "FAILED" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1300));
      receipt = await cloudCommandReceipt(commandId);
    }

    const terminal = receipt?.status === "COMPLETED";
    const result = (receipt?.receipt?.result ?? null) as Record<string, unknown> | null;
    return Response.json({
      ok: terminal,
      action,
      commandId: shortId(commandId),
      status: receipt?.status ?? "PENDING",
      result,
      receipt: receipt?.receipt ?? null,
      idempotencyKey,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), idempotencyKey },
      { status: 502 },
    );
  }
}
