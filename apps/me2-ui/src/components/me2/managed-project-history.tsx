"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { History, RefreshCw } from "lucide-react";
import { getClientProjectHistoryView, type ProjectHistoryFilters } from "@/lib/client-project-history";
import { Sec } from "@/components/me2/ui/primitives";

function displayContent(value: unknown) {
  try { return JSON.stringify(value); } catch { return "(содержимое недоступно)"; }
}

export function ManagedProjectHistory({ taskId = null }: { taskId?: string | null }) {
  const resource = useMemo(() => getClientProjectHistoryView(taskId), [taskId]);
  const view = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  const [actor, setActor] = useState("");
  const [eventType, setEventType] = useState("");
  const [task, setTask] = useState("");
  const [attempt, setAttempt] = useState("");
  const [filterError, setFilterError] = useState<string | null>(null);
  useEffect(() => {
    const filters = resource.getSnapshot().filters;
    setTask(filters.task_id ?? ""); setAttempt(filters.attempt === null ? "" : String(filters.attempt));
    setEventType(filters.event_type ?? ""); setActor(""); setFilterError(null);
  }, [resource]);
  useEffect(() => {
    let active = true;
    const observe = () => { if (active && document.visibilityState === "visible") void resource.refresh(); };
    observe();
    const timer = window.setInterval(observe, 10_000);
    document.addEventListener("visibilitychange", observe);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", observe); };
  }, [resource]);
  const actors = useMemo(() => Array.from(new Set(view.entries.map((row) => row.actor).filter(Boolean) as string[])).sort(), [view.entries]);
  const visibleEntries = actor ? view.entries.filter((row) => row.actor === actor) : view.entries;
  const applyFilters = () => {
    const filters: ProjectHistoryFilters = {
      task_id: task.trim() || null,
      attempt: attempt.trim() ? Number(attempt) : null,
      event_type: eventType.trim().toUpperCase() || null,
    };
    try { setFilterError(null); void resource.setFilters(filters); }
    catch { setFilterError("Введите UUID задачи, целый номер попытки от 0 и тип события из букв, цифр и подчёркиваний."); }
  };
  return (
    <Sec id={taskId ? "task-project-history" : "code-project-history"} title="ИСТОРИЯ ПРОЕКТА" icon={History} tone="cyan"
      right={<button type="button" onClick={() => void resource.restart()} disabled={view.busy}
        title="Заново прочитать историю проекта" aria-label="Заново прочитать историю проекта"
        className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40">
        <RefreshCw className={`h-3.5 w-3.5 ${view.busy ? "animate-spin" : ""}`} aria-hidden />
      </button>}>
      <div data-testid="managed-project-history" className="space-y-2" aria-busy={view.busy}>
        <p className="text-[11px] text-zinc-500">Сохранённая история задач и действий проекта. Событие агента не подтверждает результат.</p>
        {view.state === "UNBOUND" ? <p role="status" className="text-[11px] text-zinc-500">{taskId ? "У этой задачи пока нет подтверждённой привязки к проекту." : "Проект для текущей задачи ещё не зарегистрирован."}</p> : null}
        {view.state === "LOADING" ? <p role="status" className="text-[11px] text-cyan-400">Загрузка истории…</p> : null}
        {view.state === "DEGRADED" ? <p role="alert" className="text-[11px] text-amber-400">Источник истории недоступен. Ранее прочитанные строки сохранены.</p> : null}
        {view.state === "RESYNC_REQUIRED" ? <p role="alert" className="text-[11px] text-amber-400">Обнаружены разные данные одного события. Перезагрузите историю.</p> : null}
        {view.overview ? <p className="font-mono text-[10px] text-zinc-600">{view.overview.state} · задач {view.overview.total_tasks} · проект {view.overview.project_id}</p> : null}
        {view.overview && view.state !== "UNBOUND" ? (
          <>
            {taskId && view.overview.selected_task ? <div className="space-y-1 font-mono text-[9px] text-zinc-500">
              <p>Задача {view.overview.selected_task.task_id} · глубина {view.overview.selected_task.depth} · родитель {view.overview.selected_task.parent_task_id ?? "корень проекта"}</p>
              {view.overview.immediate_children.map(child => <p key={child.task_id}>↳ {child.task_id} · {child.role} · {child.state}</p>)}
              {view.overview.children_truncated ? <p>Показаны первые 128 дочерних задач.</p> : null}
            </div> : null}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <input value={task} onChange={(event) => setTask(event.target.value)} placeholder="task UUID" aria-label="Фильтр задачи"
                className="min-w-0 rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-1 font-mono text-[9px] text-zinc-300 outline-none focus:border-cyan-900" />
              <input value={attempt} onChange={(event) => setAttempt(event.target.value)} placeholder="attempt" aria-label="Фильтр попытки" inputMode="numeric"
                className="min-w-0 rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-1 font-mono text-[9px] text-zinc-300 outline-none focus:border-cyan-900" />
              <input value={eventType} onChange={(event) => setEventType(event.target.value)} placeholder="EVENT_TYPE" aria-label="Фильтр типа события"
                className="min-w-0 rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-1 font-mono text-[9px] text-zinc-300 outline-none focus:border-cyan-900" />
              <button type="button" onClick={applyFilters} disabled={view.busy}
                className="rounded border border-zinc-700 px-1.5 py-1 text-[10px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">Фильтровать</button>
            </div>
            {filterError ? <p role="alert" className="text-[10px] text-amber-400">{filterError}</p> : null}
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9px] text-zinc-600">
              <label className="flex items-center gap-1">агент
                <select value={actor} onChange={(event) => setActor(event.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-zinc-400" aria-label="Локальный фильтр actor">
                  <option value="">все загруженные</option>{actors.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              {view.cursor ? <span>прочитано до #{view.cursor.next_seq} из {view.cursor.through_seq}{view.cursor.has_more ? " · есть продолжение" : " · история загружена"}</span> : null}
              <span className="text-zinc-700">фильтр агента действует в загруженном окне</span>
            </div>
            {view.capacityReached ? <p role="status" className="text-[10px] text-amber-400">Достигнут предел текущего окна. Нажмите «следующее окно», чтобы продолжить с сохранённой позиции.</p> : null}
            <div className="max-h-80 space-y-1 overflow-y-auto mc-scroll" aria-live="polite">
              {visibleEntries.map((entry) => (
                <div key={entry.seq} className="rounded border border-zinc-800/80 bg-zinc-950/50 p-1.5 font-mono text-[9px]">
                  <div className="flex flex-wrap gap-x-2 text-zinc-500"><span className="text-cyan-400">#{entry.seq}</span><span>{entry.event_type}</span><span>{entry.actor ?? "actor —"}</span><span>task {entry.task_id ?? "—"}</span><span>attempt {entry.attempt ?? "—"}</span></div>
                  <div className="mt-0.5 truncate text-zinc-600" title={displayContent(entry.content)}>{displayContent(entry.content)}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-zinc-700"><span>предыдущее событие {entry.causal_parent_seq ?? "—"}</span><span>{entry.source}</span><span>{entry.receipt_reference_verified ? "ссылка на квитанцию проверена; результат не подтверждён" : "результат независимо не подтверждён"}</span></div>
                </div>
              ))}
              {!visibleEntries.length && view.state === "READY" ? <p className="p-2 text-center text-[10px] text-zinc-600">В текущем окне событий нет.</p> : null}
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => void resource.nextWindow()} disabled={view.busy || (!view.capacityReached && view.cursor?.has_more !== false)}
                className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">Следующее окно</button>
              <button type="button" onClick={() => void resource.refresh()} disabled={view.busy || view.capacityReached}
                className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">{view.cursor?.has_more ? "Продолжить загрузку" : "Новые действия"}</button>
            </div>
          </>
        ) : null}
      </div>
    </Sec>
  );
}
