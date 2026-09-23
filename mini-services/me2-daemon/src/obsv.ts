/**
 * ME2 daemon — browser observability (R21, шаг S2 из research/2026/R20-BROWSER-LEAP.md).
 *
 * Зачем: R20 дал агенту ЗРЕНИЕ (sense: aria-цели + act+verify), но агент слеп на
 * ПОСЛЕДСТВИЯ действий — network/console/errors страницы не видны никому. S2 закрывает
 * главный отсутствующий сенсор (паритет Chrome DevTools MCP: network + console):
 *
 *  - ленивый CDP-колектор к цели discoverCdp() (тот же Chromium, что screencast :3043);
 *  - Network.enable → requestWillBeSent / responseReceived / loadingFailed
 *    (корреляция по requestId, латентность ≈ разница прихода событий);
 *  - Runtime.enable → consoleAPICalled (log/warning/error/...) + exceptionThrown;
 *  - кольцевые буферы В ПАМЯТИ (не hash-chain — наблюдатели = спам, та же философия,
 *    что у /stats скринкаста);
 *  - R31 D2: НО живая сессия может жить часами — буферы в памяти капируются (400/250/120),
 *    а история ТЕРЯЛАСЬ. Персист последних N в SQLite с TTL (дефолт 30м, конфигурируемо):
 *    батч-флеш раз в 2с (одна транзакция, WAL), TTL-ротация на каждом флеше —
 *    долгоживущие сессии без роста памяти; история читается source=history;
 *  - авто-реаттач при смерти ws; REST-роуты вне шины (47/47 инвариант).
 */

import { db } from "../store";
import { discoverCdp, wsOpen, cdpCall } from "./screencast";

const NET_CAP = 400;
const CON_CAP = 250;
const EXC_CAP = 120;
const URL_MAX = 300;
const TEXT_MAX = 400;
const PENDING_TTL_MS = 60_000;
const REATTACH_MS = 2_000;

export interface ObsvNetEntry {
  t: number; method: string; url: string; status: number | null;
  mime: string; type: string; ms: number | null; failed?: string;
}
export interface ObsvConEntry { t: number; level: string; text: string }
export interface ObsvExcEntry { t: number; text: string; url: string }

const net: ObsvNetEntry[] = [];
const con: ObsvConEntry[] = [];
const exc: ObsvExcEntry[] = [];
const pending = new Map<string, { at: number; entry: ObsvNetEntry | null }>(); // requestId → открытый запрос

