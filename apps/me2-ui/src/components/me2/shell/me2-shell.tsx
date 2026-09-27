"use client";
// ── ME2 SHELL: professional control-room shell (R95 workflow-IA) ─────────────
// Seven workflow Pages (COMMAND→PLAN→BUILD→RUN→FLEET→OBSERVE→SYSTEM) host the
// ten legacy module surfaces; one stable global command bar, one task-focused
// page surface, Resolve-style page dock and a thin read-only status line.
// Closed overlays are not mounted: this keeps the native Browser semantic
// projection free from hidden palette controls and reduces false automation targets.

import { useEffect } from "react";
import { useMe2, type PageKey } from "@/components/me2/store";
import { useToast } from "@/hooks/use-toast";
import { TopBar } from "@/components/me2/shell/topbar";
import { PageBar } from "@/components/me2/shell/pagebar";
import { StatusBar } from "@/components/me2/shell/statusbar";
import { ContextDrawer } from "@/components/me2/shell/context-drawer";
import { CommandPalette } from "@/components/me2/shell/command-palette";
import { GlobalDialogs } from "@/components/me2/shell/dialogs";
import { CommandPage } from "@/components/me2/pages/command";
import { BrowserPage } from "@/components/me2/pages/browser";
import { CodePage } from "@/components/me2/pages/code";
import { TasksPage } from "@/components/me2/pages/tasks";
import { FleetPage } from "@/components/me2/pages/fleet";
import { ObservePage } from "@/components/me2/pages/observe";
import { SystemSuitePage } from "@/components/me2/pages/system-suite";

function PageOutlet({ page }: { page: PageKey }) {
  // R95: PLAN/BUILD/RUN — прямое хостинг legacy-модулей; FLEET/OBSERVE/SYSTEM —
  // таб-хосты пар модулей; COMMAND — rebuilt mission control.
  switch (page) {
    case "command": return <CommandPage />;
    case "plan": return <TasksPage />;
    case "build": return <CodePage />;
    case "run": return <BrowserPage />;
    case "fleet": return <FleetPage />;
    case "observe": return <ObservePage />;
    case "system": return <SystemSuitePage />;
    default: return null;
  }
}

export function Me2Shell() {
  const page = useMe2((s) => s.page);
  const init = useMe2((s) => s.init);
  const paletteOpen = useMe2((s) => s.paletteOpen);
  const dialog = useMe2((s) => s.dialog);
  const detail = useMe2((s) => s.detail);
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
  const nativeOverlayOpen = Boolean(paletteOpen || overlaysOpen || chromeOverlaySources.length > 0);

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
      <main
        className="min-h-0 flex-1 overflow-hidden p-1.5"
        data-testid="page-outlet"
        data-page={page}
      >
        <PageOutlet page={page} />
      </main>
      <ContextDrawer />
      <PageBar />
      <StatusBar />
      {paletteOpen ? <CommandPalette /> : null}
      {overlaysOpen ? <GlobalDialogs /> : null}
    </div>
  );
}
