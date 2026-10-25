"use client";
import {CommandDialog,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList,CommandSeparator} from '@/components/ui/command';
import {PAGES,useMe2} from '@/components/me2/store';
import {useClientProjectTasks} from '@/hooks/use-client-project-tasks';

export function CommandPalette(){
  const open=useMe2(state=>state.paletteOpen),setOpen=useMe2(state=>state.setPalette),setPage=useMe2(state=>state.setPage);
  const {resource,view}=useClientProjectTasks();
  return <CommandDialog open={open} onOpenChange={setOpen} title="Поиск по рабочей области" description="Открыть доступный экран или задачу текущего проекта."
    className="mc-dark border-zinc-700 bg-[#111114] text-zinc-100 [&_[data-slot=command]]:bg-[#111114]" showCloseButton={false}
    onCloseAutoFocus={event=>{event.preventDefault();document.querySelector<HTMLButtonElement>('[data-testid="global-cmdbar"]')?.focus();}}>
    <div className="flex items-center border-b border-zinc-800"><CommandInput placeholder="Экран, ID задачи, роль или цель…" aria-label="Поиск по экранам и задачам"/>
      <button type="button" onClick={()=>setOpen(false)} className="mx-2 min-h-8 px-2 text-xs">Закрыть</button></div>
    <CommandList className="max-h-[min(480px,65vh)]"><CommandEmpty>На текущей странице задач совпадений нет.</CommandEmpty>
      <CommandGroup heading="Рабочая область">{PAGES.map(page=><CommandItem key={page.key} value={`screen ${page.key} ${page.label}`}
        onSelect={()=>{setPage(page.key);setOpen(false);}}>{page.label}</CommandItem>)}</CommandGroup>
      <CommandSeparator/>
      <CommandGroup heading={`Задачи текущей страницы проекта · ${view.page?.tasks.length??0}`}>
        {(view.page?.tasks??[]).map(task=><CommandItem key={task.task_id} value={`${task.task_id} ${task.role} ${task.objective??''}`}
          onSelect={()=>{if(resource.selectTask(task.task_id)){setPage('tasks');setOpen(false);}}}>
          <span className="min-w-0 flex-1 truncate">{task.objective||task.task_id}</span><span className="ml-2 text-xs text-zinc-400">{task.role} · {task.state}</span>
        </CommandItem>)}
        <CommandItem value="open project tasks next page refresh" onSelect={()=>{setPage('tasks');setOpen(false);}}>Все страницы задач и очередь…</CommandItem>
      </CommandGroup>
    </CommandList>
    <p role="status" className="border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">{view.busy?'Чтение задач…':view.state==='OBSERVED'?'Поиск по текущей подтверждённой странице проекта.':
      view.state==='DEGRADED'?'Текущий ответ недоступен; сохранённая страница может быть устаревшей.':view.state==='UNBOUND'?'Для текущей цели проект ещё не зарегистрирован.':'Источник задач недоступен.'}</p>
  </CommandDialog>;
}
