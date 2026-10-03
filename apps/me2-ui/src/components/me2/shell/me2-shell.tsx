"use client";
// R97 primary shell: one persistent workspace.
// Left: canonical live chat actors (supervisors first, then fleet agents).
// Right: the exact native Browser WebContents selected by Browser main.
// Advanced pages remain available only through Settings / command search.

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useMe2, type PageKey } from "@/components/me2/store";
import { useToast } from "@/hooks/use-toast";
import { TopBar } from "@/components/me2/shell/topbar";
import { CommandPalette } from "@/components/me2/shell/command-palette";
import { GlobalDialogs } from "@/components/me2/shell/dialogs";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
const CodePage = lazy(() => import("@/components/me2/pages/code").then((m) => ({ default: m.CodePage })));
const TasksPage = lazy(() => import("@/components/me2/pages/tasks").then((m) => ({ default: m.TasksPage })));
const SupervisorPage = lazy(() => import("@/components/me2/pages/supervisor").then((m) => ({ default: m.SupervisorPage })));
const MemoryPage = lazy(() => import("@/components/me2/pages/memory").then((m) => ({ default: m.MemoryPage })));
const ObservabilityPage = lazy(() => import("@/components/me2/pages/observability").then((m) => ({ default: m.ObservabilityPage })));
const SystemPage = lazy(() => import("@/components/me2/pages/system").then((m) => ({ default: m.SystemPage })));

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
    exact_native_binding?: boolean;
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

type ClientWorkReadiness = {
  schema: "metaengine.client.work-readiness.v1";
  observed_at: string;
  state: "READY" | "PAUSED" | "BLOCKED";
  reason: string | null;
  label: string;
  detail: string;
  execution_ready: boolean;
  heartbeat_fresh: boolean;
  generation_floor: number | null;
  local_generation_floor: number | null;
  supervisor_state: string | null;
  proven_agent_count: number;
  active_agent_count: number | null;
  bound_unverified_agent_count: number | null;
  automatic_retry_allowed: false;
  authority_effect: false;
};

type ClientAdmissionRecoveryResult = {
  schema: "metaengine.client.admission-recovery-result.v1";
  state: string;
  reason: string | null;
  confirmed_open: boolean;
  expected_generation_floor?: number | null;
  observed_generation_floor?: number | null;
  effect_attempted?: boolean;
  effect_outcome_known?: boolean;
  prior_effect_replayed?: false;
  retry_requires_new_user_action: true;
  automatic_retry_allowed: false;
  authority_effect: false;
};

type ClientControlBridge = {
  submitGoal?: (goal: string) => Promise<ClientGoalSubmission>;
  latestGoal?: () => Promise<ClientGoalJournalEntry | null>;
  goalStatus?: (requestId: string) => Promise<ClientGoalProgress>;
  selectAgent?: (agentId: string) => Promise<ClientAgentSelection>;
  workReadiness?: () => Promise<ClientWorkReadiness>;
  resumeAdmission?: () => Promise<ClientAdmissionRecoveryResult>;
  admission_resume_requires_explicit_user_action?: boolean;
  admission_resume_automatic_retry_allowed?: false;
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
  const live = useRef(false);

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
      if (!live.current) return;
      if (next?.schema !== "metaengine.browser.primary-chat-fleet-roster.v1" || !Array.isArray(next.actors)) {
        setState("UNAVAILABLE");
        return;
      }
      setRoster(next);
      setState("LIVE");
    } catch {
      if (live.current) setState("UNAVAILABLE");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    live.current = true;
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
      live.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { roster, state, refresh };
}

