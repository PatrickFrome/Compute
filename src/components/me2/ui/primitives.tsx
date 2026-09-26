"use client";
// ── ME2 UI PRIMITIVES: единый дизайн-язык (R74) ─────────────────────────────────
// Плотная профессиональная вёрстка: zinc-dark + emerald-акцент, иконка+текст+цвет
// для состояний (никогда не только цвет — §9 дизайн-дока).

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Play, Pause, Clock, OctagonAlert, XCircle, RotateCw, CheckCircle2, WifiOff,
  AlertTriangle, Loader2, Radio,
} from "lucide-react";
import { STATUS_BADGE } from "@/lib/me2-bus";

// ── Dot: живой индикатор ────────────────────────────────────────────────────────
export function Dot({ on, pulse }: { on: boolean; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${on ? "bg-emerald-400" : "bg-rose-500"} ${pulse && on ? "animate-pulse" : ""}`}
    />
  );
}

// ── useCountUp: плавный счётчик KPI ─────────────────────────────────────────────
export function useCountUp(target: number): number {
  const [val, setVal] = useState(target);
  const raf = useRef<number | null>(null);
  const from = useRef(target);
  useEffect(() => {
    if (from.current === target) return;
    const start = performance.now();
    const a = from.current;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 320);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(a + (target - a) * eased);
      setVal(v);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else { from.current = target; }
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target]);
  useEffect(() => { from.current = val; }, [val]);
  return val;
}

// ── KpiTile: плитка метрики ─────────────────────────────────────────────────────
export function KpiTile({ label, value, icon: Icon, tone = "zinc", hot }: {
  label: string; value: number; icon: LucideIcon; tone?: "zinc" | "emerald" | "amber" | "rose"; hot?: boolean;
}) {
  const v = useCountUp(value);
  const tones: Record<string, string> = {
    zinc: "text-zinc-300", emerald: "text-emerald-400", amber: "text-amber-400", rose: "text-rose-400",
  };
  const glow: Record<string, string> = {
    zinc: "shadow-none", emerald: "shadow-[0_0_12px_-2px_rgba(52,211,153,0.35)]",
    amber: "shadow-[0_0_12px_-2px_rgba(251,191,36,0.35)]", rose: "shadow-[0_0_12px_-2px_rgba(251,113,133,0.35)]",
  };
  return (
    <div
      className={`kpi-tile flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 ${hot ? `kpi-hot ${glow[tone]}` : ""}`}
      title={label}
    >
      <Icon className={`h-3.5 w-3.5 ${tones[tone]}`} aria-hidden />
      <span className={`font-mono text-sm font-semibold tabular-nums ${tones[tone]}`}>{v}</span>
      <span className="text-[9px] font-medium uppercase tracking-widest text-zinc-500">{label}</span>
    </div>
  );
}

// ── Sparkline: активность 12 окон ───────────────────────────────────────────────
export function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const w = 72; const h = 20; const bw = w / data.length;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      {data.map((v, i) => {
        const bh = Math.max(1, (v / max) * (h - 2));
        return (
          <rect key={i} x={i * bw + 1} y={h - bh} width={bw - 2} height={bh} rx={1}
            className={v > 0 ? "fill-emerald-500/80" : "fill-zinc-800"} />
        );
      })}
    </svg>
  );
}

// ── StateBadge: единый словарь состояний (§9 дизайн-дока) ──────────────────────
export type SysState =
  | "Running" | "Idle" | "Paused" | "Waiting" | "Blocked" | "Failed"
  | "Recovering" | "Completed" | "Offline" | "Degraded" | "WARMUP" | "LIVE";

const STATE_MAP: Record<SysState, { icon: LucideIcon; cls: string; label: string }> = {
  Running: { icon: Play, cls: "border-emerald-700/60 bg-emerald-950/40 text-emerald-300", label: "RUNNING" },
  Idle: { icon: Clock, cls: "border-zinc-700 bg-zinc-900 text-zinc-400", label: "IDLE" },
  Paused: { icon: Pause, cls: "border-amber-700/60 bg-amber-950/40 text-amber-300", label: "PAUSED" },
  Waiting: { icon: Clock, cls: "border-amber-700/60 bg-amber-950/40 text-amber-300", label: "WAITING" },
  Blocked: { icon: OctagonAlert, cls: "border-amber-700/60 bg-amber-950/40 text-amber-300", label: "BLOCKED" },
  Failed: { icon: XCircle, cls: "border-rose-800/60 bg-rose-950/40 text-rose-300", label: "FAILED" },
  Recovering: { icon: RotateCw, cls: "border-violet-700/60 bg-violet-950/40 text-violet-300", label: "RECOVERING" },
  Completed: { icon: CheckCircle2, cls: "border-teal-700/60 bg-teal-950/40 text-teal-300", label: "COMPLETED" },
  Offline: { icon: WifiOff, cls: "border-zinc-700 bg-zinc-900 text-zinc-500", label: "OFFLINE" },
  Degraded: { icon: AlertTriangle, cls: "border-amber-700/60 bg-amber-950/40 text-amber-300", label: "DEGRADED" },
  WARMUP: { icon: Loader2, cls: "border-violet-700/60 bg-violet-950/40 text-violet-300", label: "WARMUP" },
  LIVE: { icon: Radio, cls: "border-emerald-700/60 bg-emerald-950/40 text-emerald-300", label: "LIVE" },
};

export function StateBadge({ state, size = "sm" }: { state: SysState; size?: "xs" | "sm" }) {
  const s = STATE_MAP[state] ?? STATE_MAP.Idle;
  const Icon = s.icon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded border font-semibold uppercase tracking-wider ${s.cls} ${size === "xs" ? "px-1 py-0 text-[8px]" : "px-1.5 py-0.5 text-[9px]"}`}>
      <Icon className={`h-2.5 w-2.5 ${state === "WARMUP" || state === "Recovering" ? "animate-spin" : ""}`} aria-hidden />
      {s.label}
    </span>
  );
}

