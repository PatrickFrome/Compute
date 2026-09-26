/**
 * ME2 Quota-Resilience Layer (v0.57.0) — ответ на вопрос оператора
 * «можем ли мы сделать LLM так, чтобы никогда не упираться в квоту».
 *
 * Честная инженерная позиция: против внешнего провайдера «никогда» не обещает никто —
 * квота принадлежит апстриму. Но система строится так, чтобы квота ПРАКТИЧЕСКИ
 * НЕ ОСТАНАВЛИВАЛА работу — четыре уровня защиты:
 *
 *   L1 PACING   — глобальный min-gap между СТАРТАМИ LLM-вызовов (шторм не рождается:
 *                 429 предотвращается формированием спроса, а не лечится ретраями).
 *   L2 CACHE    — дедуп детерминированных промптов (opt-in opts.cache, напр. ревью с
 *                 temperature=0): одинаковый запрос → ответ из SQLite llm_cache,
 *                 квота не тратится; hits/misses считаются честно.
 *   L3 FAILOVER — цепочка провайдеров zai ↔ gateway (Vercel AI Gateway, ключ из vault
 *                 R47): исчерпанный 429 первичного → автоматический переход на
 *                 альтернативу (LLM_FAILOVER в hash-chain).
 *   L4 PARK     — park-and-resume для задач: квотная ошибка (429/governor_open) НЕ
 *                 убивает задачу (FAILED был терминальным — R71 сценарий A), а паркует
 *                 её в READY с not_before_ms: master-loop не видит до срока, задача
 *                 доживает до окна квоты. Бюджет PARK_MAX → после — честный FAILED.
 *
 * Легальность: мы НЕ обходим квоту платформы — мы формируем спрос, дедуплицируем
 * работу, используем второй легальный канал и переносим спрос во времени.
 * Governor (G11) остаётся арбитром полос: breaker OPEN → задачи ПАРКУЮТСЯ, а не умирают.
 *
 * Интеграция: providers.chat() (pace/cache/failover), worker.ts (park), GET /llm (статус),
 * eval llm.* (регресс dataset v30).
 */
import { createHash } from "node:crypto";
import { db, emit, updateTask } from "../store";
import { recordSpan, type SpanStatus } from "./otel";

// ── схема: кэш персистентен (переживает рестарт — дедуп не теряется) ──
db.exec(`
CREATE TABLE IF NOT EXISTS llm_cache (
  hash TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT
);
`);

// ───────────────────────── L1: PACING ─────────────────────────
const MIN_GAP_MS = Math.max(0, Number(process.env.ME2_LLM_MIN_GAP_MS ?? 800));
let lastStart = 0;
let paceChain: Promise<void> = Promise.resolve();

/** Глобальный min-gap между стартами LLM-вызовов. Сериализован цепочкой промисов:
 *  каждый вызывающий резервирует свой слот старта ≥ MIN_GAP_MS от предыдущего —
 *  очередь конкурентности llmSlot() размывает burst'ы ещё до сети. */
export function quotaPace(): Promise<void> {
  const next = paceChain.then(async () => {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
  });
  paceChain = next.catch(() => { /* цепочка не рвётся */ });
  return next;
}

// ───────────────────────── L2: CACHE ─────────────────────────
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.ME2_LLM_CACHE_TTL_MS ?? 86_400_000));
const CACHE_CAP = Math.max(50, Number(process.env.ME2_LLM_CACHE_CAP ?? 500));
let cacheHits = 0;
let cacheMisses = 0;

/** Ключ кэша: модель + temperature + точные сообщения (sha256). */
export function quotaCacheKey(model: string, messages: unknown, temperature?: number): string {
  return createHash("sha256").update(`${model}\u0000${temperature ?? ""}\u0000${JSON.stringify(messages)}`).digest("hex");
}

export function quotaCacheGet(key: string): string | null {
  const row = db.query(`SELECT response, created_at FROM llm_cache WHERE hash=?`).get(key) as { response: string; created_at: number } | undefined;
  if (!row) { cacheMisses++; return null; }
  if (Date.now() - row.created_at > CACHE_TTL_MS) {
    try { db.query(`DELETE FROM llm_cache WHERE hash=?`).run(key); } catch { /* самоочистка не критична */ }
    cacheMisses++;
    return null;
  }
  cacheHits++;
  try { db.query(`UPDATE llm_cache SET hits=hits+1, last_hit_at=? WHERE hash=?`).run(new Date().toISOString(), key); } catch { /* телеметрия не критична */ }
  return row.response;
}

export function quotaCachePut(key: string, model: string, response: string): boolean {
  try {
    db.query(`INSERT OR REPLACE INTO llm_cache (hash,model,response,created_at,hits,last_hit_at) VALUES (?,?,?,?,0,NULL)`)
      .run(key, model, response.slice(0, 32_000), Date.now());
    // cap: держим последние CACHE_CAP записей (детерминированные промпты — рабочее множество)
    db.query(`DELETE FROM llm_cache WHERE hash NOT IN (SELECT hash FROM llm_cache ORDER BY created_at DESC LIMIT ?)`).run(CACHE_CAP);
    return true;
  } catch { return false; }
}