// ── R31 D2: персист в SQLite с TTL ──────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS browser_obsv (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ts INTEGER NOT NULL,
  data_json TEXT NOT NULL
);
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_obsv_ts ON browser_obsv(ts)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_obsv_kind_ts ON browser_obsv(kind, ts)`);

const OBSV_ROWS_CAP = 5000;      // жёсткий потолок таблицы (мульти-вкладки/долгие сессии)
let obsvTtlMin = 30;             // TTL истории (минуты) — конфигурируется POST {op:"ttl"}
let flushedTotal = 0;            // сколько записей легло в SQLite за жизнь процесса
let lastFlushAt: number | null = null;
let lastFlushErr: string | null = null;
const flushQ: Array<{ kind: string; ts: number; data: string }> = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function persistLater(kind: string, entry: ObsvNetEntry | ObsvConEntry | ObsvExcEntry) {
  try { flushQ.push({ kind, ts: entry.t, data: JSON.stringify(entry) }); } catch { /* сериализация не ломает сбор */ }
  if (flushQ.length > 800) flushQ.splice(0, flushQ.length - 800); // защита от затопления
  if (!flushTimer) flushTimer = setInterval(() => { try { obsvFlush(); } catch { /* флаш не ломает сбор */ } }, 2000);
}

/** Батч-флеш: одна транзакция + TTL-ротация + жёсткий кап таблицы. */
export function obsvFlush(): { flushed: number; pruned: number } {
  if (!flushQ.length && flushedTotal === 0) return { flushed: 0, pruned: 0 };
  let flushed = 0;
  let pruned = 0;
  const batch = flushQ.splice(0, flushQ.length);
  try {
    if (batch.length) {
      db.transaction(() => {
        for (const it of batch) {
          db.query(`INSERT INTO browser_obsv (kind, ts, data_json) VALUES (?,?,?)`).run(it.kind, it.ts, it.data);
          flushed++;
        }
      })();
    }
    const ttlCut = Date.now() - obsvTtlMin * 60_000;
    const r1 = db.query(`DELETE FROM browser_obsv WHERE ts < ?`).run(ttlCut);
    const r2 = db.query(`DELETE FROM browser_obsv WHERE id NOT IN (SELECT id FROM browser_obsv ORDER BY id DESC LIMIT ${OBSV_ROWS_CAP})`).run();
    pruned = r1.changes + r2.changes;
    flushedTotal += flushed;
    lastFlushAt = Date.now();
    lastFlushErr = null;
  } catch (e) {
    lastFlushErr = (e as Error).message.slice(0, 120);
  }
  return { flushed, pruned };
}

export interface ObsvPersistState {
  ttl_min: number; rows: number; flushed_total: number;
  queue: number; last_flush_age_s: number | null; last_error: string | null;
}
export function obsvPersistState(): ObsvPersistState {
  let rows = 0;
  try {
    rows = (db.query(`SELECT COUNT(*) AS n FROM browser_obsv`).get() as { n: number }).n;
  } catch { /* таблица может быть занята — статус важнее */ }
  return {
    ttl_min: obsvTtlMin, rows, flushed_total: flushedTotal, queue: flushQ.length,
    last_flush_age_s: lastFlushAt ? Math.round((Date.now() - lastFlushAt) / 1000) : null,
    last_error: lastFlushErr,
  };
}
export function obsvSetTtl(minutes: number): ObsvPersistState {
  const m = Math.round(minutes);
  if (Number.isFinite(m) && m >= 1 && m <= 1440) obsvTtlMin = m;
  return obsvPersistState();
}

/** Чтение истории из SQLite (D2): rows = net|con|exc, since — временной срез. */
export function obsvHistory(kind: "net" | "con" | "exc", limit = 50, since?: number): Array<Record<string, unknown>> {
  const lim = Math.min(Math.max(limit, 1), 500);
  const cut = typeof since === "number" && Number.isFinite(since) ? since : 0;
  const rows = db.query(`SELECT ts, data_json FROM browser_obsv WHERE kind=? AND ts>=? ORDER BY id DESC LIMIT ?`)
    .all(kind, cut, lim) as Array<{ ts: number; data_json: string }>;
  return rows.map((r) => {
    try { return JSON.parse(r.data_json) as Record<string, unknown>; }
    catch { return { t: r.ts, kind, error: "unparseable" } as Record<string, unknown>; }
  });
}

let wanted = false;          // колектор нужен (лениво, по первому запросу)
let attached = false;
let currentTarget: string | null = null;
// R23 (identity chain, порт легаси): точная идентичность цели + поколение сессии —
// вырос на каждом ре-аттаче; агент может отличить «та же вкладка» от «новая инкарнация»
let targetInfo: { target_id: string; url: string; title: string; type: string } | null = null;
let attachGeneration = 0;
let totals = { net: 0, con: 0, exc: 0 };
let lastEventAt = 0;
let loopStarted = false;

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function argText(a: Record<string, unknown>): string {
  if (a.value !== undefined) {
    if (typeof a.value === "string") return a.value;
    try { return JSON.stringify(a.value); } catch { return String(a.value); }
  }
  const d = a.description;
  if (typeof d === "string" && d) return d;
  const p = a.preview as { properties?: Array<{ name: string; value?: string }> } | undefined;
  if (p?.properties?.length) return p.properties.map((x) => `${x.name}: ${x.value ?? "?"}`).join(", ");
  return a.type === "undefined" ? "undefined" : String(a.type ?? "?");
}

async function attachOnce(): Promise<boolean> {
  const info = await discoverCdp();
  if (!info) return false;
  let ws;
  try { ws = await wsOpen(`ws://127.0.0.1:${info.port}/devtools/page/${info.targetId}`, 3000); }
  catch { return false; }
  try {
    await ws.send(JSON.stringify({ id: 1, method: "Network.enable", params: { maxTotalBufferSize: 5_000_000, maxResourceBufferSize: 2_500_000 } }));
    await ws.send(JSON.stringify({ id: 2, method: "Runtime.enable", params: {} }));
  } catch { try { ws.close(); } catch { /* noop */ } return false; }

  const onMsg = (raw: unknown) => {
    let m: { method?: string; params?: Record<string, unknown> };
    try { m = JSON.parse(String(raw)) as { method?: string; params?: Record<string, unknown> }; } catch { return; }
    const p = m.params;
    if (!m.method || !p) return;
    lastEventAt = Date.now();
    if (m.method === "Network.requestWillBeSent") {
      const rid = String(p.requestId ?? "");
      const req = p.request as { url?: string; method?: string } | undefined;
      if (rid && req?.url) {
        if (pending.size > 1000) for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL_MS) pending.delete(k);
        const e: ObsvNetEntry = { t: Date.now(), method: req.method ?? "GET", url: trim(req.url, URL_MAX), status: null, mime: "", type: String(p.type ?? ""), ms: null };
        pending.set(rid, { at: Date.now(), entry: e });
        pushCapped(net, e, NET_CAP); totals.net++;
        persistLater("net", e); // D2: в SQLite с TTL
      }
    } else if (m.method === "Network.responseReceived") {
      const rid = String(p.requestId ?? "");
      const res = p.response as { status?: number; mimeType?: string } | undefined;
      const open = pending.get(rid);
      const e = open?.entry ?? null;
      if (e) {
        e.status = res?.status ?? null;
        e.mime = trim(res?.mimeType ?? "", 60);
        if (!e.type && p.type) e.type = String(p.type);
        e.ms = open ? Date.now() - open.at : null;
      }
      pending.delete(rid);
    } else if (m.method === "Network.loadingFailed") {
      const rid = String(p.requestId ?? "");
      const open = pending.get(rid);
      if (open?.entry) {
        open.entry.failed = trim(String(p.errorText ?? "failed"), 120);
      } else {
        // URL не приходит в loadingFailed — компактная запись без корреляции (лучше тишины)
        const e: ObsvNetEntry = { t: Date.now(), method: "—", url: `(failed requestId=${rid.slice(0, 12)})`, status: null, mime: "", type: String(p.type ?? ""), ms: null, failed: trim(String(p.errorText ?? "failed"), 120) };
        pushCapped(net, e, NET_CAP);
        totals.net++;
        persistLater("net", e);
      }
      pending.delete(rid);
    } else if (m.method === "Runtime.consoleAPICalled") {
      const level = String(p.type ?? "log");
      const args = Array.isArray(p.args) ? (p.args as Array<Record<string, unknown>>) : [];
      const text = trim(args.map(argText).join(" ").replace(/\s+/g, " ").trim() || "(empty)", TEXT_MAX);
      const e: ObsvConEntry = { t: Date.now(), level, text };
      pushCapped(con, e, CON_CAP); totals.con++;
      persistLater("con", e); // D2
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails as { text?: string; exception?: { description?: string }; url?: string } | undefined;
      const text = trim(d?.exception?.description || d?.text || "exception", TEXT_MAX);
      const e: ObsvExcEntry = { t: Date.now(), text, url: trim(d?.url ?? "", URL_MAX) };
      pushCapped(exc, e, EXC_CAP); totals.exc++;
      persistLater("exc", e); // D2
    }
  };
  ws.addEventListener("message", (ev: MessageEvent) => onMsg(ev.data));
  ws.addEventListener("close", () => { attached = false; currentTarget = null; }, { once: true });
  // identity chain: точная цель (не URL/title-авторитет — TargetInfo от CDP) + поколение
  try {
    const ti = (await cdpCall(ws, "Target.getTargetInfo", { targetId: info.targetId }, 3000)) as { targetInfo?: Record<string, unknown> };
    const t = (ti.targetInfo ?? {}) as Record<string, unknown>;
    targetInfo = {
      target_id: String(t.targetId ?? info.targetId).slice(0, 64),
      url: String(t.url ?? info.targetUrl).slice(0, 300),
      title: String(t.title ?? "").slice(0, 160),
      type: String(t.type ?? "page"),
    };
  } catch { targetInfo = { target_id: info.targetId.slice(0, 64), url: info.targetUrl.slice(0, 300), title: "", type: "page" }; }
  attachGeneration++;
  attached = true;
  currentTarget = info.targetUrl;
  return true;
}

