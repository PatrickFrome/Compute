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
import { tokenGet, tokenSet, onTokenChange } from "./src/tokens";
import { quotaPace, quotaCacheKey, quotaCacheGet, quotaCachePut, quotaFailover } from "./src/quota";

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

// v0.57.0: RETRYABLE расширен транзиентными сетевыми сбоями (боевой живой случай 19:36:
// vercel-gateway TLS "unexpected eof" → в Bun fetch = "unknown certificate verification error";
// DNS/conn-отказы/сокет-сбросы тоже транзиентны — индустрия ретраит их с backoff)
const RETRYABLE = /\b(429|500|502|503|504)\b|too many requests|rate limit|certificate verification|fetch failed|econnrefused|etimedout|econnreset|socket hang up|unexpected eof/i;
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

// ── Vercel AI Gateway key (R47: key живёт в vault'е БД; добыча из Supabase RPC —
// единожды: найденный ключ сам падает в tokens через tokenSet, после рестарта — из БД) ──
let gatewayKey: string | null = null;
let gatewayKeyTried = false;

// ротация токенов в vault'е сбрасывает кэши (ключ и креды Supabase для RPC)
onTokenChange((name) => {
  if (name === "VERCEL_AI_GATEWAY_API_KEY") { gatewayKey = null; gatewayKeyTried = false; }
  if (name === "SUPABASE_URL" || name === "SUPABASE_SERVICE_ROLE_JWT") gatewayKeyTried = false;
});

async function loadGatewayKey(): Promise<string | null> {
  if (gatewayKey) return gatewayKey;
  // 1) vault БД — первоисточник (после первой добычи здесь всегда лежит)
  const fromDb = tokenGet("VERCEL_AI_GATEWAY_API_KEY");
  if (fromDb) { gatewayKey = fromDb; return gatewayKey; }
  if (gatewayKeyTried) return null;
  gatewayKeyTried = true;
  try {
    const supabaseUrl = tokenGet("SUPABASE_URL");
    const serviceJwt = tokenGet("SUPABASE_SERVICE_ROLE_JWT");
    if (!supabaseUrl || !serviceJwt) {
      console.log("[providers] gateway key: нет SUPABASE_URL/SERVICE_ROLE_JWT в tokens DB → RPC недоступен");
      return null;
    }
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/h205f22_aop1_vercel_gateway_runtime_secret_v1`, {
      method: "POST",
      headers: { apikey: serviceJwt, Authorization: `Bearer ${serviceJwt}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (r.ok) {
      const j = (await r.json()) as { vercel_ai_gateway_api_key?: string };
      if (j.vercel_ai_gateway_api_key) {
        gatewayKey = j.vercel_ai_gateway_api_key;
        const saved = tokenSet("VERCEL_AI_GATEWAY_API_KEY", gatewayKey, "T1", "supabase_rpc");
        console.log(`[providers] Vercel AI Gateway key loaded from Supabase → tokens DB ${saved.ok ? "сохранён" : "(не сохранён)"}`);
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
    gateway: { ready: Boolean(key), note: key ? "Vercel AI Gateway (key from tokens DB, R47)" : "no key (Supabase RPC unavailable)" },
  };
}

// ── v0.57.0 L3 failover: цепочка провайдеров — квота ×2 вместо одной точки отказа ──
export interface ProviderChoice { provider: "zai" | "gateway"; modelId: string; label: string }

/** Готовность gateway: кэш модуля или vault (tokenGet — sync SQLite; RPC-добыча отдельно в loadGatewayKey). */
export function gatewayReady(): boolean {
  return Boolean(gatewayKey || tokenGet("VERCEL_AI_GATEWAY_API_KEY"));
}

/** Failover-цепочка: первичный по префиксу модели + альтернативный провайдер (если готов).
 *  zai:default → [zai, gateway?]; gateway:x → [gateway, zai] (zai всегда готов — нативный SDK). */
export function providerChain(model: string): ProviderChoice[] {
  const sep = model.indexOf(":");
  const provider = sep === -1 ? "zai" : model.slice(0, sep);
  const modelId = sep === -1 ? "" : model.slice(sep + 1);
  const primary: "zai" | "gateway" = provider === "gateway" ? "gateway" : "zai";
  const mk = (p: "zai" | "gateway"): ProviderChoice => ({ provider: p, modelId, label: `${p}:${modelId || "default"}` });
  const chain: ProviderChoice[] = [mk(primary)];
  if (primary === "zai") {
    if (gatewayReady()) chain.push(mk("gateway"));
  } else {
    chain.push(mk("zai"));
  }
  return chain;
}

/** Единая точка вызова LLM. Возвращает текст ответа.
 *  G11: governor-admission (полосы P0>P1>P2 + token bucket + circuit breaker) →
 *  слот конкурентности (R14) → v0.57.0 quota-resilience: pace (L1 глобальный min-gap —
 *  шторм не рождается) → response-cache (L2, opt-in opts.cache) → failover-цепочка
 *  провайдеров (L3: исчерпанный 429 первичного → альтернатива) → retry с backoff (R14).
 *  Исчерпанный 429/5xx питает breaker; OPEN → вызывающий (worker) паркует задачу (L4),
 *  а не хоронит её. opts.lane: P0 | P1 (default) | P2. opts.cache: дедуп детерминированных
 *  промптов (temperature=0 — ревью/классификация). */
export async function chat(model: string, messages: ChatMessage[], opts: { temperature?: number; lane?: Lane; cache?: boolean } = {}): Promise<string> {
  const lane = opts.lane ?? "P1";
  const adm = await governorAdmit(lane);
  if (!adm.ok) throw new Error(`${adm.reason}: LLM-вызов отклонён Governor (lane ${lane})`);
  try {
    const r = await llmSlot(async () => {
      await quotaPace(); // L1: ≤1 старт за ME2_LLM_MIN_GAP_MS глобально
      await loadGatewayKey(); // дёшево после первой добычи; делает providerChain честной
      const chain = providerChain(model);
      const ck = opts.cache === true ? quotaCacheKey(model, messages, opts.temperature) : null;
      if (ck) {
        const hit = quotaCacheGet(ck);
        if (hit !== null) return hit; // L2: квота не тратится на дедуп
      }
      let lastErr: unknown;
      for (let pi = 0; pi < chain.length; pi++) {
        const p = chain[pi];
        try {
          const out = await llmRetry((attempt) => chatOnce(p, messages, opts, attempt), pi === 0 ? 4 : 2, p.label);
          if (pi > 0) quotaFailover(chain[0].label, p.label, String(lastErr ?? "").slice(0, 160));
          if (ck) quotaCachePut(ck, p.label, out);
          return out;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    });
    governorReportSuccess(lane);
    return r;
  } catch (e) {
    if (RETRYABLE.test(String(e))) governorReport429(lane);
    throw e;
  }
}

async function chatOnce(p: ProviderChoice, messages: ChatMessage[], opts: { temperature?: number }, attempt: number): Promise<string> {
  if (p.provider === "gateway") {
    const key = await loadGatewayKey();
    if (!key) throw new Error("gateway_no_key");
    const url = "https://ai.gateway.vercel.dev/v1/chat/completions";
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: p.modelId || "zai/glm-4.6",
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
