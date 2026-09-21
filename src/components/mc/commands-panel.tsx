"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge, LaneBadge, AuthoritySeal } from "@/components/mc/badges";
import { shortId, timeAgo } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import { Radio, Filter } from "lucide-react";

interface CommandsData {
  commands: {
    commandId: string; target: string | null; issuedBy: string | null; action: string;
    status: string; lane: string | null; authorityEffect: boolean;
    issuedAt: string | null; completedAt: string | null;
    receiptOk: boolean | null; receiptSchema: string | null; error: string | null;
  }[];
  laneDist: { lane: string; n: number; pending: number }[];
  statusDist: { status: string; n: number }[];
}

const LANES = ["ALL", "READ_ONLY", "EMERGENCY", "DEVELOPER_EMERGENCY_UPDATE"];
const STATUSES = ["ALL", "PENDING", "LEASED", "COMPLETED", "FAILED", "EXPIRED", "CANCELLED"];

export function CommandsPanel({ poll }: { poll: PollState<CommandsData> }) {
  const [lane, setLane] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  const d = poll.data;
  const rows = useMemo(() => {
    if (!d) return [];
    return d.commands.filter(
      (c) => (lane === "ALL" || c.lane === lane) && (status === "ALL" || c.status === status),
    );
  }, [d, lane, status]);

  return (
    <div className="space-y-4" data-testid="commands-panel">
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
            <Radio className="h-3.5 w-3.5 text-violet-400" aria-hidden />
            Command Plane Explorer
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] normal-case text-zinc-600">
              <Filter className="h-3 w-3" /> {rows.length} of {d?.commands.length ?? 0}
            </span>
          </CardTitle>
          <CardDescription className="font-mono text-[10px] text-zinc-600">
            compute_fabric_a2_browser_supervisor_command_h205f22 · lane priority: EMERGENCY 0 &gt; DEV 1 &gt; READ_ONLY 9
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] uppercase text-zinc-600">lane:</span>
            {LANES.map((l) => (
              <Button
                key={l} size="sm" variant="outline"
                onClick={() => setLane(l)}
                data-testid={`lane-filter-${l}`}
                className={`h-6 rounded-full px-2 font-mono text-[10px] ${
                  lane === l
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {l === "DEVELOPER_EMERGENCY_UPDATE" ? "DEV-EMERG" : l}
              </Button>
            ))}
            <span className="mx-2 h-4 w-px bg-zinc-800" />
            <span className="mr-1 font-mono text-[10px] uppercase text-zinc-600">status:</span>
            {STATUSES.map((s) => (
              <Button
                key={s} size="sm" variant="outline"
                onClick={() => setStatus(s)}
                data-testid={`status-filter-${s}`}
                className={`h-6 rounded-full px-2 font-mono text-[10px] ${
                  status === s
                    ? "border-violet-500/60 bg-violet-500/15 text-violet-300"
                    : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {s}
              </Button>
            ))}
          </div>

          <ScrollArea className="max-h-96 rounded-md border border-zinc-800/80">
            {poll.loading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full bg-zinc-800" />)}
              </div>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center font-mono text-xs text-zinc-600" data-testid="commands-empty">
                no commands match filters
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur">
                  <tr className="border-b border-zinc-800 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
                    <th className="px-3 py-2 font-medium">action</th>
                    <th className="px-3 py-2 font-medium">lane</th>
                    <th className="px-3 py-2 font-medium">status</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">target</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">authority</th>
                    <th className="px-3 py-2 font-medium">issued</th>
                    <th className="hidden px-3 py-2 font-medium lg:table-cell">receipt</th>
                  </tr>
                </thead>
                <tbody data-testid="commands-tbody">
                  {rows.map((c) => (
                    <tr
                      key={c.commandId}
                      className={`border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/40 ${
                        c.lane === "EMERGENCY" ? "bg-rose-950/20" : ""
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        <span className="font-mono text-[11px] font-medium text-zinc-200">{c.action}</span>
                        {c.error && <p className="max-w-40 truncate font-mono text-[9px] text-rose-400" title={c.error}>{c.error}</p>}
                      </td>
                      <td className="px-3 py-1.5"><LaneBadge lane={c.lane} /></td>
                      <td className="px-3 py-1.5"><StatusBadge status={c.status} /></td>
                      <td className="hidden px-3 py-1.5 font-mono text-[10px] text-zinc-500 md:table-cell">{c.target ?? "broadcast"}</td>
                      <td className="hidden px-3 py-1.5 sm:table-cell"><AuthoritySeal effect={c.authorityEffect} /></td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-zinc-500">{timeAgo(c.issuedAt)}</td>
                      <td className="hidden px-3 py-1.5 lg:table-cell">
                        {c.receiptOk === null ? (
                          <span className="font-mono text-[10px] text-zinc-600">—</span>
                        ) : (
                          <span className={`font-mono text-[10px] ${c.receiptOk ? "text-emerald-400" : "text-rose-400"}`}>
                            {c.receiptOk ? "✓ ok" : "✗ failed"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
