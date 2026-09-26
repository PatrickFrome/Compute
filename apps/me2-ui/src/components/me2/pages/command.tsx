"use client";
import { useCallback, useEffect, useState } from "react";
import { me2Desktop, type WebConversation } from "@/lib/me2-desktop";
import { BrowserStage } from "@/components/me2/stages/browser-stage";
import { useMe2 } from "@/components/me2/store";

/** Web conversations come only from the native registry. API chat IDs are not bindings. */
export function CommandPage() {
  const [native, setNative] = useState(false);
  const [conversations, setConversations] = useState<WebConversation[]>([]);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setPage = useMe2(s => s.setPage);
  const refresh = useCallback(async () => {
    const bridge = me2Desktop()?.webConversations;
    if (!bridge) return;
    try {
      const result = await bridge.list();
      if (result.ok) setConversations(result.conversations);
      else setError("Список бесед недоступен. Откройте диагностику.");
    } catch { setError("Нет связи с desktop-клиентом."); }
  }, []);
  useEffect(() => {
    let active = true;
    const bridge = me2Desktop()?.webConversations;
    setNative(Boolean(bridge));
    const load = async () => {
      if (!bridge) return;
      try {
        const result = await bridge.list();
        if (active) {
          if (result.ok) setConversations(result.conversations);
          else setError("Список бесед недоступен. Откройте диагностику.");
        }
      } catch { if (active) setError("Нет связи с desktop-клиентом."); }
    };
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, []);
  const act = async (kind: "create" | "open" | "focus", id = "") => {
    const bridge = me2Desktop()?.webConversations;
    if (!bridge || busy) return;
    setBusy(true); setError("");
    try {
      const result = await (kind === "create" ? bridge.create() : kind === "open" ? bridge.open(url.trim()) : bridge.focus(id));
      if (!result.ok) {
        const messages: Record<string, string> = {
          web_conversation_url_required: "Укажите ссылку на беседу chat.z.ai/c/…",
          conversation_not_proven: "Беседа не подтверждена. Проверьте вход на сайт.",
          tab_ceiling_reached: "Достигнут лимит открытых бесед.",
          conversation_unavailable: "Вкладка недоступна. Обновите список.",
        };
        setError(messages[result.reason ?? ""] ?? "Не удалось открыть беседу. Проверьте диагностику.");
      }
      await refresh();
    } catch { setError("Нет связи с desktop-клиентом."); }
    finally { setBusy(false); }
  };
  const filtered = conversations.filter(row => (row.conversation_url ?? "Новая беседа").toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 md:flex-row" data-testid="page-command">
      <aside className="flex shrink-0 flex-col gap-3 border-b border-zinc-800 p-3 md:w-60 md:border-b-0 md:border-r" aria-label="Web-беседы">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-medium">Рабочие беседы</h1>
          {native && <button type="button" onClick={() => void refresh()} className="text-xs text-zinc-500 hover:text-zinc-200">Обновить</button>}
        </div>
        {native && <button type="button" disabled={busy} onClick={() => void act("create")}
          className="rounded border border-zinc-700 px-3 py-2 text-left text-sm hover:bg-zinc-900 disabled:opacity-50">Новая беседа</button>}
        {native && <input aria-label="Поиск бесед" placeholder="Поиск бесед" value={query} onChange={e => setQuery(e.target.value)}
          className="w-full rounded border border-zinc-800 bg-transparent px-3 py-2 text-xs outline-none" />}
        <div className="max-h-40 space-y-1 overflow-y-auto md:max-h-none md:flex-1">
          {native && filtered.map((row, index) => <button type="button" key={row.tab_id} disabled={busy || row.state === "INVALIDATED"}
            onClick={() => void act("focus", row.tab_id)} title={row.conversation_url ?? "Новая беседа"}
            className="block w-full rounded px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">
            <span className="block truncate">{row.conversation_url ? `Беседа ${row.conversation_url.split('/').pop()?.slice(0, 12)}` : `Новая беседа ${index + 1}`}</span>
            <span className="mt-1 block text-[11px] text-zinc-500">{row.state === "INVALIDATED" ? "Вкладка недоступна" : row.state === "UNBOUND" ? "Ожидает начала" : "Открыта"}</span>
          </button>)}
          {native && filtered.length === 0 && <p className="py-3 text-xs leading-5 text-zinc-500">{query ? "Совпадений нет" : "Открытых бесед пока нет"}</p>}
          {!native && <p className="text-xs leading-5 text-zinc-500">Браузерная сессия доступна в рабочей области справа.</p>}
        </div>
        <button type="button" onClick={() => setPage("tasks")} className="py-2 text-left text-xs text-zinc-400 hover:text-zinc-200">Перейти к задачам</button>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Рабочая область">
        {native ? <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8">
          <div className="w-full max-w-lg">
            <h2 className="text-xl font-medium tracking-tight">Продолжите работу в беседе</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">Выберите открытую беседу слева или добавьте существующую по ссылке.</p>
            <form className="mt-6 flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); void act("open"); }}>
              <input type="url" required aria-label="Ссылка на web-беседу" placeholder="https://chat.z.ai/c/…" value={url} onChange={e => setUrl(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 text-sm" />
              <button type="submit" disabled={busy || !url.trim()} className="h-11 rounded bg-zinc-200 px-4 text-sm font-medium text-zinc-950 disabled:opacity-40">Открыть</button>
            </form>
            <p className="mt-4 text-xs text-zinc-500">Вернуться сюда: Ctrl+1 или меню MetaEngine.</p>
          </div>
        </div> : <BrowserStage compact defaultCastOn />}
        {error && <p role="alert" className="border-t border-zinc-800 px-4 py-3 text-sm text-amber-300">{error}</p>}
      </section>
    </div>
  );
}
