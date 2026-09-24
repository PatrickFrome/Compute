"use client";
/**
 * ME2 BROWSER (R74, Page 3) — браузерная инфраструктура.
 * Центр: BrowserStage (полный режим — скринкаст, вкладки, pair-control, CDP-фолбэк).
 * Правая колонка (≥lg) — порт legacy-телеметрии:
 *  - SENSE  (tl-sense, L4044-4080): aria-перцепция GET /browser/sense (+?refresh=1), дифы
 *           /browser/sense/diffs, actuation POST /browser/sense/act {key,action,text} с авто-verify;
 *  - OBSV   (tl-obsv, L4082-4124): GET /browser/obsv?limit=14, POST ops attach/reset/stop/ttl,
 *           ленты network/console/exceptions;
 *  - EFFECT (effect-плоскость daemon, GET /browser/effect): вердикты + durable fences,
 *           clear — только с подтверждением и честным тостом при 403 (approval-гейт fence_clear);
 *  - CDP-LIVE (L4339-4386): /stats :3043 — stats-чипы (контролы качества q/w живут в BrowserStage).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Radar, RefreshCw, ScanEye, ShieldCheck, Zap } from "lucide-react";
import { PageHeader, Sec, Chip } from "@/components/me2/ui/primitives";
import { me2Fetch, toastBus } from "@/lib/me2-bus";
import { BrowserStage } from "@/components/me2/stages/browser-stage";

// ── типы (зеркало daemon: sense.ts / obsv.ts / effect.ts) ───────────────────────
type SenseTarget = { ref: string; role: string; name: string };
type SenseRow = { tab: string; url: string; title: string; targets_count: number; revision: string; age_s?: number; targets: SenseTarget[] };
type SenseData = { ok: boolean; rows: SenseRow[]; total_targets: number };
type SenseDiff = { changed: boolean; added_n: number; removed_n: number; moved_n: number; saved_pct: number };
type SenseDiffRow = { id: number; tab: string; prev_revision: string | null; revision: string; added_n: number; removed_n: number; moved_n: number; chars_full: number; chars_diff: number; saved_pct: number; captured_at: number; age_s: number };
type SenseActResult = {
  ok: boolean; error?: string; acted?: string; target?: SenseTarget | null;
  effect?: { status: string; fenced_now: boolean };
  verify?: { revision_changed: boolean; target_alive: boolean; before: string; after: string };
};
type ObsvNet = { t: number; method: string; url: string; status: number | null; mime: string; type: string; ms: number | null; failed?: string };
type ObsvCon = { t: number; level: string; text: string };
type ObsvExc = { t: number; text: string; url: string };
type ObsvData = {
  ok: boolean;
  status: { wanted: boolean; attached: boolean; target: string | null; buffers: { net: number; con: number; exc: number }; totals: { net: number; con: number; exc: number }; last_event_age_s: number | null; persist?: { ttl_min: number; rows: number; flushed_total: number; queue: number; last_flush_age_s: number | null; last_error: string | null } };
  network: ObsvNet[]; console: ObsvCon[]; exceptions: ObsvExc[];
};
type EffectData = {
  ok: boolean;
  fences: Array<{ effect_key: string; reason: string; created_at: number; cleared_at: number | null; cleared_note: string | null }>;
  stats: { total: number; by_status: Record<string, number>; fences_active: number };
};
type CdpInfo = { cdp: { port: number; target: string } | null; frames: number; streams: number };

const R = (p: string, init?: RequestInit) => fetch(`${p}${p.includes("?") ? "&" : "?"}XTransformPort=3041`, { cache: "no-store", ...init });

// ── SENSE ───────────────────────────────────────────────────────────────────────
function SenseSection() {
  const [sense, setSense] = useState<SenseData | null>(null);
  const [diffs, setDiffs] = useState<SenseDiffRow[]>([]);
  const [lastDiff, setLastDiff] = useState<SenseDiff | null>(null);
  const [lastEffect, setLastEffect] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actKey, setActKey] = useState("");
  const [actAction, setActAction] = useState<"click" | "type" | "press">("click");
  const [actText, setActText] = useState("");

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      // daemon отвечает либо списком {rows}, либо свежим CAPTURE одной строки {tab, ..., diff}
      const r = await R(`/browser/sense${refresh ? "&refresh=1" : ""}`).then((x) => x.json()) as (SenseData | (SenseRow & { diff?: SenseDiff })) | null;
      if (r && !("ok" in r) || r?.ok !== false) {
        if (r && "rows" in r && Array.isArray(r.rows)) setSense(r);
        else if (r && "tab" in r) {
          const row = r as SenseRow & { diff?: SenseDiff; targets_count?: number };
          setSense({ ok: true, rows: [row], total_targets: Number(row.targets_count ?? row.targets?.length ?? 0) });
          if (row.diff) setLastDiff(row.diff);
        }
      }
      const d = await me2Fetch<{ rows: SenseDiffRow[]; total: number }>("/browser/sense/diffs?XTransformPort=3041&limit=6");
      if (d) setDiffs(d.rows ?? []);
    } catch { /* daemon недоступен */ } finally { setBusy(false); }
  }, []);

  // лёгкий поллинг: перцепция меняется ходами агентов
  useEffect(() => {
    void load();
    const iv = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(iv);
  }, [load]);

  // sense-действие по смыслу (имя/ref) + авто-verify → честный тост с вердиктом ревизий
  const act = useCallback(async (key: string, action: "click" | "type" | "press", text?: string) => {
    if (!key.trim()) { toastBus({ title: "sense ✗", description: "key обязателен (имя или ref цели)", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const res = await R("/browser/sense/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim(), action, ...(text ? { text } : {}) }),
      }).then((x) => x.json()) as SenseActResult;
      if (res?.ok) {
        setLastEffect(String(res.effect?.status ?? "—"));
        toastBus({
          title: `sense: ${key.slice(0, 24)} → ${res.target?.ref ?? "?"}`,
          description: `ревизия ${String(res.verify?.before ?? "?").slice(0, 8)} → ${String(res.verify?.after ?? "?").slice(0, 8)}${res.verify?.revision_changed ? " · изменилась ✓" : " · без изменений"} · effect: ${String(res.effect?.status ?? "—")}`,
        });
      } else toastBus({ title: `sense ✗ ${String(res?.error ?? "ошибка").slice(0, 70)}`, variant: "destructive" });
    } catch { toastBus({ title: "sense ✗ daemon недоступен", variant: "destructive" }); }
    finally { setBusy(false); void load(true); }
  }, [load]);

  const row = sense?.rows[0];

  return (
    <Sec
      id="sense"
      title="SENSE"
      icon={ScanEye}
      tone="emerald"
      dense
      right={
        <button
          type="button"
          onClick={() => { void load(true); }}
          disabled={busy}
          aria-label="Снять свежую перцепцию страницы (CAPTURE)"
          className="rounded border border-lime-800/50 px-1.5 py-0.5 font-mono text-[9px] text-lime-300/90 transition hover:bg-zinc-800 disabled:opacity-40"
        >
          снять
        </button>
      }
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-mono text-[9px] text-zinc-600" title={row ? `rev ${row.revision} · ${row.url}` : "перцепция ещё не снималась"}>
          {sense ? `${row?.targets_count ?? 0} целей · rev ${row?.revision ?? "—"}` : "нет данных"}
        </span>
        {lastDiff && (
          <span data-testid="sense-diff-chips" className="flex shrink-0 items-center gap-1 font-mono text-[9px]" title="ME28 (D1): диф последней ревизии — агенту отдаём только изменения (экономия токенов); ~ — перенумерация ref">
            <span className={`rounded border px-1 py-0.5 ${lastDiff.changed ? "border-teal-800/60 bg-teal-950/30 text-teal-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-500"}`}>
              {lastDiff.changed ? `diff +${lastDiff.added_n}/−${lastDiff.removed_n}${lastDiff.moved_n ? `/~${lastDiff.moved_n}` : ""} · −${lastDiff.saved_pct}% токенов` : "без изменений"}
            </span>
          </span>
        )}
        {lastEffect && (
          <span data-testid="effect-status" className={`shrink-0 rounded border px-1 py-0.5 font-mono text-[9px] ${lastEffect === "CONFIRMED" ? "border-lime-800/50 text-lime-300" : lastEffect === "AMBIGUOUS" || lastEffect === "FENCED" ? "border-rose-900/60 text-rose-300" : "border-amber-900/50 text-amber-300"}`} title="ME19: вердикт эффекта последнего sense-действия (AMBIGUOUS ставит durable fence)">
            {lastEffect}
          </span>
        )}
      </div>
      {row?.targets?.length ? (
        <div className="mt-1.5 flex max-h-16 flex-wrap gap-1 overflow-y-auto pr-1 [scrollbar-width:thin]" role="list" aria-label="Семантические цели страницы">
          {row.targets.slice(0, 14).map((t) => (
            <button key={t.ref} type="button" role="listitem" disabled={busy}
              onClick={() => { void act(t.name || t.ref, "click"); }}
              title={`${t.role} «${t.name || "(без имени)"}» · ${t.ref} — клик = sense-действие с авто-verify`}
              className="max-w-40 truncate rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 text-left font-mono text-[9px] text-zinc-400 transition hover:border-lime-700 hover:text-lime-200 disabled:opacity-40">
              <span className="text-zinc-600">{t.role.slice(0, 3)}·</span>{t.name || t.ref}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[9px] text-zinc-600">перцепции нет — «снять» сделает aria-snapshot активной вкладки в семантические цели</p>
      )}
      {/* actuation-форма: POST /browser/sense/act {key, action, text} */}
      <form
        className="mt-2 flex flex-wrap items-center gap-1 rounded border border-zinc-800/70 bg-zinc-900/30 p-1.5"
        aria-label="Sense-actuation: действие по смыслу"
        onSubmit={(e) => { e.preventDefault(); void act(actKey, actAction, actAction === "type" ? actText : undefined); }}
      >
        <input
          value={actKey}
          onChange={(e) => setActKey(e.target.value)}
          placeholder="key (имя/ref цели)"
          aria-label="Ключ цели для sense-act"
          className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 placeholder:text-zinc-600 focus:border-lime-900 focus:outline-none"
        />
        <select
          value={actAction}
          onChange={(e) => setActAction(e.target.value as "click" | "type" | "press")}
          aria-label="Тип sense-действия"
          className="rounded border border-zinc-800 bg-zinc-900/80 px-1 py-0.5 font-mono text-[9px] text-zinc-300 focus:outline-none"
        >
          <option value="click">click</option>
          <option value="type">type</option>
          <option value="press">press</option>
        </select>
        {actAction === "type" && (
          <input
            value={actText}
            onChange={(e) => setActText(e.target.value)}
            placeholder="text"
            aria-label="Текст для sense-act type"
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 placeholder:text-zinc-600 focus:border-lime-900 focus:outline-none"
          />
        )}
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded border border-lime-800/50 bg-lime-950/20 px-1.5 py-0.5 font-mono text-[9px] text-lime-300 transition hover:bg-zinc-800 disabled:opacity-40"
        >
          act
        </button>
      </form>
      {diffs.length > 0 && (
        <div className="mt-1.5 space-y-0.5 font-mono text-[8.5px] text-zinc-600" title="история дифов перцепции (/browser/sense/diffs)">
          {diffs.slice(0, 4).map((d) => (
            <p key={d.id} className="truncate">
              <span className="text-zinc-500">{d.age_s}s</span> · {d.tab.slice(0, 14)} · +{d.added_n}/−{d.removed_n}{d.moved_n ? `/~${d.moved_n}` : ""} · −{d.saved_pct}% · rev {d.revision.slice(0, 8)}
            </p>
          ))}
        </div>
      )}
    </Sec>
  );
}

// ── OBSV ────────────────────────────────────────────────────────────────────────
function ObsvSection() {
  const [obsv, setObsv] = useState<ObsvData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await me2Fetch<ObsvData>("/browser/obsv?XTransformPort=3041&limit=14");
      if (r?.ok) setObsv(r);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void load();
    const iv = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(iv);
  }, [load]);

  const op = useCallback(async (o: string, minutes?: number) => {
    setBusy(true);
    try {
      await R("/browser/obsv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(minutes != null ? { op: o, minutes } : { op: o }) }).then((x) => x.json());
      toastBus({ title: `obsv: ${o} ✓` });
    } catch { toastBus({ title: "obsv ✗ daemon недоступен", variant: "destructive" }); }
    finally { setBusy(false); void load(); }
  }, [load]);

  const items = useMemo(() => {
    if (!obsv) return [] as Array<{ t: number; kind: string; level: string; text: string }>;
    return [
      ...(obsv.exceptions ?? []).map((e) => ({ t: e.t, kind: "exc", level: "error", text: e.text })),
      ...(obsv.console ?? []).map((c) => ({ t: c.t, kind: "con", level: c.level, text: c.text })),
      ...(obsv.network ?? []).filter((n) => n.failed || (n.status ?? 0) >= 400).map((n) => ({ t: n.t, kind: "net", level: "error", text: `${n.method} ${n.url} ${n.failed ? `· ${n.failed}` : `· ${n.status}`}` })),
      ...(obsv.network ?? []).filter((n) => !n.failed && n.status !== null && (n.status ?? 0) < 400).slice(0, 8).map((n) => ({ t: n.t, kind: "net", level: "ok", text: `${n.status} ${n.method} ${n.url}${n.ms != null ? ` · ${n.ms}ms` : ""}` })),
    ].sort((a, b) => b.t - a.t).slice(0, 14);
  }, [obsv]);

  return (
    <Sec
      id="obsv"
      title="OBSV"
      icon={Radar}
      tone="amber"
      dense
      right={
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => void load()} aria-label="Обновить сенсоры" disabled={busy} className="rounded border border-zinc-700/60 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40">
            <RefreshCw className={`h-2.5 w-2.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </span>
      }
    >
      <div data-testid="obsv-chips" className="flex flex-wrap items-center gap-1 font-mono text-[9px]" title={`captured всего: ${obsv?.status.totals ? obsv.status.totals.net + obsv.status.totals.con + obsv.status.totals.exc : 0}`}>
        <span className={`rounded border px-1 py-0.5 ${obsv?.status.attached ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`} title="CDP-коллектор приаттачен к цели">
          {obsv?.status.attached ? "attached" : "detached"}
        </span>
        <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400">net {obsv?.status.buffers.net ?? 0}</span>
        <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-amber-300/90">con {obsv?.status.buffers.con ?? 0}</span>
        <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-rose-300/90">exc {obsv?.status.buffers.exc ?? 0}</span>
        {obsv?.status.persist && (
          <span className="rounded border border-teal-900/60 bg-teal-950/30 px-1 py-0.5 text-teal-300/90" title={`ME29 (D2): история сенсоров персистится в SQLite с TTL ${obsv.status.persist.ttl_min}м; очередь=${obsv.status.persist.queue}, всего слито=${obsv.status.persist.flushed_total}${obsv.status.persist.last_error ? ", ОШИБКА=" + obsv.status.persist.last_error : ""}`}>
            sql {obsv.status.persist.rows}·TTL{obsv.status.persist.ttl_min}м
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => void op("attach")} disabled={busy} aria-label="Приаттачить CDP-коллектор" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-40">attach</button>
        <button type="button" onClick={() => void op("reset")} disabled={busy} aria-label="Очистить кольцевые буферы сенсоров" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-40">сброс</button>
        <button type="button" onClick={() => void op("stop")} disabled={busy} aria-label="Остановить CDP-коллектор" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-40">stop</button>
        <button type="button" onClick={() => void op("ttl", 30)} disabled={busy} aria-label="Установить TTL истории 30 минут" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-40">ttl 30м</button>
      </div>
      <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto pr-1 font-mono text-[9px] [scrollbar-width:thin]" aria-label="Последние события сети и консоли">
        {items.length === 0 ? (
          <li className="text-zinc-600">событий нет — подожди трафик вкладки или нажми «attach» и подожди</li>
        ) : items.map((e, i) => (
          <li key={`${e.kind}-${e.t}-${i}`} className="flex items-start gap-1.5">
            <span className="shrink-0 text-zinc-600">{new Date(e.t).toLocaleTimeString("ru-RU", { hour12: false })}</span>
            <span className={`shrink-0 uppercase ${e.level === "error" ? "text-rose-300" : e.level === "warning" ? "text-amber-300" : "text-zinc-500"}`}>{e.kind}</span>
            <span className="min-w-0 break-all text-zinc-400" title={e.text}>{e.text}</span>
          </li>
        ))}
      </ul>
    </Sec>
  );
}

// ── EFFECT ──────────────────────────────────────────────────────────────────────
function EffectSection() {
  const [effect, setEffect] = useState<EffectData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await me2Fetch<EffectData>("/browser/effect?XTransformPort=3041");
    if (d?.ok) setEffect(d);
  }, []);

  useEffect(() => {
    void load();
    const iv = window.setInterval(() => { void load(); }, 15_000);
    return () => window.clearInterval(iv);
  }, [load]);

  // снятие fence — мутирующая операция за approval-гейтом fence_clear: подтверждение обязательно,
  // отказ 403 честен (живое согласие оператора: один approve = одно снятие)
  const clearFence = useCallback(async (key: string) => {
    if (!window.confirm(`Снять durable fence «${key}»? Операция за approval-гейтом fence_clear — без живого согласия daemon вернёт 403.`)) return;
    setBusy(true);
    try {
      const r = await me2Fetch<{ ok: boolean }>("/browser/effect?XTransformPort=3041", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "clear", effect_key: key, note: "operator-ui" }),
      });
      if (r?.ok) {
        toastBus({ title: `fence снят ✓`, description: key });
        await load();
      } else {
        toastBus({ title: "fence clear ✗ 403", description: "отказано approval-гейтом fence_clear — подтвердите решение в SUPERVISOR → APPROVALS (или daemon недоступен)", variant: "destructive" });
      }
    } finally { setBusy(false); }
  }, [load]);

  const activeFences = (effect?.fences ?? []).filter((f) => f.cleared_at == null);
  const byStatus = effect?.stats.by_status ?? {};

  return (
    <Sec id="effect" title="EFFECT" icon={Zap} tone="rose" dense right={<span className="font-mono text-[9px] text-zinc-500">{effect ? `${effect.stats.fences_active} fences` : "—"}</span>}>
      <div className="flex flex-wrap items-center gap-1 font-mono text-[9px]" title="вердикты эффект-плоскости (CONFIRMED/AMBIGUOUS/FENCED/…, R23)">
        <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400">total {effect?.stats.total ?? "—"}</span>
        {Object.entries(byStatus).slice(0, 5).map(([k, v]) => (
          <span key={k} className={`rounded border px-1 py-0.5 ${k === "CONFIRMED" ? "border-lime-900/60 bg-lime-950/30 text-lime-300" : k === "AMBIGUOUS" || k === "FENCED" ? "border-rose-900/60 bg-rose-950/30 text-rose-300" : "border-amber-900/60 bg-amber-950/30 text-amber-300"}`}>{k.toLowerCase()} {v}</span>
        ))}
      </div>
      {activeFences.length === 0 ? (
        <p className="mt-1.5 text-[9px] text-zinc-600">активных fences нет — fence ставится при AMBIGUOUS-эффекте sense-действия (durable, переживает рестарт)</p>
      ) : (
        <ul className="mt-1.5 space-y-1" aria-label="Активные durable fences">
          {activeFences.map((f) => (
            <li key={f.effect_key} className="flex items-start gap-1.5 rounded border border-rose-900/40 bg-rose-950/20 px-1.5 py-1">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[9px] text-rose-200" title={f.effect_key}>{f.effect_key}</p>
                <p className="truncate text-[8.5px] text-zinc-500" title={f.reason}>{f.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => void clearFence(f.effect_key)}
                disabled={busy}
                aria-label={`Снять fence ${f.effect_key}`}
                title="POST /browser/effect {op:clear} — за approval-гейтом fence_clear (403 без согласия)"
                className="shrink-0 rounded border border-rose-900/60 px-1.5 py-0.5 font-mono text-[8px] text-rose-300 transition hover:bg-zinc-800 disabled:opacity-40"
              >
                clear
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sec>
  );
}

// ── CDP-LIVE (stats-чипы; контролы качества q/w — внутри BrowserStage) ──────────
function CdpLiveSection() {
  const [info, setInfo] = useState<CdpInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/stats?XTransformPort=3043");
        if (r.ok && alive) setInfo(await r.json() as CdpInfo);
      } catch { /* daemon/restart — тише */ }
    };
    void pull();
    const st = window.setInterval(pull, 4000);
    return () => { alive = false; window.clearInterval(st); };
  }, []);
  return (
    <Sec id="cdp-live" title="CDP·LIVE" icon={ShieldCheck} tone="violet" dense>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip label="cdp" value={info?.cdp ? `:${info.cdp.port}` : "—"} tone={info?.cdp ? "emerald" : "amber"} title="CDP-порт QA-браузера (:3043, сессия на клиента)" />
        <Chip label="кадров" value={info?.frames ?? "—"} title="кадров отдано всем клиентам" />
        <Chip label="стримов" value={info?.streams ?? "—"} title="активных стрим-клиентов" />
      </div>
      <p className="mt-1.5 truncate font-mono text-[9px] text-zinc-500" title={info?.cdp?.target}>
        {info?.cdp
          ? <>цель: <span className="text-zinc-300">{(info.cdp.target || "—").replace(/^https?:\/\//, "").slice(0, 42)}</span></>
          : <span className="text-amber-500/80">CDP-цель не найдена — agent-browser не запущен?</span>}
      </p>
      <p className="mt-1 text-[8.5px] leading-snug text-zinc-600">
        качество кадра (q30/55/85 · w480/640/960) — в статус-строке BrowserStage слева
      </p>
    </Sec>
  );
}

// ── Page: BROWSER ───────────────────────────────────────────────────────────────
export function BrowserPage() {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-browser" data-panel-browser>
      <PageHeader title="BROWSER" sub="браузерная инфраструктура и Browser Agents" />
      <div className="flex min-h-0 flex-1 gap-2">
        <BrowserStage />
        <div className="mc-scroll hidden w-96 shrink-0 flex-col gap-2 overflow-y-auto lg:flex" aria-label="Браузерная инфраструктура">
          <SenseSection />
          <ObsvSection />
          <EffectSection />
          <CdpLiveSection />
        </div>
      </div>
    </div>
  );
}