function pushCapped<T>(arr: T[], item: T, cap: number) {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

/** Ленивый старт + поддержание соединения (вызывается из REST и периодики). */
function ensureLoop() {
  if (loopStarted) return;
  loopStarted = true;
  const tick = async () => {
    if (wanted && !attached) { try { await attachOnce(); } catch { /* цель может быть мертва — retry */ } }
    if (!wanted) attached = false;
  };
  setInterval(() => { void tick(); }, REATTACH_MS);
}

/** Поднять колектор (идемпотентно). */
export function obsvStart() {
  wanted = true;
  ensureLoop();
}

export function obsvStop() {
  wanted = false;
}

export interface ObsvSnapshot {
  ok: true;
  status: {
    wanted: boolean; attached: boolean; target: string | null;
    target_info: { target_id: string; url: string; title: string; type: string } | null;
    generation: number;
    buffers: { net: number; con: number; exc: number };
    totals: { net: number; con: number; exc: number };
    last_event_age_s: number | null;
    persist: ObsvPersistState;
  };
  network: ObsvNetEntry[];
  console: ObsvConEntry[];
  exceptions: ObsvExcEntry[];
}

export function obsvSnapshot(opts?: { limit?: number; level?: string; filter?: string; source?: "live" | "history" }): ObsvSnapshot {
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 200);
  const filter = (opts?.filter ?? "").toLowerCase();
  const match = (u: string) => !filter || u.toLowerCase().includes(filter);
  const lvl = (opts?.level ?? "").toLowerCase();
  const persist = obsvPersistState();
  if (opts?.source === "history") {
    // D2: чтение ИСТОРИИ из SQLite (то, что пережило кольца памяти и TTL)
    return {
      ok: true,
      status: {
        wanted, attached, target: currentTarget,
        target_info: targetInfo,
        generation: attachGeneration,
        buffers: { net: net.length, con: con.length, exc: exc.length },
        totals,
        last_event_age_s: lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : null,
        persist,
      },
      network: obsvHistory("net", limit).filter((e) => match(String(e.url ?? ""))) as unknown as ObsvNetEntry[],
      console: obsvHistory("con", limit).filter((e) => (!lvl || e.level === lvl) && match(String(e.text ?? ""))) as unknown as ObsvConEntry[],
      exceptions: obsvHistory("exc", limit) as unknown as ObsvExcEntry[],
    };
  }
  return {
    ok: true,
    status: {
      wanted, attached, target: currentTarget,
      target_info: targetInfo,
      generation: attachGeneration,
      buffers: { net: net.length, con: con.length, exc: exc.length },
      totals,
      last_event_age_s: lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : null,
      persist,
    },
    network: net.filter((e) => match(e.url)).slice(-limit).reverse(),
    console: con.filter((e) => (!lvl || e.level === lvl) && match(e.text)).slice(-limit).reverse(),
    exceptions: exc.slice(-limit).reverse(),
  };
}

