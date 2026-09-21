import { query } from "@/lib/pg";
import { jsonError } from "@/lib/edge";
import { edgeDevicePost, getProbeDevice } from "@/lib/probe-device";

export const dynamic = "force-dynamic";

const EVENT_SCHEMA = "metaengine.browser.cognitive-delta.v1";
const BATCH_SCHEMA = "metaengine.browser.cognitive-delta-batch.v1";
const WORKSPACE_ID = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4";

const globalForCog = globalThis as unknown as { __mcCogLog?: CogRun[] };
interface CogRun {
  at: string;
  ok: boolean;
  httpStatus?: number;
  latencyMs?: number;
  through?: number | null;
  reason?: string | null;
}

/** Synthetic console telemetry events — SYSTEM source, zero-authority fences. */
function buildEvent(identity: { clientId: string; deviceId: string; streamId: string }, seq: number, kind: string) {
  const now = new Date().toISOString();
  return {
    schema: EVENT_SCHEMA,
    stream_id: identity.streamId,
    sequence: seq,
    priority: "P2",
    source: "SYSTEM",
    type: `console.${kind}`,
    recorded_at: now,
    observed_at: now,
    tab_id: "mc-console",
    service_name: "mission-control",
    reason: kind === "health.probe" ? "operator console health telemetry" : "operator console UI event",
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  };
}

export async function GET() {
  try {
    const [installed, cursorRows, stats] = await Promise.all([
      query(
        `select to_regprocedure('public.h205f22_a2_browser_cognitive_accept_v1(uuid,text,text,uuid,integer,integer,jsonb,boolean)') is not null as installed`,
      ),
      query(
        `select workspace_id, client_id, device_id, stream_id,
                accepted_through_sequence, accepted_batches, accepted_events,
                first_seen_at, last_seen_at
           from public.compute_fabric_a2_browser_cognitive_cursor_h205f22
          order by last_seen_at desc limit 30`,
      ),
      query(
        `select coalesce(sum(accepted_batches),0)::int as batches,
                coalesce(sum(accepted_events),0)::int as events,
                count(*)::int as streams
           from public.compute_fabric_a2_browser_cognitive_cursor_h205f22`,
      ),
    ]);
    return Response.json({
      ok: true,
      acceptorInstalled: installed.rows[0]?.installed === true,
      cursor: cursorRows.rows.map((r) => ({
        workspaceId: r.workspace_id,
        clientId: r.client_id,
        deviceId: r.device_id,
        streamId: r.stream_id,
        acceptedThroughSequence: r.accepted_through_sequence,
        acceptedBatches: r.accepted_batches,
        acceptedEvents: r.accepted_events,
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
      })),
      stats: stats.rows[0],
      runs: globalForCog.__mcCogLog ?? [],
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function POST(req: Request) {
  let body: { events?: number; kind?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("invalid_json", 400);
  }
  const eventCount = Math.max(1, Math.min(16, Number(body.events) || 3));
  const kind = body.kind === "ui.event" ? "ui.event" : "health.probe";

  try {
    const identity = await getProbeDevice();
    // The cursor in DB is the authoritative watermark (cloud-true semantics) —
    // never derive the range from a local counter that can drift on failures.
    const cur = await query(
      `select accepted_through_sequence
         from public.compute_fabric_a2_browser_cognitive_cursor_h205f22
        where workspace_id=$1 and stream_id=$2 and client_id=$3 and device_id=$4`,
      [WORKSPACE_ID, identity.streamId, identity.clientId, identity.deviceId],
    );
    const afterSequence = Number(cur.rows[0]?.accepted_through_sequence ?? 0);
    const throughSequence = afterSequence + eventCount;
    const events = Array.from({ length: eventCount }, (_, i) => buildEvent(identity, afterSequence + i + 1, kind));
    const batch = {
      schema: BATCH_SCHEMA,
      stream_id: identity.streamId,
      after_sequence: afterSequence,
      through_sequence: throughSequence,
      event_count: eventCount,
      events,
      raw_payload_exposed: false,
      page_text_exposed: false,
      input_values_exposed: false,
      delivery_is_authority: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    };
    const r = await edgeDevicePost("/v1/cognitive/deltas", batch);
    const j = r.json as {
      accepted?: boolean;
      accepted_through_sequence?: number;
      error?: string;
      reason?: string;
      full_state_resync_required?: boolean;
    };
    const okCall = r.status === 202 && j.accepted === true;
    const run: CogRun = {
      at: new Date().toISOString(),
      ok: okCall,
      httpStatus: r.status,
      latencyMs: r.ms,
      through: j.accepted_through_sequence ?? null,
      reason: okCall ? "OK" : String(j.error ?? j.reason ?? `HTTP ${r.status}`),
    };
    const log = globalForCog.__mcCogLog ?? (globalForCog.__mcCogLog = []);
    log.unshift(run);
    if (log.length > 12) log.length = 12;
    return Response.json({ ok: okCall, run, ack: j, streamId: identity.streamId, workspaceId: WORKSPACE_ID });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}
