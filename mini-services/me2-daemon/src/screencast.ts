/**
 * ME2 daemon — per-client screencast server (:3043, CDP).
 *
 * Зачем: stream-сервер agent-browser (:3042, бинарник) даёт per-client maxFps,
 * но НЕ per-client jpeg-качество/масштаб. Здесь — собственный канал через CDP
 * (DevToolsActivePort Chromium agent-browser): каждый HTTP-клиент получает
 * независимую CDP-сессию со своими q/w/fps.
 *
 * Роуты:
 *   GET /screencast.jpg?q=60&w=960  — одиночный JPEG (Page.captureScreenshot + clip.scale)
 *   GET /stream?q=60&w=960&fps=10   — MJPEG multipart (Page.startScreencast + ack)
 *   GET /stats                      — cdp-порт, цель, активные стримы, кадры
 *
 * Реестр шины не трогаем (47/47): это enrichment-сервер, как :3041 REST.
 * События в hash-chain не пишем (зрители = спам); наблюдаемость — /stats.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SC_PORT = 3043;
const CDP_TTL_MS = 15_000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type CdpInfo = { port: number; targetId: string; targetUrl: string };
let cdpCache: { info: CdpInfo | null; at: number } = { info: null, at: 0 };
let framesTotal = 0;
let activeStreams = 0;

// ── CDP discovery ──────────────────────────────────────────────────
// Chromium agent-browser стартует с --remote-debugging-port=0; реальный порт —
// в /tmp/agent-browser-chrome-*/DevToolsActivePort (строка 1). Несколько инстансов
// = несколько кандидатов. ДВА фильтра: (1) скоринг URL (:81 > :3000 > прочий localhost);
// (2) ПРОБА кадра — в headless tab может быть «невидим» (captureScreenshot = Internal
// error, видимость плавает между инстансами), поэтому возвращаем только цель, которая
// РЕАЛЬНО отдаёт jpeg. Неудачники — в badlist (60с), чтобы не пинг-понговать.
const targetScore = (u: string) => (u.includes("localhost:81") ? 3 : u.includes(":3000") ? 2 : u.includes("localhost") || u.includes("127.0.0.1") ? 1 : 0);
const badlist = new Map<string, number>(); // `${port}:${targetId}` → until-ts
function probeTarget(info: CdpInfo): Promise<boolean> {
  return new Promise(async (resolve) => {
    let ws: WebSocket | null = null;
    const done = (ok: boolean) => { try { ws?.close(); } catch { /* noop */ } resolve(ok); };
    const t = setTimeout(() => done(false), 2500);
    try {
      ws = await wsOpen(`ws://127.0.0.1:${info.port}/devtools/page/${info.targetId}`, 1600);
      const id = 900001;
      ws.addEventListener("message", (ev: MessageEvent) => {
        try {
          const m = JSON.parse(String(ev.data)) as { id?: number; result?: { data?: string }; error?: { message: string } };
          if (m.id === id) { clearTimeout(t); done(!!m.result?.data && !m.error); }
        } catch { /* ignore */ }
      }, { once: false });
      ws.send(JSON.stringify({ id, method: "Page.captureScreenshot", params: { format: "jpeg", quality: 30 } }));
    } catch { clearTimeout(t); done(false); }
  });
}
async function discoverCdp(force = false): Promise<CdpInfo | null> {
  const now = Date.now();
  if (!force && cdpCache.info && now - cdpCache.at < CDP_TTL_MS) return cdpCache.info;
  cdpCache.at = now;
  cdpCache.info = null;
  try {
    const dirs = readdirSync("/tmp")
      .filter((d) => d.startsWith("agent-browser-chrome-"))
      .map((d) => {
        const f = join("/tmp", d, "DevToolsActivePort");
        try { return { f, mt: statSync(f).mtimeMs, port: parseInt(readFileSync(f, "utf8").split("\n")[0], 10) }; }
        catch { return null; }
      })
      .filter((x): x is { f: string; mt: number; port: number } => !!x && Number.isFinite(x.port))
      .sort((a, b) => a.mt - b.mt); // старейшие первыми — долгоживущие стабильнее
    const cands: { score: number; info: CdpInfo }[] = [];
    for (const c of dirs) {
      try {
        const vr = await fetch(`http://127.0.0.1:${c.port}/json/version`, { signal: AbortSignal.timeout(900) });
        if (!vr.ok) continue;
        const lr = await fetch(`http://127.0.0.1:${c.port}/json/list`, { signal: AbortSignal.timeout(900) });
        if (!lr.ok) continue;
        const targets = (await lr.json()) as Array<{ id: string; type: string; url: string }>;
        for (const t of targets.filter((t) => t.type === "page")) {
          cands.push({ score: targetScore(t.url), info: { port: c.port, targetId: t.id, targetUrl: t.url } });
        }
      } catch { /* инстанс мёртв — следующий */ }
    }
    cands.sort((a, b) => b.score - a.score); // скор первичен, старейшинство уже в порядке обхода
    for (const c of cands) {
      const key = `${c.info.port}:${c.info.targetId}`;
      if ((badlist.get(key) ?? 0) > now) continue;
      if (await probeTarget(c.info)) { cdpCache.info = c.info; return c.info; }
      badlist.set(key, now + 60_000);
    }
  } catch { /* /tmp недоступен и т.п. */ }
  return null;
}

