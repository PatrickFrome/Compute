"use client";
// ── ME2 SHELL: professional control-room shell (R85) ─────────────────────────
// One stable global command bar, one task-focused page surface, Resolve-style
// page dock and a thin read-only status line. Closed overlays are not mounted:
// this keeps the native Browser semantic projection free from hidden palette
// controls and reduces false automation targets.

import { useEffect } from "react";
import { useMe2, type PageKey } from "@/components/me2/store";
import { useToast } from "@/hooks/use-toast";
import { TopBar } from "@/components/me2/shell/topbar";
import { PageBar } from "@/components/me2/shell/pagebar";
import { StatusBar } from "@/components/me2/shell/statusbar";
import { ContextDrawer } from "@/components/me2/shell/context-drawer";
import { PeekInspector } from "@/components/me2/shell/peek-inspector";
import { CommandPalette } from "@/components/me2/shell/command-palette";
import { GlobalDialogs } from "@/components/me2/shell/dialogs";
import { CommandPage } from "@/components/me2/pages/command";
import { AgentsPage } from "@/components/me2/pages/agents";
import { BrowserPage } from "@/components/me2/pages/browser";
import { CodePage } from "@/components/me2/pages/code";
import { TasksPage } from "@/components/me2/pages/tasks";
import { SupervisorPage } from "@/components/me2/pages/supervisor";
import { ComputePage } from "@/components/me2/pages/compute";
import { MemoryPage } from "@/components/me2/pages/memory";
import { ObservabilityPage } from "@/components/me2/pages/observability";
import { SystemPage } from "@/components/me2/pages/system";

function PageOutlet({ page }: { page: PageKey }) {
  switch (page) {
    case "command": return <CommandPage />;
    case "agents": return <AgentsPage />;
    case "browser": return <BrowserPage />;
    case "code": return <CodePage />;
    case "tasks": return <TasksPage />;
    case "supervisor": return <SupervisorPage />;
    case "compute": return <ComputePage />;
    case "memory": return <MemoryPage />;
    case "observability": return <ObservabilityPage />;
    case "system": return <SystemPage />;
    default: return null;
  }
}

export function Me2Shell() {
  const page = useMe2((s) => s.page);
  const init = useMe2((s) => s.init);
  const paletteOpen = useMe2((s) => s.paletteOpen);
  const dialog = useMe2((s) => s.dialog);
  const detail = useMe2((s) => s.detail);
  const contextDrawerDock = useMe2((s) => s.contextDrawerDock);
  const peekTarget = useMe2((s) => s.peekTarget);
  const chromeOverlaySources = useMe2((s) => s.chromeOverlaySources);
  const { toast } = useToast();

  useEffect(() => { init(); }, [init]);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ title: string; description?: string; variant?: "default" | "destructive" }>).detail;
      if (d) toast({ title: d.title, description: d.description, variant: d.variant });
    };
    window.addEventListener("me2:toast", h);
    return () => window.removeEventListener("me2:toast", h);
  }, [toast]);

  const overlaysOpen = Boolean(dialog || detail);
  const nativeOverlayOpen = Boolean(paletteOpen || overlaysOpen || peekTarget || chromeOverlaySources.length > 0);

  useEffect(() => {
    const shell = (window as Window & {
      metaengineShell?: {
        setPrimaryOverlay?: (active: boolean) => unknown;
      };
    }).metaengineShell;
    if (!shell?.setPrimaryOverlay) return;
    void shell.setPrimaryOverlay(nativeOverlayOpen);
    return () => { void shell.setPrimaryOverlay?.(false); };
  }, [nativeOverlayOpen]);

  return (
    <div
      className="mc-dark flex h-screen min-h-0 flex-col overflow-hidden bg-[#09090b] text-zinc-200 selection:bg-emerald-400/20"
      data-testid="me2-shell"
    >
      <TopBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main
          className="min-h-0 min-w-0 flex-1 overflow-hidden p-1.5"
          data-testid="page-outlet"
          data-page={page}
        >
          <PageOutlet page={page} />
        </main>
        {contextDrawerDock === "right" ? <ContextDrawer /> : null}
      </div>
      {contextDrawerDock === "bottom" ? <ContextDrawer /> : null}
      <PageBar />
      <StatusBar />
      <PeekInspector />
      {paletteOpen ? <CommandPalette /> : null}
      {overlaysOpen ? <GlobalDialogs /> : null}
    </div>
  );
}
