"use client";
// ── STATUSBAR R85: read-only attention line ───────────────────────────────────
// Persistent chrome may navigate to detail, but never executes destructive or
// emergency mutations. Raw telemetry belongs to its dedicated page.

import { useMe2 } from "@/components/me2/store";
import { useClientRuntimeStatus } from "@/hooks/use-client-runtime-status";
import { Gauge, Bot, ListChecks, Timer, Server } from "lucide-react";

export function StatusBar() {
  const snap = useMe2((s) => s.snap);
  const connected = useMe2((s) => s.connected);
  const runtime = useClientRuntimeStatus();
  const work = runtime.readback?.work;
  const setDialog = useMe2((s) => s.setDialog);
  const setPage = useMe2((s) => s.setPage);
  const budgetUsed = snap?.budget.used ?? 0;
  const budgetLimit = snap?.budget.limit ?? 24;
  const budgetPct = Math.min(100, Math.round((budgetUsed / Math.max(1, budgetLimit)) * 100));
  const deferred = (snap?.commands ?? []).filter((c) => c.status === "PENDING" && c.run_after).length;

  return (
    <footer
      data-testid="statusbar"
      className="flex h-[22px] shrink-0 items-center gap-2.5 overflow-x-auto border-t border-zinc-900 bg-[#08080a] px-2 font-mono text-[9px] text-zinc-500 mc-scroll"
    >
      <button type="button" className="flex shrink-0 items-center gap-1 hover:text-zinc-300" onClick={() => setPage("observability")} title="Runtime details">
        <Server className="h-2.5 w-2.5" aria-hidden />
        {work?.label || "Native status unavailable"}
      </button>
      <button type="button" className="flex shrink-0 items-center gap-1 hover:text-zinc-300" onClick={() => setPage("browser")} title="Agents">
        <Bot className="h-2.5 w-2.5" aria-hidden />
        {work?.proven_agent_count ?? "?"} verified · {work ? (work.bound_unverified_agent_count ?? 0) + work.ambiguous_agent_count : "?"} unverified
      </button>
      <button type="button" className="flex shrink-0 items-center gap-1 hover:text-zinc-300" onClick={() => setPage("tasks")} title="Tasks">
        <ListChecks className="h-2.5 w-2.5" aria-hidden />
        Diagnostic task counters
      </button>
      <button
        type="button"
        data-testid="statusbar-budget"
        className={`flex shrink-0 items-center gap-1 hover:text-zinc-300 ${budgetPct >= 75 ? "text-amber-400" : ""}`}
        onClick={() => setDialog("budget")}
        title="Read-only diagnostic budget; this is not the Native execution quota"
      >
        <Gauge className="h-2.5 w-2.5" aria-hidden />
        diagnostic budget {budgetUsed}/{budgetLimit}
      </button>
      {deferred > 0 ? (
        <button type="button" className="flex shrink-0 items-center gap-1 text-lime-400" onClick={() => setPage("observability")} title="Deferred commands">
          <Timer className="h-2.5 w-2.5" aria-hidden />
          {deferred} deferred
        </button>
      ) : null}
      <span className="ml-auto shrink-0 whitespace-nowrap text-zinc-700" title="ME2 compatibility projection">
        diagnostics {connected ? "connected" : snap ? "cached" : "offline"}
      </span>
    </footer>
  );
}
