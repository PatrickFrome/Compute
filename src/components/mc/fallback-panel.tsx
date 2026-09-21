"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatCard } from "@/components/mc/stat-card";
import { LiveDot } from "@/components/mc/badges";
import { timeAgo, formatMs } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import { Cloud, CloudOff, Landmark, ShieldCheck, ShieldAlert, Activity, FlaskConical, TimerReset } from "lucide-react";
import { cn } from "@/lib/utils";

type Snapshot = any;
type Transition = any;
type Drill = any;

export interface FallbackData {
  ok: boolean;
  snapshot: Snapshot;
  dbTransitions: Transition[];
  at: string;
}

const STATE_TONE: Record<string, string> = {
  HEALTHY: "text-emerald-300",
  DEGRADED: "text-amber-300",
  DOWN: "text-rose-300",
  UNKNOWN: "text-zinc-400",
};

function stateToneClass(state: string | undefined): string {
  return STATE_TONE[state ?? "UNKNOWN"] ?? "text-zinc-400";
}

async function postAction(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch("/api/fallback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function FallbackPanel({ poll }: { poll: PollState<FallbackData> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const snap = poll.data?.snapshot ?? null;
  const simActive = snap?.simulation?.active === true;
  const locked = snap?.gate?.locked !== false;

  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    await postAction(body);
    await poll.refresh();
    setBusy(null);
  };

  const cloud = snap?.targets?.cloud;
  const local = snap?.targets?.local;
  const lastDrill = snap?.drills?.length ? snap.drills[snap.drills.length - 1] : null;

  return (
    <div className="space-y-4" data-testid="fallback-panel">
      {/* Gate banner */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3",
          locked
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-amber-500/50 bg-amber-500/10 shadow-[0_0_28px_-10px_rgba(245,158,11,0.5)]",
        )}
        data-testid="fallback-gate-banner"
      >
        {locked ? (
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
        ) : (
          <ShieldAlert className="h-5 w-5 shrink-0 animate-pulse text-amber-400" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-semibold tracking-wider text-zinc-100">
            {locked ? "RESERVE CONSOLE LOCKED — SUPABASE IS AUTHORITATIVE" : "RESERVE MODE ACTIVE — LOCAL EDGE :3031 IS THE ACTIVE SUPERVISOR"}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
            {locked
              ? "Запасная консоль вскрывается только когда Supabase не отвечает или деградировал; в остальное время — стендбай, не конкурент облачному контуру."
              : "Весь device-signed командный контур обслуживается локальным edge; облако вернёт авторитет после 5 здоровых проб и ≥120с резерва (≥1 lease timeout)."}
          </p>
        </div>
        <Badge variant="outline" className={cn("font-mono text-[10px]", locked ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/50 text-amber-300")}>
          {locked ? "LOCKED" : "UNLOCKED"}
        </Badge>
        {simActive && (
          <Badge variant="outline" className="border-violet-500/50 bg-violet-500/10 font-mono text-[10px] text-violet-300" data-testid="fallback-sim-badge">
            <FlaskConical className="mr-1 h-3 w-3" /> SIMULATED OUTAGE · until {snap?.simulation?.until ? new Date(snap.simulation.until).toLocaleTimeString() : "—"}
          </Badge>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={simActive ? CloudOff : Cloud}
          label="Supabase cloud"
          tone={(cloud?.state === "HEALTHY" && !simActive) ? "emerald" : cloud?.state === "UNKNOWN" ? "zinc" : "rose"}
          loading={poll.loading && !snap}
          value={<span className={stateToneClass(simActive ? "DOWN" : cloud?.state)}>{simActive ? "DOWN*" : cloud?.state ?? "…"}</span>}
          sub={
            <span>
              {cloud?.latencyMs != null ? `${cloud.latencyMs}ms · ` : ""}
              {cloud?.lastError ? <span className="text-rose-400/80">{cloud.lastError}</span> : `ok ${cloud?.okStreak ?? 0} / fail ${cloud?.failStreak ?? 0}`}
              {simActive ? " · simulated" : ""}
            </span>
          }
        />
        <StatCard
          icon={Landmark}
          label="Reserve edge :3031"
          tone={local?.state === "HEALTHY" ? "teal" : local?.state === "UNKNOWN" ? "zinc" : "amber"}
          loading={poll.loading && !snap}
          value={<span className={stateToneClass(local?.state)}>{local?.state ?? "…"}</span>}
          sub={
            <span>
              {local?.latencyMs != null ? `${local.latencyMs}ms · ` : ""}
              {local?.lastError ? <span className="text-rose-400/80">{local.lastError}</span> : `ok ${local?.okStreak ?? 0} / fail ${local?.failStreak ?? 0}`}
            </span>
          }
        />
        <StatCard
          icon={Activity}
          label="Sentinel mode"
          tone={snap?.mode === "LOCAL_FALLBACK" ? "amber" : "emerald"}
          loading={poll.loading && !snap}
          value={<span className={snap?.mode === "LOCAL_FALLBACK" ? "text-amber-300" : "text-emerald-300"}>{snap?.mode === "LOCAL_FALLBACK" ? "FALLBACK" : "CLOUD"}</span>}
          sub={<span className="block truncate" title={snap?.modeReason ?? ""}>{snap?.modeReason ?? "—"}</span>}
        />
        <StatCard
          icon={TimerReset}
          label="Probes / transitions"
          tone="zinc"
          loading={poll.loading && !snap}
          value={<>{snap?.counters?.probesTotal ?? 0}<span className="mx-1 text-zinc-600">/</span>{snap?.counters?.transitionsTotal ?? 0}</>}
          sub={<span>poll {poll.lastUpdated ? timeAgo(poll.lastUpdated.toISOString()) : "—"} · degraded &gt;{snap?.failover?.degradedLatencyMs ?? 1200}ms</span>}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <Button
          size="sm" variant="outline" disabled={busy !== null}
          data-testid="fallback-probe"
          onClick={() => void run("probe", { action: "probe" })}
          className="h-8 border-zinc-700 font-mono text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          <Activity className={cn("mr-1.5 h-3 w-3", busy === "probe" && "animate-pulse")} />
          Probe now
        </Button>
        <Button
          size="sm" variant="outline" disabled={busy !== null}
          data-testid="fallback-drill"
          onClick={() => void run("drill", { action: "drill" })}
          className="h-8 border-zinc-700 font-mono text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          <ShieldCheck className={cn("mr-1.5 h-3 w-3", busy === "drill" && "animate-pulse")} />
          Run reserve drill
        </Button>
        {simActive ? (
          <Button
            size="sm" variant="outline" disabled={busy !== null}
            data-testid="fallback-sim-off"
            onClick={() => void run("sim-off", { action: "simulate-outage", enabled: false })}
            className="h-8 border-violet-500/40 font-mono text-[11px] text-violet-300 hover:bg-violet-500/10"
          >
            <CloudOff className="mr-1.5 h-3 w-3" /> Stop outage simulation
          </Button>
        ) : (
          <Button
            size="sm" variant="outline" disabled={busy !== null}
            data-testid="fallback-sim-on"
            onClick={() => void run("sim-on", { action: "simulate-outage", enabled: true, secs: 300 })}
            className="h-8 border-violet-500/40 font-mono text-[11px] text-violet-300 hover:bg-violet-500/10"
          >
            <FlaskConical className={cn("mr-1.5 h-3 w-3", busy === "sim-on" && "animate-pulse")} />
            QA: simulate cloud outage (5 min)
          </Button>
        )}
        <span className="font-mono text-[10px] text-zinc-600">
          unlock rule: 2 неуспешных пробы облака при живом локальном edge → LOCAL_FALLBACK
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Probe tail */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
          <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">Probe tail</h3>
            <span className="font-mono text-[10px] text-zinc-600">GET /health · both edges</span>
          </header>
          <ScrollArea className="max-h-72 overflow-hidden">
            <div className="divide-y divide-zinc-800/60">
              {(snap?.probes ?? []).slice(-14).reverse().map((p: any, i: number) => (
                <div key={`${p.at}-${p.name}-${i}`} className="flex items-center gap-2.5 px-4 py-1.5 font-mono text-[11px]">
                  <LiveDot ok={p.ok} pulse={false} />
                  <span className={cn("w-14 font-semibold", p.name === "cloud" ? "text-zinc-300" : "text-teal-300")}>{p.name === "cloud" ? "CLOUD" : "RESERVE"}</span>
                  <span className={cn("w-12", p.ok ? "text-emerald-400" : "text-rose-400")}>{p.ok ? "OK" : "FAIL"}</span>
                  <span className="w-16 text-zinc-400 tabular-nums">{p.status || "—"}</span>
                  <span className="w-16 text-zinc-400 tabular-nums">{p.latencyMs}ms</span>
                  {p.simulated && <Badge variant="outline" className="border-violet-500/40 px-1 py-0 text-[9px] text-violet-300">SIM</Badge>}
                  <span className="ml-auto truncate text-zinc-600">{p.error ?? String(p.at).slice(11, 19)}</span>
                </div>
              ))}
              {!snap?.probes?.length && <p className="px-4 py-6 text-center font-mono text-xs text-zinc-600">no probes yet</p>}
            </div>
          </ScrollArea>
        </section>

        {/* Transitions + drill */}
        <div className="space-y-4">
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
            <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">Mode transitions</h3>
              <span className="font-mono text-[10px] text-zinc-600">persisted · Pigsty destruktion_meta</span>
            </header>
            <ScrollArea className="max-h-44 overflow-hidden">
              <div className="divide-y divide-zinc-800/60">
                {(poll.data?.dbTransitions ?? []).map((t: any) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-1.5 font-mono text-[11px]">
                    <span className="text-zinc-600">{t.at ? String(t.at).replace("T", " ").slice(5, 19) : "—"}</span>
                    <span
                      className={cn(
                        "rounded border px-1 py-0 text-[10px] tracking-wider",
                        t.to_mode === "LOCAL_FALLBACK"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                      )}
                    >
                      {t.to_mode === "LOCAL_FALLBACK" ? "→ RESERVE" : "→ CLOUD"}
                    </span>
                    <span className="text-zinc-400">{t.from_mode} → {t.to_mode}</span>
                    {t.simulated && <Badge variant="outline" className="border-violet-500/40 px-1 py-0 text-[9px] text-violet-300">SIM</Badge>}
                    <span className="ml-auto w-full truncate text-zinc-600 sm:w-auto sm:max-w-[220px]" title={t.reason}>{t.reason}</span>
                  </div>
                ))}
                {!poll.data?.dbTransitions?.length && (
                  <p className="px-4 py-4 text-center font-mono text-xs text-zinc-600">no transitions recorded — контур стабилен</p>
                )}
              </div>
            </ScrollArea>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">Readiness drill</h3>
            {lastDrill ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <LiveDot ok={lastDrill.ok} pulse={false} />
                <span className={lastDrill.ok ? "text-emerald-300" : "text-rose-300"}>{lastDrill.ok ? "RESERVE READY" : "RESERVE UNREACHABLE"}</span>
                <span className="text-zinc-500">{formatMs(lastDrill.latencyMs)}</span>
                <span className="text-zinc-600">· {timeAgo(lastDrill.at)}</span>
              </div>
            ) : (
              <p className="mt-2 font-mono text-xs text-zinc-600">not run yet — drill проверяет резервный путь чтением, ничего не разблокируя</p>
            )}
            <p className="mt-3 font-mono text-[10px] leading-4 text-zinc-600">
              failover: cloud {snap?.failover?.cloudBase ? "pinned xpeibufgzjknrhbhpffp" : "—"} · reserve {snap?.failover?.localBase ?? "—"} ·
              hand-back: {snap?.gate?.lockCondition ?? "—"}
            </p>
          </section>
        </div>
      </div>

      {poll.error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">
          fallback feed error: {poll.error}
        </div>
      )}
    </div>
  );
}
