"use client";
// ── TOPBAR R85: quiet global command surface ──────────────────────────────────
// Identity + current context + one global command surface. Runtime telemetry is
// compressed into attention-oriented health, leaving the workspace as the focus.

import { PAGES, WORKSPACES, useMe2, useKpis } from "@/components/me2/store";
import { Search, Command, Boxes, Play, AlertTriangle, Radio, Layers3 } from "lucide-react";
import { Dot } from "@/components/me2/ui/primitives";

export function TopBar() {
  const snap = useMe2((s) => s.snap);
  const connected = useMe2((s) => s.connected);
  const mirror = useMe2((s) => s.mirror);
  const page = useMe2((s) => s.page);
  const workspace = useMe2((s) => s.workspace);
  const setPalette = useMe2((s) => s.setPalette);
  const setPage = useMe2((s) => s.setPage);
  const kpi = useKpis();

  const pageMeta = PAGES.find((p) => p.key === page);
  const workspaceMeta = WORKSPACES.find((w) => w.key === workspace);
  const mirrorAttention = Boolean(mirror && (mirror.mode !== "LIVE" || mirror.pending > 0));

  return (
    <header
      className="flex h-[42px] shrink-0 items-center gap-2 border-b border-zinc-800/90 bg-[#0b0b0d] px-2"
      data-testid="topbar"
    >
      <button
        type="button"
        onClick={() => setPage("command")}
        data-testid="brand"
        className="flex h-8 shrink-0 items-center gap-2 rounded-sm px-1.5 text-left hover:bg-zinc-900 focus-visible:outline-none"
        title="METAENGINE · Command Center"
      >
        <span className="flex h-5 w-5 items-center justify-center border border-emerald-700/50 bg-emerald-950/40">
          <Boxes className="h-3 w-3 text-emerald-400" aria-hidden />
        </span>
        <span className="text-[12px] font-black tracking-[0.22em] text-zinc-100">ME2</span>
        <span className="hidden font-mono text-[9px] text-zinc-600 lg:inline">{snap?.meta.version ?? "…"}</span>
      </button>

      <div className="hidden min-w-0 items-center gap-1.5 border-l border-zinc-800 pl-2 md:flex" aria-label="Текущий контекст">
        <span className="truncate text-[10px] font-semibold tracking-[0.12em] text-zinc-300">{pageMeta?.label ?? page.toUpperCase()}</span>
        <span className="text-zinc-700">/</span>
        <span className="max-w-28 truncate text-[9px] text-zinc-500">{workspaceMeta?.label ?? workspace}</span>
      </div>

      <button
        type="button"
        onClick={() => setPalette(true)}
        data-testid="global-cmdbar"
        aria-label="Глобальный поиск и команды (Ctrl+K)"
        className="group mx-auto flex h-8 min-w-0 flex-1 max-w-[680px] items-center gap-2 border border-zinc-800 bg-zinc-900/55 px-2.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500 group-hover:text-emerald-400" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
          перейти · найти агента/задачу · выполнить команду
        </span>
        <kbd className="hidden shrink-0 items-center gap-0.5 border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 sm:flex">
          <Command className="h-2.5 w-2.5" aria-hidden />K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9px]">
        <span
          className={`hidden h-7 items-center gap-1.5 border px-2 lg:flex ${
            kpi.fail > 0
              ? "border-rose-900/70 bg-rose-950/20 text-rose-300"
              : "border-zinc-800 bg-zinc-950 text-zinc-400"
          }`}
          title={`${kpi.ready} ready · ${kpi.running} running · ${kpi.fail} failed`}
        >
          {kpi.fail > 0 ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3 text-emerald-500" aria-hidden />}
          <span>{kpi.running} run</span>
          <span className="text-zinc-700">·</span>
          <span>{kpi.ready} ready</span>
          {kpi.fail > 0 ? <><span className="text-zinc-700">·</span><span>{kpi.fail} fail</span></> : null}
        </span>

        {mirrorAttention ? (
          <button
            type="button"
            onClick={() => setPage("observability")}
            className="hidden h-7 items-center gap-1 border border-amber-900/70 bg-amber-950/20 px-2 text-amber-300 xl:flex"
            title={`Mirror ${mirror?.mode ?? "unknown"} · outbox ${mirror?.pending ?? 0}`}
          >
            <Layers3 className="h-3 w-3" aria-hidden />
            mirror {mirror?.mode ?? "…"}
          </button>
        ) : null}

        <span
          data-testid="ws-badge"
          className={`flex h-7 items-center gap-1.5 border px-2 font-bold tracking-[0.12em] ${
            connected
              ? "border-emerald-900/60 bg-emerald-950/20 text-emerald-300"
              : "border-rose-900/60 bg-rose-950/20 text-rose-300"
          }`}
          title={connected ? "socket.io :3040 — live transport" : "socket offline — REST fallback"}
        >
          {connected ? <Radio className="h-3 w-3" aria-hidden /> : <Dot on={false} />}
          {connected ? "LIVE" : "OFF"}
        </span>
      </div>
    </header>
  );
}
