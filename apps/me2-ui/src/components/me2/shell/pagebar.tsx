"use client";
// ── PAGEBAR R95: compact Resolve-style workflow dock ───────────────────────────
// Seven workflow stages (COMMAND→PLAN→BUILD→RUN→FLEET→OBSERVE→SYSTEM) remain
// first-class; labels progressively collapse instead of forcing the entire
// application chrome to scroll on normal desktop widths. Workspace switcher
// stays here until the R96 TopBar breadcrumb lands (IA prototype scope).

import { PAGES, WORKSPACES, useMe2 } from "@/components/me2/store";
import {
  Target, ListChecks, Code2, Globe, Bot, Activity, Settings2, ChevronDown, Check, RotateCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

const PAGE_ICONS: Record<string, LucideIcon> = {
  command: Target,
  plan: ListChecks,
  build: Code2,
  run: Globe,
  fleet: Bot,
  observe: Activity,
  system: Settings2,
};

export function PageBar() {
  const page = useMe2((s) => s.page);
  const setPage = useMe2((s) => s.setPage);
  const workspace = useMe2((s) => s.workspace);
  const setWorkspace = useMe2((s) => s.setWorkspace);
  const resetWorkspaceLayout = useMe2((s) => s.resetWorkspaceLayout);
  const setChromeOverlay = useMe2((s) => s.setChromeOverlay);
  const [wsOpen, setWsOpen] = useState(false);
  const activeWs = WORKSPACES.find((w) => w.key === workspace) ?? WORKSPACES[0];

  const setWorkspaceMenu = (open: boolean) => {
    setWsOpen(open);
    setChromeOverlay("workspace-menu", open);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && wsOpen) setWorkspaceMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setChromeOverlay("workspace-menu", false);
    };
  }, [wsOpen, setChromeOverlay]);

  return (
    <nav
      aria-label="Навигация Pages METAENGINE"
      data-testid="pagebar"
      className="flex h-9 shrink-0 items-stretch border-t border-zinc-800/90 bg-[#0b0b0d] px-1.5"
    >
      <div className="relative flex items-center pr-1">
        <button
          type="button"
          onClick={() => setWorkspaceMenu(!wsOpen)}
          aria-expanded={wsOpen}
          aria-haspopup="menu"
          data-testid="workspace-switcher"
          className="flex h-7 max-w-36 items-center gap-1.5 border border-zinc-800 bg-zinc-950 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          title={`Workspace: ${activeWs.hint}`}
        >
          <Target className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
          <span className="hidden truncate lg:inline">{activeWs.label}</span>
          <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${wsOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {wsOpen ? (
          <>
            <button type="button" aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setWorkspaceMenu(false)} tabIndex={-1} />
            <div role="menu" className="absolute bottom-9 left-0 z-50 w-60 overflow-hidden border border-zinc-800 bg-[#0b0b0d] shadow-2xl">
              <p className="border-b border-zinc-800 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500">Рабочие контексты</p>
              {WORKSPACES.map((w) => (
                <button
                  key={w.key}
                  role="menuitem"
                  type="button"
                  onClick={() => { setWorkspace(w.key); setWorkspaceMenu(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-zinc-900 ${w.key === workspace ? "text-emerald-300" : "text-zinc-300"}`}
                >
                  {w.key === workspace ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : <span className="w-3" />}
                  <span className="font-medium">{w.label}</span>
                  <span className="ml-auto truncate text-[9px] text-zinc-600">{w.hint}</span>
                </button>
              ))}
              <div className="border-t border-zinc-800 p-1.5">
                <button
                  role="menuitem"
                  type="button"
                  data-testid="workspace-reset-layout"
                  onClick={() => { resetWorkspaceLayout(); setWorkspaceMenu(false); }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                  title="Вернуть layout текущего Workspace к безопасным значениям по умолчанию"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden />
                  Reset layout · {activeWs.label}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="mx-1 w-px shrink-0 self-center bg-zinc-800" role="presentation" />

      <div role="tablist" aria-label="Pages" className="flex min-w-0 flex-1 items-stretch justify-center" data-testid="panel-tabs">
        {PAGES.map((p) => {
          const Icon = PAGE_ICONS[p.key] ?? Target;
          const active = page === p.key;
          return (
            <button
              key={p.key}
              role="tab"
              aria-selected={active}
              aria-label={`${p.label} · Alt+${p.num}`}
              data-testid={`page-tab-${p.key}`}
              data-panel-tab={p.key}
              className={`panel-tab-${p.key} group relative flex min-w-8 items-center justify-center gap-1.5 px-2 text-[9px] font-semibold uppercase tracking-[0.1em] transition-colors xl:px-2.5`}
              onClick={() => setPage(p.key)}
              title={`${p.label} · Alt+${p.num}`}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-300"}`} aria-hidden />
              <span className={`hidden xl:inline ${active ? "text-emerald-300" : "text-zinc-500 group-hover:text-zinc-300"}`}>{p.label}</span>
              {active ? <span className="absolute inset-x-1 bottom-0 h-px bg-emerald-400" aria-hidden /> : null}
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center pl-2">
        <span className="hidden font-mono text-[8px] text-zinc-700 xl:inline">Alt+1…7</span>
      </div>
    </nav>
  );
}
