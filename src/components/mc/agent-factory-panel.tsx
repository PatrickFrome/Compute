"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LiveDot } from "@/components/mc/badges";
import type { PollState } from "@/components/mc/use-poll";
import { Bot, GraduationCap, Trash2, ShieldCheck, KeyRound, Activity, AppWindow as TabsIcon } from "lucide-react";

interface FleetAgentRow {
  role: string;
  agent_id: string;
  tab_id: string | null;
  lifecycle_state?: string;
  lost_reason?: string | null;
  created_at?: string;
}

interface FactoryFleetData {
  ok: boolean;
  heartbeat: {
    lastSeenAt: string | null;
    armed: boolean | null;
    supervisorMode: string | null;
    shellVersion: string | null;
    keepaliveState: string | null;
    keepaliveCycleSeq: number | null;
    idleError: string | null;
    commandLeasePrecedesIdleWork: boolean | null;
  };
  tabs: { tab_id: string; url: string; kind?: string; selected?: boolean }[];
  fleetAgents: FleetAgentRow[];
  fleetLive: number;
  perception: {
    tabId: string | null;
    url: string | null;
    capturedAt: string | null;
    semanticTargetCount: number | null;
    textExcerpt: string;
  };
  manifest: {
    agents: {
      role: string;
      agentId: string;
      tabId: string;
      trainedAt?: string;
      bootstrapVerified?: boolean;
      typeStatus?: string;
    }[];
    updatedAt: string;
  };
  secrets: { key: string; hint: string }[];
}

interface ProvisionResult {
  ok: boolean;
  agents?: { role: string; agentId: string; tabId: string; bootstrapVerified?: boolean; typeStatus?: string }[];
  verified?: number;
  log?: string[];
  error?: string;
  stage?: string;
}

function timeAgoIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export function AgentFactoryPanel({ poll }: { poll: PollState<FactoryFleetData> }) {
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState<string | null>(null);
  const [provisionLog, setProvisionLog] = useState<string[]>([]);
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null);
  const [verifyOut, setVerifyOut] = useState<{ role: string; bootstrapSeen: boolean; agentAcknowledged: boolean; transcriptBytes: number }[] | null>(null);

  const post = useCallback(
    async (url: string, body?: unknown, label?: string) => {
      setBusy(label ?? url);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const json = (await res.json()) as ProvisionResult & { log?: string[] };
        if (json.log) setProvisionLog(json.log);
        return json;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const onProvision = async () => {
    setVerifyOut(null);
    setProvisionResult(null);
    const r = await post("/api/agent-factory/provision", { count }, "provision");
    setProvisionResult(r);
    void poll.refresh();
  };

  const onCleanup = async () => {
    const r = await post("/api/agent-factory/cleanup", { targetAgents: 4, closeExtraTabs: true }, "cleanup");
    setProvisionResult(r);
    void poll.refresh();
  };

  const onVerify = async () => {
    setBusy("verify");
    try {
      const res = await fetch("/api/agent-factory/verify", { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; agents?: { role: string; bootstrapSeen: boolean; agentAcknowledged: boolean; transcriptBytes: number }[]; error?: string };
      setVerifyOut(json.agents ?? []);
      if (json.error) setProvisionLog([`verify error: ${json.error}`]);
    } finally {
      setBusy(null);
    }
  };

  const hb = poll.data?.heartbeat;
  const hbFresh = hb?.lastSeenAt ? Date.now() - new Date(hb.lastSeenAt).getTime() < 30_000 : false;
  const lanesBusy = (hb?.idleError ?? "").includes("wait_timeout");
  const manifest = poll.data?.manifest;

  return (
    <div className="space-y-4">
      {/* heartbeat / plane status */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-900/60" data-testid="factory-heartbeat">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              <Activity className="h-3 w-3" aria-hidden /> browser supervisor
            </CardDescription>
            <CardTitle className="flex items-center gap-2 font-mono text-sm text-zinc-100">
              <LiveDot ok={hbFresh} pulse={hbFresh} />
              {hbFresh ? "LIVE" : "STALE"} <span className="text-zinc-500">·</span>
              <span className="text-xs text-zinc-400">{timeAgoIso(hb?.lastSeenAt)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 font-mono text-[11px] text-zinc-400">
            <p>
              mode: <span className={hb?.supervisorMode === "CONTROL" ? "text-emerald-300" : "text-amber-300"}>{hb?.supervisorMode ?? "?"}</span>
              {" · "}armed: <span className={hb?.armed ? "text-emerald-300" : "text-rose-300"}>{String(hb?.armed ?? "?")}</span>
            </p>
            <p>
              shell: <span className="text-zinc-300">{hb?.shellVersion ?? "?"}</span>
            </p>
            <p>
              keepalive: <span className={(hb?.keepaliveState ?? "") === "ROLLOVER_AMBIGUOUS" ? "text-amber-300" : "text-emerald-300"}>{hb?.keepaliveState ?? "?"}</span>
              {" · "}cycle {hb?.keepaliveCycleSeq ?? "—"}
            </p>
            <p className={lanesBusy ? "text-amber-300" : "text-zinc-500"}>
              {lanesBusy ? "idle maintenance wait_timeout — command lanes may lag" : "command lanes nominal"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/60" data-testid="factory-fleet">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              <Bot className="h-3 w-3" aria-hidden /> fleet / tabs
            </CardDescription>
            <CardTitle className="font-mono text-sm text-zinc-100">
              {poll.data?.fleetLive ?? "—"} live agents · {poll.data?.tabs?.length ?? "—"} tabs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-32 pr-2">
              <div className="space-y-0.5 font-mono text-[10px] text-zinc-500">
                {(poll.data?.fleetAgents ?? []).map((a) => (
                  <p key={a.agent_id} className={a.lifecycle_state === "LOST" ? "text-zinc-700" : "text-zinc-400"}>
                    {a.lifecycle_state === "LOST" ? "·" : "●"} {a.role} <span className="text-zinc-600">{a.agent_id.slice(6, 14)}</span> {a.lifecycle_state}
                  </p>
                ))}
                {!poll.data?.fleetAgents?.length && <p>no fleet data yet</p>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/60" data-testid="factory-secrets">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              <KeyRound className="h-3 w-3" aria-hidden /> secrets vault (redacted)
            </CardDescription>
            <CardTitle className="font-mono text-sm text-zinc-100">{poll.data?.secrets?.length ?? 0} credentials armed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5 font-mono text-[10px]">
              {(poll.data?.secrets ?? []).map((s) => (
                <p key={s.key} className="flex justify-between gap-2">
                  <span className="text-zinc-500">{s.key}</span>
                  <span className="truncate text-emerald-400/70" title={s.key}>{s.hint}</span>
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* actions */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-mono text-sm text-zinc-100">
            <GraduationCap className="h-4 w-4 text-emerald-400" aria-hidden /> agent training ops
          </CardTitle>
          <CardDescription className="font-mono text-[11px] text-zinc-500">
            geometry-independent typed commands · bootstrap carries tokens + secrets + mission context
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-zinc-800 p-0.5">
            {[2, 4, 6, 8].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                data-testid={`factory-count-${n}`}
                className={`rounded px-2 py-1 font-mono text-[11px] ${count === n ? "bg-emerald-500/20 text-emerald-300" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            onClick={onProvision}
            disabled={busy !== null}
            data-testid="factory-provision"
            className="bg-emerald-600 font-mono text-xs hover:bg-emerald-500"
          >
            <Bot className={`mr-1 h-3.5 w-3.5 ${busy === "provision" ? "animate-pulse" : ""}`} />
            {busy === "provision" ? "provisioning…" : `Provision + train ${count} agents`}
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={onCleanup}
            disabled={busy !== null}
            data-testid="factory-cleanup"
            className="border-zinc-700 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <Trash2 className={`mr-1 h-3.5 w-3.5 ${busy === "cleanup" ? "animate-pulse" : ""}`} />
            {busy === "cleanup" ? "cleaning…" : "Cleanup tabs + reconcile(4)"}
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={onVerify}
            disabled={busy !== null}
            data-testid="factory-verify"
            className="border-zinc-700 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <ShieldCheck className={`mr-1 h-3.5 w-3.5 ${busy === "verify" ? "animate-pulse" : ""}`} />
            {busy === "verify" ? "verifying…" : "Verify training"}
          </Button>
        </CardContent>
      </Card>

      {/* provisioning log */}
      {(provisionLog.length > 0 || provisionResult) && (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs text-zinc-300">operation log</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-40 pr-2">
              <div className="space-y-0.5 font-mono text-[10.5px] leading-relaxed" data-testid="factory-oplog">
                {provisionLog.map((l, i) => (
                  <p key={i} className="text-zinc-400">{l}</p>
                ))}
                {provisionResult && !provisionResult.ok && (
                  <p className="text-rose-300">error: {provisionResult.error}{provisionResult.stage ? ` (stage: ${provisionResult.stage})` : ""}</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* manifest agents */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs text-zinc-300">trained agents (manifest)</CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">updated {timeAgoIso(manifest?.updatedAt)}</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-48 pr-2">
              <div className="space-y-1.5" data-testid="factory-manifest">
                {(manifest?.agents ?? []).map((a) => (
                  <div key={a.tabId} className="flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-950/40 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-zinc-200">
                        {a.role} <span className="text-zinc-600">{a.agentId}</span>
                      </p>
                      <p className="font-mono text-[9.5px] text-zinc-600">
                        {a.tabId.slice(4, 12)} · trained {timeAgoIso(a.trainedAt)} · type {a.typeStatus ?? "?"}
                      </p>
                    </div>
                    <Badge variant={a.bootstrapVerified ? "default" : "secondary"} className={a.bootstrapVerified ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-400"}>
                      {a.bootstrapVerified ? "bootstrap ✓" : "pending"}
                    </Badge>
                  </div>
                ))}
                {!manifest?.agents?.length && (
                  <p className="font-mono text-[11px] text-zinc-600">no agents provisioned yet — press “Provision + train”</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 font-mono text-xs text-zinc-300">
              <TabsIcon className="h-3.5 w-3.5" aria-hidden /> live browser tabs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-48 pr-2">
              <div className="space-y-0.5 font-mono text-[10px]">
                {(poll.data?.tabs ?? []).map((t) => (
                  <p key={t.tab_id} className="truncate text-zinc-500">
                    <span className={t.selected ? "text-emerald-400" : "text-zinc-700"}>{t.selected ? "▶" : "·"}</span>{" "}
                    {t.kind ?? "?"} <span className="text-zinc-600">{t.url.replace(/^https?:\/\//, "").slice(0, 36)}</span> {t.tab_id.slice(4, 12)}
                  </p>
                ))}
                {!poll.data?.tabs?.length && <p className="text-zinc-600">no tabs data</p>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* verification output */}
      {verifyOut && (
        <Card className="border-zinc-800 bg-zinc-900/60" data-testid="factory-verify-out">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs text-zinc-300">training verification (parallel READ_TRANSCRIPT)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 font-mono text-[11px]">
              {verifyOut.map((v, i) => (
                <p key={i} className={v.agentAcknowledged ? "text-emerald-300" : v.bootstrapSeen ? "text-amber-300" : "text-zinc-500"}>
                  {v.agentAcknowledged ? "✓ ACK" : v.bootstrapSeen ? "◐ seen" : "○ none"} · {v.role} · {v.transcriptBytes}B
                </p>
              ))}
              {!verifyOut.length && <p className="text-zinc-600">nothing to verify — provision agents first</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
