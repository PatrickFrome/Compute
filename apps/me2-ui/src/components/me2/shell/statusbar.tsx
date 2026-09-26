"use client";
// ── STATUSBAR R85: read-only attention line ───────────────────────────────────
// Persistent chrome may navigate to detail, but never executes destructive or
// emergency mutations. Raw telemetry belongs to its dedicated page.

import { useMe2 } from "@/components/me2/store";
import { Gauge, Bot, ListChecks, Database, Timer, Server, AlertTriangle } from "lucide-react";

export function StatusBar() {
  const snap = useMe2((s) => s.snap);
  const mirror = useMe2((s) => s.mirror);
  const setDialog = useMe2((s) => s.setDialog);
  const setPage = useMe2((s) => s.setPage);
  const stats = snap?.stats ?? {};
  const budgetUsed = snap?.budget.used ?? 0;
  const budgetLimit = snap?.budget.limit ?? 24;
  const budgetPct = Math.min(100, Math.round((budgetUsed / Math.max(1, budgetLimit)) * 100));
  const deferred = (snap?.commands ?? []).filter((c) => c.status === "PENDING" && c.run_after).length;
  const mirrorAttention = Boolean(mirror && (mirror.mode !== "LIVE" || mirror.pending > 0));

  return (
    <footer
      data-testid="statusbar"
      className="flex h-[22px] shrink-0 items-center gap-3 overflow-x-auto border-t border-zinc-900 bg-[#08080a] px-2 font-mono text-[8px] text-zinc-600 mc-scroll"
    >
      <button type="button" className="flex shrink-0 items-center gap-1 hover:text-zinc-300" onClick={() => setPage("observability")} title="Runtime details">
        <Server className="h-2.5 w-2.5" aria-hidden />
        {snap ? "runtime live" : "runtime offline"}
      </button>
      <button type="button" className="flex shrink-0 items-center gap-1 hover:text-zinc-300" onClick={() => setPage("agents")} title="Agents">
        <Bot className="h-2.5 w-2.5" aria-hidden />
        {stats.agentsBusy ?? 0} busy · {stats.agentsIdle ?? 0} idle
      </button>
      <button type="button" className="flex shrink-0 items-center gap-1 hover:text-zinc-300" onClick={() => setPage("tasks")} title="Tasks">
        <ListChecks className="h-2.5 w-2.5" aria-hidden />
        {stats.tasksReady ?? 0} ready · {stats.tasksRunning ?? 0} run · {stats.tasksFailed ?? 0} fail
      </button>
      <button
        type="button"
        data-testid="statusbar-budget"
        className={`flex shrink-0 items-center gap-1 hover:text-zinc-300 ${budgetPct >= 75 ? "text-amber-400" : ""}`}
        onClick={() => setDialog("budget")}
        title="Command budget"
      >
        <Gauge className="h-2.5 w-2.5" aria-hidden />
        budget {budgetUsed}/{budgetLimit}
      </button>
      <button
        type="button"
        className={`flex shrink-0 items-center gap-1 hover:text-zinc-300 ${mirrorAttention ? "text-amber-400" : ""}`}
        onClick={() => setPage("observability")}
        title={`Mirror ${mirror?.mode ?? "unknown"} · outbox ${mirror?.pending ?? 0}`}
      >
        {mirrorAttention ? <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> : <Database className="h-2.5 w-2.5" aria-hidden />}
        mirror {mirror?.mode ?? "…"}{mirror && mirror.pending > 0 ? ` · ${mirror.pending} queued` : ""}
      </button>
      {deferred > 0 ? (
        <button type="button" className="flex shrink-0 items-center gap-1 text-lime-400" onClick={() => setPage("observability")} title="Deferred commands">
          <Timer className="h-2.5 w-2.5" aria-hidden />
          {deferred} deferred
        </button>
      ) : null}
      <span className="ml-auto shrink-0 whitespace-nowrap text-zinc-700" title="Local ME2 service transport">
        ws :3040 · rest :3041
      </span>
    </footer>
  );
}
