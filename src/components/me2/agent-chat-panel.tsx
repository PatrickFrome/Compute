"use client";
/**
 * ME2 AgentChat Panel (G1, R36) — панель флота агентных чатов.
 * Каждый член флота = постоянный чат (как эта сессия): история, tool-цикл,
 * компакция контекста, workspace. Ход идёт в фоне (202 → poll status).
 * REST daemon :3041 через gateway (/agentchat?XTransformPort=3041).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquarePlus, SendHorizontal, Trash2, RefreshCw, Brain } from "lucide-react";

type Session = {
  id: string; agent_id: string; title: string; status: "ACTIVE" | "CLOSED";
  state: "IDLE" | "THINKING"; summary: string; compactions: number;
  turns_ok: number; turns_fail: number; fail_streak: number; model: string;
  created_at: string; updated_at: string;
};
type Msg = { id: number; session_id: string; role: "user" | "assistant" | "tool" | "system"; content: string; meta: Record<string, unknown>; at: string };
type Status = { total: number; active: number; thinking: number; turns_ok: number; turns_fail: number; compactions: number; degraded: number };

const R = (p: string, init?: RequestInit) => fetch(`${p}${p.includes("?") ? "&" : "?"}XTransformPort=3041`, { cache: "no-store", ...init });

export default function AgentChatPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const j = await R("/agentchat").then((r) => r.json()) as { sessions: Session[]; status: Status };
      setSessions(j.sessions ?? []); setStatus(j.status ?? null);
      setSel((cur) => cur ?? j.sessions?.find((s) => s.status === "ACTIVE")?.id ?? null);
    } catch { /* daemon offline */ }
  }, []);

  const loadMsgs = useCallback(async (id: string) => {
    try {
      const j = await R(`/agentchat/${id}`).then((r) => r.json()) as { session: Session; messages: Msg[] };
      setMsgs(j.messages ?? []);
      setThinking(j.session?.state === "THINKING");
    } catch { /* offline */ }
  }, []);

  useEffect(() => { void loadSessions(); const t = setInterval(() => void loadSessions(), 5000); return () => clearInterval(t); }, [loadSessions]);
  useEffect(() => { if (sel) void loadMsgs(sel); }, [sel, loadMsgs]);
  // THINKING → частый poll (ход в фоне, как эта сессия)
  useEffect(() => {
    if (!sel || !thinking) return;
    const t = setInterval(() => void loadMsgs(sel), 2000);
    return () => clearInterval(t);
  }, [sel, thinking, loadMsgs]);
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }); }, [msgs]);

  const create = async () => {
    setBusy(true);
    try {
      const j = await R("/agentchat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "create", title: newTitle || undefined }) }).then((r) => r.json()) as { ok: boolean; session?: Session };
      if (j.ok && j.session) { setSel(j.session.id); setNewTitle(""); await loadSessions(); }
    } finally { setBusy(false); }
  };
  const send = async () => {
    const text = input.trim(); if (!text || !sel || thinking) return;
    setBusy(true); setInput("");
    try {
      const j = await R("/agentchat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "turn", id: sel, text }) }).then((r) => r.json()) as { ok: boolean; error?: string };
      if (j.ok) { setThinking(true); void loadMsgs(sel); } else setInput(text);
    } finally { setBusy(false); }
  };
  const close = async (id: string) => {
    await R("/agentchat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "close", id }) });
    if (sel === id) { setSel(null); setMsgs([]); }
    void loadSessions();
  };

  const selSession = sessions.find((s) => s.id === sel);

  return (
    <div className="shrink-0 border-b border-zinc-800/60 bg-black/20 px-3 py-2" data-testid="agentchat-panel" aria-label="Флот агентных чатов">
      {/* заголовок + чипы */}
      <div className="flex items-center gap-2">
        <span className="flex shrink-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-500" title="G1/ME35: флот из полноценных агентных чатов (пересборка механизма старого Electron-браузера: вкладки chat.z.ai + fleet leases → постоянные чат-сессии daemon'а). Ход = tool-цикл (файлы/shell/поиск/create_task) с компакцией контекста; каждый ход — в hash-chain evidence">
          <Brain className={`h-3 w-3 ${status && status.active > 0 ? "text-emerald-300" : "text-zinc-600"}`} aria-hidden /> AGENT·CHAT
        </span>
        <span data-testid="agentchat-chips" className="flex shrink-0 flex-wrap items-center gap-1 font-mono text-[9px]">
          <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title="всего сессий / активных">{status ? `${status.total}/${status.active}` : "—"}</span>
          <span className={`rounded border px-1 py-0.5 ${thinking ? "border-amber-900/60 bg-amber-950/30 text-amber-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`} title="ходов ok/fail; THINKING = агент работает в фоне">{status ? `${status.turns_ok}✓/${status.turns_fail}✗` : "—"}{thinking ? " · THINKING…" : ""}</span>
          <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title="компакций контекста (история не удаляется — только элиминируется из контекста, progressive disclosure)">⌁ {status?.compactions ?? "—"}</span>
          {status && status.degraded > 0 && <span className="rounded border border-rose-900/60 bg-rose-950/30 px-1 py-0.5 text-rose-300" title="сессий с 3+ провалами подряд (Outcome River v1)">deg {status.degraded}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <input
            value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="новый чат…"
            aria-label="Название нового чата"
            className="w-24 rounded border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 placeholder:text-zinc-600 focus:border-emerald-900 focus:outline-none"
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          />
          <button type="button" onClick={() => void create()} disabled={busy} aria-label="Создать чат агента" data-testid="agentchat-create" className="rounded border border-emerald-900/60 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300/90 transition hover:bg-zinc-800 disabled:opacity-40">
            <MessageSquarePlus className="h-3 w-3" aria-hidden />
          </button>
          <button type="button" onClick={() => { void loadSessions(); if (sel) void loadMsgs(sel); }} aria-label="Обновить чаты" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 transition hover:bg-zinc-800">
            <RefreshCw className="h-3 w-3" aria-hidden />
          </button>
        </span>
      </div>

      {/* список сессий */}
      {sessions.length > 0 && (
        <div className="mt-1 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
          {sessions.slice(0, 8).map((s) => (
            <button key={s.id} type="button" onClick={() => setSel(s.id)}
              title={`${s.title} · ${s.model} · ходов ${s.turns_ok}/${s.turns_fail} · компакций ${s.compactions}${s.fail_streak >= 3 ? " · ДЕГРАДАЦИЯ" : ""}`}
              aria-current={sel === s.id}
              className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] transition ${sel === s.id ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-200" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800"}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.state === "THINKING" ? "animate-pulse bg-amber-400" : s.status === "ACTIVE" ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
              {s.title.slice(0, 22)}
              <span className="text-zinc-600">{s.turns_ok}</span>
            </button>
          ))}
        </div>
      )}

      {/* лента сообщений выбранной сессии */}
      {sel && (
        <div className="mt-1.5">
          <div ref={boxRef} data-testid="agentchat-msgs" role="log" aria-label="История чата агента"
            className="max-h-44 space-y-1 overflow-y-auto rounded border border-zinc-800/80 bg-zinc-950/60 p-1.5 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar]:w-1.5">
            {msgs.length === 0 && <p className="py-2 text-center font-mono text-[9px] text-zinc-600">пусто — напиши агенту первое сообщение</p>}
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div title={`${m.role} · ${m.at}${typeof m.meta?.tool === "string" ? ` · tool: ${m.meta.tool}` : ""}`}
                  className={`max-w-[88%] rounded px-1.5 py-1 font-mono text-[9px] leading-relaxed ${m.role === "user" ? "bg-emerald-950/40 text-emerald-100" : m.role === "tool" ? "max-w-full whitespace-pre-wrap break-all border border-amber-950/50 bg-amber-950/20 text-amber-200/80" : m.role === "system" ? "w-full border border-zinc-800/60 bg-zinc-900/40 italic text-zinc-500" : "border border-zinc-800 bg-zinc-900/70 text-zinc-200"}`}>
                  {m.role === "tool" ? m.content.slice(0, 400) : m.content}
                </div>
              </div>
            ))}
            {thinking && <p className="animate-pulse pl-1 font-mono text-[9px] text-amber-300/80">агент думает и работает инструментами…</p>}
          </div>
          <div className="mt-1 flex items-center gap-1">
            <input
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={thinking ? "агент работает…" : "сообщение агенту (он умеет: файлы, shell, поиск, create_task)…"}
              aria-label="Сообщение агенту" disabled={thinking}
              data-testid="agentchat-input"
              className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900/80 px-2 py-1 font-mono text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-900 focus:outline-none disabled:opacity-50"
            />
            <button type="button" onClick={() => void send()} disabled={busy || thinking || !input.trim()} aria-label="Отправить" data-testid="agentchat-send"
              className="shrink-0 rounded border border-emerald-900/60 bg-emerald-950/30 px-2 py-1 font-mono text-[9px] text-emerald-300 transition hover:bg-zinc-800 disabled:opacity-40">
              <SendHorizontal className="h-3 w-3" aria-hidden />
            </button>
            <button type="button" onClick={() => sel && void close(sel)} aria-label="Закрыть сессию" title="Закрыть сессию (история остаётся)"
              className="shrink-0 rounded border border-zinc-800 px-1.5 py-1 font-mono text-[9px] text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-300">
              <Trash2 className="h-3 w-3" aria-hidden />
            </button>
          </div>
          {selSession && selSession.fail_streak >= 3 && (
            <p className="mt-1 font-mono text-[9px] text-rose-400" role="alert">Outcome River: {selSession.fail_streak} провалов подряд — проверь last_error сессии</p>
          )}
        </div>
      )}
    </div>
  );
}
