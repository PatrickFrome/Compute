"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/mc/badges";
import { shortId, timeAgo } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import { Bot, ScrollText, PlayCircle, PackagePlus, RefreshCw, CircleCheck, CircleX } from "lucide-react";
import { toast } from "sonner";

interface FleetTask {
  task_id: string;
  point_id: string | null;
  role: string | null;
  state: string;
  priority: number | null;
  claim_class: string | null;
  base_sha: string | null;
  lease_generation: number | null;
  lease_agent_id: string | null;
  error_code: string | null;
  objective: string | null;
  createdAt: string | null;
  finishedAt: string | null;
}

interface FleetData {
  tasks: FleetTask[];
  claims: { claimId: string; taskId: string | null; agentId: string | null; role: string | null; state: string | null; leaseGeneration: number | null; createdAt: string | null }[];
  events: { eventId: string; taskId: string | null; kind: string | null; leaseGeneration: number | null; createdAt: string | null; payloadPreview: string | null }[];
  counts: { tasks: number; claims: number; events: number; queued: number; ready: number; inflight: number; completed: number; failed: number };
}

const TASK_STATES = ["QUEUED", "READY", "LEASED", "RUNNING", "COMPLETED"] as const;

function stateTone(state: string): string {
  switch (state) {
    case "QUEUED": return "text-zinc-400 border-zinc-700";
    case "READY": return "text-amber-300 border-amber-800/60";
    case "LEASED": return "text-violet-300 border-violet-800/60";
    case "RUNNING": return "text-emerald-300 border-emerald-800/60";
    case "COMPLETED": case "RESULT_READY": return "text-emerald-200 border-emerald-700";
    case "FAILED": case "BLOCKED": case "AMBIGUOUS": return "text-rose-300 border-rose-800/60";
    default: return "text-zinc-400 border-zinc-700";
  }
}