function GoalComposer({ detailOpen, onDetailOpenChange }: { detailOpen: boolean; onDetailOpenChange: (open: boolean) => void }) {
  const [goal, setGoal] = useState("");
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<ClientGoalSubmission | null>(null);
  const [journalEntry, setJournalEntry] = useState<ClientGoalJournalEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [readiness, setReadiness] = useState<ClientWorkReadiness | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<ClientAdmissionRecoveryResult | null>(null);
  const operation = useRef<"submit" | "read" | "recovery" | null>(null);
  const mounted = useRef(false);
  const loadSequence = useRef(0);

  const loadLatest = useCallback(async () => {
    const bridge = clientControlBridge();
    if (!bridge?.latestGoal) return;
    const sequence = ++loadSequence.current;
    const latest = await bridge.latestGoal().catch(() => null);
    if (mounted.current && sequence === loadSequence.current && latest?.schema === "metaengine.client.goal-journal-entry.v1") {
      setJournalEntry(latest);
      if (latest.receipt?.schema === "metaengine.client.goal-submission.v1") setReceipt(latest.receipt);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadLatest();
    return () => { mounted.current = false; loadSequence.current += 1; };
  }, [loadLatest]);

  const loadReadiness = useCallback(async () => {
    const bridge = clientControlBridge();
    if (!bridge?.workReadiness) return null;
    const next = await bridge.workReadiness().catch(() => null);
    if (mounted.current && next?.schema === "metaengine.client.work-readiness.v1"
      && next.authority_effect === false && next.automatic_retry_allowed === false) {
      setReadiness(next);
      return next;
    }
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const observe = async () => {
      if (!cancelled) await loadReadiness();
    };
    void observe();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void observe();
    }, 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [loadReadiness]);

  const resumeExecution = useCallback(async () => {
    if (operation.current) return;
    const bridge = clientControlBridge();
    if (!bridge?.resumeAdmission || !bridge?.workReadiness
      || bridge.admission_resume_requires_explicit_user_action !== true
      || bridge.admission_resume_automatic_retry_allowed !== false) {
      setError("Admission recovery bridge unavailable");
      return;
    }
    operation.current = "recovery";
    setRecoveryPending(true);
    setError(null);
    try {
      const result = await bridge.resumeAdmission();
      if (result?.schema !== "metaengine.client.admission-recovery-result.v1"
        || result.automatic_retry_allowed !== false
        || result.retry_requires_new_user_action !== true
        || result.authority_effect !== false) {
        throw new Error("admission_recovery_result_invalid");
      }
      if (mounted.current) setRecoveryResult(result);
      // Success is never inferred from the effect receipt. Re-read the regular
      // work-readiness projection after every explicit recovery action.
      await loadReadiness();
    } catch (cause) {
      if (mounted.current) setError(String((cause as Error)?.message || cause || "admission_recovery_failed").slice(0, 180));
    } finally {
      operation.current = null;
      if (mounted.current) setRecoveryPending(false);
    }
  }, [loadReadiness]);

  const refreshProgress = useCallback(async () => {
    const bridge = clientControlBridge();
    const requestId = receipt?.request_id || journalEntry?.request_id || "";
    if (!bridge?.goalStatus || !requestId || operation.current) return;
    operation.current = "read";
    setRefreshing(true);
    try {
      await bridge.goalStatus(requestId);
      await loadLatest();
      if (mounted.current) setError(null);
    } catch (cause) {
      if (mounted.current) setError(String((cause as Error)?.message || cause || "goal_status_failed").slice(0, 180));
    } finally {
      operation.current = null;
      if (mounted.current) setRefreshing(false);
    }
  }, [journalEntry?.request_id, loadLatest, receipt?.request_id]);

  // Observation only: submitGoal is never called by a timer or recovery path.
  useEffect(() => {
    if (!(receipt?.request_id || journalEntry?.request_id) || (journalEntry?.progress?.terminal && (journalEntry.progress.task_state !== "COMPLETED" || journalEntry.execution_proof?.user_goal_to_result_readback))) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshProgress();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [receipt?.request_id, journalEntry?.request_id, journalEntry?.progress?.terminal, journalEntry?.progress?.task_state, journalEntry?.execution_proof?.user_goal_to_result_readback, refreshProgress]);

  const submit = useCallback(async () => {
    const value = goal.trim();
    if (!value || operation.current || journalEntry?.state === "RECONCILE_REQUIRED" || readiness?.execution_ready === false) return;
    const bridge = clientControlBridge();
    if (!bridge?.submitGoal || bridge.typed_positive_api !== true || bridge.generic_command_exposed !== false) {
      setError("Typed Client control bridge unavailable");
      return;
    }
    operation.current = "submit";
    loadSequence.current += 1;
    setPending(true);
    setError(null);
    try {
      const next = await bridge.submitGoal(value);
      if (next?.schema !== "metaengine.client.goal-submission.v1" || next.exact_activation_readback !== true) {
        throw new Error("goal_readback_invalid");
      }
      if (mounted.current) { setReceipt(next); setJournalEntry(null); setGoal(""); }
      await loadLatest();
    } catch (cause) {
      if (mounted.current) setError(String((cause as Error)?.message || cause || "goal_submit_failed").slice(0, 180));
      // A lost submit response is never retried as an effect. The Browser main
      // process has already attempted one read-only request_id reconciliation;
      // load that durable local correlation record instead.
      await loadLatest();
    } finally {
      operation.current = null;
      if (mounted.current) setPending(false);
    }
  }, [goal, journalEntry?.state, loadLatest, readiness?.execution_ready]);

  const progress = journalEntry?.progress;
  const proof = journalEntry?.execution_proof;
  const labels: Record<string, string> = {
    READY: "Queued", LEASED: "Assigned", RUNNING: "Working", RESULT_READY: "Reviewing result",
    COMPLETED: "Completed · proof pending", BLOCKED: "Blocked", FAILED: "Failed",
    AMBIGUOUS: "Needs reconciliation", FENCED: "Stopped",
  };
  const status = error ? "Check task status"
    : proof?.user_goal_to_result_readback === true ? "Result received"
    : journalEntry?.state === "RECONCILE_REQUIRED" ? "Needs reconciliation"
    : progress?.found ? labels[progress.task_state || ""] || "Awaiting status"
    : receipt ? "Queued · accepted" : "";

  return (
    <section
      className="flex h-[48px] shrink-0 items-center gap-2 overflow-hidden border-b border-zinc-800 bg-[#111114] px-3 py-1.5"
      data-testid="client-goal-composer"
      aria-label="Client goal"
    >
      <label htmlFor="client-goal" className="shrink-0 text-[12px] font-medium text-zinc-300">Task</label>
      <input
        id="client-goal"
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
        maxLength={480}
        disabled={pending || journalEntry?.state === "RECONCILE_REQUIRED"}
        placeholder="Describe the task for your agents…"
        aria-label="User goal"
        data-testid="client-goal-input"
        className="h-8 min-w-0 flex-1 border border-zinc-700 bg-zinc-950 px-2.5 text-[13px] text-zinc-100 placeholder:text-zinc-400 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={pending || refreshing || recoveryPending || !goal.trim() || journalEntry?.state === "RECONCILE_REQUIRED" || readiness?.execution_ready === false}
        data-testid="client-goal-submit"
        className="h-8 shrink-0 border border-cyan-700 bg-cyan-950/50 px-3 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-950 disabled:opacity-40"
      >
        {pending ? "Submitting…" : "Run"}
      </button>
      <span className="min-w-0 max-w-[200px] truncate text-[12px] text-zinc-300" data-testid="client-goal-readback" role="status" aria-live="polite">
        {status}
      </span>
      {readiness ? (
        <span
          className={`min-w-0 max-w-[180px] truncate text-[11px] ${readiness.execution_ready ? "text-emerald-300" : "text-amber-300"}`}
          data-testid="client-work-readiness"
          title={readiness.detail}
        >
          {readiness.label}
        </span>
      ) : null}
      {readiness?.reason === "WORKSPACE_EXECUTION_PAUSED" || recoveryResult?.state === "RECONCILE_REQUIRED" || recoveryResult?.state === "ABSENCE_CONFIRMED" ? (
        <button
          type="button"
          onClick={() => void resumeExecution()}
          disabled={recoveryPending || pending || refreshing}
          data-testid="client-resume-execution"
          className="h-8 shrink-0 border border-amber-700 bg-amber-950/40 px-2.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-950 disabled:opacity-40"
        >
          {recoveryPending ? "Checking…" : recoveryResult?.state === "RECONCILE_REQUIRED" ? "Check recovery" : "Resume execution"}
        </button>
      ) : null}
      {(receipt || journalEntry || error) ? (
        <button type="button" onClick={() => onDetailOpenChange(true)} data-testid="client-goal-details"
          className="h-8 shrink-0 px-2 text-[12px] text-zinc-300 hover:bg-zinc-800">Status</button>
      ) : null}
      {detailOpen ? <Dialog open onOpenChange={onDetailOpenChange}>
        <DialogContent showCloseButton={false} className="mc-dark border-zinc-700 bg-[#111114] text-zinc-100" data-testid="client-goal-status-dialog"
          onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-testid="client-goal-details"]')?.focus(); }}>
          <DialogTitle>Task status</DialogTitle>
          <DialogDescription className="text-zinc-400">{status || "No task submitted"}. A queued task has been accepted for execution. A received result still requires independent verification before acceptance.</DialogDescription>
          {readiness ? <p className="text-[12px] text-zinc-400" data-testid="client-work-readiness-detail">
            Execution: {readiness.label}. {readiness.detail}
          </p> : null}
          {recoveryResult ? <p className="text-[12px] text-amber-200" data-testid="client-admission-recovery-result">
            Recovery: {recoveryResult.confirmed_open ? "workspace open confirmed by fresh readback" : recoveryResult.state.toLowerCase().replaceAll("_", " ")}.
            {recoveryResult.prior_effect_replayed === false ? " No prior effect was replayed." : ""}
          </p> : null}
          <dl className="grid grid-cols-[90px_1fr] gap-2 text-[12px]">
            <dt className="text-zinc-400">Task</dt><dd className="break-all font-mono">{progress?.task_id || receipt?.task_id || "Awaiting readback"}</dd>
            <dt className="text-zinc-400">Request</dt><dd className="break-all font-mono">{journalEntry?.request_id || receipt?.request_id || "Unavailable"}</dd>
            <dt className="text-zinc-400">Agent origin</dt><dd>{proof?.user_goal_to_agent_readback ? "Verified z.ai Agent" : "Not yet verified"}</dd>
            <dt className="text-zinc-400">Result</dt><dd data-testid="client-goal-execution-proof">{proof?.user_goal_to_result_readback ? "Received · review pending" : "No result received"}</dd>
          </dl>
          {error ? <p role="alert" className="break-words text-[12px] text-rose-300">{error}</p> : null}
          <div className="flex justify-end gap-2">
          {(receipt?.request_id || journalEntry?.request_id) ? (
        <button
          type="button"
          onClick={() => void refreshProgress()}
          disabled={pending || refreshing}
          data-testid="client-goal-refresh"
          className="h-8 shrink-0 border border-zinc-800 px-2.5 text-[9px] font-semibold text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-40"
        >
          {refreshing ? "Checking…" : "Refresh status"}
        </button>
          ) : null}
          <button type="button" onClick={() => onDetailOpenChange(false)} className="h-8 border border-zinc-700 px-3 text-[12px]">Close</button>
          </div>
        </DialogContent>
      </Dialog> : null}
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

function ChatFleetRail({ pickerOpen, onPickerOpenChange }: { pickerOpen: boolean; onPickerOpenChange: (open: boolean) => void }) {
  const { roster, state, refresh } = usePrimaryChatRoster();
  const setChatId = useMe2((s) => s.setChatId);
  const attemptedInitial = useRef<string | null>(null);
  const selectionInFlight = useRef(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const query = filter.trim().toLowerCase();
  const visible = roster.actors.filter((actor) => !query || `${actor.role} ${actor.title} ${actor.actor_id}`.toLowerCase().includes(query));
  const supervisors = visible.filter((actor) => actor.actor_type === "SUPERVISOR");
  const agents = visible.filter((actor) => actor.actor_type === "AGENT");
  const ordered = [...supervisors, ...agents];
  const selectedActorId = roster.selected_actor_id;

  const select = useCallback(async (actor: PrimaryChatActor) => {
    if (selectionInFlight.current || state !== "LIVE" || !actor.exact_native_binding) return;
    selectionInFlight.current = true;
    setSelecting(actor.actor_id);
    setSelectionError(null);
    try {
      const agentId = actor.actor_id.startsWith("agent:") ? actor.actor_id.slice("agent:".length) : "";
      const result = actor.actor_type === "AGENT"
        ? await clientControlBridge()?.selectAgent?.(agentId)
        : await shellBridge()?.selectPrimaryChatActor?.(actor.actor_id);
      if (result?.selection_applied !== true || result.exact_native_binding !== true || result.actor_id !== actor.actor_id || result.tab_id !== actor.tab_id) {
        throw new Error("selection_not_confirmed");
      }
      // Selection changes only after an exact native acknowledgement, never
      // optimistically before IPC. The roster owns the visible current row.
      setChatId(actor.actor_id);
      onPickerOpenChange(false);
      await refresh();
    } catch {
      setSelectionError("Agent selection was not confirmed. Refresh the roster before trying again.");
      await refresh();
    } finally {
      selectionInFlight.current = false;
      setSelecting(null);
    }
  }, [onPickerOpenChange, refresh, setChatId, state]);

  // One bounded startup choice only when Browser has no selected managed actor.
  // No retry loop: exact binding must already exist for selection to succeed.
  useEffect(() => {
    if (state !== "LIVE" || roster.selected_actor_id || roster.actors.length === 0) return;
    const first = roster.actors.find((actor) => actor.exact_native_binding);
    if (!first || attemptedInitial.current === first.actor_id) return;
    attemptedInitial.current = first.actor_id;
    void select(first);
  }, [roster.actors, roster.selected_actor_id, select, state]);

  const section = (title: string, rows: PrimaryChatActor[]) => (
    <section className="space-y-1" aria-label={title}>
      <div className="flex items-center justify-between px-3 py-2 text-[11px] font-medium text-zinc-400">
        <span>{title}</span><span>{rows.length}</span>
      </div>
      {rows.map((actor) => {
        const selected = selectedActorId === actor.actor_id;
        return (
          <button
            key={actor.actor_id}
            type="button"
            onClick={() => void select(actor)}
            disabled={selecting !== null || state !== "LIVE" || !actor.exact_native_binding}
            data-testid={actor.actor_type === "SUPERVISOR" ? "chat-supervisor-row" : "chat-agent-row"}
            data-actor-id={actor.actor_id}
            aria-current={selected ? "page" : undefined}
            className={`group flex w-full items-center gap-2 border-l-2 px-3 py-3 text-left disabled:cursor-default disabled:opacity-60 ${
              selected
                ? "border-cyan-400 bg-cyan-950/20 text-zinc-100"
                : "border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/70 hover:text-zinc-200"
            }`}
            title={`${actor.title || actor.role} · ${actor.actor_id}${actor.exact_native_binding ? "" : " · native binding not yet verified"}`}
          >
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-[13px] font-medium">
                {actor.actor_type === "SUPERVISOR" ? "Supervisor" : actor.role.toLowerCase().replace(/^./, (letter) => letter.toUpperCase())}
              </strong>
              <small className="block truncate font-mono text-[11px] text-zinc-400" data-testid="chat-actor-short-id">
                {actor.actor_id.split(":").at(-1)?.slice(0, 18) || actor.actor_id.slice(0, 18)}
              </small>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
              <i aria-hidden className={`h-1.5 w-1.5 rounded-full ${actorTone(actor)}`} />
              {selecting === actor.actor_id ? "Opening…" : actor.state.toLowerCase().replaceAll("_", " ")}
            </span>
          </button>
        );
      })}
    </section>
  );

  const content = <>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
        <div><strong className="block text-[13px] font-medium text-zinc-200">Agents</strong>
          <span className="text-[11px] text-zinc-400">GLM-5.3-Flash · {state === "LIVE" ? `${roster.actor_count} sessions` : state === "LOADING" ? "Connecting…" : "Roster unavailable"}</span></div>
        <button type="button" onClick={() => void refresh()} className="h-8 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800">Refresh</button>
      </div>
      <div className="shrink-0 p-3"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find an agent…"
        aria-label="Filter chat agents" className="h-8 w-full border border-zinc-700 bg-zinc-950 px-2 text-[12px] text-zinc-200" /></div>
      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto pb-3">
        {state === "LOADING" && ordered.length === 0 ? <p role="status" className="px-3 py-4 text-[12px] text-zinc-400">Connecting to the Browser…</p> : null}
        {state === "UNAVAILABLE" ? <p role="status" className="px-3 py-4 text-[12px] text-amber-300">The Browser roster is unavailable. Refresh to reconnect.{roster.actor_count ? " Previous agents are shown below." : ""}</p> : null}
        {selectionError ? <p role="alert" className="px-3 pb-3 text-[12px] text-amber-300">{selectionError}</p> : null}
        {state === "LIVE" && ordered.length === 0 ? <p className="px-3 py-4 text-[12px] text-zinc-400">{query ? "No matching agents." : "No connected agents. Check Supervisor in Settings to see fleet readiness."}</p> : null}
        {supervisors.length ? section("Supervisors", supervisors) : null}
        {agents.length ? section("Agents", agents) : null}
      </div>
    </>;

  return <>
    <aside
      className="flex h-full min-h-0 w-[288px] shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-[#111114] max-[1007px]:hidden"
      data-testid="chat-fleet-rail"
      aria-label="Chat agents and supervisors"
    >
      {content}
    </aside>
    {pickerOpen ? <Dialog open onOpenChange={onPickerOpenChange}>
      <DialogContent id="fleet-picker" showCloseButton={false} data-testid="fleet-picker" className="mc-dark flex h-[min(600px,85vh)] flex-col gap-0 border-zinc-700 bg-[#111114] p-0 text-zinc-200"
        onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-testid="fleet-picker-toggle"]')?.focus(); }}>
        <div className="flex items-center justify-between px-3 pt-3"><DialogTitle className="text-[14px]">Choose an agent</DialogTitle>
          <button type="button" onClick={() => onPickerOpenChange(false)} className="h-8 px-2 text-[12px]">Close</button></div>
        <DialogDescription className="px-3 pb-2 text-[12px] text-zinc-400">Open an existing z.ai Agent conversation.</DialogDescription>
        {content}
      </DialogContent>
    </Dialog> : null}
  </>;
}

function PrimaryChatFleetWorkspace({ pickerOpen, onPickerOpenChange }: { pickerOpen: boolean; onPickerOpenChange: (open: boolean) => void }) {
  return (
    <div
      className="flex h-full min-h-0 min-w-0 overflow-hidden bg-[#09090b]"
      data-testid="primary-chat-fleet"
    >
      <ChatFleetRail pickerOpen={pickerOpen} onPickerOpenChange={onPickerOpenChange} />
      <section
        className="relative min-w-0 flex-1 overflow-hidden bg-black"
        data-testid="native-chat-surface-slot"
        aria-label="Selected chat agent website"
      >
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-zinc-400">
          <div><h1 className="mb-2 text-[18px] font-medium text-zinc-200">Your agent workspace</h1><p>Select an agent to view its conversation.</p></div>
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
  const overlayScope = useMe2((s) => s.recentPages);
  const [fleetPickerScope, setFleetPickerScope] = useState<typeof overlayScope | null>(null);
  const [goalDetailScope, setGoalDetailScope] = useState<typeof overlayScope | null>(null);
  const fleetPickerOpen = page === "browser" && fleetPickerScope === overlayScope;
  const goalDetailOpen = page === "browser" && goalDetailScope === overlayScope;
  const setFleetPickerOpen = useCallback((open: boolean) => setFleetPickerScope(open ? overlayScope : null), [overlayScope]);
  const setGoalDetailOpen = useCallback((open: boolean) => setGoalDetailScope(open ? overlayScope : null), [overlayScope]);
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
  const nativeOverlayOpen = Boolean(paletteOpen || overlaysOpen || peekTarget || chromeOverlaySources.length > 0 || fleetPickerOpen || goalDetailOpen);

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
      <TopBar fleetPickerOpen={fleetPickerOpen} onOpenFleet={() => setFleetPickerOpen(true)} />
      {mainWorkspace ? <GoalComposer detailOpen={goalDetailOpen} onDetailOpenChange={setGoalDetailOpen} /> : null}
      <main
        className={mainWorkspace ? "min-h-0 min-w-0 flex-1 overflow-hidden" : "min-h-0 min-w-0 flex-1 overflow-auto p-1.5"}
        data-testid="page-outlet"
        data-page={page}
      >
        {mainWorkspace ? <PrimaryChatFleetWorkspace pickerOpen={fleetPickerOpen} onPickerOpenChange={setFleetPickerOpen} /> : <Suspense fallback={<p role="status" className="p-6 text-[13px] text-zinc-400">Opening tools…</p>}><PageOutlet page={page} /></Suspense>}
      </main>
      {paletteOpen ? <CommandPalette /> : null}
      {overlaysOpen ? <GlobalDialogs /> : null}
    </div>
  );
}
