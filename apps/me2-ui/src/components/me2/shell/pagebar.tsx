"use client";
import { PAGES, useMe2, type PageKey } from "@/components/me2/store";
const primary: PageKey[] = ["command", "tasks", "code", "agents", "supervisor"];
export function PageBar() {
  const page = useMe2(s => s.page);
  const setPage = useMe2(s => s.setPage);
  const secondary = PAGES.filter(p => !primary.includes(p.key));
  return (
    <nav aria-label="Этапы работы" data-testid="pagebar" className="flex min-h-12 shrink-0 items-center gap-1 overflow-x-auto border-t border-zinc-800 px-3">
      {primary.map(key => {
        const p = PAGES.find(item => item.key === key)!;
        return <button type="button" key={key} aria-current={page === key ? "page" : undefined}
          data-testid={`page-tab-${key}`} data-panel-tab={key} onClick={() => setPage(key)}
          title={`${p.label} · Alt+${p.num}`}
          className={`h-10 shrink-0 border-t-2 px-3 text-xs ${page === key ? "border-zinc-200 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}>{p.label}</button>;
      })}
      <label className="ml-auto flex shrink-0 items-center text-xs text-zinc-400">
        <span className="sr-only">Дополнительные разделы</span>
        <select aria-label="Дополнительные разделы" value={secondary.some(p => p.key === page) ? page : ""}
          onChange={event => { if (event.target.value) setPage(event.target.value as PageKey); }}
          className="h-9 max-w-40 rounded border border-zinc-800 bg-zinc-950 px-2 text-xs">
          <option value="" disabled>Инструменты</option>
          {secondary.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
    </nav>
  );
}
