"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePoll, shortId, timeAgo } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import { BrainCircuit, Waves, Activity, CheckCircle2, XCircle, Clock } from "lucide-react";

interface CognitiveData {
  ok: boolean;
  acceptorInstalled: boolean;
  cursor: {
    workspaceId?: string; clientId: string; deviceId: string; streamId: string;
    acceptedThroughSequence: number; acceptedBatches: number; acceptedEvents: number;
    firstSeenAt: string | null; lastSeenAt: string | null;
  }[];
  stats: { batches: number; events: number; streams: number };
  runs: { at: string; ok: boolean; httpStatus?: number; latencyMs?: number; through?: number | null; reason?: string | null }[];
}

export function CognitiveBusPanel({ poll }: { poll: PollState<CognitiveData> }) {
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState(3);
  const [kind, setKind] = useState<"health.probe" | "ui.event">("health.probe");
  const [lastAck, setLastAck] = useState<{ accepted?: boolean; accepted_through_sequence?: number; error?: string; reason?: string; stream_id?: string } | null>(null);

  const d = poll.data;
  const streams = d?.cursor ?? [];

  async function emit() {
    setBusy(true);
    try {
      const res = await fetch("/api/cognitive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events, kind }),
      });
      const json = (await res.json()) as {
        ok: boolean; ack?: { accepted?: boolean; accepted_through_sequence?: number; error?: string; reason?: string; stream_id?: string }; run?: { latencyMs?: number; httpStatus?: number };
      };
      setLastAck(json.ack ?? { error: `HTTP ${res.status}` });
      if (json.ok) {
        toast.success("Cognitive batch accepted (202)", {
          description: `through=${json.ack?.accepted_through_sequence} · ${json.run?.latencyMs}ms · cursor watermark advanced`,
        });
      } else {
        toast.error(`Batch rejected (HTTP ${json.run?.httpStatus ?? res.status})`, {
          description: String(json.ack?.error ?? json.ack?.reason ?? "unknown"),
        });
      }
      void poll.refresh();
    } catch (e) {
      toast.error("Network error", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="cognitive-panel">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* emitter */}
        <Card className="border-violet-900/50 bg-gradient-to-b from-violet-950/20 to-zinc-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-violet-300">
              <Waves className="h-4 w-4" aria-hidden /> Cognitive Bus — emit batch (T9/T10)
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-500">
              edge POST /v1/cognitive/deltas · schema batch.v1 · zero-authority fences · cursor watermark (cloud-true contract)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase text-zinc-600">events:</span>
              {[1, 3, 5, 8].map((n) => (
                <Button key={n} size="sm" variant="outline" onClick={() => setEvents(n)} data-testid={`cog-events-${n}`}
                  className={`h-6 rounded-full px-2 font-mono text-[10px] ${events === n ? "border-violet-500/60 bg-violet-500/15 text-violet-300" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
                  {n}
                </Button>
              ))}
              <span className="mx-1 h-4 w-px bg-zinc-800" />
              {(["health.probe", "ui.event"] as const).map((k) => (
                <Button key={k} size="sm" variant="outline" onClick={() => setKind(k)} data-testid={`cog-kind-${k}`}
                  className={`h-6 rounded-full px-2 font-mono text-[10px] ${kind === k ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
                  console.{k}
                </Button>
              ))}
              <Button size="sm" onClick={emit} disabled={busy} data-testid="cog-emit"
                className="ml-auto h-8 border border-violet-500/40 bg-violet-500/15 px-3 font-mono text-[11px] text-violet-200 hover:bg-violet-500/25">
                <Activity className={`mr-1.5 h-3 w-3 ${busy ? "animate-pulse" : ""}`} /> Emit Batch
              </Button>
            </div>

            {lastAck && (
              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 font-mono text-[10px]" data-testid="cog-ack">
                {lastAck.accepted === true ? (
                  <p className="text-emerald-300">
                    202 ACK · accepted_through_sequence=<span data-testid="cog-through">{lastAck.accepted_through_sequence}</span> · stream {shortId(String(lastAck.stream_id ?? ""), 12)}
                  </p>
                ) : (
                  <p className="text-rose-300">rejected: {String(lastAck.error ?? lastAck.reason ?? "?")}</p>
                )}
                <p className="mt-1 text-zinc-600">delivery_is_authority=false · full_state_resync on 4xx/5xx per canonical route</p>
              </div>
            )}

            <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] text-zinc-500">
              <span>acceptor: {d ? (
                <Badge variant="outline" className={`ml-1 font-mono text-[9px] ${d.acceptorInstalled ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"}`}>
                  {d.acceptorInstalled ? "INSTALLED (bootstrap/08)" : "MISSING"}
                </Badge>
              ) : <Skeleton className="ml-1 h-3 w-24 bg-zinc-800" />}
              </span>
              <span>streams: <span className="text-zinc-300">{d?.stats.streams ?? "—"}</span></span>
              <span>batches: <span className="text-zinc-300">{d?.stats.batches ?? "—"}</span></span>
              <span>events accepted: <span className="text-zinc-300">{d?.stats.events ?? "—"}</span></span>
            </div>
          </CardContent>
        </Card>

        {/* run log */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <BrainCircuit className="h-3.5 w-3.5 text-violet-400" aria-hidden /> Emit Run Log
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">process-local ring, last 12</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-52 pr-2 mc-scroll">
              <div className="space-y-1.5">
                {(d?.runs ?? []).length === 0 && (
                  <p className="py-3 text-center font-mono text-xs text-zinc-600">no emits yet — fire a batch above</p>
                )}
                {(d?.runs ?? []).map((r, i) => (
                  <div key={`${r.at}-${i}`} className="flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-zinc-300">
                        HTTP {r.httpStatus} · through={r.through ?? "—"} · {r.reason}
                      </p>
                      <p className="font-mono text-[9px] text-zinc-600">{timeAgo(r.at)}{r.latencyMs != null ? ` · ${r.latencyMs}ms` : ""}</p>
                    </div>
                    {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* stream inspector */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Stream Inspector — cognitive cursor</CardTitle>
          <CardDescription className="font-mono text-[10px] text-zinc-600">
            compute_fabric_a2_browser_cognitive_cursor_h205f22 · watermark per (workspace, stream, client, device) · deltas NOT persisted (canonical cloud semantics)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-72 pr-2 mc-scroll">
            <div className="space-y-1.5">
              {streams.length === 0 && !poll.loading && (
                <p className="py-4 text-center font-mono text-xs text-zinc-600">no streams yet — emit the first batch</p>
              )}
              {streams.map((s) => (
                <div key={`${s.streamId}-${s.clientId}-${s.deviceId}`} className="rounded border border-zinc-800/70 bg-zinc-900/60 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px]">
                    <span className="text-zinc-300">stream {shortId(s.streamId, 12)}</span>
                    <Badge variant="outline" className="font-mono text-[9px] border-violet-500/40 text-violet-300">seq ≤ {s.acceptedThroughSequence}</Badge>
                    <span className="text-zinc-500">batches={s.acceptedBatches}</span>
                    <span className="text-zinc-500">events={s.acceptedEvents}</span>
                    <span className="text-zinc-500">client={s.clientId}</span>
                    <span className="ml-auto flex items-center gap-1 text-zinc-600"><Clock className="h-3 w-3" /> {timeAgo(s.lastSeenAt)}</span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-500/70 to-emerald-500/70 transition-all"
                      style={{ width: `${Math.min(100, (s.acceptedThroughSequence % 32) * 3.125 + 6)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
