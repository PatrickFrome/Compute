/**
 * ME2 daemon — performance baselines (R25, пункт B3 из research/2026/R24-AUDIT-ROADMAP.md §7).
 *
 * Зачем: R24-критика — «ресёрч обязан закрываться измерениями, а не файлами», а у ME2
 * не было НИ ОДНОЙ собственной перф-метрики: ни p95 REST, ни латентности sense-act,
 * ни бюджета памяти obsv, ни boot-time. «Оптимизация» (Track D) без базовых линий —
 * слепое пятно. Это честный инструмент:
 *
 *  - скользящие гистограммы латентности по зондам (rest / sense / sense_act) в памяти;
 *  - p50/p95/p99/max/n — по отсортированному кольцу (ring 512 на зонд, дешёвая арифметика);
 *  - память: RSS процесса + оценка obsv-буферов (по капам колец, не по JSON-сериализации);
 *  - boot-длительность: BOOT_T0 → момент, когда REST начал принимать соединения;
 *  - ПОРОГИ из роадмапа: REST p95 <50ms, ACT p95 <2000ms, obsv <50MB, boot <5000ms;
 *  - вердикт только на достаточной выборке (n ≥ 5) — нет самовольных WORKS на пустых данных.
 *
 * REST-роут GET /bench вне шины (47/47 инвариант). Механика ME20.
 */

export type BenchProbe = "rest" | "rest_admin" | "rest_browser" | "sense" | "sense_act";

import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mcpStatus } from "./mcp";

const RING_CAP = 512;
// R70 (аудит §18, честные базовые линии): кольцо — размерное, но при низком трафике
// burst-выброс (sweep/нагрузка/eval-батч) держит p95 ложно высоким ЧАСАМИ — образцы
// не дренируются. Фикс: возрастное отбрасывание (STALE_MS) при наблюдении И при чтении —
// p95 всегда описывает свежее окно, а не историю всплесков.
const STALE_MS = 600_000;
// B3-уточнение (R35): сэмплы boot-окна (первые 10с — JIT/первое соединение/флеш outbox)
// идут в ОТДЕЛЬНОЕ холодное кольцо: они меряют прогрев, а не стационарный p95 сервиса.
// Иначе пара холодных сэмплов вечно держит p95 над порогом (ложный FAIL после рестарта).
const COLD_WINDOW_MS = 10_000;
const COLD_CAP = 64;
// (ts, ms) — пары для возрастной выбраковки
const rings = new Map<BenchProbe, Array<{ ts: number; ms: number }>>();
const coldRings = new Map<BenchProbe, Array<{ ts: number; ms: number }>>();

/** Наблюдение латентности (ms). Вызывается из горячего пути — O(1) амортизированно. */
// R62: замер приостанавливается на время тяжёлых in-process батчей (evalRun) — иначе
// очередь запросов в момент батча пишется в кольцо как «медленные» сэмплы и вечно
// портит p95 (узор исключения бутстрапа/батча из замера, канон практик нагрузочного теста).
let benchSuspended = false;
export function benchSuspend(on: boolean): void { benchSuspended = on; }
/** R62: дренаж колец — свежее окно измерения на каждый eval-прогон. */
export function benchResetRings(): void { rings.clear(); coldRings.clear(); }

export function benchObserve(probe: BenchProbe, ms: number): void {
  if (benchSuspended) return;
  if (!Number.isFinite(ms) || ms < 0) return;
  const v = Math.round(ms);
  const now = Date.now();
  if (now - bootT0 < COLD_WINDOW_MS) {
    let cr = coldRings.get(probe);
    if (!cr) { cr = []; coldRings.set(probe, cr); }
    if (cr.length >= COLD_CAP) cr.shift();
    cr.push({ ts: now, ms: v });
    return;
  }
  let ring = rings.get(probe);
  if (!ring) { ring = []; rings.set(probe, ring); }
  if (ring.length >= RING_CAP) ring.shift();
  ring.push({ ts: now, ms: v });
}

/** R70: выбраковка образцов старше STALE_MS (кольцо = свежее окно, не история всплесков). */
function prune(ring: Array<{ ts: number; ms: number }>): Array<{ ts: number; ms: number }> {
  const cutoff = Date.now() - STALE_MS;
  let i = 0;
  while (i < ring.length && ring[i].ts < cutoff) i++;
  return i > 0 ? ring.slice(i) : ring;
}

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface BenchStats {
  n: number; p50: number | null; p95: number | null; p99: number | null; max: number | null;
}

