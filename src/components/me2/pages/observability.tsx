"use client";
// ── ME2 · PAGE 9: OBSERVABILITY (R74) — порт из legacy-mission-control.tsx.txt ──
// EVENT LOG (log L4391-4446) · COMMAND BUS (L3999-4035) · CI·INGRESS (L2824-2857) ·
// WEBHOOKS·IN (L2858-2892) · SQL-ЗЕРКАЛО (MirrorPanel) · EVIDENCE·CHAIN (L4213-4238) ·
// BENCH (L4126-4151) · EVAL (L4152-4184) · DB·HYGIENE (L4185-4212) · AUTONOMY·V4 (L4239-4260) ·
// SPANS·OTEL + VERDICTS. REST-опросы локальны странице; payload'ы мутаций — legacy 1:1.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ClipboardCheck, Database, Gauge, GitBranch, Radio, RefreshCw,
  ScrollText, ShieldCheck, Webhook, X, Zap, Clock,
} from "lucide-react";
import { useMe2 } from "@/components/me2/store";
import {
  sendCommand, me2Fetch, age, hhmmss, EVENT_STYLE, EVENT_FILTERS,
  type Command, type Event,
} from "@/lib/me2-bus";
import { PageHeader, Sec, Chip, Dot, StateBadge, mapState, type SysState } from "@/components/me2/ui/primitives";
import MirrorPanel from "@/components/me2/mirror-panel";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

// ── типы ответов daemon (по живым маршрутам v0.57.1) ────────────────────────────
type Probe = { n: number; p50: number | null; p95: number | null; p99: number | null; max: number | null };
type BenchT = {
  ok: boolean; verdict: "PASS" | "WARMUP" | "FAIL"; boot_ms: number | null; fails: string[];
  probes: { rest: Probe; rest_admin: Probe; rest_browser: Probe; sense: Probe; sense_act: Probe };
  memory: { rss_mb: number; heap_mb: number; obsv_est_mb: number; sqlite_mb: number };
};
type EvalResultT = { id: string; critical: boolean; ok: boolean; evidence: string; expect: string };
type EvalT = {
  ok: boolean; dataset_version: number; runs_total: number;
  last: { run_id: string; started_at: string; duration_ms: number; verdict: string; passed: number; warned: number; failed: number; total: number; results?: EvalResultT[] } | null;
  history: Array<{ run_id: string; started_at: string; duration_ms: number; verdict: string; passed: number; total: number }>;
};
type CiT = {
  ok: boolean; repo: string; branch: string; token: string; verdict: string;
  runs: Array<{ id: number; name: string; head_sha7: string; status: string; conclusion: string | null; created_at: string | null }>;
  polls_total: number; events_emitted_total: number;
};
type HooksT = {
  ok: boolean; secret: string; verdict: string; received_total: number; verified_total: number; rejected_total: number;
  events_emitted_total: number; rejected_last_reason: string | null; dedupe_size: number; dedupe_persistent: boolean;
  deliveries: Array<{ delivery: string; event: string; action: string | null; emitted: string[]; at: string }>;
};
type HygT = {
  ok: boolean;
  db: { file_mb: number; wal_mb: number; journal_mode: string; page_count: number; freelist_count: number; freelist_pct: number };
  indexes: string[];
  last_runs: Array<{ op: string; duration_ms: number; ok: boolean; detail: string; age_s: number }>;
};
type ChainVerifyT = { ok: boolean; scheme: string; from: number; to: number; checked: number; broken_at: number | null; reason: string | null; ms: number };
type AutonomyT = {
  ok: boolean;
  liveness: { verdict: string; stalled_reasons: string[]; checks: Array<{ id: string; ok: boolean }> };
  budget: { state: string; score: number; warn: number; breach: number; window_h: number };
  non_bypass: { verdict: string; post_routes: string[]; unknown: string[] };
  recovery: Array<{ level: string; component: string; status: string }>;
  independence: { reviewer_writes_status: boolean; chain_ok: boolean; chain_checked: number };
};
type OtelT = { ok: boolean; spans: number; dropped: number; ringCap: number; stats: Array<{ name: string; n: number; err: number; avgMs: number; maxMs: number }> };
type VdT = { ok: boolean; count: number; verdicts: Array<{ seq: number; task_id: string | null; at: string; reasons?: string[] }> };

// legacy laneChip 1:1 (L2153)
const LANE_CHIP = (lane: string) =>
  lane === "EMERGENCY" ? "border-rose-800 text-rose-400"
    : lane === "CONTROL" ? "border-amber-800 text-amber-400"
    : lane === "MUTATION" ? "border-fuchsia-800 text-fuchsia-400"
    : "border-zinc-700 text-zinc-400";

const etaOf = (c: Command, nowMs: number) => `${Math.max(1, Math.ceil(((c.run_after ?? 0) - nowMs) / 1000))}s`;

// вердикты bench/eval → единый словарь состояний (§9)
const benchState = (v: string): SysState => (v === "PASS" ? "LIVE" : v === "FAIL" ? "Failed" : "WARMUP");
const evalState = (v: string): SysState => (v === "PASS" ? "Completed" : v === "FAIL" ? "Failed" : "Degraded");
const ciState = (r: { status: string; conclusion: string | null }): SysState =>
  r.status !== "completed" ? "Running" : r.conclusion === "success" ? "Completed" : r.conclusion ? "Failed" : "Offline";

