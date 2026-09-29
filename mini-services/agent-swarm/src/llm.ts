/**
 * ME2 CHAT-SWARM v1.4.0 — llm.ts
 * Директивы оператора 2026-09-29: «сними все лимиты по времени», «рой должен
 * искать способы перевести агентов на самые лучшие доступные ai модели»,
 * «подготовь 5 notebooks» (мульти-узловой Colab).
 *
 * Что снято полностью (v1.3.0+):
 *   - rate-governor (token bucket 15-30 req/min, spacing 1500-2500ms) — УДАЛЁН.
 *   - circuit-breaker cooldown 90с — УДАЛЁН. Вместо бана — динамический порядок:
 *     провайдер с растущим failStreak автоматически уходит в хвост цепочки.
 *     Ни один провайдер никогда не исключается — любой может вернуться наверх.
 *   - таймауты вызовов (60-180с) — УДАЛЕНЫ. Ждём ответа столько, сколько нужно.
 *     Таймауты остались ТОЛЬКО на зондах мониторинга (диагностика, не работа).
 *   - swarm-pace, chain-dead backoff — УДАЛЕНЫ (agent.ts).
 *
 * Порядок цепочки v1.4.0 — «ЛУЧШИЕ МОДЕЛИ ПЕРВЫМИ»:
 *   на каждом вызове список сортируется: failStreak asc (здоровые первыми) →
 *   tier score desc (сильные модели первыми). В цепочку входят:
 *   1) разведанные внешние модели (model-scout.ts, setDynamicProviders);
 *   2) наши Colab GPU-узлы (colab.ts, до 8 штук, tier по модели узла);
 *   3) статические: zai-glm53 (90) → cf-llama70b (85) → pollinations (55) → ollama-local (35).
 */

import { readFileSync } from "fs";
import ZAI from "z-ai-web-dev-sdk";
import { colabNodes, type ColabNode } from "./colab";
import { tierScore } from "./tier";

export interface LlmResult { content: string; provider: string }

interface ProviderState { failStreak: number; okCount: number; errCount: number; lastErr: string; lastFailAt: number }
const states = new Map<string, ProviderState>();

// v1.4.1 РОЕВАЯ БАЛАНСИРОВКА БЕЗ ЛИМИТОВ: вызовы уходят МЕНЕЕ загруженному
// провайдеру (in-flight asc) — быстрые получают больше трафика, медленный CPU-узел
// держит честную долю, никто не отклонён и ничего не прерывается. Это маршрутизация
// очереди, а не лимит. Записи с метками времени: слот, висящий дольше 30 минут —
// мёртвый сокет, освобождается для маршрутизации (сам вызов НЕ прерывается).
const inFlight = new Map<string, number[]>();
const IF_STALE_MS = 30 * 60_000;
function ifAcq(name: string) {
  const arr = inFlight.get(name) ?? [];
  arr.push(Date.now());
  inFlight.set(name, arr);
}
function ifRel(name: string) {
  const arr = inFlight.get(name) ?? [];
  arr.shift();
  if (arr.length === 0) inFlight.delete(name); else inFlight.set(name, arr);
}
function ifCount(name: string): number {
  const arr = inFlight.get(name);
  if (!arr) return 0;
  const now = Date.now();
  const live = arr.filter((t) => now - t < IF_STALE_MS);
  if (live.length !== arr.length) { if (live.length === 0) inFlight.delete(name); else inFlight.set(name, live); }
  return live.length;
}

function st(name: string): ProviderState {
  let s = states.get(name);
  if (!s) { s = { failStreak: 0, okCount: 0, errCount: 0, lastErr: "", lastFailAt: 0 }; states.set(name, s); }
  return s;
}
function markOk(name: string) { const s = st(name); s.failStreak = 0; s.okCount++; s.lastErr = ""; }
function markFail(name: string, err: string) {
  const s = st(name); s.failStreak++; s.errCount++; s.lastErr = err.slice(0, 120); s.lastFailAt = Date.now();
}
/** v1.4.1: эффективный failStreak с полураспадом 5 минут — провайдер, захворавший
 *  и осевший в хвост, автоматически ВОСКРЕСАЕТ (никаких постоянных банов): через
 *  ~35 минут даже сотня 429 полностью рассасывается, и лучший провайдер
 *  возвращается в голову цепочки. */
function effFs(s: ProviderState): number {
  if (s.failStreak === 0) return 0;
  const ageMin = (Date.now() - (s.lastFailAt || Date.now())) / 60_000;
  if (ageMin < 5) return s.failStreak;
  let f = s.failStreak;
  for (let k = 0; k < Math.floor(ageMin / 5) && f > 0; k++) f = Math.floor(f / 2);
  return f;
}