export function obsvReset() {
  net.length = 0; con.length = 0; exc.length = 0; pending.clear();
  totals = { net: 0, con: 0, exc: 0 };
  // D2: сброс КОЛЕЦ памяти — SQLite-история с TTL НЕ трогается (это уже архив)
}

export function obsvStatus() {
  return {
    attached, wanted, target: currentTarget,
    target_info: targetInfo,
    generation: attachGeneration,
    captured: totals.net + totals.con + totals.exc,
    buffers: { net: net.length, con: con.length, exc: exc.length },
    persist: obsvPersistState(),
  };
}

/** Вердикт механики ME29 (D2): WORKS — история льётся в SQLite и живёт в TTL. */
export function obsvPersistVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  const st = obsvPersistState();
  if (st.flushed_total === 0) {
    return { verdict: "CAVEAT", evidence: "флешей не было — подожди трафик вкладки (POST /browser/obsv {op:attach}) или проверь через 5с" };
  }
  if (st.last_error) return { verdict: "CAVEAT", evidence: `ошибка флеша: ${st.last_error}; rows=${st.rows}` };
  return {
    verdict: "WORKS",
    evidence: `SQLite rows=${st.rows} (TTL ${st.ttl_min}м, кап 5000), флешей=${st.flushed_total}, queue=${st.queue}; source=history — переживает рестарт колец памяти`,
  };
}
