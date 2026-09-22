"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LiveDot, StatusBadge } from "@/components/mc/badges";
import { shortId, timeAgo, formatMs } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import { toast } from "sonner";
import {
  Activity, Bot, Chrome, GaugeCircle, RefreshCw, Target, Users, X,
} from "lucide-react";

interface LiveAgent {
  agentId: string;
  role: string;
  lifecycleState: string;
  tabId: string | null;
  ownership: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  provenAt: string | null;
  lostReason: string | null;
}

interface LiveTab {
  tabId: string | null;
  kind: string | null;
  title: string | null;
  url: string | null;
}

export interface LiveSnapshot {
  clientId: string;
  lastSeenAt: string;
  heartbeatMs: number;
  shellVersion: string | null;
  armed: boolean;
  supervisorMode: string | null;
  controlPlane?: {
    schema: string;
    batchTransport: string | null;
    leaseLastAttemptAt: string | null;
    leaseLastOkAt: string | null;
    leaseConsecutiveFailures: number | null;
    leaseLastError: string | null;
    cycleRunning: boolean | null;
    cycleAgeMs: number | null;
    schedulerWatchdogRearmCount: number | null;
    wedgeEscalation: { reason: string; at: string | null } | null;
    pumpHealth: "ok" | "stalled" | "failing" | null;
    pumpNote: string | null;
  } | null;
  selfUpdate: {
    state: string | null;
    startupRecovery: { state: string; reason: string | null; targetGitSha: string | null } | null;
  };
  fleet: {
    bootFleetTarget: number | null;
    desiredAgents: number | null;
    profile: string | null;
    warmAgents: number | null;
    elastic: boolean;
    liveAgents: number;
    byLifecycle: Record<string, number>;
    byRole: Record<string, number>;
    agents: LiveAgent[];
  };
  tabs: { total: number; byKind: Record<string, number>; items: LiveTab[] };
  devos?: {
    lastError: string | null;
    idleLastError: string | null;
    idleLastAt: string | null;
    idleInFlight: boolean;
    executionMode: string | null;
    admissionState: string | null;
    actuationAllowed: boolean;
    generationFloor: number | null;
    toolbeltRequests: number | null;
    dispatch?: {
      lastState: string;
      lastStage: string | null;
      lastEffectState: string | null;
      lastReason: string | null;
      lastTaskId: string | null;
      lastAgentId: string | null;
      lastAt: string | null;
      lastComposerChars: number | null;
      dispatches: number | null;
      proven: number | null;
      ambiguous: number | null;
      seedAttempts: number | null;
      seedProven: number | null;
      flushOverLimit: number | null;
    } | null;
  };
}

interface LivePayload {
  ok: boolean;
  configured?: boolean;
  plane?: "cloud" | "local-pigsty";
  planeNote?: string;
  live: LiveSnapshot | null;
  error?: string;
  at?: string;
  stale?: boolean;
  staleMs?: number;
  staleAt?: string;
}

interface CmdResult {
  ok: boolean;
  action: string;
  commandId: string;
  status: string;
  result: Record<string, unknown> | null;
  error?: string;
}

function lifecycleTone(s: string): string {
  switch (s) {
    case "ACTIVE": return "text-emerald-300 border-emerald-800/60";
    case "BOUND_UNVERIFIED": return "text-amber-300 border-amber-800/60";
    case "LOST": return "text-rose-300 border-rose-800/60";
    case "RETIRED": return "text-zinc-500 border-zinc-700";
    default: return "text-zinc-400 border-zinc-700";
  }
}

function heartbeatTone(ms: number): { label: string; cls: string; dot: boolean } {
  if (ms < 30_000) return { label: "LIVE", cls: "text-emerald-300", dot: true };
  if (ms < 120_000) return { label: "STALE", cls: "text-amber-300", dot: false };
  return { label: "OFFLINE?", cls: "text-rose-300", dot: false };
}

const ROLE_STYLES: Record<string, string> = {
  PLANNER: "text-sky-300 border-sky-800/60",
  RESEARCHER: "text-violet-300 border-violet-800/60",
  IMPLEMENTER: "text-emerald-300 border-emerald-800/60",
  CRITIC: "text-amber-300 border-amber-800/60",
  FALSIFIER: "text-rose-300 border-rose-800/60",
  SYNTHESIZER: "text-teal-300 border-teal-800/60",
  CLOSER: "text-zinc-300 border-zinc-700",
};