function statsOf(probe: BenchProbe): BenchStats {
  const ring = prune(rings.get(probe) ?? []);
  const sorted = ring.map((s) => s.ms).sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

function statsOfCold(probe: BenchProbe): BenchStats {
  const ring = prune(coldRings.get(probe) ?? []);
  const sorted = ring.map((s) => s.ms).sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

// ── boot ──────────────────────────────────────────────────────────
let bootT0 = Date.now();
let bootDoneMs: number | null = null;
/** Отметить «REST принимает соединения» (вызывается из restServer.listen колбэка). */
export function benchBootStart(t0: number): void { if (bootDoneMs === null) bootT0 = t0; }
export function benchBootDone(): void { if (bootDoneMs === null) bootDoneMs = Date.now() - bootT0; }

// ── память ────────────────────────────────────────────────────────
function memSnapshot(): {
  rss_mb: number; heap_mb: number; obsv_est_mb: number; sqlite_mb: number;
} {
  const mu = process.memoryUsage();
  // obsv: три кольца с известными капами + pending map — оценка по верхним границам
  // (записи ≈ net 480B / con 440B / exc 420B с учётом URL_MAX=300/TEXT_MAX=400).
  const OBSV_EST = ((400 * 480) + (250 * 440) + (120 * 420)) / (1024 * 1024);
  let sqliteMb = 0;
  try {
    const dbPath = fileURLToPath(new URL("../data/me2.db", import.meta.url));
    sqliteMb = Math.round((statSync(dbPath).size / (1024 * 1024)) * 10) / 10;
  } catch { /* db-файл может отсутствовать при cold start */ }
  return {
    rss_mb: Math.round((mu.rss / (1024 * 1024)) * 10) / 10,
    heap_mb: Math.round((mu.heapUsed / (1024 * 1024)) * 10) / 10,
    obsv_est_mb: Math.round(OBSV_EST * 100) / 100,
    sqlite_mb: sqliteMb,
  };
}

// ── пороги + вердикт (B3 §7 роадмапа) ─────────────────────────────
export const BENCH_THRESHOLDS = {
  rest_p95_ms: 50,
  act_p95_ms: 2000,
  obsv_max_mb: 50,
  boot_max_ms: 5000,
  min_samples: 5,
};

export interface BenchReport {
  ok: true;
  probes: { rest: BenchStats; rest_admin: BenchStats; rest_browser: BenchStats; sense: BenchStats; sense_act: BenchStats; cold_rest: BenchStats };
  memory: ReturnType<typeof memSnapshot>;
  boot_ms: number | null;
  thresholds: typeof BENCH_THRESHOLDS;
  verdict: "PASS" | "WARMUP" | "FAIL";
  fails: string[];
  mcp: ReturnType<typeof mcpStatus>;
}

export function benchSnapshot(): BenchReport {
  const rest = statsOf("rest");
  const rest_admin = statsOf("rest_admin");
  const rest_browser = statsOf("rest_browser");
  const sense = statsOf("sense");
  const sense_act = statsOf("sense_act");
  const memory = memSnapshot();
  const fails: string[] = [];
  if (rest.n >= BENCH_THRESHOLDS.min_samples && (rest.p95 ?? 0) > BENCH_THRESHOLDS.rest_p95_ms)
    fails.push(`rest_p95=${rest.p95}ms>${BENCH_THRESHOLDS.rest_p95_ms}`);
  if (sense_act.n >= BENCH_THRESHOLDS.min_samples && (sense_act.p95 ?? 0) > BENCH_THRESHOLDS.act_p95_ms)
    fails.push(`act_p95=${sense_act.p95}ms>${BENCH_THRESHOLDS.act_p95_ms}`);
  if (memory.obsv_est_mb > BENCH_THRESHOLDS.obsv_max_mb)
    fails.push(`obsv_est=${memory.obsv_est_mb}MB>${BENCH_THRESHOLDS.obsv_max_mb}`);
  if (bootDoneMs !== null && bootDoneMs > BENCH_THRESHOLDS.boot_max_ms)
    fails.push(`boot=${bootDoneMs}ms>${BENCH_THRESHOLDS.boot_max_ms}`);
  const measured = rest.n >= BENCH_THRESHOLDS.min_samples; // rest — самый частотный зонд
  return {
    ok: true,
    probes: { rest, rest_admin, rest_browser, sense, sense_act, cold_rest: statsOfCold("rest") },
    memory,
    boot_ms: bootDoneMs,
    thresholds: BENCH_THRESHOLDS,
    verdict: !measured ? "WARMUP" : fails.length ? "FAIL" : "PASS",
    fails,
    mcp: mcpStatus(),
  };
}

/** Вердикт для механики ME20: WORKS только на реальных измерениях в рамках порогов. */
export function benchVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  const r = benchSnapshot();
  if (r.verdict === "WARMUP") {
    return { verdict: "CAVEAT", evidence: `WARMUP: rest_n=${r.probes.rest.n}<${BENCH_THRESHOLDS.min_samples}; GET /bench` };
  }
  const ev =
    `rest p50/p95=${r.probes.rest.p50}/${r.probes.rest.p95}ms (n=${r.probes.rest.n}, cold-boot отдельно: n=${r.probes.cold_rest.n} p95=${r.probes.cold_rest.p95 ?? "—"}ms), ` +
    `admin p95=${r.probes.rest_admin.p95 ?? "—"}ms (n=${r.probes.rest_admin.n}, без порога), ` +
    `browser p95=${r.probes.rest_browser.p95 ?? "—"}ms (n=${r.probes.rest_browser.n}, CLI-шеллы, без порога), ` +
    `act p95=${r.probes.sense_act.p95 ?? "—"}ms (n=${r.probes.sense_act.n}), ` +
    `rss=${r.memory.rss_mb}MB, obsv_est=${r.memory.obsv_est_mb}MB, boot=${r.boot_ms ?? "—"}ms; ` +
    (r.verdict === "PASS" ? "все пороги соблюдены" : `FAIL: ${r.fails.join(", ")}`);
  return { verdict: r.verdict === "PASS" ? "WORKS" : "CAVEAT", evidence: ev };
}
