"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/mc/badges";
import { shortId, timeAgo } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import {
  Milestone, GitCommitHorizontal, Stamp as Seal, Rocket, RefreshCw, Search, ListChecks, Loader2, Cloud, HardDrive, Repeat,
} from "lucide-react";

interface MilestoneTask {
  taskId: string;
  role: string;
  state: string;
  priority: number | null;
  updatedAt: string | null;
  finishedAt: string | null;
  plane?: string;
}

interface RoadmapData {
  ok: boolean;
  plane?: "cloud" | "local";
  cloudError?: string | null;
  milestones: {
    key: string; status: string; phase: number | null; priority: string | null;
    updatedAt: string | null; verifiedCheckpointId: string | null; task: MilestoneTask | null;
  }[];
  statusSummary: Record<string, number>;
  tasks: { taskId: string; milestoneKey: string; role: string; state: string; priority: number | null; createdAt: string | null }[];
  releases: { roadmapKey: string; version: string | null; title: string | null; commit: string | null; sealed: boolean; isActive: boolean; createdAt: string | null }[];
}

const STATUS_FILTERS = ["ALL", "PLANNED", "IN_PROGRESS", "DONE", "BLOCKED"] as const;

const MILESTONE_STATUSES = ["PLANNED", "IN_PROGRESS", "DONE", "BLOCKED"] as const;

const PROGRESS_STYLES: Record<string, string> = {
  DONE: "bg-emerald-500",
  IN_PROGRESS: "bg-amber-500",
  BLOCKED: "bg-rose-500",
  PLANNED: "bg-zinc-700",
};

