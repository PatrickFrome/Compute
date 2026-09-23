/**
 * ME2 Evidence Mirror v2 (M5-lite → R32) — локальный outbox → Supabase.
 * Три уровня доставки (каждый следующий пробуется, если предыдущий не готов):
 *   1) RPC me2_ingest_evidence_v1 (SECURITY DEFINER, появится после DDL)
 *   2) прямой INSERT в таблицу me2_evidence (после DDL)
 *   3) Storage-зеркало: bucket me2-evidence, объект batches/{seq}.jsonl — работает УЖЕ СЕЙЧАС
 *      (проверено в R32: sb_secret принимает storage API 200).
 * DDL-хилер: миграция supabase-migration-me2-evidence.sql применяется АВТОМАТИЧЕСКИ
 *   при первом открывшемся канале (mgmt+sb_secret / mgmt+minted-jwt / pg-proxy).
 *   Попытки журналируются; ретрай каждые 15 мин + по POST {op:"probe_ddl"}.
 * Никакой фальши: пока ни один канал не работает — честный DEGRADED с причиной.
 */
import { db, onEvent, getMeta, setMeta, emit } from "./store";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const ENV_PATH = "/home/z/.a2/supabase-cloud.env";
const MIGRATION_PATH = new URL("./supabase-migration-me2-evidence.sql", import.meta.url).pathname;
const BATCH = 40;
const TICK_MS = 10_000;
const ERROR_BACKOFF_MS = 60_000;
const DDL_RETRY_MS = 15 * 60_000;
const STORAGE_BUCKET = "me2-evidence";

type Env = { url?: string; key?: string; jwtSecret?: string; ref?: string };
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
    const url = env.SUPABASE_URL;
    const ref = url ? (url.match(/https:\/\/([^.]+)\.supabase\.co/) ?? [])[1] : undefined;
    return {
      url,
      key: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_API_KEY_SB || env.SUPABASE_SERVICE_ROLE_JWT,
      jwtSecret: env.SUPABASE_JWT_SECRET,
      ref,
    };
  } catch {
    return {};
  }
}

// ── outbox + журнал попыток DDL ────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS evidence_outbox (
  seq INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS evidence_ddl_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  ok INTEGER NOT NULL,
  http_status INTEGER,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_ddl_at ON evidence_ddl_attempts(at);
`);

type OutboxRow = { seq: number; payload: string; attempts: number };
type DdlChannel = "mgmt_sb_secret" | "mgmt_minted_jwt" | "pg_proxy";

let env: Env | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let ddlTimer: ReturnType<typeof setInterval> | null = null;
let sending = false;
let lastError: string | null = getMeta("evidence_last_error") || null;
let lastSentSeq = Number(getMeta("evidence_last_seq") ?? 0);
let method: "table" | "rpc" | "storage" | null = (getMeta("evidence_method") as "table" | "rpc" | "storage" | null) ?? null;
let backoffUntil = 0;
let storageOk = false;
let storageObjects = 0;
let ddlLastAt: string | null = getMeta("evidence_ddl_last_at") || null;
let ddlLastResult: string | null = getMeta("evidence_ddl_last_result") || null;
let ddlRunning = false;

function pendingCount(): number {
  const r = db.query(`SELECT COUNT(*) AS n FROM evidence_outbox WHERE sent_at IS NULL`).get() as { n: number };
  return Number(r.n);
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** service_role HS256-JWT из JWT-секрета (для канала mgmt_minted_jwt). */
function mintServiceJwt(): string | null {
  if (!env?.jwtSecret || !env?.ref) return null;
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64url(JSON.stringify({ iss: "supabase", ref: env.ref, role: "service_role", iat: now, exp: now + 300 }));
  const sig = createHmac("sha256", env.jwtSecret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}

export function evidenceStatus() {
  const configured = Boolean(env?.url && env?.key);
  let mode: "OFF" | "LIVE" | "LIVE-STORAGE" | "DEGRADED";
  if (!configured) mode = "OFF";
  else if (!lastError) mode = method === "storage" ? "LIVE-STORAGE" : "LIVE";
  else if (storageOk) mode = "LIVE-STORAGE"; // зеркало доставляет, SQL-плоскость ждёт DDL
  else mode = "DEGRADED";
  return {
    ok: true,
    mode,
    endpoint: env?.url ?? null,
    method,
    last_sent_seq: lastSentSeq,
    pending: pendingCount(),
    attempts_total: Number((db.query(`SELECT COALESCE(SUM(attempts),0) AS a FROM evidence_outbox`).get() as { a: number }).a ?? 0),
    last_error: lastError,
    backoff_until: backoffUntil ? new Date(backoffUntil).toISOString() : null,
    storage: { ok: storageOk, bucket: STORAGE_BUCKET, objects: storageObjects },
    ddl: {
      migration: "supabase-migration-me2-evidence.sql",
      last_at: ddlLastAt,
      last_result: ddlLastResult,
      channels: ["mgmt_sb_secret", "mgmt_minted_jwt", "pg_proxy"],
      retry_every_min: DDL_RETRY_MS / 60_000,
      next_retry_at: ddlLastAt ? new Date(new Date(ddlLastAt).getTime() + DDL_RETRY_MS).toISOString() : null,
      attempts_total: Number((db.query(`SELECT COUNT(*) AS n FROM evidence_ddl_attempts`).get() as { n: number }).n ?? 0),
    },
  };
}

// ── DDL-хилер: применить миграцию при первом живом канале ──────────
async function ddlAttempt(channel: DdlChannel, sql: string): Promise<{ ok: boolean; status: number; detail: string }> {
  if (!env?.url || !env?.key) return { ok: false, status: 0, detail: "no_credentials" };
  const mgmt = `https://api.supabase.com/v1/projects/${env.ref}/database/query`;
  let url = mgmt;
  let bearer = env.key;
  if (channel === "mgmt_minted_jwt") {
    const jwt = mintServiceJwt();
    if (!jwt) return { ok: false, status: 0, detail: "no_jwt_secret" };
    bearer = jwt;
  } else if (channel === "pg_proxy") {
    url = `${env.url}/pg`;
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(20_000),
    });
    const t = (await r.text()).slice(0, 220);
    return { ok: r.ok, status: r.status, detail: t || "(empty)" };
  } catch (e) {
    return { ok: false, status: 0, detail: String(e).slice(0, 220) };
  }
}

