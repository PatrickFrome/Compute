"use client";
// R97 primary shell: one persistent workspace.
// Left: canonical live chat actors (supervisors first, then fleet agents).
// Right: the exact native Browser WebContents selected by Browser main.
// Advanced pages remain available only through Settings / command search.

import { useCallback, useEffect, useRef, useState } from "react";
import { useMe2, type PageKey } from "@/components/me2/store";
import { useToast } from "@/hooks/use-toast";
import { TopBar } from "@/components/me2/shell/topbar";
import { CommandPalette } from "@/components/me2/shell/command-palette";
import { GlobalDialogs } from "@/components/me2/shell/dialogs";
import { CodePage } from "@/components/me2/pages/code";
import { TasksPage } from "@/components/me2/pages/tasks";
import { SupervisorPage } from "@/components/me2/pages/supervisor";
import { MemoryPage } from "@/components/me2/pages/memory";
import { ObservabilityPage } from "@/components/me2/pages/observability";
import { SystemPage } from "@/components/me2/pages/system";

type PrimaryChatActor = {
  actor_id: string;
  actor_type: "SUPERVISOR" | "AGENT";
  role: string;
  state: string;
  tab_id: string;
  selected: boolean;
  title: string;
  model: string;
  exact_native_binding: boolean;
};

type PrimaryChatRoster = {
  schema: "metaengine.browser.primary-chat-fleet-roster.v1";
  actors: PrimaryChatActor[];
  actor_count: number;
  supervisor_count: number;
  agent_count: number;
  selected_actor_id: string | null;
};

type PrimaryShellBridge = {
  setPrimaryOverlay?: (active: boolean) => unknown;
  primaryChatFleetRoster?: () => Promise<PrimaryChatRoster>;
  selectPrimaryChatActor?: (actorId: string) => Promise<{
    selection_applied?: boolean;
    actor_id?: string;
    tab_id?: string | null;
  } | null>;
};

type ClientGoalSubmission = {
  schema: "metaengine.client.goal-submission.v1";
  request_id: string;
  request_replayed: boolean;
  exact_request_correlation: true;
  goal: string;
  objective_id: string;
  roadmap_id: string;
  plan_generation: number;
  point_ids: string[];
  node_count: number;
  task_id: string;
  task_ids: string[];
  task_admission_state: "ADMITTED";
  atomic_plan_and_admission: true;
  exact_activation_readback: true;
  operator_initiated: true;
  automatic_retry_allowed: false;
  scheduler_authority: false;
  browser_actuation_authority: false;
  release_authority: false;
  authority_effect: false;
};

type ClientGoalProgress = {
  schema: "metaengine.client.goal-progress.v1";
  request_id: string;
  found: boolean;
  task_id?: string;
  task_state?: "READY" | "LEASED" | "RUNNING" | "RESULT_READY" | "BLOCKED" | "COMPLETED" | "FAILED" | "AMBIGUOUS" | "FENCED";
  terminal: boolean;
  reconciliation_required: boolean;
  automatic_retry_allowed: false;
  authority_effect: false;
};

type ClientGoalExecutionProof = {
  schema: "metaengine.client.goal-execution-proof.v1";
  request_id: string;
  found: boolean;
  task_id?: string;
  task_state?: ClientGoalProgress["task_state"];
  user_goal_to_agent_readback: boolean;
  user_goal_to_result_readback: boolean;
  agent_origin_proof?: {
    proven: boolean;
    contract?: "ZAI_AGENT_SURFACE_CAUSAL_V1" | null;
    conversation_url_sha256?: string | null;
    agent_surface_sha256?: string | null;
    effect_state?: string | null;
  };
  result_proof?: {
    available: boolean;
    claim_valid: boolean;
    origin_bound: boolean;
    accepted: boolean;
    claim_disposition?: string | null;
  };
  automatic_retry_allowed: false;
  authority_effect: false;
};

type ClientGoalJournalEntry = {
  schema: "metaengine.client.goal-journal-entry.v1";
  request_id: string;
  goal: string;
  state: string;
  receipt: ClientGoalSubmission | null;
  progress: ClientGoalProgress | null;
  execution_proof: ClientGoalExecutionProof | null;
  last_error: string | null;
  automatic_retry_allowed: false;
  authority_effect: false;
};