/** Маппинг произвольного статуса daemon'а → SysState. */
export function mapState(raw: string | null | undefined): SysState {
  switch ((raw ?? "").toUpperCase()) {
    case "RUNNING": case "THINKING": case "BUSY": case "LEASED": return "Running";
    case "READY": case "PENDING": case "QUEUED": return "Waiting";
    case "PAUSED": return "Paused";
    case "BLOCKED": return "Blocked";
    case "FAILED": case "REJECTED": return "Failed";
    case "COMPLETED": case "DONE": return "Completed";
    case "HANDED_OFF": return "Recovering";
    case "OFFLINE": case "CLOSED": case "CANCELLED": case "ARCHIVED": return "Offline";
    case "DEGRADED": return "Degraded";
    case "WARMUP": return "WARMUP";
    case "LIVE": return "LIVE";
    case "IDLE": default: return "Idle";
  }
}

// ── Legacy-бейдж статуса (точно как legacy — для задач/агентов/воркеров) ────────
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${STATUS_BADGE[status] ?? "bg-zinc-700 text-zinc-300"}`}>
      {status}
    </span>
  );
}

// ── Chip: компактный чип метрики ────────────────────────────────────────────────
export function Chip({ label, value, tone = "zinc", title }: {
  label: string; value: ReactNode; tone?: "zinc" | "emerald" | "amber" | "rose" | "cyan" | "violet" | "teal" | "lime" | "fuchsia"; title?: string;
}) {
  const tones: Record<string, string> = {
    zinc: "border-zinc-800 bg-zinc-900/70 text-zinc-300",
    emerald: "border-emerald-900/60 bg-emerald-950/30 text-emerald-300",
    amber: "border-amber-900/60 bg-amber-950/30 text-amber-300",
    rose: "border-rose-900/60 bg-rose-950/30 text-rose-300",
    cyan: "border-cyan-900/60 bg-cyan-950/30 text-cyan-300",
    violet: "border-violet-900/60 bg-violet-950/30 text-violet-300",
    teal: "border-teal-900/60 bg-teal-950/30 text-teal-300",
    lime: "border-lime-900/60 bg-lime-950/30 text-lime-300",
    fuchsia: "border-fuchsia-900/60 bg-fuchsia-950/30 text-fuchsia-300",
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${tones[tone]}`}>
      <span className="text-zinc-500">{label}</span>
      <b className="font-semibold">{value}</b>
    </span>
  );
}

// ── Sec: сворачиваемая секция-карточка (базовый строительный блок страниц) ──────
export function Sec({ id, title, icon: Icon, right, children, defaultOpen = true, tone = "zinc", dense }: {
  id: string; title: string; icon: LucideIcon; right?: ReactNode; children: ReactNode;
  defaultOpen?: boolean; tone?: "zinc" | "emerald" | "amber" | "rose" | "cyan" | "violet" | "teal"; dense?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const lsKey = `me2.sec.${id}`;
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const v = localStorage.getItem(lsKey);
        if (v !== null) setOpen(v === "1");
      } catch { /* приватный режим */ }
    }, 0);
    return () => window.clearTimeout(t);
  }, [lsKey]);
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(lsKey, o ? "0" : "1"); } catch { /* ignore */ }
      return !o;
    });
  };
  const tones: Record<string, string> = {
    zinc: "text-zinc-400", emerald: "text-emerald-400", amber: "text-amber-400", rose: "text-rose-400",
    cyan: "text-cyan-400", violet: "text-violet-400", teal: "text-teal-400",
  };
  return (
    <section className="card-lift flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80" data-sec={id}>
      <div className="flex w-full shrink-0 items-center border-b border-zinc-800/80">
        <button
          type="button" onClick={toggle} aria-expanded={open} aria-controls={`${id}-body`}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/60"
        >
          <Icon className={`h-3.5 w-3.5 shrink-0 ${tones[tone]}`} aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-300">{title}</span>
        </button>
        {right && <div className="flex shrink-0 items-center gap-1.5 pr-1">{right}</div>}
        <button
          type="button" onClick={toggle} aria-expanded={open} aria-controls={`${id}-body`} aria-label={open ? "свернуть секцию" : "развернуть секцию"}
          className="flex shrink-0 items-center px-2 py-2 text-zinc-600 hover:text-zinc-300"
        >
          <svg aria-hidden viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      {open && (
        <div id={`${id}-body`} className={`min-h-0 flex-1 overflow-y-auto mc-scroll ${dense ? "p-2" : "p-3"}`}>
          {children}
        </div>
      )}
    </section>
  );
}

// ── PageHeader: заголовок страницы ──────────────────────────────────────────────
export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 px-1 pb-2">
      <h2 className="text-sm font-bold tracking-[0.2em] text-zinc-200">{title}</h2>
      {sub && <span className="text-[10px] text-zinc-500">{sub}</span>}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>
    </div>
  );
}
