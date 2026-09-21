"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/mc/badges";
import { shortId, timeAgo } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import { Bot, ScrollText } from "lucide-react";

interface FleetData {
  tasks: Record<string, unknown>[];
  claims: { claimId: string; taskId: string | null; claimedBy: string | null; status: string | null; createdAt: string | null }[];
  events: { eventId: string; taskId: string | null; kind: string | null; createdAt: string | null; payloadPreview: string | null }[];
  counts: { tasks: number; claims: number; events: number };
}

export function FleetPanel({ poll }: { poll: PollState<FleetData> }) {
  const d = poll.data;

  return (
    <div className="space-y-4" data-testid="fleet-panel">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <Bot className="h-3.5 w-3.5 text-violet-400" aria-hidden /> DevOS Fleet Tasks
              <Badge variant="outline" className="font-mono text-[10px] border-zinc-700 text-zinc-500">
                {d?.counts.tasks ?? 0}
              </Badge>
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">
              destruktion_meta.devos_fleet_task_h205f22 — cloud-era object, reconstructed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-80 pr-2 mc-scroll">
              {!poll.loading && (d?.tasks.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-zinc-600">
                  <Bot className="h-8 w-8 opacity-30" aria-hidden />
                  <p className="font-mono text-xs">fleet idle — tasks appear when live browser connects (T6/T7)</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {d?.tasks.map((t, i) => (
                    <div key={i} className="rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-zinc-300">{String(t.task_id ?? "?").slice(0, 18)}…</span>
                        <StatusBadge status={String(t.status ?? "UNKNOWN")} />
                      </div>
                      {t.role != null && <p className="mt-0.5 font-mono text-[9px] text-zinc-600">role {String(t.role)}</p>}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <ScrollText className="h-3.5 w-3.5 text-teal-400" aria-hidden /> Fleet Event Stream
              <Badge variant="outline" className="font-mono text-[10px] border-zinc-700 text-zinc-500">
                {d?.counts.events ?? 0}
              </Badge>
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">devos_fleet_event_h205f22</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-80 pr-2 mc-scroll">
              {(d?.events.length ?? 0) === 0 ? (
                <p className="py-8 text-center font-mono text-xs text-zinc-600">no fleet events yet</p>
              ) : (
                <div className="space-y-1.5">
                  {d?.events.map((ev) => (
                    <div key={ev.eventId} className="rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-teal-300">{ev.kind ?? "?"}</span>
                        <span className="font-mono text-[9px] text-zinc-600">{timeAgo(ev.createdAt)}</span>
                      </div>
                      <p className="truncate font-mono text-[9px] text-zinc-600">{ev.payloadPreview ?? "—"}</p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* claims strip */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Claims</CardTitle>
          <CardDescription className="font-mono text-[10px] text-zinc-600">
            {d?.counts.claims ?? 0} claims recorded · claims pair tasks to workers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(d?.claims.length ?? 0) === 0 ? (
            <p className="py-2 text-center font-mono text-xs text-zinc-600">no claims yet</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {d?.claims.slice(0, 12).map((c) => (
                <span key={c.claimId} className="rounded border border-zinc-800 bg-zinc-900/70 px-2 py-1 font-mono text-[10px] text-zinc-400">
                  {shortId(c.taskId, 6)} → {c.claimedBy ?? "?"}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
