/**
 * ME2 Providers — LLM-слой, модель-агностичный (урок OpenCode: 75+ провайдеров).
 * Формат "provider:model":
 *   zai:<model>         — z-ai-web-dev-sdk (нативный, sandbox backend)
 *   gateway:<model>     — Vercel AI Gateway (OpenAI-совместимый; ключ из Supabase RPC)
 * Пустой суффикс = дефолт провайдера.
 */
import ZAI from "z-ai-web-dev-sdk";
import { emit } from "./store";
import { governorAdmit, governorReport429, governorReportSuccess, type Lane } from "./src/governor";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// ── R14: устойчивость к 429 (живой инцидент R13: 2 ретрая + авто-рефлексия = 3 параллельных
// LLM-потока → провайдер ответил 429, задача упала). Ресёрч 2026 (r14-429.json): пер-аккаунтный
// семафор + exponential backoff с random jitter — стандарт индустрии.
const LLM_MAX = Math.max(1, Number(process.env.ME2_LLM_MAX_CONCURRENCY ?? 2));
let llmInFlight = 0;
const llmQueue: (() => void)[] = [];
/** Глобальный слот LLM-конкурентности: очередь FIFO, потолок ME2_LLM_MAX_CONCURRENCY (default 2). */
export async function llmSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (llmInFlight >= LLM_MAX) await new Promise<void>((res) => llmQueue.push(res));
  llmInFlight++;
  try {
    return await fn();
  } finally {
    llmInFlight--;
    llmQueue.shift()?.();
  }
}

const RETRYABLE = /\b(429|500|502|503|504)\b|too many requests|rate limit/i;
const RETRY_AFTER = /retry-after:\s*(\d+)s/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Retry с экспоненциальным backoff + jitter; Retry-After из текста ошибки усиливает задержку. */
export async function llmRetry<T>(fn: (attempt: number) => Promise<T>, attempts = 4, tag = ""): Promise<T> {
  let lastErr: unknown;
  for (let a = 0; a < attempts; a++) {
    try {
      return await fn(a);
    } catch (e) {
      lastErr = e;
      const m = String(e);
      if (!RETRYABLE.test(m) || a === attempts - 1) throw e;
      const ra = Number(RETRY_AFTER.exec(m)?.[1] ?? 0);
      const delay = Math.max(800 * 2 ** a, ra * 1000) + Math.floor(Math.random() * 400);
      console.log(`[providers] ${tag} 429/5xx → backoff ${delay}ms (attempt ${a + 1}/${attempts})`);
      emit("LLM_BACKOFF", { model: tag, attempt: a + 1, delay_ms: delay }, null, null);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ── Vercel AI Gateway key (секрет лежит в Supabase — подтверждено 2026-09-21) ──
let gatewayKey: string | null = null;
let gatewayKeyTried = false;

async function loadGatewayKey(): Promise<string | null> {
  if (gatewayKey) return gatewayKey;
  if (gatewayKeyTried) return null;
  gatewayKeyTried = true;
  try {
    const envRaw = await Bun.file("/home/z/.a2/supabase-cloud.env").text();
    const env = Object.fromEntries(
      envRaw.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
        const i = l.indexOf("=");
        let k = l.slice(0, i).trim();
        if (k.startsWith("export ")) k = k.slice(7).trim();
        return [k, l.slice(i + 1).trim().replace(/^"|"$/g, "")];
      }),
    );
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/h205f22_aop1_vercel_gateway_runtime_secret_v1`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_JWT, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_JWT}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (r.ok) {
      const j = (await r.json()) as { vercel_ai_gateway_api_key?: string };
      if (j.vercel_ai_gateway_api_key) {
        gatewayKey = j.vercel_ai_gateway_api_key;
        console.log("[providers] Vercel AI Gateway key loaded from Supabase");
      }
    }
  } catch (e) {
    console.log(`[providers] gateway key load failed: ${String(e).slice(0, 120)}`);
  }
  return gatewayKey;
}

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function zai() {
  if (!zaiInstance) zaiInstance = await ZAI.create();
  return zaiInstance;
}

export async function listProviders(): Promise<Record<string, { ready: boolean; note: string }>> {
  const key = await loadGatewayKey();
  return {
    zai: { ready: true, note: "z-ai-web-dev-sdk (native)" },
    gateway: { ready: Boolean(key), note: key ? "Vercel AI Gateway (key from Supabase)" : "no key (Supabase RPC unavailable)" },
  };
}

/** Единая точка вызова LLM. Возвращает текст ответа.
 *  G11: governor-admission (полосы P0>P1>P2 + token bucket + circuit breaker) →
 *  слот конкурентности (R14) → retry с backoff (R14). Исчерпанный 429/5xx питает breaker —
 *  шторм гасится fast-fail'ом, а не амплифицируется бесполезными сетевыми попытками.
 *  opts.lane: P0 (супервизоры флота) | P1 (ходы чатов/worker, default) | P2 (фон). */
export async function chat(model: string, messages: ChatMessage[], opts: { temperature?: number; lane?: Lane } = {}): Promise<string> {
  const lane = opts.lane ?? "P1";
  const adm = await governorAdmit(lane);
  if (!adm.ok) throw new Error(`${adm.reason}: LLM-вызов отклонён Governor (lane ${lane})`);
  try {
    const r = await llmSlot(() => llmRetry((attempt) => chatOnce(model, messages, opts, attempt), 4, model));
    governorReportSuccess(lane);
    return r;
  } catch (e) {
    if (RETRYABLE.test(String(e))) governorReport429(lane);
    throw e;
  }
}

async function chatOnce(model: string, messages: ChatMessage[], opts: { temperature?: number }, attempt: number): Promise<string> {
  const sep = model.indexOf(":");
  const provider = sep === -1 ? "zai" : model.slice(0, sep);
  const modelId = sep === -1 ? "" : model.slice(sep + 1);

  if (provider === "gateway") {
    const key = await loadGatewayKey();
    if (!key) throw new Error("gateway_no_key");
    const url = "https://ai.gateway.vercel.dev/v1/chat/completions";
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId || "zai/glm-4.6",
        messages,
        temperature: opts.temperature ?? 0.4,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) {
      const ra = r.headers.get("retry-after");
      throw new Error(`gateway HTTP ${r.status}${ra ? ` (retry-after: ${parseInt(ra, 10) || 1}s)` : ""}: ${(await r.text()).slice(0, 300)}`);
    }
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content ?? "";
  }

  // default: zai
  const z = await zai();
  const response = await z.chat.completions.create({
    messages: messages as never,
    stream: false,
    thinking: { type: "disabled" },
  });
  return response.choices?.[0]?.message?.content ?? "";
}