/** Состояние провайдеров для /health (значений секретов нет). Банов и cooling больше нет. */
export function llmProviderStats() {
  return [...states.entries()].map(([name, s]) => ({
    name, ok: s.okCount, err: s.errCount, failStreak: s.failStreak,
    coolingSec: 0, // v1.3.0: охлаждений нет — всегда 0
    inflight: ifCount(name), // v1.4.1: текущая очередь провайдера
    lastErr: s.lastErr,
  }));
}

/* ---------- ENVF: единственный источник секретов (значения не печатаются) ---------- */

const ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922";
let envCache: { ts: number; map: Map<string, string> } | null = null;
function envKey(key: string): string {
  try {
    if (!envCache || Date.now() - envCache.ts > 60_000) {
      const map = new Map<string, string>();
      for (const line of readFileSync(ENVF, "utf8").split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) map.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
      }
      envCache = { ts: Date.now(), map };
    }
    return envCache.map.get(key) ?? process.env[key] ?? "";
  } catch { return process.env[key] ?? ""; }
}

/* ---------- Провайдер 1: Cloudflare Workers AI ---------- */

const CF_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
async function callCf(system: string, user: string): Promise<string> {
  const acc = envKey("CF_ACCOUNT_ID"); const tok = envKey("CF_AI_WORKER_TOKEN");
  if (!acc || !tok) throw new Error("cf_no_creds");
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${CF_MODEL}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 2000, // v1.3.0: лимиты сняты — даём модели раскрыться (was 400)
        temperature: 0.7,
        // v1.3.0: AbortSignal удалён — ждём столько, сколько нужно
      }),
    },
  );
  if (!r.ok) throw new Error(`cf_http_${r.status}`);
  const d = (await r.json()) as { success?: boolean; result?: { choices?: Array<{ message?: { content?: string } }> } };
  const content = d?.result?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("cf_empty");
  return content;
}

/* ---------- Провайдер 1.5: Pollinations.ai (без ключа вообще) ---------- */

async function callPollinationsModel(model: string, system: string, user: string): Promise<string> {
  const r = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // v1.3.0: таймаут не ставим — разведанная модель отвечает столько, сколько нужно
    }),
  });
  if (!r.ok) throw new Error(`pollinations_http_${r.status}`);
  const d = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const c = d?.choices?.[0]?.message?.content ?? "";
  if (!c) throw new Error("pollinations_empty");
  return c;
}

async function callPollinations(system: string, user: string): Promise<string> {
  return callPollinationsModel("openai", system, user);
}

/* ---------- Провайдер 2: z-ai SDK (glm-5.3) ---------- */

let zaiInst: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function callZai(system: string, user: string): Promise<string> {
  if (!zaiInst) zaiInst = await ZAI.create();
  const resp = await zaiInst.chat.completions.create({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    model: "glm-5.3",
    stream: false,
    thinking: { type: "disabled" },
  });
  const c = (resp as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? "";
  if (!c) throw new Error("zai_empty");
  return c;
}

/* ---------- Провайдер 3: локальная Ollama (ноль квот) ---------- */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:1.5b-instruct";
async function callOllama(system: string, user: string): Promise<string> {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL, stream: false,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      options: { num_predict: 2000, temperature: 0.7 }, // v1.3.0: без урезаний (was 500)
    }),
    // v1.3.0: таймаут удалён — CPU-узел может думать сколько угодно
  });
  if (!r.ok) throw new Error(`ollama_http_${r.status}`);
  const d = (await r.json()) as { message?: { content?: string } };
  const c = d?.message?.content ?? "";
  if (!c) throw new Error("ollama_empty");
  return c;
}

/* ---------- Провайдер 0.x: наши Colab GPU-узлы (мульти-реестр, colab.ts) ----------
 * До 8 GPU-узлов одновременно (5 ноутбуков оператора + запас). Каждый узел —
 * отдельный динамический провайдер: модель узла с высоким tier идёт выше слабых
 * статических. Мёртвый узел исключается зондом colab.ts (3 промаха — факт смерти,
 * не временный бан). */