export function FleetPanel({ poll }: { poll: PollState<FleetData> }) {
  const d = poll.data;
  const [point, setPoint] = useState("console.operator.task.v1");
  const [role, setRole] = useState("CLOSER");
  const [priority, setPriority] = useState("50");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState<"" | "enqueue" | "drive">("");
  const [lastRun, setLastRun] = useState<{ ok: boolean; steps: { step: string; status: number; ms: number; summary: Record<string, unknown> }[] } | null>(null);

  const c = d?.counts;

  async function enqueue() {
    setBusy("enqueue");
    try {
      const res = await fetch("/api/fleet/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ point, role, priority: Number(priority) || 50, objective, baseSha: "6bf173c7" }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`Task enqueued (${String(json.task?.state ?? "?")})`, { description: `${shortId(json.task?.task_id, 8)} · ${role} · prio ${priority}` });
        poll.refresh();
      } else {
        toast.error("Enqueue rejected", { description: String(json.error ?? json.result?.detail ?? "unknown") });
      }
    } catch (e) {
      toast.error("Enqueue failed", { description: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy("");
    }
  }

  async function drive() {
    setBusy("drive");
    setLastRun(null);
    try {
      const res = await fetch("/api/fleet/drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const json = await res.json();
      setLastRun(json.run ?? null);
      if (json.ok) {
        toast.success("DevOS cycle COMPLETED", { description: `task ${shortId(json.run?.taskId, 8)} · full canonical chain` });
        poll.refresh();
      } else {
        toast.error("Cycle stopped", { description: String(json.error ?? "unknown") });
      }
    } catch (e) {
      toast.error("Drive failed", { description: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4" data-testid="fleet-panel">
      {/* lifecycle counter strip */}
      <div className="flex flex-wrap items-center gap-2">
        {TASK_STATES.map((s) => (
          <Badge key={s} variant="outline" className={`font-mono text-[10px] ${stateTone(s)}`}>
            {s} {c ? String(c[s.toLowerCase() as keyof typeof c] ?? 0) : "0"}
          </Badge>
        ))}
        {(c?.failed ?? 0) > 0 && (
          <Badge variant="outline" className={`font-mono text-[10px] ${stateTone("FAILED")}`}>FINALISH-FAILED {c?.failed}</Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* enqueue + drive */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <PackagePlus className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> Operator Enqueue (R3)
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">
              canonical RPC devos_fleet_enqueue_v1 → admission fence → READY/QUEUED
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 space-y-1">
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">point_id</span>
                <Input value={point} onChange={(e) => setPoint(e.target.value)} className="h-8 border-zinc-800 bg-zinc-950/70 font-mono text-[11px] text-zinc-200 focus-visible:ring-emerald-800" />
              </label>
              <label className="space-y-1">
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">role</span>
                <Input value={role} onChange={(e) => setRole(e.target.value.toUpperCase())} className="h-8 border-zinc-800 bg-zinc-950/70 font-mono text-[11px] text-zinc-200 focus-visible:ring-emerald-800" />
              </label>
              <label className="space-y-1">
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">priority 1-99</span>
                <Input type="number" min={1} max={99} value={priority} onChange={(e) => setPriority(e.target.value)} className="h-8 border-zinc-800 bg-zinc-950/70 font-mono text-[11px] text-zinc-200 focus-visible:ring-emerald-800" />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">objective (spec)</span>
                <Input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="что должна сделать задача" className="h-8 border-zinc-800 bg-zinc-950/70 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-700 focus-visible:ring-emerald-800" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={enqueue} disabled={busy !== ""} className="h-8 gap-1.5 bg-emerald-600 font-mono text-[11px] text-zinc-950 hover:bg-emerald-500 disabled:opacity-50">
                <PackagePlus className="h-3.5 w-3.5" aria-hidden /> {busy === "enqueue" ? "Enqueuing…" : "Enqueue task"}
              </Button>
              <Button size="sm" variant="outline" onClick={drive} disabled={busy !== ""} className="h-8 gap-1.5 border-violet-800/60 font-mono text-[11px] text-violet-300 hover:bg-violet-950/40 hover:text-violet-200 disabled:opacity-50">
                <PlayCircle className="h-3.5 w-3.5" aria-hidden /> {busy === "drive" ? "Driving cycle…" : "Drive full cycle"}
              </Button>
            </div>
            {lastRun && (
              <div className="rounded border border-zinc-800/70 bg-zinc-950/60 p-2">
                <div className="mb-1 flex items-center gap-1.5">
                  {lastRun.ok ? <CircleCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> : <CircleX className="h-3.5 w-3.5 text-rose-400" aria-hidden />}
                  <span className="font-mono text-[10px] text-zinc-400">canonical chain · {lastRun.ok ? "COMPLETED" : "stopped"}</span>
                </div>
                <div className="space-y-0.5">
                  {lastRun.steps.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 font-mono text-[9px]">
                      <span className={s.status < 300 ? "text-emerald-500/80" : "text-rose-400"}>{s.step} → {s.status}</span>
                      <span className="text-zinc-600">{s.ms}ms {Object.keys(s.summary).length ? `· ${JSON.stringify(s.summary).slice(0, 60)}` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* tasks */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <Bot className="h-3.5 w-3.5 text-violet-400" aria-hidden /> DevOS Fleet Tasks
              <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-500">{d?.counts.tasks ?? 0}</Badge>
              <button onClick={() => poll.refresh()} className="ml-auto text-zinc-600 hover:text-emerald-400" aria-label="refresh fleet">
                <RefreshCw className={`h-3 w-3 ${poll.loading ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">destruktion_meta.devos_fleet_task_h205f22 · live state machine</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-80 pr-2 mc-scroll">
              {!poll.loading && (d?.tasks.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-zinc-600">
                  <Bot className="h-8 w-8 opacity-30" aria-hidden />
                  <p className="font-mono text-xs">fleet idle — enqueue a task to start the loop</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {d?.tasks.map((t) => (
                    <div key={t.task_id} className="rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-zinc-300">{shortId(t.task_id, 10)}</span>
                        <Badge variant="outline" className={`font-mono text-[9px] ${stateTone(t.state)}`}>{t.state}</Badge>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[9px] text-zinc-500">{t.point_id}{t.objective ? ` — ${t.objective}` : ""}</span>
                        <span className="font-mono text-[9px] text-zinc-600">
                          {t.role}{t.priority != null ? ` · p${t.priority}` : ""}{t.lease_agent_id ? ` · ${shortId(t.lease_agent_id, 10)} g${t.lease_generation ?? "?"}` : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* events */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
            <ScrollText className="h-3.5 w-3.5 text-teal-400" aria-hidden /> Fleet Event Stream
            <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-500">{d?.counts.events ?? 0}</Badge>
          </CardTitle>
          <CardDescription className="font-mono text-[10px] text-zinc-600">
            canonical types: TASK_ENQUEUED → TASK_LEASED → TASK_MARK_RUNNING → TASK_COMPLETED
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-56 pr-2 mc-scroll">
            {(d?.events.length ?? 0) === 0 ? (
              <p className="py-6 text-center font-mono text-xs text-zinc-600">no fleet events yet</p>
            ) : (
              <div className="grid gap-1.5 md:grid-cols-2">
                {d?.events.map((ev) => (
                  <div key={ev.eventId} className="rounded border border-zinc-800/70 bg-zinc-900/60 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-mono text-[10px] ${ev.kind?.startsWith("TASK_COMPLETED") ? "text-emerald-300" : ev.kind?.includes("FAIL") || ev.kind?.includes("EXPIRED") ? "text-rose-300" : "text-teal-300"}`}>{ev.kind ?? "?"}</span>
                      <span className="font-mono text-[9px] text-zinc-600">{timeAgo(ev.createdAt)}</span>
                    </div>
                    <p className="truncate font-mono text-[9px] text-zinc-600">{shortId(ev.taskId, 8)}{ev.leaseGeneration != null ? ` · g${ev.leaseGeneration}` : ""} · {ev.payloadPreview ?? "—"}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
