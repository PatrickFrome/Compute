import { pgPool, T } from "@/lib/pg";
import type { Client } from "pg";

export const dynamic = "force-dynamic";

const WAKE_CHANNEL = "glm_browser_pulse";
const PROBE_TIMEOUT_MS = 6000;

/**
 * POSTGRES_NOTIFY wake latency probe (T11 rehearsal from the console):
 * 1. dedicated client LISTENs on the canonical wake channel
 * 2. inserts a WAKE_PROBE command (trigger glm_browser_pulse_notify_v1 fires)
 * 3. measures insert→notify latency, then cleans the probe row up.
 */
export async function POST() {
  const client: Client = await pgPool.connect();
  try {
    await client.query(`listen ${WAKE_CHANNEL}`);

    const workspace = await client.query(
      `select workspace_id from ${T.command} order by issued_at desc limit 1`,
    );
    const wsId = workspace.rows[0]?.workspace_id;
    if (!wsId) {
      return Response.json({ ok: false, error: "NO_WORKSPACE_REFERENCE" }, { status: 409 });
    }

    const notifyPromise = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WAKE_TIMEOUT")), PROBE_TIMEOUT_MS);
      const onNotify = (msg: { channel: string; payload?: string }) => {
        if (msg.channel !== WAKE_CHANNEL) return;
        clearTimeout(timer);
        client.removeListener("notification", onNotify);
        resolve(Date.now());
      };
      client.on("notification", onNotify);
    });

    const t0 = Date.now();
    const inserted = await client.query(
      `insert into ${T.command} (workspace_id, target_client_id, issued_by, action, payload, expires_at)
       values ($1, 'console-wake-probe', 'mission-control-web', 'POLL', '{"schema":"metaengine.console.wake-probe.v1"}'::jsonb, clock_timestamp() + interval '10 seconds')
       returning command_id`,
      [wsId],
    );
    const commandId = String(inserted.rows[0].command_id);
    const insertDone = Date.now();

    let notifyAt = 0;
    try {
      notifyAt = await notifyPromise;
    } finally {
      client.removeAllListeners("notification");
      await client.query(`unlisten ${WAKE_CHANNEL}`);
    }

    const latencyMs = notifyAt - t0;
    // cleanup: probe row served its purpose (trigger fired); mark terminal
    await client.query(
      `update ${T.command} set status='CANCELLED', completed_at=clock_timestamp(), error='wake-probe consumed by console' where command_id=$1`,
      [commandId],
    );

    return Response.json({
      ok: true,
      channel: WAKE_CHANNEL,
      commandId,
      latencyMs,
      insertMs: insertDone - t0,
      measuredAt: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      { ok: false, error: message, hint: message === "WAKE_TIMEOUT" ? `no ${WAKE_CHANNEL} notify within ${PROBE_TIMEOUT_MS}ms` : undefined },
      { status: message === "WAKE_TIMEOUT" ? 504 : 500 },
    );
  } finally {
    client.release();
  }
}
