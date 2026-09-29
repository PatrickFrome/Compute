"use client";
// ── GLOBAL DIALOGS: НОВАЯ ЗАДАЧА · EVENTS_SEARCH · BUDGET · RESET · TASK SHEET ──
// Все оверлеи — Global UI (доступны из любой Page, §2 дизайн-дока).

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMe2, createTaskFromForm } from "@/components/me2/store";
import { agentChatOp } from "@/lib/me2-socket";
import { eventsSearch, environmentReset, taskAction, age, hhmmss, EVENT_STYLE, type Task, type Event } from "@/lib/me2-bus";
import {
  Rocket, Clock, Search, Gauge, Trash2, X, RotateCcw, Archive, Brain, CheckCircle2,
  AlertTriangle, Activity,
} from "lucide-react";

// ── НОВАЯ ЗАДАЧА ────────────────────────────────────────────────────────────────
function NewTaskDialog() {
  const dialog = useMe2((s) => s.dialog);
  const setDialog = useMe2((s) => s.setDialog);
  const busy = useMe2((s) => s.busyAction);
  const setBusy = useMe2((s) => s.setBusy);
  const [fTitle, setFTitle] = useState("");
  const [fSpec, setFSpec] = useState("");
  const [fRole, setFRole] = useState("ANY");
  const [fSteps, setFSteps] = useState("6");
  const [fDelay, setFDelay] = useState("0");

  const create = async () => {
    setBusy(true);
    const ok = await createTaskFromForm({ title: fTitle, spec: fSpec, role: fRole, steps: fSteps, delay: fDelay });
    setBusy(false);
    if (ok) {
      setDialog(null);
      setFTitle(""); setFSpec(""); setFDelay("0");
    }
  };

  return (
    <Dialog open={dialog === "newTask"} onOpenChange={(o) => { if (!o) setDialog(null); }}>
      <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm tracking-widest"><Rocket className="h-4 w-4 text-emerald-400" /> НОВАЯ ЗАДАЧА</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">через command bus · полоса MUTATION · бюджет 24/60s</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="t-title" className="text-xs text-zinc-400">Заголовок</Label>
            <Input id="t-title" value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="короткое имя задачи" className="border-zinc-800 bg-zinc-900 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-spec" className="text-xs text-zinc-400">Спецификация <span className="text-rose-500">*</span></Label>
            <Textarea id="t-spec" value={fSpec} onChange={(e) => setFSpec(e.target.value)} placeholder="что именно нужно сделать; агент получает это как задание" rows={5} className="border-zinc-800 bg-zinc-900 font-mono text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-zinc-400">Роль</Label>
              <Select value={fRole} onValueChange={setFRole}>
                <SelectTrigger className="border-zinc-800 bg-zinc-900 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-950">
                  <SelectItem value="ANY">любая</SelectItem>
                  <SelectItem value="IMPLEMENTER">IMPLEMENTER</SelectItem>
                  <SelectItem value="RESEARCHER">RESEARCHER</SelectItem>
                  <SelectItem value="OPERATOR">OPERATOR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-steps" className="text-xs text-zinc-400">Макс. шагов</Label>
              <Input id="t-steps" type="number" min={1} max={24} value={fSteps} onChange={(e) => setFSteps(e.target.value)} className="border-zinc-800 bg-zinc-900 text-sm" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-delay" className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Clock className="h-3 w-3 text-lime-500" /> Отложенный запуск (сек, 0 = сразу)
            </Label>
            <Input id="t-delay" type="number" min={0} max={3600} value={fDelay} onChange={(e) => setFDelay(e.target.value)} className="border-zinc-800 bg-zinc-900 text-sm" />
            {Number(fDelay) > 0 && (
              <p className="text-[10px] text-lime-500/80">задача появится в очереди через {Number(fDelay)}s — отменить можно в OBSERVABILITY → COMMAND BUS до ETA</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="border-zinc-700" onClick={() => setDialog(null)}>отмена</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={() => void create()} disabled={busy || !fSpec.trim()}>
            {Number(fDelay) > 0 ? <Clock className="mr-1 h-3.5 w-3.5" /> : <Rocket className="mr-1 h-3.5 w-3.5" />}
            {Number(fDelay) > 0 ? `запланировать через ${Number(fDelay)}s` : "поставить в очередь"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const closeTask = useMe2((s) => s.closeTask);
  const openTask = useMe2((s) => s.openTask);
  const setPage = useMe2((s) => s.setPage);
  const busy = useMe2((s) => s.busyAction);
  const { toast } = useToast();
  const [reflectingId, setReflectingId] = useState<string | null>(null);

  const reflect = async (t: Task) => {
    setReflectingId(t.id);
    try {
      const list = await fetch("/agentchat?XTransformPort=3041", { cache: "no-store" }).then((r) => r.json()) as { sessions?: Array<{ id: string; role: string; status: string; title: string }> };
      const sup = list.sessions?.find((s) => s.role === "SUPERVISOR" && s.status === "ACTIVE");
      if (!sup) {
        toast({ title: "флот недоступен", description: "нет активного супервизора — создайте чат-агента", variant: "destructive" });
        return;
      }
      const r = await agentChatOp({ op: "send", id: sup.id, text: `Разбери провал задачи ${t.id} «${t.title}» (статус ${t.status}). Диагноз и урок — reply; фиксацию исхода — report_outcome (outcome-proof).` });
      if (r.ok) {
        toast({ title: "провал передан флоту ✓", description: `супервизор «${sup.title}» координирует разбор` });
        window.dispatchEvent(new CustomEvent("me2:select-chat", { detail: sup.id }));
        setPage("command");
      } else {
        toast({ title: "передача флоту ✗", description: r.error ?? "ошибка", variant: "destructive" });
      }
    } catch {
      toast({ title: "передача флоту ✗", description: "daemon недоступен", variant: "destructive" });
    } finally {
      setReflectingId(null);
    }
  };

  const streamEndRef = useMemo(() => ({ current: null as HTMLDivElement | null }), []);
  if (detail) setTimeout(() => streamEndRef.current?.scrollIntoView({ block: "end" }), 50);

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
                  <Activity className="h-3 w-3" /> ХРОНИКА ШАГОВ ({stream.length})
                </p>
                <div className="mc-scroll max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900/40 p-2 font-mono text-[10px]">
                  {stream.length === 0 && <p className="p-2 text-center text-zinc-500">хроника пуста</p>}
                  {stream.map((e) => (
                    <div key={e.seq} className="flex gap-2 rounded px-1 py-0.5 hover:bg-zinc-800/50">
                      <span className="shrink-0 text-zinc-600">{hhmmss(e.ts)}</span>
                      <span className={`w-28 shrink-0 font-semibold ${EVENT_STYLE[e.type] ?? "text-zinc-400"}`}>{e.type}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-500">{e.data}</span>
                    </div>
                  ))}
                  <div ref={streamEndRef} />
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 border-t border-zinc-800 p-3">
              {(detail.status === "READY" || detail.status === "RUNNING") && (
                <Button variant="destructive" size="sm" className="flex-1" onClick={() => { void taskAction("TASK_CANCEL", detail.id); }}>
                  <X className="mr-1 h-3.5 w-3.5" /> отменить (CONTROL)
                </Button>
              )}
              {(detail.status === "FAILED" || detail.status === "CANCELLED") && (
                <>
                  <Button size="sm" className="flex-1 bg-amber-600 text-black hover:bg-amber-500" onClick={() => { void taskAction("TASK_RETRY", detail.id); }} disabled={busy}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> повторить (MUTATION)
                  </Button>
                  <Button
                    variant="outline" size="sm" className="flex-1 border-violet-800 text-violet-300 hover:bg-violet-950/60"
                    onClick={() => void reflect(detail)} disabled={busy || reflectingId === detail.id}
                    title="провал уходит живому супервизору чат-флота на разбор"
                  >
                    <Brain className={`mr-1 h-3.5 w-3.5 ${reflectingId === detail.id ? "animate-pulse" : ""}`} />
                    во флот (разбор)
                  </Button>
                </>
              )}
              {(detail.status === "COMPLETED" || detail.status === "FAILED" || detail.status === "CANCELLED") && (
                <Button variant="outline" size="sm" className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800" onClick={() => { void taskAction("TASK_ARCHIVE", detail.id); }} disabled={busy}>
                  <Archive className="mr-1 h-3.5 w-3.5" /> в архив (MUTATION)
                </Button>
              )}
              <Button variant="ghost" size="sm" className="border-zinc-800 text-zinc-400" onClick={() => openTask(detail.id)} title="обновить хронику">
                обновить
              </Button>
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
      <NewTaskDialog />
      <EventsSearchDialog />
      <BudgetDialog />
      <ResetDialog />
      <TaskSheet />
    </>
  );
}
