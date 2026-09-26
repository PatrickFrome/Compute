/**
 * ME2 G11 — LLM-Governor: полосы приоритета + token bucket + circuit breaker.
 *
 * Проблема (живой инцидент R37/R38 + пользователь: «никогда не упираться в лимиты»):
 *   429-шторм — супервизор-тики, ходы чатов, компакции, рефлексии и ревью бьют в LLM
 *   одновременно; llmRetry честно ретраит, но шторм сам себя амплифицирует:
 *   51✗ подряд в один день (liveness-телеметрия R38: budget=BREACH).
 *
 * Решение (легально: мы не обходим квоту платформы — мы ЧЕСТНО формируем спрос):
 *   1. Полосы приоритета: P0 (супервизоры флота) > P1 (ходы чатов, worker) > P2 (фон:
 *      компакция/брейн/ревью/RSI). У каждой полосы свой token bucket — спрос фоновой
 *      полосы физически не может вытеснить супервизора.
 *   2. Circuit breaker: N исчерпанных ретраев (429/5xx) за окно → OPEN (fast-fail без
 *      бесполезных сетевых попыток — шторм гасится, а не амплифицируется) → HALF_OPEN
 *      (пропускаем только P0-пробу) → успех → CLOSED. Cooldown растёт геометрически
 *      (60с → 120с → …, cap 10м) — честная приспособляемость к платформенному окну.
 *   3. Телеметрия: GOVERNOR_TRIP / GOVERNOR_RECOVER события в hash-chain, span'ы,
 *      GET /governor — супервизор и оператор видят, ПОЧЕМУ LLM-вызов отклонён.
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

const TRIP_THRESHOLD = 3;          // исчерпанных ретраев за окно → OPEN
const TRIP_WINDOW_MS = 120_000;
const COOLDOWN_BASE_MS = 60_000;
const COOLDOWN_CAP_MS = 600_000;
const BUCKET_WAIT_CAP_MS = 20_000; // ждём токен, но не вечно (fast-fail лучше зависания)

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

function refill(b: LaneBucket): void {
  const now = Date.now();
  const rate = b.refill_per_min / 60_000;
  const add = Math.floor((now - b.last_refill_ms) * rate);
  if (add > 0) {
    b.tokens = Math.min(b.capacity, b.tokens + add);
    b.last_refill_ms = now;
  }
}

function pushRecent(kind: string, lane: Lane, detail: string): void {
  recent.unshift({ ts: new Date().toISOString(), kind, lane, detail });
  if (recent.length > 24) recent.length = 24;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** Пропускная проверка без ожидания: токен есть? (для fast-fail в OPEN) */
function tryTake(b: LaneBucket): boolean {
  refill(b);
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
  return false;
}

/**
 * Admission: ждёт токен своей полосы (bucket) + уважает circuit breaker.
 * P0 в HALF_OPEN проходит как проба; P1/P2 в OPEN/HALF_OPEN — честный fast-fail.
 */
export async function governorAdmit(lane: Lane): Promise<{ ok: true } | { ok: false; reason: string }> {
  const now = Date.now();
  if (breaker.state === "OPEN") {
    if (now < breaker.open_until_ms) {
      rejectedTotal++;
      pushRecent("reject_open", lane, `breaker OPEN ещё ${(breaker.open_until_ms - now) / 1000 | 0}с`);
      return { ok: false, reason: `governor_open (${Math.ceil((breaker.open_until_ms - now) / 1000)}s)` };
    }
    // окно истекло → HALF_OPEN: пропускаем только P0-пробу
    breaker.state = "HALF_OPEN";
    breaker.half_open_probe_inflight = false;
    emit("GOVERNOR_EVENT", { state: "HALF_OPEN", note: "cooldown истёк, ждём P0-пробу" }, null, null);
    pushRecent("half_open", lane, "cooldown истёк");
  }
  if (breaker.state === "HALF_OPEN") {
    if (lane !== "P0") {
      rejectedTotal++;
      pushRecent("reject_halfopen", lane, "пропускаем только P0-пробу");
      return { ok: false, reason: "governor_half_open_probe" };
    }
    if (breaker.half_open_probe_inflight) {
      rejectedTotal++;
      return { ok: false, reason: "governor_probe_inflight" };
    }
    breaker.half_open_probe_inflight = true;
    return { ok: true };
  }
  // CLOSED: bucket (P0 при пустом бакете ждёт до cap, потом форс — супервизор важнее бакета)
  const b = bucketOf(lane);
  const t0 = Date.now();
  while (!tryTake(b)) {
    if (lane === "P0" && Date.now() - t0 >= 3_000) { b.tokens -= 0; break; } // форс-проход P0
    if (Date.now() - t0 >= BUCKET_WAIT_CAP_MS) {
      b.rejected_bucket++;
      rejectedTotal++;
      pushRecent("reject_bucket", lane, `нет токена ${BUCKET_WAIT_CAP_MS / 1000}с`);
      return { ok: false, reason: "governor_bucket_empty" };
    }
    await sleep(250);
  }
  const waited = Date.now() - t0;
  b.waited_ms_total += waited;
  b.admitted++;
  admittedTotal++;
  return { ok: true };
}

