// ── R69.1 «me2-webhook-relay» — outbound-релей GitHub webhook'ов через smee.io ──
//
// Зачем: песочница не имеет публичного inbound (NAT; preview-origin наблюдаем только
// при открытой preview-панели). Каноничное решение для локальных webhook'ов — smee.io:
// GitHub постит на ПУБЛИЧНЫЙ канал smee.io/<chan>, а наш клиент получает доставки по
// SSE (outbound — NAT не мешает) и форвардит их в daemon :3041 c СОХРАНЕНИЕМ
// заголовков (x-github-delivery / x-github-event / x-hub-signature-256) и RAW-тела —
// HMAC-верификация daemon'а остаётся честной (секрет никогда не проходит через smee).
//
// Канал: env SMEE_CHANNEL (https://smee.io/<id>) или создать новый (GET /new → Location)
// и сохранить в channel.txt + meta daemon'а (перезапуски переиспользуют).
//
// Надёжность: авто-реконнект с backoff 3s→30s (урок R15 — без рестарт-шторма), счётчики
// доставок/ошибок, health :3044. Форвард никогда не бросает: ошибка доставки → счётчик.
//
// Порт: 3044 (не через gateway — сервис outbound-only; health читают локально).

const DAEMON = process.env.ME2_REST ?? "http://127.0.0.1:3041";
const PORT = 3044;
const HERE = import.meta.dir;
const CHANNEL_FILE = `${HERE}/channel.txt`;

let channel = process.env.SMEE_CHANNEL ?? "";
try { channel ||= (await Bun.file(CHANNEL_FILE).text()).trim(); } catch { /* first run */ }

async function createChannel(): Promise<string> {
  const r = await fetch("https://smee.io/new", { redirect: "manual" });
  const loc = r.headers.get("location");
  if (!loc) throw new Error(`smee.io/new: нет location (HTTP ${r.status})`);
  return loc;
}
if (!channel) {
  channel = await createChannel();
  await Bun.write(CHANNEL_FILE, `${channel}\n`);
  console.log(`[relay] новый канал: ${channel}`);
}
const CHAN_ID = channel.split("/").pop() ?? "?";

// ── счётчики + health ─────────────────────────────────────────────
let connected = false;
let deliveries = 0, forwarded = 0, fwd_errors = 0, reconnects = 0, sse_bytes = 0;
let last_delivery_at: string | null = null;
const started = Date.now();
Bun.serve({
  port: PORT,
  fetch: () => new Response(JSON.stringify({
    ok: true, service: "me2-webhook-relay", channel_id: CHAN_ID,
    connected, deliveries, forwarded, fwd_errors, reconnects,
    uptime_s: Math.round((Date.now() - started) / 1000), last_delivery_at,
  }), { headers: { "content-type": "application/json" } }),
});
console.log(`[relay] health :${PORT} · канал ${CHAN_ID}`);

// ── форвард одной доставки в daemon (HMAC-заголовки сохраняются) ──
async function forward(body: string, headers: Record<string, string>): Promise<void> {
  deliveries++; last_delivery_at = new Date().toISOString();
  const pick = (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? "";
  try {
    const r = await fetch(`${DAEMON}/hooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": pick("x-github-delivery"),
        "x-github-event": pick("x-github-event"),
        "x-hub-signature-256": pick("x-hub-signature-256"),
      },
      body,
    });
    if (r.ok) forwarded++;
    else { fwd_errors++; console.log(`[relay] daemon ${r.status} (delivery ${pick("x-github-delivery").slice(0, 16)})`); }
  } catch (e) {
    fwd_errors++;
    console.log(`[relay] forward fail: ${String(e).slice(0, 120)}`);
  }
}

// ── SSE-парсер: формат smee — заголовки В ТОП-УРОВНЕ кадра, body — распарсенный объект,
// плюс служебные кадры (event:ready) без body — пропускаются (урок: давали ложный 401) ──
function parseSseChunk(buf: string, onData: (data: string) => void): string {
  let rest = buf;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const dataLines = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    if (dataLines.length) onData(dataLines.join("\n"));
  }
  return rest;
}

async function connect(): Promise<void> {
  let backoff = 3_000;
  for (;;) {
    try {
      const r = await fetch(channel, { headers: { accept: "text/event-stream" } });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      connected = true; backoff = 3_000;
      console.log(`[relay] SSE подключён (${CHAN_ID})`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sse_bytes += value.length;
        buf = parseSseChunk(buf + dec.decode(value, { stream: true }), (data) => {
          try {
            const j = JSON.parse(data) as Record<string, unknown>;
            if (j.body === undefined) return; // ready/служебные кадры
            // тело: smee отдаёт РАСПАРСЕННЫЙ объект — ре-сериализация компактна, как у GitHub;
            // HMAC всё равно проверит байт-в-байт (мисс-матч честно даст 401 в daemon'е)
            const body = typeof j.body === "string" ? j.body : JSON.stringify(j.body);
            // заголовки — все строковые топ-уровневые поля (x-github-* лежат там же)
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(j)) {
              if (k === "body" || k === "query" || typeof v !== "string") continue;
              headers[k] = v;
            }
            void forward(body, headers);
          } catch { /* не-JSON кадр — игнор */ }
        });
      }
      throw new Error("SSE поток закрыт сервером");
    } catch (e) {
      connected = false; reconnects++;
      console.log(`[relay] reconnect через ${backoff / 1000}s (${String(e).slice(0, 80)})`);
      await new Promise((res) => setTimeout(res, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}
void connect();
