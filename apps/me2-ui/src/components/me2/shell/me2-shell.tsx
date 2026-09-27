"use client";
// R97 primary shell: one persistent workspace.
// Left: every active chat actor (supervisors first, then agents).
// Right: the exact native Browser WebContents bound to the selected session.
// All diagnostic/engineering pages remain reachable only through Settings or
// the command palette and do not occupy persistent chrome.

import { useEffect, useRef } from "react";
import { useMe2, type PageKey } from "@/components/me2/store";
import { useAgentChatSessions, type AgentChatSession } from "@/hooks/use-agentchat-sessions";
import { useToast } from "@/hooks/use-toast";
import { TopBar } from "@/components/me2/shell/topbar";
import { CommandPalette } from "@/components/me2/shell/command-palette";
import { GlobalDialogs } from "@/components/me2/shell/dialogs";
import { CommandPage } from "@/components/me2/pages/command";
import { AgentsPage } from "@/components/me2/pages/agents";
import { CodePage } from "@/components/me2/pages/code";
import { TasksPage } from "@/components/me2/pages/tasks";
import { SupervisorPage } from "@/components/me2/pages/supervisor";
import { ComputePage } from "@/components/me2/pages/compute";
import { MemoryPage } from "@/components/me2/pages/memory";
import { ObservabilityPage } from "@/components/me2/pages/observability";
import { SystemPage } from "@/components/me2/pages/system";

type PrimaryShellBridge = {
  setPrimaryOverlay?: (active: boolean) => unknown;
  selectPrimaryAgentSession?: (sessionId: string) => Promise<{
    state?: string;
    selection_applied?: boolean;
    tab_id?: string | null;
    conversation_url?: string | null;
  } | null>;
};

