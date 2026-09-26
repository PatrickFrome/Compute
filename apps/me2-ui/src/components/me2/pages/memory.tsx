"use client";
// ── ME2 PAGE: MEMORY — память и знание (R74) ─────────────────────────────────────
// Порт из legacy МЕХАНИКИ (docs/legacy-mission-control.tsx.txt): MEMORY L3141–3188
// (mem-блок + ECON-чипы), RSI L3256–3284, BRAIN L3190–3217 (probe-чипы) + RECALL-блок
// GET /memory/block (TEAM MEMORY — блок, уходящий в промпты агентам).
// Payload'ы POST 1:1 с legacy: /memory {op:write|delete|economy} · /rsi {op:propose|adopt|reject|rollback}.

import { useCallback, useEffect, useState } from "react";
import { Brain, Coins, Database, Radar } from "lucide-react";
import { me2Fetch } from "@/lib/me2-bus";
import { Chip, PageHeader, Sec, StateBadge, mapState, type SysState } from "@/components/me2/ui/primitives";
import { useToast } from "@/hooks/use-toast";

// ── типы (зеркало daemon, перенос из legacy 1:1) ────────────────────────────────
type MemRowT = { id: number; kind: string; key: string; content: string; tags: string; importance: number; hits: number; score?: number };
type MemData = { ok: boolean; rows: MemRowT[]; status: { rows: number; by_kind: Record<string, number>; db_bytes: number } };
type MemEconConsumerT = { consumer: string; deliveries: number; avg_saved_pct: number; bytes_saved: number; last_at: number };
type MemEconT = { ok: boolean; deliveries: number; avg_saved_pct: number; bytes_saved_total: number; by_consumer: MemEconConsumerT[] };
type RsiP = { id: string; title: string; status: string; source: string; artifact: string | null; evidence: string; created_at: number };
type RsiData = { ok: boolean; proposals: RsiP[]; stats: { total: number; proposed: number; adopted: number; rejected: number; rolled_back: number }; artifacts: number };
type MemBlockT = { ok: boolean; block: string; used: MemRowT[] };
type BrainData = { ok: boolean; thoughts: { key: string; content: string; at: number }[]; probe: { eventloop_ms: number; db_probe_ms: number; memory_rows: number } };

const MEM_KINDS = ["", "episodic", "semantic", "procedural"] as const;

/** RSI-статус → единый словарь состояний (§9 дизайн-дока). */
function rsiState(status: string): SysState {
  switch (status) {
    case "PROPOSED": return "Waiting";
    case "ADOPTED": return "Completed";
    case "REJECTED": return "Failed";
    case "ROLLED_BACK": return "Offline";
    default: return mapState(status);
  }
}

