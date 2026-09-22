"use client";

/**
 * ME2 · MISSION CONTROL v4 — операторская консоль METAENGINE 2.
 * 3 колонки: ФЛОТ / ОЧЕРЕДЬ / EVENT-LOG + панель «ВЕТКИ» (git-граф задач с вкладками-«браузером»).
 * ⌘K с живым реестром действий (n/47), KPI-плитки с count-up, планировщик, пауза агентов, модели агентов.
 * СКРИНКАСТ + PAIR-CONTROL: live-вид вкладки (:3042, вне бюджета шины) + руль (клик/клавиатура/колесо).
 * Каналы: WS :3040 (snapshot push + события + команды), REST :3041 (fallback, evidence, catalog).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { io, type Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, AppWindow, Archive, Bot, Boxes, Check, CheckCircle2, ChevronDown, Clock, Cloud, CloudOff,
  Crosshair, Cpu, Download, Gauge, GitBranch, Layers, ListChecks, MonitorPlay, MousePointerClick, Network, Pause, Play, Plus,
  Radar, RefreshCw, RotateCcw, Rocket, Search, Sparkles, Terminal, Trash2, X, Zap,
} from "lucide-react";

// ── типы (зеркало store.ts daemon) ────────────────────────────────
type Agent = { id: string; role: string; status: string; model: string; paused: number; created_at: string; updated_at: string };
type Task = {
  id: string; title: string; spec: string; role: string | null; parent_id: string | null; status: string;
  agent_id: string | null; max_steps: number; steps: number; result: string | null;
  error: string | null; reflection: string | null; created_at: string; updated_at: string;
};
type Reflection = { v?: number; cause?: string; what?: string; hint?: string; error?: string; steps?: number; max_steps?: number; at?: string; llm?: { lesson?: string; fix?: string; model?: string; source?: string; at?: string }; signals?: { loop_top?: number; tool_calls?: number; distinct?: number; writes?: number; tool_errors?: number; parse_fails?: number } };
type RetryMetrics = { retries: number; with_lesson: { n: number; completed: number; rate: number | null }; without_lesson: { n: number; completed: number; rate: number | null }; ab?: { treatment: { n: number; completed: number; rate: number | null }; control: { n: number; completed: number; rate: number | null }; control_crossover: number } };
type CGData = { ok: boolean; tier: string; generatedAt: string; scanMs: number; files: number; symbols: number; edges: number; externalImports: number; orphans: string[]; topFanIn: { path: string; inbound: number }[]; topFanOut: { path: string; outbound: number }[]; externalTop: { pkg: string; n: number }[]; truncated: boolean };
type CGImpact = { ok: boolean; file: string; found: boolean; direct: string[]; transitive: string[]; inboundRoot: number; note?: string };
type OtelData = { ok: boolean; spans: number; dropped: number; ringCap: number; stats: { name: string; n: number; err: number; avgMs: number; maxMs: number }[] };
type VDData = { ok: boolean; count: number; verdicts: { seq: number; task_id: string | null; at: string; reasons?: string[] }[] };
type WorktreeData = { ok: boolean; head: string; branch: string; worktrees: { worktrees: { name: string; branch: string; head: string; managed: boolean }[] }; rerere: { enabled: boolean | null; autoUpdate: boolean; cacheEntries: number; inConflict: boolean; remaining: string[] } };
type RoadmapData = { ok: boolean; verdict: string; done: number; total: number; closedAt: string | null; milestones: { key: string; title: string; status: string; evidence: string; checks: { name: string; pass: boolean }[]; verifiedAt: string }[] };
type SandboxData = { ok: boolean; sandboxes: { id: string; status: string; provider: string; createdAt: string; head: string; cmds: number; lastCmd: string | null; lastExit: number | null; diskKb?: number }[]; providers: Record<string, string>; snapshots: { file: string; sandboxId: string; bytes: number; sha256: string; createdAt: string }[] };
type SandboxRun = { id: string; cmd: string; exitCode: number; ok: boolean; ms: number; stdout: string; stderr: string; truncated: boolean; limit: string };
type Worker = { id: string; role: string; kind: string; state: string; generation: number; created_at: string; heartbeat_at: string };
type Command = {
  id: string; action: string; lane: string; status: string; cost: number;
  run_after: number | null; created_at: string; error: string | null; result: string | null;
};
type Event = { seq: number; ts: string; type: string; agent_id: string | null; task_id: string | null; data: string };
type ActionMeta = { action: string; lane: string; cost: number; desc: string; group: string; args?: string };
type Mirror = { mode: string; pending: number; method: string | null; last_error: string | null; last_sent_seq: number };
type Snapshot = {
  ok: boolean; ts: string; agents: Agent[]; tasks: Task[]; archived?: Task[]; workers: Worker[];
  commands: Command[]; events: Event[];
  budget: { used: number; limit: number; window_ms: number };
  stats: Record<string, number>;
  meta: { version: string; boot: string };
};

const WS_OPTS = { path: "/", transports: ["websocket", "polling"], reconnectionDelay: 2000, timeout: 8000 };

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}м`;
  return `${Math.floor(ms / 3_600_000)}ч`;
}
function hhmmss(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour12: false });
}

const EVENT_STYLE: Record<string, string> = {
  TASK_QUEUED: "text-emerald-400", TASK_LEASED: "text-amber-400", TASK_DONE: "text-emerald-300",
  TASK_COMPLETED: "text-emerald-300", TASK_FAILED: "text-rose-400", TASK_CANCELLED: "text-zinc-400",
  TASK_RETRIED: "text-amber-300", TASK_ARCHIVED: "text-zinc-400", TASK_LISTED: "text-zinc-500",
  TASK_SCHEDULED: "text-lime-300",
  AGENT_CREATED: "text-amber-300", AGENT_RETIRED: "text-zinc-500",
  AGENT_PAUSED: "text-amber-400", AGENT_RESUMED: "text-lime-400", AGENT_MODEL_SET: "text-cyan-300",
  COMMAND_ENQUEUED: "text-fuchsia-400", COMMAND_LEASED: "text-fuchsia-300",
  COMMAND_COMPLETED: "text-emerald-400", COMMAND_FAILED: "text-rose-400",
  COMMAND_CANCELLED: "text-zinc-400",
  BUDGET_FLUSHED: "text-rose-300", BUDGET_ADJUSTED: "text-fuchsia-300",
  WORKSPACE_SNAPSHOT: "text-cyan-400", EVENTS_SEARCHED: "text-cyan-400",
  STEP_START: "text-zinc-500", STEP_DONE: "text-zinc-500",
  TOOL_CALL: "text-cyan-300", TOOL_RESULT: "text-cyan-500",
  ENVIRONMENT_RESET: "text-rose-300", FLEET_RECONCILED: "text-amber-400",
};

const STATUS_BADGE: Record<string, string> = {
  READY: "bg-zinc-700 text-zinc-200", RUNNING: "bg-amber-500/90 text-black",
  COMPLETED: "bg-emerald-600 text-white", FAILED: "bg-rose-600 text-white",
  CANCELLED: "bg-zinc-600 text-zinc-300", PENDING: "bg-zinc-700 text-zinc-300",
  LEASED: "bg-amber-500/80 text-black", REJECTED: "bg-rose-800 text-rose-200",
  BUSY: "bg-amber-500/90 text-black", IDLE: "bg-emerald-700 text-emerald-100",
  OFFLINE: "bg-zinc-800 text-zinc-500",
  PAUSED: "bg-amber-700 text-amber-100",
  ARCHIVED: "bg-zinc-800 text-zinc-400",
};

const MODEL_OPTIONS = ["zai:default", "zai:glm-4.6", "zai:glm-4.5-air", "zai:glm-4-flash"];

// ── панель «ВЕТКИ»: вкладки-«браузер» + цвета статусов ──────────
type BranchTabKey = "ALL" | "ACTIVE" | "DONE" | "CANCELLED" | "ARCHIVE";
const BRANCH_TABS: { key: BranchTabKey; label: string; dot: string; match: (s: string) => boolean }[] = [
  { key: "ALL", label: "Все", dot: "bg-emerald-400", match: () => true },
  { key: "ACTIVE", label: "Активные", dot: "bg-amber-400", match: (s) => s === "READY" || s === "RUNNING" },
  { key: "DONE", label: "Завершённые", dot: "bg-emerald-500", match: (s) => s === "COMPLETED" || s === "FAILED" },
  { key: "CANCELLED", label: "Отменённые", dot: "bg-zinc-400", match: (s) => s === "CANCELLED" },
  { key: "ARCHIVE", label: "Архив", dot: "bg-zinc-600", match: (s) => s === "ARCHIVED" },
];
const BRANCH_COLOR: Record<string, string> = {
  RUNNING: "#fbbf24",
  COMPLETED: "#34d399",
  FAILED: "#fb7185",
  CANCELLED: "#f59e0b",
  READY: "#d4d4d8",
  SCHEDULED: "#a3e635",
  ARCHIVED: "#71717a",
};

const EVENT_FILTERS: { key: string; label: string; prefix: string }[] = [
  { key: "ALL", label: "все", prefix: "" },
  { key: "TASK", label: "задачи", prefix: "TASK_" },
  { key: "TOOL", label: "инструменты", prefix: "TOOL_" },
  { key: "STEP", label: "шаги", prefix: "STEP_" },
  { key: "AGENT", label: "флот", prefix: "AGENT_" },
  { key: "COMMAND", label: "шина", prefix: "COMMAND_" },
];

function Dot({ on, pulse }: { on: boolean; pulse?: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${on ? "bg-emerald-400" : "bg-rose-500"} ${pulse && on ? "animate-pulse" : ""}`} />
  );
}

/** count-up: плавная анимация числа к новому значению. */
function useCountUp(target: number, ms = 420): number {
  const [val, setVal] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(from + (target - from) * eased);
      cur.current = v;
      setVal(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

/** KPI-плитка хедера: count-up + вспышка/ glow при изменении (ключ по значению перезапускает анимацию). */
function KpiTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  const v = useCountUp(value);
  return (
    <div
      className="kpi-tile flex min-w-10 flex-col items-center rounded-md border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5"
      title={`${label}: ${value}`}
    >
      <span key={value} className={`kpi-hot font-mono text-[13px] font-bold leading-tight ${tone}`}>{v}</span>
      <span className="text-[8px] uppercase tracking-widest text-zinc-600">{label}</span>
    </div>
  );
}

/** Точка статуса на конце ветви (SVG). */
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

/** Git-подобный граф ветвей: рейка таймлайна, каждая задача — ветвь с точкой статуса.
 *  v0.7.0: retry-линии (parent_id → merge-дуга к родителю) + hover-tooltip через portal
 *  (fixed-позиция, не обрезается скролл-контейнером панели).
 *  v1.0.0: окно 60 ветвей (старшие скрыты за toggle — SVG не деградирует на 50+ задачах)
 *  + кнопка ✦ LLM-рефлексии (tier-2) на FAILED/CANCELLED строках. */
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
  // bbox g включает path ветви от рейки (M 16 10 → y строки) и тянется на пол-графа,
  // из-за чего tooltip позиционировался мимо вьюпорта при скролле секции (ловили живьём в R9)
  const rowRect = (t: Task): DOMRect | null => {
    const el = document.querySelector(`g[data-branch-id="${t.id}"] rect.branch-hover`);
    return el ? el.getBoundingClientRect() : null;
  };
  const track = (t: Task) => (e: React.MouseEvent | React.FocusEvent) => {
    const r = rowRect(t);
    if (!r) return;
    setHover({ t, top: r.top, left: r.left });
  };
  const clr = (id: string) => setHover((cur) => (cur?.t.id === id ? null : cur));
  // v0.9.0: координаты tooltip-а живут, пока живёт hover: скролл любого контейнера (capture),
  // ресайз окна и движение мыши по строке обновляют позицию — иначе строка уезжает из-под
  // зафиксированных координат (скролл секции под статичным курсором, ресайз каст-панели)
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
                      <title>{"LLM-рефлексия (tier-2): вербальный урок провала — запишется в tasks.reflection.llm"}</title>
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
              // R12: адаптивный порог above — большие tooltip-ы (рефлексия+сигналы+llm-блок) обрезались
              // вверху вьюпорта при фиксированном пороге 110; оцениваем фактическую высоту контента
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

/** Спарклайн: событий за последние 12 × 10s окон. */
function Sparkline({ events }: { events: Event[] }) {
  const buckets = useMemo(() => {
    const now = Date.now();
    const arr = new Array(12).fill(0);
    for (const e of events) {
      const dt = now - new Date(e.ts).getTime();
      if (dt < 0 || dt >= 120_000) continue;
      arr[11 - Math.floor(dt / 10_000)]++;
    }
    return arr;
  }, [events]);
  const max = Math.max(1, ...buckets);
  return (
    <div className="flex h-6 items-end gap-[3px]" aria-label="Активность за 2 минуты" title="События/10s, 2 мин">
      {buckets.map((v, i) => (
        <span
          key={i}
          className={`w-[5px] rounded-sm ${i === 11 ? "bg-emerald-400" : "bg-zinc-600"}`}
          style={{ height: `${Math.max(2, Math.round((v / max) * 24))}px` }}
        />
      ))}
    </div>
  );
}

export default function MissionControl() {
  const { toast } = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [liveTail, setLiveTail] = useState(true);
  const [filter, setFilter] = useState("");
  const [laneFilter, setLaneFilter] = useState("ALL");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [detail, setDetail] = useState<Task | null>(null);
  const [stream, setStream] = useState<Event[]>([]);
  const [busyAction, setBusyAction] = useState(false);
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [catalog, setCatalog] = useState<ActionMeta[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // панель ВЕТКИ: вкладки-«браузер» + сворачивание
  const [branchTab, setBranchTab] = useState<BranchTabKey>("ALL");
  const [branchesOpen, setBranchesOpen] = useState(true);

  // ветки браузера (agent-browser через шину, v0.6.0)
  const [browserTabs, setBrowserTabs] = useState<{ id: string; title: string; url: string; active: boolean }[]>([]);
  const [browserBusy, setBrowserBusy] = useState(false);
  // СКРИНКАСТ (v0.7.0): живой вид активной вкладки через WS-стрим agent-browser (:3042, вне бюджета шины)
  const [castOn, setCastOn] = useState(false);
  // v0.9.0: профили полосы стрима (ресёрч ABR + streaming.md: pacing+maxFps — per-client, config мгновенен)
  // макс = push 12fps (низкая задержка для руля) · баланс = ack 8 · эконом = ack 2 · авто = ack, maxFps адаптивен по KB/s
  const CAST_PROFILES = {
    "макс": { maxFps: 12, pacing: "push" },
    "баланс": { maxFps: 8, pacing: "ack" },
    "эконом": { maxFps: 2, pacing: "ack" },
    "авто": { maxFps: 8, pacing: "ack" },
  } as const;
  type CastProfile = keyof typeof CAST_PROFILES;
  const [castProfile, setCastProfile] = useState<CastProfile>("баланс");
  const [castStat, setCastStat] = useState<{ connected: boolean; fps: number; url: string | null; error: string | null; lastAge: number | null; kbs: number | null }>({
    connected: false, fps: 0, url: null, error: null, lastAge: null, kbs: null,
  });
  const castImgRef = useRef<HTMLImageElement | null>(null);
  // PAIR-CONTROL (v0.8.0): клик/клавиатура/колесо из скринкаста → активная вкладка (вне бюджета шины)
  const castWsRef = useRef<WebSocket | null>(null);
  const castWrapRef = useRef<HTMLDivElement | null>(null);
  const [castCtl, setCastCtl] = useState(false);
  const [castConsole, setCastConsole] = useState<{ id: number; level: string; text: string }[]>([]);
  const [castConOpen, setCastConOpen] = useState(false);
  const castMsgId = useRef(0);
  // CDP-СКРИНКАСТ (v0.15.0): per-client jpeg-качество/ширина через CDP (:3043, snapshot-поллинг).
  // Зазор против :3042: бинарный stream-сервер agent-browser умеет per-client maxFps/pacing,
  // но НЕ per-client quality/масштаб — это закрывает собственный сервер daemon'а (CDP-сессия на клиента).
  const [cdpQ, setCdpQ] = useState(55);
  const [cdpW, setCdpW] = useState(640);
  const [cdpTick, setCdpTick] = useState(0);
  const [cdpInfo, setCdpInfo] = useState<{ cdp: { port: number; target: string } | null; frames: number; streams: number } | null>(null);

  // EVENTS_SEARCH (диалог из ⌘K)
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("TASK");
  const [searchLimit, setSearchLimit] = useState("50");
  const [searchRes, setSearchRes] = useState<{ q: string; count: number; preview: Event[] } | null>(null);

  // BUDGET_ADJUST (диалог из ⌘K)
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetVal, setBudgetVal] = useState("24");

  // AGENT_MODEL: черновики моделей по карточкам агентов
  const [modelSel, setModelSel] = useState<Record<string, string>>({});

  // форма новой задачи
  const [fTitle, setFTitle] = useState("");
  const [fSpec, setFSpec] = useState("");
  const [fRole, setFRole] = useState("ANY");
  const [fSteps, setFSteps] = useState("6");
  const [fDelay, setFDelay] = useState("0");

  const logRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const detailIdRef = useRef<string | null>(null);
  const browserRefreshRef = useRef<() => void>(() => {});
  const budgetFlushRef = useRef<() => void>(() => {});
  const exportEventsRef = useRef<() => void>(() => {});

  // ── WS подключение (с защитой от StrictMode-зомби) ──────────────
  useEffect(() => {
    let s: Socket | null = null;
    let hb: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    (async () => {
      const { io: mk } = await import("socket.io-client");
      if (cancelled) return; // cleanup уже отработал — соединение не создаём
      s = mk("/?XTransformPort=3040", WS_OPTS) as Socket;
      setSocket(s);
      s.on("connect", () => { setConnected(true); s?.emit("subscribe"); });
      s.on("disconnect", () => setConnected(false));
      s.on("snapshot", (data: Snapshot) => {
        if (!data?.ok) return;
        setSnap(data);
        if (data.events?.length) {
          setEvents((prev) => {
            const map = new Map(prev.map((e) => [e.seq, e]));
            for (const e of data.events) map.set(e.seq, e);
            return [...map.values()].sort((a, b) => b.seq - a.seq).slice(0, 300);
          });
        }
      });
      s.on("event", (e: Event) => {
        setEvents((prev) => (prev.some((x) => x.seq === e.seq) ? prev : [e, ...prev].slice(0, 300)));
        if (e.task_id && e.task_id === detailIdRef.current) {
          setStream((prev) => (prev.some((x) => x.seq === e.seq) ? prev : [...prev, e]));
        }
        if (e.type === "BROWSER_TAB_OPENED" || e.type === "BROWSER_TAB_CLOSED") browserRefreshRef.current();
      });
      hb = setInterval(() => {
        s?.emit("heartbeat", { role: "console", state: "IDLE" }, () => { /* ack */ });
      }, 15_000);
    })();
    return () => { cancelled = true; s?.close(); if (hb) clearInterval(hb); };
  }, []);

  // REST fallback начального состояния + каталог действий + evidence-mirror poll + тик ETA
  useEffect(() => {
    fetch("/state?XTransformPort=3041")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ok) { setSnap(d); setEvents(d.events ?? []); } })
      .catch(() => { /* daemon оффлайн — WS покажет статус */ });
    fetch("/actions?XTransformPort=3041")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ok) setCatalog(d.actions ?? []); })
      .catch(() => { /* реестр подхватится при следующем заходе */ });
    const ev = setInterval(() => {
      fetch("/evidence?XTransformPort=3041")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.ok) setMirror({ mode: d.mode, pending: d.pending, method: d.method, last_error: d.last_error, last_sent_seq: d.last_sent_seq }); })
        .catch(() => { /* зеркало недоступно */ });
    }, 10_000);
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => { clearInterval(ev); clearInterval(tick); };
  }, []);

  // автоскроллы
  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = 0;
  }, [events, autoScroll]);
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [stream]);

  // live-синхронизация детали задачи со снапшотом (READY→RUNNING→COMPLETED и т.д.)
  useEffect(() => {
    if (!detail || !snap) return;
    const fresh = snap.tasks.find((t) => t.id === detail.id);
    if (fresh && fresh !== detail) setDetail(fresh);
  }, [snap, detail]);

  // ⌘K и «N» — горячие клавиши
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); setCmdOpen((o) => !o);
      } else if ((e.key === "n" || e.key === "n") && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
        e.preventDefault(); setNewTaskOpen(true);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // ── команды ─────────────────────────────────────────────────────
  const sendCommand = useCallback(async (
    action: string,
    payload: Record<string, unknown> = {},
    opts: { lane?: string; quiet?: boolean; successMsg?: string } = {},
  ): Promise<unknown | null> => {
    setBusyAction(true);
    const idem = `${action.toLowerCase()}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const viaWs = (): Promise<unknown | null> => new Promise((resolve) => {
      if (!socket?.connected) return resolve(null);
      const t = setTimeout(() => resolve(null), 8000);
      socket.emit("command", { action, payload, idempotency_key: idem, lane: opts.lane }, (r: { ok: boolean; error?: string; result?: unknown }) => {
        clearTimeout(t); resolve(r);
      });
    });
    let res = await viaWs();
    if (!res) {
      try {
        const r = await fetch("/commands?XTransformPort=3041", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, payload, idempotency_key: idem, lane: opts.lane }),
        });
        res = await r.json();
      } catch { res = null; }
    }
    setBusyAction(false);
    const ok = !!(res as { ok?: boolean })?.ok;
    if (!opts.quiet) {
      toast({
        title: ok ? `${action} ✓` : `${action} ✗`,
        description: ok ? (opts.successMsg ?? "команда исполнена шиной") : String((res as { error?: string })?.error ?? "ошибка"),
        variant: ok ? "default" : "destructive",
      });
    }
    if (!ok) return null;
    // результат шины может прийти строкой (давний урезанный JSON) — пробуем восстановить объект
    let out: unknown = (res as { result?: unknown })?.result ?? res;
    if (typeof out === "string") {
      try { out = JSON.parse(out); } catch { out = null; }
    }
    if (out && typeof out === "object" && (out as { truncated?: boolean }).truncated) out = null;
    return out;
  }, [socket, toast]);

  // ветки браузера: загрузка списка вкладок через шину (BROWSER_TABS, v0.6.0)
  const loadBrowserTabs = useCallback(async () => {
    setBrowserBusy(true);
    const r = await sendCommand("BROWSER_TABS", {}, { quiet: true });
    const d = r as { tabs?: { id: string; title: string; url: string; active: boolean }[] } | null;
    if (d?.tabs) setBrowserTabs(d.tabs);
    setBrowserBusy(false);
  }, [sendCommand]);

  // подписка реф-хуков для WS-событий + авто-загрузка при раскрытии панели ВЕТКИ
  useEffect(() => {
    browserRefreshRef.current = loadBrowserTabs;
  }, [loadBrowserTabs]);
  useEffect(() => {
    if (branchesOpen) loadBrowserTabs();
  }, [branchesOpen, loadBrowserTabs]);

  // СКРИНКАСТ + PAIR-CONTROL: WS-стрим кадров активной вкладки (gateway → agent-browser stream :3042).
  // v0.9.0 профили полосы: pacing+maxFps из CAST_PROFILES (URL покрывает открывающий кадр);
  // в ack-режиме клиент эхом шлёт {type:"ack",seq} — сервер держит ≤1 кадра в полёте (нет очередей);
  // «авто»: раз в секунду меряем KB/s и переставляем maxFps config-сообщением (без реконнекта).
  // url/tabs/console — служебные; input_* летит только в armed-режиме «руль».
  useEffect(() => {
    if (!castOn) return;
    let stopped = false;
    let ws: WebSocket | null = null;
    let fpsCount = 0;
    let fpsMark = Date.now();
    let b64Bytes = 0; // base64-символы за окно (≈ байты × 3/4)
    const prof = CAST_PROFILES[castProfile];
    const pacing = prof.pacing as "push" | "ack";
    let autoFps = prof.maxFps; // для «авто»: текущий адаптивный потолок
    try {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/?XTransformPort=3042&maxFps=${prof.maxFps}${pacing === "ack" ? "&pacing=ack" : ""}`);
      castWsRef.current = ws;
      ws.onopen = () => { if (!stopped) setCastStat((s) => ({ ...s, connected: true, error: null })); };
      ws.onmessage = (ev) => {
        if (stopped) return;
        try {
          const msg = JSON.parse(ev.data as string) as {
            type: string; data?: string; url?: string; seq?: number;
            metadata?: { deviceWidth?: number; deviceHeight?: number; timestamp?: number };
            level?: string; text?: string;
            args?: Array<{ value?: string; description?: string; preview?: { description?: string } }>;
          };
          if (msg.type === "frame" && msg.data) {
            const img = castImgRef.current;
            if (img) img.src = `data:image/jpeg;base64,${msg.data}`;
            b64Bytes += msg.data.length;
            fpsCount++;
            // ack-пейсинг: эхо seq обязателен, иначе сервер молчит (cumulative: свежий ack покрывает старые)
            if (pacing === "ack" && msg.seq != null && ws?.readyState === 1) {
              ws.send(JSON.stringify({ type: "ack", seq: msg.seq }));
            }
            const nowT = Date.now();
            if (nowT - fpsMark >= 1000) {
              const kbs = Math.round((b64Bytes * 0.75) / 1024);
              b64Bytes = 0;
              // «авто»: держим полосу в разумных пределах, переставляя потолок fps
              if (castProfile === "авто" && ws?.readyState === 1) {
                const want = kbs > 600 ? 2 : kbs > 250 ? 4 : kbs > 100 ? 8 : 12;
                if (want !== autoFps) {
                  autoFps = want;
                  ws.send(JSON.stringify({ type: "config", maxFps: want }));
                }
              }
              setCastStat((s) => ({ ...s, fps: fpsCount, kbs, lastAge: msg.metadata?.timestamp ? nowT - msg.metadata.timestamp : null }));
              fpsCount = 0; fpsMark = nowT;
            }
          } else if (msg.type === "url") {
            setCastStat((s) => ({ ...s, url: msg.url ?? s.url }));
          } else if (msg.type === "console") {
            // живая лента консоли вкладки (не в audit): text = первый string-arg, объекты — кратко
            let text = msg.text ?? "";
            for (const a of (msg.args ?? []).slice(1)) text += ` ${a.value ?? a.preview?.description ?? a.description ?? "…"}`;
            text = (text || "(пусто)").slice(0, 200);
            setCastConsole((prev) => [...prev.slice(-29), { id: ++castMsgId.current, level: msg.level ?? "log", text }]);
          }
        } catch { /* не-JSON кадр — игнор */ }
      };
      ws.onerror = () => { if (!stopped) setCastStat((s) => ({ ...s, connected: false, error: "стрим недоступен (:3042)" })); };
      ws.onclose = () => { if (!stopped) setCastStat((s) => ({ ...s, connected: false })); };
    } catch {
      setCastStat((s) => ({ ...s, connected: false, error: "WS не открыт" }));
    }
    return () => {
      stopped = true;
      try { ws?.close(); } catch { /* уже закрыт */ }
      castWsRef.current = null;
      setCastStat((s) => ({ ...s, connected: false, fps: 0, kbs: null }));
      setCastConsole([]);
    };
  }, [castOn, castProfile]);

  // pair-control: сняли «live» — руль выключается тоже
  useEffect(() => {
    if (!castOn && castCtl) setCastCtl(false);
  }, [castOn, castCtl]);

  // CDP-тайл (:3043): poll /stats раз в 4с + САМОТЕМПЕРИРУЕМАЯ перезагрузка снапшота —
  // следующий тик ставится только после onLoad/onError кадра (урок R15: фиксированный тик
  // 2.5с отменял каждую загрузку при тяжёлых кадрах — кадр не успевал НИКОГДА).
  // Каденс задаёт клиент (поллинг), поэтому зеркало-рекурсия не каскадит.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/stats?XTransformPort=3043");
        if (r.ok && alive) setCdpInfo(await r.json());
      } catch { /* daemon/restart — тише */ }
    };
    void pull();
    const st = setInterval(pull, 4000);
    return () => { alive = false; clearInterval(st); };
  }, []);
  const aliveTickRef = useRef(true);
  useEffect(() => {
    aliveTickRef.current = true;
    return () => { aliveTickRef.current = false; };
  }, []);
  const cdpNextTick = useCallback((ms: number) => {
    window.setTimeout(() => { if (aliveTickRef.current) setCdpTick((t) => t + 1); }, ms);
  }, []);

  // PAIR-CONTROL: координаты клика → координаты страницы. База — naturalWidth/Height кадра:
  // jpeg кадра = РЕАЛЬНЫЙ вьюпорт страницы (напр. 1280×577), а metadata.deviceWidth/Height —
  // эмулированные метрики (напр. 720) и для маппинга не годятся (проверено живьём в R8)
  const castMapXY = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = castImgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const dw = img.naturalWidth;
    const dh = img.naturalHeight;
    const r = img.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const scale = Math.min(r.width / dw, r.height / dh);
    const ox = r.left + (r.width - dw * scale) / 2;
    const oy = r.top + (r.height - dh * scale) / 2;
    const x = Math.round((clientX - ox) / scale);
    const y = Math.round((clientY - oy) / scale);
    if (x < 0 || y < 0 || x > dw || y > dh) return null;
    return { x, y };
  }, []);

  // клик (mousePressed+mouseReleased) — только в armed-режиме
  const castSendMouse = useCallback((eventType: string, e: { clientX: number; clientY: number }) => {
    if (!castCtl) return;
    const ws = castWsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const p = castMapXY(e.clientX, e.clientY);
    if (!p) return;
    ws.send(JSON.stringify({ type: "input_mouse", eventType, ...p, button: "left", clickCount: 1 }));
  }, [castCtl, castMapXY]);

  // клавиатура: keyDown{text}/keyUp по CDP-семантике; Ctrl/Meta-комбо остаются у оператора
  const castKey = useCallback((e: React.KeyboardEvent) => {
    if (!castCtl || e.ctrlKey || e.metaKey) return;
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
    const ws = castWsRef.current;
    if (!ws || ws.readyState !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    const mods = (e.altKey ? 1 : 0) | (e.shiftKey ? 8 : 0);
    const down: Record<string, unknown> = { type: "input_keyboard", eventType: "keyDown", key: e.key, modifiers: mods };
    if (e.key.length === 1 && !e.altKey) down.text = e.key;
    else if (e.key === "Enter") down.text = "\r";
    else if (e.key === "Backspace") down.text = "\b";
    ws.send(JSON.stringify(down));
    ws.send(JSON.stringify({ type: "input_keyboard", eventType: "keyUp", key: e.key, modifiers: mods }));
  }, [castCtl]);

  // armed: автофокус на кадр + колесо нативным listener'ом (React onWheel пассивен — preventDefault не сработал бы)
  useEffect(() => {
    if (!castCtl) return;
    castWrapRef.current?.focus({ preventScroll: true });
    const el = castWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const ws = castWsRef.current;
      if (!ws || ws.readyState !== 1) return;
      const p = castMapXY(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      ws.send(JSON.stringify({ type: "input_mouse", eventType: "mouseWheel", ...p, deltaX: Math.round(e.deltaX), deltaY: Math.round(e.deltaY) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [castCtl, castMapXY]);

  const toggleCastCtl = useCallback(() => {
    setCastCtl((v) => {
      const nv = !v;
      if (nv) toast({ title: "Ручное управление включено", description: "Клики, клавиатура и колесо в кадре идут в активную вкладку. Ctrl/Meta-комбо остаются у оператора." });
      return nv;
    });
  }, [toast]);

  const spawnAgent = useCallback(async (role: string) => {
    await sendCommand("AGENT_SPAWN", { role, model: "zai:default" }, { successMsg: `агент ${role} создан` });
    setCmdOpen(false);
  }, [sendCommand]);

  const createTask = useCallback(async () => {
    if (!fSpec.trim()) { toast({ title: "Спецификация обязательна", variant: "destructive" }); return; }
    const payload = {
      title: fTitle.trim() || fSpec.slice(0, 60),
      spec: fSpec.trim(),
      role: fRole === "ANY" ? null : fRole,
      max_steps: Number(fSteps) || 6,
    };
    const delaySec = Math.max(0, Number(fDelay) || 0);
    const res = delaySec > 0
      ? await sendCommand("TASK_SCHEDULE", { ...payload, delay_sec: delaySec }, { quiet: true })
      : await sendCommand("TASK_ENQUEUE", payload, { quiet: true });
    const r = res as { task?: Task; scheduled?: boolean; command_id?: string } | null;
    if (r && (r.task || r.scheduled)) {
      toast({
        title: delaySec > 0 ? `Запланировано через ${delaySec}s` : "Задача поставлена",
        description: r.task ? r.task.id : `команда ${r.command_id} — дренаж исполнит по ETA`,
      });
      setNewTaskOpen(false); setFTitle(""); setFSpec(""); setFDelay("0"); setCmdOpen(false);
    } else {
      toast({ title: "TASK_ENQUEUE ✗", description: "не удалось поставить задачу", variant: "destructive" });
    }
  }, [fTitle, fSpec, fRole, fSteps, fDelay, sendCommand, toast]);

  const cancelTask = useCallback(async (id: string) => {
    await sendCommand("TASK_CANCEL", { id }, { lane: "CONTROL", successMsg: "задача отменена" });
    setDetail(null);
  }, [sendCommand]);

  const openDetail = useCallback((t: Task) => {
    setDetail(t); detailIdRef.current = t.id; setStream([]);
    fetch(`/events?XTransformPort=3041&task=${encodeURIComponent(t.id)}&limit=200`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ok && detailIdRef.current === t.id) setStream(d.events ?? []); })
      .catch(() => { /* стрим недоступен — покажем live-хвост */ });
  }, []);

  const retryTask = useCallback(async (id: string) => {
    const res = await sendCommand("TASK_RETRY", { id }, { successMsg: "задача пере-поставлена в очередь" });
    const r = res as { task?: Task } | null;
    if (r?.task) openDetail(r.task);
  }, [sendCommand, openDetail]);

  // tier-2 LLM-рефлексия: /api/reflect (z-ai SDK в backend) → daemon пишет llm-блок в reflection,
  // событие TASK_REFLECTED пушит снапшот по WS — tooltip обновится сам
  const [reflectingId, setReflectingId] = useState<string | null>(null);
  const reflectTask = useCallback(async (t: Task) => {
    setReflectingId(t.id);
    try {
      const r = await fetch("/api/reflect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: t.id }),
      });
      const d = await r.json().catch(() => null) as { ok?: boolean; lesson?: string; error?: string } | null;
      if (r.ok && d?.ok) {
        toast({ title: "LLM-рефлексия ✓", description: (d.lesson ?? "").slice(0, 140) || "урок записан в tasks.reflection" });
      } else {
        toast({ title: "LLM-рефлексия ✗", description: d?.error ?? `HTTP ${r.status}`, variant: "destructive" });
      }
    } catch {
      toast({ title: "LLM-рефлексия ✗", description: "сеть недоступна", variant: "destructive" });
    } finally {
      setReflectingId(null);
    }
  }, [toast]);

  // R11: pass-rate ретраев с LLM-уроком vs без — живое измерение Reflexion-эффекта из шина-данных
  const [retryMetrics, setRetryMetrics] = useState<RetryMetrics | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () => fetch("/metrics?XTransformPort=3041")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!dead && d?.ok) setRetryMetrics(d as RetryMetrics); })
      .catch(() => { /* daemon недоступен — чип просто скрыт */ });
    load();
    const iv = setInterval(load, 20_000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  // R16: Code Graph v1 (M2) + worktrees/rerere (M4) + OTel-lite (M7) — пробелы DEVOS-роадмапа
  const [cgOpen, setCgOpen] = useState(false);
  const [cg, setCg] = useState<CGData | null>(null);
  const [otel, setOtel] = useState<OtelData | null>(null);
  const [vd, setVd] = useState<VDData | null>(null);
  const [wt, setWt] = useState<WorktreeData | null>(null);
  const [cgQuery, setCgQuery] = useState("");
  const [cgImpact, setCgImpact] = useState<CGImpact | null>(null);
  const [cgBusy, setCgBusy] = useState(false);

  const loadCg = useCallback(async (force = false) => {
    setCgBusy(true);
    try {
      const g = await fetch(`/codegraph?XTransformPort=3041${force ? "&force=1" : ""}`, { cache: "no-store" }).then((r) => r.json());
      if (g?.ok) setCg(g as CGData);
      const [o, w, v] = await Promise.all([
        fetch("/spans?XTransformPort=3041", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/worktrees?XTransformPort=3041", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/verdicts?XTransformPort=3041", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      if (o?.ok) setOtel(o as OtelData);
      if (w?.ok) setWt(w as WorktreeData);
      if (v?.ok) setVd(v as VDData);
    } catch { /* daemon недоступен — панель просто без данных */ }
    finally { setCgBusy(false); }
  }, []);

  const runImpact = useCallback(async () => {
    const q = cgQuery.trim();
    if (!q) return;
    setCgBusy(true);
    try {
      const r = await fetch(`/codegraph/impact?XTransformPort=3041&file=${encodeURIComponent(q)}`, { cache: "no-store" }).then((res) => res.json());
      setCgImpact(r as CGImpact);
    } catch { setCgImpact(null); }
    finally { setCgBusy(false); }
  }, [cgQuery]);

  const enableRerere = useCallback(async () => {
    setCgBusy(true);
    try {
      await fetch("/worktrees/rerere?XTransformPort=3041", { method: "POST" });
      const w = await fetch("/worktrees?XTransformPort=3041", { cache: "no-store" }).then((r) => r.json());
      if (w?.ok) {
        setWt(w as WorktreeData);
        toast({ title: "rerere включён", description: "git будет переиспользовать записанные разрешения конфликтов (M4)" });
      }
    } catch {
      toast({ title: "rerere ✗", description: "daemon недоступен", variant: "destructive" });
    } finally { setCgBusy(false); }
  }, [toast]);

  useEffect(() => { if (cgOpen) void loadCg(); }, [cgOpen, loadCg]);

  // R17: LIVE Roadmap M1–M7 (evidence-вердикт из реального состояния) + Sandbox Plane (M5)
  const [rmOpen, setRmOpen] = useState(true);
  const [rm, setRm] = useState<RoadmapData | null>(null);
  const [rmBusy, setRmBusy] = useState(false);
  const loadRm = useCallback(async () => {
    setRmBusy(true);
    try {
      const r = await fetch("/roadmap?XTransformPort=3041", { cache: "no-store" }).then((res) => res.json());
      if (r?.ok) setRm(r as RoadmapData);
    } catch { /* daemon недоступен — панель без данных */ }
    finally { setRmBusy(false); }
  }, []);

  const [sbOpen, setSbOpen] = useState(false);
  const [sb, setSb] = useState<SandboxData | null>(null);
  const [sbBusy, setSbBusy] = useState(false);
  const [sbId, setSbId] = useState("");
  const [sbCmd, setSbCmd] = useState("");
  const [sbRun, setSbRun] = useState<SandboxRun | null>(null);
  const loadSb = useCallback(async () => {
    try {
      const r = await fetch("/sandboxes?XTransformPort=3041", { cache: "no-store" }).then((res) => res.json());
      if (r?.ok) setSb(r as SandboxData);
    } catch { /* daemon недоступен */ }
  }, []);
  const sbOp = useCallback(async (op: string, extra: Record<string, unknown> = {}, okMsg?: string) => {
    setSbBusy(true);
    try {
      const res = await fetch("/sandbox?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ...extra }),
      }).then((r) => r.json());
      if (res?.ok) {
        if (op === "exec" && res.run) setSbRun(res.run as SandboxRun);
        if (okMsg) toast({ title: okMsg });
      } else {
        toast({ title: `sandbox ${op} ✗`, description: String(res?.error ?? "ошибка"), variant: "destructive" });
      }
      await loadSb();
    } catch {
      toast({ title: "sandbox ✗", description: "daemon недоступен", variant: "destructive" });
    } finally { setSbBusy(false); }
  }, [loadSb, toast]);

  useEffect(() => { if (rmOpen) void loadRm(); }, [rmOpen, loadRm]);
  useEffect(() => {
    if (sbOpen) {
      void loadSb();
      const iv = setInterval(() => void loadSb(), 10_000);
      return () => clearInterval(iv);
    }
  }, [sbOpen, loadSb]);

  const retireAgent = useCallback(async (id: string) => {
    await sendCommand("AGENT_RETIRE", { id }, { lane: "CONTROL", successMsg: "агент уволен" });
  }, [sendCommand]);

  const pauseAgent = useCallback(async (id: string) => {
    await sendCommand("AGENT_PAUSE", { id }, { lane: "CONTROL", successMsg: "агент на паузе — задачи не берёт" });
  }, [sendCommand]);

  const resumeAgent = useCallback(async (id: string) => {
    await sendCommand("AGENT_RESUME", { id }, { lane: "CONTROL", successMsg: "агент снова в строю" });
  }, [sendCommand]);

  const cancelCommand = useCallback(async (id: string) => {
    await sendCommand("COMMAND_CANCEL", { id }, { lane: "CONTROL", successMsg: "команда отменена до исполнения" });
  }, [sendCommand]);

  const archiveTask = useCallback(async (id: string) => {
    await sendCommand("TASK_ARCHIVE", { id }, { successMsg: "задача убрана в архив" });
    setDetail(null);
    detailIdRef.current = null;
    setBranchesOpen(true);
    setBranchTab("ARCHIVE");
  }, [sendCommand]);

  const saveAgentModel = useCallback(async (id: string, model: string) => {
    await sendCommand("AGENT_MODEL", { agent_id: id, model }, { successMsg: `модель агента → ${model}` });
  }, [sendCommand]);

  const runWorkspaceSnapshot = useCallback(async () => {
    const res = await sendCommand("WORKSPACE_SNAPSHOT", {}, { quiet: true });
    const r = res as { entries?: number; total_bytes?: number; truncated?: boolean } | null;
    if (r && typeof r.entries === "number") {
      toast({
        title: "WORKSPACE_SNAPSHOT ✓",
        description: `${r.entries} файлов · ${((r.total_bytes ?? 0) / 1024).toFixed(1)} KB${r.truncated ? " · обрезано" : ""}`,
      });
    } else {
      toast({ title: "WORKSPACE_SNAPSHOT ✗", description: "манифест workspace не получен", variant: "destructive" });
    }
    setCmdOpen(false);
  }, [sendCommand, toast]);

  const runEventsSearch = useCallback(async () => {
    const res = await sendCommand(
      "EVENTS_SEARCH",
      { q: searchQ.trim(), limit: Math.min(Math.max(Number(searchLimit) || 50, 1), 200) },
      { quiet: true },
    );
    const r = res as { q?: string; count?: number; events?: Event[] } | null;
    if (r?.events) {
      setSearchRes({ q: r.q ?? searchQ.trim(), count: r.count ?? r.events.length, preview: r.events.slice(0, 10) });
      toast({ title: "EVENTS_SEARCH ✓", description: `${r.count ?? r.events.length} совпадений по «${searchQ.trim()}»` });
    } else {
      toast({ title: "EVENTS_SEARCH ✗", description: "поиск не удался (q обязателен)", variant: "destructive" });
    }
  }, [searchQ, searchLimit, sendCommand, toast]);

  const runBudgetAdjust = useCallback(async () => {
    const n = Math.round(Number(budgetVal));
    if (!Number.isFinite(n) || n < 6 || n > 96) {
      toast({ title: "BUDGET_ADJUST ✗", description: "лимит должен быть в диапазоне 6..96", variant: "destructive" });
      return;
    }
    const res = await sendCommand("BUDGET_ADJUST", { limit: n }, { lane: "CONTROL", successMsg: `лимит шины: ${n} cost/60s` });
    const r = res as { to?: number } | null;
    if (r?.to) {
      setBudgetVal(String(r.to));
      setBudgetOpen(false);
    }
  }, [budgetVal, sendCommand, toast]);

  /** Текущий лимит бюджета (для пресета в диалоге BUDGET_ADJUST). */
  const budgetLimitNow = snap?.budget.limit ?? 24;

  /** Запуск действия из реестра ⌘K: безопасные — напрямую, с аргументами — подсказка/форма. */
  const runRegistryAction = useCallback((meta: ActionMeta) => {
    const direct: Record<string, () => void> = {
      PING: () => sendCommand("PING", {}, { quiet: true, successMsg: "pong" }),
      STATE_SNAPSHOT: () => sendCommand("STATE_SNAPSHOT", {}, { quiet: true }),
      EVENTS_TAIL: () => sendCommand("EVENTS_TAIL", { since: 0, limit: 50 }, { quiet: true, successMsg: "хвост событий запрошен" }),
      WORKERS_LIST: () => sendCommand("WORKERS_LIST", {}, { quiet: true, successMsg: "список workers в шине" }),
      ACTIONS_LIST: () => sendCommand("ACTIONS_LIST", {}, { quiet: true, successMsg: "реестр действий в шине" }),
      FLEET_RECONCILE: () => sendCommand("FLEET_RECONCILE", {}, { lane: "CONTROL" }),
      BUDGET_FLUSH: () => { setCmdOpen(false); setResetConfirm(false); budgetFlushRef.current?.(); },
      ENVIRONMENT_RESET: () => { setCmdOpen(false); setResetConfirm(true); },
      TASK_ENQUEUE: () => { setCmdOpen(false); setNewTaskOpen(true); },
      TASK_SCHEDULE: () => { setCmdOpen(false); setNewTaskOpen(true); },
      EVENTS_EXPORT: () => exportEventsRef.current?.(),
      // ── v0.5.0 ──
      TASK_LIST: () => sendCommand("TASK_LIST", {}, { quiet: true, successMsg: "сводка задач — в результате команды" }),
      WORKSPACE_SNAPSHOT: () => void runWorkspaceSnapshot(),
      EVENTS_SEARCH: () => { setCmdOpen(false); setSearchOpen(true); },
      BUDGET_ADJUST: () => { setCmdOpen(false); setBudgetVal(String(budgetLimitNow)); setBudgetOpen(true); },
      TASK_ARCHIVE: () => toast({ title: "TASK_ARCHIVE", description: "кнопка «в архив» — в карточке задачи (Sheet) для терминальных статусов" }),
      AGENT_MODEL: () => toast({ title: "AGENT_MODEL", description: "выберите модель в карточке агента (колонка ФЛОТ) и сохраните" }),
    };
    const fn = direct[meta.action];
    if (fn) { fn(); if (meta.action !== "ENVIRONMENT_RESET" && meta.action !== "TASK_ENQUEUE" && meta.action !== "TASK_SCHEDULE") setCmdOpen(false); }
    else {
      toast({ title: `${meta.action}`, description: "нужны аргументы — используйте формы и кнопки панелей" });
      setCmdOpen(false);
    }
  }, [sendCommand, toast, runWorkspaceSnapshot, budgetLimitNow]);

  const environmentReset = useCallback(async () => {
    setResetConfirm(false);
    await sendCommand("ENVIRONMENT_RESET", { by: "operator" }, { lane: "EMERGENCY", successMsg: "среда сброшена (EMERGENCY)" });
  }, [sendCommand]);

  const budgetFlush = useCallback(async () => {
    await sendCommand("BUDGET_FLUSH", {}, { lane: "EMERGENCY", successMsg: "очередь шины сброшена" });
    setCmdOpen(false);
  }, [sendCommand]);

  const exportEvents = useCallback(async () => {
    const res = await sendCommand("EVENTS_EXPORT", { limit: 500 }, { quiet: true });
    const r = res as { events?: Event[] } | null;
    if (r?.events) {
      const blob = new Blob([JSON.stringify(r.events, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `me2-events-${Date.now()}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      toast({ title: `EVENTS_EXPORT ✓`, description: `${r.events.length} событий выгружено` });
    } else {
      toast({ title: "EVENTS_EXPORT ✗", description: "выгрузка не удалась", variant: "destructive" });
    }
    setCmdOpen(false);
  }, [sendCommand, toast]);

  useEffect(() => {
    budgetFlushRef.current = budgetFlush;
    exportEventsRef.current = exportEvents;
  }, [budgetFlush, exportEvents]);

  // ── производные ─────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    let list = events;
    const lane = EVENT_FILTERS.find((f) => f.key === laneFilter);
    if (lane?.prefix) list = list.filter((e) => e.type.startsWith(lane.prefix));
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter((e) => e.type.toLowerCase().includes(f) || (e.data ?? "").toLowerCase().includes(f));
    }
    return list;
  }, [events, laneFilter, filter]);

  const stats = snap?.stats ?? {};
  const budget = snap?.budget ?? { used: 0, limit: 24 };
  const budgetPct = Math.min(100, Math.round((budget.used / Math.max(1, budget.limit)) * 100));
  const budgetColor = budgetPct > 80 ? "bg-rose-500" : budgetPct > 50 ? "bg-amber-500" : "bg-fuchsia-500";

  // ── панель ВЕТКИ: данные + счётчики вкладок ────────────────────
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

  // отложенные команды (ETA в будущем) — живой отсчёт + отмена
  const scheduledCommands = useMemo(
    () => (snap?.commands ?? [])
      .filter((c) => c.status === "PENDING" && c.run_after && c.run_after > nowMs)
      .sort((a, b) => (a.run_after ?? 0) - (b.run_after ?? 0))
      .slice(0, 4),
    [snap, nowMs],
  );
  const etaOf = (c: Command) => `${Math.max(1, Math.ceil(((c.run_after ?? 0) - nowMs) / 1000))}s`;

  const mirrorMode = mirror?.mode ?? "…";
  const mirrorColor = mirrorMode === "LIVE" ? "text-emerald-400" : mirrorMode === "DEGRADED" ? "text-amber-400" : "text-zinc-500";
  const laneChip = (lane: string) =>
    lane === "EMERGENCY" ? "border-rose-800 text-rose-400"
      : lane === "CONTROL" ? "border-amber-800 text-amber-400"
      : lane === "MUTATION" ? "border-fuchsia-800 text-fuchsia-400"
      : "border-zinc-700 text-zinc-400";

  return (
    <div className="mc-dark flex min-h-screen flex-col bg-zinc-950 text-zinc-100 lg:h-screen">
      {/* ── HEADER ── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-4 backdrop-blur">
        <Radar className="h-5 w-5 text-emerald-400" aria-hidden />
        <h1 className="text-sm font-bold tracking-[0.2em]">ME2 · MISSION CONTROL</h1>
        <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-400">
          v{snap?.meta.version ?? "?"}
        </Badge>
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
          <div className="hidden items-center gap-1.5 lg:flex" aria-label="KPI задач" role="group">
            <KpiTile label="ready" value={stats.tasksReady ?? 0} tone="text-zinc-200" />
            <KpiTile label="run" value={stats.tasksRunning ?? 0} tone="text-amber-400" />
            <KpiTile label="done" value={stats.tasksCompleted ?? 0} tone="text-emerald-400" />
            <KpiTile label="fail" value={stats.tasksFailed ?? 0} tone="text-rose-400" />
          </div>
          <span className="hidden xl:flex" aria-label="Активность"><Sparkline events={events} /></span>
          <span
            className={`hidden items-center gap-1.5 lg:flex ${mirrorColor}`}
            title={mirror?.last_error ? `Зеркало: ${mirror.last_error}` : "Evidence-mirror → Supabase"}
          >
            {mirrorMode === "OFF" ? <CloudOff className="h-3.5 w-3.5" /> : <Cloud className={`h-3.5 w-3.5 ${mirrorMode === "LIVE" ? "mirror-live" : ""}`} />}
            {mirrorMode}{mirror && mirror.pending > 0 ? ` · ${mirror.pending}` : ""}
          </span>
          <span className="hidden items-center gap-1.5 md:flex" aria-live="polite">
            <Dot on={connected} pulse /> {connected ? "WS LIVE" : "WS OFFLINE"}
          </span>
          <span className="hidden font-mono lg:inline">seq {events[0]?.seq ?? 0}</span>
          <Badge variant="outline" className="hidden border-zinc-700 font-mono text-[10px] text-zinc-500 sm:inline" title="реестр действий / цель 47">
            <Layers className="mr-1 h-3 w-3" />{catalog.length || "—"}/47
          </Badge>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 border-zinc-700 text-xs" onClick={() => setCmdOpen(true)}>
            <Terminal className="h-3.5 w-3.5" /> ⌘K
          </Button>
        </div>
      </header>

      {/* ── MAIN: 3 колонки ── */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-3 lg:overflow-hidden">
        {/* Колонка 1: ФЛОТ */}
        <section className="flex min-h-0 flex-col gap-4 lg:overflow-hidden" aria-label="Флот">
          <Card className="flex min-h-0 flex-col border-zinc-800 bg-zinc-900/40 card-lift">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <Bot className="h-4 w-4 text-emerald-400" /> ФЛОТ · АГЕНТЫ ({snap?.agents.length ?? 0})
              </CardTitle>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 gap-1 border-zinc-700 text-[11px]" disabled={busyAction}>
                    <Plus className="h-3 w-3" /> агент <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-zinc-800 bg-zinc-950">
                  <DropdownMenuLabel className="text-[10px] text-zinc-500">роль нового агента</DropdownMenuLabel>
                  {["IMPLEMENTER", "RESEARCHER", "OPERATOR"].map((r) => (
                    <DropdownMenuItem key={r} className="text-xs" onClick={() => spawnAgent(r)}>
                      <Bot className="mr-1.5 h-3.5 w-3.5 text-amber-400" /> {r}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto p-2 max-h-72 lg:max-h-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
              {(snap?.agents ?? []).length === 0 && (
                <p className="p-4 text-center text-xs text-zinc-500">флот пуст — создайте агента</p>
              )}
              {(snap?.agents ?? []).map((a) => (
                <div key={a.id} className={`group flex items-center gap-2.5 rounded-md px-2 py-2 transition hover:bg-zinc-800/60 ${a.paused === 1 ? "opacity-70 ring-1 ring-amber-900/60" : ""}`}>
                  <Dot on={a.status === "IDLE" && a.paused === 0} pulse={a.status === "BUSY"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium">{a.role}</span>
                      <Badge variant="outline" className="h-4 border-zinc-700 px-1 font-mono text-[9px] text-zinc-500">{a.model}</Badge>
                      {a.paused === 1 && <Badge className="h-4 bg-amber-700 px-1 text-[9px] text-amber-100">PAUSED</Badge>}
                    </div>
                    <p className="font-mono text-[10px] text-zinc-500">{a.id.slice(0, 14)}… · {age(a.updated_at)} назад</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Select value={modelSel[a.id] ?? a.model} onValueChange={(v) => setModelSel((m) => ({ ...m, [a.id]: v }))}>
                        <SelectTrigger
                          aria-label={`Модель агента ${a.role}`}
                          className="h-5 w-fit gap-1 border-zinc-800 bg-zinc-900 px-1.5 font-mono text-[9px] text-zinc-400 [&>svg]:h-2.5 [&>svg]:w-2.5"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-zinc-800 bg-zinc-950">
                          {MODEL_OPTIONS.map((m) => (
                            <SelectItem key={m} value={m} className="font-mono text-[10px]">{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {modelSel[a.id] && modelSel[a.id] !== a.model && (
                        <button
                          className="flex items-center gap-0.5 rounded border border-emerald-800 bg-emerald-950/50 px-1.5 py-0.5 text-[9px] text-emerald-300 transition hover:bg-emerald-900/60"
                          onClick={() => saveAgentModel(a.id, modelSel[a.id])}
                          disabled={busyAction}
                          aria-label={`Сохранить модель ${modelSel[a.id]} для ${a.role}`}
                        >
                          <Check className="h-2.5 w-2.5" aria-hidden /> сохранить
                        </button>
                      )}
                    </div>
                  </div>
                  <Badge className={`${a.paused === 1 ? STATUS_BADGE.PAUSED : STATUS_BADGE[a.status] ?? ""} h-5 px-1.5 text-[10px]`}>{a.paused === 1 ? "PAUSED" : a.status}</Badge>
                  <button
                    aria-label={a.paused === 1 ? `Возобновить ${a.role}` : `Пауза ${a.role}`}
                    className="rounded p-1 text-zinc-600 opacity-0 transition hover:bg-amber-950 hover:text-amber-400 group-hover:opacity-100"
                    onClick={() => (a.paused === 1 ? resumeAgent(a.id) : pauseAgent(a.id))}
                  >
                    {a.paused === 1 ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    aria-label={`Уволить ${a.role}`}
                    className="rounded p-1 text-zinc-600 opacity-0 transition hover:bg-rose-950 hover:text-rose-400 group-hover:opacity-100"
                    onClick={() => retireAgent(a.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* CDP-LIVE (v0.15.0): per-client jpeg q/w через собственный CDP-сервер daemon'а (:3043).
              Каденс — клиентский поллинг 2.5с; качества меняются чипами, кадр перезапрашивается тиком. */}
          <Card className="shrink-0 border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 gap-2 border-b border-zinc-800 py-3">
              <CardTitle className="flex shrink-0 items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <MonitorPlay className="h-4 w-4 text-violet-400" aria-hidden /> CDP · LIVE
              </CardTitle>
              <div className="flex flex-wrap items-center justify-end gap-1" role="group" aria-label="Качество CDP-скринкаста">
                {[30, 55, 85].map((q) => (
                  <button
                    key={q}
                    type="button"
                    aria-pressed={cdpQ === q}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[9px] transition ${cdpQ === q ? "border-violet-500 bg-violet-950/60 text-violet-300" : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"}`}
                    onClick={() => setCdpQ(q)}
                  >
                    q{q}
                  </button>
                ))}
                <span className="mx-0.5 text-zinc-700" aria-hidden>·</span>
                {[480, 640, 960].map((w) => (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={cdpW === w}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[9px] transition ${cdpW === w ? "border-violet-500 bg-violet-950/60 text-violet-300" : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"}`}
                    onClick={() => setCdpW(w)}
                  >
                    w{w}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 p-2">
              <img
                key={`${cdpQ}-${cdpW}`}
                src={`/screencast.jpg?XTransformPort=3043&q=${cdpQ}&w=${cdpW}&t=${cdpTick}`}
                alt="Живой кадр активной вкладки QA-браузера через CDP"
                className="w-full rounded border border-zinc-800 bg-zinc-950 object-cover"
                decoding="async"
                onLoad={() => cdpNextTick(1500)}
                onError={() => cdpNextTick(4000)}
              />
              <p className="font-mono text-[10px] leading-4 text-zinc-500">
                {cdpInfo?.cdp
                  ? <>cdp :{cdpInfo.cdp.port} · <span className="truncate align-bottom">{(cdpInfo.cdp.target || "—").replace(/^https?:\/\//, "").slice(0, 42)}</span> · кадров {cdpInfo.frames} · стримов {cdpInfo.streams}</>
                  : <span className="text-amber-500/80">CDP-цель не найдена — agent-browser не запущен?</span>}
              </p>
            </CardContent>
          </Card>
          <Card className="shrink-0 border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <Cpu className="h-4 w-4 text-amber-400" /> WORKERS ({snap?.workers.length ?? 0})
              </CardTitle>
              <span className="font-mono text-[10px] text-zinc-500">hb 15s · reap 90s</span>
            </CardHeader>
            <CardContent className="max-h-40 overflow-y-auto p-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700">
              {(snap?.workers ?? []).length === 0 && (
                <p className="p-3 text-center text-xs text-zinc-500">нет подключённых workers</p>
              )}
              {(snap?.workers ?? []).map((w) => (
                <div key={w.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-800/60">
                  <Dot on={w.state !== "OFFLINE"} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{w.id.slice(0, 18)}</span>
                  <Badge variant="outline" className="h-4 border-zinc-700 px-1 font-mono text-[9px] text-amber-400/80">{w.kind}</Badge>
                  <Badge className={`${STATUS_BADGE[w.state] ?? ""} h-4 px-1 text-[9px]`}>{w.state}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* R16: ГРАФ КОДА (M2) + worktree/rerere (M4) + OTel-lite (M7) — пробелы DEVOS-роадмапа */}
          <Card className="shrink-0 border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <button
                type="button"
                onClick={() => setCgOpen((o) => !o)}
                aria-expanded={cgOpen}
                aria-controls="codegraph-body"
                className="flex min-w-0 items-center gap-2 text-left"
              >
                <Network className="h-4 w-4 shrink-0 text-teal-400" aria-hidden />
                <span className="truncate text-xs font-semibold tracking-widest text-zinc-400">
                  ГРАФ КОДА{cg ? ` · ${cg.files}` : ""}
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-2">
                {cg && (
                  <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline" title="regex-tier v1 · детерминированный скан src/ + me2-daemon">
                    {cg.symbols} эксп · {cg.edges} рёбер
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void loadCg(true)}
                  disabled={cgBusy}
                  title="Пересканировать репозиторий"
                  aria-label="Пересканировать граф кода"
                  className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${cgBusy ? "animate-spin" : ""}`} aria-hidden />
                </button>
                <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${cgOpen ? "" : "-rotate-90"}`} aria-hidden />
              </span>
            </CardHeader>
            {cgOpen && (
              <div id="codegraph-body" className="space-y-3 p-3">
                <div className="grid grid-cols-4 gap-2" role="group" aria-label="Метрики графа кода">
                  {([["файлов", cg?.files], ["экспортов", cg?.symbols], ["рёбер", cg?.edges], ["скан, мс", cg?.scanMs]] as const).map(([label, v]) => (
                    <div key={label} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
                      <div className="font-mono text-sm text-teal-300">{v ?? "—"}</div>
                      <div className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</div>
                    </div>
                  ))}
                </div>

                <form onSubmit={(e) => { e.preventDefault(); void runImpact(); }} className="flex gap-2">
                  <Input
                    value={cgQuery}
                    onChange={(e) => setCgQuery(e.target.value)}
                    placeholder="impact: src/lib/db или src/app/page.tsx"
                    className="h-7 flex-1 border-zinc-800 bg-zinc-950/60 font-mono text-[11px]"
                    aria-label="Файл для impact-анализа"
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={cgBusy} className="h-7 shrink-0 border-zinc-700 px-2 text-[10px]">
                    кто зависит
                  </Button>
                </form>
                {cgImpact && (
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 font-mono text-[10px]" aria-live="polite">
                    {cgImpact.found ? (
                      <>
                        <div className="mb-1 text-zinc-300">{cgImpact.file} · входящих рёбер {cgImpact.inboundRoot}</div>
                        <div className="max-h-28 overflow-y-auto text-zinc-500 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700">
                          <div>прямые: {cgImpact.direct.length ? cgImpact.direct.join(", ") : "—"}</div>
                          <div className="mt-1">
                            транзитивно ({cgImpact.transitive.length}): {cgImpact.transitive.slice(0, 40).join(", ")}{cgImpact.transitive.length > 40 ? "…" : ""}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-amber-500/80">{cgImpact.note}</div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                    <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-600">top fan-in</div>
                    <ul className="space-y-0.5 font-mono text-[10px] text-zinc-400">
                      {(cg?.topFanIn ?? []).slice(0, 5).map((f) => (
                        <li key={f.path} className="flex justify-between gap-2">
                          <span className="truncate" title={f.path}>{f.path}</span>
                          <span className="shrink-0 text-teal-400">{f.inbound}</span>
                        </li>
                      ))}
                      {!cg && <li className="text-zinc-600">—</li>}
                    </ul>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                    <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-600">top fan-out</div>
                    <ul className="space-y-0.5 font-mono text-[10px] text-zinc-400">
                      {(cg?.topFanOut ?? []).slice(0, 5).map((f) => (
                        <li key={f.path} className="flex justify-between gap-2">
                          <span className="truncate" title={f.path}>{f.path}</span>
                          <span className="shrink-0 text-amber-400/90">{f.outbound}</span>
                        </li>
                      ))}
                      {!cg && <li className="text-zinc-600">—</li>}
                    </ul>
                  </div>
                </div>

                {wt && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 font-mono text-[10px] text-zinc-500">
                    <GitBranch className="h-3 w-3 shrink-0 text-fuchsia-400" aria-hidden />
                    <span>worktrees {wt.worktrees.worktrees.length} · HEAD {wt.head}</span>
                    <span className={wt.rerere.enabled ? "text-emerald-400" : "text-amber-500/80"} title="rerere — переиспользование записанных разрешений конфликтов (M4)">
                      rerere {wt.rerere.enabled ? "on" : "off"} · cache {wt.rerere.cacheEntries}
                    </span>
                    {!wt.rerere.enabled && (
                      <button
                        type="button"
                        onClick={() => void enableRerere()}
                        disabled={cgBusy}
                        className="ml-auto rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40"
                      >
                        включить
                      </button>
                    )}
                  </div>
                )}

                {otel && (
                  <div
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500"
                    title="OTel-lite: спаны команд шины и задач; OTLP-JSON на /spans/otlp (совместимо с Perfetto-конвертерами)"
                  >
                    <span className="uppercase tracking-wider text-zinc-600">otel-lite</span>
                    <span>спанов {otel.spans}/{otel.ringCap}</span>
                    {vd && (
                      <span
                        className={vd.count > 0 ? "text-rose-400/90" : "text-zinc-600"}
                        title="Reward-hacking вердикты (tier-1): finish без реальной работы — no_writes_on_creation_task / instant_finish / empty_result. Подозрение не меняет статус задачи — решает оператор (/verdicts)"
                      >
                        вердиктов RH: {vd.count}
                      </span>
                    )}
                    {(otel.stats ?? []).slice(0, 3).map((s) => (
                      <span key={s.name} className={s.err ? "text-rose-400/80" : ""}>
                        {s.name} ×{s.n} · ⌀{s.avgMs}ms{s.err ? ` · err ${s.err}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* R17: РОАДМАП M1–M7 — live-вердикт из реального состояния (evidence в каждой фазе) */}
          <Card className="shrink-0 border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <button
                type="button"
                onClick={() => setRmOpen((o) => !o)}
                aria-expanded={rmOpen}
                aria-controls="roadmap-body"
                className="flex min-w-0 items-center gap-2 text-left"
              >
                <ListChecks className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                <span className="truncate text-xs font-semibold tracking-widest text-zinc-400">
                  РОАДМАП M1–M7{rm ? ` · ${rm.done}/${rm.total}` : ""}
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-2">
                {rm && (
                  <span
                    className={`font-mono text-[10px] ${rm.done === rm.total ? "text-emerald-400" : "text-amber-400/90"}`}
                    title="Вердикт вычисляется из живых подсистем (bus/codegraph/src-tauri/rerere/sandbox/worker/otel)"
                  >
                    {rm.done === rm.total ? "ЗАКРЫТ" : "в работе"}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void loadRm()}
                  disabled={rmBusy}
                  title="Перевычислить вердикт"
                  aria-label="Перевычислить вердикт роадмапа"
                  className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${rmBusy ? "animate-spin" : ""}`} aria-hidden />
                </button>
                <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${rmOpen ? "" : "-rotate-90"}`} aria-hidden />
              </span>
            </CardHeader>
            {rmOpen && (
              <div id="roadmap-body" className="space-y-1.5 p-3" role="list" aria-label="Фазы роадмапа M1–M7">
                {(rm?.milestones ?? []).map((m) => (
                  <div key={m.key} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5" role="listitem">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.status === "DONE" ? "bg-emerald-400" : m.status === "PARTIAL" ? "bg-amber-400" : "bg-rose-500"}`}
                        aria-hidden
                      />
                      <span className="shrink-0 font-mono text-[10px] font-semibold text-zinc-300">{m.key}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400" title={m.title}>{m.title}</span>
                      <span
                        className={`shrink-0 font-mono text-[9px] uppercase ${m.status === "DONE" ? "text-emerald-500/90" : m.status === "PARTIAL" ? "text-amber-500/90" : "text-rose-400"}`}
                      >
                        {m.status}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-3.5 font-mono text-[9px] leading-relaxed text-zinc-600" title={m.evidence}>
                      {m.evidence}
                    </div>
                  </div>
                ))}
                {!rm && (
                  <div className="px-2 py-3 text-center font-mono text-[10px] text-zinc-600">
                    {rmBusy ? "вычисляю вердикт…" : "daemon недоступен"}
                  </div>
                )}
                {rm?.closedAt && (
                  <div className="rounded-md border border-emerald-900/60 bg-emerald-950/30 px-2 py-1.5 text-center font-mono text-[10px] text-emerald-400">
                    ✓ РОАДМАП ЗАКРЫТ · {new Date(rm.closedAt).toLocaleString("ru-RU")}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* R17: САНДБОКС (M5) — изолированные среды: create/exec/snapshot/restore/destroy */}
          <Card className="shrink-0 border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <button
                type="button"
                onClick={() => setSbOpen((o) => !o)}
                aria-expanded={sbOpen}
                aria-controls="sandbox-body"
                className="flex min-w-0 items-center gap-2 text-left"
              >
                <Boxes className="h-4 w-4 shrink-0 text-cyan-400" aria-hidden />
                <span className="truncate text-xs font-semibold tracking-widest text-zinc-400">
                  САНДБОКС{sb ? ` · ${sb.sandboxes.length}` : ""}
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-2">
                {sb && (
                  <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline" title="local: git worktree + prlimit + tar.gz sha256 · vercel: нужен SANDBOX_VERCEL_TOKEN">
                    local:{sb.providers.local === "READY" ? "✓" : "?"}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void loadSb()}
                  title="Обновить список песочниц"
                  aria-label="Обновить список песочниц"
                  className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${sbBusy ? "animate-spin" : ""}`} aria-hidden />
                </button>
                <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${sbOpen ? "" : "-rotate-90"}`} aria-hidden />
              </span>
            </CardHeader>
            {sbOpen && (
              <div id="sandbox-body" className="space-y-3 p-3">
                <form
                  onSubmit={(e) => { e.preventDefault(); const id = sbId.trim().toLowerCase(); if (id) void sbOp("create", { id }, `песочница ${id} создана`); }}
                  className="flex gap-2"
                >
                  <Input
                    value={sbId}
                    onChange={(e) => setSbId(e.target.value)}
                    placeholder="имя: r18-fix (a-z0-9._-)"
                    className="h-7 flex-1 border-zinc-800 bg-zinc-950/60 font-mono text-[11px]"
                    aria-label="Имя новой песочницы"
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={sbBusy} className="h-7 shrink-0 border-zinc-700 px-2 text-[10px]">
                    <Plus className="mr-1 h-3 w-3" aria-hidden /> создать
                  </Button>
                </form>

                <div className="space-y-1.5" aria-label="Активные песочницы">
                  {(sb?.sandboxes ?? []).map((s) => (
                    <div key={s.id} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
                      <div className="flex items-center gap-2 font-mono text-[10px]">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.status === "READY" ? "bg-emerald-400" : s.status === "RESTORED" ? "bg-cyan-400" : "bg-rose-500"}`} aria-hidden />
                        <span className="shrink-0 font-semibold text-zinc-300">{s.id}</span>
                        <span className="text-zinc-600" title={`HEAD ${s.head} · ${s.status}`}>{s.head}</span>
                        <span className="text-zinc-600">· cmds {s.cmds}</span>
                        {typeof s.diskKb === "number" && <span className="text-zinc-600">· {(s.diskKb / 1024).toFixed(1)} МБ</span>}
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void sbOp("snapshot", { id: s.id }, `снапшот ${s.id} готов`)}
                            disabled={sbBusy}
                            title="tar.gz + sha256 (без .git/node_modules)"
                            aria-label={`Снапшот песочницы ${s.id}`}
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40"
                          >
                            снап
                          </button>
                          <button
                            type="button"
                            onClick={() => { if (confirm(`Уничтожить песочницу ${s.id}? Снапшоты останутся.`)) void sbOp("destroy", { id: s.id }, `песочница ${s.id} уничтожена`); }}
                            disabled={sbBusy}
                            title="git worktree remove (снапшоты остаются)"
                            aria-label={`Уничтожить песочницу ${s.id}`}
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-rose-400/90 transition hover:bg-zinc-800 disabled:opacity-40"
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                    </div>
                  ))}
                  {sb && sb.sandboxes.length === 0 && (
                    <div className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-[10px] text-zinc-600">
                      пусто — создайте песочницу для изолированного запуска команд
                    </div>
                  )}
                </div>

                {(sb?.sandboxes.length ?? 0) > 0 && (
                  <form
                    onSubmit={(e) => { e.preventDefault(); const id = sb.sandboxes[0]?.id; const cmd = sbCmd.trim(); if (id && cmd) { void sbOp("exec", { id, cmd, timeoutSec: 30 }); setSbCmd(""); } }}
                    className="flex gap-2"
                  >
                    <Input
                      value={sbCmd}
                      onChange={(e) => setSbCmd(e.target.value)}
                      placeholder={`exec в ${sb.sandboxes[0].id}: bun run lint | git status | …`}
                      className="h-7 flex-1 border-zinc-800 bg-zinc-950/60 font-mono text-[11px]"
                      aria-label="Команда для исполнения в первой песочнице"
                    />
                    <Button type="submit" size="sm" variant="outline" disabled={sbBusy} className="h-7 shrink-0 border-zinc-700 px-2 text-[10px]">
                      <Play className="mr-1 h-3 w-3" aria-hidden /> run
                    </Button>
                  </form>
                )}

                {sbRun && (
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 font-mono text-[10px]" aria-live="polite">
                    <div className="mb-1 flex items-center gap-2 text-zinc-400">
                      <span className={sbRun.ok ? "text-emerald-400" : "text-rose-400"}>exit {sbRun.exitCode}</span>
                      <span className="text-zinc-600">· {sbRun.ms}мс · {sbRun.limit}</span>
                    </div>
                    <div className="max-h-28 overflow-y-auto whitespace-pre-wrap text-zinc-500 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700">
                      {sbRun.stdout || "(stdout пуст)"}
                      {sbRun.stderr && <div className="mt-1 text-rose-400/70">{sbRun.stderr}</div>}
                    </div>
                  </div>
                )}

                {(sb?.snapshots.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-600">снапшоты (durable)</div>
                    {(sb?.snapshots ?? []).slice(0, 4).map((sn) => (
                      <div key={sn.file} className="flex items-center gap-2 rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1 font-mono text-[9px] text-zinc-500">
                        <span className="min-w-0 flex-1 truncate" title={sn.file}>{sn.file.split("/").pop()}</span>
                        <span className="shrink-0 text-zinc-600">{(sn.bytes / 1048576).toFixed(1)} МБ</span>
                        <button
                          type="button"
                          onClick={() => void sbOp("restore", { snapshotFile: sn.file }, `восстановлено в новую песочницу`)}
                          disabled={sbBusy}
                          title="Распаковать в новую песочницу (plain copy)"
                          className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40"
                        >
                          restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {sb && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[9px] text-zinc-600" title="Провайдеры плоскости">
                    {Object.entries(sb.providers).map(([k, v]) => (
                      <span key={k}><span className="text-zinc-500">{k}</span> = {v}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

        </section>

        {/* Колонка 2: ОЧЕРЕДЬ + ВЕТКИ */}
        <section className="mc-scroll flex min-h-0 flex-col gap-4 lg:overflow-y-auto" aria-label="Очередь задач">
          {/* castOn: карточка натуральной высоты (список ветвей целиком), скроллит секция-колонка —
              иначе flex-1 список сжимается до ~8px и клиппится overflow-hidden карточки (урок R8/R9) */}
          <Card className={`flex min-h-0 flex-col gap-0 overflow-hidden border-zinc-800 bg-zinc-900/40 py-0 card-lift ${castOn ? "lg:max-h-none lg:shrink-0" : "lg:max-h-[42vh]"}`}>
            <CardHeader className="shrink-0 border-b border-zinc-800 p-0">
              <button
                type="button"
                onClick={() => setBranchesOpen((o) => !o)}
                aria-expanded={branchesOpen}
                aria-controls="branch-panel-body"
                className="flex w-full items-center justify-between rounded-t-xl px-6 py-3 text-left transition hover:bg-zinc-900/70"
              >
                <span className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                  <GitBranch className="h-4 w-4 text-fuchsia-400" aria-hidden /> ВЕТКИ · ЗАДАЧИ ({branchData.length})
                </span>
                <span className="flex items-center gap-2">
                  {retryMetrics && retryMetrics.retries > 0 && (
                    <span
                      className="hidden font-mono text-[9px] text-zinc-500 sm:inline"
                      title="Pass-rate ретраев: завершено с LLM-уроком (violet) vs без — живое измерение Reflexion-эффекта (/metrics). A/B — рандомизированные группы авто-рефлексии: treatment получает авто-урок, control — нет (intent-to-treat); crossover — контрольные, получившие ручной урок"
                    >
                      ↳ <span className="text-violet-400">{retryMetrics.with_lesson.completed}/{retryMetrics.with_lesson.n}</span> с уроком · <span className="text-zinc-400">{retryMetrics.without_lesson.completed}/{retryMetrics.without_lesson.n}</span> без
                      {retryMetrics.ab && (retryMetrics.ab.treatment.n > 0 || retryMetrics.ab.control.n > 0) ? (
                        <>
                          {' '}· A/B <span className="text-fuchsia-400">T {retryMetrics.ab.treatment.completed}/{retryMetrics.ab.treatment.n}</span> · <span className="text-zinc-500">C {retryMetrics.ab.control.completed}/{retryMetrics.ab.control.n}</span>
                          {retryMetrics.ab.control_crossover > 0 ? <span className="text-amber-400/80"> · x{retryMetrics.ab.control_crossover}</span> : null}
                        </>
                      ) : null}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-zinc-600">{branchesOpen ? "git-graph" : "свёрнуто"}</span>
                  <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${branchesOpen ? "" : "-rotate-90"}`} aria-hidden />
                </span>
              </button>
            </CardHeader>
            {branchesOpen && (
              <div id="branch-panel-body" className="flex min-h-0 flex-col">
                {/* вкладки в стиле браузера */}
                <div className="flex shrink-0 items-end gap-1 overflow-x-auto border-b border-zinc-800 px-3 pt-2" role="tablist" aria-label="Фильтр ветвей">
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
                            ? "border-zinc-700 bg-zinc-800/90 text-zinc-100 shadow-[0_-2px_6px_rgba(0,0,0,0.35)]"
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
                {/* ветки браузера: живые вкладки agent-browser (v0.6.0) */}
                <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800/60 bg-black/20 px-3 py-1.5" aria-label="Ветки браузера">
                  <span className="flex shrink-0 items-center gap-1 pr-1 text-[9px] font-semibold tracking-widest text-zinc-500">
                    <AppWindow className="h-3 w-3 text-sky-400" aria-hidden /> БРАУЗЕР
                  </span>
                  {browserTabs.length === 0 && !browserBusy && (
                    <button type="button" onClick={loadBrowserTabs} className="shrink-0 text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
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
                    onClick={() => setCastOn((v) => !v)}
                    aria-pressed={castOn}
                    title="Живой вид активной вкладки — WS-стрим агента-браузера (:3042)"
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
                      onClick={toggleCastCtl}
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
                    onClick={loadBrowserTabs}
                    aria-label="Обновить вкладки браузера"
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <RefreshCw className={`h-3 w-3 ${browserBusy ? "animate-spin" : ""}`} aria-hidden />
                  </button>
                </div>
                {castOn && (
                  <div className="shrink-0 border-b border-zinc-800/60 bg-black/40 px-3 py-2">
                    <div
                      ref={castWrapRef}
                      tabIndex={castCtl ? 0 : -1}
                      onKeyDown={castKey}
                      aria-label={castCtl ? "Живой вид вкладки — ручное управление включено" : "Живой вид активной вкладки браузера"}
                      className={`relative overflow-hidden rounded-md border bg-black transition ${
                        castCtl
                          ? "cursor-crosshair select-none border-amber-500/70 ring-1 ring-amber-500/40 focus-visible:outline-none focus-visible:ring-amber-400"
                          : "border-zinc-800"
                      }`}
                    >
                      <img
                        ref={castImgRef}
                        alt="Живой вид активной вкладки браузера"
                        className="block max-h-40 w-full object-contain lg:max-h-48"
                        draggable={false}
                        onPointerDown={(e) => castSendMouse("mousePressed", e)}
                        onPointerUp={(e) => castSendMouse("mouseReleased", e)}
                        onContextMenu={(e) => { if (castCtl) e.preventDefault(); }}
                      />
                      {castCtl && (
                        <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-black shadow">
                          <MousePointerClick className="h-3 w-3" aria-hidden /> РУЛЬ · клики/клавиатура → вкладка
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/75 px-2 py-0.5 font-mono text-[9px] text-zinc-400">
                        <span className="truncate">{castStat.url ?? "ожидание кадра…"}</span>
                        <span className="shrink-0">
                          {castStat.connected ? (
                            <span className="text-emerald-400">● {castStat.fps} fps{castStat.kbs != null ? ` · ${castStat.kbs} КБ/с` : ""}{castStat.lastAge != null ? ` · ${castStat.lastAge}ms` : ""}</span>
                          ) : (
                            <span className="text-rose-400">● offline</span>
                          )}
                        </span>
                      </div>
                      {!castStat.connected && (
                        <div className="absolute inset-0 grid place-items-center bg-black/60 text-[10px] text-zinc-500">
                          {castStat.error ?? "подключение к стриму :3042…"}
                        </div>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCastConOpen((v) => !v)}
                        aria-expanded={castConOpen}
                        title="Живая лента console-событий вкладки из стрима (не в audit-журнале)"
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                      >
                        <Terminal className="h-3 w-3" aria-hidden />
                        консоль ({castConsole.length})
                      </button>
                      {/* v0.9.0: профили полосы — per-client pacing+maxFps; смена профиля = реконнект с новыми URL-параметрами (покрывают открывающий кадр) */}
                      <div role="group" aria-label="Профиль полосы стрима" className="flex items-center gap-0.5 rounded border border-zinc-800 bg-black/40 p-0.5">
                        {(Object.keys(CAST_PROFILES) as CastProfile[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setCastProfile(p)}
                            aria-pressed={castProfile === p}
                            title={
                              p === "макс" ? "push-пейсинг, до 12 fps — минимум задержки (для руля)"
                              : p === "баланс" ? "ack-пейсинг, 8 fps — один кадр в полёте, без очередей"
                              : p === "эконом" ? "ack-пейсинг, 2 fps — минимум полосы для слабой сети"
                              : "ack-пейсинг, потолок fps подстраивается под измеренную полосу (2..12)"
                            }
                            className={`rounded px-1.5 py-0.5 font-mono text-[9px] transition ${
                              castProfile === p ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                      <span className="text-[9px] text-zinc-600">живая лента стрима — не в audit-журнале</span>
                    </div>
                    {castConOpen && (
                      <div className="mc-scroll mt-1 max-h-16 overflow-y-auto rounded border border-zinc-800 bg-black/60 p-1.5 font-mono text-[9px] leading-relaxed">
                        {castConsole.length === 0 ? (
                          <p className="text-zinc-600">нет console-событий в этой сессии (http(s)-страницы; file:// не эмитит)</p>
                        ) : (
                          castConsole.map((m) => (
                            <div key={m.id} className="flex gap-1.5">
                              <span className={m.level === "error" ? "shrink-0 text-rose-400" : m.level === "warning" ? "shrink-0 text-amber-400" : "shrink-0 text-sky-400"}>{m.level}</span>
                              <span className="truncate text-zinc-300" title={m.text}>{m.text}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="mc-scroll min-h-0 flex-1 basis-auto overflow-y-auto px-2 py-1">
                  {branchTasks.length === 0 ? (
                    <p className="p-4 text-center text-xs text-zinc-500">в этой вкладке ветвей нет</p>
                  ) : (
                    <BranchGraph tasks={branchTasks} onOpen={openDetail} onRetry={(t) => void retryTask(t.id)} onReflect={(t) => void reflectTask(t)} reflectingId={reflectingId} />
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-zinc-800 bg-zinc-900/40 card-lift lg:min-h-52">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <ListChecks className="h-4 w-4 text-emerald-400" /> ОЧЕРЕДЬ ЗАДАЧ ({snap?.tasks.length ?? 0})
              </CardTitle>
              <Button size="sm" className="h-7 gap-1 bg-emerald-600 text-[11px] hover:bg-emerald-500" onClick={() => setNewTaskOpen(true)}>
                <Plus className="h-3 w-3" /> задача <span className="ml-1 rounded bg-black/20 px-1 font-mono text-[9px]">N</span>
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 max-h-96 lg:max-h-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
              {(snap?.tasks ?? []).length === 0 && (
                <p className="p-4 text-center text-xs text-zinc-500">очередь пуста — нажмите N</p>
              )}
              {(snap?.tasks ?? []).map((t) => (
                <button
                  key={t.id}
                  className="w-full rounded-md border border-zinc-800/80 bg-zinc-900/60 p-2.5 text-left transition hover:border-zinc-600 hover:bg-zinc-800/60"
                  onClick={() => openDetail(t)}
                >
                  <div className="flex items-center gap-2">
                    <Badge className={`${STATUS_BADGE[t.status] ?? ""} h-5 px-1.5 text-[10px]`}>{t.status}</Badge>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{t.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">{age(t.created_at)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress value={(t.steps / Math.max(1, t.max_steps)) * 100} className="h-1 flex-1 bg-zinc-800 [&>div]:bg-emerald-500" />
                    <span className="font-mono text-[9px] text-zinc-500">{t.steps}/{t.max_steps} шаг.</span>
                    {t.role && <Badge variant="outline" className="h-4 border-zinc-700 px-1 text-[9px] text-zinc-500">{t.role}</Badge>}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="min-h-0 overflow-hidden border-zinc-800 bg-zinc-900/40 card-lift lg:max-h-[36vh]">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <Zap className="h-4 w-4 text-fuchsia-400" /> COMMAND BUS
              </CardTitle>
              <span className="font-mono text-[10px] text-zinc-500">бюджет {budget.used}/{budget.limit} / 60s</span>
            </CardHeader>
            <CardContent className="max-h-44 min-h-0 grow basis-auto space-y-1 overflow-y-auto p-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700">
              {scheduledCommands.length > 0 && (
                <div className="mb-1.5 space-y-1 rounded-md border border-lime-900/50 bg-lime-950/20 p-1.5">
                  {scheduledCommands.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded px-1 py-0.5">
                      <Clock className="h-3 w-3 shrink-0 text-lime-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-lime-200">{c.action}</span>
                      <span className="font-mono text-[10px] text-lime-400/90">ETA {etaOf(c)}</span>
                      <button
                        aria-label={`Отменить ${c.action} по расписанию`}
                        className="rounded p-0.5 text-zinc-600 transition hover:bg-rose-950 hover:text-rose-400"
                        onClick={() => cancelCommand(c.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {(snap?.commands ?? []).slice(0, 12).map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-800/60">
                  <Badge variant="outline" className={`h-4 border px-1 font-mono text-[9px] ${laneChip(c.lane)}`}>{c.lane}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{c.action}</span>
                  <span className="font-mono text-[9px] text-zinc-600">cost {c.cost}</span>
                  <Badge className={`${STATUS_BADGE[c.status] ?? ""} h-4 px-1 text-[9px]`}>{c.status}</Badge>
                </div>
              ))}
              {(snap?.commands ?? []).length === 0 && <p className="p-3 text-center text-xs text-zinc-500">шина пуста</p>}
            </CardContent>
          </Card>
        </section>

        {/* Колонка 3: EVENT LOG */}
        <section className="flex min-h-0 flex-col gap-4 lg:overflow-hidden" aria-label="Журнал событий">
          <Card className="flex min-h-0 flex-1 flex-col border-zinc-800 bg-zinc-900/40 card-lift">
            <CardHeader className="flex-row items-center justify-between space-y-0 gap-2 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <Activity className="h-4 w-4 text-cyan-400" /> EVENT LOG
              </CardTitle>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                  {liveTail ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {liveTail ? "live" : "пауза"}
                  <Switch checked={liveTail} onCheckedChange={setLiveTail} aria-label="Живой хвост событий" className="scale-75" />
                </label>
              </div>
            </CardHeader>
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
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
              <label className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500">
                автоскролл
                <Switch checked={autoScroll} onCheckedChange={setAutoScroll} aria-label="Автоскролл лога" className="scale-75" />
              </label>
            </div>
            <CardContent
              ref={logRef}
              className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2 font-mono text-[10.5px] leading-relaxed max-h-96 lg:max-h-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent"
            >
              {filteredEvents.length === 0 && (
                <p className="p-4 text-center text-zinc-500">{events.length ? "ничего не найдено по фильтру" : "ожидание событий…"}</p>
              )}
              {filteredEvents.map((e, i) => (
                <div key={e.seq} className="ev-in flex gap-2 rounded px-1.5 py-0.5 hover:bg-zinc-800/50" style={{ animationDelay: `${Math.min(i, 12) * 24}ms` }}>
                  <span className="shrink-0 text-zinc-600">{e.seq}</span>
                  <span className="shrink-0 text-zinc-500">{hhmmss(e.ts)}</span>
                  <span className={`w-36 shrink-0 font-semibold ${EVENT_STYLE[e.type] ?? "text-zinc-400"}`}>{e.type}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-500">{e.data}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>

      {/* ── СТАТУС-БАР (sticky footer) ── */}
      <footer className="mt-auto flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-800 bg-zinc-900/80 px-4 py-2 text-[11px] text-zinc-400 backdrop-blur">
        <span className="flex items-center gap-1.5" aria-live="polite">
          <Dot on={connected} pulse /> {connected ? "daemon live" : "daemon offline"}
        </span>
        <span className="flex items-center gap-1.5"><Boxes className="h-3.5 w-3.5 text-emerald-400" />
          флот: <b className="text-zinc-200">{stats.agentsBusy ?? 0}</b> занят / <b className="text-zinc-200">{stats.agentsIdle ?? 0}</b> свободен
        </span>
        <span className="flex items-center gap-1.5"><Crosshair className="h-3.5 w-3.5 text-amber-400" />
          задачи: <b className="text-zinc-200">{stats.tasksReady ?? 0}</b> ready · <b className="text-zinc-200">{stats.tasksRunning ?? 0}</b> running · <b className="text-emerald-400">{stats.tasksCompleted ?? 0}</b> done · <b className="text-rose-400">{stats.tasksFailed ?? 0}</b> fail
        </span>
        <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-400" title="реестр действий /actions · цель 47">
          <Layers className="mr-1 h-3 w-3" />{catalog.length || "—"}/47 действий
        </Badge>
        <span className="flex min-w-28 items-center gap-1.5"><Gauge className="h-3.5 w-3.5 text-fuchsia-400" />
          бюджет: <b className={budgetPct > 80 ? "text-rose-400" : "text-zinc-200"}>{budgetPct}%</b>
          <Progress value={budgetPct} className={`h-1 w-16 bg-zinc-800 [&>div]:${budgetColor}`} />
        </span>
        <span className={`hidden items-center gap-1.5 md:flex ${mirrorColor}`}>
          {mirrorMode === "OFF" ? <CloudOff className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
          зеркало: <b className="text-zinc-200">{mirrorMode}</b> · outbox <b className="text-zinc-200">{mirror?.pending ?? 0}</b>
        </span>
        {scheduledCommands.length > 0 && (
          <span className="flex items-center gap-1.5 text-lime-400">
            <Clock className="h-3.5 w-3.5" /> отложено: <b>{scheduledCommands.length}</b>
          </span>
        )}
        <span className="hidden items-center gap-1 text-[10px] text-zinc-600 xl:flex">
          <kbd className="rounded border border-zinc-700 px-1">⌘K</kbd> палитра · <kbd className="rounded border border-zinc-700 px-1">N</kbd> задача
        </span>
        <span className="ml-auto hidden font-mono text-[10px] text-zinc-600 md:inline">
          boot {snap?.meta.boot ? hhmmss(snap.meta.boot) : "—"} · ws :3040 · rest :3041
        </span>
      </footer>

      {/* ── ⌘K ПАЛИТРА ── */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="команда ME2… · реестр {catalog.length || '…'}/47 · полоса авто" />
        <CommandList>
          <CommandEmpty>не найдено</CommandEmpty>
          <CommandGroup heading="Задачи">
            <CommandItem onSelect={() => { setCmdOpen(false); setNewTaskOpen(true); }}>
              <Plus className="mr-2 h-4 w-4 text-emerald-400" /> Новая задача… <span className="ml-auto text-xs text-zinc-500">MUTATION</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Флот">
            {["IMPLEMENTER", "RESEARCHER", "OPERATOR"].map((r) => (
              <CommandItem key={r} onSelect={() => spawnAgent(r)}>
                <Bot className="mr-2 h-4 w-4 text-amber-400" /> Создать агента {r}
              </CommandItem>
            ))}
            <CommandItem onSelect={() => { sendCommand("FLEET_RECONCILE", {}, { lane: "CONTROL" }); setCmdOpen(false); }}>
              <RefreshCw className="mr-2 h-4 w-4 text-amber-400" /> Сверка флота (reconcile) <span className="ml-auto text-xs text-zinc-500">CONTROL</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Диагностика">
            <CommandItem onSelect={() => { sendCommand("PING", {}, { quiet: true, successMsg: "pong" }); setCmdOpen(false); }}>
              <Zap className="mr-2 h-4 w-4 text-emerald-400" /> PING <span className="ml-auto text-xs text-zinc-500">READ_ONLY</span>
            </CommandItem>
            <CommandItem onSelect={() => { sendCommand("STATE_SNAPSHOT", {}, { quiet: true }); setCmdOpen(false); }}>
              <Boxes className="mr-2 h-4 w-4 text-cyan-400" /> Снапшот состояния
            </CommandItem>
            <CommandItem onSelect={exportEvents}>
              <Download className="mr-2 h-4 w-4 text-cyan-400" /> Экспорт журнала (500 событий, JSON)
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Опасная зона">
            <CommandItem onSelect={budgetFlush} className="text-rose-400">
              <Gauge className="mr-2 h-4 w-4" /> Сбросить очередь шины (FLUSH)… <span className="ml-auto text-xs text-rose-500/70">EMERGENCY</span>
            </CommandItem>
            <CommandItem onSelect={() => { setCmdOpen(false); setResetConfirm(true); }} className="text-rose-400">
              <Trash2 className="mr-2 h-4 w-4" /> Сброс среды (EMERGENCY)…
            </CommandItem>
          </CommandGroup>
          {catalog.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={`Реестр действий шины · ${catalog.length}/47`}>
                {catalog.map((m) => (
                  <CommandItem key={m.action} value={`${m.action} ${m.desc} ${m.group}`} onSelect={() => runRegistryAction(m)}>
                    <Badge variant="outline" className={`mr-2 h-4 shrink-0 border px-1 font-mono text-[8px] ${laneChip(m.lane)}`}>{m.lane.slice(0, 4)}</Badge>
                    <span className="font-mono text-xs">{m.action}</span>
                    <span className="ml-2 truncate text-[10px] text-zinc-500">{m.desc}</span>
                    <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-600">c{m.cost}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      {/* ── НОВАЯ ЗАДАЧА ── */}
      <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm tracking-widest"><Rocket className="h-4 w-4 text-emerald-400" /> НОВАЯ ЗАДАЧА</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">через command bus · полоса MUTATION · бюджет 24/60s</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="t-title" className="text-xs text-zinc-400">Заголовок</Label>
              <Input id="t-title" value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="короткое имя задачи" className="border-zinc-800 bg-zinc-900 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-spec" className="text-xs text-zinc-400">Спецификация <span className="text-rose-500">*</span></Label>
              <Textarea id="t-spec" value={fSpec} onChange={(e) => setFSpec(e.target.value)} placeholder="что именно нужно сделать; агент получает это как задание" rows={5} className="border-zinc-800 bg-zinc-900 font-mono text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-zinc-400">Роль</Label>
                <Select value={fRole} onValueChange={setFRole}>
                  <SelectTrigger className="border-zinc-800 bg-zinc-900 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-950">
                    <SelectItem value="ANY">любая</SelectItem>
                    <SelectItem value="IMPLEMENTER">IMPLEMENTER</SelectItem>
                    <SelectItem value="RESEARCHER">RESEARCHER</SelectItem>
                    <SelectItem value="OPERATOR">OPERATOR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-steps" className="text-xs text-zinc-400">Макс. шагов</Label>
                <Input id="t-steps" type="number" min={1} max={24} value={fSteps} onChange={(e) => setFSteps(e.target.value)} className="border-zinc-800 bg-zinc-900 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-delay" className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Clock className="h-3 w-3 text-lime-500" /> Отложенный запуск (сек, 0 = сразу)
              </Label>
              <Input id="t-delay" type="number" min={0} max={3600} value={fDelay} onChange={(e) => setFDelay(e.target.value)} className="border-zinc-800 bg-zinc-900 text-sm" />
              {Number(fDelay) > 0 && (
                <p className="text-[10px] text-lime-500/80">задача появится в очереди через {Number(fDelay)}s — команду TASK_ENQUEUE исполнит дренаж шины; отменить можно в COMMAND BUS до ETA</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-zinc-700" onClick={() => setNewTaskOpen(false)}>отмена</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={createTask} disabled={busyAction}>
              {Number(fDelay) > 0 ? <Clock className="mr-1 h-3.5 w-3.5" /> : <Rocket className="mr-1 h-3.5 w-3.5" />}
              {Number(fDelay) > 0 ? `запланировать через ${Number(fDelay)}s` : "поставить в очередь"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ПОИСК ПО СОБЫТИЯМ (EVENTS_SEARCH) ── */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm tracking-widest">
              <Search className="h-4 w-4 text-cyan-400" aria-hidden /> EVENTS_SEARCH
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">
              подстрочный поиск по type+data журнала · limit ≤ 200 · полоса READ_ONLY · cost 1
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex gap-2">
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && searchQ.trim()) void runEventsSearch(); }}
                placeholder="строка поиска, напр. TASK"
                aria-label="Строка поиска событий"
                className="h-8 flex-1 border-zinc-800 bg-zinc-900 font-mono text-xs"
              />
              <Input
                value={searchLimit}
                onChange={(e) => setSearchLimit(e.target.value)}
                type="number" min={1} max={200}
                aria-label="Лимит результатов"
                className="h-8 w-20 border-zinc-800 bg-zinc-900 font-mono text-xs"
              />
            </div>
            <Button size="sm" className="h-8 w-full bg-cyan-700 text-white hover:bg-cyan-600" onClick={runEventsSearch} disabled={busyAction || !searchQ.trim()}>
              найти
            </Button>
            {searchRes && (
              <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
                <p className="mb-1 text-[10px] text-zinc-400">
                  найдено: <b className="text-cyan-300">{searchRes.count}</b> по «{searchRes.q}» {searchRes.count > searchRes.preview.length ? `(первые ${searchRes.preview.length})` : ""}
                </p>
                <div className="mc-scroll max-h-40 space-y-0.5 overflow-y-auto font-mono text-[10px]">
                  {searchRes.preview.map((e) => (
                    <div key={e.seq} className="flex gap-2">
                      <span className="shrink-0 text-zinc-600">{e.seq}</span>
                      <span className={`w-32 shrink-0 truncate ${EVENT_STYLE[e.type] ?? "text-zinc-400"}`}>{e.type}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-500">{e.data}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── ЛИМИТ БЮДЖЕТА ШИНЫ (BUDGET_ADJUST) ── */}
      <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm tracking-widest">
              <Gauge className="h-4 w-4 text-fuchsia-400" aria-hidden /> BUDGET_ADJUST
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">
              лимит стоимости команд на 60s · clamp 6..96 · сейчас {budgetLimitNow}/60s
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2">
              <Input
                id="b-limit"
                type="number" min={6} max={96}
                value={budgetVal}
                onChange={(e) => setBudgetVal(e.target.value)}
                aria-label="Новый лимит бюджета"
                className="h-8 w-24 border-zinc-800 bg-zinc-900 font-mono text-sm"
              />
              <span className="text-xs text-zinc-500">cost / 60s</span>
              <div className="ml-auto flex gap-1" role="group" aria-label="Пресеты лимита">
                {[24, 32, 48, 96].map((n) => (
                  <button
                    key={n}
                    onClick={() => setBudgetVal(String(n))}
                    aria-pressed={Number(budgetVal) === n}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                      Number(budgetVal) === n
                        ? "border-fuchsia-700 bg-fuchsia-950/60 text-fuchsia-300"
                        : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <Button size="sm" className="h-8 w-full bg-fuchsia-700 text-white hover:bg-fuchsia-600" onClick={runBudgetAdjust} disabled={busyAction}>
              применить (CONTROL)
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── ДЕТАЛЬ ЗАДАЧИ + LIVE-СТРИМ ── */}
      <Sheet open={!!detail} onOpenChange={(o) => { if (!o) { setDetail(null); detailIdRef.current = null; } }}>
        <SheetContent side="right" className="flex w-full flex-col overflow-hidden border-zinc-800 bg-zinc-950 sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader className="shrink-0 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className={`${STATUS_BADGE[detail.status] ?? ""} text-[10px]`}>{detail.status}</Badge>
                  {detail.role && <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">{detail.role}</Badge>}
                  <span className="ml-auto font-mono text-[10px] text-zinc-500">{detail.id}</span>
                </div>
                <SheetTitle className="text-sm leading-snug">{detail.title}</SheetTitle>
                <SheetDescription className="text-[11px] text-zinc-500">
                  шагов {detail.steps}/{detail.max_steps} · создана {age(detail.created_at)} назад · обновлена {age(detail.updated_at)} назад
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700">
                <div>
                  <p className="mb-1 text-[10px] font-semibold tracking-widest text-zinc-500">СПЕЦИФИКАЦИЯ</p>
                  <pre className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-[11px] text-zinc-300">{detail.spec}</pre>
                </div>
                {detail.result && (
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-widest text-emerald-500"><CheckCircle2 className="h-3 w-3" /> РЕЗУЛЬТАТ</p>
                    <pre className="whitespace-pre-wrap rounded-md border border-emerald-900/50 bg-emerald-950/30 p-3 font-mono text-[11px] text-emerald-200">{detail.result}</pre>
                  </div>
                )}
                {detail.error && (
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-widest text-rose-500"><AlertTriangle className="h-3 w-3" /> ОШИБКА</p>
                    <pre className="whitespace-pre-wrap rounded-md border border-rose-900/50 bg-rose-950/30 p-3 font-mono text-[11px] text-rose-200">{detail.error}</pre>
                  </div>
                )}
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-widest text-cyan-500">
                    <Activity className="h-3 w-3" /> ХРОНИКА ШАГОВ ({stream.length})
                  </p>
                  <div ref={streamRef} className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900/40 p-2 font-mono text-[10px] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700">
                    {stream.length === 0 && <p className="p-2 text-center text-zinc-500">хроника пуста</p>}
                    {stream.map((e) => (
                      <div key={e.seq} className="flex gap-2 rounded px-1 py-0.5 hover:bg-zinc-800/50">
                        <span className="shrink-0 text-zinc-600">{hhmmss(e.ts)}</span>
                        <span className={`w-28 shrink-0 font-semibold ${EVENT_STYLE[e.type] ?? "text-zinc-400"}`}>{e.type}</span>
                        <span className="min-w-0 flex-1 truncate text-zinc-500">{e.data}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 border-t border-zinc-800 p-3">
                {(detail.status === "READY" || detail.status === "RUNNING") && (
                  <Button variant="destructive" size="sm" className="flex-1" onClick={() => cancelTask(detail.id)}>
                    <X className="mr-1 h-3.5 w-3.5" /> отменить (CONTROL)
                  </Button>
                )}
                {(detail.status === "FAILED" || detail.status === "CANCELLED") && (
                  <>
                    <Button size="sm" className="flex-1 bg-amber-600 text-black hover:bg-amber-500" onClick={() => retryTask(detail.id)} disabled={busyAction}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> повторить (MUTATION)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 border-violet-800 text-violet-300 hover:bg-violet-950/60"
                      onClick={() => void reflectTask(detail)}
                      disabled={busyAction || reflectingId === detail.id}
                      title="Tier-2 LLM-рефлексия: вербальный урок провала запишется в tasks.reflection.llm"
                    >
                      <Sparkles className={`mr-1 h-3.5 w-3.5 ${reflectingId === detail.id ? "animate-pulse" : ""}`} />
                      llm-урок
                    </Button>
                  </>
                )}
                {(detail.status === "COMPLETED" || detail.status === "FAILED" || detail.status === "CANCELLED") && (
                  <Button variant="outline" size="sm" className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800" onClick={() => archiveTask(detail.id)} disabled={busyAction}>
                    <Archive className="mr-1 h-3.5 w-3.5" /> в архив (MUTATION)
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── ПОДТВЕРЖДЕНИЕ СБРОСА ── */}
      <Dialog open={resetConfirm} onOpenChange={setResetConfirm}>
        <DialogContent className="border-rose-900 bg-zinc-950 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm text-rose-400"><Trash2 className="h-4 w-4" /> СБРОС СРЕДЫ · EMERGENCY</DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Будут удалены ВСЕ задачи, агенты и команды. Это полоса EMERGENCY — бюджет игнорируется. Действие необратимо.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-zinc-700" onClick={() => setResetConfirm(false)}>отмена</Button>
            <Button variant="destructive" size="sm" onClick={environmentReset}>сбросить всё</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
