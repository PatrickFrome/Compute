"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/mc/badges";
import { shortId, timeAgo } from "@/components/mc/use-poll";
import { usePoll } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import {
  Siren, Radar, Send, Eraser, RotateCcw, KeyRound, ShieldAlert, RadioTower, ChevronRight,
} from "lucide-react";

interface EmergencyData {
  ok: boolean;
  probe: {
    clientId: string; deviceId: string; fingerprint: string;
    active: boolean; revokedAt: string | null; enrolledAt: string | null;
  };
  emergencyCommands: {
    commandId: string; action: string; status: string; commandLane: string;
    targetClientId: string | null; issuedBy: string; issuedAt: string | null;
    completedAt: string | null; error: string | null;
  }[];
  runs: {
    at: string; action: string; wakeReason?: string | null; leasedCount?: number;
    dbReads?: number; latencyMs?: number; commandId?: string | null; ok: boolean; detail?: string;
  }[];
}

interface WaitResult {
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  envelope: {
    schema?: string; command?: Record<string, unknown> | null; leased_count?: number;
    wake_reason?: string; authoritative_db_reads?: number; polling_loop?: boolean;
    transport_delivery_is_authority?: boolean; authority_effect?: boolean; error?: string;
  };
}

const WAIT_MS_OPTIONS = [1000, 2000, 4000, 8000];