function colabNodeCaller(node: ColabNode): (system: string, user: string) => Promise<string> {
  return async (system: string, user: string) => {
    const r = await fetch(`${node.url.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: node.model, stream: false,
        keep_alive: -1, // модель не выгружается из VRAM — узел не тратит время на reload
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        options: { num_predict: 2000, temperature: 0.7 }, // без урезаний
      }),
      // таймаут удалён — GPU думает столько, сколько нужно
    });
    if (!r.ok) throw new Error(`colab_http_${r.status}`);
    const d = (await r.json()) as { message?: { content?: string } };
    const c = d?.message?.content ?? "";
    if (!c) throw new Error("colab_empty");
    return c;
  };
}

/* ---------- Динамические провайдеры (разведка лучших моделей, model-scout.ts) ---------- */

export interface DynamicProvider {
  name: string;      // уникальный ключ, напр. "pollinations:openai-large"
  fn: (system: string, user: string) => Promise<string>;
  score: number;     // tier-оценка модели (0-100), для сортировки
}
let dynamicProviders: DynamicProvider[] = [];

/** Разведка ставит верифицированные модели ВПЕРЕДИ статической цепочки (score desc). */
export function setDynamicProviders(list: DynamicProvider[]) {
  dynamicProviders = [...list].sort((a, b) => b.score - a.score);
}
export function dynamicProviderNames(): string[] {
  return dynamicProviders.map((d) => d.name);
}

/* ---------- Цепочка ---------- */

type Gate = () => boolean;
type ChainEntry = [string, (s: string, u: string) => Promise<string>, (() => boolean)?];

// Статический хвост цепочки с tier-оценками (директива «лучшие модели первыми»):
// zai-glm53 (GLM 5.3) → cf-llama70b (LLama-3.3-70B) → pollinations (GPT-OSS-20B) →
// ollama-local (qwen2.5:1.5b). При равном здоровье сильный провайдер вызывается
// раньше; 429/сбои растят failStreak и провайдер сам уезжает в хвост без банов.
const staticChain: ChainEntry[] = [
  ["zai-glm53", callZai],
  ["cf-llama70b", callCf],
  ["pollinations", callPollinations],
  ["ollama-local", callOllama],
];
const STATIC_SCORE: Record<string, number> = {
  "zai-glm53": 90,       // glm-5.3
  "cf-llama70b": 85,     // llama-3.3-70b-instruct
  "pollinations": 55,    // gpt-oss-20b (openai-fast)
  "ollama-local": 35,    // qwen2.5:1.5b-instruct
};

function currentChain(): ChainEntry[] {
  // 1) разведанные внешние модели (model-scout.ts)
  const dyn = dynamicProviders.map((d) => ({ e: [d.name, d.fn] as ChainEntry, score: d.score }));
  // 2) наши живые Colab GPU-узлы — tier по модели узла (мин. 50: своё железо ценнее слабых внешних)
  const colab = colabNodes().map((n) => ({ e: [`colab:${n.name}`, colabNodeCaller(n)] as ChainEntry, score: Math.max(tierScore(n.model), 50) }));
  const stat = staticChain.map((e) => ({ e, score: STATIC_SCORE[e[0]] ?? tierScore(e[0]) }));
  const all = [...dyn, ...colab, ...stat];
  // v1.4.1: in-flight asc (менее загруженный первее — рой самоуравновешивается без
  // лимитов) → failStreak asc с полураспадом (заболевший в хвост, но воскресает) →
  // score desc (лучшая модель) → исходный порядок
  return all
    .map((x, i) => ({ ...x, i, fs: effFs(st(x.e[0])), inf: ifCount(x.e[0]) }))
    .sort((a, b) => a.inf - b.inf || a.fs - b.fs || b.score - a.score || a.i - b.i)
    .map((x) => x.e);
}

export function llmChainStats() {
  const nodes = colabNodes();
  return {
    unlimited: true, // governor удалён по директиве оператора
    note: "no rate limits, no cooldowns, no timeouts; in-flight routing + failStreak half-life decay; best-models-first",
    dynamicProviders: dynamicProviderNames(),
    colabNodes: nodes.map((n) => ({ name: n.name, model: n.model, score: Math.max(tierScore(n.model), 50), url: n.url.slice(0, 60) })),
    staticOrder: staticChain.map((c) => c[0]),
    inflight: Object.fromEntries([...inFlight.entries()].map(([k, v]) => [k, v.length])),
  };
}

/** Главный вход: system+user → content строка от первого живого провайдера. */
export async function llmChat(system: string, user: string): Promise<LlmResult> {
  const errs: string[] = [];
  for (const [name, fn, gate] of currentChain()) {
    if (gate && !gate()) { errs.push(`${name}:off`); continue; } // провайдер выключен — не ошибка
    try {
      ifAcq(name);
      const content = await fn(system, user);
      markOk(name);
      return { content, provider: name };
    } catch (e) {
      markFail(name, String(e));
      errs.push(`${name}:${String(e).slice(0, 60)}`);
    } finally {
      ifRel(name);
    }
  }
  throw new Error(`llm_chain_exhausted [${errs.join(" | ")}]`);
}
