/**
 * ME2 Providers — active OpenAI inference transport.
 *
 * Durable agent identity is `openai:<model>`. Direct OpenAI is primary; the
 * Vercel AI Gateway may be used only as an OpenAI-compatible transport
 * fallback for the SAME OpenAI model. ZAI/GLM is never an active fallback.
 */
import { activeAgentModelTag, canonicalOpenAiModel, normalizeActiveAgentModelTag } from "./src/inference";
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

let openAiKey: string | null = null;

// ротация токенов в vault'е сбрасывает кэши.
onTokenChange((name) => {
  if (name === "OPENAI_API_KEY") openAiKey = null;
  if (name === "VERCEL_AI_GATEWAY_API_KEY") { gatewayKey = null; gatewayKeyTried = false; }
  if (name === "SUPABASE_URL" || name === "SUPABASE_SERVICE_ROLE_JWT") gatewayKeyTried = false;
});

function loadOpenAiKey(): string | null {
  if (openAiKey) return openAiKey;
  const key = tokenGet("OPENAI_API_KEY") || String(process.env.OPENAI_API_KEY || "").trim() || null;
  if (key) openAiKey = key;
  return openAiKey;
}

export function openAiReady(): boolean {
  return Boolean(loadOpenAiKey());
}

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

export async function listProviders(): Promise<Record<string, { ready: boolean; note: string }>> {
  const gateway = await loadGatewayKey();
  const openai = loadOpenAiKey();
  return {
    openai: {
      ready: Boolean(openai),
      note: openai ? `OpenAI direct (${canonicalOpenAiModel()})` : "OPENAI_API_KEY missing from token vault/env",
    },
    gateway: {
      ready: Boolean(gateway),
      note: gateway ? "OpenAI-compatible Vercel AI Gateway fallback" : "gateway key unavailable",
    },
    zai_legacy: {
      ready: false,
      note: "legacy read compatibility only; active GLM routing disabled",
    },
  };
}

export interface ProviderChoice { provider: "openai" | "gateway"; modelId: string; label: string }

// ── R73: TLS-проба канала gateway (боевой случай R72: сеть песочницы режет TLS до
// ai.gateway.vercel.dev — failover тратил 2 ретрая на заведомо мёртвый канал каждый раз).
// Кэш здоровья 5 мин: любая HTTP-ответка (даже 401/404) = TLS жив; сетевое исключение =
// канал вниз → цепочка строится без него (не тратим время), /llm показывает tls_ok.
const GW_PROBE_TTL_MS = 300_000;
let gwTlsOk: boolean | null = null;
let gwTlsCheckedAt = 0;
let gwTlsInflight: Promise<boolean | null> | null = null;

export async function gatewayTlsProbe(force = false): Promise<boolean | null> {
  if (!force && gwTlsCheckedAt && Date.now() - gwTlsCheckedAt < GW_PROBE_TTL_MS) return gwTlsOk;
  if (gwTlsInflight) return gwTlsInflight;
  gwTlsInflight = (async () => {
    try {
      const r = await fetch("https://ai.gateway.vercel.dev/v1/chat/completions", {
        method: "HEAD",
        signal: AbortSignal.timeout(6000),
      });
      gwTlsOk = true; // любой HTTP-ответ (405/401/404…) = TLS-хендшейк жив
    } catch {
      gwTlsOk = false; // сертификат/eof/таймаут — канал вниз на сетевом уровне
    }
    gwTlsCheckedAt = Date.now();
    return gwTlsOk;
  })();
  const out = await gwTlsInflight;
  gwTlsInflight = null;
  return out;
}

export function gatewayTlsStatus(): { ok: boolean | null; checked_at: string | null; ttl_ms: number } {
  return { ok: gwTlsOk, checked_at: gwTlsCheckedAt ? new Date(gwTlsCheckedAt).toISOString() : null, ttl_ms: GW_PROBE_TTL_MS };
}

/** Готовность gateway: кэш модуля или vault (tokenGet — sync SQLite; RPC-добыча отдельно в loadGatewayKey). */
export function gatewayReady(): boolean {
  return Boolean(gatewayKey || tokenGet("VERCEL_AI_GATEWAY_API_KEY"));
}

/** Active failover chain. The durable model is always OpenAI.
 * Direct OpenAI is primary. Gateway is an optional transport fallback for the
 * same model; there is deliberately no ZAI/GLM fallback. */
