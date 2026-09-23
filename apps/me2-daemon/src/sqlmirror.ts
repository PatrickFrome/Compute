// ── R52 (фаза D, план D8/H6): SQL-контур — зеркалирование hash-chain событий в Supabase SQL ──
// Роль (план electron-rebuild §D): Supabase = federation/evidence/control-plane; локальная
// SQLite = истина. Зеркало события — ДОПОЛНИТЕЛЬНО к storage-каналу (mirror.ts, RPC
// me2_ingest_evidence_v1): то же событие попадает в обычную SQL-таблицу me2_event_mirror_h205f22,
// откуда UI может читать с гейтом RLS.
//
// Схема источника — store.ts events (M1-шина): seq PK, ts TEXT (ISO), type, agent_id,
// task_id, data (JSON), prev_hash, hash. Маппинг в SQL-таблицу (sql/0001):
//   actor=coalesce(agent_id,'daemon'), subject=task_id, payload=data.
//
// Честные состояния (философия R49-R51: degradation без штормов):
//   OFF            — ME2_SQL_MIRROR!=1 или нет ключа в vault (штатный режим до решения оператора)
//   WARMUP         — включён, таблицы ещё нет (PGRST205/404) — перепроба не чаще SQLMIRROR_PROBE_MS
//   LIVE           — доставка идёт (пакеты по N событий, idempotent по PK seq)
//   DEGRADED       — постоянные ошибки доставки (backoff; курсор не двигается, локальный журнал — истина)
//
// Zero-authority: модуль только читает локальный event-log и пишет в облако; на шину,
// daemon-решения и self-update не влияет. 47-действий инвариант не трогается (вне шины).
import { Database } from "bun:sqlite";
import { tokenGet, onTokenChange } from "./tokens";

export const SQLMIRROR_SCHEMA = "me2.sqlmirror.v1";
export const SQLMIRROR_TABLE = process.env.ME2_SQL_MIRROR_TABLE || "me2_event_mirror_h205f22";
const TABLE = SQLMIRROR_TABLE; // единый источник имени (R53: использует supabase-jwt.ts)
const BATCH = Number(process.env.ME2_SQL_MIRROR_BATCH || 50);
const INTERVAL_MS = Number(process.env.ME2_SQL_MIRROR_INTERVAL_MS || 15000);
const PROBE_MS = Number(process.env.ME2_SQL_MIRROR_PROBE_MS || 600000); // 10 мин между перепробами отсутствующей таблицы
const MAX_ERR_BACKOFF_MS = 300000;

function restBase(): string {
  return process.env.ME2_SQL_MIRROR_URL || "https://xpeibufgzjknrhbhpffp.supabase.co/rest/v1";
}

/** R54: выбор креденшала записи — sb_secret (новый формат) → legacy service_role JWT → пусто. */
function pickCredential(): string {
  return tokenGet("SUPABASE_SERVICE_ROLE_JWT") || tokenGet("SUPABASE_SERVICE_ROLE_JWT_LEGACY") || "";
}

export type SqlMirrorState = "OFF" | "WARMUP" | "LIVE" | "DEGRADED";

export interface SqlMirrorStatus {
  schema: string;
  state: SqlMirrorState;
  table: string;
  configured: boolean;
  last_sent_seq: number;
  pending: number;
  batches_ok: number;
  batches_err: number;
  last_error: string | null;
  last_ok_at: number | null;
  last_probe_at: number | null;
}

export class SqlMirror {
  private key = "";
  private state: SqlMirrorState = "OFF";
  private lastError: string | null = null;
  private lastOkAt: number | null = null;
  private lastProbeAt: number | null = null;
  private lastSentSeq = 0;
  private cursorLoaded = false;
  private batchesOk = 0;
  private batchesErr = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private errUntil = 0;
  private running = false;

  constructor(private db: Database) {
    this.key = pickCredential();
    onTokenChange((name) => {
      // R54: канал записи — sb_secret (новый формат) с фолбэком на legacy service_role JWT
      // (операторский, HMAC-верифицирован против SUPABASE_JWT_SECRET; облако принимает точную
      // строку зарегистрированного ключа — пробы R54 E2/E5: 200). Оба имени валидны.
      if (name === "SUPABASE_SERVICE_ROLE_JWT" || name === "SUPABASE_SERVICE_ROLE_JWT_LEGACY") {
        this.key = pickCredential();
        this.recomputeGate();
      }
    });
  }

  get configured(): boolean {
    return process.env.ME2_SQL_MIRROR === "1" && this.key.length > 0;
  }

  private recomputeGate(): void {
    this.state = this.configured ? "WARMUP" : "OFF";
  }

  /** Последнее отражённое событие: meta 'sqlmirror_last_seq' → MAX(seq) events (первый бут). */
  private loadCursor(): void {
    this.cursorLoaded = true;
    const meta = this.db
      .query("SELECT value FROM meta WHERE key='sqlmirror_last_seq'")
      .get() as { value: string } | undefined;
    if (meta) {
      this.lastSentSeq = Number(meta.value) || 0;
      return;
    }
    // Первый бут на живой DB: зеркалим точку старта (история до контура не backfill'ится —
    // оператор решает отдельно; события после старта зеркалятся все).
    const max = this.db.query("SELECT MAX(seq) AS m FROM events").get() as { m: number | null };
    this.lastSentSeq = max.m ?? 0;
    this.saveCursor();
  }

