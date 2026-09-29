"use client";
/**
 * ME2 FleetGrid (G6, R44) — «раздел флот»: сетка чатов-агентов с их ЦЕЛЯМИ.
 *
 * Операторская задача (R44): «полностью убрать api — вся работа с открытыми
 * чатами-агентами прямо в браузере». Сетка = первичный вид флота: каждый чат —
 * карточка (роль, цель G5, состояние, ходы, outcome-proof, cron-задания);
 * клик открывает чат прямо на странице (событие me2:select-chat → AgentChatPanel
 * скроллится и выбирает сессию). Браузер сам держит чаты открытыми — как было
 * в старой Electron-версии (вкладки флота), только теперь чаты живут в daemon'е.
 *
 * Данные: GET /agentchat (сессии с objective/outcome — R44 поля) и GET /cron
 * (активные расписания, G7) через gateway :3041. Операторского REST-Workflow в UI нет:
 * остальная консоль — наблюдаемость, а работа — в чатах.
 */
import { useCallback, useEffect, useState } from "react";
import { Grid3X3, Target, RefreshCw, Clock, Shield, CircleCheck, CircleX, CircleDashed } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Session = {
  id: string; title: string; status: "ACTIVE" | "CLOSED"; state: "IDLE" | "THINKING";
  turns_ok: number; turns_fail: number; fail_streak: number; role: string;
  objective: string; outcome_status: string | null; outcome_proof: string | null; updated_at: string;
};

const R = (p: string, init?: RequestInit) => fetch(`${p}${p.includes("?") ? "&" : "?"}XTransformPort=3041`, { cache: "no-store", ...init });

const ROLE_STYLE: Record<string, string> = {
  SUPERVISOR: "border-violet-900/60 bg-violet-950/30 text-violet-300",
  CODE: "border-emerald-900/60 bg-emerald-950/30 text-emerald-300",
  RESEARCH: "border-cyan-900/60 bg-cyan-950/30 text-cyan-300",
  DEBUG: "border-rose-900/60 bg-rose-950/30 text-rose-300",
  CHAT: "border-zinc-800 bg-zinc-900/60 text-zinc-400",
};
const ROLE_LABEL: Record<string, string> = { SUPERVISOR: "T1·SUPER", CODE: "T2·CODE", RESEARCH: "T2·RSRCH", DEBUG: "T2·DEBUG", CHAT: "T2·CHAT" };

