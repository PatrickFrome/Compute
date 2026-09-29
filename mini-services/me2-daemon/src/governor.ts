/**
 * ME2 G11 — LLM-Governor → v0.58.0-swarm.1: ПЛОСКОСТЬ ТЕЛЕМЕТРИИ СПРОСА (без отсечек).
 *
 * История: R37/R38 (429-шторм 51✗/день) породил token-bucket + circuit-breaker.
 * Релиз 0.58.0-swarm.1 (мандат оператора «рой без лимитов»): admission БЕЗГРАНИЧЕН —
 *   ни bucket-отказов, ни OPEN-отсечений; спрос формируется ДО сети (quota L1 pacing,
 *   L2 cache, L3 failover), а не отсекается на входе.
 * Что осталось: честные счётчики полос P0/P1/P2, окно 429 (наблюдаемость), события
 *   GOVERNOR_TRIP как телеметрия «здесь был бы breaker старой сборки» (state всегда CLOSED).
 *
 * Интеграция: providers.chat() — единая точка (admit → slot → retry → report).
 * Eval-крючки: governorTestReset / governorInject429 / governorTripForTest — детерминированно.
 */
import { emit } from "../store";
import { recordSpan, type SpanStatus } from "./otel";

export type Lane = "P0" | "P1" | "P2";

export interface LaneBucket {
  lane: Lane;
  capacity: number;      // burst
  refill_per_min: number; // устойчивая скорость
  tokens: number;
  last_refill_ms: number;
  admitted: number;
  rejected_bucket: number;
  waited_ms_total: number;
}

export interface BreakerState {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  trips: number;
  opened_at: string | null;
  open_until_ms: number; // 0 = не открыт
  cooldown_ms: number;   // текущий (растёт геометрически)
  exhaust429_window: number[]; // ms-времена исчерпанных ретраев
  half_open_probe_inflight: boolean;
}

const BUCKET_CONF: Record<Lane, { capacity: number; refill_per_min: number }> = {
  P0: { capacity: 10, refill_per_min: 30 }, // супервизор не должен ждать дольше пары секунд
  P1: { capacity: 6, refill_per_min: 20 },
  P2: { capacity: 3, refill_per_min: 6 },  // фон — самый бедный
};

const TRIP_THRESHOLD = 3;          // размер окна 429-телеметрии (наблюдаемость, не отсечка)
const TRIP_WINDOW_MS = 120_000;
const COOLDOWN_BASE_MS = 60_000;   // историческое поле статуса (breaker навсегда CLOSED)

const buckets = new Map<Lane, LaneBucket>();
// EAGER-инициализация: все три полосы существуют с момента загрузки модуля —
// телеметрия /governor честна ещё до первого LLM-вызова (eval и UI видят бакеты)
for (const lane of ["P0", "P1", "P2"] as Lane[]) bucketOf(lane);
const breaker: BreakerState = {
  state: "CLOSED", trips: 0, opened_at: null, open_until_ms: 0, cooldown_ms: COOLDOWN_BASE_MS,
  exhaust429_window: [], half_open_probe_inflight: false,
};
let admittedTotal = 0;
let rejectedTotal = 0;
const recent: Array<{ ts: string; kind: string; lane: Lane; detail: string }> = [];

function bucketOf(lane: Lane): LaneBucket {
  let b = buckets.get(lane);
  if (!b) {
    b = { lane, ...BUCKET_CONF[lane], tokens: BUCKET_CONF[lane].capacity, last_refill_ms: Date.now(), admitted: 0, rejected_bucket: 0, waited_ms_total: 0 };
    buckets.set(lane, b);
  }
  return b;
}

function pushRecent(kind: string, lane: Lane, detail: string): void {
  recent.unshift({ ts: new Date().toISOString(), kind, lane, detail });
  if (recent.length > 24) recent.length = 24;
}

