"use client";
// R85 contextual drawer: a secondary read-only context that never owns effects.
// On COMMAND, main-process native geometry reserves the same 200px so renderer
// controls cannot be covered by the Browser WebContentsView.

import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Activity, Bot, Crosshair, Database, ListChecks, ScanSearch, Server, X } from "lucide-react";
import { useMe2, type ContextDrawerTab } from "@/components/me2/store";
import { EVENT_STYLE, hhmmss } from "@/lib/me2-bus";
import { useAgentChatSessions } from "@/hooks/use-agentchat-sessions";

const TABS: Array<{ key: ContextDrawerTab; label: string; icon: typeof Activity }> = [
  { key: "selection", label: "Selection", icon: ScanSearch },
  { key: "events", label: "Events", icon: Activity },
  { key: "commands", label: "Commands", icon: ListChecks },
  { key: "runtime", label: "Runtime", icon: Server },
];

function SelectionPane() {
  const chatId = useMe2((s) => s.chatId);
  const inspectedTaskId = useMe2((s) => s.inspectedTaskId);
  const snap = useMe2((s) => s.snap);
  const page = useMe2((s) => s.page);
  const workspace = useMe2((s) => s.workspace);
  const { sessions, status, loading, error } = useAgentChatSessions();

  const agent = chatId ? sessions.find((session) => session.id === chatId) ?? null : null;
  const task = inspectedTaskId
    ? (snap?.tasks ?? []).find((item) => item.id === inspectedTaskId)
      ?? (snap?.archived ?? []).find((item) => item.id === inspectedTaskId)
      ?? null
    : null;

  return (
    <div className="grid min-h-full grid-cols-1 gap-px bg-zinc-900 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_220px]" data-testid="context-drawer-selection">
      <section className="min-w-0 bg-[#09090b] p-3" aria-label="Selected agent">
        <p className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-widest text-zinc-600">
          <Bot className="h-3 w-3" aria-hidden /> Selected agent
        </p>
        {agent ? (
          <div className="mt-2 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${agent.state === "THINKING" ? "bg-violet-400" : "bg-emerald-400"}`} aria-hidden />
              <strong className="truncate text-[12px] text-zinc-200">{agent.title}</strong>
              <span className="shrink-0 border border-zinc-800 px-1 font-mono text-[8px] text-zinc-500">{agent.role}</span>
            </div>
            <p className="mt-1 truncate font-mono text-[9px] text-zinc-500">{agent.model} · {agent.id}</p>
            {agent.objective ? <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-zinc-400">{agent.objective}</p> : null}
            <p className="mt-2 font-mono text-[9px] text-zinc-600">
              {agent.turns_ok} ok · {agent.turns_fail} fail · compact {agent.compactions}
              {agent.outcome_status ? ` · outcome ${agent.outcome_status}` : ""}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[10px] text-zinc-600">
            {loading ? "загрузка agent context…" : error ? `agent feed: ${error}` : "выберите агента в COMMAND или AGENTS"}
          </p>
        )}
      </section>

      <section className="min-w-0 bg-[#09090b] p-3" aria-label="Last inspected task">
        <p className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-widest text-zinc-600">
          <ListChecks className="h-3 w-3" aria-hidden /> Last inspected task
        </p>
        {task ? (
          <div className="mt-2 min-w-0">
            <div className="flex items-center gap-2">
              <strong className="truncate text-[12px] text-zinc-200">{task.title}</strong>
              <span className={`shrink-0 border px-1 font-mono text-[8px] ${
                task.status === "FAILED"
                  ? "border-rose-900 text-rose-300"
                  : task.status === "COMPLETED"
                    ? "border-emerald-900 text-emerald-300"
                    : "border-zinc-800 text-zinc-500"
              }`}>{task.status}</span>
            </div>
            <p className="mt-1 truncate font-mono text-[9px] text-zinc-500">{task.id}</p>
            <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-zinc-400">{task.spec}</p>
            <p className="mt-2 font-mono text-[9px] text-zinc-600">
              {task.steps}/{task.max_steps} steps{task.role ? ` · ${task.role}` : ""}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[10px] text-zinc-600">откройте задачу в TASKS, чтобы закрепить её контекст</p>
        )}
      </section>

      <section className="bg-[#09090b] p-3" aria-label="Current workspace context">
        <p className="font-mono text-[8px] uppercase tracking-widest text-zinc-600">Context</p>
        <p className="mt-2 font-mono text-[10px] text-zinc-300">{workspace}</p>
        <p className="font-mono text-[9px] text-zinc-600">page {page}</p>
        <p className="mt-3 font-mono text-[9px] text-zinc-600">
          fleet {status?.active ?? 0}/{status?.total ?? 0} · thinking {status?.thinking ?? 0}
        </p>
      </section>
    </div>
  );
}

export function ContextDrawer() {
  const open = useMe2((s) => s.contextDrawerOpen);
  const tab = useMe2((s) => s.contextDrawerTab);
  const setOpen = useMe2((s) => s.setContextDrawer);
  const setTab = useMe2((s) => s.setContextDrawerTab);
  const followSelection = useMe2((s) => s.contextDrawerFollowSelection);
  const setFollowSelection = useMe2((s) => s.setContextDrawerFollowSelection);
  const preferredHeight = useMe2((s) => s.contextDrawerPreferredHeight);
  const height = useMe2((s) => s.contextDrawerHeight);
  const setHeight = useMe2((s) => s.setContextDrawerHeight);
  const events = useMe2((s) => s.events);
  const snap = useMe2((s) => s.snap);
  const mirror = useMe2((s) => s.mirror);
  const connected = useMe2((s) => s.connected);
  const workspace = useMe2((s) => s.workspace);
  const resizeCleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    resizeCleanup.current?.();
    resizeCleanup.current = null;
  }, []);

  // Workspace is part of the resize transaction identity. Changing workspace
  // cancels an active drag before another pointer event can persist dimensions
  // into the newly selected workspace.
  useEffect(() => {
    resizeCleanup.current?.();
    resizeCleanup.current = null;
  }, [workspace]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanup.current?.();

    const startY = event.clientY;
    const startHeight = height;
    const startWorkspace = workspace;
    let nextHeight = height;
    let frame = 0;

    const sameWorkspace = () => useMe2.getState().workspace === startWorkspace;
    const cleanup = () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey);
      resizeCleanup.current = null;
    };
    // R94: one restore path for pointercancel and Escape (WAI-ARIA APG
    // window-splitter pattern) — both drop partial geometry without persist.
    const restore = () => {
      const current = sameWorkspace();
      cleanup();
      if (current) setHeight(startHeight, false);
    };
    const move = (pointerEvent: PointerEvent) => {
      if (!sameWorkspace()) {
        cleanup();
        return;
      }
      nextHeight = Math.max(160, Math.min(360, startHeight + startY - pointerEvent.clientY));
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!sameWorkspace()) {
          cleanup();
          return;
        }
        setHeight(nextHeight, false);
      });
    };
    const finish = () => {
      const current = sameWorkspace();
      cleanup();
      if (current) setHeight(nextHeight, true);
    };
    const cancel = restore;
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      restore();
    };

    resizeCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    window.addEventListener("keydown", onKey);
  }, [height, setHeight, workspace]);

  // R94: VS Code parity — double tap on a splitter resets the panel to the
  // preferred height, fenced to the workspace that owns the layout.
  const resetByDoubleTap = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (useMe2.getState().workspace !== workspace) return;
    if (height === preferredHeight) return;
    setHeight(preferredHeight, true);
  }, [height, preferredHeight, setHeight, workspace]);

  const resizeByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowUp") next = Math.min(360, height + 20);
    else if (event.key === "ArrowDown") next = Math.max(160, height - 20);
    else if (event.key === "Home") next = 160;
    else if (event.key === "End") next = 360;
    if (next == null) return;
    event.preventDefault();
    setHeight(next, true);
  }, [height, setHeight]);

  if (!open) return null;

  return (
    <section
      className="flex shrink-0 flex-col border-t border-zinc-800 bg-[#09090b]"
      style={{ height: `${height}px` }}
      data-testid="context-drawer"
      data-drawer-height={height}
      aria-label="Context Drawer"
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize Context Drawer"
        aria-orientation="horizontal"
        aria-valuemin={160}
        aria-valuemax={360}
        aria-valuenow={height}
        aria-valuetext={height === preferredHeight ? `${height}px` : `${height}px effective; ${preferredHeight}px preferred`}
        aria-controls="context-drawer-content"
        data-testid="context-drawer-resizer"
        onPointerDown={beginResize}
        onDoubleClick={resetByDoubleTap}
        onKeyDown={resizeByKeyboard}
        className="group relative h-1.5 shrink-0 cursor-row-resize bg-zinc-900 outline-none focus-visible:bg-cyan-950 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
        title="Drag to resize · ↑/↓ 20px · Home/End · Esc cancel · double-click reset"
      >
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-10 -translate-x-1/2 -translate-y-1/2 bg-zinc-700 group-hover:bg-cyan-700 group-focus-visible:bg-cyan-500" />
      </div>
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
        <div className="ml-auto flex items-center gap-0.5 border-r border-zinc-800 pr-2" role="group" aria-label="Context Drawer size">
          {([
            [160, "S"],
            [200, "M"],
            [300, "L"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setHeight(value)}
              aria-pressed={preferredHeight === value}
              className={`h-5 min-w-5 px-1 font-mono text-[8px] ${
                preferredHeight === value
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-600 hover:bg-zinc-900 hover:text-zinc-300"
              }`}
              title={`Drawer ${value}px`}
            >
              {label}
            </button>
          ))}
          {height !== preferredHeight ? (
            <span className="ml-1 font-mono text-[8px] text-amber-400" title="Размер ограничен native Browser minimum">
              {height}px
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setFollowSelection(!followSelection)}
          aria-pressed={followSelection}
          data-testid="context-drawer-follow-selection"
          className={`ml-auto flex h-6 items-center gap-1 border px-1.5 font-mono text-[8px] uppercase tracking-wide transition-colors ${
            followSelection
              ? "border-cyan-900/70 bg-cyan-950/20 text-cyan-300"
              : "border-zinc-800 text-zinc-600 hover:text-zinc-300"
          }`}
          title="Когда Drawer открыт, новая task/agent selection переводит его на Selection. Drawer никогда не открывается автоматически."
        >
          <Crosshair className="h-3 w-3" aria-hidden />
          follow
        </button>
        <span className="ml-2 hidden font-mono text-[8px] text-zinc-700 sm:inline">Ctrl/Cmd+J</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Закрыть Context Drawer"
          className="ml-2 p-1 text-zinc-600 hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div id="context-drawer-content" className="min-h-0 flex-1 overflow-auto mc-scroll">
        {tab === "selection" ? <SelectionPane /> : null}
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
