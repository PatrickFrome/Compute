"use client";
// ── PAGEBAR R94: workflow-stage dock ──────────────────────────────────────────
// Resolve-style primary navigation describes the operator's production loop,
// not METAENGINE's internal package topology. Secondary module pages remain
// reachable through the grouped stage menu and the global command palette.

import {
  PAGES, WORKSPACES, WORKFLOW_STAGES, workflowStageForPage,
  useMe2, type PageKey, type WorkflowStageKey,
} from "@/components/me2/store";
import {
  LayoutDashboard, Map, Hammer, Play, Users, Activity, Settings2,
  ChevronDown, Check, RotateCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

const STAGE_ICONS: Record<WorkflowStageKey, LucideIcon> = {
  command: LayoutDashboard,
  plan: Map,
  build: Hammer,
  run: Play,
  fleet: Users,
  observe: Activity,
  system: Settings2,
};

function pageLabel(page: PageKey) {
  return PAGES.find((item) => item.key === page)?.label ?? page.toUpperCase();
}

export function PageBar() {
  const page = useMe2((s) => s.page);
  const setPage = useMe2((s) => s.setPage);
  const workspace = useMe2((s) => s.workspace);
  const setWorkspace = useMe2((s) => s.setWorkspace);
  const resetWorkspaceLayout = useMe2((s) => s.resetWorkspaceLayout);
  const setChromeOverlay = useMe2((s) => s.setChromeOverlay);
  const [wsOpen, setWsOpen] = useState(false);
  const [stageMenu, setStageMenu] = useState<WorkflowStageKey | null>(null);
  const activeWs = WORKSPACES.find((w) => w.key === workspace) ?? WORKSPACES[0];
  const activeStage = workflowStageForPage(page);

  const setWorkspaceMenu = (open: boolean) => {
    setWsOpen(open);
    if (open) {
      setStageMenu(null);
      setChromeOverlay("stage-menu", false);
    }
    setChromeOverlay("workspace-menu", open);
  };

  const setStageMenuOpen = (key: WorkflowStageKey | null) => {
    setStageMenu(key);
    if (key) {
      setWsOpen(false);
      setChromeOverlay("workspace-menu", false);
    }
    setChromeOverlay("stage-menu", Boolean(key));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (wsOpen) setWorkspaceMenu(false);
      if (stageMenu) setStageMenuOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setChromeOverlay("workspace-menu", false);
      setChromeOverlay("stage-menu", false);
    };
  }, [wsOpen, stageMenu, setChromeOverlay]);

  return (
    <nav
      aria-label="Workflow stages METAENGINE"
      data-testid="pagebar"
      className="flex h-9 shrink-0 items-stretch border-t border-zinc-800/80 bg-[#0b0b0d] px-1.5"
    >
      <div className="relative flex items-center pr-1">
        <button
          type="button"
          onClick={() => setWorkspaceMenu(!wsOpen)}
          aria-expanded={wsOpen}
          aria-haspopup="menu"
          data-testid="workspace-switcher"
          className="flex h-7 max-w-44 items-center gap-1.5 border border-zinc-800 bg-zinc-950 px-2 text-[10px] font-semibold tracking-[0.04em] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          title={`Workspace · ${activeWs.hint}`}
        >
          <LayoutDashboard className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
          <span className="hidden truncate lg:inline">{activeWs.label}</span>
          <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${wsOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {wsOpen ? (
          <>
            <button type="button" aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setWorkspaceMenu(false)} tabIndex={-1} />
            <div role="menu" className="absolute bottom-9 left-0 z-50 w-64 overflow-hidden border border-zinc-800 bg-[#111114] shadow-2xl">
              <p className="border-b border-zinc-800 px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">Workspaces</p>
              {WORKSPACES.map((w) => (
                <button
                  key={w.key}
                  role="menuitem"
                  type="button"
                  onClick={() => { setWorkspace(w.key); setWorkspaceMenu(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-zinc-900 ${w.key === workspace ? "text-cyan-300" : "text-zinc-300"}`}
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

      <div role="tablist" aria-label="Workflow stages" className="flex min-w-0 flex-1 items-stretch justify-center" data-testid="workflow-stage-tabs">
        {WORKFLOW_STAGES.map((stage) => {
          const Icon = STAGE_ICONS[stage.key];
          const active = activeStage.key === stage.key;
          const grouped = stage.pages.length > 1;
          return (
            <div key={stage.key} className="relative flex min-w-0 items-stretch">
              <button
                role="tab"
                aria-selected={active}
                aria-label={`${stage.label} · Alt+${stage.num} · ${stage.hint}`}
                data-testid={`workflow-stage-${stage.key}`}
                data-workflow-stage={stage.key}
                className="group relative flex min-w-10 items-center justify-center gap-1.5 px-2 text-[10px] font-semibold tracking-[0.06em] transition-colors lg:px-3"
                onClick={() => { setPage(stage.primaryPage); setStageMenuOpen(null); }}
                title={`${stage.label} · Alt+${stage.num} · ${stage.hint}`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-cyan-300" : "text-zinc-500 group-hover:text-zinc-300"}`} aria-hidden />
                <span className={`hidden xl:inline ${active ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-300"}`}>{stage.label}</span>
                {active ? <span className="absolute inset-x-1 bottom-0 h-px bg-cyan-300" aria-hidden /> : null}
              </button>
              {grouped ? (
                <button
                  type="button"
                  aria-label={`Open ${stage.label} modules`}
                  aria-expanded={stageMenu === stage.key}
                  aria-haspopup="menu"
                  onClick={() => setStageMenuOpen(stageMenu === stage.key ? null : stage.key)}
                  className={`flex w-5 items-center justify-center text-zinc-700 hover:text-zinc-300 ${active ? "text-zinc-500" : ""}`}
                  title={`${stage.label} modules`}
                >
                  <ChevronDown className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
              {stageMenu === stage.key ? (
                <>
                  <button type="button" aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setStageMenuOpen(null)} tabIndex={-1} />
                  <div role="menu" className="absolute bottom-9 left-0 z-50 min-w-48 overflow-hidden border border-zinc-800 bg-[#111114] py-1 shadow-2xl">
                    <p className="px-3 py-1.5 text-[9px] uppercase tracking-widest text-zinc-600">{stage.label} modules</p>
                    {stage.pages.map((modulePage) => (
                      <button
                        key={modulePage}
                        role="menuitem"
                        type="button"
                        onClick={() => { setPage(modulePage); setStageMenuOpen(null); }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] ${page === modulePage ? "bg-zinc-900 text-cyan-300" : "text-zinc-300 hover:bg-zinc-900"}`}
                      >
                        {page === modulePage ? <Check className="h-3 w-3" aria-hidden /> : <span className="w-3" />}
                        <span>{pageLabel(modulePage)}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center pl-2">
        <span className="hidden font-mono text-[8px] text-zinc-700 xl:inline">Alt+1…7</span>
      </div>
    </nav>
  );
}
