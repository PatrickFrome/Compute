"use client";
// R85 contextual drawer: a secondary read-only context that never owns effects.
// On COMMAND, main-process native geometry reserves the same 200px so renderer
// controls cannot be covered by the Browser WebContentsView.

import { Activity, Database, ListChecks, Server, X } from "lucide-react";
import { useMe2, type ContextDrawerTab } from "@/components/me2/store";
import { EVENT_STYLE, hhmmss } from "@/lib/me2-bus";

const TABS: Array<{ key: ContextDrawerTab; label: string; icon: typeof Activity }> = [
  { key: "events", label: "Events", icon: Activity },
  { key: "commands", label: "Commands", icon: ListChecks },
  { key: "runtime", label: "Runtime", icon: Server },
];

export function ContextDrawer() {
  const open = useMe2((s) => s.contextDrawerOpen);
  const tab = useMe2((s) => s.contextDrawerTab);
  const setOpen = useMe2((s) => s.setContextDrawer);
  const setTab = useMe2((s) => s.setContextDrawerTab);
  const events = useMe2((s) => s.events);
  const snap = useMe2((s) => s.snap);
  const mirror = useMe2((s) => s.mirror);
  const connected = useMe2((s) => s.connected);

  if (!open) return null;

  return (
    <section
      className="flex h-[200px] shrink-0 flex-col border-t border-zinc-800 bg-[#09090b]"
      data-testid="context-drawer"
      aria-label="Context Drawer"
    >
      <div className="flex h-8 shrink-0 items-center border-b border-zinc-800/80 px-2">
        <div className="flex h-full items-stretch" role="tablist" aria-label="Context Drawer tabs">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 border-b px-2.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
                tab === key
                  ? "border-cyan-400 text-cyan-300"
                  : "border-transparent text-zinc-600 hover:text-zinc-300"
              }`}
            >
              <Icon className="h-3 w-3" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden font-mono text-[8px] text-zinc-700 sm:inline">Ctrl/Cmd+J</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Закрыть Context Drawer"
          className="ml-2 p-1 text-zinc-600 hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto mc-scroll">
        {tab === "events" ? (
          <div className="font-mono text-[10px]" data-testid="context-drawer-events">
            {events.slice(0, 24).map((event) => (
              <div key={event.seq} className="flex gap-2 border-b border-zinc-900/80 px-2 py-1 hover:bg-zinc-900/50">
                <span className="w-12 shrink-0 text-zinc-700">{event.seq}</span>
                <span className="w-16 shrink-0 text-zinc-600">{hhmmss(event.ts)}</span>
                <span className={`w-36 shrink-0 truncate font-semibold ${EVENT_STYLE[event.type] ?? "text-zinc-400"}`} title={event.type}>{event.type}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-500" title={event.data}>{event.data}</span>
              </div>
            ))}
            {events.length === 0 ? <p className="p-4 text-center text-zinc-600">событий пока нет</p> : null}
          </div>
        ) : null}

        {tab === "commands" ? (
          <div className="font-mono text-[10px]" data-testid="context-drawer-commands">
            {(snap?.commands ?? []).slice(0, 24).map((command) => (
              <div key={command.id} className="flex gap-2 border-b border-zinc-900/80 px-2 py-1 hover:bg-zinc-900/50">
                <span className="w-20 shrink-0 truncate text-zinc-600">{command.lane}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-300" title={command.action}>{command.action}</span>
                <span className="w-16 shrink-0 text-right text-zinc-600">c{command.cost}</span>
                <span className={`w-20 shrink-0 text-right ${
                  command.status === "FAILED" ? "text-rose-400" : command.status === "COMPLETED" ? "text-emerald-400" : "text-zinc-500"
                }`}>{command.status}</span>
              </div>
            ))}
            {(snap?.commands ?? []).length === 0 ? <p className="p-4 text-center text-zinc-600">command bus пуст</p> : null}
          </div>
        ) : null}

        {tab === "runtime" ? (
          <div className="grid min-h-full grid-cols-2 gap-px bg-zinc-900 lg:grid-cols-4" data-testid="context-drawer-runtime">
            <div className="bg-[#09090b] p-3">
              <p className="font-mono text-[8px] uppercase tracking-widest text-zinc-600">Transport</p>
              <p className={`mt-1 text-xs font-semibold ${connected ? "text-emerald-300" : "text-rose-300"}`}>{connected ? "LIVE" : "OFFLINE"}</p>
              <p className="mt-1 font-mono text-[9px] text-zinc-600">ws :3040 · rest :3041</p>
            </div>
            <div className="bg-[#09090b] p-3">
              <p className="font-mono text-[8px] uppercase tracking-widest text-zinc-600">Tasks</p>
              <p className="mt-1 text-xs text-zinc-300">{snap?.stats.tasksRunning ?? 0} running · {snap?.stats.tasksReady ?? 0} ready</p>
              <p className={`mt-1 font-mono text-[9px] ${(snap?.stats.tasksFailed ?? 0) > 0 ? "text-rose-400" : "text-zinc-600"}`}>{snap?.stats.tasksFailed ?? 0} failed</p>
            </div>
            <div className="bg-[#09090b] p-3">
              <p className="font-mono text-[8px] uppercase tracking-widest text-zinc-600">Budget</p>
              <p className="mt-1 text-xs text-zinc-300">{snap?.budget.used ?? 0}/{snap?.budget.limit ?? 24}</p>
              <p className="mt-1 font-mono text-[9px] text-zinc-600">command cost / 60s</p>
            </div>
            <div className="bg-[#09090b] p-3">
              <p className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-widest text-zinc-600"><Database className="h-3 w-3" aria-hidden /> Mirror</p>
              <p className={`mt-1 text-xs font-semibold ${mirror?.mode === "LIVE" && (mirror.pending ?? 0) === 0 ? "text-emerald-300" : "text-amber-300"}`}>{mirror?.mode ?? "UNKNOWN"}</p>
              <p className="mt-1 font-mono text-[9px] text-zinc-600">outbox {mirror?.pending ?? 0}</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