export function EmergencyLanePanel({ poll }: { poll: PollState<EmergencyData> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [sha, setSha] = useState("6bf173c71dc3026b02171085d956625ef9526378");
  const [ttl, setTtl] = useState("300");
  const [waitMs, setWaitMs] = useState(2000);
  const [waiting, setWaiting] = useState(false);
  const [waitResult, setWaitResult] = useState<WaitResult | null>(null);
  const [showCommand, setShowCommand] = useState(false);

  const d = poll.data;
  const probe = d?.probe;
  const recent = d?.emergencyCommands.slice(0, 12) ?? [];
  const runs = d?.runs ?? [];

  async function post(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const res = await fetch("/api/emergency", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = (await res.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
      return { status: res.status, json };
    } finally {
      setBusy(null);
    }
  }

  async function issue() {
    const r = await post("issue", { expected_git_sha: sha, ttl_seconds: Number(ttl) || 300 });
    if (r.json.ok) {
      toast.success("DEVELOPER_EMERGENCY_UPDATE issued", {
        description: `command ${shortId(String((r.json.issued as { command_id?: string })?.command_id ?? ""), 10)} · EMERGENCY lane`,
      });
      void poll.refresh();
    } else {
      toast.error("Issue failed", { description: String(r.json.error ?? r.status) });
    }
  }

  async function openWait() {
    setWaiting(true);
    setWaitResult(null);
    setShowCommand(false);
    try {
      const res = await fetch("/api/emergency", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "wait", wait_ms: waitMs }),
      });
      const json = (await res.json()) as WaitResult & { error?: string };
      if (json.error && !json.envelope) {
        toast.error("Emergency wait failed", { description: String(json.error) });
      } else {
        setWaitResult(json);
        const reason = json.envelope?.wake_reason ?? String(json.envelope?.error ?? "?");
        if (json.ok && (json.envelope?.leased_count ?? 0) > 0) {
          toast.success(`Leased 1 emergency command (${reason})`, { description: `${json.latencyMs}ms · db_reads=${json.envelope?.authoritative_db_reads}` });
        } else if (json.ok) {
          toast.info(`No emergency command (${reason})`, { description: `${json.latencyMs}ms · channel verified` });
        } else {
          toast.error(`Wait returned ${json.httpStatus}`, { description: String(json.envelope?.error ?? reason) });
        }
      }
      void poll.refresh();
    } catch (e) {
      toast.error("Network error", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setWaiting(false);
    }
  }

  async function cleanup() {
    const r = await post("cleanup");
    if (r.json.ok) {
      toast.success(`Cleanup: ${r.json.cancelled} command(s) cancelled`, { description: "audit rows preserved" });
      void poll.refresh();
    } else {
      toast.error("Cleanup failed", { description: String(r.json.error ?? r.status) });
    }
  }

  async function resetProbe() {
    const r = await post("reset-probe");
    if (r.json.ok) {
      toast.success("Probe device re-enrolled", { description: String((r.json.probe as { deviceId?: string })?.deviceId ?? "").slice(0, 12) + "…" });
      void poll.refresh();
    } else {
      toast.error("Probe reset failed", { description: String(r.json.error ?? r.status) });
    }
  }

  const wr = waitResult?.envelope;

  return (
    <div className="space-y-4" data-testid="emergency-panel">
      {/* probe identity */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-rose-300">
            <KeyRound className="h-3.5 w-3.5" aria-hidden /> Console Probe Device
            <span className="ml-auto flex items-center gap-2">
              {poll.loading && <Skeleton className="h-3 w-24 bg-zinc-800" />}
              {probe && (
                <Badge variant="outline" className={`font-mono text-[9px] ${probe.active ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/50 text-rose-300"}`}>
                  {probe.active ? "DEVICE ACTIVE" : "REVOKED/INACTIVE"}
                </Badge>
              )}
              <Button size="sm" variant="ghost" onClick={resetProbe} disabled={busy !== null}
                className="h-6 px-2 font-mono text-[10px] text-zinc-500 hover:text-zinc-300">
                <RotateCcw className="mr-1 h-3 w-3" /> re-enroll
              </Button>
            </span>
          </CardTitle>
          <CardDescription className="font-mono text-[10px] text-zinc-600">
            real P-256 device identity — enrollment proof → operator gate → activation, file-persisted server-side
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-zinc-500">
          <span>client: <span className="text-zinc-300">{probe?.clientId ?? "…"}</span></span>
          <span>device: <span className="text-zinc-300">{probe ? shortId(probe.deviceId, 12) : "…"}</span></span>
          <span>fp: <span className="text-zinc-300">{probe ? probe.fingerprint.slice(0, 16) + "…" : "…"}</span></span>
          <span>enrolled: <span className="text-zinc-300">{probe?.enrolledAt ? timeAgo(probe.enrolledAt) : "—"}</span></span>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* issue + wait */}
        <Card className="border-rose-900/50 bg-gradient-to-b from-rose-950/20 to-zinc-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-rose-300">
              <Siren className="h-4 w-4" aria-hidden /> Emergency Lane — issue &amp; wait (T8)
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-500">
              h205f22_a2_browser_supervisor_issue_developer_emergency_update_ → edge wait-emergency (pg_notify wake, authority=lease only)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">1 · issue developer emergency update</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={sha} onChange={(e) => setSha(e.target.value)} data-testid="emergency-sha"
                  className="h-8 w-36 border-zinc-800 bg-zinc-950 font-mono text-[11px] text-zinc-200" placeholder="git sha" aria-label="Expected git sha" />
                <Input value={ttl} onChange={(e) => setTtl(e.target.value)} data-testid="emergency-ttl"
                  className="h-8 w-20 border-zinc-800 bg-zinc-950 font-mono text-[11px] text-zinc-200" placeholder="ttl s" aria-label="TTL seconds" />
                <Button size="sm" onClick={issue} disabled={busy !== null || waiting} data-testid="emergency-issue"
                  className="h-8 border border-rose-500/40 bg-rose-500/15 px-3 font-mono text-[11px] text-rose-200 hover:bg-rose-500/25">
                  <Send className="mr-1.5 h-3 w-3" /> Issue
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">2 · open emergency wait (device-signed)</p>
              <div className="flex flex-wrap items-center gap-2">
                {WAIT_MS_OPTIONS.map((w) => (
                  <Button key={w} size="sm" variant="outline" onClick={() => setWaitMs(w)} data-testid={`wait-ms-${w}`}
                    className={`h-6 rounded-full px-2 font-mono text-[10px] ${waitMs === w ? "border-rose-500/60 bg-rose-500/15 text-rose-200" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
                    {w}ms
                  </Button>
                ))}
                <Button size="sm" onClick={openWait} disabled={busy !== null || waiting} data-testid="emergency-wait"
                  className="h-8 border border-amber-500/40 bg-amber-500/10 px-3 font-mono text-[11px] text-amber-200 hover:bg-amber-500/20">
                  <Radar className={`mr-1.5 h-3 w-3 ${waiting ? "animate-spin" : ""}`} />
                  {waiting ? "waiting…" : "Open Wait"}
                </Button>
              </div>
              {waiting && (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                  </span>
                  <span className="font-mono text-[10px] text-amber-300">
                    long-poll open on edge :3031 · LISTEN glm_browser_pulse · lease window {waitMs}ms
                  </span>
                </div>
              )}
            </div>

            {waitResult && (
              <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/70 p-3" data-testid="wait-result">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                  <Badge className={`font-mono ${waitResult.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`} variant="outline">
                    HTTP {waitResult.httpStatus}
                  </Badge>
                  <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 font-mono text-violet-300" data-testid="wake-reason">
                    <RadioTower className="mr-1 h-3 w-3" /> wake_reason: {wr?.wake_reason ?? wr?.error ?? "?"}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-zinc-400">{waitResult.latencyMs}ms</Badge>
                  <Badge variant="outline" className="font-mono text-zinc-400">leased={wr?.leased_count ?? 0}</Badge>
                  <Badge variant="outline" className="font-mono text-zinc-400">db_reads={wr?.authoritative_db_reads ?? 0}</Badge>
                  <Badge variant="outline" className="font-mono text-zinc-500">authority_effect=false</Badge>
                </div>
                {wr?.command && (
                  <div>
                    <button onClick={() => setShowCommand((v) => !v)} className="flex items-center gap-1 font-mono text-[10px] text-zinc-400 hover:text-zinc-200" data-testid="toggle-leased-command">
                      <ChevronRight className={`h-3 w-3 transition-transform ${showCommand ? "rotate-90" : ""}`} />
                      leased command {shortId(String((wr.command as { command_id?: string })?.command_id ?? ""), 10)}
                    </button>
                    {showCommand && (
                      <pre className="mc-scroll mt-1.5 max-h-44 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[9px] leading-4 text-emerald-300/80">
                        {JSON.stringify(wr.command, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            <Button size="sm" variant="outline" onClick={cleanup} disabled={busy !== null}
              className="h-7 border-zinc-700 px-2 font-mono text-[10px] text-zinc-400 hover:bg-zinc-800">
              <Eraser className="mr-1.5 h-3 w-3" /> Cleanup console leases (→ CANCELLED)
            </Button>
          </CardContent>
        </Card>

        {/* runs + recent emergency commands */}
        <div className="space-y-4">
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden /> Lane Run Log
              </CardTitle>
              <CardDescription className="font-mono text-[10px] text-zinc-600">last {runs.length} console operations (process-local)</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-52 pr-2 mc-scroll">
                <div className="space-y-1.5">
                  {runs.length === 0 && (
                    <p className="py-3 text-center font-mono text-xs text-zinc-600">no lane operations yet — issue or wait above</p>
                  )}
                  {runs.map((r, i) => (
                    <div key={`${r.at}-${i}`} className="flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-zinc-300">
                          {r.action}{r.wakeReason ? ` · ${r.wakeReason}` : ""}{r.detail ? ` · ${r.detail}` : ""}
                        </p>
                        <p className="font-mono text-[9px] text-zinc-600">
                          {timeAgo(r.at)}{r.latencyMs != null ? ` · ${r.latencyMs}ms` : ""}{r.dbReads != null ? ` · db_reads=${r.dbReads}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className={`font-mono text-[9px] ${r.ok ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"}`}>
                        {r.ok ? "OK" : "ERR"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">EMERGENCY Lane — recent commands</CardTitle>
              <CardDescription className="font-mono text-[10px] text-zinc-600">command_lane=&apos;EMERGENCY&apos; · last {recent.length}</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-52 pr-2 mc-scroll">
                <div className="space-y-1.5">
                  {recent.length === 0 && (
                    <p className="py-3 text-center font-mono text-xs text-zinc-600">no emergency-lane commands yet</p>
                  )}
                  {recent.map((c) => (
                    <div key={c.commandId} className="flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[11px] text-zinc-300">{c.action} <span className="text-zinc-600">by {c.issuedBy}</span></p>
                        <p className="font-mono text-[9px] text-zinc-600">
                          {timeAgo(c.issuedAt)}{c.targetClientId ? ` · → ${shortId(c.targetClientId, 10)}` : " · broadcast"}
                          {c.error ? ` · ${c.error}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
