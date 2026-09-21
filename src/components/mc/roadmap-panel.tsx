"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/mc/badges";
import { timeAgo } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import { Milestone, GitCommitHorizontal, Stamp as Seal } from "lucide-react";

interface RoadmapData {
  milestones: { key: string; status: string; phase: number | null; priority: string | null; updatedAt: string | null }[];
  statusSummary: Record<string, number>;
  releases: { roadmapKey: string; version: string | null; title: string | null; commit: string | null; sealed: boolean; isActive: boolean; createdAt: string | null }[];
}

export function RoadmapPanel({ poll }: { poll: PollState<RoadmapData> }) {
  const d = poll.data;

  return (
    <div className="space-y-4" data-testid="roadmap-panel">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-900/50 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <Milestone className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> Compute Fabric Roadmap
              <span className="ml-auto font-mono text-[10px] normal-case text-zinc-600">
                {d?.milestones.length ?? 0} milestones
              </span>
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">
              compute_fabric_roadmap_milestone_h205f22 · roadmap compute-fabric-roadmap-v1
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-96 pr-2 mc-scroll">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {d?.milestones.map((m) => (
                  <div
                    key={m.key}
                    className="group flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5 transition-colors hover:border-emerald-500/30"
                    title={`phase ${m.phase ?? "—"} · priority ${m.priority ?? "—"}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-zinc-300 group-hover:text-emerald-300">{m.key}</p>
                      {m.phase !== null && <p className="font-mono text-[9px] text-zinc-600">phase {m.phase}</p>}
                    </div>
                    <StatusBadge status={m.status} />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Status Summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(d?.statusSummary ?? {}).map(([s, n]) => (
                <div key={s} className="flex items-center gap-1.5">
                  <StatusBadge status={s} />
                  <span className="font-mono text-sm text-zinc-300 tabular-nums">{n}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
                <Seal className="h-3.5 w-3.5 text-amber-400" aria-hidden /> Canonical Releases
              </CardTitle>
              <CardDescription className="font-mono text-[10px] text-zinc-600">sealed canonical digests</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {d?.releases.map((r, i) => (
                <div key={i} className="rounded border border-zinc-800/70 bg-zinc-900/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-zinc-300">{r.roadmapKey}</span>
                    {r.sealed && (
                      <span className="font-mono text-[9px] text-amber-400">sealed ✓</span>
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 font-mono text-[9px] text-zinc-600">
                    <GitCommitHorizontal className="h-3 w-3" />
                    {r.commit ? `${r.commit.slice(0, 8)}…` : "no commit"} · {timeAgo(r.createdAt)}
                  </p>
                </div>
              ))}
              {(d?.releases.length ?? 0) === 0 && !poll.loading && (
                <p className="py-3 text-center font-mono text-xs text-zinc-600">no canonical releases</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
