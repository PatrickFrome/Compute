"use client";
// R95 Utility Panel: the existing read-only context plane can dock Bottom or
// Right per Workspace. Native Browser geometry remains authoritative on COMMAND;
// renderer preference never becomes Browser routing or command authority.

import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  Activity, Bot, Crosshair, Database, ListChecks, ScanSearch, Server, X,
  PanelBottom, PanelRight,
} from "lucide-react";
import { useMe2, type ContextDrawerDock, type ContextDrawerTab } from "@/components/me2/store";
import { EVENT_STYLE, hhmmss } from "@/lib/me2-bus";
import { useAgentChatSessions } from "@/hooks/use-agentchat-sessions";

const TABS: Array<{ key: ContextDrawerTab; label: string; icon: typeof Activity }> = [
  { key: "selection", label: "Selection", icon: ScanSearch },
  { key: "events", label: "Events", icon: Activity },
  { key: "commands", label: "Commands", icon: ListChecks },
  { key: "runtime", label: "Runtime", icon: Server },
];

const BOTTOM_MIN = 160;
const BOTTOM_MAX = 360;
const RIGHT_MIN = 320;
const RIGHT_MAX = 520;

function SelectionPane({ dock }: { dock: ContextDrawerDock }) {
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

  const shellClass = dock === "right"
    ? "flex min-h-full flex-col divide-y divide-zinc-900"
    : "grid min-h-full grid-cols-1 gap-px bg-zinc-900 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_220px]";

  return (
    <div className={shellClass} data-testid="context-drawer-selection">
      <section className="min-w-0 bg-[#09090b] p-3" aria-label="Selected agent">
        <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600">
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
            {agent.objective ? <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-zinc-400">{agent.objective}</p> : null}
            <p className="mt-2 font-mono text-[9px] text-zinc-600">
              {agent.turns_ok} ok · {agent.turns_fail} fail · compact {agent.compactions}
              {agent.outcome_status ? ` · outcome ${agent.outcome_status}` : ""}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-zinc-600">
            {loading ? "загрузка agent context…" : error ? `agent feed: ${error}` : "выберите агента в COMMAND или FLEET"}
          </p>
        )}
      </section>

      <section className="min-w-0 bg-[#09090b] p-3" aria-label="Last inspected task">
        <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600">
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
            <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-zinc-400">{task.spec}</p>
            <p className="mt-2 font-mono text-[9px] text-zinc-600">
              {task.steps}/{task.max_steps} steps{task.role ? ` · ${task.role}` : ""}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-zinc-600">откройте задачу в PLAN, чтобы закрепить её контекст</p>
        )}
      </section>

      <section className="bg-[#09090b] p-3" aria-label="Current workspace context">
        <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600">Context</p>
        <p className="mt-2 text-[11px] text-zinc-300">{workspace}</p>
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
  const dock = useMe2((s) => s.contextDrawerDock);
  const setDock = useMe2((s) => s.setContextDrawerDock);
  const preferredHeight = useMe2((s) => s.contextDrawerPreferredHeight);
  const height = useMe2((s) => s.contextDrawerHeight);
  const setHeight = useMe2((s) => s.setContextDrawerHeight);
  const preferredWidth = useMe2((s) => s.contextDrawerPreferredWidth);
  const width = useMe2((s) => s.contextDrawerWidth);
  const setWidth = useMe2((s) => s.setContextDrawerWidth);
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

  useEffect(() => {
    resizeCleanup.current?.();
    resizeCleanup.current = null;
  }, [workspace, dock]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanup.current?.();

    const startX = event.clientX;
    const startY = event.clientY;
    const startHeight = height;
    const startWidth = width;
    const startDock = dock;
    const startWorkspace = workspace;
    let nextHeight = height;
    let nextWidth = width;
    let frame = 0;

    const sameTransaction = () => (
      useMe2.getState().workspace === startWorkspace
      && useMe2.getState().contextDrawerDock === startDock
    );
    const cleanup = () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      resizeCleanup.current = null;
    };
    const move = (pointerEvent: PointerEvent) => {
      if (!sameTransaction()) {
        cleanup();
        return;
      }
      if (startDock === "right") {
        nextWidth = Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, startWidth + startX - pointerEvent.clientX));
      } else {
        nextHeight = Math.max(BOTTOM_MIN, Math.min(BOTTOM_MAX, startHeight + startY - pointerEvent.clientY));
      }
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!sameTransaction()) {
          cleanup();
          return;
        }
        if (startDock === "right") setWidth(nextWidth, false);
        else setHeight(nextHeight, false);
      });
    };
    const finish = () => {
      const current = sameTransaction();
      cleanup();
      if (!current) return;
      if (startDock === "right") setWidth(nextWidth, true);
      else setHeight(nextHeight, true);
    };
    const cancel = () => {
      const current = sameTransaction();
      cleanup();
      if (!current) return;
      if (startDock === "right") setWidth(startWidth, false);
      else setHeight(startHeight, false);
    };

    resizeCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  }, [dock, height, setHeight, setWidth, width, workspace]);

  const resizeByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (dock === "right") {
      if (event.key === "ArrowLeft") next = Math.min(RIGHT_MAX, width + 20);
      else if (event.key === "ArrowRight") next = Math.max(RIGHT_MIN, width - 20);
      else if (event.key === "Home") next = RIGHT_MIN;
      else if (event.key === "End") next = RIGHT_MAX;
      if (next == null) return;
      event.preventDefault();
      setWidth(next, true);
      return;
    }
    if (event.key === "ArrowUp") next = Math.min(BOTTOM_MAX, height + 20);
    else if (event.key === "ArrowDown") next = Math.max(BOTTOM_MIN, height - 20);
    else if (event.key === "Home") next = BOTTOM_MIN;
    else if (event.key === "End") next = BOTTOM_MAX;
    if (next == null) return;
    event.preventDefault();
    setHeight(next, true);
  }, [dock, height, setHeight, setWidth, width]);

  if (!open) return null;

  const dimension = dock === "right" ? width : height;
  const preferredDimension = dock === "right" ? preferredWidth : preferredHeight;
  const minDimension = dock === "right" ? RIGHT_MIN : BOTTOM_MIN;
  const maxDimension = dock === "right" ? RIGHT_MAX : BOTTOM_MAX;
  const sizePresets = dock === "right"
    ? ([[320, "S"], [380, "M"], [480, "L"]] as const)
    : ([[160, "S"], [200, "M"], [300, "L"]] as const);

  return (
    <section
      className={`flex shrink-0 flex-col bg-[#09090b] ${
        dock === "right" ? "border-l border-zinc-800" : "border-t border-zinc-800"
      }`}
      style={dock === "right" ? { width: `${width}px` } : { height: `${height}px` }}
      data-testid="context-drawer"
      data-drawer-dock={dock}
      data-drawer-height={height}
      data-drawer-width={width}
      aria-label="Utility Panel"
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label={dock === "right" ? "Resize Utility Panel width" : "Resize Utility Panel height"}
        aria-orientation={dock === "right" ? "vertical" : "horizontal"}
        aria-valuemin={minDimension}
        aria-valuemax={maxDimension}
        aria-valuenow={dimension}
        aria-valuetext={dimension === preferredDimension ? `${dimension}px` : `${dimension}px effective; ${preferredDimension}px preferred`}
        aria-controls="context-drawer-content"
        data-testid="context-drawer-resizer"
        onPointerDown={beginResize}
        onKeyDown={resizeByKeyboard}
        className={`group relative shrink-0 bg-zinc-900 outline-none focus-visible:bg-cyan-950 ${
          dock === "right" ? "h-full w-1.5 cursor-col-resize" : "h-1.5 w-full cursor-row-resize"
        }`}
        title={dock === "right" ? "Drag to resize · ←/→ 20px · Home/End" : "Drag to resize · ↑/↓ 20px · Home/End"}
      >
        <span className={`pointer-events-none absolute bg-zinc-700 group-hover:bg-cyan-700 ${
          dock === "right"
            ? "left-1/2 top-1/2 h-10 w-px -translate-x-1/2 -translate-y-1/2"
            : "left-1/2 top-1/2 h-px w-10 -translate-x-1/2 -translate-y-1/2"
        }`} />
      </div>

      <div className="flex h-8 shrink-0 items-center border-b border-zinc-800/80 px-2">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto mc-scroll" role="tablist" aria-label="Utility Panel tabs">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex shrink-0 items-center gap-1.5 border-b px-2 font-mono text-[9px] uppercase tracking-[0.08em] ${
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
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Utility Panel"
          className="ml-1 p-1 text-zinc-600 hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-zinc-900 px-2">
        <div className="flex items-center gap-0.5 border-r border-zinc-800 pr-2" role="group" aria-label="Utility Panel position">
          <button
            type="button"
            data-testid="utility-panel-dock-bottom"
            onClick={() => setDock("bottom")}
            aria-pressed={dock === "bottom"}
            className={`flex h-5 items-center gap-1 px-1.5 text-[9px] ${
              dock === "bottom" ? "bg-zinc-800 text-cyan-300" : "text-zinc-600 hover:text-zinc-300"
            }`}
            title="Dock Utility Panel at bottom"
          >
            <PanelBottom className="h-3 w-3" aria-hidden /> Bottom
          </button>
          <button
            type="button"
            data-testid="utility-panel-dock-right"
            onClick={() => setDock("right")}
            aria-pressed={dock === "right"}
            className={`flex h-5 items-center gap-1 px-1.5 text-[9px] ${
              dock === "right" ? "bg-zinc-800 text-cyan-300" : "text-zinc-600 hover:text-zinc-300"
            }`}
            title="Dock Utility Panel on right"
          >
            <PanelRight className="h-3 w-3" aria-hidden /> Right
          </button>
        </div>

        <div className="flex items-center gap-0.5 border-r border-zinc-800 pr-2" role="group" aria-label="Utility Panel size">
          {sizePresets.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => dock === "right" ? setWidth(value) : setHeight(value)}
              aria-pressed={preferredDimension === value}
              className={`h-5 min-w-5 px-1 font-mono text-[8px] ${
                preferredDimension === value
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-600 hover:bg-zinc-900 hover:text-zinc-300"
              }`}
              title={`Utility Panel ${value}px`}
            >
              {label}
            </button>
          ))}
          {dimension !== preferredDimension ? (
            <span className="ml-1 font-mono text-[8px] text-amber-400" title="Size constrained by native Browser minimum">
              {dimension}px
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setFollowSelection(!followSelection)}
          aria-pressed={followSelection}
          data-testid="context-drawer-follow-selection"
          className={`ml-auto flex h-5 items-center gap-1 px-1.5 font-mono text-[8px] uppercase tracking-wide transition-colors ${
            followSelection
              ? "bg-cyan-950/30 text-cyan-300"
              : "text-zinc-600 hover:text-zinc-300"
          }`}
          title="Follow selected task/agent while the Utility Panel is open. Drawer никогда не открывается автоматически."
        >
          <Crosshair className="h-3 w-3" aria-hidden />
          follow
        </button>
        <span className="hidden font-mono text-[8px] text-zinc-700 2xl:inline">Ctrl/Cmd+J</span>
      </div>

      <div id="context-drawer-content" className="min-h-0 flex-1 overflow-auto mc-scroll">
        {tab === "selection" ? <SelectionPane dock={dock} /> : null}

        {tab === "events" ? (
          <div className="font-mono text-[10px]" data-testid="context-drawer-events">
            {events.slice(0, 24).map((event) => (
              dock === "right" ? (
                <div key={event.seq} className="border-b border-zinc-900/80 px-2 py-1.5 hover:bg-zinc-900/50">
                  <div className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-zinc-700">{event.seq}</span>
                    <span className="w-14 shrink-0 text-zinc-600">{hhmmss(event.ts)}</span>
                    <span className={`min-w-0 flex-1 truncate font-semibold ${EVENT_STYLE[event.type] ?? "text-zinc-400"}`} title={event.type}>{event.type}</span>
                  </div>
                  <p className="mt-0.5 truncate pl-[104px] text-zinc-500" title={event.data}>{event.data}</p>
                </div>
              ) : (
                <div key={event.seq} className="flex gap-2 border-b border-zinc-900/80 px-2 py-1 hover:bg-zinc-900/50">
                  <span className="w-12 shrink-0 text-zinc-700">{event.seq}</span>
                  <span className="w-16 shrink-0 text-zinc-600">{hhmmss(event.ts)}</span>
                  <span className={`w-36 shrink-0 truncate font-semibold ${EVENT_STYLE[event.type] ?? "text-zinc-400"}`} title={event.type}>{event.type}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-500" title={event.data}>{event.data}</span>
                </div>
              )
            ))}
            {events.length === 0 ? <p className="p-4 text-center text-zinc-600">событий пока нет</p> : null}
          </div>
        ) : null}

        {tab === "commands" ? (
          <div className="font-mono text-[10px]" data-testid="context-drawer-commands">
            {(snap?.commands ?? []).slice(0, 24).map((command) => (
              <div key={command.id} className={`border-b border-zinc-900/80 px-2 py-1 hover:bg-zinc-900/50 ${dock === "right" ? "grid grid-cols-[minmax(0,1fr)_72px] gap-x-2" : "flex gap-2"}`}>
                <span className={dock === "right" ? "truncate text-zinc-300" : "w-20 shrink-0 truncate text-zinc-600"}>{dock === "right" ? command.action : command.lane}</span>
                {dock === "right" ? null : <span className="min-w-0 flex-1 truncate text-zinc-300" title={command.action}>{command.action}</span>}
                {dock === "right" ? null : <span className="w-16 shrink-0 text-right text-zinc-600">c{command.cost}</span>}
                <span className={`shrink-0 text-right ${
                  command.status === "FAILED" ? "text-rose-400" : command.status === "COMPLETED" ? "text-emerald-400" : "text-zinc-500"
                }`}>{command.status}</span>
                {dock === "right" ? <span className="col-span-2 text-[9px] text-zinc-600">{command.lane} · c{command.cost}</span> : null}
              </div>
            ))}
            {(snap?.commands ?? []).length === 0 ? <p className="p-4 text-center text-zinc-600">command bus пуст</p> : null}
          </div>
        ) : null}

        {tab === "runtime" ? (
          <div className={`grid min-h-full gap-px bg-zinc-900 ${dock === "right" ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-4"}`} data-testid="context-drawer-runtime">
            <div className="bg-[#09090b] p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600">Transport</p>
              <p className={`mt-1 text-xs font-semibold ${connected ? "text-emerald-300" : "text-rose-300"}`}>{connected ? "LIVE" : "OFFLINE"}</p>
              <p className="mt-1 font-mono text-[9px] text-zinc-600">ws :3040 · rest :3041</p>
            </div>
            <div className="bg-[#09090b] p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600">Tasks</p>
              <p className="mt-1 text-xs text-zinc-300">{snap?.stats.tasksRunning ?? 0} running · {snap?.stats.tasksReady ?? 0} ready</p>
              <p className={`mt-1 font-mono text-[9px] ${(snap?.stats.tasksFailed ?? 0) > 0 ? "text-rose-400" : "text-zinc-600"}`}>{snap?.stats.tasksFailed ?? 0} failed</p>
            </div>
            <div className="bg-[#09090b] p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600">Budget</p>
              <p className="mt-1 text-xs text-zinc-300">{snap?.budget.used ?? 0}/{snap?.budget.limit ?? 24}</p>
              <p className="mt-1 font-mono text-[9px] text-zinc-600">command cost / 60s</p>
            </div>
            <div className="bg-[#09090b] p-3">
              <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600"><Database className="h-3 w-3" aria-hidden /> Mirror</p>
              <p className={`mt-1 text-xs font-semibold ${mirror?.mode === "LIVE" && (mirror.pending ?? 0) === 0 ? "text-emerald-300" : "text-amber-300"}`}>{mirror?.mode ?? "UNKNOWN"}</p>
              <p className="mt-1 font-mono text-[9px] text-zinc-600">outbox {mirror?.pending ?? 0}</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
