"use client";
// R97 primary shell: one persistent workspace.
// Left: canonical live chat actors (supervisors first, then fleet agents).
// Right: the exact native Browser WebContents selected by Browser main.
// Advanced pages remain available only through Settings / command search.

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useMe2, type PageKey } from "@/components/me2/store";
import { useToast } from "@/hooks/use-toast";
import { refreshClientRuntimeStatus, useClientRuntimeStatus } from "@/hooks/use-client-runtime-status";
import { TopBar } from "@/components/me2/shell/topbar";
import { CommandPalette } from "@/components/me2/shell/command-palette";
import { InterruptedSetupRecovery } from "@/components/me2/interrupted-setup-recovery";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
const CodePage = lazy(() => import("@/components/me2/pages/code").then((m) => ({ default: m.CodePage })));
const TasksPage = lazy(() => import("@/components/me2/pages/tasks").then((m) => ({ default: m.TasksPage })));
const OperatorObservatoryPage = lazy(() => import("@/components/me2/pages/operator-observatory").then((m) => ({ default: m.OperatorObservatoryPage })));
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
  recovery_required?: boolean;
  recovery_reason?: string | null;
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

type NativeGoalAdmission={
  schema:"metaengine.native-coding.goal-admission.v1";state:"ADMITTED";request_id:string;objective:string;
  profile_id:string;profile_sha256:string;workspace_id:string;project_id:string;root_task_id:string;goal_id:string;goal_sha256:string;
  task_spec_sha256:string;permit_ids:string[];logical_policy:{max_depth:number|null;max_tasks:number|null;max_children:number|null};
  physical_execution_proven:false;global_actuation_granted:false;production_qualified:false;automatic_retry_allowed:false;authority_effect:false;
};
type GoalSubmissionMode={schema:"metaengine.client.goal-submission-mode.v1";kind:"NATIVE_CODING"|"BROWSER"|"UNAVAILABLE";
  state:"HOST_VERIFICATION_REQUIRED"|"HOLD";reason:string|null;project_id?:string|null;automatic_retry_allowed:false;authority_effect:false};
type GoalReceipt=ClientGoalSubmission|NativeGoalAdmission;

