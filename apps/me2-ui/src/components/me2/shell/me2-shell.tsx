"use client";
// ── ME2 SHELL: композиция глобального каркаса (R74 Page-архитектура) ───────────
// TopBar (global) · PageOutlet (условный монтаж страниц — перф-паттерн legacy)
// · PageBar (Resolve-навигация) · StatusBar · GlobalDialogs + Palette + toast-мост.

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useMe2, type PageKey } from "@/components/me2/store";
import { useToast } from "@/hooks/use-toast";
import { TopBar } from "@/components/me2/shell/topbar";
import { PageBar } from "@/components/me2/shell/pagebar";
import { StatusBar } from "@/components/me2/shell/statusbar";
import { CommandPalette } from "@/components/me2/shell/command-palette";
import { GlobalDialogs } from "@/components/me2/shell/dialogs";
const CommandPage = dynamic(() => import("@/components/me2/pages/command").then(m => m.CommandPage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });
const AgentsPage = dynamic(() => import("@/components/me2/pages/agents").then(m => m.AgentsPage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });
const BrowserPage = dynamic(() => import("@/components/me2/pages/browser").then(m => m.BrowserPage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });
const CodePage = dynamic(() => import("@/components/me2/pages/code").then(m => m.CodePage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });
const TasksPage = dynamic(() => import("@/components/me2/pages/tasks").then(m => m.TasksPage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });
const SupervisorPage = dynamic(() => import("@/components/me2/pages/supervisor").then(m => m.SupervisorPage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });
const ComputePage = dynamic(() => import("@/components/me2/pages/compute").then(m => m.ComputePage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });
const MemoryPage = dynamic(() => import("@/components/me2/pages/memory").then(m => m.MemoryPage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });
const ObservabilityPage = dynamic(() => import("@/components/me2/pages/observability").then(m => m.ObservabilityPage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });
const SystemPage = dynamic(() => import("@/components/me2/pages/system").then(m => m.SystemPage), { loading: () => <p className="p-4 text-sm text-zinc-500">Загрузка…</p> });

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
  const { toast } = useToast();

  // инициализация стора (WS, REST-fallback, hotkeys, desktop-мост) — один раз
  useEffect(() => { init(); }, [init]);

  // toast-мост: модули без хуков диспатчат me2:toast → Sonner
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ title: string; description?: string; variant?: "default" | "destructive" }>).detail;
      if (d) toast({ title: d.title, description: d.description, variant: d.variant });
    };
    window.addEventListener("me2:toast", h);
    return () => window.removeEventListener("me2:toast", h);
  }, [toast]);

  return (
    <div className="mc-dark flex h-screen min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-200" data-testid="me2-shell">
      <TopBar />
      {/* PageOutlet: только активная страница в DOM (перф), состояние данных в store */}
      <main className="min-h-0 flex-1 overflow-hidden p-2" data-testid="page-outlet" data-page={page}>
        <PageOutlet page={page} />
      </main>
      <PageBar />
      <StatusBar />
      <CommandPalette />
      <GlobalDialogs />
    </div>
  );
}