export function providerChain(model: string, gatewayAlive = true): ProviderChoice[] {
  const raw = String(model || "").trim();
  const gatewayRequested = raw.toLowerCase().startsWith("gateway:");
  const durable = normalizeActiveAgentModelTag(raw || activeAgentModelTag());
  const modelId = durable.slice(durable.indexOf(":") + 1) || canonicalOpenAiModel();
  const mk = (provider: "openai" | "gateway"): ProviderChoice => ({
    provider,
    modelId,
    label: `${provider}:${modelId}`,
  });

  const chain: ProviderChoice[] = [];
  if (gatewayRequested && gatewayReady() && gatewayAlive) chain.push(mk("gateway"));
  chain.push(mk("openai"));
  if (!gatewayRequested && gatewayReady() && gatewayAlive) chain.push(mk("gateway"));
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
      await loadGatewayKey();
      const gwAlive = gatewayReady() ? ((await gatewayTlsProbe()) !== false) : false;
      const durableModel = normalizeActiveAgentModelTag(model || activeAgentModelTag());
      const chain = providerChain(durableModel, gwAlive);
      const ck = opts.cache === true ? quotaCacheKey(durableModel, messages, opts.temperature) : null;
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
  const modelId = p.modelId || canonicalOpenAiModel();

  if (p.provider === "gateway") {
    const key = await loadGatewayKey();
    if (!key) throw new Error("gateway_no_key");
    const body: Record<string, unknown> = {
      model: `openai/${modelId}`,
      messages,
    };
    // GPT-5.6 reasoning models do not need temperature for the ME2 tool loop.
    if (opts.temperature !== undefined && !/^gpt-(?:5\.6|6)/i.test(modelId)) body.temperature = opts.temperature;
    const r = await fetch("https://ai.gateway.vercel.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) {
      const ra = r.headers.get("retry-after");
      throw new Error(`gateway HTTP ${r.status}${ra ? ` (retry-after: ${parseInt(ra, 10) || 1}s)` : ""}: ${(await r.text()).slice(0, 300)}`);
    }
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content ?? "";
  }

  const key = loadOpenAiKey();
  if (!key) throw new Error("openai_no_key");
  const body: Record<string, unknown> = { model: modelId, messages };
  if (opts.temperature !== undefined && !/^gpt-(?:5\.6|6)/i.test(modelId)) body.temperature = opts.temperature;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) {
    const ra = r.headers.get("retry-after");
    throw new Error(`openai HTTP ${r.status}${ra ? ` (retry-after: ${parseInt(ra, 10) || 1}s)` : ""}: ${(await r.text()).slice(0, 300)}`);
  }
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? "";
}


function extractResponsesText(payload: unknown): string {
  const row = payload as { output_text?: unknown; output?: unknown };
  if (typeof row?.output_text === "string" && row.output_text.trim()) return row.output_text.trim();
  const chunks: string[] = [];
  for (const item of Array.isArray(row?.output) ? row.output : []) {
    const content = Array.isArray((item as { content?: unknown })?.content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text === "string" && text.trim()) chunks.push(text.trim());
    }
  }
  return chunks.join("\n").trim();
}

/**
 * OpenAI-native web search for agent tools.
 *
 * This is intentionally direct-OpenAI only: the built-in web_search tool is a
 * Responses API capability and must never fall back to ZAI/GLM. Search is
 * read-only, still governor/quota/concurrency bounded, and provider failure is
 * surfaced to the caller without fabricating results.
 */
export async function webSearch(query: string, opts: { lane?: Lane; max_results?: number } = {}): Promise<string> {
  const q = String(query || "").trim().slice(0, 400);
  if (!q) throw new Error("openai_web_search_query_required");
  const lane = opts.lane ?? "P1";
  const maxResults = Math.max(1, Math.min(8, Number(opts.max_results) || 5));
  const adm = await governorAdmit(lane);
  if (!adm.ok) throw new Error(`${adm.reason}: web-search rejected by Governor (lane ${lane})`);
  try {
    const out = await llmSlot(async () => {
      await quotaPace();
      const key = loadOpenAiKey();
      if (!key) throw new Error("openai_no_key");
      const model = canonicalOpenAiModel();
      return llmRetry(async () => {
        const body = {
          model,
          tools: [{ type: "web_search" }],
          tool_choice: "auto",
          store: false,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Search the web for: ${q}\nReturn up to ${maxResults} useful results. For each result include title, a concise factual snippet, and the source URL. Do not invent URLs.`,
                },
              ],
            },
          ],
        };
        const r = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
        if (!r.ok) {
          const ra = r.headers.get("retry-after");
          throw new Error(`openai web_search HTTP ${r.status}${ra ? ` (retry-after: ${parseInt(ra, 10) || 1}s)` : ""}: ${(await r.text()).slice(0, 300)}`);
        }
        const payload = await r.json();
        const text = extractResponsesText(payload);
        if (!text) throw new Error("openai_web_search_empty_response");
        return text;
      }, 4, `openai-web-search:${model}`);
    });
    governorReportSuccess(lane);
    return out;
  } catch (e) {
    if (RETRYABLE.test(String(e))) governorReport429(lane);
    throw e;
  }
}