// ───────────────────────── L3: FAILOVER (счётчики; цепочка — в providers.ts) ─────────────────────────
let failoverTotal = 0;
let failoverLast: { from: string; to: string; error: string; at: string } | null = null;

export function quotaFailover(from: string, to: string, error: string): void {
  failoverTotal++;
  failoverLast = { from, to, error: error.slice(0, 160), at: new Date().toISOString() };
  emit("LLM_FAILOVER", failoverLast, null, null);
  try { recordSpan("llm.failover", { "me2.from": from, "me2.to": to }, Date.now(), { status: "WARN" as SpanStatus, message: error.slice(0, 120) }); } catch { /* телеметрия не ломает путь */ }
}

// ───────────────────────── L4: PARK-AND-RESUME ─────────────────────────
export const PARK_MAX = Math.max(1, Number(process.env.ME2_TASK_PARK_MAX ?? 8));
const PARK_BASE_S = Math.max(5, Number(process.env.ME2_TASK_PARK_BASE_S ?? 45));
const PARK_CAP_S = Math.max(PARK_BASE_S, Number(process.env.ME2_TASK_PARK_CAP_S ?? 600));

// v0.57.0: паркуемые инфра-сбои = квота/перегрузка (429, governor) + транзиентные сетевые
// отказы провайдера (TLS/fetch/socket — задача не виновата, дожидается восстановления).
// НЕ парковаются только честные ошибки задачи (path_escape, max_steps, protocol...).
const QUOTA_RE = /\b429\b|too many requests|rate limit|retry-after|quota|certificate verification|fetch failed|econnrefused|etimedout|econnreset|socket hang up|unexpected eof/i;
const GOVERNOR_RE = /governor_open|governor_bucket_empty|governor_half_open|governor_probe_inflight/;

/** Квотная/перегрузочная ошибка (паркуема) vs прочие (честный FAILED без переносов). */
export function isQuotaError(msg: string): boolean {
  return QUOTA_RE.test(msg) || GOVERNOR_RE.test(msg);
}

/** Задержка парка: растёт с номером попытки (45с → 90с → …), cap 10м (окно квоты
 *  внешнее — приспосабливаемся, но не ждём вечно) + jitter против синхронных волн. */
export function parkDelayMs(parkCount: number): number {
  const d = Math.min(PARK_CAP_S, PARK_BASE_S * (1 + Math.max(0, parkCount))) * 1000;
  return d + Math.floor(Math.random() * 5_000);
}

/** Парк квотной задачи: READY + not_before_ms (master-loop не видит до срока) +
 *  park_count+1. НЕ пишет reflection (это не провал спецификации — это ожидание квоты). */
export function parkTaskQuota(taskId: string, parkCount: number, errMsg: string, agentId: string | null): { park_no: number; delay_s: number; until_ms: number } {
  const parkNo = Math.max(0, Math.floor(parkCount)) + 1;
  const delay = parkDelayMs(parkCount);
  const until = Date.now() + delay;
  updateTask(taskId, { status: "READY", not_before_ms: until, park_count: parkNo, agent_id: null });
  emit("TASK_PARKED", {
    task_id: taskId, park_no: parkNo, park_max: PARK_MAX,
    delay_s: Math.round(delay / 1000), reason: errMsg.slice(0, 140),
  }, agentId, taskId);
  try { recordSpan("quota.park", { "me2.task_id": taskId, "me2.park_no": parkNo, "me2.delay_s": Math.round(delay / 1000) }, Date.now()); } catch { /* телеметрия не ломает путь */ }
  return { park_no: parkNo, delay_s: Math.round(delay / 1000), until_ms: until };
}

// ───────────────────────── статус GET /llm ─────────────────────────
export function llmQuotaStatus() {
  const entries = (db.query(`SELECT COUNT(*) c FROM llm_cache`).get() as { c: number }).c;
  const hitsTotal = (db.query(`SELECT COALESCE(SUM(hits),0) c FROM llm_cache`).get() as { c: number }).c;
  const activeParks = (db.query(`SELECT COUNT(*) c FROM tasks WHERE status='READY' AND COALESCE(not_before_ms,0)>?`).get(Date.now()) as { c: number }).c;
  const parksTotal = (db.query(`SELECT COUNT(*) c FROM events WHERE type='TASK_PARKED'`).get() as { c: number }).c;
  const sessions = cacheHits + cacheMisses;
  return {
    ok: true,
    pacing: { min_gap_ms: MIN_GAP_MS },
    cache: {
      entries, cap: CACHE_CAP, ttl_ms: CACHE_TTL_MS, hits_total: hitsTotal,
      session_hits: cacheHits, session_misses: cacheMisses,
      hit_rate: sessions ? Math.round((cacheHits / sessions) * 100) / 100 : null,
    },
    failover: { total: failoverTotal, last: failoverLast },
    park: { max: PARK_MAX, active: activeParks, total_events: parksTotal, base_s: PARK_BASE_S, cap_s: PARK_CAP_S },
  };
}

// ── eval-хук: сброс in-memory счётчиков (детерминизм без сети) ──
export function quotaTestResetCounters(): void {
  cacheHits = 0; cacheMisses = 0; failoverTotal = 0; failoverLast = null;
}
