"use client";

import { Bot, Eye, ListChecks } from "lucide-react";
import { useMe2 } from "@/components/me2/store";
import { age } from "@/lib/me2-bus";
import { StatusBadge } from "@/components/me2/ui/primitives";

function Meta({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <div className="min-w-0">
      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-zinc-600">{label}</p>
      <p className="truncate font-mono text-[10px] text-zinc-300" title={String(value)}>{String(value)}</p>
    </div>
  );
}

export function PeekInspector() {
  const target = useMe2((s) => s.peekTarget);
  const snap = useMe2((s) => s.snap);
  if (!target || !snap) return null;

  const task = target.kind === "task"
    ? snap.tasks.find((item) => item.id === target.id)
      ?? (snap.archived ?? []).find((item) => item.id === target.id)
      ?? null
    : null;
  const agent = target.kind === "agent"
    ? snap.agents.find((item) => item.id === target.id) ?? null
    : null;

  if (!task && !agent) return null;

  return (
    <aside
      className="pointer-events-none fixed right-5 top-[88px] z-[75] w-[min(520px,calc(100vw-40px))] overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-950/95 shadow-2xl backdrop-blur"
      data-testid="peek-inspector"
      data-peek-kind={target.kind}
      data-peek-id={target.id}
      aria-label={target.kind === "task" ? "Temporary task preview" : "Temporary agent preview"}
      aria-live="polite"
    >
      <div className="flex h-9 items-center gap-2 border-b border-zinc-800 px-3">
        <Eye className="h-3.5 w-3.5 text-cyan-400" aria-hidden />
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Peek</span>
        <span className="ml-auto font-mono text-[8px] text-zinc-600">hold Space · ↑/↓ browse · release close</span>
      </div>

      {task ? (
        <div className="p-3" data-testid="peek-task">
          <div className="flex items-start gap-2">
            <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100">{task.title}</h3>
                <StatusBadge status={task.status} />
              </div>
              <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-[11px] leading-4 text-zinc-400">{task.spec}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-800 pt-3 sm:grid-cols-4">
            <Meta label="steps" value={`${task.steps}/${task.max_steps}`} />
            <Meta label="role" value={task.role ?? "ANY"} />
            <Meta label="agent" value={task.agent_id} />
            <Meta label="age" value={age(task.updated_at)} />
          </div>
          {task.error ? (
            <div className="mt-3 rounded-md border border-rose-950 bg-rose-950/20 px-2.5 py-2">
              <p className="font-mono text-[8px] uppercase tracking-wide text-rose-500">error</p>
              <p className="mt-0.5 line-clamp-4 text-[10px] leading-4 text-rose-300">{task.error}</p>
            </div>
          ) : task.result ? (
            <div className="mt-3 rounded-md border border-emerald-950 bg-emerald-950/20 px-2.5 py-2">
              <p className="font-mono text-[8px] uppercase tracking-wide text-emerald-600">result</p>
              <p className="mt-0.5 line-clamp-4 text-[10px] leading-4 text-emerald-300">{task.result}</p>
            </div>
          ) : null}
          <p className="mt-3 truncate font-mono text-[8px] text-zinc-700">{task.id}</p>
        </div>
      ) : null}

      {agent ? (
        <div className="p-3" data-testid="peek-agent">
          <div className="flex items-start gap-2">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100">{agent.role}</h3>
                <StatusBadge status={agent.paused === 1 ? "PAUSED" : agent.status} />
              </div>
              <p className="mt-1 font-mono text-[10px] text-zinc-500">{agent.model}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-800 pt-3">
            <Meta label="state" value={agent.status} />
            <Meta label="paused" value={agent.paused === 1 ? "yes" : "no"} />
            <Meta label="updated" value={age(agent.updated_at)} />
            <Meta label="created" value={age(agent.created_at)} />
          </div>
          <p className="mt-3 truncate font-mono text-[8px] text-zinc-700">{agent.id}</p>
        </div>
      ) : null}
    </aside>
  );
}