  private saveCursor(): void {
    this.db
      .query("INSERT INTO meta (key,value) VALUES ('sqlmirror_last_seq',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(String(this.lastSentSeq));
  }

  async probeTable(): Promise<boolean> {
    this.lastProbeAt = Date.now();
    try {
      const r = await fetch(`${restBase()}/${TABLE}?select=seq&limit=1`, {
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 404 || r.status === 400) {
        // PGRST205 / relation missing — таблицы нет; не штормим (перепроба через PROBE_MS)
        this.state = "WARMUP";
        this.lastError = `table_missing_${r.status}`;
        return false;
      }
      if (!r.ok) {
        this.lastError = `probe_http_${r.status}`;
        return false;
      }
      return true;
    } catch (e) {
      this.lastError = String(e?.message || e).slice(0, 140);
      return false;
    }
  }

  /** Один цикл доставки: пакет событий > lastSentSeq → POST (idempotent по PK seq). */
  async tick(): Promise<void> {
    if (this.running || !this.configured) return;
    this.running = true;
    try {
      if (!this.cursorLoaded) this.loadCursor();
      if (this.state !== "LIVE") {
        if (this.lastProbeAt && Date.now() - this.lastProbeAt < PROBE_MS) return;
        const ok = await this.probeTable();
        if (!ok) return;
        this.lastError = null;
        this.state = "LIVE";
      }
      if (Date.now() < this.errUntil) return; // backoff после ошибок
      const rows = this.db
        .query("SELECT seq, ts, type, agent_id, task_id, data, prev_hash, hash FROM events WHERE seq > ? ORDER BY seq LIMIT ?")
        .all(this.lastSentSeq, BATCH) as Array<{
        seq: number; ts: string; type: string; agent_id: string | null; task_id: string | null; data: string | null; prev_hash: string | null; hash: string | null;
      }>;
      if (rows.length === 0) return;
      const version = (this.db.query("SELECT value FROM meta WHERE key='version'").get() as { value: string } | undefined)?.value ?? "";
      const body = rows.map((e) => ({
        seq: e.seq,
        ts: e.ts,
        type: e.type,
        actor: e.agent_id ?? "daemon",
        subject: e.task_id,
        payload: e.data ?? "{}",
        prev_hash: e.prev_hash ?? "",
        hash: e.hash ?? "",
        daemon_version: version,
      }));
      try {
        const r = await fetch(`${restBase()}/${TABLE}`, {
          method: "POST",
          headers: {
            apikey: this.key,
            Authorization: `Bearer ${this.key}`,
            "Content-Type": "application/json",
            Prefer: "resolution=ignore-duplicates,return=minimal",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          this.batchesErr += 1;
          this.lastError = `insert_http_${r.status}:${text.slice(0, 100)}`;
          this.state = this.batchesErr >= 3 ? "DEGRADED" : this.state;
          this.errUntil = Date.now() + Math.min(5000 * this.batchesErr, MAX_ERR_BACKOFF_MS);
          return;
        }
        this.batchesOk += 1;
        this.lastSentSeq = rows[rows.length - 1].seq;
        this.saveCursor();
        this.lastOkAt = Date.now();
        this.lastError = null;
        this.state = "LIVE";
        this.batchesErr = 0;
      } catch (e) {
        this.batchesErr += 1;
        this.lastError = String(e?.message || e).slice(0, 140);
        this.errUntil = Date.now() + Math.min(5000 * this.batchesErr, MAX_ERR_BACKOFF_MS);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * R54: read-прокси (канал service_proxy) — daemon сам читает зеркало через service-креденшал.
   * Честный режим: UI НЕ получает service-ключ (утечки нет), но и RLS-гейт так не демонстрируется —
   * панель обязана маркировать это словами. Read-only SELECT, вне шины (47-инвариант не тронут).
   */
  async readFeed(limit = 50): Promise<
    | { ok: true; channel: "service_proxy"; table: string; rows: Array<Record<string, unknown>>; mirror_state: SqlMirrorState }
    | { ok: false; channel: "service_proxy"; table: string; error: string; http?: number; mirror_state: SqlMirrorState }
  > {
    const n = Math.max(1, Math.min(Number(limit) || 50, 200));
    const state = this.configured ? this.state : "OFF";
    if (!this.key) return { ok: false, channel: "service_proxy", table: TABLE, error: "no_service_credential", mirror_state: state };
    try {
      const r = await fetch(`${restBase()}/${TABLE}?select=seq,ts,type,actor,subject&order=seq.desc&limit=${n}`, {
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text();
      if (!r.ok) {
        return { ok: false, channel: "service_proxy", table: TABLE, http: r.status,
                 error: r.status === 404 || r.status === 400 ? "table_missing_ddl_pending" : `http_${r.status}:${text.slice(0, 100)}`,
                 mirror_state: state };
      }
      let rows: Array<Record<string, unknown>>;
      try { rows = JSON.parse(text); } catch { return { ok: false, channel: "service_proxy", table: TABLE, error: "bad_json", mirror_state: state }; }
      return { ok: true, channel: "service_proxy", table: TABLE, rows: Array.isArray(rows) ? rows : [], mirror_state: state };
    } catch (e) {
      return { ok: false, channel: "service_proxy", table: TABLE, error: String(e?.message || e).slice(0, 140), mirror_state: state };
    }
  }

  start(): void {
    this.recomputeGate();
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  status(): SqlMirrorStatus {
    let pending = 0;
    if (this.configured && this.cursorLoaded) {
      pending = (this.db.query("SELECT COUNT(*) AS n FROM events WHERE seq > ?").get(this.lastSentSeq) as { n: number }).n;
    }
    return {
      schema: SQLMIRROR_SCHEMA,
      state: this.configured ? this.state : "OFF",
      table: TABLE,
      configured: this.configured,
      last_sent_seq: this.lastSentSeq,
      pending,
      batches_ok: this.batchesOk,
      batches_err: this.batchesErr,
      last_error: this.lastError,
      last_ok_at: this.lastOkAt,
      last_probe_at: this.lastProbeAt,
    };
  }
}