export function LivePanel({ poll }: { poll: PollState<LivePayload> }) {
  const d = poll.data;
  const live = d?.live ?? null;
  const [target, setTarget] = useState("10");
  const [busy, setBusy] = useState<"" | "target" | `close:${string}`>("");
  const [lastCmd, setLastCmd] = useState<CmdResult | null>(null);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);

  const hb = live ? heartbeatTone(live.heartbeatMs) : null;

  async function setFleetTarget(n: number) {
    setBusy("target");
    try {
      const res = await fetch("/api/live/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "FLEET_RECONCILE", payload: { active: true, target_agents: n } }),
      });
      const json = (await res.json()) as CmdResult;
      setLastCmd(json);
      if (json.ok) {
        toast.success(`Fleet target → ${n}`, { description: `${json.action} ${json.commandId} · ${json.status}` });
        void poll.refresh();
      } else {
        toast.error(`Reconcile ${json.status}`, { description: json.error ?? "browser did not complete in time" });
      }
    } catch (e) {
      toast.error("Command failed", { description: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy("");
    }
  }

  async function closeTab(tabId: string) {
    setBusy(`close:${tabId}`);
    try {
      const res = await fetch("/api/live/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "CLOSE_TAB", payload: { tab_id: tabId } }),
      });
      const json = (await res.json()) as CmdResult;
      setLastCmd(json);
      if (json.ok) {
        toast.success("Tab closed", { description: `${shortId(tabId, 12)} · ${json.status}` });
        setConfirmClose(null);
        void poll.refresh();
      } else {
        toast.error(`Close ${json.status}`, { description: json.error ?? "no receipt" });
      }
    } finally {
      setBusy("");
    }
  }

  const f = live?.fleet;
  const cp = live?.controlPlane ?? null;

  return (
    <div className="space-y-4" data-testid="live-panel">
      {/* CP-W1 control-plane divergence banner: heartbeat alive is NOT pump alive */}
      {cp && (cp.pumpHealth === "stalled" || cp.pumpHealth === "failing") && (
        <Card
          className={`border bg-zinc-900/60 ${cp.pumpHealth === "stalled" ? "border-red-800/70" : "border-amber-800/70"}`}
          data-testid="control-plane-banner"
        >
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
            <span className={`font-mono text-xs font-bold tracking-[0.18em] ${cp.pumpHealth === "stalled" ? "text-red-400" : "text-amber-400"}`}>
              {cp.pumpHealth === "stalled" ? "CONTROL PLANE STALLED" : "LEASE PUMP DEGRADED"}
            </span>
            <span className="font-mono text-[11px] text-zinc-400">{cp.pumpNote}</span>
            {cp.wedgeEscalation && (
              <Badge variant="outline" className="border-red-800/60 bg-red-500/10 font-mono text-[9px] text-red-300">
                ESCALATION {cp.wedgeEscalation.reason}
              </Badge>
            )}
            <span className="font-mono text-[10px] text-zinc-600">
              transport={cp.batchTransport ?? "?"} · failures={cp.leaseConsecutiveFailures ?? "?"} · rearm={cp.schedulerWatchdogRearmCount ?? "?"}
            </span>
          </CardContent>
        </Card>
      )}
      {/* heartbeat strip */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
          <div className="flex items-center gap-2" data-testid="live-heartbeat">
            {hb ? (
              <>
                <LiveDot ok={hb.dot} pulse={hb.dot} />
                <span className={`font-mono text-xs font-bold tracking-[0.18em] ${hb.cls}`}>{hb.label}</span>
                <span className="font-mono text-[10px] text-zinc-600">heartbeat {formatMs(live!.heartbeatMs)} ago</span>
                {d?.plane === "local-pigsty" && (
                  <Badge
                    variant="outline"
                    title={d?.planeNote ?? "supervisor state served from the local Pigsty replica (127.0.0.1:55432)"}
                    className="border-amber-800/60 bg-amber-500/10 font-mono text-[9px] text-amber-300"
                    data-testid="live-plane-badge"
                  >
                    LOCAL PIGSTY
                  </Badge>
                )}
                {d?.plane === "cloud" && (
                  <Badge
                    variant="outline"
                    title="supervisor state served from the cloud plane"
                    className="border-emerald-800/60 bg-emerald-500/10 font-mono text-[9px] text-emerald-300"
                    data-testid="live-plane-badge"
                  >
                    CLOUD
                  </Badge>
                )}
                {d?.stale && (
                  <Badge
                    variant="outline"
                    title={`last-known-good snapshot, cached ${d.staleMs != null ? formatMs(d.staleMs) : "?"} ago${d.error ? ` · last error: ${d.error}` : ""}`}
                    className="border-amber-800/60 bg-amber-500/10 font-mono text-[9px] text-amber-300"
                    data-testid="live-stale-badge"
                  >
                    CACHED (plane unreachable)
                  </Badge>
                )}
              </>
            ) : (
              <span className="font-mono text-xs text-zinc-500">{poll.loading ? "loading…" : d?.error ?? "no state row"}</span>
            )}
          </div>
          {live?.shellVersion && (
            <Badge variant="outline" className="border-teal-800/60 font-mono text-[10px] text-teal-300" title="shell_version from cloud state">
              shell {live.shellVersion}
            </Badge>
          )}
          {live && (
            <>
              <Badge variant="outline" className={`font-mono text-[10px] ${live.armed ? "border-emerald-800/60 text-emerald-300" : "border-rose-800/60 text-rose-300"}`}>
                {live.armed ? "ARMED" : "DISARMED"}
              </Badge>
              <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-300">mode {live.supervisorMode ?? "?"}</Badge>
              {live.selfUpdate.state && (
                <StatusBadge status={live.selfUpdate.state} />
              )}
              {live.selfUpdate.startupRecovery && (
                <Badge
                  variant="outline"
                  title={live.selfUpdate.startupRecovery.targetGitSha ?? undefined}
                  className={`font-mono text-[10px] ${live.selfUpdate.startupRecovery.state === "QUALIFIED" ? "border-emerald-800/60 text-emerald-300" : "border-amber-800/60 text-amber-300"}`}
                >
                  recovery {live.selfUpdate.startupRecovery.state}
                </Badge>
              )}
              {live.devos && (
                <Badge
                  variant="outline"
                  title={`devos admission=${live.devos.admissionState ?? "?"} actuation=${live.devos.actuationAllowed ? "allowed" : "fenced"} floor=${live.devos.generationFloor ?? "?"} mode=${live.devos.executionMode ?? "?"}${live.devos.lastError ? ` · last error: ${live.devos.lastError}` : ""}${live.devos.idleLastError ? ` · idle error: ${live.devos.idleLastError}` : ""}`}
                  className={`font-mono text-[10px] ${live.devos.idleLastError || live.devos.lastError ? "border-rose-800/60 text-rose-300" : live.devos.actuationAllowed ? "border-emerald-800/60 text-emerald-300" : "border-amber-800/60 text-amber-300"}`}
                  data-testid="devos-admission-badge"
                >
                  devos {live.devos.actuationAllowed ? "OPEN" : "FENCED"}{live.devos.idleLastError || live.devos.lastError ? " ⚠" : ""}
                </Badge>
              )}
            </>
          )}
          <button onClick={() => void poll.refresh()} className="ml-auto text-zinc-600 hover:text-emerald-400" aria-label="refresh live panel">
            <RefreshCw className={`h-3.5 w-3.5 ${poll.loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </CardContent>
      </Card>

      {live?.devos?.dispatch && <DispatchEffectCard dispatch={live.devos.dispatch} />}

      {!poll.loading && !live && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center font-mono text-xs text-zinc-500">
          live state unavailable — {d?.error ?? "browser has never reported to this cloud"}
        </div>
      )}

      {live && f && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {/* fleet governance */}
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
                  <Target className="h-3.5 w-3.5 text-teal-400" aria-hidden /> Fleet Governance
                </CardTitle>
                <CardDescription className="font-mono text-[10px] text-zinc-600">
                  boot_fleet_target persists across self-update restarts
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded border border-teal-900/50 bg-teal-950/30 px-2 py-2" title="persisted boot seed — restored on every boot">
                    <div className="font-mono text-xl font-bold text-teal-300">{f.bootFleetTarget ?? "—"}</div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">boot target</div>
                  </div>
                  <div className="rounded border border-violet-900/50 bg-violet-950/30 px-2 py-2" title="governor's current plan (demand-driven)">
                    <div className="font-mono text-xl font-bold text-violet-300">{f.desiredAgents ?? "—"}</div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">desired</div>
                  </div>
                  <div className="rounded border border-emerald-900/50 bg-emerald-950/30 px-2 py-2" title="agents currently live in the state row">
                    <div className="font-mono text-xl font-bold text-emerald-300">{f.liveAgents}</div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">live</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="border-zinc-700 font-mono text-[9px] text-zinc-400">{f.profile ?? "profile?"}</Badge>
                  <Badge variant="outline" className={`font-mono text-[9px] ${f.elastic ? "border-emerald-800/60 text-emerald-400" : "border-zinc-700 text-zinc-500"}`}>
                    {f.elastic ? "elastic" : "fixed"}
                  </Badge>
                  <Badge variant="outline" className="border-zinc-700 font-mono text-[9px] text-zinc-500">warm {f.warmAgents ?? "—"}</Badge>
                  {Object.entries(f.byLifecycle).map(([k, v]) => (
                    <Badge key={k} variant="outline" className={`font-mono text-[9px] ${lifecycleTone(k)}`}>{k} {v}</Badge>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">set fleet target (FLEET_RECONCILE)</span>
                  <div className="flex gap-2">
                    <Input
                      type="number" min={0} max={28} value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      className="h-8 w-24 border-zinc-800 bg-zinc-950/70 font-mono text-[11px] text-zinc-200 focus-visible:ring-teal-800"
                      aria-label="fleet target agents"
                    />
                    <Button
                      size="sm" onClick={() => setFleetTarget(Math.max(0, Math.min(28, Number(target) || 0)))}
                      disabled={busy !== ""}
                      className="h-8 gap-1.5 bg-teal-600 font-mono text-[11px] text-zinc-950 hover:bg-teal-500 disabled:opacity-50"
                    >
                      <GaugeCircle className="h-3.5 w-3.5" aria-hidden /> {busy === "target" ? "Reconciling…" : "Apply target"}
                    </Button>
                  </div>
                </div>
                {lastCmd && (
                  <div className="rounded border border-zinc-800/70 bg-zinc-950/60 px-2 py-1.5 font-mono text-[9px]" data-testid="last-live-command">
                    <span className={lastCmd.ok ? "text-emerald-400" : "text-rose-400"}>{lastCmd.action}</span>
                    <span className="text-zinc-600"> {lastCmd.commandId} · {lastCmd.status}</span>
                    {lastCmd.result && (
                      <span className="text-zinc-500"> · {JSON.stringify(lastCmd.result).slice(0, 90)}</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* agents */}
            <Card className="border-zinc-800 bg-zinc-900/50 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
                  <Bot className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> Live Fleet Agents
                  <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-500">{f.agents.length}</Badge>
                  <Users className="ml-4 h-3 w-3 text-zinc-600" aria-hidden />
                  {Object.entries(f.byRole).map(([role, n]) => (
                    <Badge key={role} variant="outline" className={`font-mono text-[9px] ${ROLE_STYLES[role] ?? "text-zinc-400 border-zinc-700"}`}>
                      {role.slice(0, 4)} {n}
                    </Badge>
                  ))}
                </CardTitle>
                <CardDescription className="font-mono text-[10px] text-zinc-600">
                  GLM 5.3 Flash workers · transport proof = живая вкладка chat.z.ai
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-96 pr-2 mc-scroll">
                  {f.agents.length === 0 ? (
                    <p className="py-6 text-center font-mono text-xs text-zinc-600">no agents in state row</p>
                  ) : (
                    <div className="space-y-1.5">
                      {f.agents.map((a) => (
                        <div key={a.agentId} className="rounded border border-zinc-800/70 bg-zinc-900/60 px-2.5 py-2" data-testid="live-agent-row">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={`font-mono text-[9px] ${ROLE_STYLES[a.role] ?? "text-zinc-400 border-zinc-700"}`}>{a.role}</Badge>
                            <Badge variant="outline" className={`font-mono text-[9px] ${lifecycleTone(a.lifecycleState)}`}>{a.lifecycleState}</Badge>
                            <span className="font-mono text-[10px] text-zinc-400" title={a.agentId}>{shortId(a.agentId, 14)}</span>
                            {a.tabId && <span className="font-mono text-[9px] text-zinc-600" title={a.tabId}>tab {shortId(a.tabId, 10)}</span>}
                            <span className="ml-auto font-mono text-[9px] text-zinc-600">
                              up {timeAgo(a.createdAt)}
                              {a.provenAt ? <span className="text-emerald-700"> · proof {timeAgo(a.provenAt)}</span> : <span className="text-amber-700"> · no proof</span>}
                            </span>
                          </div>
                          {a.lostReason && <p className="mt-1 font-mono text-[9px] text-rose-400/80">lost_reason: {a.lostReason}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* tabs census */}
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
                <Chrome className="h-3.5 w-3.5 text-teal-400" aria-hidden /> Tab Census
                <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-500">{live.tabs.total}</Badge>
                <Activity className="ml-2 h-3 w-3 text-zinc-600" aria-hidden />
                {Object.entries(live.tabs.byKind).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="border-zinc-700 font-mono text-[9px] text-zinc-400">{k} {v}</Badge>
                ))}
              </CardTitle>
              <CardDescription className="font-mono text-[10px] text-zinc-600">
                CLOSE_TAB доступен оператору; governor сам дозает вкладки под demand
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-72 pr-2 mc-scroll">
                <div className="grid gap-1.5 md:grid-cols-2">
                  {live.tabs.items.map((t, i) => (
                    <div key={t.tabId ?? i} className="flex items-center gap-2 rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[10px] text-zinc-300">{t.title ?? t.url ?? "—"}</p>
                        <p className="font-mono text-[9px] text-zinc-600">
                          {t.kind} · {t.tabId ? shortId(t.tabId, 10) : "no id"} · {t.url}
                        </p>
                      </div>
                      {t.tabId && (
                        confirmClose === t.tabId ? (
                          <Button
                            size="sm" variant="destructive" disabled={busy !== ""}
                            onClick={() => void closeTab(t.tabId!)}
                            className="h-6 px-2 font-mono text-[9px]"
                          >
                            {busy === `close:${t.tabId}` ? "…" : "confirm"}
                          </Button>
                        ) : (
                          <button
                            onClick={() => setConfirmClose(t.tabId!)}
                            className="text-zinc-600 hover:text-rose-400"
                            aria-label={`close tab ${shortId(t.tabId, 8)}`}
                            title="CLOSE_TAB через командную плоскость"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// Root-surface dispatch-effect diagnostics (browser 2026-09-21 release):
// the last lease→effect bootstrap/dispatch outcome and bounded counters, as
// projected from supervisor_lifecycle.devos_runtime.dispatch via /api/live.
type DispatchEffect = NonNullable<NonNullable<LiveSnapshot["devos"]>["dispatch"]>;

function dispatchStateTone(state: string): string {
  const s = state.toUpperCase();
  if (s.endsWith("_PROVEN") || s === "PROVEN") return "border-emerald-800/60 bg-emerald-950/40 text-emerald-300";
  if (s.endsWith("_ATTEMPTED")) return "border-teal-800/60 bg-teal-950/40 text-teal-300";
  if (s.includes("REFUSED") || s.includes("FAILED") || s.includes("AMBIGUOUS")) return "border-rose-800/60 bg-rose-950/40 text-rose-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function DispatchEffectCard({ dispatch }: { dispatch: DispatchEffect }) {
  const counters: Array<[string, number | null]> = [
    ["dispatched", dispatch.dispatches],
    ["proven", dispatch.proven],
    ["ambiguous", dispatch.ambiguous],
    ["seeds", dispatch.seedAttempts],
    ["seed proven", dispatch.seedProven],
    ["over-limit", dispatch.flushOverLimit],
  ];
  const chain = [
    dispatch.lastStage ? dispatch.lastStage.toLowerCase() : null,
    dispatch.lastEffectState ? dispatch.lastEffectState.toLowerCase() : null,
    dispatch.lastComposerChars != null ? `draft ${dispatch.lastComposerChars} chars` : null,
  ].filter(Boolean).join(" · ");
  return (
    <Card className="border-zinc-800 bg-zinc-900/50" data-testid="dispatch-effect-card">
      <CardHeader className="pb-2">
        <CardDescription className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          dispatch effect · lease→bootstrap→send
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded border px-2 py-0.5 font-mono text-[10px] ${dispatchStateTone(dispatch.lastState)}`}
            title={dispatch.lastReason ?? dispatch.lastState}
          >
            {dispatch.lastState}
          </span>
          {chain && <span className="font-mono text-[10px] text-zinc-500">{chain}</span>}
          <span className="ml-auto font-mono text-[10px] text-zinc-600" title={dispatch.lastAt ?? undefined}>
            {dispatch.lastAt ? timeAgo(dispatch.lastAt) : ""}
          </span>
        </div>
        {dispatch.lastReason && (
          <div className="font-mono text-[10px] leading-relaxed text-rose-400/90" data-testid="dispatch-effect-reason">
            {dispatch.lastReason}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {counters.map(([label, value]) => (
            <span
              key={label}
              className="rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
              title={`${label}: ${value ?? "n/a"}`}
            >
              {label} <span className={value != null && value > 0 && label === "ambiguous" ? "text-rose-300" : "text-zinc-200"}>{value ?? "–"}</span>
            </span>
          ))}
        </div>
        {(dispatch.lastTaskId || dispatch.lastAgentId) && (
          <div className="font-mono text-[10px] text-zinc-600">
            {dispatch.lastTaskId ? `task ${shortId(dispatch.lastTaskId)}` : ""}{dispatch.lastTaskId && dispatch.lastAgentId ? " · " : ""}{dispatch.lastAgentId ? `agent ${shortId(dispatch.lastAgentId)}` : ""}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
