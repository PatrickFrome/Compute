"use client";
// ── ME2 PAGE: COMPUTE (R74) — исполнительные мощности ──────────────────────────
// Порт legacy (docs/legacy-mission-control.tsx.txt): EXECUTOR·POOL (fleet-pool
// L2449-2483, GET/POST /pool), WORKERS (L2566-2586, snapshot.workers), LLM·QUOTA
// (L2893-2924, GET /llm), GLM·ПЛОСКОСТЬ (механики L3049-3095, GET/POST /glm),
// FLEET·НОДЫ (механики L3220-3236, GET /fleet). Поллинги/интервалы — как legacy:
// pool 30s · llm 60s · glm 60s · fleet 30s.

import { useCallback, useEffect, useState } from "react";
import { Brain, Cpu, FlaskConical, Network, RefreshCw, Server } from "lucide-react";
import { useMe2 } from "@/components/me2/store";
import { age, me2Fetch } from "@/lib/me2-bus";
import { Chip, PageHeader, Sec, StateBadge, mapState } from "@/components/me2/ui/primitives";
import { useToast } from "@/hooks/use-toast";

// GET /pool (daemon pool.ts PoolStatus)
type PoolT = {
  ok: true; canonical: string; scale: number; workers_total: number; live: number; ceiling: number;
  workers: Array<{
    slot: number; agent_id: string; state: string; paused: number; model: string;
    lease: { task_id: string; acquired_at: string; hb_age_s: number; expires_in_s: number } | null;
    agent_status: string;
  }>;
  queue: { ready: number; running: number };
  concurrency: { current: number; max_observed: number };
  leases: { active: number; reaped_total: number };
  throughput: { done_1h: number; failed_1h: number; avg_ms: number | null; p95_ms: number | null };
};

// GET /llm (R72/R73 Quota-Resilience + providers + gateway_tls)
type LlmT = {
  ok: true;
  pacing: { min_gap_ms: number };
  cache: { entries: number; cap: number; hits_total: number; hit_rate: number | null };
  failover: { total: number; last: { from: string; to: string; error: string; at: string } | null };
  park: { max: number; active: number; total_events: number; base_s: number; cap_s: number };
  gateway_tls?: { ok: boolean | null; checked_at: string | null; ttl_ms: number };
  providers?: { zai?: { ready: boolean }; gateway?: { ready: boolean } };
};

// GET /glm (ME25 GLM currency)
type GlmT = {
  ok: true; canonical: string; agent_tag: string;
  agents: { total: number; on_canonical: number; drift: number; by_model: Record<string, number> };
  last_probe: { requested_tag: string; api_model: string | null; honoring: number; ok: number; error: string | null; at: string } | null;
  probes_total: number;
  platform_honoring: boolean | null;
};

// GET /fleet (ME6 — локальный-first реестр нод)
type FleetT = {
  ok: true;
  nodes: Array<{ id: string; kind: string; freshness: "BOUND" | "ACTIVE" | "STALE" | "LOST"; verified: boolean; age_s: number; beats: number }>;
  capacity: { active: number; stale: number; lost: number; ceiling: number; verified: number };
  backlog: { ready: number; running: number };
};

// freshness ноды → единый словарь состояний (§9 дизайн-дока)
function nodeState(f: FleetT["nodes"][number]["freshness"]): Parameters<typeof StateBadge>[0]["state"] {
  if (f === "ACTIVE") return "Running";
  if (f === "STALE") return "Degraded";
  if (f === "LOST") return "Offline";
  return "Waiting"; // BOUND — ждёт transport-proof (M8)
}

