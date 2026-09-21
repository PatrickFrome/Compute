"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "emerald" | "amber" | "rose" | "violet" | "zinc" | "teal";
  loading?: boolean;
}

const TONE_MAP: Record<NonNullable<StatCardProps["tone"]>, { icon: string; glow: string }> = {
  emerald: { icon: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", glow: "hover:shadow-[0_0_24px_-8px_rgba(16,185,129,0.35)]" },
  amber: { icon: "text-amber-400 bg-amber-500/10 border-amber-500/30", glow: "hover:shadow-[0_0_24px_-8px_rgba(245,158,11,0.35)]" },
  rose: { icon: "text-rose-400 bg-rose-500/10 border-rose-500/30", glow: "hover:shadow-[0_0_24px_-8px_rgba(244,63,94,0.35)]" },
  violet: { icon: "text-violet-400 bg-violet-500/10 border-violet-500/30", glow: "hover:shadow-[0_0_24px_-8px_rgba(139,92,246,0.35)]" },
  zinc: { icon: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30", glow: "hover:shadow-[0_0_24px_-8px_rgba(161,161,170,0.3)]" },
  teal: { icon: "text-teal-400 bg-teal-500/10 border-teal-500/30", glow: "hover:shadow-[0_0_24px_-8px_rgba(20,184,166,0.35)]" },
};

export function StatCard({ icon: Icon, label, value, sub, tone = "zinc", loading }: StatCardProps) {
  const t = TONE_MAP[tone];
  return (
    <div
      data-testid={`stat-card-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60 p-4",
        "transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-900",
        t.glow,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-16 bg-zinc-800" />
          ) : (
            <p className="mt-1 font-mono text-2xl font-semibold leading-7 text-zinc-100 tabular-nums">{value}</p>
          )}
          {sub && <div className="mt-1 text-[11px] leading-4 text-zinc-500">{sub}</div>}
        </div>
        <div className={cn("rounded-md border p-2 transition-transform duration-200 group-hover:scale-110", t.icon)}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-zinc-700/60 to-transparent" />
    </div>
  );
}

/** Horizontal bar meter used for lane/status distributions. */
export function MiniBars({ items, total }: { items: { label: string; n: number; className: string }[]; total: number }) {
  if (!items.length) return <p className="font-mono text-xs text-zinc-600">no data</p>;
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate font-mono text-[10px] text-zinc-500" title={it.label}>
            {it.label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800/80">
            <div
              className={cn("h-full rounded-full transition-all duration-500", it.className)}
              style={{ width: `${total ? Math.max((it.n / total) * 100, 2) : 0}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-zinc-400 tabular-nums">{it.n}</span>
        </div>
      ))}
    </div>
  );
}
