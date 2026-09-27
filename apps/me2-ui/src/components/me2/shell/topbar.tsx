"use client";
// ── TOPBAR R85: quiet global command surface ──────────────────────────────────
// Identity + current context + one global command surface. Runtime telemetry is
// compressed into attention-oriented health, leaving the workspace as the focus.

import { PAGES, WORKSPACES, workflowStageForPage, useMe2 } from "@/components/me2/store";
import { Search, Command, Boxes, Radio, BellRing, PanelBottom, PanelRight, X, ChevronDown, Check, RotateCcw } from "lucide-react";
import { Dot } from "@/components/me2/ui/primitives";
import { useEffect, useState } from "react";

export function TopBar() {
  const snap = useMe2((s) => s.snap);
  const connected = useMe2((s) => s.connected);
  const mirror = useMe2((s) => s.mirror);
  const page = useMe2((s) => s.page);
  const workspace = useMe2((s) => s.workspace);
  const setPalette = useMe2((s) => s.setPalette);
  const setPage = useMe2((s) => s.setPage);
  const setWorkspace = useMe2((s) => s.setWorkspace);
  const resetWorkspaceLayout = useMe2((s) => s.resetWorkspaceLayout);
  const contextDrawerPreferredOpen = useMe2((s) => s.contextDrawerPreferredOpen);
  const contextDrawerOpen = useMe2((s) => s.contextDrawerOpen);
  const contextDrawerDock = useMe2((s) => s.contextDrawerDock);
  const setContextDrawer = useMe2((s) => s.setContextDrawer);
  const setChromeOverlay = useMe2((s) => s.setChromeOverlay);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  const setAttention = (open: boolean) => {
    setAttentionOpen(open);
    if (open) {
      setWorkspaceOpen(false);
      setChromeOverlay("workspace-menu", false);
    }
    setChromeOverlay("attention", open);
  };

  const setWorkspaceMenu = (open: boolean) => {
    setWorkspaceOpen(open);
    if (open) {
      setAttentionOpen(false);
      setChromeOverlay("attention", false);
    }
    setChromeOverlay("workspace-menu", open);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (attentionOpen) setAttention(false);
      if (workspaceOpen) setWorkspaceMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setChromeOverlay("attention", false);
      setChromeOverlay("workspace-menu", false);
    };
  }, [attentionOpen, workspaceOpen, setChromeOverlay]);

  const pageMeta = PAGES.find((p) => p.key === page);
  const stageMeta = workflowStageForPage(page);
  const workspaceMeta = WORKSPACES.find((w) => w.key === workspace);
  const mirrorAttention = Boolean(mirror && (mirror.mode !== "LIVE" || mirror.pending > 0));
  const nowMs = Date.now();
  const failedTasks = (snap?.tasks ?? []).filter((task) => task.status === "FAILED").length;
  const failedCommands = (snap?.commands ?? []).filter((command) => {
    if (command.status !== "FAILED") return false;
    const at = new Date(command.created_at).getTime();
    return Number.isFinite(at) && nowMs - at <= 15 * 60_000;
  }).length;
  const offlineWorkers = (snap?.workers ?? []).filter((worker) => worker.state === "OFFLINE").length;
  const budgetUsed = snap?.budget.used ?? 0;
  const budgetLimit = snap?.budget.limit ?? 24;
  const budgetPct = Math.round((budgetUsed / Math.max(1, budgetLimit)) * 100);
  const attentionItems = [
    !connected ? { id: "transport", label: "Transport offline", detail: "Socket :3040 unavailable; REST fallback may be active.", page: "observability" as const, tone: "rose" } : null,
    failedTasks > 0 ? { id: "tasks", label: String(failedTasks) + " failed task" + (failedTasks === 1 ? "" : "s"), detail: "Current work queue contains failed tasks; inspect exact evidence before retry.", page: "tasks" as const, tone: "rose" } : null,
    failedCommands > 0 ? { id: "commands", label: String(failedCommands) + " recent failed command" + (failedCommands === 1 ? "" : "s"), detail: "Failures from the last 15 minutes; inspect receipts and never blind-retry ambiguous effects.", page: "observability" as const, tone: "rose" } : null,
    mirrorAttention ? { id: "mirror", label: "Mirror " + (mirror?.mode ?? "unknown"), detail: "Outbox " + String(mirror?.pending ?? 0) + (mirror?.last_error ? " · " + mirror.last_error.slice(0, 90) : ""), page: "observability" as const, tone: "amber" } : null,
    offlineWorkers > 0 ? { id: "workers", label: String(offlineWorkers) + " offline worker" + (offlineWorkers === 1 ? "" : "s"), detail: "Worker registry reports offline capacity.", page: "compute" as const, tone: "amber" } : null,
    budgetPct >= 75 ? { id: "budget", label: "Command budget " + String(budgetPct) + "%", detail: String(budgetUsed) + "/" + String(budgetLimit) + " cost units used in the current window.", page: "system" as const, tone: "amber" } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

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
        <span className="flex h-5 w-5 items-center justify-center border border-cyan-800/60 bg-cyan-950/35">
          <Boxes className="h-3 w-3 text-cyan-300" aria-hidden />
        </span>
        <span className="text-[12px] font-black tracking-[0.22em] text-zinc-100">ME2</span>
        <span className="hidden font-mono text-[9px] text-zinc-600 lg:inline">{snap?.meta.version ?? "…"}</span>
      </button>

      <div className="hidden min-w-0 items-center gap-1.5 border-l border-zinc-800 pl-2 md:flex" aria-label="Текущий рабочий контекст">
        <div className="relative">
          <button
            type="button"
            data-testid="workspace-switcher"
            onClick={() => setWorkspaceMenu(!workspaceOpen)}
            aria-expanded={workspaceOpen}
            aria-haspopup="menu"
            className="flex h-7 max-w-32 items-center gap-1 px-1.5 text-[10px] font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            title={`Workspace · ${workspaceMeta?.hint ?? workspace}`}
          >
            <span className="truncate">{workspaceMeta?.label ?? workspace}</span>
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${workspaceOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {workspaceOpen ? (
            <>
              <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setWorkspaceMenu(false)} />
              <div role="menu" className="absolute left-0 top-8 z-50 w-64 overflow-hidden border border-zinc-800 bg-[#111114] shadow-2xl">
                <p className="border-b border-zinc-800 px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">Workspaces</p>
                {WORKSPACES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    onClick={() => { setWorkspace(item.key); setWorkspaceMenu(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-zinc-900 ${item.key === workspace ? "text-cyan-300" : "text-zinc-300"}`}
                  >
                    {item.key === workspace ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : <span className="w-3" />}
                    <span className="font-medium">{item.label}</span>
                    <span className="ml-auto truncate text-[9px] text-zinc-600">{item.hint}</span>
                  </button>
                ))}
                <div className="border-t border-zinc-800 p-1.5">
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="workspace-reset-layout"
                    onClick={() => { resetWorkspaceLayout(); setWorkspaceMenu(false); }}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden />
                    Reset layout · {workspaceMeta?.label ?? workspace}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
        <span className="text-zinc-700">/</span>
        <span className="truncate text-[10px] font-semibold tracking-[0.08em] text-zinc-100">{stageMeta.label}</span>
        {pageMeta?.label && pageMeta.label !== stageMeta.label ? (
          <>
            <span className="text-zinc-700">/</span>
            <span className="max-w-28 truncate font-mono text-[9px] text-zinc-600">{pageMeta.label}</span>
          </>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setPalette(true)}
        data-testid="global-cmdbar"
        aria-label="Глобальный поиск и команды (Ctrl+K)"
        className="group mx-auto flex h-8 min-w-0 flex-1 max-w-[680px] items-center gap-2 border border-zinc-800 bg-zinc-900/55 px-2.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500 group-hover:text-cyan-300" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
          перейти · найти агента/задачу · выполнить команду
        </span>
        <kbd className="hidden shrink-0 items-center gap-0.5 border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 sm:flex">
          <Command className="h-2.5 w-2.5" aria-hidden />K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9px]">
        <button
          type="button"
          onClick={() => setContextDrawer(!contextDrawerPreferredOpen)}
          aria-pressed={contextDrawerOpen}
          aria-label={contextDrawerPreferredOpen && !contextDrawerOpen && page === "command" ? "Utility Panel скрыт из-за минимального размера Browser" : contextDrawerOpen ? "Закрыть Utility Panel" : "Открыть Utility Panel"}
          data-testid="context-drawer-toggle"
          className={`flex h-7 min-w-7 items-center justify-center border px-2 transition-colors ${
            contextDrawerOpen
              ? "border-cyan-900/70 bg-cyan-950/20 text-cyan-300"
              : contextDrawerPreferredOpen && page === "command"
                ? "border-amber-900/70 bg-amber-950/20 text-amber-300"
                : "border-zinc-800 bg-zinc-950 text-zinc-600 hover:text-zinc-300"
          }`}
          title={contextDrawerPreferredOpen && !contextDrawerOpen && page === "command" ? "Utility Panel сохранён, но Browser minimum geometry имеет приоритет. Увеличьте окно." : `Utility Panel · ${contextDrawerDock === "right" ? "Right" : "Bottom"} · Ctrl/Cmd+J`}
        >
          {contextDrawerDock === "right" ? <PanelRight className="h-3 w-3" aria-hidden /> : <PanelBottom className="h-3 w-3" aria-hidden />}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setAttention(!attentionOpen)}
            aria-expanded={attentionOpen}
            aria-haspopup="dialog"
            aria-label={attentionItems.length > 0 ? "Attention Center: " + attentionItems.length + " items" : "Attention Center: clear"}
            data-testid="attention-button"
            className={"flex h-7 min-w-7 items-center justify-center gap-1 border px-2 transition-colors " + (attentionItems.length > 0 ? "border-amber-900/70 bg-amber-950/20 text-amber-300 hover:border-amber-800" : "border-zinc-800 bg-zinc-950 text-zinc-600 hover:text-zinc-300")}
            title={attentionItems.length > 0 ? String(attentionItems.length) + " состояния требуют внимания" : "Нет состояний, требующих внимания"}
          >
            <BellRing className="h-3 w-3" aria-hidden />
            {attentionItems.length > 0 ? <span>{attentionItems.length}</span> : null}
          </button>
          {attentionOpen ? (
            <>
              <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setAttention(false)} />
              <section role="dialog" aria-label="Attention Center" data-testid="attention-center" className="absolute right-0 top-8 z-50 w-[360px] max-w-[80vw] border border-zinc-800 bg-[#0b0b0d] shadow-2xl">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                  <BellRing className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                  <strong className="text-[10px] uppercase tracking-[0.14em] text-zinc-300">Attention</strong>
                  <span className="font-mono text-[9px] text-zinc-600">{attentionItems.length}</span>
                  <button type="button" onClick={() => setAttention(false)} aria-label="Закрыть Attention Center" className="ml-auto p-1 text-zinc-600 hover:text-zinc-300">
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </div>
                {attentionItems.length === 0 ? (
                  <p className="px-3 py-4 text-[11px] text-zinc-500">Критичных или деградированных состояний не обнаружено.</p>
                ) : (
                  <div className="max-h-[55vh] overflow-y-auto py-1 mc-scroll">
                    {attentionItems.map((item) => (
                      <button key={item.id} type="button" onClick={() => { setPage(item.page); setAttention(false); }} className="flex w-full items-start gap-2 border-b border-zinc-900 px-3 py-2 text-left hover:bg-zinc-900/70">
                        <span className={"mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " + (item.tone === "rose" ? "bg-rose-400" : "bg-amber-400")} aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-[11px] font-medium text-zinc-200">{item.label}</span>
                          <span className="mt-0.5 block text-[9px] leading-4 text-zinc-500">{item.detail}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>

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
