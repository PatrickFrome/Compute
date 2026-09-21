"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/* ── Console status dot ─────────────────────────────────────────── */

export function LiveDot({ ok, pulse = true, className }: { ok: boolean; pulse?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)} role="status" aria-label={ok ? "online" : "offline"}>
      {ok && pulse && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", ok ? "bg-emerald-400" : "bg-rose-500")} />
    </span>
  );
}

/* ── Command status badge ───────────────────────────────────────── */

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  APPROVED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  ACTIVE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  PENDING: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  LEASED: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  RUNNING: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  FAILED: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  REJECTED: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  EXPIRED: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
  CANCELLED: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
  REVOKED: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  PLANNED: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const style = STATUS_STYLES[status] ?? "border-zinc-500/40 bg-zinc-500/10 text-zinc-300";
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px] tracking-wider px-1.5 py-0", style)}>
      {status}
    </Badge>
  );
}

/* ── Command lane badge ─────────────────────────────────────────── */

const LANE_STYLES: Record<string, string> = {
  EMERGENCY: "border-rose-400/60 bg-rose-500/20 text-rose-200 font-semibold",
  DEVELOPER_EMERGENCY_UPDATE: "border-amber-400/50 bg-amber-500/15 text-amber-200",
  READ_ONLY: "border-zinc-600/60 bg-zinc-500/10 text-zinc-400",
};

export function LaneBadge({ lane, className }: { lane: string | null; className?: string }) {
  if (!lane) {
    return (
      <span className={cn("font-mono text-[10px] text-zinc-600", className)}>no-lane</span>
    );
  }
  const style = LANE_STYLES[lane] ?? "border-teal-500/40 bg-teal-500/10 text-teal-300";
  const label = lane === "DEVELOPER_EMERGENCY_UPDATE" ? "DEV-EMERG" : lane;
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px] tracking-wider px-1.5 py-0", style)}>
      {label}
    </Badge>
  );
}

/* ── Authority effect seal ──────────────────────────────────────── */

export function AuthoritySeal({ effect }: { effect: boolean }) {
  return (
    <span
      title={effect ? "authority_effect: true — mutation sealed" : "authority_effect: false — read-only"}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1 py-0 font-mono text-[10px]",
        effect
          ? "border-amber-400/50 bg-amber-500/15 text-amber-300"
          : "border-zinc-700 bg-zinc-800/60 text-zinc-500",
      )}
    >
      {effect ? "⚡ sealed" : "◌ read"}
    </span>
  );
}
