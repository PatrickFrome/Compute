"use client";
// ── ME2 PAGE: TASKS (R74) — порт legacy «ВЕТКИ·ЗАДАЧИ» + «ОЧЕРЕДЬ ЗАДАЧ» + «METRICS·РЕТРАИ» ──
// Источник: docs/legacy-mission-control.tsx.txt (BranchGraph L409-684, вкладки L2636-2717,
// очередь L2728-2760, retry-metrics L1318-1328/2607-2620). Клик по ветви/задаче → Task Sheet
// (глобальный оверлей стора). Стиль: zinc+emerald плотный, font-mono для данных.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AppWindow, Activity, GitBranch, ListChecks, MonitorPlay, MousePointerClick, Plus, RefreshCw,
} from "lucide-react";
import {
  BRANCH_COLOR, BRANCH_TABS, age, hhmmss, loadBrowserTabs, me2Fetch, taskAction,
  type BranchTabKey, type BrowserTab, type Task,
} from "@/lib/me2-bus";
import { agentChatOp } from "@/lib/me2-socket";
import { useMe2 } from "@/components/me2/store";
import { Chip, PageHeader, Sec, StatusBadge } from "@/components/me2/ui/primitives";
import MirrorPanel from "@/components/me2/mirror-panel";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

// ── типы (порт legacy L55-56) ───────────────────────────────────────────────────
type Reflection = {
  v?: number; cause?: string; what?: string; hint?: string; error?: string; steps?: number; max_steps?: number; at?: string;
  llm?: { lesson?: string; fix?: string; model?: string; source?: string; at?: string };
  signals?: { loop_top?: number; tool_calls?: number; distinct?: number; writes?: number; tool_errors?: number; parse_fails?: number };
};
type RetryMetrics = {
  retries: number;
  with_lesson: { n: number; completed: number; rate: number | null };
  without_lesson: { n: number; completed: number; rate: number | null };
  ab?: { treatment: { n: number; completed: number; rate: number | null }; control: { n: number; completed: number; rate: number | null }; control_crossover: number };
};
const CAUSE_RU: Record<string, string> = {
  budget_exhausted: "бюджет шагов",
  provider_unavailable: "провайдер недоступен",
  workspace_path: "путь workspace",
  protocol_violation: "нарушение JSON-протокола",
  runtime_error: "ошибка шага",
  step_loop: "цикл действий",
  context_overflow: "переполнение контекста",
  task_drift: "дрейф задачи",
};

/** Точка статуса на конце ветви (SVG) — порт legacy L372-402 1:1. */
function BranchDot({ status, x, y, color }: { status: string; x: number; y: number; color: string }) {
  if (status === "RUNNING") {
    return (
      <>
        <circle cx={x} cy={y} r={5} fill={color} opacity={0.5} className="svg-ping" />
        <circle cx={x} cy={y} r={4.5} fill={color} className="svg-beat" />
      </>
    );
  }
  if (status === "SCHEDULED") {
    return (
      <g className="branch-dot">
        <circle cx={x} cy={y} r={5} fill="none" stroke={color} strokeWidth={1.6} />
        <path d={`M ${x} ${y - 2.6} L ${x} ${y} L ${x + 1.9} ${y + 0.6}`} fill="none" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
      </g>
    );
  }
  const hollow = status === "READY" || status === "ARCHIVED";
  return (
    <circle
      cx={x}
      cy={y}
      r={status === "ARCHIVED" ? 4 : 4.6}
      fill={hollow ? "#09090b" : color}
      stroke={color}
      strokeWidth={hollow ? 1.8 : 0}
      opacity={status === "ARCHIVED" ? 0.75 : 1}
      className="branch-dot"
    />
  );
}

/** Git-подобный граф ветвей — полный порт legacy L404-684.
 *  Рейка таймлайна, каждая задача — ветвь с точкой статуса; retry-линии (parent_id → merge-дуга
 *  к родителю); hover-tooltip через portal (fixed, не обрезается скролл-контейнером); окно 60
 *  ветвей (старшие скрыты за toggle); ↻ retry и ✦ LLM-рефлексия на FAILED/CANCELLED строках. */