function PageOutlet({ page }: { page: PageKey }) {
  switch (page) {
    case "command": return <CommandPage />;
    case "agents": return <AgentsPage />;
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

function actorLabel(session: AgentChatSession) {
  const role = String(session.role || "AGENT").trim().toUpperCase();
  if (role === "SUPERVISOR") return "SUPERVISOR";
  return role || "AGENT";
}

function actorTone(session: AgentChatSession) {
  if (session.state === "THINKING") return "bg-amber-400";
  if (session.last_error || session.fail_streak > 0) return "bg-rose-400";
  return "bg-emerald-400";
}

function ChatFleetRail() {
  const { sessions, loading, error } = useAgentChatSessions();
  const chatId = useMe2((s) => s.chatId);
  const setChatId = useMe2((s) => s.setChatId);
  const attemptedInitial = useRef<string | null>(null);
  const active = sessions.filter((session) => session.status === "ACTIVE");
  const supervisors = active.filter((session) => String(session.role || "").toUpperCase() === "SUPERVISOR");
  const agents = active.filter((session) => String(session.role || "").toUpperCase() !== "SUPERVISOR");
  const ordered = [...supervisors, ...agents];

  const select = async (session: AgentChatSession) => {
    setChatId(session.id);
    window.dispatchEvent(new CustomEvent("me2:chat-selected", { detail: session.id }));
    const shell = (window as Window & { metaengineShell?: PrimaryShellBridge }).metaengineShell;
    if (!shell?.selectPrimaryAgentSession) return;
    await shell.selectPrimaryAgentSession(session.id).catch(() => null);
  };

  // One bounded initial presentation choice. If the Mission Control binding is
  // not ready yet we do not poll/retry the physical selection; the user can
  // select the actor once its exact binding is visible.
  useEffect(() => {
    if (chatId || ordered.length === 0) return;
    const first = ordered[0];
    if (!first || attemptedInitial.current === first.id) return;
    attemptedInitial.current = first.id;
    void select(first);
  // The ordered identity list changes only when the bounded /agentchat snapshot changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, ordered.map((session) => session.id).join("|")]);

  const section = (title: string, rows: AgentChatSession[]) => (
    <section className="space-y-1" aria-label={title}>
      <div className="flex items-center justify-between px-2 pt-2 text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-600">
        <span>{title}</span><span>{rows.length}</span>
      </div>
      {rows.map((session) => {
        const selected = chatId === session.id;
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => void select(session)}
            data-testid={String(session.role || "").toUpperCase() === "SUPERVISOR" ? "chat-supervisor-row" : "chat-agent-row"}
            data-session-id={session.id}
            aria-current={selected ? "page" : undefined}
            className={`group flex w-full items-center gap-2 border-l-2 px-2 py-2 text-left transition ${
              selected
                ? "border-cyan-400 bg-cyan-950/20 text-zinc-100"
                : "border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/70 hover:text-zinc-200"
            }`}
            title={session.objective || session.title || actorLabel(session)}
          >
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 font-mono text-[10px] font-bold text-zinc-300">
              {actorLabel(session).slice(0, 2)}
              <i className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[#0b0b0d] ${actorTone(session)}`} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-[11px] font-semibold">{actorLabel(session)}</strong>
              <small className="block truncate font-mono text-[9px] text-zinc-600">
                {session.state} · GLM-5.3-Flash
              </small>
            </span>
          </button>
        );
      })}
    </section>
  );

  return (
    <aside
      className="h-full min-h-0 w-[288px] shrink-0 overflow-hidden border-r border-zinc-800 bg-[#0b0b0d]"
      data-testid="chat-fleet-rail"
      aria-label="Chat agents and supervisors"
    >
      <div className="flex h-10 items-center justify-between border-b border-zinc-800 px-3">
        <div>
          <strong className="block text-[10px] uppercase tracking-[0.16em] text-zinc-300">Chat Fleet</strong>
          <span className="font-mono text-[8px] text-zinc-600">GLM-5.3-Flash · {active.length} live</span>
        </div>
      </div>
      <div className="mc-scroll h-[calc(100%-40px)] overflow-y-auto pb-3">
        {loading && active.length === 0 ? <p className="px-3 py-4 text-[10px] text-zinc-600">Loading chat actors…</p> : null}
        {error && active.length === 0 ? <p className="px-3 py-4 text-[10px] text-rose-400">Fleet unavailable</p> : null}
        {section("Supervisors", supervisors)}
        {section("Agents", agents)}
      </div>
    </aside>
  );
}

function PrimaryChatFleetWorkspace() {
  return (
    <div
      className="flex h-full min-h-0 min-w-0 overflow-hidden bg-[#09090b]"
      data-testid="primary-chat-fleet"
    >
      <ChatFleetRail />
      <section
        className="relative min-w-0 flex-1 overflow-hidden bg-black"
        data-testid="native-chat-surface-slot"
        aria-label="Selected chat agent website"
      >
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-[10px] text-zinc-700">
          <span>Selected agent website is rendered by the native Browser surface.</span>
        </div>
      </section>
    </div>
  );
}

export function Me2Shell() {
  const page = useMe2((s) => s.page);
  const init = useMe2((s) => s.init);
  const paletteOpen = useMe2((s) => s.paletteOpen);
  const dialog = useMe2((s) => s.dialog);
  const detail = useMe2((s) => s.detail);
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
    const shell = (window as Window & { metaengineShell?: PrimaryShellBridge }).metaengineShell;
    if (!shell?.setPrimaryOverlay) return;
    void shell.setPrimaryOverlay(nativeOverlayOpen);
    return () => { void shell.setPrimaryOverlay?.(false); };
  }, [nativeOverlayOpen]);

  const mainWorkspace = page === "browser";

  return (
    <div
      className="mc-dark flex h-screen min-h-0 flex-col overflow-hidden bg-[#09090b] text-zinc-200 selection:bg-emerald-400/20"
      data-testid="me2-shell"
      data-main-workspace={mainWorkspace ? "chat-fleet" : "advanced"}
    >
      <TopBar />
      <main
        className={mainWorkspace ? "min-h-0 min-w-0 flex-1 overflow-hidden" : "min-h-0 min-w-0 flex-1 overflow-auto p-1.5"}
        data-testid="page-outlet"
        data-page={page}
      >
        {mainWorkspace ? <PrimaryChatFleetWorkspace /> : <PageOutlet page={page} />}
      </main>
      {paletteOpen ? <CommandPalette /> : null}
      {overlaysOpen ? <GlobalDialogs /> : null}
    </div>
  );
}
