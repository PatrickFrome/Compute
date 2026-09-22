/**
 * ME2 Evidence Mirror (M5-lite) — локальный outbox → Supabase (evidence-plane).
 * Каждое событие hash-chain попадает в outbox; батч-аплоадер отправляет его в облако.
 * Если таблицы/RPC в облаке нет (DDL недоступен без access token) — DEGRADED:
 * outbox копится локально, статус виден в /evidence и в консоли. Доставка догонит,
 * как только облако получит схему me2_evidence (миграция оператора).
 */
import { db, onEvent, getMeta, setMeta } from "./store";
import { readFileSync } from "node:fs";

const ENV_PATH = "/home/z/.a2/supabase-cloud.env";
const BATCH = 40;
const TICK_MS = 10_000;
const ERROR_BACKOFF_MS = 60_000;

type Env = { url?: string; key?: string };
function loadEnv(): Env {
  try {
    const raw = readFileSync(ENV_PATH, "utf8");
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      let k = line.slice(0, i).trim();
      if (k.startsWith("export ")) k = k.slice(7).trim();
      env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
    return { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_JWT };
  } catch {
    return {};
  }
}

// ── outbox-таблица ─────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS evidence_outbox (
  seq INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
`);

type OutboxRow = { seq: number; payload: string; attempts: number };

let env: Env | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let sending = false;
let lastError: string | null = getMeta("evidence_last_error");
let lastSentSeq = Number(getMeta("evidence_last_seq") ?? 0);
let method: "table" | "rpc" | null = (getMeta("evidence_method") as "table" | "rpc" | null) ?? null;
let backoffUntil = 0;

function pendingCount(): number {
  const r = db.query(`SELECT COUNT(*) AS n FROM evidence_outbox WHERE sent_at IS NULL`).get() as { n: number };
  return Number(r.n);
}

export function evidenceStatus() {
  const configured = Boolean(env?.url && env?.key);
  return {
    ok: true,
    mode: !configured ? "OFF" : lastError && Date.now() < backoffUntil ? "DEGRADED" : lastError ? "DEGRADED" : "LIVE",
    endpoint: env?.url ?? null,
    method,
    last_sent_seq: lastSentSeq,
    pending: pendingCount(),
    attempts_total: Number((db.query(`SELECT COALESCE(SUM(attempts),0) AS a FROM evidence_outbox`).get() as { a: number }).a ?? 0),
    last_error: lastError,
    backoff_until: backoffUntil ? new Date(backoffUntil).toISOString() : null,
  };
}

async function pushBatch(rows: OutboxRow[]): Promise<{ ok: boolean; error?: string; via: "table" | "rpc" }> {
  if (!env?.url || !env?.key) return { ok: false, error: "no_credentials", via: "table" };
  const headers = {
    apikey: env.key,
    Authorization: `Bearer ${env.key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=ignore-duplicates",
  };
  const body = rows.map((r) => JSON.parse(r.payload));

  // 1) предпочитаемый путь: SECURITY DEFINER RPC (появится после миграции оператора)
  if (method !== "table") {
    try {
      const r = await fetch(`${env.url}/rest/v1/rpc/me2_ingest_evidence_v1`, {
        method: "POST", headers, body: JSON.stringify({ p_events: body }),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) return { ok: true, via: "rpc" };
      const t = await r.text();
      // PGRST202 = функции нет в схеме → пробуем таблицу
      if (!String(t).includes("PGRST202")) return { ok: false, error: `rpc HTTP ${r.status}: ${t.slice(0, 200)}`, via: "rpc" };
    } catch (e) {
      return { ok: false, error: `rpc: ${String(e).slice(0, 200)}`, via: "rpc" };
    }
  }

  // 2) прямой INSERT в таблицу me2_evidence (public schema)
  const r = await fetch(`${env.url}/rest/v1/me2_evidence`, {
    method: "POST", headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.ok) return { ok: true, via: "table" };
  const t = await r.text();
  return { ok: false, error: `table HTTP ${r.status}: ${t.slice(0, 200)}`, via: "table" };
}

async function tick(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    if (Date.now() < backoffUntil) return;
    const rows = db.query(
      `SELECT seq, payload, attempts FROM evidence_outbox WHERE sent_at IS NULL ORDER BY seq ASC LIMIT ?`,
    ).all(BATCH) as OutboxRow[];
    if (!rows.length) return;
    const res = await pushBatch(rows);
    if (res.ok) {
      method = res.via;
      setMeta("evidence_method", res.via);
      const ids = rows.map((r) => r.seq);
      db.query(`UPDATE evidence_outbox SET sent_at=?, attempts=attempts+1, last_error=NULL WHERE seq IN (${ids.join(",")})`)
        .run(new Date().toISOString());
      lastSentSeq = Math.max(lastSentSeq, ...ids);
      setMeta("evidence_last_seq", String(lastSentSeq));
      if (lastError) { lastError = null; setMeta("evidence_last_error", ""); }
      console.log(`[evidence] sent ${rows.length} events to Supabase via ${res.via} (pending: ${pendingCount()})`);
    } else {
      lastError = res.error ?? "unknown";
      setMeta("evidence_last_error", lastError.slice(0, 300));
      db.query(`UPDATE evidence_outbox SET attempts=attempts+1, last_error=? WHERE sent_at IS NULL`).run(lastError.slice(0, 300));
      backoffUntil = Date.now() + ERROR_BACKOFF_MS;
      console.log(`[evidence] DEGRADED: ${lastError} (backoff ${ERROR_BACKOFF_MS / 1000}s, pending: ${pendingCount()})`);
    }
  } catch (e) {
    lastError = String(e).slice(0, 300);
    setMeta("evidence_last_error", lastError);
    backoffUntil = Date.now() + ERROR_BACKOFF_MS;
  } finally {
    sending = false;
  }
}

/** Инициализация: подписка на события + запуск аплоадера. Вызывается из index.ts. */
export function initEvidence(): void {
  env = loadEnv();
  onEvent((e) => {
    try {
      db.query(`INSERT OR IGNORE INTO evidence_outbox (seq, payload, created_at) VALUES (?,?,?)`)
        .run(e.seq, JSON.stringify(e), e.ts);
    } catch { /* outbox не роняет emit */ }
  });
  if (!timer) timer = setInterval(() => { void tick(); }, TICK_MS);
  console.log(`[evidence] mirror init: ${env?.url ? env.url : "no env → OFF"} (batch ${BATCH}/${TICK_MS / 1000}s)`);
}
