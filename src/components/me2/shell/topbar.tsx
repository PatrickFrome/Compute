"use client";
// ── TOPBAR: глобальная командная строка + статус системы (Global UI) ───────────

import { useMe2, useKpis, useActivity } from "@/components/me2/store";
import { KpiTile, Sparkline, Dot } from "@/components/me2/ui/primitives";
import { Search, Command, Boxes, PlayCircle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useEffect, useState } from "react";

export function TopBar() {
  const snap = useMe2((s) => s.snap);
  const connected = useMe2((s) => s.connected);
  const catalog = useMe2((s) => s.catalog);
  const setPalette = useMe2((s) => s.setPalette);
  const setPage = useMe2((s) => s.setPage);
  const kpi = useKpis();
  const activity = useActivity();
  const [clock, setClock] = useState("");

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString("ru-RU", { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-3" data-testid="topbar">
      {/* бренд */}
      <button
        type="button" onClick={() => setPage("command")} data-testid="brand"
        className="flex shrink-0 items-center gap-2 focus-visible:outline-none"
        title="METAENGINE · Command Center"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-600/20 ring-1 ring-emerald-600/40">
          <Boxes className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
        </span>
        <span className="text-[13px] font-black tracking-[0.25em] text-zinc-100">ME2</span>
        <span className="hidden font-mono text-[9px] text-zinc-600 md:inline">{snap?.meta.version ?? "…"}</span>
      </button>

      {/* глобальная командная строка (клик → палитра) */}
      <button
        type="button"
        onClick={() => setPalette(true)}
        data-testid="global-cmdbar"
        aria-label="Глобальный поиск и команды (Ctrl+K)"
        className="group flex h-8 min-w-0 flex-1 max-w-xl items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 text-left transition hover:border-emerald-800/60 hover:bg-zinc-900"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500 group-hover:text-emerald-400" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
          поиск · переход к странице/агенту/задаче · команды системы…
        </span>
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-zinc-700 bg-zinc-900 px-1 font-mono text-[9px] text-zinc-400 sm:flex">
          <Command className="h-2.5 w-2.5" aria-hidden />K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* KPI: только ключевые — остальное в Pages */}
        <div className="hidden items-center gap-1.5 lg:flex">
          <KpiTile label="ready" value={kpi.ready} icon={Clock} tone="amber" hot={kpi.ready > 0} />
          <KpiTile label="run" value={kpi.running} icon={PlayCircle} tone="emerald" hot={kpi.running > 0} />
          <KpiTile label="done" value={kpi.done} icon={CheckCircle2} tone="zinc" />
          <KpiTile label="fail" value={kpi.fail} icon={XCircle} tone="rose" hot={kpi.fail > 0} />
        </div>
        <Sparkline data={activity} />
        {/* WS индикатор */}
        <span
          data-testid="ws-badge"
          className={`flex items-center gap-1.5 rounded border px-1.5 py-1 font-mono text-[9px] font-bold tracking-widest ${
            connected ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300" : "border-rose-800/60 bg-rose-950/40 text-rose-300"
          }`}
          title={connected ? "socket.io :3040 — шина жива (snapshot 2s + event)" : "шина офлайн — REST-fallback :3041"}
        >
          <Dot on={connected} pulse />
          {connected ? "WS LIVE" : "WS OFF"}
        </span>
        <span className="hidden font-mono text-[10px] tabular-nums text-zinc-500 xl:inline" data-testid="clock">{clock}</span>
      </div>
    </header>
  );
}
