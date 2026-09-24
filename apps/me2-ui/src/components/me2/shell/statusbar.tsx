"use client";
// ── STATUSBAR: глобальная строка состояния (VS Code-принцип: кликабельные сегменты)

import { useMe2 } from "@/components/me2/store";
import { budgetFlush } from "@/lib/me2-bus";
import { Gauge, GitBranch, Bot, ListChecks, Database, Timer, Server } from "lucide-react";
import { hhmmss } from "@/lib/me2-bus";

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

  return (
    <footer
      data-testid="statusbar"
      className="flex h-7 shrink-0 items-center gap-3 overflow-x-auto border-t border-zinc-800 bg-zinc-950 px-3 font-mono text-[9px] text-zinc-500 mc-scroll"
    >
      <button type="button" className="flex items-center gap-1 hover:text-emerald-300" onClick={() => setPage("observability")} title="daemon → OBSERVABILITY">
        <Server className="h-3 w-3" aria-hidden />
        daemon {snap ? "live" : "offline"}
      </button>
      <button type="button" className="flex items-center gap-1 hover:text-emerald-300" onClick={() => setPage("agents")} title="флот → AGENTS">
        <Bot className="h-3 w-3" aria-hidden />
        флот {stats.agentsBusy ?? 0}busy/{stats.agentsIdle ?? 0}idle
      </button>
      <button type="button" className="flex items-center gap-1 hover:text-emerald-300" onClick={() => setPage("tasks")} title="задачи → TASKS">
        <ListChecks className="h-3 w-3" aria-hidden />
        {stats.tasksReady ?? 0}ready·{stats.tasksRunning ?? 0}run·{stats.tasksCompleted ?? 0}done·{stats.tasksFailed ?? 0}fail
      </button>
      <button
        type="button"
        data-testid="statusbar-budget"
        className={`flex items-center gap-1 hover:text-fuchsia-300 ${budgetPct >= 75 ? "text-fuchsia-400" : ""}`}
        onClick={() => setDialog("budget")}
        title="бюджет шины → BUDGET_ADJUST"
      >
        <Gauge className="h-3 w-3" aria-hidden />
        бюджет {budgetUsed}/{budgetLimit}
      </button>
      <button type="button" className="flex items-center gap-1 hover:text-emerald-300" onClick={() => setPage("observability")} title="SQL-зеркало → OBSERVABILITY">
        <Database className="h-3 w-3" aria-hidden />
        зеркало {mirror?.mode ?? "…"}
        {mirror && mirror.pending > 0 ? `·outbox ${mirror.pending}` : ""}
      </button>
      {deferred > 0 && (
        <span className="flex items-center gap-1 text-lime-400" title="отложенные команды (ETA) — COMMAND BUS в OBSERVABILITY">
          <Timer className="h-3 w-3" aria-hidden />
          отложено {deferred}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap" title="boot + контракты портов">
        <GitBranch className="h-3 w-3" aria-hidden />
        boot {snap?.meta.boot ? hhmmss(snap.meta.boot) : "—"} · ws :3040 · rest :3041
      </span>
      <button
        type="button"
        className="shrink-0 text-rose-500/70 hover:text-rose-300"
        onClick={() => { void budgetFlush(); }}
        title="BUDGET_FLUSH (EMERGENCY): сброс очереди шины"
      >
        flush
      </button>
    </footer>
  );
}
