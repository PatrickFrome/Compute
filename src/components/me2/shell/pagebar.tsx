"use client";
// ── PAGEBAR: нижняя навигация Pages (архитектурный принцип DaVinci Resolve) ────
// + Workspace-свитчер (пресеты рабочих контекстов) + статусные чипы supervisor.

import { PAGES, WORKSPACES, useMe2, type PageKey } from "@/components/me2/store";
import {
  LayoutDashboard, Bot, Globe, Code2, ListChecks, ShieldCheck, Cpu, BrainCircuit,
  Activity, Settings2, ChevronDown, Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

const PAGE_ICONS: Record<PageKey, LucideIcon> = {
  command: LayoutDashboard, agents: Bot, browser: Globe, code: Code2, tasks: ListChecks,
  supervisor: ShieldCheck, compute: Cpu, memory: BrainCircuit, observability: Activity, system: Settings2,
};

export function PageBar() {
  const page = useMe2((s) => s.page);
  const setPage = useMe2((s) => s.setPage);
  const workspace = useMe2((s) => s.workspace);
  const setWorkspace = useMe2((s) => s.setWorkspace);
  const snap = useMe2((s) => s.snap);
  const [wsOpen, setWsOpen] = useState(false);
  const activeWs = WORKSPACES.find((w) => w.key === workspace) ?? WORKSPACES[0];
  const supervisorBusy = (snap?.stats?.agentsBusy ?? 0) > 0;

  return (
    <nav
      aria-label="Навигация Pages METAENGINE"
      data-testid="pagebar"
      className="flex h-11 shrink-0 items-stretch gap-1 overflow-x-auto border-t border-zinc-800 bg-zinc-950/95 px-2 mc-scroll"
    >
      {/* workspace-свитчер */}
      <div className="relative flex items-center pr-1">
        <button
          type="button"
          onClick={() => setWsOpen((o) => !o)}
          aria-expanded={wsOpen}
          aria-haspopup="menu"
          data-testid="workspace-switcher"
          className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 transition hover:border-emerald-800/60 hover:text-emerald-300"
          title={`Workspace: ${activeWs.hint}`}
        >
          <LayoutDashboard className="h-3 w-3 text-emerald-500" aria-hidden />
          <span className="hidden sm:inline">{activeWs.label}</span>
          <ChevronDown className={`h-3 w-3 transition-transform ${wsOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {wsOpen && (
          <>
            <button type="button" aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setWsOpen(false)} tabIndex={-1} />
            <div role="menu" className="absolute bottom-11 left-0 z-50 w-56 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-2xl">
              <p className="border-b border-zinc-800 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500">Workspace · рабочие контексты</p>
              {WORKSPACES.map((w) => (
                <button
                  key={w.key} role="menuitem" type="button"
                  onClick={() => { setWorkspace(w.key); setWsOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-zinc-900 ${w.key === workspace ? "text-emerald-300" : "text-zinc-300"}`}
                >
                  {w.key === workspace ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : <span className="w-3" />}
                  <span className="font-medium">{w.label}</span>
                  <span className="ml-auto truncate text-[9px] text-zinc-500">{w.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="w-px shrink-0 self-center bg-zinc-800" role="presentation" />

      {/* Pages */}
      <div role="tablist" aria-label="Pages" className="flex items-stretch gap-1" data-testid="panel-tabs">
        {PAGES.map((p) => {
          const Icon = PAGE_ICONS[p.key];
          const active = page === p.key;
          return (
            <button
              key={p.key}
              role="tab"
              aria-selected={active}
              data-testid={`page-tab-${p.key}`}
              data-panel-tab={p.key}
              className={`panel-tab-${p.key} group relative flex items-center gap-1.5 whitespace-nowrap px-2.5 text-[10px] font-bold uppercase tracking-widest transition focus-visible:outline-none sm:px-3`}
              onClick={() => setPage(p.key)}
              title={`${p.label} · Alt+${p.num}`}
            >
              <Icon className={`h-3.5 w-3.5 transition ${active ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-300"}`} aria-hidden />
              <span className={active ? "text-emerald-300" : "text-zinc-400 group-hover:text-zinc-200"}>{p.label}</span>
              {active && <span className="absolute inset-x-1 top-0 h-0.5 rounded-b bg-emerald-400" aria-hidden />}
            </button>
          );
        })}
      </div>

      {/* правый сегмент: supervisor + подсказки */}
      <div className="ml-auto flex items-center gap-2 pl-2">
        <button
          type="button" onClick={() => setPage("supervisor")}
          className="hidden items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/70 px-1.5 py-1 font-mono text-[9px] text-zinc-400 transition hover:border-violet-800/60 hover:text-violet-300 md:flex"
          title="Supervisor control-plane → страница SUPERVISOR"
        >
          <ShieldCheck className={`h-3 w-3 ${supervisorBusy ? "text-violet-400" : "text-zinc-500"}`} aria-hidden />
          supervisor
        </button>
        <span className="hidden font-mono text-[9px] text-zinc-600 lg:inline" title="Глобальные шорткаты">⌘K палитра · N задача · Alt+1..0</span>
      </div>
    </nav>
  );
}