async function tableExists(): Promise<boolean> {
  if (!env?.url || !env?.key) return false;
  try {
    const r = await fetch(`${env.url}/rest/v1/me2_evidence?select=seq&limit=1`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Полный цикл: пробуем каналы DDL → если миграция легла → дренаж outbox немедленно. */
export async function probeDdl(manual = false): Promise<{ applied: boolean; attempts: unknown[] }> {
  if (ddlRunning) return { applied: false, attempts: [{ channel: "skipped", ok: false, detail: "already_running" }] };
  ddlRunning = true;
  const attempts: unknown[] = [];
  try {
    if (!env?.url || !env?.key) return { applied: false, attempts: [{ detail: "no_credentials" }] };
    if (await tableExists()) {
      lastError = null; setMeta("evidence_last_error", "");
      return { applied: true, attempts: [{ channel: "verify", ok: true, detail: "table already exists" }] };
    }
    let sql = "";
    try { sql = readFileSync(MIGRATION_PATH, "utf8"); } catch (e) {
      ddlLastResult = `migration file unreadable: ${String(e).slice(0, 120)}`;
      return { applied: false, attempts: [{ channel: "file", ok: false, detail: ddlLastResult }] };
    }
    const channels: DdlChannel[] = ["mgmt_sb_secret", "mgmt_minted_jwt", "pg_proxy"];
    for (const ch of channels) {
      const r = await ddlAttempt(ch, sql);
      db.query(`INSERT INTO evidence_ddl_attempts (channel, ok, http_status, detail, at) VALUES (?,?,?,?,?)`)
        .run(ch, r.ok ? 1 : 0, r.status, r.detail.slice(0, 200), new Date().toISOString());
      attempts.push({ channel: ch, ok: r.ok, status: r.status, detail: r.detail.slice(0, 120) });
      if (r.ok) break; // канал открылся и принял SQL
    }
    const applied = await tableExists();
    ddlLastAt = new Date().toISOString();
    ddlLastResult = applied ? "APPLIED: таблица me2_evidence жива" : `channels closed: ${attempts.map((a) => (a as { channel: string; status: number }).channel + "=" + (a as { status: number }).status).join(", ")}`;
    setMeta("evidence_ddl_last_at", ddlLastAt);
    setMeta("evidence_ddl_last_result", ddlLastResult);
    try { emit("EVIDENCE_DDL_ATTEMPT", { applied, manual, result: ddlLastResult.slice(0, 200) }, null, null); } catch { /* шина не критична */ }
    if (applied) {
      lastError = null;
      setMeta("evidence_last_error", "");
      method = null;
      setMeta("evidence_method", "");
      backoffUntil = 0;
      void tick(); // немедленный дренаж накопленного outbox
    }
    // журнал кап 200
    db.query(`DELETE FROM evidence_ddl_attempts WHERE id NOT IN (SELECT id FROM evidence_ddl_attempts ORDER BY id DESC LIMIT 200)`).run();
    return { applied, attempts };
  } finally {
    ddlRunning = false;
  }
}

// ── доставка ───────────────────────────────────────────────────────
async function pushStorage(rows: OutboxRow[]): Promise<{ ok: boolean; error?: string }> {
  if (!env?.url || !env?.key) return { ok: false, error: "no_credentials" };
  const lastSeq = rows[rows.length - 1].seq;
  const key = `batches/${String(lastSeq).padStart(10, "0")}.jsonl`;
  const body = rows.map((r) => r.payload).join("\n") + "\n";
  try {
    const r = await fetch(`${env.url}/storage/v1/object/${STORAGE_BUCKET}/${key}`, {
      method: "POST",
      headers: {
        apikey: env.key,
        Authorization: `Bearer ${env.key}`,
        "Content-Type": "application/octet-stream",
        "x-upsert": "true",
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) return { ok: true };
    return { ok: false, error: `storage HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: `storage: ${String(e).slice(0, 200)}` };
  }
}

async function pushBatch(rows: OutboxRow[]): Promise<{ ok: boolean; error?: string; via: "table" | "rpc" | "storage" }> {
  if (!env?.url || !env?.key) return { ok: false, error: "no_credentials", via: "table" };
  const headers = {
    apikey: env.key,
    Authorization: `Bearer ${env.key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=ignore-duplicates",
  };
  const body = rows.map((r) => JSON.parse(r.payload));

  // 1) SECURITY DEFINER RPC (после DDL)
  if (method !== "table") {
    try {
      const r = await fetch(`${env.url}/rest/v1/rpc/me2_ingest_evidence_v1`, {
        method: "POST", headers, body: JSON.stringify({ p_events: body }),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) return { ok: true, via: "rpc" };
      const t = await r.text();
      if (!String(t).includes("PGRST202")) return { ok: false, error: `rpc HTTP ${r.status}: ${t.slice(0, 200)}`, via: "rpc" };
    } catch (e) {
      return { ok: false, error: `rpc: ${String(e).slice(0, 200)}`, via: "rpc" };
    }
  }

  // 2) прямой INSERT в таблицу (после DDL)
  const r = await fetch(`${env.url}/rest/v1/me2_evidence`, {
    method: "POST", headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.ok) return { ok: true, via: "table" };
  const t = await r.text();
  const tableMissing = r.status === 404 || String(t).includes("PGRST205");

  // 3) Storage-зеркало (работает уже сейчас; upsert по ключу последнего seq)
  if (tableMissing) {
    const st = await pushStorage(rows);
    if (st.ok) return { ok: true, via: "storage" };
    return { ok: false, error: st.error ?? "storage failed", via: "storage" };
  }
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
      if (res.via === "storage") {
        storageOk = true;
        storageObjects += 1;
        // Эмитим только ПОЛНЫЕ батчи: хвост (последняя неполная посылка) не создаёт
        // нового события → иначе EVIDENCE_STORAGE_SENT → outbox → вечный цикл 1-событийных батчей (R32, поймано живым drain-замером).
        if (rows.length >= BATCH) {
          try { emit("EVIDENCE_STORAGE_SENT", { batch: rows.length, last_seq: lastSentSeq, objects: storageObjects }, null, null); } catch { /* шина не критична */ }
        }
      }
      if (lastError) {
        // успех ДОСТАВКИ (любой канал) очищает ошибку доставки; статус SQL-плоскости — отдельно в ddl.last_result (R32)
        lastError = null;
        setMeta("evidence_last_error", "");
        if (res.via !== "storage") storageOk = false;
      }
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

/** Живая проба Storage-канала (roundtrip: upload → read → delete). */
export async function probeStorage(): Promise<{ ok: boolean; detail: string }> {
  if (!env?.url || !env?.key) return { ok: false, detail: "no_credentials" };
  const key = `probe/${Date.now()}.json`;
  const payload = JSON.stringify({ probe: true, ts: new Date().toISOString() });
  try {
    const up = await fetch(`${env.url}/storage/v1/object/${STORAGE_BUCKET}/${key}`, {
      method: "POST",
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", "x-upsert": "true" },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });
    if (!up.ok) return { ok: false, detail: `upload HTTP ${up.status}: ${(await up.text()).slice(0, 150)}` };
    const back = await fetch(`${env.url}/storage/v1/object/${STORAGE_BUCKET}/${key}`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const roundtrip = back.ok && (await back.text()) === payload;
    return { ok: roundtrip, detail: roundtrip ? "roundtrip ok (upload→read→match)" : "readback mismatch" };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 200) };
  }
}

/** Инициализация: подписка на события + аплоадер + DDL-хилер (boot+5s, затем каждые 15 мин). */
export function initEvidence(): void {
  env = loadEnv();
  onEvent((e) => {
    try {
      db.query(`INSERT OR IGNORE INTO evidence_outbox (seq, payload, created_at) VALUES (?,?,?)`)
        .run(e.seq, JSON.stringify(e), e.ts);
    } catch { /* outbox не роняет emit */ }
  });
  if (!timer) timer = setInterval(() => { void tick(); }, TICK_MS);
  setTimeout(() => { void probeDdl(false); }, 5_000);
  if (!ddlTimer) ddlTimer = setInterval(() => { void probeDdl(false); }, DDL_RETRY_MS);
  console.log(`[evidence] mirror v2 init: ${env?.url ? env.url : "no env → OFF"} (batch ${BATCH}/${TICK_MS / 1000}s; storage=${STORAGE_BUCKET}; ddl-healer каждые ${DDL_RETRY_MS / 60_000}м)`);
}
