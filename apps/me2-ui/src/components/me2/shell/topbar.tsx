"use client";
// R97 quiet top bar: the main workspace has only global search/commands and
// Settings. All other persistent navigation chrome was removed.

import { useMe2 } from "@/components/me2/store";
import { Search, Command, Boxes, Radio, Settings, ArrowLeft } from "lucide-react";

export function TopBar() {
  const snap = useMe2((s) => s.snap);
  const connected = useMe2((s) => s.connected);
  const page = useMe2((s) => s.page);
  const setPalette = useMe2((s) => s.setPalette);
  const setPage = useMe2((s) => s.setPage);
  const mainWorkspace = page === "browser";

  return (
    <header
      className="flex h-[42px] shrink-0 items-center gap-2 border-b border-zinc-800/90 bg-[#0b0b0d] px-2"
      data-testid="topbar"
    >
      <button
        type="button"
        onClick={() => setPage("browser")}
        data-testid="brand"
        className="flex h-8 shrink-0 items-center gap-2 rounded-sm px-1.5 text-left hover:bg-zinc-900 focus-visible:outline-none"
        title="METAENGINE · Chat Fleet"
      >
        <span className="flex h-5 w-5 items-center justify-center border border-cyan-800/60 bg-cyan-950/35">
          <Boxes className="h-3 w-3 text-cyan-300" aria-hidden />
        </span>
        <span className="text-[12px] font-black tracking-[0.22em] text-zinc-100">METAENGINE</span>
        <span className="hidden font-mono text-[9px] text-zinc-600 lg:inline">{snap?.meta.version ?? "…"}</span>
      </button>

      {!mainWorkspace ? (
        <button
          type="button"
          onClick={() => setPage("browser")}
          className="flex h-8 shrink-0 items-center gap-1 border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-400 hover:text-zinc-100"
          data-testid="return-to-chat-fleet"
          title="Return to the single main workspace"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Chat Fleet
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => setPalette(true)}
        data-testid="global-cmdbar"
        aria-label="Search and commands (Ctrl+K)"
        className="group mx-auto flex h-8 min-w-0 flex-1 max-w-[720px] items-center gap-2 border border-zinc-800 bg-zinc-900/55 px-2.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500 group-hover:text-cyan-300" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
          Search agents, settings, tools or run a command
        </span>
        <kbd className="hidden shrink-0 items-center gap-0.5 border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 sm:flex">
          <Command className="h-2.5 w-2.5" aria-hidden />K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9px]">
        <button
          type="button"
          onClick={() => setPage("system")}
          data-testid="settings-button"
          aria-label="Open Settings"
          className={`flex h-7 items-center gap-1.5 border px-2 transition-colors ${
            page === "system"
              ? "border-cyan-900/70 bg-cyan-950/20 text-cyan-300"
              : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200"
          }`}
          title="Settings and advanced tools"
        >
          <Settings className="h-3 w-3" aria-hidden /> Settings
        </button>
        <span
          data-testid="ws-badge"
          className={`flex h-7 items-center gap-1.5 border px-2 font-bold tracking-[0.12em] ${
            connected
              ? "border-emerald-900/60 bg-emerald-950/20 text-emerald-300"
              : "border-rose-900/60 bg-rose-950/20 text-rose-300"
          }`}
          title={connected ? "Live control transport" : "Transport offline"}
        >
          <Radio className="h-3 w-3" aria-hidden />
          {connected ? "LIVE" : "OFF"}
        </span>
      </div>
    </header>
  );
}
