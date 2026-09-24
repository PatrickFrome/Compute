"use client";
/**
 * ME2 BrowserStage (R74) — общий живой вьюпорт браузера-агента.
 * Порт legacy-скринкаста 1:1 (docs/legacy-mission-control.tsx.txt L777-810, L1055-1240, L2226-2442):
 *  - WS-стрим кадров agent-browser :3042 (maxFps+pacing per-client, ack-пейсинг, «авто» адаптирует
 *    потолок fps под измеренную полосу config-сообщением без реконнекта);
 *  - PAIR-CONTROL «руль»: клик/клавиатура/колесо → активная вкладка (input_mouse/input_keyboard,
 *    координаты через naturalWidth кадра — metadata.deviceWidth не годится, проверено живьём в R8);
 *  - CDP-фолбэк :3043 — poll /stats 4с + самотемперируемый /screencast.jpg (onLoad→2s/onError→6s);
 *  - таб-полоса живых вкладок через команду шины BROWSER_TABS (loadBrowserTabs),
 *    refresh по событиям BROWSER_TAB_OPENED/CLOSED из store.
 * compact=true (COMMAND) — без второстепенных панелей (лента консоли); полный режим — страница BROWSER.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, MonitorPlay, MousePointerClick, Plus, RefreshCw, RotateCcw, ShieldCheck, Terminal, X } from "lucide-react";
import { loadBrowserTabs, sendCommand, type BrowserTab } from "@/lib/me2-bus";
import { useMe2 } from "@/components/me2/store";

// v0.9.0: профили полосы стрима (ресёрч ABR + streaming.md: pacing+maxFps — per-client, config мгновенен)
// макс = push 12fps (низкая задержка для руля) · баланс = ack 8 · эконом = ack 2 · авто = ack, maxFps адаптивен по KB/s
const CAST_PROFILES = {
  "макс": { maxFps: 12, pacing: "push" },
  "баланс": { maxFps: 8, pacing: "ack" },
  "эконом": { maxFps: 2, pacing: "ack" },
  "авто": { maxFps: 8, pacing: "ack" },
} as const;
type CastProfile = keyof typeof CAST_PROFILES;

type CastStat = { connected: boolean; fps: number; url: string | null; error: string | null; lastAge: number | null; kbs: number | null };
type CdpInfo = { cdp: { port: number; target: string } | null; frames: number; streams: number };

export function BrowserStage({ compact, defaultCastOn = false }: { compact?: boolean; defaultCastOn?: boolean }) {
  // ветки браузера (agent-browser через шину, v0.6.0)
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [browserBusy, setBrowserBusy] = useState(false);
  // СКРИНКАСТ (v0.7.0): живой вид активной вкладки (:3042, вне бюджета шины) — ВКЛ по пропу (COMMAND)
  const [castOn, setCastOn] = useState(defaultCastOn);
  const [castProfile, setCastProfile] = useState<CastProfile>("баланс");
  const [castStat, setCastStat] = useState<CastStat>({ connected: false, fps: 0, url: null, error: null, lastAge: null, kbs: null });
  const castImgRef = useRef<HTMLImageElement | null>(null);
  // PAIR-CONTROL (v0.8.0): клик/клавиатура/колесо из скринкаста → активная вкладка
  const castWsRef = useRef<WebSocket | null>(null);
  const castWrapRef = useRef<HTMLDivElement | null>(null);
  const [castCtl, setCastCtl] = useState(false);
  const [castConsole, setCastConsole] = useState<{ id: number; level: string; text: string }[]>([]);
  const [castConOpen, setCastConOpen] = useState(false);
  const castMsgId = useRef(0);
  // CDP-СКРИНКАСТ (v0.15.0): per-client jpeg-качество/ширина через CDP (:3043, snapshot-поллинг)
  const [cdpQ, setCdpQ] = useState(55);
  const [cdpW, setCdpW] = useState(640);
  const [cdpTick, setCdpTick] = useState(0);
  const [cdpInfo, setCdpInfo] = useState<CdpInfo | null>(null);
  // R46-восстановление: reconnect стрима :3042 + свежий CDP-кадр
  const [castNonce, setCastNonce] = useState(0);
  // адресная строка: черновик URL (Enter → BROWSER_NAVIGATE)
  const [urlDraft, setUrlDraft] = useState("");
  const activeUrl = castStat.url ?? cdpInfo?.cdp?.target ?? "about:blank";

  const events = useMe2((s) => s.events);
  const lastTabEvSeq = useRef(0);

  // ветки браузера: загрузка списка вкладок через шину (BROWSER_TABS)
  const refreshTabs = useCallback(async () => {
    setBrowserBusy(true);
    try {
      setBrowserTabs(await loadBrowserTabs());
    } finally {
      setBrowserBusy(false);
    }
  }, []);

  // вкладки нужны всегда, пока стадия смонтирована — при входе + редкий поллинг (команда шины дорожает)
  useEffect(() => {
    const t = window.setTimeout(() => { void refreshTabs(); }, 0);
    const iv = window.setInterval(() => { void refreshTabs(); }, 45_000);
    return () => { window.clearTimeout(t); window.clearInterval(iv); };
  }, [refreshTabs]);

  // refresh по событию шины: вкладка открыта/закрыта/навигирована агентом → подтягиваем список (store events)
  useEffect(() => {
    const e = events[0];
    if (!e || e.seq === lastTabEvSeq.current) return;
    if (e.type === "BROWSER_TAB_OPENED" || e.type === "BROWSER_TAB_CLOSED" || e.type === "BROWSER_NAVIGATED" || e.type === "BROWSER_TAB_SELECTED") {
      lastTabEvSeq.current = e.seq;
      void refreshTabs();
    }
  }, [events, refreshTabs]);

  // ── СКРИНКАСТ + PAIR-CONTROL: WS-стрим кадров активной вкладки (legacy L1060-1131) ──
  useEffect(() => {
    if (!castOn) return;
    let stopped = false;
    let ws: WebSocket | null = null;
    let fpsCount = 0;
    let fpsMark = Date.now();
    let b64Bytes = 0; // base64-символы за окно (≈ байты × 3/4)
    const prof = CAST_PROFILES[castProfile];
    const pacing = prof.pacing as "push" | "ack";
    let autoFps: number = prof.maxFps; // для «авто»: текущий адаптивный потолок
    try {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/?XTransformPort=3042&maxFps=${prof.maxFps}${pacing === "ack" ? "&pacing=ack" : ""}`);
      castWsRef.current = ws;
      ws.onopen = () => { if (!stopped) setCastStat((s) => ({ ...s, connected: true, error: null })); };
      ws.onmessage = (ev) => {
        if (stopped) return;
        try {
          const msg = JSON.parse(ev.data as string) as {
            type: string; data?: string; url?: string; seq?: number;
            metadata?: { deviceWidth?: number; deviceHeight?: number; timestamp?: number };
            level?: string; text?: string;
            args?: Array<{ value?: string; description?: string; preview?: { description?: string } }>;
          };
          if (msg.type === "frame" && msg.data) {
            const img = castImgRef.current;
            if (img) img.src = `data:image/jpeg;base64,${msg.data}`;
            b64Bytes += msg.data.length;
            fpsCount++;
            // ack-пейсинг: эхо seq обязателен, иначе сервер молчит (cumulative: свежий ack покрывает старые)
            if (pacing === "ack" && msg.seq != null && ws?.readyState === 1) {
              ws.send(JSON.stringify({ type: "ack", seq: msg.seq }));
            }
            const nowT = Date.now();
            if (nowT - fpsMark >= 1000) {
              const kbs = Math.round((b64Bytes * 0.75) / 1024);
              b64Bytes = 0;
              // «авто»: держим полосу в разумных пределах, переставляя потолок fps
              if (castProfile === "авто" && ws?.readyState === 1) {
                const want = kbs > 600 ? 2 : kbs > 250 ? 4 : kbs > 100 ? 8 : 12;
                if (want !== autoFps) {
                  autoFps = want;
                  ws.send(JSON.stringify({ type: "config", maxFps: want }));
                }
              }
              setCastStat((s) => ({ ...s, fps: fpsCount, kbs, lastAge: msg.metadata?.timestamp ? nowT - msg.metadata.timestamp : null }));
              fpsCount = 0; fpsMark = nowT;
            }
          } else if (msg.type === "url") {
            setCastStat((s) => ({ ...s, url: msg.url ?? s.url }));
          } else if (msg.type === "console") {
            // живая лента консоли вкладки (не в audit): text = первый string-arg, объекты — кратко
            let text = msg.text ?? "";
            for (const a of (msg.args ?? []).slice(1)) text += ` ${a.value ?? a.preview?.description ?? a.description ?? "…"}`;
            text = (text || "(пусто)").slice(0, 200);
            setCastConsole((prev) => [...prev.slice(-29), { id: ++castMsgId.current, level: msg.level ?? "log", text }]);
          }
        } catch { /* не-JSON кадр — игнор */ }
      };
      ws.onerror = () => { if (!stopped) setCastStat((s) => ({ ...s, connected: false, error: "стрим недоступен (:3042)" })); };
      ws.onclose = () => { if (!stopped) setCastStat((s) => ({ ...s, connected: false })); };
    } catch {
      setCastStat((s) => ({ ...s, connected: false, error: "WS не открыт" }));
    }
    return () => {
      stopped = true;
      try { ws?.close(); } catch { /* уже закрыт */ }
      castWsRef.current = null;
      setCastStat((s) => ({ ...s, connected: false, fps: 0, kbs: null }));
      setCastConsole([]);
    };
  }, [castOn, castProfile, castNonce]);

  // pair-control: сняли «live» — руль выключается тоже
  useEffect(() => {
    if (!castOn && castCtl) setCastCtl(false);
  }, [castOn, castCtl]);

  // CDP-тайл (:3043): poll /stats раз в 4с (legacy L1142-1153)
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/stats?XTransformPort=3043");
        if (r.ok && alive) setCdpInfo(await r.json() as CdpInfo);
      } catch { /* daemon/restart — тише */ }
    };
    void pull();
    const st = window.setInterval(pull, 4000);
    return () => { alive = false; window.clearInterval(st); };
  }, []);

  // самотемперируемый тик CDP-кадра: следующий запрос ставится только после onLoad/onError
  // (урок R15: фиксированный тик отменял каждую загрузку при тяжёлых кадрах — кадр не успевал НИКОГДА)
  const aliveTickRef = useRef(true);
  useEffect(() => {
    aliveTickRef.current = true;
    return () => { aliveTickRef.current = false; };
  }, []);
  const cdpNextTick = useCallback((ms: number) => {
    window.setTimeout(() => { if (aliveTickRef.current) setCdpTick((t) => t + 1); }, ms);
  }, []);

  // PAIR-CONTROL: координаты клика → координаты страницы. База — naturalWidth/Height кадра:
  // jpeg кадра = РЕАЛЬНЫЙ вьюпорт страницы, metadata.deviceWidth/Height — эмулированные метрики (R8)
  const castMapXY = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = castImgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const dw = img.naturalWidth;
    const dh = img.naturalHeight;
    const r = img.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const scale = Math.min(r.width / dw, r.height / dh);
    const ox = r.left + (r.width - dw * scale) / 2;
    const oy = r.top + (r.height - dh * scale) / 2;
    const x = Math.round((clientX - ox) / scale);
    const y = Math.round((clientY - oy) / scale);
    if (x < 0 || y < 0 || x > dw || y > dh) return null;
    return { x, y };
  }, []);

  // клик (mousePressed+mouseReleased) — только в armed-режиме
  const castSendMouse = useCallback((eventType: string, e: { clientX: number; clientY: number }) => {
    if (!castCtl) return;
    const ws = castWsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const p = castMapXY(e.clientX, e.clientY);
    if (!p) return;
    ws.send(JSON.stringify({ type: "input_mouse", eventType, ...p, button: "left", clickCount: 1 }));
  }, [castCtl, castMapXY]);

  // клавиатура: keyDown{text}/keyUp по CDP-семантике; Ctrl/Meta-комбо остаются у оператора
  const castKey = useCallback((e: React.KeyboardEvent) => {
    if (!castCtl || e.ctrlKey || e.metaKey) return;
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
    const ws = castWsRef.current;
    if (!ws || ws.readyState !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    const mods = (e.altKey ? 1 : 0) | (e.shiftKey ? 8 : 0);
    const down: Record<string, unknown> = { type: "input_keyboard", eventType: "keyDown", key: e.key, modifiers: mods };
    if (e.key.length === 1 && !e.altKey) down.text = e.key;
    else if (e.key === "Enter") down.text = "\r";
    else if (e.key === "Backspace") down.text = "\b";
    ws.send(JSON.stringify(down));
    ws.send(JSON.stringify({ type: "input_keyboard", eventType: "keyUp", key: e.key, modifiers: mods }));
  }, [castCtl]);

  // armed: автофокус на кадр + колесо нативным listener'ом (React onWheel пассивен)
  useEffect(() => {
    if (!castCtl) return;
    castWrapRef.current?.focus({ preventScroll: true });
    const el = castWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const ws = castWsRef.current;
      if (!ws || ws.readyState !== 1) return;
      const p = castMapXY(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      ws.send(JSON.stringify({ type: "input_mouse", eventType: "mouseWheel", ...p, deltaX: Math.round(e.deltaX), deltaY: Math.round(e.deltaY) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [castCtl, castMapXY]);

  const toggleCastCtl = useCallback(() => setCastCtl((v) => !v), []);

  const reloadCast = useCallback(() => {
    setCastNonce((n) => n + 1);
    setCdpTick((t) => t + 1);
  }, []);

  // ── действия вкладок (payload'ы 1:1 с реестром daemon: commands.ts) ──
  // клик вкладки → BROWSER_SELECT_TAB {tab} (CONTROL); x → BROWSER_CLOSE {tab} (CONTROL);
  // «+» → BROWSER_OPEN {url}; Enter в urlbar → BROWSER_NAVIGATE {url, tab?}
  const activateTab = useCallback(async (t: BrowserTab) => {
    if (t.active) return;
    const r = (await sendCommand("BROWSER_SELECT_TAB", { tab: t.id }, { lane: "CONTROL", quiet: true })) as { tabs?: BrowserTab[] } | null;
    if (r?.tabs) setBrowserTabs(r.tabs);
    else void refreshTabs();
  }, [refreshTabs]);

  const closeTab = useCallback(async (t: BrowserTab) => {
    const r = (await sendCommand("BROWSER_CLOSE", { tab: t.id }, { lane: "CONTROL", successMsg: "вкладка закрыта" })) as { tabs?: BrowserTab[] } | null;
    if (r?.tabs) setBrowserTabs(r.tabs);
    else void refreshTabs();
  }, [refreshTabs]);

  const openTab = useCallback(async () => {
    const url = window.prompt("URL новой вкладки (http/https):", "https://");
    if (!url || !/^https?:\/\//i.test(url)) return;
    const r = (await sendCommand("BROWSER_OPEN", { url })) as { tabs?: BrowserTab[] } | null;
    if (r?.tabs) setBrowserTabs(r.tabs);
    else void refreshTabs();
  }, [refreshTabs]);

  const navigate = useCallback(async () => {
    const url = urlDraft.trim();
    if (!url) return;
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const tab = browserTabs.find((t) => t.active)?.id ?? null;
    const r = (await sendCommand("BROWSER_NAVIGATE", tab ? { url: full, tab } : { url: full })) as { tabs?: BrowserTab[] } | null;
    if (r?.tabs) setBrowserTabs(r.tabs);
    else void refreshTabs();
  }, [urlDraft, browserTabs, refreshTabs]);

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40"
      data-testid="browser-shell"
    >
      {/* таб-полоса: живые вкладки agent-browser */}
      <div
        className="flex shrink-0 items-end gap-1 overflow-x-auto border-b border-zinc-800 bg-black/30 px-2 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Вкладки браузера"
        data-testid="browser-tabstrip"
      >
        <span className="flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-bold tracking-widest text-emerald-300">
          <Globe className="h-3 w-3" aria-hidden /> ME2
        </span>
        {browserTabs.map((t) => (
          <span
            key={t.id}
            title={`${t.title}\n${t.url}`}
            role="tab"
            aria-selected={t.active}
            onClick={() => void activateTab(t)}
            className={`group/tab flex max-w-52 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1 text-[10px] transition ${
              t.active ? "border-zinc-600 bg-zinc-800 text-zinc-100" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.active ? "animate-pulse bg-sky-400" : "bg-zinc-600"}`} aria-hidden />
            <span className="truncate">{t.title.slice(0, 30) || t.url}</span>
            <button
              type="button"
              aria-label={`Закрыть вкладку ${t.title || t.url}`}
              title="BROWSER_CLOSE — закрыть вкладку"
              onClick={(e) => { e.stopPropagation(); void closeTab(t); }}
              className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition hover:bg-rose-950 hover:text-rose-300 group-hover/tab:opacity-100"
            >
              <X className="h-2.5 w-2.5" aria-hidden />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => void openTab()}
          aria-label="Новая вкладка (BROWSER_OPEN)"
          title="BROWSER_OPEN — открыть URL новой вкладкой"
          className="shrink-0 rounded-t-md border border-b-0 border-zinc-800 bg-zinc-900/60 px-1.5 py-1 text-[10px] text-zinc-500 transition hover:text-emerald-300"
        >
          <Plus className="h-3 w-3" aria-hidden />
        </button>
        {browserTabs.length === 0 && !browserBusy && (
          <button type="button" onClick={() => void refreshTabs()} className="shrink-0 px-2 py-1 text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
            показать вкладки
          </button>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 pb-1 pr-0.5">
          {!compact && (
            <button
              type="button"
              onClick={() => setCastConOpen((v) => !v)}
              aria-pressed={castConOpen}
              title="Лента консоли вкладки из стрима (не в audit-журнале)"
              className={`rounded px-1.5 py-1 text-[10px] transition ${castConOpen ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}
            >
              <Terminal className="h-3 w-3" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCastOn((v) => !v)}
            aria-pressed={castOn}
            title="Живой вид активной вкладки — WS-стрим агента-браузера (:3042)"
            className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] transition ${castOn ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}
          >
            <MonitorPlay className="h-3 w-3" aria-hidden /> live
          </button>
          {castOn && (
            <button
              type="button"
              onClick={toggleCastCtl}
              aria-pressed={castCtl}
              title="Руль: клики, клавиатура и колесо в кадре идут в активную вкладку. Ctrl/Meta-комбо остаются у оператора."
              className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] transition ${castCtl ? "bg-amber-500/15 text-amber-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}
            >
              <MousePointerClick className="h-3 w-3" aria-hidden /> руль
            </button>
          )}
          <button type="button" onClick={() => void refreshTabs()} aria-label="Обновить вкладки браузера" className="shrink-0 rounded px-1.5 py-1 text-[10px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200">
            <RefreshCw className={`h-3 w-3 ${browserBusy ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </span>
      </div>

      {/* адресная строка + профиль полосы */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
        <button
          type="button"
          onClick={reloadCast}
          aria-label="Переподключить стрим и обновить кадр"
          title="Переподключить стрим (:3042) и обновить CDP-кадр"
          data-testid="browser-reload"
          className="rounded border border-zinc-800 p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <RotateCcw className={`h-3 w-3 ${castOn && !castStat.connected ? "animate-spin" : ""}`} aria-hidden />
        </button>
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 px-3" data-testid="browser-urlbar">
          <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void navigate(); } }}
            onBlur={() => setUrlDraft("")}
            placeholder={activeUrl}
            aria-label="Адрес активной вкладки — Enter для BROWSER_NAVIGATE"
            className="min-w-0 flex-1 truncate bg-transparent font-mono text-[10px] text-zinc-300 placeholder:text-zinc-500 focus:outline-none"
          />
        </div>
        <div role="group" aria-label="Профиль полосы стрима" className="hidden items-center gap-0.5 rounded border border-zinc-800 bg-black/40 p-0.5 md:flex">
          {(Object.keys(CAST_PROFILES) as CastProfile[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setCastProfile(p)}
              aria-pressed={castProfile === p}
              title={
                p === "макс" ? "push-пейсинг, до 12 fps — минимум задержки (для руля)"
                : p === "баланс" ? "ack-пейсинг, 8 fps — один кадр в полёте, без очередей"
                : p === "эконом" ? "ack-пейсинг, 2 fps — минимум полосы для слабой сети"
                : "ack-пейсинг, потолок fps подстраивается под измеренную полосу (2..12)"
              }
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] transition ${castProfile === p ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* ВЬЮПОРТ: живой сайт (WS-стрим :3042; фолбэк — CDP-кадр :3043) */}
      <div className="relative min-h-[220px] flex-1 bg-black" data-testid="browser-viewport">
        {castOn ? (
          <div
            ref={castWrapRef}
            tabIndex={castCtl ? 0 : -1}
            onKeyDown={castKey}
            aria-label={castCtl ? "Живой вид вкладки — ручное управление включено" : "Живой вид активной вкладки браузера"}
            className={`absolute inset-0 overflow-hidden transition ${castCtl ? "cursor-crosshair select-none ring-1 ring-inset ring-amber-500/60 focus-visible:outline-none" : ""}`}
          >
            <img
              ref={castImgRef}
              alt="Живой вид активной вкладки браузера"
              className="block h-full w-full object-contain"
              draggable={false}
              onPointerDown={(e) => castSendMouse("mousePressed", e)}
              onPointerUp={(e) => castSendMouse("mouseReleased", e)}
              onContextMenu={(e) => { if (castCtl) e.preventDefault(); }}
            />
            {castCtl && (
              <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-black shadow">
                <MousePointerClick className="h-3 w-3" aria-hidden /> РУЛЬ · клики/клавиатура → вкладка
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/75 px-2 py-0.5 font-mono text-[9px] text-zinc-400">
              <span className="truncate">{castStat.url ?? "ожидание кадра…"}</span>
              <span className="shrink-0">
                {castStat.connected ? (
                  <span className="text-emerald-400">● {castStat.fps} fps{castStat.kbs != null ? ` · ${castStat.kbs} КБ/с` : ""}{castStat.lastAge != null ? ` · ${castStat.lastAge}ms` : ""}</span>
                ) : (
                  <span className="text-amber-400">● offline → CDP-фолбэк</span>
                )}
              </span>
            </div>
            {!castStat.connected && (
              <img
                key={`cdp-${cdpQ}-${cdpW}-${cdpTick}`}
                src={`/screencast.jpg?XTransformPort=3043&q=${cdpQ}&w=${cdpW}&t=${cdpTick}`}
                alt="CDP-фолбэк: кадр активной вкладки"
                className="absolute inset-0 h-full w-full object-contain"
                decoding="async"
                onLoad={() => cdpNextTick(2000)}
                onError={() => cdpNextTick(6000)}
              />
            )}
            {!castStat.connected && (
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded border border-zinc-800 bg-black/85 px-2 py-1 text-center font-mono text-[9px] text-zinc-500">
                {castStat.error ?? "подключение к стриму :3042…"}
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <div className="max-w-xs space-y-2 text-center">
              <MonitorPlay className="mx-auto h-6 w-6 text-zinc-700" aria-hidden />
              <p className="text-[11px] text-zinc-500">стрим выключен — включите живой вид активной вкладки, сайт всегда на экране</p>
              <button
                type="button"
                onClick={() => setCastOn(true)}
                className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
              >
                включить live
              </button>
            </div>
          </div>
        )}
      </div>

      {/* статус-строка браузера */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800 bg-black/30 px-2 py-1 font-mono text-[9px] text-zinc-500"
        data-testid="browser-status"
      >
        {!compact && (
          <button
            type="button"
            onClick={() => setCastConOpen((v) => !v)}
            aria-expanded={castConOpen}
            title="Живая лента console-событий вкладки из стрима (не в audit-журнале)"
            className="flex items-center gap-1 rounded px-1 py-0.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
          >
            <Terminal className="h-3 w-3" aria-hidden /> консоль ({castConsole.length})
          </button>
        )}
        <span className="hidden sm:inline">
          {cdpInfo?.cdp ? <>cdp :{cdpInfo.cdp.port} · кадров {cdpInfo.frames} · стримов {cdpInfo.streams}</> : "cdp-цель не найдена"}
        </span>
        <span className="ml-auto flex items-center gap-1" role="group" aria-label="Качество CDP-фолбэка">
          {[30, 55, 85].map((q) => (
            <button
              key={q}
              type="button"
              aria-pressed={cdpQ === q}
              className={`rounded border px-1 py-0.5 font-mono text-[8px] transition ${cdpQ === q ? "border-violet-500 bg-violet-950/60 text-violet-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
              onClick={() => setCdpQ(q)}
            >
              q{q}
            </button>
          ))}
          <span className="text-zinc-700" aria-hidden>·</span>
          {[480, 640, 960].map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={cdpW === w}
              className={`rounded border px-1 py-0.5 font-mono text-[8px] transition ${cdpW === w ? "border-violet-500 bg-violet-950/60 text-violet-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
              onClick={() => setCdpW(w)}
            >
              w{w}
            </button>
          ))}
          {!compact && <span className="hidden text-zinc-600 lg:inline">живая лента — не в audit-журнале</span>}
        </span>
      </div>
      {castConOpen && !compact && (
        <div className="mc-scroll max-h-24 shrink-0 overflow-y-auto border-t border-zinc-800 bg-black/60 p-1.5 font-mono text-[9px] leading-relaxed">
          {castConsole.length === 0 ? (
            <p className="text-zinc-600">нет console-событий в этой сессии (http(s)-страницы; file:// не эмитит)</p>
          ) : (
            castConsole.map((m) => (
              <div key={m.id} className="flex gap-1.5">
                <span className={m.level === "error" ? "shrink-0 text-rose-400" : m.level === "warning" ? "shrink-0 text-amber-400" : "shrink-0 text-sky-400"}>{m.level}</span>
                <span className="truncate text-zinc-300" title={m.text}>{m.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