// ── подзаголовок секции (порт плотных label-строк legacy) ───────────────────────
function SecLabel({ icon: Icon, text, tone, title, children }: {
  icon: typeof Gauge; text: string; tone: string; title?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`flex shrink-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-widest ${tone}`} title={title}>
        <Icon className="h-3 w-3" aria-hidden /> {text}
      </span>
      {children}
    </div>
  );
}

// ── EVENT LOG (порт 1:1 панели log) ─────────────────────────────────────────────
function EventLogPanel() {
  const events = useMe2((s) => s.events);
  const connected = useMe2((s) => s.connected);
  const [liveTail, setLiveTail] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const [laneFilter, setLaneFilter] = useState("ALL");
  const logRef = useRef<HTMLDivElement | null>(null);
  const [frozenSeq, setFrozenSeq] = useState<number | null>(null);

  // пауза хвоста: фиксируем водяной знак seq в обработчике (список честно заморожен, WS не рвём)
  const toggleTail = useCallback((on: boolean) => {
    setLiveTail(on);
    setFrozenSeq(on ? null : (events[0]?.seq ?? null));
  }, [events]);

  // автоскролл как legacy: лента prepend'ит сверху — scrollTop=0
  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = 0;
  }, [events, autoScroll]);

  const display = useMemo(
    () => (liveTail || frozenSeq == null ? events : events.filter((e) => e.seq >= frozenSeq)),
    [events, liveTail, frozenSeq],
  );

  const filtered = useMemo(() => {
    let list = display;
    const lane = EVENT_FILTERS.find((f) => f.key === laneFilter);
    if (lane?.prefix) list = list.filter((e) => e.type.startsWith(lane.prefix));
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((e) => e.type.toLowerCase().includes(f) || (e.data ?? "").toLowerCase().includes(f));
    }
    return list;
  }, [display, laneFilter, filter]);

  return (
    <Sec
      id="obs-event-log" title="EVENT LOG" icon={ScrollText}
      right={<span className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500"><Dot on={connected} pulse /> {connected ? "live" : "offline"} · {filtered.length}</span>}
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/70 pb-2">
          <Input
            value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="фильтр: тип или данные…"
            className="h-7 min-w-28 flex-1 border-zinc-800 bg-zinc-900 font-mono text-[11px]"
          />
          <div className="flex items-center gap-1" role="group" aria-label="Фильтр по типу событий">
            {EVENT_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setLaneFilter(f.key)}
                className={`rounded px-1.5 py-0.5 text-[10px] transition ${laneFilter === f.key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500" title="прилипание к свежим событиям (лента prepend'ит сверху); пауза честно замораживает список">
            {liveTail ? "live" : "пауза"}
            <Switch checked={liveTail} onCheckedChange={toggleTail} aria-label="Живой хвост событий" className="scale-75" />
          </label>
          <label className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500">
            автоскролл
            <Switch checked={autoScroll} onCheckedChange={setAutoScroll} aria-label="Автоскролл лога" className="scale-75" />
          </label>
        </div>
        <div
          ref={logRef} data-testid="event-log"
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-0.5 font-mono text-[10.5px] leading-relaxed [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent"
        >
          {filtered.length === 0 && (
            <p className="p-4 text-center text-zinc-500">{events.length ? "ничего не найдено по фильтру" : "ожидание событий…"}</p>
          )}
          {filtered.map((e) => (
            <div key={e.seq} className="flex gap-2 rounded px-1.5 py-0.5 hover:bg-zinc-800/50">
              <span className="shrink-0 text-zinc-600">{e.seq}</span>
              <span className="shrink-0 text-zinc-500">{hhmmss(e.ts)}</span>
              <span className={`w-36 shrink-0 truncate font-semibold ${EVENT_STYLE[e.type] ?? "text-zinc-400"}`} title={e.type}>{e.type}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-500" title={e.data}>{e.data}</span>
            </div>
          ))}
        </div>
      </div>
    </Sec>
  );
}

// ── страница ────────────────────────────────────────────────────────────────────
export function ObservabilityPage() {
  const snap = useMe2((s) => s.snap);
  const mirror = useMe2((s) => s.mirror);
  const nowMs = useMe2((s) => s.nowMs);
  const openTask = useMe2((s) => s.openTask);
  const { toast } = useToast();

  // ── REST-состояния ──
  const [bench, setBench] = useState<BenchT | null>(null);
  const [evalData, setEvalData] = useState<EvalT | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const [ciData, setCiData] = useState<CiT | null>(null);
  const [hooksData, setHooksData] = useState<HooksT | null>(null);
  const [hyg, setHyg] = useState<HygT | null>(null);
  const [hygBusy, setHygBusy] = useState(false);
  const [evChain, setEvChain] = useState<ChainVerifyT | null>(null);
  const [evChainBusy, setEvChainBusy] = useState(false);
  const [autonomy, setAutonomy] = useState<AutonomyT | null>(null);
  const [otel, setOtel] = useState<OtelT | null>(null);
  const [vd, setVd] = useState<VdT | null>(null);

  // ── загрузчики (legacy 1:1: GET + ?XTransformPort=3041) ──
  const loadBench = useCallback(async () => {
    const r = await me2Fetch<BenchT>("/bench?XTransformPort=3041"); if (r?.ok) setBench(r);
  }, []);
  const loadEval = useCallback(async () => {
    const r = await me2Fetch<EvalT>("/eval?XTransformPort=3041"); if (r?.ok) setEvalData(r);
  }, []);
  const loadCi = useCallback(async () => {
    const r = await me2Fetch<CiT>("/ci?XTransformPort=3041"); if (r?.ok) setCiData(r);
  }, []);
  const loadHooks = useCallback(async () => {
    const r = await me2Fetch<HooksT>("/hooks?XTransformPort=3041"); if (r?.ok) setHooksData(r);
  }, []);
  const loadHyg = useCallback(async () => {
    const r = await me2Fetch<HygT>("/db/hygiene?XTransformPort=3041"); if (r?.ok) setHyg(r);
  }, []);
  const loadAutonomy = useCallback(async () => {
    const r = await me2Fetch<AutonomyT>("/autonomy?XTransformPort=3041"); if (r?.ok) setAutonomy(r);
  }, []);
  const loadOtelVd = useCallback(async () => {
    const [o, v] = await Promise.all([
      me2Fetch<OtelT>("/spans?XTransformPort=3041"),
      me2Fetch<VdT>("/verdicts?XTransformPort=3041"),
    ]);
    if (o?.ok) setOtel(o);
    if (v?.ok) setVd(v);
  }, []);
  const loadEvChain = useCallback(async () => {
    const r = await me2Fetch<ChainVerifyT>("/evidence/verify?XTransformPort=3041&limit=300");
    if (r) setEvChain(r);
  }, []);

  // ── поллинги (mount + интервал; cleanup как legacy) ──
  useEffect(() => { void loadBench(); const iv = setInterval(() => void loadBench(), 30_000); return () => clearInterval(iv); }, [loadBench]);
  useEffect(() => { void loadEval(); const iv = setInterval(() => void loadEval(), 60_000); return () => clearInterval(iv); }, [loadEval]);
  useEffect(() => { void loadCi(); const iv = setInterval(() => void loadCi(), 120_000); return () => clearInterval(iv); }, [loadCi]);
  useEffect(() => { void loadHooks(); const iv = setInterval(() => void loadHooks(), 120_000); return () => clearInterval(iv); }, [loadHooks]);
  useEffect(() => { void loadHyg(); const iv = setInterval(() => void loadHyg(), 60_000); return () => clearInterval(iv); }, [loadHyg]);
  useEffect(() => { void loadAutonomy(); const iv = setInterval(() => void loadAutonomy(), 60_000); return () => clearInterval(iv); }, [loadAutonomy]);
  useEffect(() => { void loadOtelVd(); const iv = setInterval(() => void loadOtelVd(), 60_000); return () => clearInterval(iv); }, [loadOtelVd]);
  useEffect(() => { void loadEvChain(); }, [loadEvChain]);

  // ── мутации (payload'ы legacy 1:1) ──
  const cancelCommand = useCallback(async (id: string) => {
    await sendCommand("COMMAND_CANCEL", { id }, { lane: "CONTROL", successMsg: "команда отменена до исполнения" });
  }, []);

  const runEval = useCallback(async () => {
    setEvalBusy(true); // честный прогресс: запрос долгий (2-10с), не рвём его
    try {
      const r = await me2Fetch<{ verdict?: string; passed?: number; total?: number; duration_ms?: number; failed?: number; warned?: number }>(
        "/eval/run?XTransformPort=3041",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (r?.verdict) {
        toast({
          title: `eval ${r.verdict}`,
          description: `${r.passed ?? "?"}/${r.total ?? "?"} за ${r.duration_ms ?? "?"}ms${r.failed ? ` · critical fails: ${r.failed}` : r.warned ? ` · warns: ${r.warned}` : ""}`,
          variant: r.verdict === "PASS" ? "default" : "destructive",
        });
        await loadEval();
      } else toast({ title: "eval ✗", description: "daemon недоступен или прогон не вернул вердикт", variant: "destructive" });
    } finally { setEvalBusy(false); }
  }, [loadEval, toast]);

  const hygOp = useCallback(async (op: "checkpoint" | "vacuum") => {
    if (op === "vacuum" && !window.confirm("VACUUM базы daemon? Операция блокирует БД на время пересборки (осмысленно при freelist ≥ 10%).")) return;
    setHygBusy(true);
    try {
      const r = await me2Fetch<{ ok?: boolean; duration_ms?: number; detail?: string; error?: string }>(
        "/db/hygiene?XTransformPort=3041",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, mode: "TRUNCATE" }) },
      );
      if (r?.ok) toast({ title: `db: ${op} ✓ за ${r.duration_ms}ms`, description: String(r.detail ?? "").slice(0, 90) });
      else toast({ title: `db ${op} ✗ ${String(r?.error ?? "ошибка").slice(0, 60)}`, variant: "destructive" });
      await loadHyg();
    } finally { setHygBusy(false); }
  }, [loadHyg, toast]);

  const verifyEvChain = useCallback(async (limit: number) => {
    setEvChainBusy(true);
    try {
      const r = await me2Fetch<ChainVerifyT>(`/evidence/verify?XTransformPort=3041&limit=${limit}`);
      if (r) {
        setEvChain(r);
        if (r.ok) toast({ title: `цепь ✓ ${r.checked} событий за ${r.ms}ms`, description: r.scheme });
        else toast({ title: `цепь ✗ @seq ${r.broken_at ?? "?"}`, description: String(r.reason ?? "нет данных"), variant: "destructive" });
      } else toast({ title: "verify ✗ daemon недоступен", variant: "destructive" });
    } finally { setEvChainBusy(false); }
  }, [toast]);

  const budget = snap?.budget ?? { used: 0, limit: 24 };
  const scheduled = (snap?.commands ?? []).filter((c) => c.status === "PENDING" && c.run_after != null);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-observability" data-panel-log>
      <PageHeader title="OBSERVABILITY" sub="журнал · шина · ingress · аудит · здоровье" />
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">

        {/* ── ЛЕВО: EVENT LOG ── */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-[2] [&>section]:min-h-0 [&>section]:flex-1" data-testid="panel-log">
          <EventLogPanel />
        </div>

        {/* ── ЦЕНТР: BUS + INGRESS ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto lg:flex-[1.2] mc-scroll">
          <Sec
            id="obs-bus" title="COMMAND BUS" icon={Zap}
            right={<span className="font-mono text-[10px] text-zinc-500">бюджет {budget.used}/{budget.limit} / 60s</span>}
          >
            <div className="space-y-1" data-testid="command-bus">
              {scheduled.length > 0 && (
                <div className="mb-1.5 space-y-1 rounded-md border border-lime-900/50 bg-lime-950/20 p-1.5">
                  {scheduled.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded px-1 py-0.5">
                      <Clock className="h-3 w-3 shrink-0 text-lime-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-lime-200">{c.action}</span>
                      <span className="font-mono text-[10px] text-lime-400/90">ETA {etaOf(c, nowMs)}</span>
                      <button
                        aria-label={`Отменить ${c.action} по расписанию`}
                        className="rounded p-0.5 text-zinc-600 transition hover:bg-rose-950 hover:text-rose-400"
                        onClick={() => void cancelCommand(c.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {(snap?.commands ?? []).slice(0, 12).map((c) => (
                <div key={c.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-zinc-900/60">
                  <span className={`shrink-0 rounded border px-1 font-mono text-[9px] ${LANE_CHIP(c.lane)}`}>{c.lane}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300" title={c.action}>{c.action}</span>
                  {c.error && <span className="hidden min-w-0 max-w-36 flex-1 truncate text-right font-mono text-[9px] text-rose-300/80 md:inline" title={c.error}>{c.error}</span>}
                  <span className="shrink-0 font-mono text-[9px] text-zinc-600">cost {c.cost}</span>
                  <span className="shrink-0 font-mono text-[9px] text-zinc-600">{age(c.created_at)}</span>
                  <StateBadge state={mapState(c.status)} size="xs" />
                </div>
              ))}
              {(snap?.commands ?? []).length === 0 && <p className="p-3 text-center text-xs text-zinc-500">шина пуста</p>}
            </div>
          </Sec>

          {/* R67: CI-INGRESS (pull) */}
          <Sec id="obs-ci" title="CI·INGRESS" icon={GitBranch} tone="teal"
            right={ciData ? (
              <span className={`rounded px-1.5 py-px font-mono text-[9px] ${ciData.verdict === "LIVE" ? "bg-emerald-500/15 text-emerald-400" : ciData.verdict === "ERROR" ? "bg-rose-500/15 text-rose-400" : ciData.verdict === "NO_TOKEN" ? "bg-amber-500/15 text-amber-400" : "bg-zinc-500/15 text-zinc-500"}`}
                title={`verdict: ${ciData.verdict} · опросов: ${ciData.polls_total} · событий: ${ciData.events_emitted_total}`}>{ciData.verdict}</span>
            ) : undefined}
          >
            <div className="space-y-1.5" data-testid="ci-ingress">
              {ciData ? (
                <>
                  <div className="flex flex-wrap gap-1">
                    <Chip label="repo" value={ciData.repo} title="репозиторий опроса GitHub Actions" />
                    <Chip label="branch" value={ciData.branch} title="ветка опроса" />
                    <Chip label="token" value={ciData.token === "present" ? "✓ present" : "missing"} tone={ciData.token === "present" ? "emerald" : "rose"} />
                    <Chip label="poll" value={ciData.polls_total} title="опросов поллера" />
                  </div>
                  <div className="max-h-28 space-y-0.5 overflow-y-auto pr-1 mc-scroll" role="list" aria-label="Последние прогоны CI">
                    {ciData.runs.map((r) => (
                      <div key={r.id} role="listitem" className="flex items-center gap-1.5 rounded bg-zinc-950/60 px-1.5 py-1 font-mono text-[9px]"
                        title={`${r.name} · run ${r.id} · ${r.status}${r.conclusion ? " · " + r.conclusion : ""}${r.created_at ? " · " + r.created_at : ""}`}>
                        <span className="w-16 shrink-0 truncate text-zinc-400">{r.name}</span>
                        <span className="shrink-0 text-zinc-600">{r.head_sha7}</span>
                        <StateBadge state={ciState(r)} size="xs" />
                        <span className="ml-auto shrink-0 text-zinc-600">{r.created_at ? hhmmss(r.created_at) : "—"}</span>
                      </div>
                    ))}
                    {ciData.runs.length === 0 && <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">прогонов нет</div>}
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка CI-статуса…</div>
              )}
            </div>
          </Sec>

          {/* R68: WEBHOOKS-IN (push) */}
          <Sec id="obs-hooks" title="WEBHOOKS·IN" icon={Webhook} tone="amber"
            right={hooksData ? (
              <span className={`rounded px-1.5 py-px font-mono text-[9px] ${hooksData.verdict === "LIVE" ? "bg-emerald-500/15 text-emerald-400" : hooksData.verdict === "NO_SECRET" ? "bg-rose-500/15 text-rose-400" : hooksData.verdict === "DEV_SECRET" ? "bg-amber-500/15 text-amber-400" : "bg-zinc-500/15 text-zinc-500"}`}
                title={`verdict: ${hooksData.verdict} · секрет: ${hooksData.secret} · получено: ${hooksData.received_total} · верифицировано: ${hooksData.verified_total}`}>{hooksData.verdict}</span>
            ) : undefined}
          >
            <div className="space-y-1.5" data-testid="hooks-in">
              {hooksData ? (
                <>
                  <div className="flex flex-wrap gap-1">
                    <Chip label="secret" value={hooksData.secret} tone={hooksData.secret === "vault" ? "emerald" : hooksData.secret === "env-dev" ? "amber" : "rose"}
                      title="источник секрета HMAC (vault — канон; env-dev — только самотест)" />
                    <Chip label="received" value={hooksData.received_total} />
                    <Chip label="verified" value={hooksData.verified_total} tone="emerald" />
                    <Chip label="rejected" value={hooksData.rejected_total} tone={hooksData.rejected_total > 0 ? "rose" : "zinc"} title="отклонено: подпись отсутствует/неверна (fail-closed)" />
                    <Chip label="dedupe" value={`${hooksData.dedupe_size}${hooksData.dedupe_persistent ? " ✓sqlite" : " (in-memory)"}`}
                      title="GUID-окно дедупликации X-GitHub-Delivery: персистентная SQLite-таблица hook_deliveries (R69)" />
                  </div>
                  {hooksData.rejected_last_reason && (
                    <p className="truncate rounded border border-rose-900/60 bg-rose-950/30 px-1.5 py-0.5 font-mono text-[9px] text-rose-300" role="status"
                      title="последняя причина отказа push-доставки">last reject: {hooksData.rejected_last_reason}</p>
                  )}
                  <div className="max-h-28 space-y-0.5 overflow-y-auto pr-1 mc-scroll" role="list" aria-label="Последние доставки webhook">
                    {hooksData.deliveries.map((d, i) => (
                      <div key={`${d.delivery}-${i}`} role="listitem" className="flex items-center gap-1.5 rounded bg-zinc-950/60 px-1.5 py-1 font-mono text-[9px]"
                        title={`${d.event}${d.action ? " · " + d.action : ""} · delivery ${d.delivery} · ${d.at}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.emitted.length > 0 ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
                        <span className="w-20 shrink-0 truncate text-zinc-400">{d.event}</span>
                        <span className="shrink-0 text-zinc-600">{d.delivery}</span>
                        <span className="min-w-0 flex-1 truncate text-zinc-500">{d.emitted.join(", ") || "dedupe"}</span>
                        <span className="shrink-0 text-zinc-600">{hhmmss(d.at)}</span>
                      </div>
                    ))}
                    {hooksData.deliveries.length === 0 && <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">доставок нет (ping не приходил)</div>}
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка статуса webhook…</div>
              )}
            </div>
          </Sec>
        </div>

        {/* ── ПРАВО: ЗЕРКАЛО + АУДИТ + ЗДОРОВЬЕ ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto lg:flex-[1.2] mc-scroll">
          <Sec id="obs-mirror" title="SQL·ЗЕРКАЛО" icon={Database} tone="cyan">
            <MirrorPanel />
          </Sec>

          {/* R33 E2: EVIDENCE·CHAIN */}
          <Sec id="obs-evchain" title="EVIDENCE·CHAIN" icon={ShieldCheck} tone="emerald">
            <div className="space-y-1.5">
              <SecLabel icon={ShieldCheck} text="chain" tone="text-zinc-500" title="E2/ME32 (IETF draft-sharif-agent-audit-trail): sha256(prev|ts|type|actor|subject|data); verify пересчитывает хеши и связи">
                <span data-testid="evchain-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                  <Chip label="mirror" value={mirror ? mirror.mode : "—"} tone={mirror?.mode === "LIVE" ? "emerald" : mirror?.mode === "OFF" ? "zinc" : "amber"}
                    title="канал SQL-зеркала (store, опрос каждые 10с)" />
                  <Chip label="outbox" value={mirror?.pending ?? "—"} tone={(mirror?.pending ?? 0) > 0 ? "amber" : "zinc"} />
                  <Chip label="last_seq" value={mirror?.last_sent_seq ?? "—"} />
                  <span className={`rounded border px-1 py-0.5 ${evChain ? (evChain.ok ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300" : "border-rose-900/60 bg-rose-950/30 text-rose-300") : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`}
                    title={evChain?.reason ?? "пересчёт всей цепи: хеш каждого события + связь prev_hash"}>
                    {evChain ? (evChain.ok ? "chain ✓" : `chain ✗ @${evChain.broken_at}`) : "—"}
                  </span>
                  <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400">{evChain?.checked ?? "—"} ev</span>
                  <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400">{evChain ? `${evChain.from}..${evChain.to}` : "—"}</span>
                  <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400">{evChain ? `${evChain.ms}ms` : "—"}</span>
                </span>
                <span data-testid="evchain-actions" className="ml-auto flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => void verifyEvChain(300)} disabled={evChainBusy} aria-label="Проверить целостность hash-chain (300 событий)"
                    className="rounded border border-emerald-900/60 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300/90 transition hover:bg-zinc-800 disabled:opacity-40">проверить</button>
                  <button type="button" onClick={() => void verifyEvChain(1000)} disabled={evChainBusy} aria-label="Проверить hash-chain глубже (1000 событий)"
                    className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-40">1000</button>
                </span>
              </SecLabel>
              {evChain && (
                <p className="truncate font-mono text-[9px] text-zinc-600" title={evChain.reason ?? evChain.scheme}>
                  scheme {evChain.scheme.split(",")[0]}{evChain.reason ? ` · ${evChain.reason}` : ""} · query: /evidence/query?task_id=…
                </p>
              )}
            </div>
          </Sec>

          {/* R25 B3: BENCH */}
          <Sec id="obs-bench" title="BENCH" icon={Gauge} tone="teal"
            right={<button type="button" onClick={() => void loadBench()} aria-label="Обновить перф-бейслайны" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 transition hover:bg-zinc-800">обновить</button>}
          >
            <div className="space-y-1.5" aria-label="Перф-бейслайны daemon и MCP-сервер">
              <div className="flex flex-wrap items-center gap-1.5">
                <SecLabel icon={Gauge} text="p95" tone="text-zinc-500" title="ME20: пороги B3 — REST p95<50ms, act p95<2000ms, obsv<50MB, boot<5s; замер живого трафика" />
                <StateBadge state={benchState(bench?.verdict ?? "WARMUP")} size="xs" />
                <span data-testid="bench-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                  <Chip label="boot" value={bench?.boot_ms != null ? `${bench.boot_ms}ms` : "—"} tone={(bench?.boot_ms ?? 0) > 5000 ? "rose" : "zinc"} title="BOOT_T0 → первый принятый REST-запрос" />
                  <Chip label="rss" value={bench ? `${bench.memory.rss_mb}MB` : "—"} />
                  <Chip label="heap" value={bench ? `${bench.memory.heap_mb}MB` : "—"} />
                  <Chip label="obsv" value={bench ? `${bench.memory.obsv_est_mb}MB` : "—"} />
                  <Chip label="sqlite" value={bench ? `${bench.memory.sqlite_mb}MB` : "—"} />
                </span>
              </div>
              <div className="grid grid-cols-1 gap-0.5 font-mono text-[9px] sm:grid-cols-2">
                {([
                  ["rest", bench?.probes.rest], ["rest_admin", bench?.probes.rest_admin], ["rest_browser", bench?.probes.rest_browser],
                  ["sense", bench?.probes.sense], ["sense_act", bench?.probes.sense_act],
                ] as const).map(([name, p]) => (
                  <div key={name} className="flex items-center gap-1.5 rounded bg-zinc-950/60 px-1.5 py-0.5 text-zinc-500" title={`${name}: n=${p?.n ?? 0}, max=${p?.max ?? "—"}ms`}>
                    <span className="w-20 shrink-0 text-zinc-400">{name}</span>
                    <span>n{p?.n ?? 0}</span>
                    <span className="ml-auto">p50 {p?.p50 != null ? `${p.p50}ms` : "—"}</span>
                    <span>p95 {p?.p95 != null ? `${p.p95}ms` : "—"}</span>
                    <span>p99 {p?.p99 != null ? `${p.p99}ms` : "—"}</span>
                  </div>
                ))}
              </div>
              {bench?.verdict === "FAIL" && (
                <p className="font-mono text-[9px] text-rose-300/90" role="status">пороги нарушены: {bench.fails.join(" · ")}</p>
              )}
            </div>
          </Sec>

          {/* R26 B1: EVAL */}
          <Sec id="obs-eval" title="EVAL" icon={ClipboardCheck}
            right={
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => void runEval()} disabled={evalBusy} aria-label="Прогнать регресс-датасет"
                  title="POST /eval/run — золотой путь daemon; запрос долгий (2-10с), ждём честно"
                  className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-50">
                  {evalBusy ? "прогон…" : "прогнать"}
                </button>
                <button type="button" onClick={() => void loadEval()} aria-label="Обновить eval" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 transition hover:bg-zinc-800"><RefreshCw className="h-3 w-3" aria-hidden /></button>
              </span>
            }
          >
            <div className="space-y-1.5" aria-label="Регресс-датасет и eval-харнесс daemon">
              <div className="flex flex-wrap items-center gap-1.5">
                <SecLabel icon={ClipboardCheck} text="v" tone="text-zinc-500" title="ME22 (B1): read-only чеки контрактов; автопрогон на каждой инкарнации, история в SQLite" />
                <StateBadge state={evalState(evalData?.last?.verdict ?? "WARMUP")} size="xs" />
                <span data-testid="eval-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                  <Chip label="dataset" value={`v${evalData?.dataset_version ?? "—"}`} />
                  <Chip label="last" value={evalData?.last ? `${evalData.last.verdict} ${evalData.last.passed}/${evalData.last.total}` : "—"}
                    tone={evalData?.last ? (evalData.last.verdict === "PASS" ? "emerald" : evalData.last.failed ? "rose" : "amber") : "zinc"} />
                  <Chip label="warn" value={evalData?.last?.warned ?? 0} tone={(evalData?.last?.warned ?? 0) > 0 ? "amber" : "zinc"} />
                  <Chip label="fail" value={evalData?.last?.failed ?? 0} tone={(evalData?.last?.failed ?? 0) > 0 ? "rose" : "zinc"} />
                  <Chip label="ms" value={evalData?.last ? evalData.last.duration_ms : "—"} />
                  <Chip label="runs" value={evalData?.runs_total ?? "—"} />
                </span>
              </div>
              {evalBusy && <p className="font-mono text-[9px] text-amber-300/90" role="status">прогон идёт — датасет v{evalData?.dataset_version ?? "?"} целиком, обычно 2-10с…</p>}
              {evalData?.last && evalData.last.verdict !== "PASS" && (
                <ul className="space-y-0.5" role="status">
                  {(evalData.last.results ?? []).filter((r) => !r.ok).slice(0, 5).map((r) => (
                    <li key={r.id} className={`font-mono text-[9px] ${r.critical ? "text-rose-300/90" : "text-amber-300/80"}`} title={`ожидание: ${r.expect}`}>
                      {r.critical ? "✗" : "⚠"} {r.id}: {r.evidence}
                    </li>
                  ))}
                </ul>
              )}
              {(evalData?.history ?? []).slice(0, 5).map((h) => (
                <div key={h.run_id} className="flex items-center gap-1.5 rounded bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[9px]" title={`run ${h.run_id} · ${h.started_at}`}>
                  <span className="shrink-0 text-zinc-600">{hhmmss(h.started_at)}</span>
                  <span className={`shrink-0 font-semibold ${h.verdict === "PASS" ? "text-emerald-400" : h.verdict === "FAIL" ? "text-rose-400" : "text-amber-400"}`}>{h.verdict}</span>
                  <span className="text-zinc-500">{h.passed}/{h.total}</span>
                  <span className="ml-auto text-zinc-600">{h.duration_ms}ms</span>
                </div>
              ))}
            </div>
          </Sec>

          {/* R31 D4: DB·HYGIENE */}
          <Sec id="obs-hygiene" title="DB·HYGIENE" icon={Database} tone="teal"
            right={
              <span className="flex items-center gap-1" data-testid="hygiene-actions">
                <button type="button" onClick={() => void hygOp("checkpoint")} disabled={hygBusy} aria-label="Выполнить WAL checkpoint (TRUNCATE)"
                  className="rounded border border-teal-900/60 px-1.5 py-0.5 font-mono text-[9px] text-teal-300/90 transition hover:bg-zinc-800 disabled:opacity-40">checkpoint</button>
                <button type="button" onClick={() => void hygOp("vacuum")} disabled={hygBusy} aria-label="Выполнить VACUUM базы данных"
                  className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-40">vacuum</button>
                <button type="button" onClick={() => void loadHyg()} aria-label="Обновить статус гигиены БД" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 transition hover:bg-zinc-800"><RefreshCw className="h-3 w-3" aria-hidden /></button>
              </span>
            }
          >
            <div className="space-y-1.5" aria-label="Гигиена базы данных daemon">
              <div data-testid="hygiene-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                <Chip label="journal" value={hyg?.db.journal_mode ?? "—"} title={`journal_mode=${hyg?.db.journal_mode ?? "—"}, страниц=${hyg?.db.page_count ?? "—"}`} />
                <Chip label="db" value={hyg ? `${hyg.db.file_mb}MB` : "—"} />
                <Chip label="wal" value={hyg ? `${hyg.db.wal_mb}MB` : "—"} tone={hyg && hyg.db.wal_mb >= 50 ? "amber" : "zinc"} title="TRUNCATE-checkpoint обнуляет WAL" />
                <Chip label="free" value={hyg ? `${hyg.db.freelist_pct}%` : "—"} tone={hyg && hyg.db.freelist_pct >= 30 ? "amber" : "zinc"}
                  title={`freelist ${hyg?.db.freelist_count ?? "—"} страниц — фрагментация; VACUUM осмыслен при ≥10%`} />
                <Chip label="idx" value={hyg?.indexes.length ?? "—"} title={`горячие индексы: ${hyg?.indexes.slice(0, 8).join(", ") ?? "—"}…`} />
              </div>
              {hyg?.last_runs[0] && (
                <p className="truncate font-mono text-[9px] text-zinc-600" title={hyg.last_runs[0].detail}>
                  last: {hyg.last_runs[0].op} {hyg.last_runs[0].ok ? "✓" : "✗"} {hyg.last_runs[0].duration_ms}ms · {hyg.last_runs[0].age_s}s назад{hyg.last_runs[0].detail ? ` · ${hyg.last_runs[0].detail}` : ""}
                </p>
              )}
            </div>
          </Sec>

          {/* R38 H1: AUTONOMY·V4 */}
          <Sec id="obs-autonomy" title="AUTONOMY·V4" icon={Activity} tone="violet">
            <div className="space-y-1.5" aria-label="Плоскость автономии v4">
              <div data-testid="autonomy-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                <span className={`rounded border px-1 py-0.5 ${autonomy ? (autonomy.liveness.verdict === "LIVE" ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300" : "border-rose-900/60 bg-rose-950/30 text-rose-300 animate-pulse") : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`}
                  title={autonomy ? (autonomy.liveness.stalled_reasons.join("; ") || `предикатов=${autonomy.liveness.checks.length}: ${autonomy.liveness.checks.map((c) => `${c.id}=${c.ok ? "✓" : "✗"}`).join(" ")}`) : "живость системы"}>
                  {autonomy ? autonomy.liveness.verdict : "—"}
                </span>
                <span className={`rounded border px-1 py-0.5 ${autonomy ? (autonomy.budget.state === "OK" ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300" : autonomy.budget.state === "WARN" ? "border-amber-900/60 bg-amber-950/30 text-amber-300" : "border-rose-900/60 bg-rose-950/30 text-rose-300") : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`}
                  title={autonomy ? `кумулятивный blast-radius за ${autonomy.budget.window_h}ч: ${autonomy.budget.score} (WARN≥${autonomy.budget.warn}, BREACH≥${autonomy.budget.breach})` : "риск-бюджет"}>
                  {autonomy ? `risk ${autonomy.budget.score}/${autonomy.budget.breach} ${autonomy.budget.state}` : "—"}
                </span>
                <span className={`rounded border px-1 py-0.5 ${autonomy ? (autonomy.non_bypass.verdict === "NO_BYPASS" ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300" : "border-rose-900/60 bg-rose-950/30 text-rose-300") : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`}
                  title={autonomy ? `proof-of-non-bypass · POST-маршрутов: ${autonomy.non_bypass.post_routes.length}${autonomy.non_bypass.unknown.length ? ` · НЕ ПОКРЫТЫ: ${autonomy.non_bypass.unknown.join(",")}` : ""}` : "proof-of-non-bypass"}>
                  {autonomy ? `no-bypass ${autonomy.non_bypass.post_routes.length}` : "—"}
                </span>
                <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400"
                  title={autonomy ? autonomy.recovery.map((r) => `${r.level} ${r.component}: ${r.status}`).join("\n") : "иерархия восстановления"}>
                  recovery {autonomy ? `L0–L${autonomy.recovery.length - 1}` : "—"}
                </span>
                <span className={`rounded border px-1 py-0.5 ${autonomy && !autonomy.independence.reviewer_writes_status && autonomy.independence.chain_ok ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300" : "border-amber-900/60 bg-amber-950/30 text-amber-300"}`}
                  title={autonomy ? `независимость аудитора · chain ok=${autonomy.independence.chain_ok} (${autonomy.independence.chain_checked})` : "независимость аудитора"}>
                  ind ✓
                </span>
              </div>
              {autonomy && autonomy.liveness.stalled_reasons.length > 0 && (
                <p className="truncate font-mono text-[9px] text-rose-300" role="alert" title={autonomy.liveness.stalled_reasons.join("; ")}>{autonomy.liveness.stalled_reasons.join(" · ")}</p>
              )}
            </div>
          </Sec>

          {/* SPANS·OTEL + VERDICTS (RH) */}
          <Sec id="obs-otel" title="SPANS·OTEL + VERDICTS" icon={Radio} tone="cyan">
            <div className="space-y-1.5" aria-label="OTel-lite спаны и reward-hacking вердикты">
              <div data-testid="otel-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                <Chip label="spans" value={otel ? `${otel.spans}/${otel.ringCap}` : "—"} title="OTel-lite: спаны команд шины и задач; OTLP-JSON на /spans/otlp" />
                <Chip label="dropped" value={otel?.dropped ?? "—"} tone={(otel?.dropped ?? 0) > 0 ? "rose" : "zinc"} />
                <Chip label="verdicts RH" value={vd?.count ?? "—"} tone={(vd?.count ?? 0) > 0 ? "rose" : "zinc"}
                  title="Reward-hacking вердикты (tier-1): finish без реальной работы. Подозрение не меняет статус задачи — решает оператор" />
              </div>
              <div className="space-y-0.5 font-mono text-[9px]">
                {(otel?.stats ?? []).slice(0, 5).map((s) => (
                  <div key={s.name} className={`flex items-center gap-1.5 rounded bg-zinc-950/60 px-1.5 py-0.5 ${s.err ? "text-rose-300/90" : "text-zinc-500"}`} title={`${s.name}: max=${s.maxMs}ms`}>
                    <span className="min-w-0 flex-1 truncate text-zinc-400">{s.name}</span>
                    <span>×{s.n}</span>
                    <span>⌀{s.avgMs}ms</span>
                    {s.err > 0 && <span className="text-rose-400/90">err {s.err}</span>}
                  </div>
                ))}
                {vd && vd.verdicts.slice(0, 4).map((v) => (
                  <button key={v.seq} type="button" onClick={() => v.task_id && openTask(v.task_id)}
                    className={`flex w-full items-center gap-1.5 rounded bg-zinc-950/60 px-1.5 py-0.5 text-left transition hover:bg-zinc-900/70 ${v.task_id ? "cursor-pointer" : "cursor-default"}`}
                    title={v.task_id ? `открыть задачу ${v.task_id}` : "вердикт без задачи"}>
                    <span className="shrink-0 text-zinc-600">#{v.seq}</span>
                    <span className="min-w-0 flex-1 truncate text-rose-300/90">{v.task_id ?? "—"}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-500" title={(v.reasons ?? []).join(", ")}>{(v.reasons ?? []).join(", ") || "—"}</span>
                  </button>
                ))}
              </div>
            </div>
          </Sec>
        </div>
      </div>
    </div>
  );
}
