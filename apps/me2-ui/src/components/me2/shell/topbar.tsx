"use client";
import { useMe2 } from "@/components/me2/store";

export function TopBar() {
  const setPage = useMe2(s => s.setPage);
  const setPalette = useMe2(s => s.setPalette);
  return (
    <header className="flex h-12 shrink-0 items-center gap-6 border-b border-zinc-800 px-4" data-testid="topbar">
      <button type="button" onClick={() => setPage("command")} data-testid="brand" className="text-sm font-semibold tracking-tight">MetaEngine</button>
      <button type="button" onClick={() => setPalette(true)} data-testid="global-cmdbar"
        aria-label="Поиск и команды (Ctrl+K)"
        className="ml-auto flex h-8 w-full max-w-sm items-center justify-between rounded border border-zinc-800 px-3 text-xs text-zinc-400 hover:bg-zinc-900">
        <span>Поиск и команды</span><kbd className="text-[11px] text-zinc-500">Ctrl K</kbd>
      </button>
    </header>
  );
}
