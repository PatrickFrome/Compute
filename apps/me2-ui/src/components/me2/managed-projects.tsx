"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import { createManagedProjectsView, type ManagedProjectBridge } from "@/lib/client-managed-projects";
import { Sec } from "@/components/me2/ui/primitives";

const stateLabel = { RESERVED: "Ожидает создания", READY: "Создан", FROZEN: "Приостановлен" };

export function ManagedProjects() {
  const resource = useMemo(() => createManagedProjectsView({
    bridge: () => (window as Window & { metaengineClient?: ManagedProjectBridge }).metaengineClient ?? null,
  }), []);
  const view = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => {
    let active = true;
    const observe = () => {
      if (active && document.visibilityState === "visible" && resource.getSnapshot().pending === null) void resource.refresh();
    };
    observe();
    const timer = window.setInterval(observe, 10_000);
    document.addEventListener("visibilitychange", observe);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", observe);
    };
  }, [resource]);
  const available = view.status?.state === "AVAILABLE";
  return (
    <Sec id="code-managed-projects" title="ПРОЕКТЫ ЗАДАЧ" icon={GitBranch} tone="violet"
      right={<button type="button" onClick={() => void resource.refresh()} disabled={view.loading || view.pending !== null}
        title="Обновить состояние проектов" aria-label="Обновить состояние проектов"
        className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40">
        <RefreshCw className={`h-3.5 w-3.5 ${view.loading ? "animate-spin" : ""}`} aria-hidden />
      </button>}>
      <div data-testid="managed-projects" className="space-y-2" aria-busy={view.loading || view.pending !== null}>
        <p className="text-[11px] text-zinc-500">Проекты назначенных задач. Создание и открытие выполняет клиент после проверки доступа.</p>
        {view.loading ? <p role="status" className="text-[11px] text-cyan-400">Обновление состояния проектов…</p>
          : !available ? <p role="status" className="text-[11px] text-amber-400">Управление проектами сейчас недоступно. Проверьте подключение клиента и назначение задач.</p>
          : view.status?.projects.length === 0 ? <p className="text-[11px] text-zinc-500">Назначенные проекты пока отсутствуют.</p> : null}
        {view.error ? <p role="alert" className="text-[11px] text-amber-400">
          Операция не подтверждена. Проверьте состояние проекта перед повтором.
        </p> : null}
        {view.completed ? <p role="status" className="text-[11px] text-emerald-400">
          {view.completed.action === "open" ? "Проект открыт." : "Создание проекта подтверждено."}
        </p> : null}
        {(view.status?.projects ?? []).map((project) => {
          const pending = view.pending?.workspaceId === project.workspace_id;
          const disabled = !available || view.loading || view.pending !== null;
          return (
            <div key={project.workspace_id} className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 break-all font-medium text-zinc-200">Задача {project.task_id}</span>
                <span className={project.state === "READY" ? "text-emerald-400" : "text-zinc-500"}>
                  {pending || project.in_flight ? "Операция выполняется…" : stateLabel[project.state]}
                </span>
              </div>
              <p className="break-all font-mono text-[10px] text-zinc-500">{project.repo_id} · {project.branch_name || "ветка ещё не задана"}</p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void resource.create(project.workspace_id)}
                  disabled={disabled || !project.can_create}
                  aria-label={`Создать проект задачи ${project.task_id}`}
                  className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">Создать</button>
                <button type="button" onClick={() => void resource.open(project.workspace_id)}
                  disabled={disabled || !project.can_open}
                  aria-label={`Открыть проект задачи ${project.task_id}`}
                  className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">Открыть</button>
              </div>
            </div>
          );
        })}
        {view.pending && !view.status ? <p role="status" className="text-[11px] text-cyan-400">Операция выполняется…</p> : null}
      </div>
    </Sec>
  );
}