export function RoadmapPanel({ poll }: { poll: PollState<RoadmapData> }) {
  const d = poll.data;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<"" | "dispatch-all" | "sync">("");
  const [autoSync, setAutoSync] = useState(true);
  const autoRef = useRef(autoSync);
  autoRef.current = autoSync;

  // Auto-sync: cloud task states advance asynchronously (the browser leases
  // and completes tasks on its own heartbeat) — pull transitions every 60s.
  useEffect(() => {
    if (!autoSync) return;
    const t = setInterval(() => {
      if (!autoRef.current || bulkBusy) return;
      void (async () => {
        try {
          const res = await fetch("/api/roadmap/dispatch", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "sync" }),
          });
          const json = (await res.json()) as { ok?: boolean; changedCount?: number };
          if (json.ok && (json.changedCount ?? 0) > 0) void poll.refresh();
        } catch { /* auto-sync is best-effort */ }
      })();
    }, 60_000);
    return () => clearInterval(t);
  }, [autoSync, bulkBusy]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (d?.milestones ?? []).filter((m) => {
      if (filter !== "ALL" && m.status !== filter) return false;
      if (q && !m.key.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [d?.milestones, filter, query]);

  const summary = d?.statusSummary ?? {};
  const total = d?.milestones.length ?? 0;
  const done = summary["DONE"] ?? 0;
  const inProgress = summary["IN_PROGRESS"] ?? 0;
  const blocked = summary["BLOCKED"] ?? 0;
  const planned = summary["PLANNED"] ?? 0;
  const plane = d?.plane ?? "local";
  const cloudLive = plane === "cloud";

  async function post(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/roadmap/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    return (await res.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
  }

  async function dispatchOne(key: string) {
    setBusyKey(key);
    try {
      const json = await post("dispatch", { key });
      if (json.ok) {
        const state = String(json.state ?? "?");
        const dup = json.duplicate === true;
        toast[dup ? "info" : "success"](`Milestone ${key} ${dup ? "already enqueued" : "dispatched"}`, {
          description: `task ${shortId(String(json.taskId ?? ""), 8)} · ${state} · cloud execution plane`,
        });
        void poll.refresh();
      } else {
        toast.error(`Dispatch failed: ${key}`, { description: String(json.error ?? "") });
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function dispatchAllPlanned() {
    setBulkBusy("dispatch-all");
    try {
      const phases = [...new Set((d?.milestones ?? []).filter((m) => m.status === "PLANNED").map((m) => m.phase ?? 0))];
      let dispatched = 0;
      const failed: string[] = [];
      for (const phase of phases) {
        const json = await post("dispatch-phase", { phase });
        dispatched += Number(json.dispatchedCount ?? 0);
        for (const f of (json.failed ?? []) as { key: string; error: string }[]) failed.push(`${f.key}: ${f.error}`);
      }
      if (dispatched > 0) toast.success(`Dispatched ${dispatched} milestone task(s)`, { description: failed.length ? `${failed.length} failed — see console` : "admission fence assigns READY/QUEUED" });
      else toast.info("Nothing to dispatch", { description: failed.length ? failed[0] : "no PLANNED milestones" });
      void poll.refresh();
    } finally {
      setBulkBusy("");
    }
  }

  async function syncStates() {
    setBulkBusy("sync");
    try {
      const json = await post("sync");
      const changed = (json.changed ?? []) as { key: string; from: string; to: string }[];
      if (json.ok) {
        toast[changed.length ? "success" : "info"](
          changed.length ? `Synced ${changed.length} milestone status(es)` : "Fleet and roadmap are in sync",
          {
            description: changed.slice(0, 3).map((c) => `${c.key}: ${c.from}→${c.to}`).join(" · ") || "no transitions needed",
          },
        );
        void poll.refresh();
      } else {
        toast.error("Sync failed", { description: String(json.error ?? "") });
      }
    } finally {
      setBulkBusy("");
    }
  }

  async function setStatus(key: string, status: string) {
    setBusyKey(key);
    try {
      const json = await post("set-status", { key, status });
      if (json.ok) toast.success(`${key}: ${String(json.from)} → ${status}`);
      else toast.error("Status override failed", { description: String(json.error ?? "") });
      void poll.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="roadmap-panel">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-900/50 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <Milestone className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> Milestone Runner — Compute Fabric Roadmap
              <span className="ml-auto font-mono text-[10px] normal-case text-zinc-600">
                {filtered.length}/{total} milestones
              </span>
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-600">
              <span>compute_fabric_roadmap_milestone_h205f22 · dispatch via cloud devos_fleet_enqueue_v1 · sync task → milestone</span>
              <span
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-px ${cloudLive ? "border-teal-800/60 bg-teal-500/10 text-teal-300" : "border-amber-800/60 bg-amber-500/10 text-amber-300"}`}
                title={cloudLive ? "tasks dispatch to the cloud database — the plane the live browser leases from" : `cloud unreachable — showing local rehearsal rows${d?.cloudError ? ` · ${d.cloudError}` : ""}`}
                data-testid="roadmap-plane-badge"
              >
                {cloudLive ? <Cloud className="h-3 w-3" aria-hidden /> : <HardDrive className="h-3 w-3" aria-hidden />}
                {cloudLive ? "cloud execution plane" : "local rehearsal plane"}
              </span>
              <button
                onClick={() => setAutoSync((v) => !v)}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-px transition-colors ${autoSync ? "border-emerald-800/60 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
                title={autoSync ? "auto-sync on: milestone statuses track cloud task transitions every 60s" : "auto-sync off"}
                data-testid="roadmap-autosync-toggle"
              >
                <Repeat className={`h-3 w-3 ${autoSync ? "animate-pulse" : ""}`} aria-hidden />
                auto-sync {autoSync ? "on" : "off"}
              </button>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-600" aria-hidden />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="filter milestones…"
                  className="h-7 w-44 border-zinc-800 bg-zinc-950 pl-7 font-mono text-[11px] text-zinc-300 placeholder:text-zinc-600"
                  aria-label="Filter milestones"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Status filter">
                {STATUS_FILTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                      filter === s
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                        : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                    }`}
                  >
                    {s === "ALL" ? "all" : s.toLowerCase().replace("_", "-")}
                    {s !== "ALL" && summary[s] != null && <span className="ml-1 text-zinc-600">{summary[s]}</span>}
                  </button>
                ))}
              </div>
              <span className="ml-auto flex items-center gap-1.5">
                <Button
                  size="sm" onClick={dispatchAllPlanned} disabled={bulkBusy !== "" || planned === 0}
                  className="h-7 gap-1.5 border border-emerald-500/40 bg-emerald-500/15 px-2.5 font-mono text-[10px] text-emerald-200 hover:bg-emerald-500/25"
                  data-testid="dispatch-all"
                >
                  {bulkBusy === "dispatch-all" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" aria-hidden />}
                  dispatch all PLANNED ({planned})
                </Button>
                <Button
                  size="sm" onClick={syncStates} disabled={bulkBusy !== ""}
                  className="h-7 gap-1.5 border border-zinc-700 bg-zinc-900 px-2.5 font-mono text-[10px] text-zinc-300 hover:bg-zinc-800"
                  data-testid="sync-states"
                >
                  {bulkBusy === "sync" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" aria-hidden />}
                  sync
                </Button>
              </span>
            </div>

            {/* milestone grid */}
            <ScrollArea className="max-h-[26rem] pr-2 mc-scroll">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {filtered.map((m) => (
                  <div
                    key={m.key}
                    className="group rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5 transition-colors hover:border-emerald-500/30"
                    title={`phase ${m.phase ?? "—"} · priority ${m.priority ?? "—"}${m.verifiedCheckpointId ? ` · checkpoint ${shortId(m.verifiedCheckpointId, 8)}` : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[11px] text-zinc-300 group-hover:text-emerald-300">{m.key}</p>
                        <p className="font-mono text-[9px] text-zinc-600">
                          phase {m.phase ?? "—"}
                          {m.task ? ` · ${m.task.role.toLowerCase()} · ${m.task.state.toLowerCase()}` : " · no fleet task"}
                          {m.task?.updatedAt ? ` · ${timeAgo(m.task.updatedAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <StatusBadge status={m.status} />
                        {m.status !== "DONE" && (
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => void dispatchOne(m.key)}
                            disabled={busyKey === m.key || bulkBusy !== ""}
                            className="h-5 w-5 rounded p-0 text-zinc-600 opacity-0 transition-opacity hover:bg-emerald-500/15 hover:text-emerald-300 group-hover:opacity-100"
                            aria-label={`Dispatch milestone ${m.key} to fleet`}
                            data-testid={`dispatch-${m.key}`}
                          >
                            {busyKey === m.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                    </div>
                    {/* per-milestone status override strip (hover) */}
                    <div className="mt-1 hidden flex-wrap items-center gap-1 group-hover:flex" data-testid={`override-${m.key}`}>
                      <span className="font-mono text-[8px] uppercase tracking-wider text-zinc-700">set:</span>
                      {MILESTONE_STATUSES.filter((s) => s !== m.status).map((s) => (
                        <button
                          key={s}
                          onClick={() => void setStatus(m.key, s)}
                          disabled={busyKey === m.key}
                          className="rounded border border-zinc-800 px-1 py-px font-mono text-[8px] text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-200"
                        >
                          {s.toLowerCase().replace("_", "-")}
                        </button>
                      ))}
                      {m.verifiedCheckpointId && (
                        <span className="ml-auto font-mono text-[8px] text-emerald-500/70" title={m.verifiedCheckpointId}>
                          ✓ {shortId(m.verifiedCheckpointId, 8)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && !poll.loading && (
                  <p className="col-span-full py-6 text-center font-mono text-xs text-zinc-600">
                    no milestones match filter “{query || filter.toLowerCase()}”
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
                <ListChecks className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> Status Summary
              </CardTitle>
              <CardDescription className="font-mono text-[10px] text-zinc-600">
                {done}/{total} milestones executed
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* stacked progress bar */}
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
                {(["DONE", "IN_PROGRESS", "BLOCKED", "PLANNED"] as const).map((s) => {
                  const n = summary[s] ?? 0;
                  if (n === 0 || total === 0) return null;
                  return <span key={s} className={`${PROGRESS_STYLES[s]} h-full transition-all`} style={{ width: `${(n / total) * 100}%` }} title={`${s}: ${n}`} />;
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(summary).map(([s, n]) => (
                  <div key={s} className="flex items-center gap-1.5">
                    <StatusBadge status={s} />
                    <span className="font-mono text-sm text-zinc-300 tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
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