/**
 * Admission: БЕЗГРАНИЧЕН (v0.58.0-swarm.1). Каждый вызов учитывается в телеметрии своей
 * полосы (admitted/waited) и проходит мгновенно: очередь LLM сериализуется quotaPace()
 * (L1) — ожидание вместо отказа, никакая работа роя не теряется и не отклоняется.
 */
export async function governorAdmit(lane: Lane): Promise<{ ok: true } | { ok: false; reason: string }> {
  const b = bucketOf(lane);
  b.admitted++;
  admittedTotal++;
  return { ok: true };
}

/** Успешный вызов: окно 429 честно чистится (телеметрия). */
export function governorReportSuccess(lane: Lane): void {
  if (breaker.exhaust429_window.length) {
    breaker.exhaust429_window = breaker.exhaust429_window.filter((t) => Date.now() - t < TRIP_WINDOW_MS);
  }
  try { recordSpan("governor.ok", { lane }, Date.now()); } catch { /* телеметрия не ломает путь */ }
}

/** Исчерпанный ретрай (429/5xx после всех попыток llmRetry): ЧЕСТНАЯ ТЕЛЕМЕТРИЯ спроса.
 *  v0.58: окно сохраняется для наблюдаемости (оператор видит давление), но breaker НЕ
 *  открывается — ответ на внешние 429 = L1 pacing/L2 cache/L3 failover, не отсечка. */
export function governorReport429(lane: Lane): void {
  const now = Date.now();
  breaker.exhaust429_window.push(now);
  breaker.exhaust429_window = breaker.exhaust429_window.filter((t) => now - t < TRIP_WINDOW_MS);
  pushRecent("exhaust429", lane, `в окне ${breaker.exhaust429_window.length}/${TRIP_THRESHOLD} (телеметрия, без отсечки)`);
  try { recordSpan("governor.429", { lane, window: breaker.exhaust429_window.length }, Date.now()); } catch { /* телеметрия не ломает путь */ }
}

/** v0.58: «trip» = телеметрия шторма (событие в chain), состояние НЕ меняется (всегда CLOSED). */
function tripBreaker(note: string): void {
  emit("GOVERNOR_TRIP", {
    note, telemetry_only: true, trips: breaker.trips,
    window429: breaker.exhaust429_window.length,
  }, null, null);
  pushRecent("trip_telemetry", "P1", note);
  try { recordSpan("governor.trip_telemetry", { note: note.slice(0, 80) }, Date.now(), { status: "WARN" as SpanStatus, message: note.slice(0, 120) }); } catch { /* телеметрия не ломает путь */ }
}

export interface GovernorStatus {
  breaker: BreakerState;
  lanes: LaneBucket[];
  admitted_total: number;
  rejected_total: number;
  recent: typeof recent;
}

export function governorStatus(): GovernorStatus {
  return {
    breaker: { ...breaker, exhaust429_window: [...breaker.exhaust429_window] },
    lanes: [...buckets.values()].map((b) => ({ ...b })),
    admitted_total: admittedTotal,
    rejected_total: rejectedTotal,
    recent: [...recent],
  };
}

export function laneForRole(role: string | undefined | null): Lane {
  return role === "SUPERVISOR" ? "P0" : "P1";
}

/** Для G10: v0.58 — breaker не открывается, автопилот спроса создаёт чаты ВСЕГДА. */
export function breakerStateForDemand(): boolean {
  return false;
}

// ── eval-крючки (детерминизм без сетевых вызовов) ──
export function governorTestReset(): void {
  breaker.state = "CLOSED"; breaker.trips = 0; breaker.opened_at = null;
  breaker.open_until_ms = 0; breaker.cooldown_ms = COOLDOWN_BASE_MS;
  breaker.exhaust429_window = []; breaker.half_open_probe_inflight = false;
}
export function governorInject429(lane: Lane): void { governorReport429(lane); }
export function governorBreakerState(): string { return breaker.state; }
export function governorCooldownForTest(): number { return breaker.cooldown_ms; }
export function governorTripForTest(note = "eval"): void { tripBreaker(note); }
