/**
 * ME2 CHAT-SWARM v1.3.0 — model-scout.ts
 * ДИРЕКТИВА ОПЕРАТОРА 2026-09-29: «рой должен искать способы перевести агентов
 * на самые лучшие доступные ai модели».
 *
 * Модуль-разведчик (Model Scout) непрерывно:
 *   1) НАХОДИТ кандидатов:
 *      - каталог моделей pollinations (text.pollinations.ai/models) — без ключа;
 *      - Hack Club AI (ai.hackclub.com) — без ключа;
 *      - OpenRouter free-модели (pricing==0) — вызов требует ключа; если ключа
 *        нет, рой объявляет оператору, КАКОЙ ключ добавить (поиск способов!);
 *      - предложения самих агентов: агент делает swarm_improve с текстом
 *        «MODEL:https://endpoint|имя-модели[|KEY:ИМЯ_ENV]» — разведка проверяет.
 *   2) ОЦЕНИВАЕТ: tier-скоринг по имени модели (gpt-5/claude-4/gemini-2.5/…),
 *        затем живой пробный вызов (русский JSON-экшен) с замером латентности.
 *   3) МИГРИРУЕТ: верифицированные модели встают ВПЕРЕДИ статической цепочки
 *      (setDynamicProviders, score desc) — агенты сразу говорят с лучшей моделью.
 *   4) УЧИТСЯ: каждый скан — урок роя + объявление в #all + event scout_scan.
 *
 * Все таймауты здесь — только на диагностических пробах (иначе мониторинг
 * зависал бы сам); на рабочие вызовы агентов разведка лимитов не ставит.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { addMessage, addEvent, addLesson, db } from "./memory";
import { setDynamicProviders, type DynamicProvider } from "./llm";
import { tierScore } from "./tier";

const STATE_DIR = join(import.meta.dir, "..", "state");
const STATE_FILE = join(STATE_DIR, "scout.json");
const PROBE_TIMEOUT_MS = 60_000;  // только диагностика; рабочие вызовы — без лимитов
const SCAN_MS = 20 * 60_000;      // полный скан каждые 20 минут (+ ручной /scout/run)
const MAX_DYNAMIC = 4;            // сколько лучших разведанных моделей держим в голове цепочки
const ADOPT_MIN_SCORE = 55;       // ниже — не мигрируем (слабее базового pollinations)

/* ---------------- Tier-скоринг: переиспользуем общий tier.ts ---------------- */

/* ---------------- Состояние ---------------- */

export interface ScoutedProvider {
  key: string;          // уникальный ключ провайдера
  endpoint: string;     // OpenAI-совместимый /chat/completions URL
  model: string;        // имя модели на endpoint'е
  authKeyName?: string; // имя ENV-ключа (без значения!), если нужен
  source: string;       // откуда найден: catalog|hackclub|openrouter|agent-proposal
  score: number;        // tier-оценка
  latencyMs: number;    // латентность пробного вызова
  verifiedAt: string;   // когда верифицирован живым вызовом
  okCount: number;
  errCount: number;
}

export interface ScoutState {
  lastScanAt: string | null;
  lastScanSummary: string;
  scans: number;
  migrations: number;           // сколько раз цепочка пересобиралась на лучшее
  discovered: number;           // всего уникальных кандидатов найдено
  verified: number;             // всего верифицировано живым вызовом
  needsKeys: string[];          // какие ключи нужны оператору для ещё лучших моделей
  providers: ScoutedProvider[]; // текущие динамические провайдеры
  lastCatalog: Array<{ model: string; score: number; source: string }>; // последние находки
}

let scout: ScoutState = load();

function load(): ScoutState {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8")) as ScoutState;
  } catch { /* битый файл — начинаем с нуля */ }
  return {
    lastScanAt: null, lastScanSummary: "ещё не сканировали", scans: 0, migrations: 0,
    discovered: 0, verified: 0, needsKeys: [], providers: [], lastCatalog: [],
  };
}

function save() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(scout, null, 2));
  } catch { /* диск недоступен — держим в памяти */ }
}

export function scoutStatus(): ScoutState {
  return scout;
}

/* ---------------- Проба кандидата (живой вызов) ---------------- */

const PROBE_SYSTEM = "Ты — агент роя. Отвечай ТОЛЬКО JSON-массивом действий, без пояснений: [{\"type\":\"say\",\"text\":\"...\"}]";
const PROBE_USER = "Скажи «Разведка подтверждает связь» действием say.";