function BranchGraph({ tasks, onOpen, onRetry, onReflect, reflectingId }: {
  tasks: Task[];
  onOpen: (t: Task) => void;
  onRetry: (t: Task) => void;
  onReflect?: (t: Task) => void;
  reflectingId?: string | null;
}) {
  const ROW_H = 30, W = 340, RAIL_X = 16, FORK_X = 46, DOT_X = 208, TEXT_X = 220, STEPS_X = 334;
  const WINDOW = 60;
  const [hover, setHover] = useState<{ t: Task; top: number; left: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const displayed = useMemo(
    () => (showAll || tasks.length <= WINDOW ? tasks : tasks.slice(-WINDOW)),
    [tasks, showAll],
  );
  const h = Math.max(40, displayed.length * ROW_H + 26);
  // merge-линии: дочерняя задача (parent_id) тянется дугой к родителю (TASK_RETRY lineage)
  const links = useMemo(() => {
    const idx = new Map(displayed.map((t, i) => [t.id, i] as const));
    const out: { fromY: number; toY: number }[] = [];
    displayed.forEach((t, i) => {
      const pi = t.parent_id ? idx.get(t.parent_id) : undefined;
      if (pi === undefined) return;
      out.push({ fromY: 20 + pi * ROW_H, toY: 20 + i * ROW_H });
    });
    return out;
  }, [displayed]);
  // координатная база — хит-зона строки (rect.branch-hover, ровно 30px), НЕ сам <g>:
  // bbox g включает path ветви от рейки и тянется на пол-графа, из-за чего tooltip
  // позиционировался мимо вьюпорта при скролле секции (урок R9 legacy)
  const rowRect = (t: Task): DOMRect | null => {
    const el = document.querySelector(`g[data-branch-id="${t.id}"] rect.branch-hover`);
    return el ? el.getBoundingClientRect() : null;
  };
  const track = (t: Task) => (_e: React.MouseEvent | React.FocusEvent) => {
    const r = rowRect(t);
    if (!r) return;
    setHover({ t, top: r.top, left: r.left });
  };
  const clr = (id: string) => setHover((cur) => (cur?.t.id === id ? null : cur));
  // координаты tooltip-а живут, пока живёт hover: скролл любого контейнера (capture), ресайз
  // окна и движение мыши по строке обновляют позицию (урок R12 legacy)
  const hoverId = hover?.t.id;
  useEffect(() => {
    if (!hoverId) return;
    const update = () => {
      const el = document.querySelector(`g[data-branch-id="${hoverId}"]`);
      if (!el) return;
      const r = el.querySelector("rect.branch-hover")?.getBoundingClientRect();
      if (!r) return;
      setHover((cur) => (cur && cur.t.id === hoverId ? { ...cur, top: r.top, left: r.left } : cur));
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hoverId]);
  return (
    <div className="relative">
      {tasks.length > WINDOW && (
        <div className="flex items-center justify-between gap-2 px-1 pb-1 font-mono text-[9px] text-zinc-500">
          <span>{showAll ? `все ${tasks.length} ветвей` : `последние ${WINDOW} из ${tasks.length} · старшие скрыты`}</span>
          <button
            className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "свернуть" : "показать все"}
          </button>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${h}`}
        className="h-auto w-full"
        role="img"
        aria-label="Граф ветвей задач"
        preserveAspectRatio="xMidYMin meet"
      >
        <line x1={RAIL_X} y1={6} x2={RAIL_X} y2={h - 8} stroke="#3f3f46" strokeWidth={2.5} strokeLinecap="round" />
        {links.map((l, i) => (
          <path
            key={`m${i}`}
            className="branch-merge"
            d={`M ${DOT_X + 3} ${l.fromY} C ${DOT_X + 30} ${l.fromY}, ${FORK_X - 30} ${l.toY}, ${FORK_X} ${l.toY}`}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={1.4}
          />
        ))}
        {displayed.map((t, i) => {
          const y = 20 + i * ROW_H;
          const color = BRANCH_COLOR[t.status] ?? "#a1a1aa";
          const d = `M ${RAIL_X} 10 C ${RAIL_X} ${y - 16}, ${RAIL_X + 9} ${y}, ${FORK_X} ${y} L ${DOT_X} ${y}`;
          const title = t.title.length > 15 ? `${t.title.slice(0, 13)}…` : t.title;
          const delay = Math.min(i, 12) * 0.07;
          const set = track(t);
          const clearThis = () => clr(t.id);
          return (
            <g
              key={t.id}
              className="branch-row"
              data-branch-id={t.id}
              onClick={() => onOpen(t)}
              onMouseEnter={set}
              onMouseMove={set}
              onMouseLeave={clearThis}
              onFocus={set}
              onBlur={clearThis}
              role="button"
              tabIndex={0}
              aria-label={`Задача ${t.title} · ${t.status} · ${t.steps} из ${t.max_steps} шагов`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(t); } }}
            >
              <rect className="branch-hover" x={4} y={y - ROW_H / 2 + 2} width={W - 8} height={ROW_H - 4} rx={6} fill="#ffffff" />
              <title>{`${t.title} · ${t.status} · ${t.steps}/${t.max_steps}`}</title>
              <path
                className="branch-line branch-draw"
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={2.2}
                strokeLinecap="round"
                pathLength={1}
                style={{ animationDelay: `${delay}s` }}
              />
              <BranchDot status={t.status} x={DOT_X} y={y} color={color} />
              <text x={TEXT_X} y={y + 3.6} fontSize={10} className="branch-dot fill-zinc-200 font-mono" style={{ animationDelay: `${0.4 + delay}s` }}>
                {title}
              </text>
              <text x={STEPS_X} y={y + 3.6} fontSize={9} textAnchor="end" className="branch-dot fill-zinc-500 font-mono" style={{ animationDelay: `${0.4 + delay}s` }}>
                {t.steps}/{t.max_steps}
              </text>
              {(t.status === "FAILED" || t.status === "CANCELLED") && (
                <>
                  <g
                    className="branch-retry cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); onRetry(t); }}
                    role="button"
                    tabIndex={-1}
                    aria-label={`Повторить задачу ${t.title}`}
                  >
                    <title>{"Повторить (TASK_RETRY: +2 шага, рефлексия родителя в контексте)"}</title>
                    <circle cx={STEPS_X - 34} cy={y} r={7.5} fill="transparent" className="hover:fill-amber-500/20" />
                    <text x={STEPS_X - 34} y={y + 3.4} fontSize={9.5} textAnchor="middle" className="fill-amber-500/70 font-mono hover:fill-amber-300" style={{ pointerEvents: "none" }}>
                      ↻
                    </text>
                  </g>
                  {onReflect ? (
                    <g
                      className="branch-reflect cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); onReflect(t); }}
                      role="button"
                      tabIndex={-1}
                      aria-label={`Сгенерировать LLM-рефлексию для задачи ${t.title}`}
                    >
                      <title>{"LLM-рефлексия (tier-2): вербальный урок провала — через супервизора флота (R44)"}</title>
                      <circle cx={STEPS_X - 50} cy={y} r={7.5} fill="transparent" className="hover:fill-violet-500/20" />
                      <text
                        x={STEPS_X - 50}
                        y={y + 3.6}
                        fontSize={9.5}
                        textAnchor="middle"
                        className={`font-mono ${reflectingId === t.id ? "fill-violet-300" : "fill-violet-500/70 hover:fill-violet-300"}`}
                        style={{ pointerEvents: "none" }}
                      >
                        {reflectingId === t.id ? "◌" : "✦"}
                      </text>
                    </g>
                  ) : null}
                </>
              )}
            </g>
          );
        })}
      </svg>
      {hover && typeof document !== "undefined"
        ? createPortal(
            (() => {
              const color = BRANCH_COLOR[hover.t.status] ?? "#a1a1aa";
              const kids = tasks.filter((x) => x.parent_id === hover.t.id).length;
              // адаптивный порог above — большие tooltip-ы (рефлексия+сигналы+llm-блок) обрезались
              // вверху вьюпорта при фиксированном пороге (урок R12 legacy)
              let estH = 96;
              if (hover.t.reflection) {
                try {
                  const rr = JSON.parse(hover.t.reflection) as Reflection;
                  if (rr.cause) estH += 100;
                  if (rr.llm?.lesson) estH += 88;
                } catch { /* без оценки — базовый порог */ }
              }
              const above = hover.top > estH + 16;
              return (
                <div
                  role="tooltip"
                  className="branch-tooltip pointer-events-none fixed z-50 w-max max-w-[300px] rounded-md border border-zinc-700 bg-zinc-950/95 px-2.5 py-1.5 shadow-xl shadow-black/50"
                  style={{
                    left: Math.max(8, Math.min(hover.left + 26, (typeof window !== "undefined" ? window.innerWidth : 1024) - 312)),
                    ...(above
                      ? { bottom: (typeof window !== "undefined" ? window.innerHeight : 800) - hover.top + 8 }
                      : { top: hover.top + 34 }),
                  }}
                >
                  <div className="font-sans text-[11px] font-semibold leading-snug text-zinc-100">{hover.t.title}</div>
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px]">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                    <span style={{ color }}>{hover.t.status}</span>
                    <span className="text-zinc-500">· шаги {hover.t.steps}/{hover.t.max_steps}</span>
                    {kids > 0 && <span className="text-amber-400">· ↳ {kids} retry</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] text-zinc-500">
                    {hover.t.id.slice(0, 18)} · создана {age(hover.t.created_at)} назад
                    {hover.t.parent_id ? <span className="text-amber-400/90"> · ветвь от {hover.t.parent_id.slice(0, 16)}</span> : null}
                  </div>
                  {hover.t.error ? <div className="mt-1 max-w-[280px] truncate font-mono text-[9px] text-rose-400">⚠ {hover.t.error}</div> : null}
                  {(() => {
                    if (!hover.t.reflection) return null;
                    let r: Reflection;
                    try {
                      r = JSON.parse(hover.t.reflection) as Reflection;
                    } catch { return null; }
                    return (
                      <>
                        {r.cause ? (
                          <div className="mt-1.5 rounded border border-amber-900/60 bg-amber-950/30 px-1.5 py-1">
                            <div className="flex items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-amber-400">
                              <span>рефлексия</span>
                              <span className="rounded bg-amber-500/15 px-1 normal-case text-amber-300">{CAUSE_RU[r.cause] ?? r.cause}</span>
                            </div>
                            <div className="mt-0.5 text-[9.5px] leading-snug text-zinc-300">{r.what}</div>
                            {r.signals ? (
                              <div className="mt-0.5 font-mono text-[8.5px] leading-snug text-amber-500/70">
                                вызовы {r.signals.tool_calls ?? 0} · уник. {r.signals.distinct ?? 0} · записей {r.signals.writes ?? 0}
                                {(r.signals.loop_top ?? 0) > 0 || (r.signals.tool_errors ?? 0) > 0 || (r.signals.parse_fails ?? 0) > 0
                                  ? ` · аномалии: цикл×${r.signals.loop_top ?? 0} инстр-ошибки×${r.signals.tool_errors ?? 0} репарс×${r.signals.parse_fails ?? 0}`
                                  : null}
                              </div>
                            ) : null}
                            <div className="mt-0.5 text-[9.5px] leading-snug text-emerald-300/90">↳ {r.hint}</div>
                          </div>
                        ) : null}
                        {r.llm?.lesson ? (
                          <div className="mt-1.5 rounded border border-violet-900/60 bg-violet-950/30 px-1.5 py-1">
                            <div className="flex items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-violet-400">
                              <span>llm-рефлексия</span>
                              <span className="rounded bg-violet-500/15 px-1 normal-case text-violet-300">tier-2</span>
                              {r.llm.source === "auto_retry" ? <span className="rounded bg-fuchsia-500/15 px-1 normal-case text-fuchsia-300">авто</span> : null}
                              {r.llm.model ? <span className="normal-case text-violet-500/80">{r.llm.model}</span> : null}
                            </div>
                            <div className="mt-0.5 text-[9.5px] leading-snug text-zinc-200">{r.llm.lesson}</div>
                            {r.llm.fix ? <div className="mt-0.5 text-[9.5px] leading-snug text-sky-300/90">→ {r.llm.fix}</div> : null}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              );
            })(),
            document.body,
          )
        : null}
    </div>
  );
}

// ── PAGE ────────────────────────────────────────────────────────────────────────
export function TasksPage() {
  const { toast } = useToast();
  const snap = useMe2((s) => s.snap);
  const nowMs = useMe2((s) => s.nowMs);
  const openTask = useMe2((s) => s.openTask);
  const setChatId = useMe2((s) => s.setChatId);
  const setDialog = useMe2((s) => s.setDialog);

  // вкладка-фильтр ветвей
  const [branchTab, setBranchTab] = useState<BranchTabKey>("ALL");

  // R11 legacy: pass-rate ретраев с LLM-уроком vs без — /metrics, поллинг 20s
  const [retryMetrics, setRetryMetrics] = useState<RetryMetrics | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () => me2Fetch<RetryMetrics & { ok: boolean }>("/metrics?XTransformPort=3041")
      .then((d) => { if (!dead && d?.ok) setRetryMetrics(d); })
      .catch(() => { /* daemon недоступен — чип просто скрыт */ });
    void load();
    const iv = setInterval(load, 20_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  // R44 legacy: провал уходит живому супервизору чат-флота (op:"send" через socket ack)
  const [reflectingId, setReflectingId] = useState<string | null>(null);
  const reflectTask = useCallback(async (t: Task) => {
    setReflectingId(t.id);
    try {
      const list = await me2Fetch<{ sessions?: Array<{ id: string; role: string; status: string; title: string }> }>("/agentchat?XTransformPort=3041");
      const sup = list?.sessions?.find((s) => s.role === "SUPERVISOR" && s.status === "ACTIVE");
      if (!sup) {
        toast({ title: "флот недоступен", description: "нет активного супервизора — создайте чат-агента", variant: "destructive" });
        return;
      }
      const r = await agentChatOp({ op: "send", id: sup.id, text: `Разбери провал задачи ${t.id} «${t.title}» (статус ${t.status}). Диагноз и урок — reply; фиксацию исхода — report_outcome (outcome-proof).` });
      if (r.ok) {
        toast({ title: "провал передан флоту ✓", description: `супервизор «${sup.title}» координирует разбор` });
        setChatId(sup.id);
      } else {
        toast({ title: "передача флоту ✗", description: r.error ?? "ошибка", variant: "destructive" });
      }
    } catch {
      toast({ title: "передача флоту ✗", description: "daemon недоступен", variant: "destructive" });
    } finally {
      setReflectingId(null);
    }
  }, [setChatId, toast]);

  // retry ↻ на ветви — TASK_RETRY через шину
  const retryBranch = useCallback(async (t: Task) => { await taskAction("TASK_RETRY", t.id); }, []);

  // v0.6.0 legacy: живые вкладки agent-browser в шапке секции ВЕТКИ
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [castOn, setCastOn] = useState(false);
  const [castCtl, setCastCtl] = useState(false);
  const refreshTabs = useCallback(async () => {
    setBrowserBusy(true);
    try { setBrowserTabs(await loadBrowserTabs()); }
    finally { setBrowserBusy(false); }
  }, []);
  useEffect(() => { void refreshTabs(); const iv = setInterval(() => void refreshTabs(), 15_000); return () => clearInterval(iv); }, [refreshTabs]);
  // тумблеры live/руль управляют стримом :3042 глобально (BrowserStage на COMMAND) —
  // мост через window-события (расширение legacy-контракта window-событий)
  const toggleCast = useCallback((on: boolean) => {
    setCastOn(on);
    window.dispatchEvent(new CustomEvent("me2:cast-toggle", { detail: { on } }));
  }, []);
  const toggleCastCtl = useCallback((on: boolean) => {
    setCastCtl(on);
    window.dispatchEvent(new CustomEvent("me2:cast-ctl", { detail: { on } }));
  }, []);

  // ── панель ВЕТКИ: данные + счётчики вкладок (порт legacy L2124-2139) ──────────
  const branchData = useMemo(() => [...(snap?.tasks ?? []), ...(snap?.archived ?? [])], [snap]);
  const branchCounts = useMemo(() => {
    const c: Record<BranchTabKey, number> = { ALL: branchData.length, ACTIVE: 0, DONE: 0, CANCELLED: 0, ARCHIVE: 0 };
    for (const t of branchData) {
      if (t.status === "READY" || t.status === "RUNNING") c.ACTIVE++;
      else if (t.status === "COMPLETED" || t.status === "FAILED") c.DONE++;
      else if (t.status === "CANCELLED") c.CANCELLED++;
      else if (t.status === "ARCHIVED") c.ARCHIVE++;
    }
    return c;
  }, [branchData]);
  const branchTasks = useMemo(() => {
    const tab = BRANCH_TABS.find((x) => x.key === branchTab) ?? BRANCH_TABS[0];
    return branchData.filter((t) => tab.match(t.status)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [branchData, branchTab]);

  // ОЧЕРЕДЬ: READY/HANDED_OFF/PARKED (R72 park-and-resume виден честно)
  const queueTasks = useMemo(
    () => (snap?.tasks ?? []).filter((t) => t.status === "READY" || t.status === "HANDED_OFF" || t.status === "PARKED"),
    [snap],
  );
  const etaOf = useCallback((t: Task): string | null => {
    const nb = t.not_before_ms ?? 0;
    if (t.status === "PARKED" || nb > nowMs) {
      const remain = Math.max(1, Math.ceil((nb - nowMs) / 1000));
      return `парковка до ${nb ? hhmmss(new Date(nb).toISOString()) : "—"} · ещё ${remain}с`;
    }
    return null;
  }, [nowMs]);

  const retryChip = retryMetrics && retryMetrics.retries > 0 && (
    <span
      className="hidden font-mono text-[9px] text-zinc-500 sm:inline"
      title="Pass-rate ретраев: завершено с LLM-уроком (violet) vs без — живое измерение Reflexion-эффекта (/metrics). A/B — рандомизированные группы авто-рефлексии: treatment получает авто-урок, control — нет (intent-to-treat); crossover — контрольные, получившие ручной урок"
    >
      ↳ <span className="text-violet-400">{retryMetrics.with_lesson.completed}/{retryMetrics.with_lesson.n}</span> с уроком · <span className="text-zinc-400">{retryMetrics.without_lesson.completed}/{retryMetrics.without_lesson.n}</span> без
      {retryMetrics.ab && (retryMetrics.ab.treatment.n > 0 || retryMetrics.ab.control.n > 0) ? (
        <>
          {" "}· A/B <span className="text-fuchsia-400">T {retryMetrics.ab.treatment.completed}/{retryMetrics.ab.treatment.n}</span> · <span className="text-zinc-500">C {retryMetrics.ab.control.completed}/{retryMetrics.ab.control.n}</span>
          {retryMetrics.ab.control_crossover > 0 ? <span className="text-amber-400/80"> · x{retryMetrics.ab.control_crossover}</span> : null}
        </>
      ) : null}
    </span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-tasks" data-panel-tasks>
      <PageHeader
        title="TASKS"
        sub="ветки · очередь · метрики ретраев"
        actions={retryChip}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        {/* ── лево: ВЕТКИ·ЗАДАЧИ (граф + вкладки + вкладки браузера) ── */}
        <div className="flex min-h-0 min-w-0 flex-col lg:flex-[2]">
          <Sec
            id="tasks-branches" defaultOpen
            title={`ВЕТКИ · ЗАДАЧИ (${branchData.length})`}
            icon={GitBranch}
            tone="violet"
            right={<span className="font-mono text-[9px] text-zinc-600">git-graph</span>}
          >
            {/* вкладки в стиле браузера — контейнер relative: на узких экранах tab-полоса
                скроллится, правый градиент (pointer-events:none — урок legacy №1) показывает это */}
            <div className="relative shrink-0" data-testid="branch-tabs-fade">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-zinc-950 to-transparent md:hidden"
              />
              <div className="flex items-end gap-1 overflow-x-auto border-b border-zinc-800 px-1 pb-0 pt-1 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-zinc-700" role="tablist" aria-label="Фильтр ветвей">
                {BRANCH_TABS.map((tb) => {
                  const active = branchTab === tb.key;
                  return (
                    <button
                      key={tb.key}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setBranchTab(tb.key)}
                      className={`-mb-px flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-[10px] transition ${
                        active
                          ? "border-zinc-700 bg-zinc-900 text-zinc-100 shadow-[0_-2px_6px_rgba(0,0,0,0.35)]"
                          : "border-transparent text-zinc-500 hover:bg-zinc-900/70 hover:text-zinc-300"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${tb.dot}`} aria-hidden />
                      {tb.label}
                      <span className="font-mono text-[9px] text-zinc-600">{branchCounts[tb.key]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* вкладки браузера: живые вкладки agent-browser (v0.6.0) */}
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800/60 bg-black/20 px-1 py-1.5" aria-label="Ветки браузера">
              <span className="flex shrink-0 items-center gap-1 pr-1 text-[9px] font-semibold tracking-widest text-zinc-500">
                <AppWindow className="h-3 w-3 text-sky-400" aria-hidden /> БРАУЗЕР
              </span>
              {browserTabs.length === 0 && !browserBusy && (
                <button type="button" onClick={() => void refreshTabs()} className="shrink-0 text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
                  показать вкладки
                </button>
              )}
              {browserTabs.map((t) => (
                <span
                  key={t.id}
                  title={`${t.title}\n${t.url}`}
                  className={`flex max-w-44 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2 py-1 text-[10px] transition ${
                    t.active
                      ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                      : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.active ? "bg-sky-400" : "bg-zinc-600"}`} aria-hidden />
                  <span className="truncate">{t.title.slice(0, 26) || t.url}</span>
                </span>
              ))}
              <button
                type="button"
                onClick={() => toggleCast(!castOn)}
                aria-pressed={castOn}
                title="Живой вид активной вкладки — WS-стрим агента-браузера (:3042, Stage на COMMAND)"
                className={`ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] transition ${
                  castOn ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                <MonitorPlay className="h-3 w-3" aria-hidden />
                live
              </button>
              {castOn && (
                <button
                  type="button"
                  onClick={() => toggleCastCtl(!castCtl)}
                  aria-pressed={castCtl}
                  title="Руль: клики, клавиатура и колесо в кадре идут в активную вкладку. Ctrl/Meta-комбо остаются у оператора."
                  className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] transition ${
                    castCtl ? "bg-amber-500/15 text-amber-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  }`}
                >
                  <MousePointerClick className="h-3 w-3" aria-hidden />
                  руль
                </button>
              )}
              <button
                type="button"
                onClick={() => void refreshTabs()}
                aria-label="Обновить вкладки браузера"
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
              >
                <RefreshCw className={`h-3 w-3 ${browserBusy ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
            <div className="px-1 py-1">
              {branchTasks.length === 0 ? (
                <p className="p-4 text-center text-xs text-zinc-500">в этой вкладке ветвей нет</p>
              ) : (
                <BranchGraph
                  tasks={branchTasks}
                  onOpen={(t) => openTask(t.id)}
                  onRetry={(t) => void retryBranch(t)}
                  onReflect={(t) => void reflectTask(t)}
                  reflectingId={reflectingId}
                />
              )}
            </div>
          </Sec>
        </div>

        {/* ── право: ОЧЕРЕДЬ + METRICS + MIRROR ── */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto mc-scroll lg:flex-[1]">
          <Sec
            id="tasks-queue"
            title={`ОЧЕРЕДЬ ЗАДАЧ (${queueTasks.length})`}
            icon={ListChecks}
            tone="emerald"
            right={
              <Button size="sm" className="h-7 gap-1 bg-emerald-600 text-[11px] hover:bg-emerald-500" onClick={() => setDialog("newTask")}>
                <Plus className="h-3 w-3" aria-hidden /> задача
              </Button>
            }
          >
            {queueTasks.length === 0 && (
              <p className="p-4 text-center text-xs text-zinc-500">очередь пуста — нажмите N</p>
            )}
            <div className="space-y-1.5">
              {queueTasks.map((t) => {
                const eta = etaOf(t);
                return (
                  <button
                    key={t.id}
                    className="w-full rounded-md border border-zinc-800/80 bg-zinc-900/60 p-2.5 text-left transition hover:border-zinc-600 hover:bg-zinc-800/60"
                    onClick={() => openTask(t.id)}
                    aria-label={`Открыть задачу ${t.title}`}
                  >
                    <div className="flex items-center gap-2">
                      <StatusBadge status={t.status} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{t.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">{age(t.created_at)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress value={(t.steps / Math.max(1, t.max_steps)) * 100} className="h-1 flex-1 bg-zinc-800 [&>div]:bg-emerald-500" />
                      <span className="font-mono text-[9px] text-zinc-500">{t.steps}/{t.max_steps} шаг.</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-zinc-600">
                      <span className="truncate">{t.id}</span>
                      {t.role && <span className="shrink-0 rounded border border-zinc-700 px-1 text-[9px] text-zinc-500">{t.role}</span>}
                      {eta && <span className="ml-auto shrink-0 text-amber-400/90" title="park-and-resume (R72): задача не убита — ждёт окна квоты">{eta}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </Sec>

          <Sec id="tasks-metrics" title="METRICS · РЕТРАИ" icon={Activity} tone="violet">
            {!retryMetrics ? (
              <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">загрузка /metrics…</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                <Chip label="ретраев" value={retryMetrics.retries} tone="amber" title="всего TASK_RETRY-ветвей в выборке /metrics" />
                <Chip
                  label="с уроком"
                  value={`${retryMetrics.with_lesson.completed}/${retryMetrics.with_lesson.n}${retryMetrics.with_lesson.rate !== null ? ` · ${Math.round(retryMetrics.with_lesson.rate * 100)}%` : ""}`}
                  tone="violet"
                  title="ретраи, завершённые с LLM-уроком (авто-рефлексия) — pass-rate Reflexion-эффекта"
                />
                <Chip
                  label="без урока"
                  value={`${retryMetrics.without_lesson.completed}/${retryMetrics.without_lesson.n}${retryMetrics.without_lesson.rate !== null ? ` · ${Math.round(retryMetrics.without_lesson.rate * 100)}%` : ""}`}
                  tone="zinc"
                  title="ретраи без LLM-урока — контрольная группа Reflexion-эффекта"
                />
                {retryMetrics.ab && (
                  <>
                    <Chip label="A/B T" value={`${retryMetrics.ab.treatment.completed}/${retryMetrics.ab.treatment.n}`} tone="fuchsia" title="treatment: рандомизированная группа авто-рефлексии (intent-to-treat)" />
                    <Chip label="A/B C" value={`${retryMetrics.ab.control.completed}/${retryMetrics.ab.control.n}`} tone="zinc" title="control: группа без авто-урока" />
                    {retryMetrics.ab.control_crossover > 0 && (
                      <Chip label="crossover" value={`x${retryMetrics.ab.control_crossover}`} tone="amber" title="контрольные, получившие ручной урок" />
                    )}
                  </>
                )}
              </div>
            )}
          </Sec>

          <MirrorPanel />
        </div>
      </div>
    </div>
  );
}