export default function FleetGrid() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cronCounts, setCronCounts] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await R("/agentchat").then((r) => r.json()) as { sessions?: Session[] };
      setSessions((j.sessions ?? []).filter((s) => s.status === "ACTIVE"));
      setLoaded(true);
    } catch { /* daemon offline */ }
  }, []);
  const loadCrons = useCallback(async () => {
    try {
      const j = await R("/cron").then((r) => r.json()) as { per_session?: Record<string, number> };
      setCronCounts(j.per_session ?? {});
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    // начальная загрузка — через микрозадержку (react-hooks/set-state-in-effect: без синхронного setState из эффекта)
    const t0 = setTimeout(() => { void load(); void loadCrons(); }, 0);
    const a = setInterval(() => void load(), 5000);
    const b = setInterval(() => void loadCrons(), 15000);
    return () => { clearTimeout(t0); clearInterval(a); clearInterval(b); };
  }, [load, loadCrons]);

  // выбранная карточка подсвечивается, когда чат открыт в панели (me2:select-chat наружу, panel → сюда)
  useEffect(() => {
    const onSel = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) setSel(id);
    };
    window.addEventListener("me2:chat-selected", onSel as EventListener);
    return () => window.removeEventListener("me2:chat-selected", onSel as EventListener);
  }, []);

  const open = (id: string) => {
    setSel(id);
    window.dispatchEvent(new CustomEvent("me2:select-chat", { detail: { id } }));
  };

  const active = sessions.length;
  const thinking = sessions.filter((s) => s.state === "THINKING").length;
  const withGoals = sessions.filter((s) => s.objective).length;
  const outcomes = sessions.filter((s) => s.outcome_status).length;
  const cronsTotal = Object.values(cronCounts).reduce((a, b) => a + b, 0);

  return (
    <Card className="border-zinc-800 bg-zinc-900/40 card-lift" data-testid="fleet-grid">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
          <Grid3X3 className="h-4 w-4 text-teal-400" aria-hidden /> ФЛОТ · СЕТКА (G6)
          <span data-testid="fleet-grid-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px] font-normal normal-case tracking-normal">
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title="активных чатов / думают сейчас">{active}∅{thinking > 0 ? ` · 💭${thinking}` : ""}</span>
            <span className="rounded border border-amber-900/50 bg-amber-950/20 px-1 py-0.5 text-amber-300/90" title="чатов с долгоживущей целью (G5)">🎯 {withGoals}</span>
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title="исходов зафиксировано (outcome-proof, R44)">✅ {outcomes}</span>
            <span className="rounded border border-cyan-900/50 bg-cyan-950/20 px-1 py-0.5 text-cyan-300/90" title="активных cron-заданий флота (G7, тик 30с)"><Clock className="mr-0.5 inline h-2.5 w-2.5" aria-hidden />{cronsTotal}</span>
          </span>
        </CardTitle>
        <button type="button" onClick={() => { void load(); void loadCrons(); }} aria-label="Обновить сетку флота" data-testid="fleet-grid-refresh"
          className="rounded border border-zinc-800 p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300">
          <RefreshCw className="h-3 w-3" aria-hidden />
        </button>
      </CardHeader>
      <CardContent className="p-2">
        <p className="mb-1.5 px-1 font-mono text-[9px] leading-snug text-zinc-600" title="R44: операторский REST-workflow снесён (/api удалён из Next) — вся работа идёт в открытых чатах-агентах; клик по карточке открывает чат прямо на странице">
          вся работа — в открытых чатах; клик открывает чат прямо здесь · API оператора убран (R44)
        </p>
        {!loaded && <p className="p-3 text-center font-mono text-[10px] text-zinc-600">загрузка флота…</p>}
        {loaded && sessions.length === 0 && (
          <p className="p-3 text-center font-mono text-[10px] text-zinc-600">флот пуст — создайте чат в панели AGENT·CHAT ниже; автопилот спроса (G10) вырастит чаты под живой спрос</p>
        )}
        {sessions.length > 0 && (
          <div data-testid="fleet-cards" className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:max-h-80 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent">
            {sessions.map((s) => {
              const crons = cronCounts[s.id] ?? 0;
              const oc = s.outcome_status;
              return (
                <button
                  key={s.id} type="button" onClick={() => open(s.id)}
                  data-testid="fleet-card"
                  aria-pressed={sel === s.id}
                  title={`${s.title} · ${s.role} · ходов ${s.turns_ok}/${s.turns_fail}${s.fail_streak >= 3 ? " · ДЕГРАДАЦИЯ" : ""}${s.outcome_proof ? ` · исход: ${s.outcome_proof.slice(0, 120)}` : ""}`}
                  className={`flex flex-col gap-1 rounded-md border p-2 text-left transition hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 ${sel === s.id ? "border-teal-800/70 bg-teal-950/20 ring-1 ring-teal-900/50" : "border-zinc-800 bg-zinc-950/40"}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${s.state === "THINKING" ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} aria-hidden />
                    <span className={`shrink-0 rounded border px-1 py-0.5 font-mono text-[8px] font-semibold ${ROLE_STYLE[s.role] ?? ROLE_STYLE.CHAT}`} title={`ярус политики: ${s.role === "SUPERVISOR" ? "T1 (супервизор)" : "T2 (рабочий чат)"}`}>
                      {s.role === "SUPERVISOR" && <Shield className="mr-0.5 inline h-2.5 w-2.5" aria-hidden />}{ROLE_LABEL[s.role] ?? s.role.slice(0, 8)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-200">{s.title}</span>
                  </span>
                  <span className="flex min-h-[24px] items-start gap-1 font-mono text-[9px] leading-snug text-amber-200/80" title={s.objective || "цель не задана — назначьте через панель AGENT·CHAT (G5)"}>
                    <Target className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-400/80" aria-hidden />
                    <span className="line-clamp-2">{s.objective || "цель не задана"}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1 font-mono text-[8px]">
                    <span className="text-emerald-400/80" title="ходов ok/fail">{s.turns_ok}✓/{s.turns_fail}✗</span>
                    {s.fail_streak >= 3 && <span className="rounded border border-rose-900/60 bg-rose-950/30 px-1 text-rose-300" title="3+ провалов подряд">deg{s.fail_streak}</span>}
                    {crons > 0 && <span className="rounded border border-cyan-900/50 bg-cyan-950/20 px-1 text-cyan-300/90" title={`cron-заданий: ${crons}`}><Clock className="mr-0.5 inline h-2 w-2" aria-hidden />{crons}</span>}
                    {oc === "fixed" && <span className="flex items-center gap-0.5 rounded border border-emerald-900/60 bg-emerald-950/30 px-1 text-emerald-300" title="исход зафиксирован с доказательством (report_outcome)"><CircleCheck className="h-2.5 w-2.5" aria-hidden />fixed</span>}
                    {oc === "done" && <span className="flex items-center gap-0.5 rounded border border-emerald-900/60 bg-emerald-950/30 px-1 text-emerald-300" title="исход зафиксирован с доказательством"><CircleCheck className="h-2.5 w-2.5" aria-hidden />done</span>}
                    {oc === "blocked" && <span className="flex items-center gap-0.5 rounded border border-rose-900/60 bg-rose-950/30 px-1 text-rose-300" title="честно заблокирован — см. proof в чате"><CircleX className="h-2.5 w-2.5" aria-hidden />blocked</span>}
                    {!oc && s.objective && <span className="flex items-center gap-0.5 rounded border border-zinc-800 px-1 text-zinc-500" title="исход ещё не зафиксирован (report_outcome)"><CircleDashed className="h-2.5 w-2.5" aria-hidden />no proof</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
