"use client";
// ── GLOBAL DIALOGS: EVENTS_SEARCH · BUDGET · RESET · read-only TASK SHEET ──
// Все оверлеи — Global UI (доступны из любой Page, §2 дизайн-дока).

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useMe2 } from "@/components/me2/store";
import { eventsSearch, environmentReset, age, hhmmss, EVENT_STYLE, type Event } from "@/lib/me2-bus";
import { projectActionFeed, projectFeedBinding } from "@/lib/project-action-feed.mjs";
import {
  Search, Gauge, Trash2, CheckCircle2,
  AlertTriangle, Activity, Globe2,
} from "lucide-react";

// ── EVENTS_SEARCH ───────────────────────────────────────────────────────────────
function EventsSearchDialog() {
  const dialog = useMe2((s) => s.dialog);
  const setDialog = useMe2((s) => s.setDialog);
  const busy = useMe2((s) => s.busyAction);
  const setBusy = useMe2((s) => s.setBusy);
  const [q, setQ] = useState("TASK");
  const [limit, setLimit] = useState("50");
  const [res, setRes] = useState<{ q: string; count: number; preview: Event[] } | null>(null);

  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    const r = await eventsSearch(q.trim(), Math.max(1, Math.min(200, Number(limit) || 50)));
    setBusy(false);
    if (r) setRes({ q: q.trim(), count: r.count, preview: r.events.slice(0, 25) });
  };

  return (
    <Dialog open={dialog === "eventsSearch"} onOpenChange={(o) => { if (!o) { setDialog(null); setRes(null); } }}>
      <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm tracking-widest">
            <Search className="h-4 w-4 text-cyan-400" aria-hidden /> EVENTS_SEARCH
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            подстрочный поиск по type+data журнала · limit ≤ 200 · полоса READ_ONLY · cost 1
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="flex gap-2">
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) void run(); }}
              placeholder="строка поиска, напр. TASK" aria-label="Строка поиска событий"
              className="h-8 flex-1 border-zinc-800 bg-zinc-900 font-mono text-xs"
            />
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} type="number" min={1} max={200}
              aria-label="Лимит результатов" className="h-8 w-20 border-zinc-800 bg-zinc-900 font-mono text-xs" />
          </div>
          <Button size="sm" className="h-8 w-full bg-cyan-700 text-white hover:bg-cyan-600" onClick={() => void run()} disabled={busy || !q.trim()}>найти</Button>
          {res && (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
              <p className="mb-1 text-[10px] text-zinc-400">
                найдено: <b className="text-cyan-300">{res.count}</b> по «{res.q}» {res.count > res.preview.length ? `(первые ${res.preview.length})` : ""}
              </p>
              <div className="mc-scroll max-h-40 space-y-0.5 overflow-y-auto font-mono text-[10px]">
                {res.preview.map((e) => (
                  <div key={e.seq} className="flex gap-2">
                    <span className="shrink-0 text-zinc-600">{e.seq}</span>
                    <span className={`w-32 shrink-0 truncate ${EVENT_STYLE[e.type] ?? "text-zinc-400"}`}>{e.type}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-500">{e.data}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── BUDGET_ADJUST ───────────────────────────────────────────────────────────────
function BudgetDialog() {
  const dialog = useMe2((s) => s.dialog);
  const setDialog = useMe2((s) => s.setDialog);
  const snap = useMe2((s) => s.snap);
  const busy = useMe2((s) => s.busyAction);
  const setBusy = useMe2((s) => s.setBusy);
  const [val, setVal] = useState("24");
  const limitNow = snap?.budget.limit ?? 24;

  const run = async () => {
    setBusy(true);
    await import("@/lib/me2-bus").then((m) => m.sendCommand("BUDGET_ADJUST", { limit: Math.max(6, Math.min(96, Number(val) || 24)) }, { successMsg: `лимит бюджета ${val}/60s` }));
    setBusy(false);
    setDialog(null);
  };

  return (
    <Dialog open={dialog === "budget"} onOpenChange={(o) => { if (!o) setDialog(null); }}>
      <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm tracking-widest">
            <Gauge className="h-4 w-4 text-fuchsia-400" aria-hidden /> BUDGET_ADJUST
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            лимит стоимости команд на 60s · clamp 6..96 · сейчас {limitNow}/60s
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="flex items-center gap-2">
            <Input id="b-limit" type="number" min={6} max={96} value={val} onChange={(e) => setVal(e.target.value)}
              aria-label="Новый лимит бюджета" className="h-8 w-24 border-zinc-800 bg-zinc-900 font-mono text-sm" />
            <span className="text-xs text-zinc-500">cost / 60s</span>
            <div className="ml-auto flex gap-1" role="group" aria-label="Пресеты лимита">
              {[24, 32, 48, 96].map((n) => (
                <button key={n} type="button" onClick={() => setVal(String(n))} aria-pressed={Number(val) === n}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                    Number(val) === n ? "border-fuchsia-700 bg-fuchsia-950/60 text-fuchsia-300" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}>{n}</button>
              ))}
            </div>
          </div>
          <Button size="sm" className="h-8 w-full bg-fuchsia-700 text-white hover:bg-fuchsia-600" onClick={() => void run()} disabled={busy}>
            применить (CONTROL)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


// ── OPEN SITE (presentation-only shell intent) ────────────────────────────────
function OpenSiteDialog() {
  const dialog = useMe2((s) => s.dialog);
  const setDialog = useMe2((s) => s.setDialog);
  const { toast } = useToast();
  const [url, setUrl] = useState("https://");
  const [busy, setBusy] = useState(false);

  const open = async () => {
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) {
      toast({ title: "URL не открыт", description: "Разрешены только http:// и https://", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const { me2Desktop } = await import("@/lib/me2-desktop");
      const desktop = me2Desktop();
      if (!desktop) {
        toast({ title: "native shell недоступен", description: "Открытие сайта требует METAENGINE Desktop shell.", variant: "destructive" });
        return;
      }
      const result = await desktop.tabs.openSite(value);
      if (!result.ok) {
        toast({ title: "вкладка не открыта", description: result.error ?? "ошибка native shell", variant: "destructive" });
        return;
      }
      setDialog(null);
      setUrl("https://");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={dialog === "openSite"} onOpenChange={(openState) => { if (!openState) setDialog(null); }}>
      <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-md" data-testid="open-site-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm tracking-widest">
            <Globe2 className="h-4 w-4 text-sky-400" aria-hidden /> ОТКРЫТЬ САЙТ
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            новая native Browser-вкладка · только http/https · presentation flow
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 py-1">
          <Label htmlFor="open-site-url" className="text-xs text-zinc-400">URL</Label>
          <Input
            id="open-site-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !busy) { event.preventDefault(); void open(); } }}
            autoFocus
            spellCheck={false}
            inputMode="url"
            aria-label="URL сайта для новой Browser-вкладки"
            className="border-zinc-800 bg-zinc-900 font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="border-zinc-700" onClick={() => setDialog(null)}>отмена</Button>
          <Button size="sm" className="bg-sky-700 hover:bg-sky-600" onClick={() => void open()} disabled={busy || !/^https?:\/\//i.test(url.trim())}>
            <Globe2 className="mr-1 h-3.5 w-3.5" aria-hidden /> открыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── RESET (EMERGENCY) ───────────────────────────────────────────────────────────
function ResetDialog() {
  const dialog = useMe2((s) => s.dialog);
  const setDialog = useMe2((s) => s.setDialog);
  return (
    <Dialog open={dialog === "reset"} onOpenChange={(o) => { if (!o) setDialog(null); }}>
      <DialogContent className="border-rose-900 bg-zinc-950 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm text-rose-400"><Trash2 className="h-4 w-4" /> СБРОС СРЕДЫ · EMERGENCY</DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Будут удалены ВСЕ задачи, агенты и команды. Это полоса EMERGENCY — бюджет игнорируется. Действие необратимо.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" className="border-zinc-700" onClick={() => setDialog(null)}>отмена</Button>
          <Button variant="destructive" size="sm" onClick={() => { void environmentReset(); setDialog(null); }}>сбросить всё</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── TASK SHEET (Inspector задачи) ───────────────────────────────────────────────
function TaskSheet() {
  const detail = useMe2((s) => s.detail);
  const stream = useMe2((s) => s.stream);
  const streamTaskId = useMe2((s) => s.streamTaskId);
  const streamState = useMe2((s) => s.streamState);
  const streamCursor = useMe2((s) => s.streamCursor);
  const connected = useMe2((s) => s.connected);
  const closeTask = useMe2((s) => s.closeTask);
  const openTask = useMe2((s) => s.openTask);
  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const actionFeed = projectActionFeed({
    taskId: detail?.id ?? null,
    events: streamTaskId === detail?.id ? stream : [],
    // DEGRADED keeps the last verified rows visible; UNBOUND means no history
    // has ever been bound to this task.
    available: streamState !== "UNBOUND",
    resyncRequired: streamCursor?.resync_required === true,
    limit: 200,
  });
  const projectBinding = projectFeedBinding();
  useEffect(() => {
    if (!detail) return;
    const frame = window.requestAnimationFrame(() => {
      streamEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail?.id, stream.length]);

  return (
    <Sheet open={!!detail} onOpenChange={(o) => { if (!o) closeTask(); }}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden border-zinc-800 bg-zinc-950 sm:max-w-lg">
        {detail && (
          <>
            <SheetHeader className="shrink-0 space-y-2">
              <div className="flex items-center gap-2">
                <Badge className={`text-[10px] ${detail.status === "RUNNING" ? "bg-amber-500/90 text-black" : detail.status === "COMPLETED" ? "bg-emerald-600 text-white" : detail.status === "FAILED" ? "bg-rose-600 text-white" : "bg-zinc-700 text-zinc-200"}`}>{detail.status}</Badge>
                {detail.role && <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">{detail.role}</Badge>}
                {Number(detail.park_count ?? 0) > 0 && (
                  <Badge variant="outline" className="border-amber-800 text-[10px] text-amber-300" title="park-and-resume: задача переживает 429/инфра-паузы">
                    park×{detail.park_count}
                  </Badge>
                )}
                <span className="ml-auto font-mono text-[10px] text-zinc-500">{detail.id}</span>
              </div>
              <SheetTitle className="text-sm leading-snug">{detail.title}</SheetTitle>
              <SheetDescription className="text-[11px] text-zinc-500">
                шагов {detail.steps}/{detail.max_steps} · создана {age(detail.created_at)} назад · обновлена {age(detail.updated_at)} назад
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6 mc-scroll">
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-widest text-zinc-500">СПЕЦИФИКАЦИЯ</p>
                <pre className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-[11px] text-zinc-300">{detail.spec}</pre>
              </div>
              {detail.result && (
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-widest text-emerald-500"><CheckCircle2 className="h-3 w-3" /> РЕЗУЛЬТАТ</p>
                  <pre className="whitespace-pre-wrap rounded-md border border-emerald-900/50 bg-emerald-950/30 p-3 font-mono text-[11px] text-emerald-200">{detail.result}</pre>
                </div>
              )}
              {detail.error && (
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-widest text-rose-500"><AlertTriangle className="h-3 w-3" /> ОШИБКА</p>
                  <pre className="whitespace-pre-wrap rounded-md border border-rose-900/50 bg-rose-950/30 p-3 font-mono text-[11px] text-rose-200">{detail.error}</pre>
                </div>
              )}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-widest text-cyan-500">
                  <Activity className="h-3 w-3" /> ДЕЙСТВИЯ АГЕНТОВ ({actionFeed.events.length})
                </p>
                <div className="mb-2 space-y-1 font-mono text-[9px] text-zinc-500" data-testid="task-project-feed-status" aria-live="polite">
                  <p>{projectBinding.label} · {connected ? "live" : "offline"} · последнее событие #{actionFeed.cursor?.latest_seq ?? "—"}</p>
                  <p>Окно до 200 действий{streamCursor ? ` · прочитано из БД до #${streamCursor.returned_through_seq}` : " · курсор БД недоступен"}</p>
                  <p className="text-zinc-600">Действия этой задачи. Общий журнал проекта пока недоступен: задача не содержит привязки к project/workspace.</p>
                  {streamState === "LOADING" ? <p className="text-cyan-400">Загрузка истории…</p> : null}
                  {streamCursor?.resync_required ? <p className="text-amber-400">Журнал изменился: прежний курсор недействителен. Загрузите последнее окно.</p> : streamState === "DEGRADED" ? <p className="text-amber-400">Синхронизация недоступна. Сохранены ранее прочитанные действия.</p> : null}
                  {streamCursor?.has_more ? <p className="text-cyan-400">В БД есть следующие действия. Загрузите следующую страницу.</p> : null}
                  {streamCursor?.has_earlier ? <p className="text-zinc-500">Более ранние действия находятся за пределами этого окна.</p> : null}
                  {!connected && streamState === "EXACT" ? <p className="text-amber-400">Показана последняя загруженная история; для новых действий нужна синхронизация.</p> : null}
                </div>
                <div className="mc-scroll max-h-64 space-y-1 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900/40 p-2 font-mono text-[10px]" data-testid="task-project-action-feed">
                  {actionFeed.events.length === 0 && streamState === "EXACT" && <p className="p-2 text-center text-zinc-500">Действий этой задачи пока нет</p>}
                  {actionFeed.events.map((e) => (
                    <div key={e.seq} className="rounded border-b border-zinc-800/60 px-1 py-1 hover:bg-zinc-800/50">
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        <span className="shrink-0 text-zinc-600">#{e.seq} · {hhmmss(e.ts)}</span>
                        <span className={`font-semibold ${EVENT_STYLE[e.type] ?? "text-zinc-400"}`}>{e.type}</span>
                        {e.agent_id ? <span className="break-all text-violet-400">{e.agent_id}</span> : null}
                      </div>
                      <details className="mt-0.5 min-w-0 text-zinc-500">
                        <summary className="cursor-pointer truncate" title="Развернуть данные действия">{e.data || "данные отсутствуют"}</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all text-[9px] text-zinc-400">{e.data}</pre>
                      </details>
                    </div>
                  ))}
                  <div ref={streamEndRef} />
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 border-t border-zinc-800 p-3">
              <Button variant="ghost" size="sm" className="border-zinc-800 text-zinc-400" onClick={() => openTask(detail.id)} disabled={streamState === "LOADING"} title="Заново загрузить последние 200 действий этой задачи">
                последнее окно
              </Button>
              {streamCursor && !streamCursor.resync_required ? <Button variant="ghost" size="sm" className="border-zinc-800 text-cyan-400" onClick={() => openTask(detail.id, "after")} disabled={streamState === "LOADING"} title="Прочитать до 200 действий после подтверждённого курсора БД">
                {streamCursor.has_more ? "следующая страница" : "получить новые действия"}
              </Button> : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function GlobalDialogs() {
  return (
    <>
      <EventsSearchDialog />
      <BudgetDialog />
      <OpenSiteDialog />
      <ResetDialog />
      <TaskSheet />
    </>
  );
}