/** Успешный вызов: в HALF_OPEN закрывает breaker; сбрасывает окно 429. */
export function governorReportSuccess(lane: Lane): void {
  if (breaker.state === "HALF_OPEN") {
    breaker.state = "CLOSED";
    breaker.cooldown_ms = COOLDOWN_BASE_MS;
    breaker.exhaust429_window = [];
    breaker.half_open_probe_inflight = false;
    breaker.opened_at = null;
    breaker.open_until_ms = 0;
    emit("GOVERNOR_EVENT", { state: "CLOSED", note: "P0-проба успешна, breaker закрыт" }, null, null);
    pushRecent("closed", lane, "проба успешна");
    try { recordSpan("governor.recover", { lane }, Date.now()); } catch { /* телеметрия не ломает путь */ }
  } else if (breaker.exhaust429_window.length) {
    breaker.exhaust429_window = breaker.exhaust429_window.filter((t) => Date.now() - t < TRIP_WINDOW_MS);
  }
}

/** Исчерпанный ретрай (429/5xx после всех попыток llmRetry): питает breaker. */
export function governorReport429(lane: Lane): void {
  const now = Date.now();
  breaker.exhaust429_window.push(now);
  breaker.exhaust429_window = breaker.exhaust429_window.filter((t) => now - t < TRIP_WINDOW_MS);
  pushRecent("exhaust429", lane, `в окне ${breaker.exhaust429_window.length}/${TRIP_THRESHOLD}`);
  if (breaker.state === "HALF_OPEN") {
    tripBreaker("проба в HALF_OPEN упала");
    return;
  }
  if (breaker.state === "CLOSED" && breaker.exhaust429_window.length >= TRIP_THRESHOLD) {
    tripBreaker(`${breaker.exhaust429_window.length} исчерпанных 429/5xx за ${TRIP_WINDOW_MS / 1000}с`);
  }
}

function tripBreaker(note: string): void {
  breaker.state = "OPEN";
  breaker.trips++;
  breaker.opened_at = new Date().toISOString();
  breaker.open_until_ms = Date.now() + breaker.cooldown_ms;
  breaker.half_open_probe_inflight = false;
  emit("GOVERNOR_TRIP", {
    note, trips: breaker.trips, cooldown_s: breaker.cooldown_ms / 1000,
    window429: breaker.exhaust429_window.length,
  }, null, null);
  try { recordSpan("governor.trip", { note: note.slice(0, 80) }, Date.now(), { status: "ERROR" as SpanStatus, message: note.slice(0, 120) }); } catch { /* телеметрия не ломает путь */ }
  pushRecent("OPEN", "P1", note);
  breaker.cooldown_ms = Math.min(COOLDOWN_CAP_MS, breaker.cooldown_ms * 2); // следующий — длиннее
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

/** Для G10: открытие брейкера = «LLM сейчас нет ни у кого» — автопилот откладывает создание. */
export function breakerStateForDemand(): boolean {
  return breaker.state === "OPEN" || breaker.state === "HALF_OPEN";
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