export function ComputePage() {
  const snap = useMe2((s) => s.snap);
  const openTask = useMe2((s) => s.openTask);
  const { toast } = useToast();

  const [pool, setPool] = useState<PoolT | null>(null);
  const [poolBusy, setPoolBusy] = useState(false);
  const [llm, setLlm] = useState<LlmT | null>(null);
  const [glm, setGlm] = useState<GlmT | null>(null);
  const [glmBusy, setGlmBusy] = useState(false);
  const [fleet, setFleet] = useState<FleetT | null>(null);

  // R34 E3: пул — mount + 30с (lease/heartbeat живые) — интервал legacy L1907-1912
  const loadPool = useCallback(async () => {
    const d = await me2Fetch<PoolT>("/pool?XTransformPort=3041");
    if (d?.ok) setPool(d);
  }, []);
  // R73: LLM Quota-Resilience — mount + 60с — legacy L1895-1900
  const loadLlm = useCallback(async () => {
    const d = await me2Fetch<LlmT>("/llm?XTransformPort=3041");
    if (d?.ok) setLlm(d);
  }, []);
  // R29: GLM currency — mount + 60с
  const loadGlm = useCallback(async () => {
    const d = await me2Fetch<GlmT>("/glm?XTransformPort=3041");
    if (d?.ok) setGlm(d);
  }, []);
  // ME6: fleet-ноды — mount + 30с (интервал legacy L1967)
  const loadFleet = useCallback(async () => {
    const d = await me2Fetch<FleetT>("/fleet?XTransformPort=3041");
    if (d?.ok) setFleet(d);
  }, []);

  useEffect(() => {
    const t0 = window.setTimeout(() => { void loadPool(); void loadLlm(); void loadGlm(); void loadFleet(); }, 0);
    const a = window.setInterval(() => void loadPool(), 30_000);
    const b = window.setInterval(() => void loadLlm(), 60_000);
    const c = window.setInterval(() => void loadGlm(), 60_000);
    const e = window.setInterval(() => void loadFleet(), 30_000);
    return () => { window.clearTimeout(t0); window.clearInterval(a); window.clearInterval(b); window.clearInterval(c); window.clearInterval(e); };
  }, [loadPool, loadLlm, loadGlm, loadFleet]);

  // POST /pool {op:scale|burn, n} — payload 1:1 из legacy poolOp (L1816-1825):
  // scale — АБСОЛЮТНЫЙ целевой слот (daemon poolScale клампит [0..POOL_MAX]),
  // burn — живые дымовые задачи через весь контур.
  const poolOp = useCallback(async (op: "scale" | "burn", n: number) => {
    setPoolBusy(true);
    try {
      const r = await me2Fetch<{ ok?: boolean; error?: string; scale?: number; live?: number; created?: number | string[]; drained?: number }>("/pool?XTransformPort=3041", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, n }),
      });
      if (r && !r.error) {
        toast({
          title: op === "scale"
            ? `пул: scale ${r.scale} ✓ (создано ${r.created ?? 0}, снято ${r.drained ?? 0})`
            : `burn: ${Array.isArray(r.created) ? r.created.length : r.created ?? 0} живых задач в пул ✓`,
        });
      } else {
        toast({ title: `pool ${op} ✗ ${String(r?.error ?? "daemon недоступен").slice(0, 60)}`, variant: "destructive" });
      }
      await loadPool();
    } catch {
      toast({ title: "pool ✗ daemon недоступен", variant: "destructive" });
    } finally { setPoolBusy(false); }
  }, [loadPool, toast]);

  // POST /glm {op:probe|upgrade} — legacy glmOp→mcxOp("glm",…) L1938-1941; upgrade — с confirm
  const glmOp = useCallback(async (op: "probe" | "upgrade") => {
    if (op === "upgrade" && !window.confirm("Перевести весь флот на канонический тег GLM? (каждый дрейфующий агент получит AGENT_MODEL_SET)")) return;
    setGlmBusy(true);
    try {
      const r = await me2Fetch<{ ok: boolean; error?: string }>("/glm?XTransformPort=3041", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op }),
      });
      if (r?.ok) toast({ title: op === "probe" ? "probe GLM снята — факт в /glm" : "флот переведён на канонический тег GLM" });
      else toast({ title: `glm ${op} ✗`, description: String(r?.error ?? "daemon недоступен"), variant: "destructive" });
      await loadGlm();
    } catch {
      toast({ title: "glm ✗ daemon недоступен", variant: "destructive" });
    } finally { setGlmBusy(false); }
  }, [loadGlm, toast]);

  const workers = snap?.workers ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-compute" data-panel-compute>
      <PageHeader
        title="COMPUTE"
        sub="пул · workers · квоты LLM · GLM · fleet-ноды"
        actions={
          <>
            <Chip label="pool" value={pool ? `${pool.live}/${pool.ceiling}` : "—"} tone="cyan" title="живых GLM-исполнителей / потолок пула" />
            <Chip label="workers" value={workers.length} tone="amber" title="подключённых workers (snapshot, hb 15s · reap 90s)" />
            <Chip label="парк" value={llm ? llm.park.active : "—"} tone={(llm?.park.active ?? 0) > 0 ? "amber" : "zinc"} title="задач в парке (дожидаются окна квоты, L4)" />
            <Chip label="fleet" value={fleet ? `${fleet.capacity.active}/${fleet.capacity.ceiling}` : "—"} tone="emerald" title="активных fleet-нод / потолок 64" />
          </>
        }
      />

      <div className="mc-scroll grid min-h-0 flex-1 items-start gap-3 overflow-y-auto pb-1 lg:grid-cols-2">
        {/* ── колонка 1: пул + воркеры ── */}
        <div className="flex min-w-0 flex-col gap-3">
          <Sec
            id="compute-pool" defaultOpen
            title="EXECUTOR · POOL"
            icon={Cpu}
            tone="cyan"
            dense
            right={
              <span data-testid="pool-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]" aria-label="чипы пула исполнителей">
                <Chip label="canon" value={pool?.canonical ?? "—"} tone="cyan" title="канонический тег GLM пула (канон-синк при spawn/scale)" />
                <span className={`rounded border px-1 py-0.5 ${pool && pool.live > 0 ? "border-cyan-900/60 bg-cyan-950/30 text-cyan-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`} title={`канон=${pool?.canonical ?? "—"}, всего слотов=${pool?.workers_total ?? "—"}`}>live {pool?.live ?? "—"}/{pool?.ceiling ?? "—"}</span>
                <Chip label="scale" value={pool ? `${pool.scale}·wt ${pool.workers_total}` : "—"} tone="zinc" title="целевой масштаб пула / всего слотов в реестре" />
                <Chip label="q" value={pool ? `${pool.queue.ready}/${pool.queue.running}` : "—"} tone="zinc" title="очередь: READY/RUNNING" />
                <Chip label="∥" value={pool ? `${pool.concurrency.current}·${pool.concurrency.max_observed}` : "—"} tone="zinc" title="одновременных lease сейчас · максимум наблюдённый" />
                <Chip label="lease" value={pool ? `${pool.leases.active}· reap ${pool.leases.reaped_total}` : "—"} tone="amber" title="активных lease · снятых мёртвых (reap)" />
                <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title="за 1ч: завершено✓/провалено✗; средняя длительность lease">{pool ? `${pool.throughput.done_1h}✓/${pool.throughput.failed_1h}✗${pool.throughput.avg_ms !== null ? ` · ${Math.round(pool.throughput.avg_ms / 1000)}s` : ""}` : "—"}</span>
                <Chip label="p95" value={pool?.throughput.p95_ms != null ? `${Math.round(pool.throughput.p95_ms)}ms` : "—"} tone="zinc" title="p95 длительности lease за 1ч" />
              </span>
            }
          >
            <div className="space-y-1.5" aria-label="Пул исполнителей">
              <div className="flex flex-wrap items-center gap-1">
                <span data-testid="pool-actions" className="flex flex-wrap items-center gap-1">
                  {/* scale — абсолютный целевой слот (legacy L2464-2465): +1 / −1 с клампами */}
                  <button type="button" onClick={() => void poolOp("scale", Math.min((pool?.live ?? 0) + 1, pool?.ceiling ?? 4))} disabled={poolBusy || !pool || pool.live >= pool.ceiling} aria-label="Добавить живого исполнителя в пул" className="rounded border border-cyan-900/60 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300/90 transition hover:bg-zinc-800 disabled:opacity-40">+1</button>
                  <button type="button" onClick={() => void poolOp("scale", Math.max((pool?.live ?? 0) - 1, 0))} disabled={poolBusy || !pool || pool.live <= 0} aria-label="Снять исполнителя (drain: текущие задачи доработает)" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-40">−1</button>
                  <button type="button" onClick={() => void poolOp("burn", 2)} disabled={poolBusy || !pool || pool.live < 1} aria-label="Живая дымовая проверка: 2 реальные задачи исполнятся живыми GLM-воркерами через весь контур" className="rounded border border-lime-900/60 px-1.5 py-0.5 font-mono text-[9px] text-lime-300/90 transition hover:bg-zinc-800 disabled:opacity-40">burn×2</button>
                </span>
                <button type="button" onClick={() => void loadPool()} aria-label="Обновить статус пула" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 transition hover:bg-zinc-800"><RefreshCw className={`h-3 w-3 ${poolBusy ? "animate-spin" : ""}`} aria-hidden /></button>
                <span className="font-mono text-[9px] text-zinc-600" title="E3/ME33: N живых GLM-исполнителей, каждый — независимый контекст; эксклюзивные lease (UNIQUE task_id) + heartbeat 10с + reap мёртвых; burn — живые дымовые задачи">lease + hb 10с + reap</span>
              </div>
              {(!pool || pool.workers.length === 0) && (
                <p className="rounded border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">{pool ? "слотов нет — поднимите +1" : "загрузка статуса пула…"}</p>
              )}
              {pool && pool.workers.length > 0 && (
                <ul data-testid="pool-workers" className="space-y-0.5" role="status">
                  {pool.workers.map((w) => (
                    <li key={w.slot} className="flex items-center gap-2 rounded bg-zinc-900/50 px-1.5 py-1 font-mono text-[9px]" title={`агент ${w.agent_id} · модель ${w.model} (канон-синк пула)${w.lease ? ` · lease ${w.lease.task_id} · hb ${w.lease.hb_age_s}s назад · истекает через ${w.lease.expires_in_s}s` : ""}`}>
                      <span className="shrink-0 text-zinc-400">слот {w.slot}</span>
                      <StateBadge state={mapState(w.state)} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-zinc-500">{w.agent_id.slice(0, 14)}… · <span className="text-zinc-400">{w.model}</span></span>
                      {w.lease ? (
                        <button
                          type="button"
                          onClick={() => openTask(w.lease!.task_id)}
                          aria-label={`Открыть задачу ${w.lease.task_id} (Task Sheet)`}
                          title="клик — Task Sheet задачи под lease"
                          className="min-w-0 shrink-0 truncate rounded border border-zinc-800 bg-zinc-950/60 px-1 text-zinc-400 transition hover:border-emerald-900 hover:text-emerald-300"
                        >
                          → {w.lease.task_id} · hb {w.lease.hb_age_s}s · TTL {w.lease.expires_in_s}s
                        </button>
                      ) : (
                        <span className="shrink-0 text-zinc-600" title="свободен — универсальный claim любой READY-задачи">IDLE</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Sec>

          <Sec
            id="compute-workers"
            title={`WORKERS (${workers.length})`}
            icon={Server}
            tone="amber"
            dense
            right={<span className="font-mono text-[10px] text-zinc-500" title="контракт worker-реестра: heartbeat каждые 15с, reap мёртвых через 90с (R71 сценарий G)">hb 15s · reap 90s</span>}
          >
            <div className="space-y-0.5" aria-label="Реестр workers">
              {workers.length === 0 && <p className="p-3 text-center text-xs text-zinc-500">нет подключённых workers</p>}
              {workers.map((w) => (
                <div key={w.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-800/60" title={`${w.id} · поколение ${w.generation} · hb ${age(w.heartbeat_at)} назад`}>
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${w.state !== "OFFLINE" ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{w.id.slice(0, 18)}</span>
                  <span className="shrink-0 rounded border border-zinc-800 bg-zinc-900/60 px-1 font-mono text-[9px] text-zinc-400" title="роль воркера">{w.role}</span>
                  <span className="shrink-0 rounded border border-amber-900/50 bg-amber-950/20 px-1 font-mono text-[9px] text-amber-400/80" title="kind воркера">{w.kind}</span>
                  <StateBadge state={mapState(w.state)} size="xs" />
                  <span className="shrink-0 font-mono text-[9px] text-zinc-600" title="поколение (рестарты инкарнации)">gen{w.generation}</span>
                  <span className="w-10 shrink-0 text-right font-mono text-[9px] text-zinc-500" title="возраст последнего heartbeat">{age(w.heartbeat_at)}</span>
                </div>
              ))}
            </div>
          </Sec>
        </div>

        {/* ── колонка 2: LLM-квота + GLM + fleet-ноды ── */}
        <div className="flex min-w-0 flex-col gap-3">
          <Sec
            id="compute-llm"
            title="LLM · QUOTA"
            icon={Brain}
            tone="teal"
            dense
            right={
              llm ? (
                <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${(llm.park.active ?? 0) > 0 ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`} title={`${llm.park.active} задач в парке (дожидаются окна квоты) · всего парков: ${llm.park.total_events} · бюджет: ${llm.park.max}`}>
                  {(llm.park.active ?? 0) > 0 ? `парк: ${llm.park.active}` : "квота: норма"}
                </span>
              ) : (
                <span className="font-mono text-[9px] text-zinc-600">…</span>
              )
            }
          >
            <div data-testid="llm-quota" aria-label="Статус LLM-квоты (R72/R73)">
              {llm ? (
                <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400" title="L1: глобальный min-gap между стартами LLM-вызовов (ME2_LLM_MIN_GAP_MS) — burst'ы размываются до сети">pace: {llm.pacing.min_gap_ms}ms</span>
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400" title="L2: response-cache — дедуп детерминированных промптов (TTL 24ч); hits = сэкономленные вызовы">кэш: {llm.cache.entries}/{llm.cache.cap} · хиты {llm.cache.hits_total}{llm.cache.hit_rate !== null ? ` (${Math.round(llm.cache.hit_rate * 100)}%)` : ""}</span>
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400" title="L3: авто-переход на альтернативного провайдера после исчерпанного 429 (LLM_FAILOVER в hash-chain)">failover: {llm.failover.total}</span>
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400" title={`L4: park-and-resume — база/кап задержки парковки (экспоненциально, +jitter); бюджет парков: ${llm.park.max}`}>park: {llm.park.base_s}–{llm.park.cap_s}с · {llm.park.total_events}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${llm.providers?.gateway?.ready ? (llm.gateway_tls?.ok === false ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400") : "bg-zinc-500/15 text-zinc-500"}`}
                    title={`каналы: zai=${llm.providers?.zai?.ready ? "готов" : "?"}, gateway=${llm.providers?.gateway?.ready ? "ключ в vault" : "нет ключа"}${llm.gateway_tls ? `, TLS-проба: ${llm.gateway_tls.ok === null ? "не проводилась" : llm.gateway_tls.ok ? "жив" : "ВНИЗ (исключён из failover)"}` : ""}`}
                  >
                    каналы: zai+{llm.providers?.gateway?.ready ? (llm.gateway_tls?.ok === false ? "gw⨯" : "gw✓") : "gw—"}
                  </span>
                </div>
                <div className="rounded bg-zinc-950/60 px-1.5 py-1 font-mono text-[9px] text-zinc-500" title="последний failover (исчерпанный 429 → альтернативный провайдер)">
                  {llm.failover.last ? (
                    <span className="block min-w-0 truncate">{llm.failover.last.from} → <span className="text-teal-400">{llm.failover.last.to}</span> · {llm.failover.last.error.slice(0, 70)} · {llm.failover.last.at.slice(11, 19)}</span>
                  ) : (
                    <span>failover ещё не потребовался (первичный канал держит)</span>
                  )}
                </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка статуса LLM-квоты…</div>
            )}
            </div>
          </Sec>

          <Sec
            id="compute-glm"
            title="GLM · ПЛОСКОСТЬ"
            icon={FlaskConical}
            tone="cyan"
            dense
            right={
              <span data-testid="glm-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]" aria-label="чипы GLM-плоскости (ME25)">
                <Chip label="canon" value={glm?.canonical ?? "—"} tone="cyan" title={`канонический тег: ${glm?.agent_tag ?? "—"}; probe'ов снято: ${glm?.probes_total ?? 0}`} />
                <Chip label="tag" value={glm?.agent_tag ?? "—"} tone="zinc" title="тег enforced на весь флот (boot+spawn+upgrade)" />
                <span className={`rounded border px-1 py-0.5 ${(glm?.agents.drift ?? 0) === 0 ? "border-emerald-900 bg-emerald-950/40 text-emerald-300" : "border-rose-900 bg-rose-950/40 text-rose-300"}`} title={`агентов на каноне: ${glm?.agents.on_canonical ?? 0}/${glm?.agents.total ?? 0}; drift>0 = есть агенты на старых тегах`}>drift {glm?.agents.drift ?? "—"}</span>
                {Object.entries(glm?.agents.by_model ?? {}).map(([m, n]) => (
                  <Chip key={m} label="model" value={`${m}×${n}`} tone="zinc" title="распределение агентов по моделям" />
                ))}
                <Chip label="probes" value={glm?.probes_total ?? "—"} tone="zinc" title="всего живых проб снято" />
                {glm?.platform_honoring === false && (
                  <span className="rounded border border-amber-900 bg-amber-950/40 px-1 py-0.5 text-amber-300" title={`бэкенд отвечает api.model=${glm.last_probe?.api_model ?? "?"} на тег ${glm.last_probe?.requested_tag} — платформа пока не уважает тег (зафиксировано честно, таг enforced)`}>таг не honoring</span>
                )}
              </span>
            }
          >
            <div className="space-y-1.5" aria-label="GLM-плоскость">
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => void glmOp("probe")} disabled={glmBusy} aria-label="Снять живую пробу GLM" className="rounded border border-cyan-900 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300 transition hover:bg-cyan-950/40 disabled:opacity-40">probe</button>
                <button type="button" onClick={() => void glmOp("upgrade")} disabled={glmBusy} aria-label="Перевести флот на канонический тег GLM" className="rounded border border-cyan-900 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300 transition hover:bg-cyan-950/40 disabled:opacity-40">upgrade флот</button>
                <button type="button" onClick={() => void loadGlm()} disabled={glmBusy} aria-label="Обновить GLM" className="ml-auto text-zinc-600 transition hover:text-zinc-300"><RefreshCw className={`h-3 w-3 ${glmBusy ? "animate-spin" : ""}`} aria-hidden /></button>
              </div>
              {glm?.last_probe && (
                <div className="rounded bg-zinc-900/50 px-1.5 py-1 font-mono text-[9px]" title={`probe: ${glm.last_probe.at} · requested=${glm.last_probe.requested_tag}`}>
                  <span className={glm.last_probe.ok ? "text-cyan-300" : "text-rose-300"}>probe:</span> <span className="text-zinc-400">запрошен {glm.last_probe.requested_tag} → бэкенд {glm.last_probe.api_model ?? `ошибка: ${glm.last_probe.error ?? "?"}`}{glm.last_probe.api_model ? ` · honoring: ${glm.last_probe.honoring ? "✓" : "✗"}` : ""}</span>
                </div>
              )}
              {!glm && <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка GLM-плоскости…</div>}
            </div>
          </Sec>

          <Sec
            id="compute-fleet"
            title="FLEET · НОДЫ"
            icon={Network}
            tone="emerald"
            dense
            right={
              <span className="flex flex-wrap items-center gap-1 font-mono text-[9px]" title="freshness от last_seen: ACTIVE<45s, STALE<300s, LOST≥300s (порт 45s-контракта; heartbeat≠liveness)">
                <Chip label="active" value={fleet ? `${fleet.capacity.active}/${fleet.capacity.ceiling}` : "—"} tone="emerald" title="активных нод / потолок 64" />
                <Chip label="stale" value={fleet?.capacity.stale ?? "—"} tone={(fleet?.capacity.stale ?? 0) > 0 ? "amber" : "zinc"} title="ноды без бита 45–300с" />
                <Chip label="lost" value={fleet?.capacity.lost ?? "—"} tone={(fleet?.capacity.lost ?? 0) > 0 ? "rose" : "zinc"} title="ноды без бита ≥300с" />
                <Chip label="proof" value={fleet?.capacity.verified ?? "—"} tone="teal" title="нод с transport-proof (M8: BOUND→ACTIVE)" />
                <Chip label="backlog" value={fleet ? `${fleet.backlog.ready}/${fleet.backlog.running}` : "—"} tone="zinc" title="бэклог шины задач: READY/RUNNING" />
              </span>
            }
          >
            <div data-testid="fleet-nodes" className="space-y-0.5" aria-label="Ноды флота">
              {fleet && fleet.nodes.length === 0 && <p className="p-2 text-center font-mono text-[10px] text-zinc-600">нод нет — daemon сам бьётся при старте</p>}
              {!fleet && <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка флота…</div>}
              {(fleet?.nodes ?? []).map((n) => (
                <div key={n.id} className="flex items-center gap-1.5 rounded bg-zinc-900/50 px-1.5 py-1 font-mono text-[9px]" title={`${n.id} · beats ${n.beats} · proof ${n.verified ? "есть" : "нет"}`}>
                  <StateBadge state={nodeState(n.freshness)} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-zinc-400">{n.id}</span>
                  <span className="shrink-0 text-zinc-600">{n.kind}</span>
                  <span className="shrink-0 text-zinc-500" title="битов сердца">beats {n.beats}</span>
                  {n.verified && <span className="shrink-0 text-emerald-400/80" title="transport-proof: BOUND→ACTIVE">✓</span>}
                  <span className="w-10 shrink-0 text-right text-zinc-600">{n.age_s}с</span>
                </div>
              ))}
            </div>
          </Sec>
        </div>
      </div>
    </div>
  );
}