type ClientGoalProgress = {
  schema: "metaengine.client.goal-progress.v1"|"metaengine.client.native-coding-goal-progress.v1";
  request_id: string;
  found: boolean;
  task_id?: string;
  task_state?: "READY" | "LEASED" | "RUNNING" | "RESULT_READY" | "BLOCKED" | "COMPLETED" | "FAILED" | "AMBIGUOUS" | "FENCED";
  terminal: boolean;
  reconciliation_required: boolean;
  automatic_retry_allowed: false;
  authority_effect: false;
  project_id?:string;project_state?:string;total_tasks?:number;last_seq?:number;observed_at?:string;source?:"OWN_PG_PROJECT_SNAPSHOT";
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
  kind?:"BROWSER"|"NATIVE_CODING";
  goal: string;
  state: string;
  receipt: GoalReceipt | null;
  progress: ClientGoalProgress | null;
  execution_proof: ClientGoalExecutionProof | null;
  last_error: string | null;
  project_error?:string|null;
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
  submitGoal?: (goal: string) => Promise<GoalReceipt>;
  goalSubmissionMode?:()=>Promise<GoalSubmissionMode>;
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
  const setPage = useMe2((s) => s.setPage);
  const [goal, setGoal] = useState("");
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<GoalReceipt | null>(null);
  const [goalMode,setGoalMode]=useState<GoalSubmissionMode|null>(null);
  const [journalEntry, setJournalEntry] = useState<ClientGoalJournalEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const nativeRuntime = useClientRuntimeStatus();
  const readiness = nativeRuntime.readback?.work || null;
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<ClientAdmissionRecoveryResult | null>(null);
  const operation = useRef<"submit" | "read" | "recovery" | null>(null);
  const mounted = useRef(false);
  const loadSequence = useRef(0);
  const modeReadInFlight=useRef(false);

  const loadLatest = useCallback(async () => {
    const bridge = clientControlBridge();
    if (!bridge?.latestGoal) return;
    const sequence = ++loadSequence.current;
    const latest = await bridge.latestGoal().catch(() => null);
    if (mounted.current && sequence === loadSequence.current && latest?.schema === "metaengine.client.goal-journal-entry.v1") {
      setJournalEntry(latest);
      if (latest.receipt?.schema === "metaengine.client.goal-submission.v1"||latest.receipt?.schema === "metaengine.native-coding.goal-admission.v1") setReceipt(latest.receipt);
    }
  }, []);

  useEffect(() => {
    let current = true;
    mounted.current = true;
    queueMicrotask(() => { if (current) void loadLatest(); });
    return () => { current = false; mounted.current = false; loadSequence.current += 1; };
  }, [loadLatest]);

  // Reuse the existing runtime observation cadence; no goal effect is polled.
  useEffect(()=>{
    if(modeReadInFlight.current)return;
    let current=true;const read=clientControlBridge()?.goalSubmissionMode;
    if(read){modeReadInFlight.current=true;void read().then(mode=>{if(current)setGoalMode(mode);}).catch(()=>{})
      .finally(()=>{modeReadInFlight.current=false;});}
    return()=>{current=false;};
  },[nativeRuntime.state,readiness?.observed_at]);

  const loadReadiness = useCallback(async () => {
    const current = await refreshClientRuntimeStatus();
    return current.state === "LIVE" ? current.readback?.work || null : null;
  }, []);

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
      if(bridge.goalSubmissionMode){const mode=await bridge.goalSubmissionMode();if(mounted.current)setGoalMode(mode);}
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
    if(journalEntry?.kind==="NATIVE_CODING"&&journalEntry.progress?.terminal)return;
    if (!(receipt?.request_id || journalEntry?.request_id) || (journalEntry?.progress?.terminal && (journalEntry.progress.task_state !== "COMPLETED" || journalEntry.execution_proof?.user_goal_to_result_readback))) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshProgress();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [receipt?.request_id, journalEntry?.request_id,journalEntry?.kind, journalEntry?.progress?.terminal, journalEntry?.progress?.task_state, journalEntry?.execution_proof?.user_goal_to_result_readback, refreshProgress]);

  const submit = useCallback(async () => {
    const value = goal.trim();
    if (!value || operation.current || journalEntry?.state === "RECONCILE_REQUIRED") return;
    const bridge = clientControlBridge();
    if (!bridge?.submitGoal || !bridge?.workReadiness || !bridge.goalSubmissionMode || bridge.typed_positive_api !== true || bridge.generic_command_exposed !== false) {
      setError("Typed Client control bridge unavailable");
      return;
    }
    operation.current = "submit";
    loadSequence.current += 1;
    setPending(true);
    setError(null);
    try {
      // Cached readiness is presentation-only. A user submit always performs a
      // fresh typed read immediately before the effect so stale READY cannot
      // authorize work and stale BLOCKED cannot indefinitely suppress a later
      // valid submit. No submit occurs when the fresh read is unavailable.
      const mode=await bridge.goalSubmissionMode();
      if(mode?.schema!=="metaengine.client.goal-submission-mode.v1"||mode.authority_effect!==false||mode.automatic_retry_allowed!==false
        ||mode.state!=="HOST_VERIFICATION_REQUIRED"||!["BROWSER","NATIVE_CODING"].includes(mode.kind))throw new Error(mode?.reason||"Goal admission unavailable");
      if(mounted.current)setGoalMode(mode);
      if(mode.kind==="BROWSER"){
        const freshReadiness = await loadReadiness();
        if (!freshReadiness?.execution_ready) {
          setError(freshReadiness?.detail || "Execution readiness unavailable");
          return;
        }
      }
      const next = await bridge.submitGoal(value);
      if (mode.kind==="NATIVE_CODING"?next?.schema!=="metaengine.native-coding.goal-admission.v1"||next.state!=="ADMITTED"
        ||next.physical_execution_proven!==false||next.production_qualified!==false||next.authority_effect!==false
        :next?.schema !== "metaengine.client.goal-submission.v1" || next.exact_activation_readback !== true) {
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
  }, [goal, journalEntry?.state, loadLatest, loadReadiness]);

  const progress = journalEntry?.progress;
  const nativeReceipt=receipt?.schema==="metaengine.native-coding.goal-admission.v1"?receipt:null;
  const browserReceipt=receipt?.schema==="metaengine.client.goal-submission.v1"?receipt:null;
  const isNative=journalEntry?.kind==="NATIVE_CODING"||Boolean(nativeReceipt)||goalMode?.kind==="NATIVE_CODING";
  const proof = journalEntry?.execution_proof;
  const labels: Record<string, string> = {
    READY: "Queued", LEASED: "Assigned", RUNNING: "Working", RESULT_READY: "Reviewing result",
    COMPLETED: "Completed · proof pending", BLOCKED: "Blocked", FAILED: "Failed",
    AMBIGUOUS: "Needs reconciliation", FENCED: "Stopped",
  };
  const status = error ? "Check task status"
    : proof?.user_goal_to_result_readback === true ? "Result received"
    : journalEntry?.state === "RECONCILE_REQUIRED" ? "Needs reconciliation"
    : isNative&&journalEntry?.project_error?"Native observation unavailable"
    : isNative&&progress?.found&&progress.task_state==="COMPLETED"?`Root completed · project ${progress.project_state?.toLowerCase()||"unknown"}`
    : progress?.found ? labels[progress.task_state || ""] || "Awaiting status"
    : nativeReceipt?"Native goal admitted · execution pending"
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
        className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder:text-zinc-400 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={pending || refreshing || recoveryPending || !goal.trim() || journalEntry?.state === "RECONCILE_REQUIRED"||goalMode?.state==="HOLD"}
        data-testid="client-goal-submit"
        className="mc-soft-action h-8 shrink-0 rounded-lg px-4 text-[12px] font-medium disabled:opacity-40"
      >
        {pending ? "Submitting…" : "Run"}
      </button>
      <span className="min-w-0 max-w-[200px] truncate text-[12px] text-zinc-300" data-testid="client-goal-readback" role="status" aria-live="polite" title={status}>
        {status}
      </span>
      {isNative ? <span className="min-w-0 max-w-[180px] truncate text-[11px] text-zinc-300" data-testid="client-native-goal-mode">
        {goalMode?.reason==="NATIVE_PROFILE_BUSY"?"Current native project is active":goalMode?.state==="HOLD"?"Native admission on hold":"Native coding · Host admission"}
      </span> : readiness ? (
        <span
          className={`min-w-0 max-w-[180px] truncate text-[11px] ${readiness.execution_ready ? "text-emerald-300" : "text-amber-300"}`}
          data-testid="client-work-readiness"
          title={readiness.detail}
        >
          {readiness.label}
        </span>
      ) : null}
      {goalMode?.reason==="NATIVE_PROFILE_BUSY"?<button type="button" onClick={()=>setPage("tasks")}
        className="h-8 shrink-0 px-2.5 text-[12px] text-zinc-300" data-testid="client-native-current-project">View current project</button>:null}
      {!isNative&&(readiness?.reason === "SUPERVISOR_RECOVERY_REQUIRED" || readiness?.reason === "AGENT_ORIGIN_UNPROVEN") ? (
        <button type="button" onClick={() => setPage("operator")} className="h-8 shrink-0 px-2.5 text-[12px] text-amber-200" data-testid="client-inspect-sessions">View runtime status</button>
      ) : null}
      {!isNative&&(readiness?.reason === "WORKSPACE_EXECUTION_PAUSED" || recoveryResult?.state === "RECONCILE_REQUIRED" || recoveryResult?.state === "ABSENCE_CONFIRMED") ? (
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
      {(receipt || journalEntry || error || (readiness && !readiness.execution_ready)) ? (
        <button type="button" onClick={() => onDetailOpenChange(true)} data-testid="client-goal-details"
          className="h-8 shrink-0 px-2 text-[12px] text-zinc-300 hover:bg-zinc-800">Status</button>
      ) : null}
      {detailOpen ? <Dialog open onOpenChange={onDetailOpenChange}>
        <DialogContent showCloseButton={false} className="mc-dark max-h-[85vh] overflow-y-auto border-zinc-700 bg-[#111114] text-zinc-100" data-testid="client-goal-status-dialog"
          onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-testid="client-goal-details"]')?.focus(); }}>
          <DialogTitle>Task status</DialogTitle>
          <DialogDescription className="text-zinc-400">{status || "No task submitted"}. {isNative?"Admission records a native project and task. Execution, independent review, checkpoint and continuation require separate runtime evidence.":"A queued task has been accepted for execution. A received result still requires independent verification before acceptance."}</DialogDescription>
          {!isNative&&readiness ? <p className="text-[12px] text-zinc-400" data-testid="client-work-readiness-detail">
            Execution: {readiness.label}. {readiness.detail}
          </p> : null}
          {readiness?.reason === "SUPERVISOR_RECOVERY_REQUIRED" ? <InterruptedSetupRecovery /> : null}
          {recoveryResult ? <p className="text-[12px] text-amber-200" data-testid="client-admission-recovery-result">
            Recovery: {recoveryResult.confirmed_open ? "workspace open confirmed by fresh readback" : recoveryResult.state.toLowerCase().replaceAll("_", " ")}.
            {recoveryResult.prior_effect_replayed === false ? " No prior effect was replayed." : ""}
          </p> : null}
          <dl className="grid grid-cols-[90px_1fr] gap-2 text-[12px]">
            <dt className="text-zinc-400">Task</dt><dd className="break-all font-mono">{progress?.task_id || nativeReceipt?.root_task_id || browserReceipt?.task_id || "Awaiting readback"}</dd>
            <dt className="text-zinc-400">Request</dt><dd className="break-all font-mono">{journalEntry?.request_id || receipt?.request_id || "Unavailable"}</dd>
            {isNative?<><dt className="text-zinc-400">Project</dt><dd className="break-all font-mono" data-testid="client-native-goal-project">{nativeReceipt?.project_id||"Awaiting admission"}</dd>
              <dt className="text-zinc-400">Observed</dt><dd data-testid="client-native-goal-progress">{progress?.schema==="metaengine.client.native-coding-goal-progress.v1"?`${progress.project_state||"Unknown"} · ${progress.total_tasks??0} tasks · sequence ${progress.last_seq??0}`:"No project execution observation"}</dd>
              {progress?.observed_at?<><dt className="text-zinc-400">Read at</dt><dd>{progress.observed_at}</dd></>:null}
              {journalEntry?.project_error?<><dt className="text-amber-300">Observation</dt><dd className="text-amber-200">{journalEntry.project_error}; previous progress may be stale</dd></>:null}
              <dt className="text-zinc-400">Admission</dt><dd>Execution proof is separate from admission</dd></>
              :<><dt className="text-zinc-400">Agent origin</dt><dd>{proof?.user_goal_to_agent_readback ? "Verified ChatGPT Agent" : "Not yet verified"}</dd>
              <dt className="text-zinc-400">Result</dt><dd data-testid="client-goal-execution-proof">{proof?.user_goal_to_result_readback ? "Received · review pending" : "No result received"}</dd></>}
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
    case "operator": return <OperatorObservatoryPage />;
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
  const setPage = useMe2((s) => s.setPage);
  const { roster, state, refresh } = usePrimaryChatRoster();
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
      const result = actor.actor_type === "AGENT" && !actor.recovery_required
        ? await clientControlBridge()?.selectAgent?.(agentId)
        : await shellBridge()?.selectPrimaryChatActor?.(actor.actor_id);
      if (result?.selection_applied !== true || result.exact_native_binding !== true || result.actor_id !== actor.actor_id || result.tab_id !== actor.tab_id) {
        throw new Error("selection_not_confirmed");
      }
      // Selection changes only after an exact native acknowledgement, never
      // optimistically before IPC. The roster owns the visible current row.
      onPickerOpenChange(false);
      await refresh();
    } catch {
      setSelectionError("Agent selection was not confirmed. Refresh the roster before trying again.");
      await refresh();
    } finally {
      selectionInFlight.current = false;
      setSelecting(null);
    }
  }, [onPickerOpenChange, refresh, state]);

  // One bounded startup choice only when Browser has no selected managed actor.
  // No retry loop: exact binding must already exist for selection to succeed.
  useEffect(() => {
    if (state !== "LIVE" || roster.selected_actor_id || roster.actors.length === 0) return;
    const first = roster.actors.find((actor) => actor.exact_native_binding && !actor.recovery_required);
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
              <small className="block truncate text-[11px] text-zinc-400" data-testid="chat-actor-short-id" title={actor.actor_id}>
                {actor.title || actor.model || "ChatGPT session"}
              </small>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
              <i aria-hidden className={`h-1.5 w-1.5 rounded-full ${actorTone(actor)}`} />
              {selecting === actor.actor_id ? "Opening…" : actor.recovery_required ? "Check session" : actor.state.toLowerCase().replaceAll("_", " ")}
            </span>
          </button>
        );
      })}
    </section>
  );

  const content = <>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
        <div><strong className="block text-[13px] font-medium text-zinc-200">Agents</strong>
          <span className="text-[11px] text-zinc-400">ChatGPT · {state === "LIVE" ? `${roster.actor_count} sessions` : state === "LOADING" ? "Connecting…" : "Roster unavailable"}</span></div>
        <button type="button" onClick={() => void refresh()} className="h-8 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800">Refresh</button>
      </div>
      <div className="shrink-0 p-3"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find an agent…"
        aria-label="Filter chat agents" className="h-8 w-full border border-zinc-700 bg-zinc-950 px-2 text-[12px] text-zinc-200" /></div>
      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto pb-3">
        {state === "LOADING" && ordered.length === 0 ? <p role="status" className="px-3 py-4 text-[12px] text-zinc-400">Connecting to the Browser…</p> : null}
        {state === "UNAVAILABLE" ? <p role="status" className="px-3 py-4 text-[12px] text-amber-300">The Browser roster is unavailable. Refresh to reconnect.{roster.actor_count ? " Previous agents are shown below." : ""}</p> : null}
        {selectionError ? <p role="alert" className="px-3 pb-3 text-[12px] text-amber-300">{selectionError}</p> : null}
        {state === "LIVE" && ordered.length === 0 ? <div className="mx-3 rounded-xl bg-zinc-900/70 p-4 text-[13px] leading-relaxed text-zinc-400">
          <p>{query ? "No matching agents." : "No verified sessions are available yet."}</p>
          {!query ? <><p className="mt-2">Check agent setup and any interrupted connections.</p><button type="button" onClick={() => setPage("operator")} className="mt-3 min-h-8 px-2 text-[12px] text-cyan-200">View agent status</button></> : null}
        </div> : null}
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
        <DialogDescription className="px-3 pb-2 text-[12px] text-zinc-400">Open an existing ChatGPT agent conversation.</DialogDescription>
        {content}
      </DialogContent>
    </Dialog> : null}
  </>;
}