// ── мини-CDP-клиент ────────────────────────────────────────────────
let wsSeq = 0;
function wsOpen(url: string, timeoutMs = 4000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("ws open timeout")); }, timeoutMs);
    ws.addEventListener("open", () => { clearTimeout(t); resolve(ws); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(t); reject(new Error("ws open error")); }, { once: true });
  });
}
function cdpCall(ws: WebSocket, method: string, params?: object, timeoutMs = 6000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = ++wsSeq;
    const t = setTimeout(() => { cleanup(); reject(new Error(`cdp timeout: ${method}`)); }, timeoutMs);
    const onMsg = (ev: MessageEvent) => {
      try {
        const m = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
        if (m.id !== id) return;
        clearTimeout(t); cleanup();
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result ?? {});
      } catch { /* мусорный фрейм */ }
    };
    const cleanup = () => ws.removeEventListener("message", onMsg);
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });
}
function cdpEvent(ws: WebSocket, method: string, handler: (params: Record<string, unknown>) => void) {
  ws.addEventListener("message", (ev: MessageEvent) => {
    try {
      const m = JSON.parse(String(ev.data)) as { method?: string; params?: Record<string, unknown> };
      if (m.method === method && m.params) handler(m.params);
    } catch { /* ignore */ }
  });
}

// ── параметры клиента ──────────────────────────────────────────────
type ClientOpts = { q: number; w: number; fps: number };
function parseOpts(url: URL): ClientOpts {
  const num = (k: string, d: number) => { const v = parseInt(url.searchParams.get(k) ?? "", 10); return Number.isFinite(v) ? v : d; };
  return { q: clamp(num("q", 60), 10, 90), w: clamp(num("w", 0), 0, 3840), fps: clamp(num("fps", 10), 1, 30) };
}