type ClientAgentSelection = {
  schema: "metaengine.client.agent-selection.v1";
  agent_id: string;
  actor_id: string;
  tab_id: string;
  selection_applied: true;
  exact_native_binding: true;
  presentation_only: true;
  scheduler_authority: false;
  browser_actuation_authority: false;
  update_authority: false;
  authority_effect: false;
};

type ClientControlBridge = {
  submitGoal?: (goal: string) => Promise<ClientGoalSubmission>;
  latestGoal?: () => Promise<ClientGoalJournalEntry | null>;
  goalStatus?: (requestId: string) => Promise<ClientGoalProgress>;
  selectAgent?: (agentId: string) => Promise<ClientAgentSelection>;
  typed_positive_api?: boolean;
  generic_command_exposed?: boolean;
};

const EMPTY_ROSTER: PrimaryChatRoster = {
  schema: "metaengine.browser.primary-chat-fleet-roster.v1",
  actors: [],
  actor_count: 0,
  supervisor_count: 0,
  agent_count: 0,
  selected_actor_id: null,
};

function shellBridge(): PrimaryShellBridge | null {
  return (window as Window & { metaengineShell?: PrimaryShellBridge }).metaengineShell ?? null;
}

function clientControlBridge(): ClientControlBridge | null {
  return (window as Window & { metaengineClient?: ClientControlBridge }).metaengineClient ?? null;
}