function PrimaryChatFleetWorkspace({ pickerOpen, onPickerOpenChange }: { pickerOpen: boolean; onPickerOpenChange: (open: boolean) => void }) {
  const setPage = useMe2((s) => s.setPage);
  return (
    <div
      className="flex h-full min-h-0 min-w-0 overflow-hidden bg-[#09090b]"
      data-testid="primary-chat-fleet"
    >
      <ChatFleetRail pickerOpen={pickerOpen} onPickerOpenChange={onPickerOpenChange} />
      <section
        className="relative min-w-0 flex-1 overflow-hidden bg-[#09090b]"
        data-testid="native-chat-surface-slot"
        aria-label="Selected chat agent website"
      >
        <div className="absolute inset-0 grid place-items-center p-8 text-center text-[13px] text-zinc-400">
          <div className="max-w-[420px]"><h1 className="mb-3 text-[24px] font-medium tracking-tight text-zinc-200">A place for your next task</h1><p className="leading-relaxed">Describe what you want to build, or choose an agent conversation from the sidebar. Your projects and history stay on this computer.</p>
            <div className="mt-5 flex justify-center gap-2"><button type="button" onClick={() => setPage("tasks")} className="mc-soft-action min-h-9 px-4 text-[13px]">Projects and tasks</button><button type="button" onClick={() => setPage("operator")} className="min-h-9 px-4 text-[13px]">Agent status</button></div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function Me2Shell() {
  const page = useMe2((s) => s.page);
  const init = useMe2((s) => s.init);
  const paletteOpen = useMe2((s) => s.paletteOpen);
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

  const nativeOverlayOpen = Boolean(paletteOpen || fleetPickerOpen || goalDetailOpen);

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
        className={mainWorkspace ? "min-h-0 min-w-0 flex-1 overflow-hidden" : "min-h-0 min-w-0 flex-1 overflow-auto p-5 sm:p-6"}
        data-testid="page-outlet"
        data-page={page}
      >
        {mainWorkspace ? <PrimaryChatFleetWorkspace pickerOpen={fleetPickerOpen} onPickerOpenChange={setFleetPickerOpen} /> : <Suspense fallback={<p role="status" className="p-6 text-[13px] text-zinc-400">Opening tools…</p>}><PageOutlet page={page} /></Suspense>}
      </main>
      {paletteOpen ? <CommandPalette /> : null}
    </div>
  );
}
