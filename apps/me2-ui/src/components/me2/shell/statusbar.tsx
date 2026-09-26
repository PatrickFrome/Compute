"use client";
import { useMe2 } from "@/components/me2/store";
export function StatusBar() {
  const connected = useMe2(s => s.connected);
  const snap = useMe2(s => s.snap);
  const setPage = useMe2(s => s.setPage);
  const failed = snap?.stats?.tasksFailed ?? 0;
  return (
    <footer data-testid="statusbar" className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-800 px-4 text-[11px] text-zinc-500">
      <button type="button" onClick={() => setPage("observability")} className="hover:text-zinc-200">
        {connected ? "Связь с системой установлена" : "Нет постоянного соединения"}
      </button>
      {failed > 0 && <button type="button" onClick={() => setPage("tasks")} className="text-amber-300">Ошибки задач: {failed}</button>}
      <button type="button" onClick={() => setPage("system")} className="ml-auto hover:text-zinc-200">Настройки</button>
    </footer>
  );
}