function fmtBytes(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`;
}

export function MemoryPage() {
  const { toast } = useToast();

  // ── MEMORY (legacy mem-блок L3141) ──
  const [mem, setMem] = useState<MemData | null>(null);
  const [memQ, setMemQ] = useState("");
  const [memKind, setMemKind] = useState<string>("");
  const [memBusy, setMemBusy] = useState(false);
  // write-форма (kind/key/content/importance)
  const [wKind, setWKind] = useState<string>("semantic");
  const [wKey, setWKey] = useState("");
  const [wContent, setWContent] = useState("");
  const [wImportance, setWImportance] = useState("0.8");
  const loadMem = useCallback(async (q = "", kind = "") => {
    try {
      const r = await me2Fetch<MemData>(`/memory?XTransformPort=3041&limit=8${q ? `&q=${encodeURIComponent(q)}` : ""}${kind ? `&kind=${kind}` : ""}`);
      if (r?.ok) setMem(r);
    } catch { /* daemon недоступен — панель просто без данных */ }
  }, []);
  const memOp = useCallback(async (body: Record<string, unknown>, okMsg: string) => {
    setMemBusy(true);
    try {
      const res = await fetch("/memory?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()) as { ok: boolean; error?: string } | null;
      if (res?.ok !== false) {
        toast({ title: okMsg });
        await loadMem(memQ, memKind);
        return true;
      }
      toast({ title: "memory ✗", description: String(res?.error ?? "ошибка"), variant: "destructive" });
    } catch {
      toast({ title: "memory ✗", description: "daemon недоступен", variant: "destructive" });
    } finally { setMemBusy(false); }
    return false;
  }, [memQ, memKind, loadMem, toast]);
  const memWrite = useCallback(async () => {
    const content = wContent.trim();
    if (!content) return;
    // legacy-контракт: kind/key/content + tags:["operator"] (payload POST /memory 1:1)
    const ok = await memOp({
      op: "write",
      kind: wKind || "semantic",
      key: wKey.trim() || `op:${Date.now().toString(36)}`,
      content,
      tags: ["operator"],
      importance: Math.max(0, Math.min(1, Number(wImportance) || 0.8)),
    }, "запись в память добавлена");
    if (ok) { setWContent(""); setWKey(""); }
  }, [wContent, wKey, wKind, wImportance, memOp]);

  // ── TOKEN·ECONOMY (legacy mem-econ-chips L3176) ──
  const [memEcon, setMemEcon] = useState<MemEconT | null>(null);
  const [econBusy, setEconBusy] = useState(false);
  const loadMemEcon = useCallback(async () => {
    const r = await me2Fetch<MemEconT>("/memory/economy?XTransformPort=3041");
    if (r?.ok) setMemEcon(r);
  }, []);
  const econDeliver = useCallback(async () => {
    setEconBusy(true);
    try {
      const res = await fetch("/memory?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "economy", consumer: "ui-demo" }),
      }).then((r) => r.json()) as { ok: boolean; error?: string } | null;
      if (res?.ok !== false) toast({ title: "экономная доставка памяти выполнена (журнал в /memory/economy)" });
      else toast({ title: "economy ✗", description: String(res?.error ?? "ошибка"), variant: "destructive" });
      await loadMemEcon();
    } catch { toast({ title: "economy ✗", description: "daemon недоступен", variant: "destructive" }); }
    finally { setEconBusy(false); }
  }, [loadMemEcon, toast]);

  // ── RSI (legacy ME8 L3256) ──
  const [rsi, setRsi] = useState<RsiData | null>(null);
  const [rsiBusy, setRsiBusy] = useState(false);
  const [rsiHint, setRsiHint] = useState("");
  const loadRsi = useCallback(async () => {
    const r = await me2Fetch<RsiData>("/rsi?XTransformPort=3041");
    if (r?.ok) setRsi(r);
  }, []);
  const rsiOp = useCallback(async (body: Record<string, unknown>, okMsg: string) => {
    setRsiBusy(true);
    try {
      const res = await fetch("/rsi?XTransformPort=3041", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()) as { ok: boolean; error?: string; gate?: string; approval_id?: string | null } | null;
      if (res?.ok !== false) {
        toast({ title: okMsg });
        await loadRsi();
        return true;
      }
      toast({ title: `rsi ✗${res?.gate ? ` · гейт ${res.gate}` : ""}`, description: res?.approval_id ? `${res.error} (approval_id ${res.approval_id})` : String(res?.error ?? "ошибка"), variant: "destructive" });
    } catch {
      toast({ title: "rsi ✗", description: "daemon недоступен", variant: "destructive" });
    } finally { setRsiBusy(false); }
    return false;
  }, [loadRsi, toast]);
  const rsiPropose = useCallback(async () => {
    const hint = rsiHint.trim();
    // legacy: {op:"propose"}; daemon rsiPropose({auto,hint}) — hint → source "operator" (честно)
    const ok = await rsiOp(hint ? { op: "propose", auto: false, hint } : { op: "propose" }, "предложение подготовлено (LLM по урокам памяти)");
    if (ok) setRsiHint("");
  }, [rsiHint, rsiOp]);
  const rsiAdopt = useCallback(async (id: string) => {
    if (!window.confirm(`гейт rsi_adopt — потребуется approval. Принять предложение ${id}? Артефакт уйдёт в skills/rsi/.`)) return;
    await rsiOp({ op: "adopt", id }, "предложение принято → skills/rsi/");
  }, [rsiOp]);

  // ── RECALL·BRAIN: блок памяти в промптах + self-probe (legacy BRAIN L3190) ──
  const [memBlock, setMemBlock] = useState<MemBlockT | null>(null);
  const [brain, setBrain] = useState<BrainData | null>(null);
  const loadBlock = useCallback(async () => {
    const r = await me2Fetch<MemBlockT>("/memory/block?n=8&XTransformPort=3041");
    if (r?.ok) setMemBlock(r);
  }, []);
  const loadBrain = useCallback(async () => {
    const r = await me2Fetch<BrainData>("/brain?XTransformPort=3041");
    if (r?.ok) setBrain(r);
  }, []);

  // ── поллинги (cleanup при размонтировании страницы) ──
  useEffect(() => {
    void loadMem();
    const iv = setInterval(() => void loadMem(memQ, memKind), 30_000);
    return () => clearInterval(iv);
  }, [loadMem, memQ, memKind]);
  useEffect(() => {
    void loadMemEcon();
    const iv = setInterval(() => void loadMemEcon(), 60_000);
    return () => clearInterval(iv);
  }, [loadMemEcon]);
  useEffect(() => {
    void loadRsi();
    const iv = setInterval(() => void loadRsi(), 60_000);
    return () => clearInterval(iv);
  }, [loadRsi]);
  useEffect(() => {
    void loadBlock(); void loadBrain();
    const iv = setInterval(() => { void loadBlock(); void loadBrain(); }, 60_000);
    return () => clearInterval(iv);
  }, [loadBlock, loadBrain]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-memory" data-panel-memory>
      <PageHeader title="MEMORY" sub="ME4 память · token-economy · RSI" />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-2">
        {/* кол.1: MEMORY */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto mc-scroll">
          <Sec id="memory-list" defaultOpen title="MEMORY" icon={Database} tone="teal"
            right={<>
              {mem && (
                <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline" title="SQLite WAL — переживает рестарт (исправление CAVEAT M13/R6)">
                  epi {mem.status.by_kind.episodic ?? 0} · sem {mem.status.by_kind.semantic ?? 0} · proc {mem.status.by_kind.procedural ?? 0}
                </span>
              )}
            </>}>
            <div data-testid="memory-list" className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <Chip label="rows" value={mem?.status.rows ?? "—"} tone="teal" />
                <Chip label="db" value={mem ? fmtBytes(mem.status.db_bytes) : "—"} title="размер БД памяти" />
              </div>

              {/* write-форма (kind/key/content/importance) */}
              <form onSubmit={(e) => { e.preventDefault(); void memWrite(); }} className="space-y-1.5 rounded border border-zinc-800/70 bg-zinc-950/40 p-1.5">
                <div className="flex gap-1.5">
                  <select value={wKind} onChange={(e) => setWKind(e.target.value)} aria-label="Тип записи"
                    className="h-7 shrink-0 rounded border border-zinc-800 bg-zinc-950/60 px-1 font-mono text-[10px] text-zinc-300 outline-none focus:border-teal-900">
                    {(["semantic", "episodic", "procedural"] as const).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <input value={wKey} onChange={(e) => setWKey(e.target.value)} placeholder="key (пусто → op:<ts>)" aria-label="Ключ записи"
                    className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 font-mono text-[10px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-teal-900" />
                  <input value={wImportance} onChange={(e) => setWImportance(e.target.value)} placeholder="0.8" aria-label="Важность (0..1)" title="importance 0..1"
                    className="h-7 w-16 shrink-0 rounded border border-zinc-800 bg-zinc-950/60 px-2 font-mono text-[10px] text-zinc-300 outline-none focus:border-teal-900" />
                </div>
                <div className="flex gap-1.5">
                  <input value={wContent} onChange={(e) => setWContent(e.target.value)} placeholder="записать факт/урок в память…" aria-label="Содержимое записи"
                    className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 font-mono text-[10px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-teal-900" />
                  <button type="submit" disabled={memBusy} className="h-7 shrink-0 rounded border border-zinc-700 px-2 font-mono text-[10px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">+ зап</button>
                </div>
              </form>

              {/* поиск + фильтр kind */}
              <div className="flex gap-1.5">
                <input value={memQ} onChange={(e) => { setMemQ(e.target.value); void loadMem(e.target.value, memKind); }} placeholder="поиск по памяти (score: важность×свежесть×hits)…" aria-label="Поиск в памяти"
                  className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 font-mono text-[11px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-teal-900" />
                <select value={memKind} onChange={(e) => { setMemKind(e.target.value); void loadMem(memQ, e.target.value); }} aria-label="Фильтр по типу памяти"
                  className="h-7 shrink-0 rounded border border-zinc-800 bg-zinc-950/60 px-1 font-mono text-[10px] text-zinc-300 outline-none focus:border-teal-900">
                  {MEM_KINDS.map((k) => <option key={k || "all"} value={k}>{k ? k.slice(0, 3) : "всё"}</option>)}
                </select>
              </div>

              <div className="max-h-64 space-y-0.5 overflow-y-auto mc-scroll" role="list" aria-label="Записи памяти">
                {(mem?.rows ?? []).map((r) => (
                  <div key={r.id} role="listitem" className="flex items-center gap-1.5 rounded bg-zinc-900/50 px-1.5 py-1 font-mono text-[9px]"
                    title={`${r.key} · важность ${r.importance} · hits ${r.hits}${r.tags ? ` · tags ${r.tags}` : ""}\n${r.content}`}>
                    <span className={`shrink-0 rounded px-1 text-[8px] ${r.kind === "episodic" ? "bg-cyan-950/60 text-cyan-400" : r.kind === "semantic" ? "bg-violet-950/60 text-violet-300" : "bg-amber-950/60 text-amber-300"}`}>{r.kind.slice(0, 4)}</span>
                    <span className="shrink-0 text-zinc-600" title={r.key}>{r.key}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-400" title={r.content}>{r.content}</span>
                    {typeof r.score === "number" && <span className="shrink-0 text-zinc-600" title="score: важность×свежесть×hits">{r.score.toFixed(2)}</span>}
                    <button type="button" onClick={() => void memOp({ op: "delete", id: r.id }, "запись удалена")} disabled={memBusy}
                      aria-label={`Удалить запись ${r.key}`} className="shrink-0 text-zinc-600 transition hover:text-rose-400">✕</button>
                  </div>
                ))}
                {mem && mem.rows.length === 0 && (
                  <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">пусто — эпизоды появятся после выполнения задач</div>
                )}
                {!mem && <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">daemon недоступен…</div>}
              </div>
            </div>
          </Sec>
        </div>

        {/* кол.2: economy · rsi · recall/brain */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto mc-scroll">
          <Sec id="memory-econ" title="TOKEN·ECONOMY" icon={Coins} tone="teal"
            right={<>
              {memEcon && <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline" title="E5: дельта-доставка памяти — критичные semantic-уроки (importance ≥ 0.85) всегда в блоке; эпизоды и неизменённые записи элиминируются по hash+TTL 30м">−{Math.round(memEcon.avg_saved_pct * 100)}% · {memEcon.deliveries} дост.</span>}
            </>}>
            <div data-testid="mem-econ-chips" className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <Chip label="deliveries" value={memEcon?.deliveries ?? "—"} tone="teal" />
                <Chip label="avg_saved" value={memEcon ? `−${Math.round(memEcon.avg_saved_pct * 100)}%` : "—"} tone="emerald" />
                <Chip label="saved_total" value={memEcon ? fmtBytes(memEcon.bytes_saved_total) : "—"} tone="emerald" title="суммарно сэкономлено байт (bytes_full − bytes_compact)" />
              </div>
              <div className="space-y-0.5">
                <div className="text-[9px] uppercase tracking-wider text-zinc-600">по consumer'ам</div>
                {(memEcon?.by_consumer ?? []).map((c) => (
                  <div key={c.consumer} className="flex items-center gap-2 rounded bg-zinc-900/50 px-1.5 py-1 font-mono text-[9px]" title={`${c.consumer} · доставок ${c.deliveries} · сэкономлено ${fmtBytes(c.bytes_saved)}`}>
                    <span className="min-w-0 flex-1 truncate text-zinc-400">{c.consumer}</span>
                    <span className="shrink-0 text-zinc-600">{c.deliveries} дост.</span>
                    <span className="shrink-0 text-emerald-400/90">−{Math.round(c.avg_saved_pct * 100)}%</span>
                    <span className="w-14 shrink-0 text-right text-zinc-600">{fmtBytes(c.bytes_saved)}</span>
                  </div>
                ))}
                {memEcon && memEcon.by_consumer.length === 0 && (
                  <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">нет доставок — brain-план или кнопка «доставка» запустят первую</div>
                )}
                {!memEcon && <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">daemon недоступен…</div>}
              </div>
              <button type="button" onClick={() => void econDeliver()} disabled={econBusy}
                title="Выполнить экономную доставку памяти (POST /memory op:economy consumer:ui-demo)"
                className="w-full rounded border border-zinc-700 px-2 py-1 font-mono text-[9px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">доставка</button>
            </div>
          </Sec>

          <Sec id="memory-rsi" title="RSI" icon={Radar} tone="violet"
            right={<>
              {rsi && <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline" title="adopt/reject — только оператор (zero-authority, порт M14)">adopted {rsi.stats.adopted} · rollback {rsi.stats.rolled_back} · артефактов {rsi.artifacts}</span>}
            </>}>
            <div data-testid="rsi-list" className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <Chip label="proposed" value={rsi?.stats.proposed ?? "—"} tone="violet" />
                <Chip label="adopted" value={rsi?.stats.adopted ?? "—"} tone="emerald" />
                <Chip label="rejected" value={rsi?.stats.rejected ?? "—"} tone="rose" />
                <Chip label="rolled_back" value={rsi?.stats.rolled_back ?? "—"} />
                <Chip label="artifacts" value={rsi?.artifacts ?? "—"} />
              </div>

              <div className="flex gap-1.5">
                <input value={rsiHint} onChange={(e) => setRsiHint(e.target.value)} placeholder="hint для LLM-черновика (пусто → авто по урокам памяти)…" aria-label="Hint для предложения RSI"
                  className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 font-mono text-[10px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-violet-900" />
                <button type="button" onClick={() => void rsiPropose()} disabled={rsiBusy}
                  title="evidence: уроки памяти + RH-вердикты → черновик улучшения (POST /rsi op:propose)"
                  className="h-7 shrink-0 rounded border border-violet-800/50 px-2 font-mono text-[9px] text-violet-300/90 transition hover:bg-zinc-800 disabled:opacity-40">+ предложить улучшение</button>
              </div>

              <div className="max-h-56 space-y-0.5 overflow-y-auto mc-scroll" role="list" aria-label="Предложения RSI">
                {(rsi?.proposals ?? []).slice(0, 6).map((p) => (
                  <div key={p.id} role="listitem" className="flex items-center gap-1.5 rounded bg-zinc-900/50 px-1.5 py-1 font-mono text-[9px]"
                    title={`${p.id} · источник ${p.source} · evidence ${p.evidence}${p.artifact ? ` · артефакт ${p.artifact}` : ""}\n${p.title}`}>
                    <StateBadge state={rsiState(p.status)} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-zinc-400">{p.title}</span>
                    <span className="shrink-0 text-zinc-600">{p.source}</span>
                    {p.status === "PROPOSED" && (
                      <>
                        <button type="button" onClick={() => void rsiAdopt(p.id)} disabled={rsiBusy} className="shrink-0 text-emerald-400/80 transition hover:text-emerald-300" aria-label={`Принять ${p.id}`}>✓</button>
                        <button type="button" onClick={() => void rsiOp({ op: "reject", id: p.id }, "предложение отклонено")} disabled={rsiBusy} className="shrink-0 text-zinc-600 transition hover:text-rose-400" aria-label={`Отклонить ${p.id}`}>✕</button>
                      </>
                    )}
                    {p.status === "ADOPTED" && (
                      <button type="button" onClick={() => void rsiOp({ op: "rollback", id: p.id }, "откат — артефакт удалён")} disabled={rsiBusy} className="shrink-0 text-amber-400/80 transition hover:text-amber-300" aria-label={`Откатить ${p.id}`}>↩</button>
                    )}
                  </div>
                ))}
                {rsi && rsi.proposals.length === 0 && (
                  <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">предложений нет — сгенерируйте из уроков памяти</div>
                )}
                {!rsi && <div className="rounded border border-dashed border-zinc-800 px-2 py-1.5 text-center font-mono text-[9px] text-zinc-600">daemon недоступен…</div>}
              </div>
            </div>
          </Sec>

          <Sec id="memory-recall" title="RECALL · BRAIN" icon={Brain} tone="violet"
            right={<>
              {brain && (
                <span className="font-mono text-[10px] text-zinc-600" title="self-probe: латентность event-loop + БД (аналог wake-probe старой системы)">
                  loop {brain.probe.eventloop_ms}мс · db {brain.probe.db_probe_ms}мс
                </span>
              )}
            </>}>
            <div data-testid="memory-block" className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <Chip label="memory_rows" value={brain?.probe.memory_rows ?? "—"} tone="teal" title="строк в памяти daemon'а" />
                <Chip label="used" value={memBlock ? memBlock.used.length : "—"} title="записей вошло в блок (n=8, бюджет символов)" />
              </div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-600" title="TEAM MEMORY — блок, уходящий в промпт агентам (порт #memoryBlockFor, бюджет символов)">
                блок памяти в промптах агентов
              </div>
              <pre tabIndex={0} role="region" aria-label="Блок памяти (TEAM MEMORY)"
                className="max-h-48 overflow-y-auto mc-scroll whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950/60 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                {memBlock?.block || "(блок пуст — память ещё не наполнена)"}
              </pre>
              {(brain?.thoughts.length ?? 0) > 0 && (
                <div className="max-h-16 space-y-0.5 overflow-y-auto mc-scroll">
                  {(brain?.thoughts ?? []).slice(0, 4).map((t) => (
                    <div key={t.key} className="truncate rounded bg-zinc-900/50 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500" title={t.content}>{t.content}</div>
                  ))}
                </div>
              )}
            </div>
          </Sec>
        </div>
      </div>
    </div>
  );
}