function usePrimaryChatRoster() {
  const [roster, setRoster] = useState<PrimaryChatRoster>(EMPTY_ROSTER);
  const [state, setState] = useState<"LOADING" | "LIVE" | "UNAVAILABLE">("LOADING");
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const bridge = shellBridge();
    if (!bridge?.primaryChatFleetRoster) {
      setState("UNAVAILABLE");
      return;
    }
    inFlight.current = true;
    try {
      const next = await bridge.primaryChatFleetRoster();
      if (next?.schema !== "metaengine.browser.primary-chat-fleet-roster.v1" || !Array.isArray(next.actors)) {
        setState("UNAVAILABLE");
        return;
      }
      setRoster(next);
      setState("LIVE");
    } catch {
      setState("UNAVAILABLE");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (cancelled) return;
      await refresh();
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { roster, state, refresh };
}

function GoalComposer() {
  const [goal, setGoal] = useState("");
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<ClientGoalSubmission | null>(null);
  const [journalEntry, setJournalEntry] = useState<ClientGoalJournalEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    const bridge = clientControlBridge();
    if (!bridge?.latestGoal) return;
    const latest = await bridge.latestGoal().catch(() => null);
    if (latest?.schema === "metaengine.client.goal-journal-entry.v1") {
      setJournalEntry(latest);
      if (latest.receipt?.schema === "metaengine.client.goal-submission.v1") setReceipt(latest.receipt);
    }
  }, []);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  const refreshProgress = useCallback(async () => {
    const bridge = clientControlBridge();
    const requestId = receipt?.request_id || journalEntry?.request_id || "";
    if (!bridge?.goalStatus || !requestId) return;
    setPending(true);
    try {
      await bridge.goalStatus(requestId);
      await loadLatest();
      setError(null);
    } catch (cause) {
      setError(String((cause as Error)?.message || cause || "goal_status_failed").slice(0, 180));
    } finally {
      setPending(false);
    }
  }, [journalEntry?.request_id, loadLatest, receipt?.request_id]);

  const submit = useCallback(async () => {
    const value = goal.trim();
    if (!value || pending) return;
    const bridge = clientControlBridge();
    if (!bridge?.submitGoal || bridge.typed_positive_api !== true || bridge.generic_command_exposed !== false) {
      setError("Typed Client control bridge unavailable");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const next = await bridge.submitGoal(value);
      if (next?.schema !== "metaengine.client.goal-submission.v1" || next.exact_activation_readback !== true) {
        throw new Error("goal_readback_invalid");
      }
      setReceipt(next);
      setGoal("");
      await loadLatest();
    } catch (cause) {
      setError(String((cause as Error)?.message || cause || "goal_submit_failed").slice(0, 180));
      // A lost submit response is never retried as an effect. The Browser main
      // process has already attempted one read-only request_id reconciliation;
      // load that durable local correlation record instead.
      await loadLatest();
    } finally {
      setPending(false);
    }
  }, [goal, loadLatest, pending]);

  return (
    <section
      className="flex min-h-[48px] shrink-0 items-center gap-2 border-b border-zinc-800 bg-[#0b0b0d] px-3 py-1.5"
      data-testid="client-goal-composer"
      aria-label="Client goal"
    >
      <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-400">Goal</span>
      <input
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        maxLength={480}
        disabled={pending}
        placeholder="Describe what METAENGINE should accomplish…"
        aria-label="User goal"
        data-testid="client-goal-input"
        className="h-8 min-w-0 flex-1 border border-zinc-800 bg-zinc-950 px-2.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-800 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={pending || !goal.trim()}
        data-testid="client-goal-submit"
        className="h-8 shrink-0 border border-cyan-800/70 bg-cyan-950/30 px-3 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-950/55 disabled:opacity-40"
      >
        {pending ? "Submitting…" : "Run"}
      </button>
      <span className="min-w-0 max-w-[380px] truncate font-mono text-[9px] text-zinc-500" data-testid="client-goal-readback">
        {error
          ? `ERROR · ${error}`
          : journalEntry?.execution_proof?.user_goal_to_result_readback === true
            ? `task ${journalEntry.execution_proof.task_id?.slice(0, 8)} · RESULT PROVEN · Agent origin bound`
            : journalEntry?.execution_proof?.user_goal_to_agent_readback === true
              ? `task ${journalEntry.execution_proof.task_id?.slice(0, 8)} · ${journalEntry.execution_proof.task_state} · Agent proven`
              : journalEntry?.progress?.found === true
                ? `task ${journalEntry.progress.task_id?.slice(0, 8)} · ${journalEntry.progress.task_state} · ${journalEntry.progress.terminal ? "terminal" : "in progress"}`
                : journalEntry?.state === "RECONCILE_REQUIRED"
                  ? `request ${journalEntry.request_id.slice(0, 8)} · reconciliation required`
                  : receipt
                    ? `${receipt.objective_id} · task ${receipt.task_id.slice(0, 8)} · ADMITTED ≠ completed`
                    : "typed Native Supervisor path"}
      </span>
      {journalEntry?.execution_proof ? (
        <span
          data-testid="client-goal-execution-proof"
          className="shrink-0 font-mono text-[8px] text-zinc-600"
          title={journalEntry.execution_proof.user_goal_to_result_readback
            ? "Exact Client request is bound to z.ai Agent-origin transport and an accepted typed result claim"
            : journalEntry.execution_proof.user_goal_to_agent_readback
              ? "Exact Client request is bound to z.ai Agent-origin transport; accepted result proof is pending"
              : "No Agent-origin proof is available for this exact Client request yet"}
        >
          {journalEntry.execution_proof.user_goal_to_result_readback
            ? "AGENT+RESULT"
            : journalEntry.execution_proof.user_goal_to_agent_readback
              ? "AGENT"
              : "NO AGENT PROOF"}
        </span>
      ) : null}
      {(receipt?.request_id || journalEntry?.request_id) ? (
        <button
          type="button"
          onClick={() => void refreshProgress()}
          disabled={pending}
          data-testid="client-goal-refresh"
          className="h-8 shrink-0 border border-zinc-800 px-2.5 text-[9px] font-semibold text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-40"
        >
          Refresh
        </button>
      ) : null}
    </section>
  );
}

function PageOutlet({ page }: { page: PageKey }) {
  switch (page) {
    case "code": return <CodePage />;
    case "tasks": return <TasksPage />;
    case "supervisor": return <SupervisorPage />;
    case "memory": return <MemoryPage />;
    case "observability": return <ObservabilityPage />;
    case "system": return <SystemPage />;
    default: return null;
  }
}

function actorTone(actor: PrimaryChatActor) {
  const state = String(actor.state || "").toUpperCase();
  if (state === "ACTIVE") return "bg-emerald-400";
  if (state === "BOUND_UNVERIFIED" || state === "PROVISIONING") return "bg-amber-400";
  return "bg-rose-400";
}