function extractActionsText(raw: string): string {
  return raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
}

async function probeEndpoint(
  endpoint: string, model: string, authKeyName?: string,
): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  let apiKey = "";
  if (authKeyName) {
    apiKey = process.env[authKeyName] ?? "";
    try {
      const envf = readFileSync("/tmp/my-project/.a2-backup/me2.env.20260922", "utf8");
      const m = envf.match(new RegExp(`^${authKeyName}=(.*)$`, "m"));
      if (m) apiKey = m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* ENVF недоступен — только process.env */ }
    if (!apiKey) return { ok: false, latencyMs: 0, detail: `нет ключа ${authKeyName}` };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const t0 = Date.now();
  const r = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model, stream: false,
      messages: [
        { role: "system", content: PROBE_SYSTEM },
        { role: "user", content: PROBE_USER },
      ],
    }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), // только диагностика
  });
  if (!r.ok) return { ok: false, latencyMs: Date.now() - t0, detail: `http_${r.status}` };
  const d = (await r.json()) as { choices?: Array<{ message?: { content?: string } }>; result?: { response?: string } };
  // v1.4.1: OpenAI-совместимый (choices) ИЛИ Cloudflare-формат ({result:{response}})
  const content = d?.choices?.[0]?.message?.content ?? (d as { result?: { response?: string } })?.result?.response ?? "";
  if (!content) return { ok: false, latencyMs: Date.now() - t0, detail: "empty" };
  const txt = extractActionsText(content);
  let valid = false;
  try {
    const arr = JSON.parse(txt.startsWith("[") ? txt : txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1));
    valid = Array.isArray(arr) && arr.some((a: { type?: string }) => a?.type === "say");
  } catch { valid = /type["']?\s*:\s*["']say/.test(txt); }
  const latencyMs = Date.now() - t0;
  return { ok: valid, latencyMs, detail: valid ? "json_say_ok" : "не JSON-экшен" };
}

/* ---------------- Источники кандидатов ---------------- */

interface Candidate { endpoint: string; model: string; authKeyName?: string; source: string }

async function discoverPollinations(): Promise<Candidate[]> {
  try {
    const r = await fetch("https://text.pollinations.ai/models", { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!r.ok) return [];
    const d = (await r.json()) as unknown;
    const names: string[] = Array.isArray(d)
      ? d.map((el) => typeof el === "string" ? el : String((el as { name?: string })?.name ?? "")).filter(Boolean)
      : [];
    return names.map((m) => ({ endpoint: "https://text.pollinations.ai/openai", model: m, source: "catalog" }));
  } catch { return []; }
}

async function discoverHackclub(): Promise<Candidate[]> {
  try {
    const r = await fetch("https://ai.hackclub.com/model", { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return [];
    const model = String(await r.text()).trim().replace(/^"|"$/g, "");
    if (!model) return [];
    return [{ endpoint: "https://ai.hackclub.com/chat/completions", model, source: "hackclub" }];
  } catch { return []; }
}

interface OpenRouterModel { id?: string; pricing?: { prompt?: string; completion?: string } }
async function discoverOpenRouter(): Promise<{ candidates: Candidate[]; needsKey: string[] }> {
  const out: { candidates: Candidate[]; needsKey: string[] } = { candidates: [], needsKey: [] };
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!r.ok) return out;
    const d = (await r.json()) as { data?: OpenRouterModel[] };
    const free = (d?.data ?? [])
      .filter((m) => m?.id && m?.pricing?.prompt === "0" && m?.pricing?.completion === "0")
      .map((m) => ({ id: String(m.id), score: tierScore(String(m.id)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    const hasKey = !!(process.env.OPENROUTER_API_KEY ?? envfKey("OPENROUTER_API_KEY"));
    for (const f of free) {
      if (hasKey) out.candidates.push({ endpoint: "https://openrouter.ai/api/v1/chat/completions", model: f.id, authKeyName: "OPENROUTER_API_KEY", source: "openrouter" });
      else out.needsKey.push(`${f.id} (score ${f.score}, free)`);
    }
  } catch { /* каталог недоступен — скан продолжается */ }
  return out;
}

function envfKey(key: string): string {
  try {
    const m = readFileSync("/tmp/my-project/.a2-backup/me2.env.20260922", "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}

/** v1.4.1 Каталог Cloudflare Workers AI (creds уже есть: CF_ACCOUNT_ID + CF_AI_WORKER_TOKEN).
 *  На Free-плане лежат сильные модели: deepseek-r1-distill-32b, qwen3.8-27b,
 *  llama-4-scout, gpt-oss-120b, glm-5.3-flash и др. Дневная квота 10k neurons:
 *  при исчерпании проба честно fails (http_429) — модель верифицируется автоматически
 *  после суточного сброса (скан каждые 20 мин), миграция на лучшее продолжается сама.
 *  Формат ответа CF — {result:{response}}, парсится в probeEndpoint/makeCaller. */
async function discoverCloudflare(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  try {
    const acc = envfKey("CF_ACCOUNT_ID");
    const tok = envfKey("CF_AI_WORKER_TOKEN");
    if (!acc || !tok) return out;
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/models/search?task=Text%20Generation&per_page=100`, {
      headers: { Authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!r.ok) return out;
    const d = (await r.json()) as { result?: Array<{ name?: string }> };
    const names = (d?.result ?? []).map((m) => String(m?.name ?? "")).filter(Boolean);
    for (const m of names) {
      if (tierScore(m) >= 70) out.push({ endpoint: `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${m}`, model: m, authKeyName: "CF_AI_WORKER_TOKEN", source: "cf-catalog" });
    }
  } catch { /* каталог недоступен — скан продолжается */ }
  return out;
}

/**
 * Предложения агентов: агент делает swarm_improve с текстом
 * «MODEL:https://endpoint|имя-модели[|KEY:ИМЯ_ENV]» — разведка проверяет кандидата
 * живым вызовом и при успехе ставит его в голову цепочки.
 */
function discoverAgentProposals(): Candidate[] {
  const out: Candidate[] = [];
  try {
    const rows = db.query(
      `SELECT payload FROM events WHERE type='swarm_improve' AND id > (SELECT COALESCE(MAX(id),0) FROM events WHERE type='scout_proposals_cursor') ORDER BY id DESC LIMIT 60`,
    ).all() as Array<{ payload: string }>;
    const seen = new Set<string>();
    for (const r of rows) {
      const m = String(r.payload).match(/MODEL:(https?:\/\/[^|\s]+)\|([\w.\-\/:]+)(?:\|KEY:([A-Z0-9_]+))?/i);
      if (!m) continue;
      const k = `${m[1]}::${m[2]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ endpoint: m[1], model: m[2], authKeyName: m[3], source: "agent-proposal" });
    }
    db.query(`INSERT INTO events (ts,type,payload) VALUES (?,?,?)`).run(new Date().toISOString(), "scout_proposals_cursor", "cursor");
  } catch { /* events недоступны — пропускаем источник */ }
  return out;
}

/* ---------------- Скан + миграция ---------------- */

async function runScan(): Promise<ScoutState> {
  const found: Candidate[] = [];
  const needsKeys = new Set<string>();

  const [pollies, hackclub, or, cf, proposals] = await Promise.all([discoverPollinations(), discoverHackclub(), discoverOpenRouter(), discoverCloudflare(), Promise.resolve(discoverAgentProposals())]);
  found.push(...pollies, ...hackclub, ...or.candidates, ...cf, ...proposals);
  or.needsKey.forEach((k) => needsKeys.add(`OPENROUTER_API_KEY → ${k}`));
  if (proposals.length) addEvent("scout_agent_proposals", { models: proposals.map((p) => `${p.model}@${p.endpoint.slice(0, 60)}`) });

  // dedupe по endpoint+model
  const seen = new Set<string>();
  const uniq = found.filter((c) => {
    const k = `${c.endpoint}::${c.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  scout.discovered += uniq.length;
  scout.lastCatalog = uniq
    .map((c) => ({ model: c.model, score: tierScore(c.model), source: c.source }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  // Верификация живым вызовом: агент-предложения ВСЕГДА, остальное — топ-8 по tier
  const sorted = [...uniq].sort((a, b) => tierScore(b.model) - tierScore(a.model));
  const topSorted = sorted.filter((c) => c.source !== "agent-proposal").slice(0, 8);
  const toProbe = [...sorted.filter((c) => c.source === "agent-proposal"), ...topSorted].slice(0, 12);
  const verified: ScoutedProvider[] = [];
  for (const c of toProbe) {
    try {
      const p = await probeEndpoint(c.endpoint, c.model, c.authKeyName);
      addEvent("scout_probe", { model: c.model, source: c.source, ...p });
      if (p.ok) {
        const prev = scout.providers.find((x) => x.key === `${c.source}:${c.model}`);
        verified.push({
          key: `${c.source}:${c.model}`,
          endpoint: c.endpoint, model: c.model, authKeyName: c.authKeyName, source: c.source,
          score: tierScore(c.model), latencyMs: p.latencyMs, verifiedAt: new Date().toISOString(),
          okCount: (prev?.okCount ?? 0) + 1, errCount: prev?.errCount ?? 0,
        });
      }
    } catch (e) {
      addEvent("scout_probe_error", { model: c.model, error: String(e).slice(0, 120) });
    }
  }

  // Слияние с прошлыми верифицированными (память разведки: Verified ранее — остаётся в реестре)
  scout.verified += verified.length; // v1.4.1: счётчик раньше не инкрементировался
  const merged = new Map<string, ScoutedProvider>();
  for (const p of scout.providers) merged.set(p.key, p);
  for (const v of verified) merged.set(v.key, v);
  const best = [...merged.values()]
    .filter((p) => p.score >= ADOPT_MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.latencyMs - b.latencyMs)
    .slice(0, MAX_DYNAMIC);

  // Миграция цепочки: динамические провайдеры встают ПЕРЕД статическими
  const dyn: DynamicProvider[] = best.map((p) => ({
    name: p.key,
    score: p.score,
    fn: makeCaller(p),
  }));
  const beforeHead = scout.providers[0]?.key ?? "pollinations(default)";
  setDynamicProviders(dyn);
  const afterHead = best[0]?.key ?? "pollinations(default)";

  scout.providers = best;
  scout.needsKeys = [...needsKeys];
  scout.scans++;
  scout.lastScanAt = new Date().toISOString();

  const summary = `скан#${scout.scans}: найдено ${uniq.length}, верифицировано ${verified.length}, в голове цепочки: ${afterHead}${best.length ? ` (tier ${best[0].score})` : " (статическая)"}`;
  scout.lastScanSummary = summary;
  if (afterHead !== beforeHead && best.length) scout.migrations++;

  addEvent("scout_scan", { summary, catalog: scout.lastCatalog.slice(0, 10), providers: best.map((p) => ({ key: p.key, score: p.score, latency: p.latencyMs })) });
  addMessage({
    from_id: null, from_name: "РАЗВЕДЧИК-МОДЕЛЕЙ", kind: "meta", channel: "#meta",
    text: `🛰 ${summary}. Лучшие верифицированные: ${best.map((p) => `${p.model}(tier ${p.score}, ${p.latencyMs}ms)`).join("; ") || "—"}${scout.needsKeys.length ? `. Нужны ключи: ${scout.needsKeys.slice(0, 2).join("; ")}` : ""}`,
  });
  addLesson("scout", "РАЗВЕДЧИК-МОДЕЛЕЙ", `Разведка моделей: ${summary}`, null);
  save();
  return scout;
}

function makeCaller(p: ScoutedProvider): (system: string, user: string) => Promise<string> {
  return async (system: string, user: string) => {
    let apiKey = "";
    if (p.authKeyName) {
      apiKey = process.env[p.authKeyName] ?? envfKey(p.authKeyName);
      if (!apiKey) throw new Error(`${p.key}_no_key`);
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const r = await fetch(p.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: p.model, stream: false,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      // v1.3.0: таймаутов на работе НЕТ — ждём лучшую модель сколько нужно
    });
    if (!r.ok) throw new Error(`${p.key}_http_${r.status}`);
    const d = (await r.json()) as { choices?: Array<{ message?: { content?: string } }>; result?: { response?: string } };
    // v1.4.1: OpenAI-совместимый ИЛИ Cloudflare-формат ({result:{response}})
    const c = d?.choices?.[0]?.message?.content ?? (d as { result?: { response?: string } })?.result?.response ?? "";
    if (!c) throw new Error(`${p.key}_empty`);
    return c;
  };
}

/** Публичный ручной триггер (POST /scout/run). */
export async function runScoutNow(): Promise<ScoutState> {
  return runScan();
}

/** Вечный цикл разведки: скан + автопересборка цепочки на лучшее. */
export function startScoutLoop() {
  // первый скан через 45с после старта (даём генезису подняться)
  setTimeout(() => { void runScan().catch((e) => addEvent("scout_error", { error: String(e).slice(0, 160) })); }, 45_000);
  setInterval(() => { void runScan().catch((e) => addEvent("scout_error", { error: String(e).slice(0, 160) })); }, SCAN_MS);
}
