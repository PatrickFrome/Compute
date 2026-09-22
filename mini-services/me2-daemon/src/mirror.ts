// ME2 M5 groundwork — durable evidence mirror (outbox pattern).
// Every hash-chained event is staged into the `outbox` table. A flush loop
// attempts delivery to the future SECURITY DEFINER ingest-RPC on the cloud.
// Until that RPC is deployed the outbox records AWAITING_INGEST_RPC (404) and
// retries with aging — zero code change needed once the RPC lands.
// ME2_MIRROR_URL env overrides the endpoint. The service key NEVER leaves the
// daemon process and is never included in snapshots.
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const DEFAULT_URL =
  "https://xpeibufgzjknrhbhpffp.supabase.co/rest/v1/rpc/me2_ingest_evidence_v1";
const KEY_FILE = "/home/z/.a2/supabase-cloud.env";
const MAX_PENDING = 2000;
const MAX_ATTEMPTS = 50;
const FLUSH_BATCH = 20;

function loadServiceKey(): string {
  try {
    const text = readFileSync(KEY_FILE, "utf8");
    const m = text.match(/^SUPABASE_SERVICE_ROLE_JWT=(.+)$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

export interface MirrorStatus {
  enabled: boolean;
  endpoint: string;
  pending: number;
  sent: number;
  dead: number;
  lastError: string | null;
  lastAttemptAt: number;
  lastOkAt: number;
}

export class Mirror {
  private key = "";

  constructor(private db: Database) {
    this.key = loadServiceKey();
  }

  get endpoint(): string {
    return process.env.ME2_MIRROR_URL || DEFAULT_URL;
  }

  get enabled(): boolean {
    return this.key.length > 0;
  }

  /** Stage one event for durable delivery. Skips when backlog is saturated. */
  stage(eventId: number, payload: string): void {
    if (!this.enabled) return;
    const pending = this.db
      .query("SELECT COUNT(*) AS n FROM outbox WHERE state='PENDING'")
      .get() as { n: number };
    if (pending.n >= MAX_PENDING) return; // local-only events; journal keeps truth
    this.db
      .query(
        "INSERT INTO outbox (event_id, payload, state, attempts, created_at) VALUES (?,?, 'PENDING', 0, ?)",
      )
      .run(eventId, payload, Date.now());
  }

  status(): MirrorStatus {
    const counts = this.db
      .query("SELECT state, COUNT(*) AS n FROM outbox GROUP BY state")
      .all() as Array<{ state: string; n: number }>;
    const by = (s: string) => counts.find((c) => c.state === s)?.n ?? 0;
    // keep the table bounded: drop old terminal rows beyond 5000
    const terminal = by("SENT") + by("DEAD");
    if (terminal > 5000) {
      this.db
        .query(
          "DELETE FROM outbox WHERE state IN ('SENT','DEAD') AND id NOT IN (SELECT id FROM outbox WHERE state IN ('SENT','DEAD') ORDER BY id DESC LIMIT 4000)",
        )
        .run();
    }
    return {
      enabled: this.enabled,
      endpoint: this.endpoint.replace(/^https:\/\/([^/]+)\/(.*)$/, "$1/$2"),
      pending: by("PENDING"),
      sent: by("SENT"),
      dead: by("DEAD"),
      lastError: this.state.lastError,
      lastAttemptAt: this.state.lastAttemptAt,
      lastOkAt: this.state.lastOkAt,
    };
  }

  private state = { lastError: null as string | null, lastAttemptAt: 0, lastOkAt: 0 };

  async flush(): Promise<{ attempted: number; delivered: number; error?: string }> {
    if (!this.enabled) return { attempted: 0, delivered: 0, error: "NO_KEY" };
    const rows = this.db
      .query("SELECT id, event_id, payload FROM outbox WHERE state='PENDING' AND attempts < ? ORDER BY id LIMIT ?")
      .all(MAX_ATTEMPTS, FLUSH_BATCH) as Array<{ id: number; event_id: number; payload: string }>;
    if (rows.length === 0) return { attempted: 0, delivered: 0 };
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_events: rows.map((r) => {
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(r.payload);
            } catch {
              parsed = { raw: r.payload };
            }
            return { event_id: r.event_id, payload: parsed };
          }),
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      const msg = "NETWORK: " + (e instanceof Error ? e.message : String(e));
      this.state.lastError = msg;
      this.state.lastAttemptAt = Date.now();
      this.age(rows.map((r) => r.id));
      return { attempted: rows.length, delivered: 0, error: msg };
    }
    this.state.lastAttemptAt = Date.now();
    if (res.ok) {
      for (const r of rows)
        this.db
          .query("UPDATE outbox SET state='SENT', sent_at=? WHERE id=?")
          .run(Date.now(), r.id);
      this.state.lastOkAt = Date.now();
      this.state.lastError = null;
      return { attempted: rows.length, delivered: rows.length };
    }
    const body = (await res.text().catch(() => "")).slice(0, 200);
    const short =
      res.status === 404
        ? "AWAITING_INGEST_RPC (404 PGRST202)"
        : res.status === 401 || res.status === 403
          ? `KEY_REJECTED (${res.status})`
          : `HTTP_${res.status}: ${body}`;
    this.state.lastError = short;
    this.age(rows.map((r) => r.id));
    return { attempted: rows.length, delivered: 0, error: short };
  }

  /** Age attempts; mark DEAD after MAX_ATTEMPTS. PENDING rows stay queued. */
  private age(ids: number[]): void {
    for (const id of ids) {
      this.db
        .query("UPDATE outbox SET attempts = attempts + 1, last_error=? WHERE id=?")
        .run(this.state.lastError ?? "ERROR", id);
      this.db
        .query("UPDATE outbox SET state='DEAD' WHERE id=? AND attempts >= ?")
        .run(id, MAX_ATTEMPTS);
    }
  }
}
