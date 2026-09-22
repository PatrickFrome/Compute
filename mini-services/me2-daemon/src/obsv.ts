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
 *  - кольцевые буферы В ПАМЯТИ (не SQLite и не hash-chain — наблюдатели = спам,
 *    та же философия, что у /stats скринкаста); персист не нужен: сенсор про «живое»;
 *  - авто-реаттач при смерти ws; REST-роуты вне шины (47/47 инвариант).
 */

import { discoverCdp, wsOpen } from "./screencast";

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

let wanted = false;          // колектор нужен (лениво, по первому запросу)
let attached = false;
let currentTarget: string | null = null;
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
        pushCapped(net, { t: Date.now(), method: "—", url: `(failed requestId=${rid.slice(0, 12)})`, status: null, mime: "", type: String(p.type ?? ""), ms: null, failed: trim(String(p.errorText ?? "failed"), 120) }, NET_CAP);
        totals.net++;
      }
      pending.delete(rid);
    } else if (m.method === "Runtime.consoleAPICalled") {
      const level = String(p.type ?? "log");
      const args = Array.isArray(p.args) ? (p.args as Array<Record<string, unknown>>) : [];
      const text = trim(args.map(argText).join(" ").replace(/\s+/g, " ").trim() || "(empty)", TEXT_MAX);
      pushCapped(con, { t: Date.now(), level, text }, CON_CAP); totals.con++;
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails as { text?: string; exception?: { description?: string }; url?: string } | undefined;
      const text = trim(d?.exception?.description || d?.text || "exception", TEXT_MAX);
      pushCapped(exc, { t: Date.now(), text, url: trim(d?.url ?? "", URL_MAX) }, EXC_CAP); totals.exc++;
    }
  };
  ws.addEventListener("message", (ev: MessageEvent) => onMsg(ev.data));
  ws.addEventListener("close", () => { attached = false; currentTarget = null; }, { once: true });
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
    buffers: { net: number; con: number; exc: number };
    totals: { net: number; con: number; exc: number };
    last_event_age_s: number | null;
  };
  network: ObsvNetEntry[];
  console: ObsvConEntry[];
  exceptions: ObsvExcEntry[];
}

export function obsvSnapshot(opts?: { limit?: number; level?: string; filter?: string }): ObsvSnapshot {
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 200);
  const filter = (opts?.filter ?? "").toLowerCase();
  const match = (u: string) => !filter || u.toLowerCase().includes(filter);
  const lvl = (opts?.level ?? "").toLowerCase();
  return {
    ok: true,
    status: {
      wanted, attached, target: currentTarget,
      buffers: { net: net.length, con: con.length, exc: exc.length },
      totals,
      last_event_age_s: lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : null,
    },
    network: net.filter((e) => match(e.url)).slice(-limit).reverse(),
    console: con.filter((e) => (!lvl || e.level === lvl) && match(e.text)).slice(-limit).reverse(),
    exceptions: exc.slice(-limit).reverse(),
  };
}

export function obsvReset() {
  net.length = 0; con.length = 0; exc.length = 0; pending.clear();
  totals = { net: 0, con: 0, exc: 0 };
}

export function obsvStatus() {
  return {
    attached, wanted, target: currentTarget,
    captured: totals.net + totals.con + totals.exc,
    buffers: { net: net.length, con: con.length, exc: exc.length },
  };
}