function ChatFleetRail() {
  const { roster, state, refresh } = usePrimaryChatRoster();
  const localSelection = useMe2((s) => s.chatId);
  const setChatId = useMe2((s) => s.setChatId);
  const attemptedInitial = useRef<string | null>(null);

  const supervisors = roster.actors.filter((actor) => actor.actor_type === "SUPERVISOR");
  const agents = roster.actors.filter((actor) => actor.actor_type === "AGENT");
  const ordered = [...supervisors, ...agents];
  const selectedActorId = roster.selected_actor_id || localSelection;

  const select = useCallback(async (actor: PrimaryChatActor) => {
    setChatId(actor.actor_id);
    if (actor.actor_type === "AGENT") {
      const bridge = clientControlBridge();
      const agentId = actor.actor_id.startsWith("agent:") ? actor.actor_id.slice("agent:".length) : "";
      if (!bridge?.selectAgent || !agentId) return;
      const result = await bridge.selectAgent(agentId).catch(() => null);
      if (result?.selection_applied === true && result.exact_native_binding === true) await refresh();
      return;
    }
    const bridge = shellBridge();
    if (!bridge?.selectPrimaryChatActor) return;
    const result = await bridge.selectPrimaryChatActor(actor.actor_id).catch(() => null);
    if (result?.selection_applied === true) await refresh();
  }, [refresh, setChatId]);

  // One bounded startup choice only when Browser has no selected managed actor.
  // No retry loop: exact binding must already exist for selection to succeed.
  useEffect(() => {
    if (roster.selected_actor_id || ordered.length === 0) return;
    const first = ordered[0];
    if (!first || attemptedInitial.current === first.actor_id) return;
    attemptedInitial.current = first.actor_id;
    void select(first);
  }, [ordered, roster.selected_actor_id, select]);

  const section = (title: string, rows: PrimaryChatActor[]) => (
    <section className="space-y-1" aria-label={title}>
      <div className="flex items-center justify-between px-2 pt-2 text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-600">
        <span>{title}</span><span>{rows.length}</span>
      </div>
      {rows.map((actor) => {
        const selected = selectedActorId === actor.actor_id || actor.selected;
        return (
          <button
            key={actor.actor_id}
            type="button"
            onClick={() => void select(actor)}
            data-testid={actor.actor_type === "SUPERVISOR" ? "chat-supervisor-row" : "chat-agent-row"}
            data-actor-id={actor.actor_id}
            aria-current={selected ? "page" : undefined}
            className={`group flex w-full items-center gap-2 border-l-2 px-2 py-2 text-left transition ${
              selected
                ? "border-cyan-400 bg-cyan-950/20 text-zinc-100"
                : "border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/70 hover:text-zinc-200"
            }`}
            title={actor.title || actor.role}
          >
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 font-mono text-[10px] font-bold text-zinc-300">
              {(actor.actor_type === "SUPERVISOR" ? "S" : actor.role || "A").slice(0, 2).toUpperCase()}
              <i className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[#0b0b0d] ${actorTone(actor)}`} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-[11px] font-semibold">
                {actor.actor_type === "SUPERVISOR" ? "SUPERVISOR" : actor.role}
              </strong>
              <small className="block truncate font-mono text-[9px] text-zinc-500" data-testid="chat-actor-short-id">
                {actor.actor_id.split(":").at(-1)?.slice(0, 18) || actor.actor_id.slice(0, 18)}
              </small>
              <small className="block truncate font-mono text-[9px] text-zinc-600">
                {actor.state} · {actor.model || "GLM-5.3-Flash"}
              </small>
            </span>
          </button>
        );
      })}
    </section>
  );

  return (
    <aside
      className="h-full min-h-0 w-[288px] shrink-0 overflow-hidden border-r border-zinc-800 bg-[#0b0b0d] max-[1007px]:hidden"
      data-testid="chat-fleet-rail"
      aria-label="Chat agents and supervisors"
    >
      <div className="flex h-10 items-center justify-between border-b border-zinc-800 px-3">
        <div>
          <strong className="block text-[10px] uppercase tracking-[0.16em] text-zinc-300">Chat Fleet</strong>
          <span className="font-mono text-[8px] text-zinc-600">
            {state === "LIVE" ? `GLM-5.3-Flash · ${roster.actor_count} live` : state}
          </span>
        </div>
      </div>
      <div className="mc-scroll h-[calc(100%-40px)] overflow-y-auto pb-3">
        {state === "LOADING" && ordered.length === 0 ? <p className="px-3 py-4 text-[10px] text-zinc-600">Loading chat actors…</p> : null}
        {state === "UNAVAILABLE" && ordered.length === 0 ? <p className="px-3 py-4 text-[10px] text-rose-400">Browser roster unavailable</p> : null}
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
          <span>Selected GLM chat is rendered here by the native Browser surface.</span>
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
    const shell = shellBridge();
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
      {mainWorkspace ? <GoalComposer /> : null}
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