// ── /screencast.jpg — одиночный кадр ───────────────────────────────
async function snapshotJpeg(o: ClientOpts): Promise<Response> {
  let lastErr = "capture failed";
  for (let tryN = 0; tryN < 2; tryN++) {
    const info = await discoverCdp(tryN > 0); // 2-я попытка — форс-редискавери (badlist отсеет мёртвую цель)
    if (!info) break;
    let ws: WebSocket;
    try { ws = await wsOpen(`ws://127.0.0.1:${info.port}/devtools/page/${info.targetId}`); }
    catch { cdpCache.info = null; continue; }
    try {
      let clip: Record<string, number> | undefined;
      if (o.w > 0) {
        try {
          const lm = await cdpCall(ws, "Page.getLayoutMetrics");
          const cs = (lm.cssContentSize ?? lm.contentSize) as { width?: number; height?: number } | undefined;
          const dw = Math.round(cs?.width ?? 0);
          if (dw > o.w) clip = { x: 0, y: 0, width: dw, height: Math.round(cs?.height ?? dw), scale: o.w / dw };
        } catch { /* без метрик — полный кадр */ }
      }
      const shot = await cdpCall(ws, "Page.captureScreenshot", { format: "jpeg", quality: o.q, ...(clip ? { clip } : {}) }, 8000);
      framesTotal++;
      const buf = Buffer.from(String(shot.data ?? ""), "base64");
      if (!buf.length) throw new Error("empty jpeg");
      return new Response(buf, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", ...CORS } });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "capture failed";
      cdpCache.info = null;
    } finally { try { ws.close(); } catch { /* noop */ } }
  }
  return new Response(`screencast: ${lastErr}`, { status: 502, headers: CORS });
}

// ── /stream — MJPEG multipart, per-client CDP-сессия ───────────────
const BOUNDARY = "me2frame";
function streamMjpeg(o: ClientOpts): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let counted = false;
  let ws: WebSocket | null = null;
  const teardown = () => {
    if (closed) return;
    closed = true;
    if (counted) activeStreams = Math.max(0, activeStreams - 1);
    try { ws?.send(JSON.stringify({ id: 0, method: "Page.stopScreencast", params: {} })); } catch { /* noop */ }
    try { ws?.close(); } catch { /* noop */ }
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      activeStreams++; counted = true;
      ctrl.enqueue(encoder.encode(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\n\r\n`));
      const writeFrame = (b64: string) => {
        if (closed) return;
        const jpeg = Buffer.from(b64, "base64");
        framesTotal++;
        try {
          ctrl.enqueue(encoder.encode(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`));
          ctrl.enqueue(new Uint8Array(jpeg));
          ctrl.enqueue(encoder.encode("\r\n"));
        } catch { teardown(); }
      };
      const everyNth = Math.max(1, Math.min(60, Math.round(60 / o.fps)));
      let attempt = 0;
      let lastFrame = 0;
      let clip: Record<string, number> | undefined;
      let pump: ReturnType<typeof setInterval> | null = null;
      const attach = async (): Promise<boolean> => {
        const info = await discoverCdp(attempt > 0);
        if (!info) return false;
        try {
          ws = await wsOpen(`ws://127.0.0.1:${info.port}/devtools/page/${info.targetId}`);
          cdpEvent(ws, "Page.screencastFrame", (p) => {
            const data = typeof p.data === "string" ? p.data : "";
            const sid = (p.sessionId as number | string | undefined) ?? 0;
            try { ws?.send(JSON.stringify({ id: 0, method: "Page.screencastFrameAck", params: { sessionId: sid } })); } catch { /* noop */ }
            if (data) { lastFrame = Date.now(); writeFrame(data); }
          });
          ws.addEventListener("close", () => { ws = null; if (pump) clearInterval(pump); }, { once: true });
          // clip для pump-фолбэка: серверный downscale без мутации вьюпорта
          clip = undefined;
          if (o.w > 0) {
            try {
              const lm = await cdpCall(ws, "Page.getLayoutMetrics");
              const cs = (lm.cssContentSize ?? lm.contentSize) as { width?: number; height?: number } | undefined;
              const dw = Math.round(cs?.width ?? 0);
              if (dw > o.w) clip = { x: 0, y: 0, width: dw, height: Math.round(cs?.height ?? dw), scale: o.w / dw };
            } catch { /* без метрик — полный кадр */ }
          }
          await cdpCall(ws, "Page.startScreencast", {
            format: "jpeg", quality: o.q,
            ...(o.w > 0 ? { maxWidth: o.w, maxHeight: Math.round(o.w * 1.2) } : {}),
            everyNthFrame: everyNth,
          });
          lastFrame = Date.now();
          // PUMP-фолбэк: CDP шлёт кадры только по «damage» экрана — статичная страница = тишина.
          // Раз в 1/fps, если damage-кадров нет 1.5с, добираем кадр captureScreenshot.
          if (pump) clearInterval(pump);
          pump = setInterval(() => {
            if (closed || !ws) return;
            if (Date.now() - lastFrame < 1500) return;
            cdpCall(ws, "Page.captureScreenshot", { format: "jpeg", quality: o.q, ...(clip ? { clip } : {}) }, 6000)
              .then((s) => { if (typeof s.data === "string" && s.data) { lastFrame = Date.now(); writeFrame(s.data); } })
              .catch(() => { /* тихо — ре-аттач по close */ });
          }, Math.max(700, Math.round(1000 / o.fps)));
          return true;
        } catch { cdpCache.info = null; return false; }
      };
      (async () => {
        while (!closed && attempt < 4) {
          if (await attach()) {
            attempt = 0;
            // держим сессию, пока клиент жив и ws не упал; при обрыве — ре-аттач
            while (!closed && ws) await new Promise((r) => setTimeout(r, 500));
            if (pump) clearInterval(pump);
            if (closed) return;
          }
          await new Promise((r) => setTimeout(r, 700 * Math.max(1, attempt)));
          attempt++;
        }
        if (!closed) teardown();
      })();
    },
    cancel() { teardown(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`, "Cache-Control": "no-store", Connection: "close", ...CORS },
  });
}

// ── /stats ─────────────────────────────────────────────────────────
async function statsJson(): Promise<Response> {
  const info = cdpCache.info ?? (await discoverCdp());
  const body = {
    ok: true, service: "me2-screencast", port: SC_PORT,
    cdp: info ? { port: info.port, target: info.targetUrl } : null,
    streams: activeStreams, frames: framesTotal, ts: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", ...CORS } });
}

const DOC = `<!doctype html><meta charset="utf-8"><title>ME2 screencast :${SC_PORT}</title>
<body style="font:14px system-ui;background:#111;color:#ddd;margin:24px">
<h2>ME2 per-client screencast (CDP)</h2>
<ul>
<li><code>/screencast.jpg?q=60&amp;w=960</code> — одиночный JPEG</li>
<li><code>/stream?q=60&amp;w=960&amp;fps=10</code> — MJPEG (q 10–90, w px, fps 1–30)</li>
<li><code>/stats</code> — статус CDP/цели</li>
</ul><img src="/screencast.jpg?q=50&amp;w=720" alt="preview" style="max-width:720px;border:1px solid #333"></body>`;

export function startScreencastServer() {
  Bun.serve({
    port: SC_PORT,
    idleTimeout: 0, // MJPEG живёт долго; кадры/каденс задаёт клиент
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      try {
        if (url.pathname === "/screencast.jpg") return await snapshotJpeg(parseOpts(url));
        if (url.pathname === "/stream") return streamMjpeg(parseOpts(url));
        if (url.pathname === "/stats") return await statsJson();
        return new Response(DOC, { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
      } catch (e) {
        return new Response(`screencast error: ${e instanceof Error ? e.message : String(e)}`, { status: 500, headers: CORS });
      }
    },
  });
  console.log(`[me2-daemon] screencast :${SC_PORT} (snapshot /stream /stats via CDP)`);
}
