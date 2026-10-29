"use client";
import {useState} from 'react';
import {useClientProjectTasks} from '@/hooks/use-client-project-tasks';
import {ManagedProjectHistory} from '@/components/me2/managed-project-history';
import {useMe2} from '@/components/me2/store';

import {PROJECT_TASK_GROUPS as GROUPS,projectTaskMatchesGroup} from '@/lib/client-project-tasks';
export function TasksPage(){
  const {resource,view}=useClientProjectTasks(),setPage=useMe2(state=>state.setPage);
  const [filter,setFilter]=useState<typeof GROUPS[number]>('Все'),[query,setQuery]=useState('');
  const page=view.page,search=query.trim().toLowerCase();
  const tasks=(page?.tasks??[]).filter(task=>projectTaskMatchesGroup(task.state,filter)&&(!search||`${task.task_id} ${task.role} ${task.objective??''}`.toLowerCase().includes(search)));
  const selected=page?.tasks.find(task=>task.task_id===view.selectedTaskId);
  return <div className="mx-auto max-w-[1200px] space-y-4" data-testid="page-tasks" data-source="NATIVE_PROJECT_API">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-medium">Задачи проекта</h1>
      <p className="mt-1 text-sm text-zinc-400">Состояние задач из локального проекта. Этот экран не запускает и не повторяет выполнение.</p></div>
      <button type="button" onClick={()=>void resource.refresh()} disabled={view.busy} className="min-h-9 rounded border border-zinc-700 px-3 text-sm disabled:opacity-40">{view.busy?'Чтение…':'Обновить'}</button></header>
    <p role="status" className="text-sm text-zinc-400">{view.state==='LOADING'?'Чтение проекта…':view.state==='UNBOUND'?'Для текущей цели ещё нет зарегистрированного проекта.':
      view.state==='UNAVAILABLE'?'Мост проектов недоступен. Откройте подключённый клиент.':view.state==='DEGRADED'?'Текущий ответ не подтверждён. Сохранённая страница ниже может быть устаревшей.':
      `Наблюдение ${view.observedAt?new Date(view.observedAt).toLocaleTimeString():''}. Завершение в БД само по себе не доказывает непрерывную автономную разработку.`}</p>
    {!page?<button type="button" onClick={()=>setPage('browser')} className="min-h-9 rounded border border-zinc-700 px-3 text-sm">Открыть цель и Run</button>:<>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4"><h2 className="whitespace-pre-wrap break-words text-sm">{page.goal}</h2>
        <p className="mt-2 break-all font-mono text-xs text-zinc-500">Проект {page.project_id} · {page.state} · всего задач {page.total_tasks}</p>
        <p className="mt-1 text-xs text-zinc-400">На странице {page.tasks.length} задач; фильтры и очередь относятся только к этой странице.</p></section>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Фильтр состояния задач">{GROUPS.map(name=><button key={name} type="button" onClick={()=>setFilter(name)} aria-pressed={filter===name}
        className={`min-h-8 rounded border px-3 text-xs ${filter===name?'border-cyan-700 text-cyan-200':'border-zinc-700 text-zinc-400'}`}>{name}</button>)}</div>
      <input aria-label="Поиск по задачам текущей страницы" value={query} onChange={event=>setQuery(event.target.value)} placeholder="ID, роль или цель задачи" className="h-9 w-full rounded border border-zinc-700 bg-zinc-950 px-3 text-sm" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><section aria-label="Задачи текущей страницы" className="space-y-2">
        {tasks.map(task=><button type="button" key={task.task_id} onClick={()=>resource.selectTask(task.task_id)} aria-pressed={selected?.task_id===task.task_id}
          className={`w-full rounded-lg border p-3 text-left ${selected?.task_id===task.task_id?'border-cyan-700 bg-cyan-950/20':'border-zinc-800 bg-zinc-950/40'}`}>
          <span className="flex flex-wrap justify-between gap-2 text-xs"><span>{task.role} · #{task.task_seq}</span><span>{task.state}</span></span>
          <span className="mt-2 block break-words text-sm text-zinc-300">{task.objective||task.task_id}</span>
          <span className="mt-2 block break-all font-mono text-[10px] text-zinc-500">{task.task_id} · родитель {task.parent_task_id??'корень'} · глубина {task.depth}</span>
          <span className="mt-1 block text-xs text-cyan-300">Открыть историю этой задачи</span></button>)}
        {!tasks.length?<p className="p-3 text-sm text-zinc-400">На этой странице задач по выбранному фильтру нет.</p>:null}
      </section><section aria-label="История выбранной задачи">{selected?<><h2 className="mb-2 break-all text-sm">{selected.role} · {selected.task_id}</h2>
        <ManagedProjectHistory key={selected.task_id} taskId={selected.task_id}/></>:<p className="p-4 text-sm text-zinc-400">Выберите задачу, чтобы прочитать её сохранённую историю.</p>}</section></div>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Страницы задач"><button type="button" onClick={()=>void resource.firstPage()} disabled={view.busy||page.cursor.after_seq===0} className="min-h-8 rounded border border-zinc-700 px-3 text-xs disabled:opacity-40">В начало</button>
        <button type="button" onClick={()=>void resource.previousPage()} disabled={view.busy||!view.canGoBack} className="min-h-8 rounded border border-zinc-700 px-3 text-xs disabled:opacity-40">Назад</button>
        <span className="text-xs text-zinc-500">#{page.cursor.after_seq+1}–{page.cursor.next_seq}</span>
        <button type="button" onClick={()=>void resource.nextPage()} disabled={view.busy||!page.cursor.has_more} className="min-h-8 rounded border border-zinc-700 px-3 text-xs disabled:opacity-40">Следующая страница</button></nav>
    </>}
  </div>;
}
