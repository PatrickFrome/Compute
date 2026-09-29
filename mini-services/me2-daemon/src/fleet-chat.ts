/**
 * FLEET-CHAT (фаза 3 §3-миграции, Job 419718 @16:15) — адаптер chat()-сигнатуры
 * поверх fleet-readback канала (единственный канонический LLM-путь рантайма).
 *
 * Директива §3: НИКАКИХ model/provider API/SDK в runtime. providers.chat() после
 * миграции всех консьюмеров — нек исполнимый reference-path (zai/gateway QUARANTINED).
 *
 * Контракт:
 *  - governorAdmit(lane) — та же дисциплина полос P0>P1>P2, что и у chat();
 *  - messages[] → однострочный промпт (L20: multiline ломает посткондицию композера);
 *  - fleetReadbackAsk (scratch-таб lifecycle, evidence-гейты L21-L23, no silent fallback);
 *  - ответ: изолированная reply-зона (маркер-протокол L19), fallback — весь транскрипт
 *    (consumers сами экстрагируют JSON/сводку; reviewer использует тот же правило);
 *  - TTL-кэш (v0.57.0 L2-дедуп сохранён): детерминированные промпты не жгут browser-бюджет;
 *  - отказ канала = честный FleetChannelError наверх (никакого zai/gateway fallback).
 */
import { fleetReadbackAsk, type FleetReadbackResult } from "./fleet-readback";
import { governorAdmit, governorReportSuccess, type Lane } from "./governor";
import { createHash } from "node:crypto";

export interface FleetChatMessage { role: "system" | "user" | "assistant"; content: string; }

/** TTL-кэш дедупа: 32 записи × 30 мин — детерминированные классификации/планы повторяются. */
const CACHE_MAX = 32;
const CACHE_TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; reply: string }>();

function cacheKey(messages: FleetChatMessage[]): string {
  return createHash("sha256").update(JSON.stringify(messages), "utf8").digest("hex");
}

function cacheGet(k: string): string | null {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(k); return null; }
  return hit.reply;
}

function cachePut(k: string, reply: string): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(k, { at: Date.now(), reply });
}

/** messages[] → однострочный промпт с ролевыми маркерами (плоскость L20). */
function flatten(messages: FleetChatMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role === "system" ? "СИСТЕМА" : m.role === "assistant" ? "АССИСТЕНТ" : "ПОЛЬЗОВАТЕЛЬ";
      return `${role}: ${String(m.content ?? "").replace(/\s*\n\s*/g, " ").trim()}`;
    })
    .join(" || ")
    .slice(0, 1400); // fleet-readback сам режет на 1500, оставляем место под протокол-хвост
}

export async function fleetChat(
  messages: FleetChatMessage[],
  opts: { lane?: Lane; timeout_ms?: number } = {},
): Promise<string> {
  const lane = opts.lane ?? "P1";
  const adm = await governorAdmit(lane);
  if (!adm.ok) throw new Error(`${adm.reason}: fleet-вызов отклонён Governor (lane ${lane})`);
  const key = cacheKey(messages);
  const hit = cacheGet(key);
  if (hit !== null) { governorReportSuccess(lane); return hit; } // L2: дедуп не тратит browser-бюджет
  const prompt = flatten(messages);
  let res: FleetReadbackResult;
  try {
    res = await fleetReadbackAsk(prompt, { timeout_ms: opts.timeout_ms ?? 75_000 });
  } catch (e) {
    // честный отказ наверх: governor-полосу НЕ освобождаем как успех
    throw e;
  }
  governorReportSuccess(lane);
  const reply = res.reply_isolated && res.reply ? res.reply : res.text;
  cachePut(key, reply);
  return reply;
}

/**
 * FLEET-ASK-HISTORY (419718-1645) — многосообщностный вариант для executor-циклов
 * (worker.ts: системный протокол + задача + уроки памяти ≈ 3k, дефолт 1400 мал).
 *
 * Отличия от fleetChat:
 *  - транскрипт с ролевыми тегами, cap по opts.max_chars (дефолт 12_000);
 *  - усечение HEAD+TAIL (65%/35%) с честным маркером середины — протокол в голове
 *    и последнее наблюдение в хвосте сохраняются оба;
 *  - max_chars прокидывается в fleetReadbackAsk (дефолт 1500 там не тронут);
 *  - генерация-ожидание масштабируется длиной промпта (внутри fleetReadbackAsk).
 * Отказ канала = честный FleetChannelError наверх (без fallback — §3).
 */
export async function fleetAskHistory(
  messages: FleetChatMessage[],
  opts: { lane?: Lane; timeout_ms?: number; max_chars?: number } = {},
): Promise<string> {
  const lane = opts.lane ?? "P1";
  const adm = await governorAdmit(lane);
  if (!adm.ok) throw new Error(`${adm.reason}: fleet-вызов отклонён Governor (lane ${lane})`);
  const key = cacheKey(messages);
  const hit = cacheGet(key);
  if (hit !== null) { governorReportSuccess(lane); return hit; }
  const cap = Math.max(1500, opts.max_chars ?? 12_000);
  const parts = messages.map((m) => {
    const role = m.role === "system" ? "СИСТЕМА" : m.role === "assistant" ? "АССИСТЕНТ" : "ПОЛЬЗОВАТЕЛЬ";
    return `${role}: ${String(m.content ?? "").replace(/\s*\n\s*/g, " ").trim()}`;
  });
  let body = parts.join(" || ");
  if (body.length > cap) {
    const head = Math.floor(cap * 0.65);
    const tail = cap - head;
    body = `${body.slice(0, head)} …[СЕРЕДИНА ДИАЛОГА УСЕЧЕНА — ранние шаги не влияют на текущее действие]… ${body.slice(-tail)}`;
  }
  let res: FleetReadbackResult;
  try {
    res = await fleetReadbackAsk(body, { timeout_ms: opts.timeout_ms ?? 150_000, max_chars: cap + 200 });
  } catch (e) {
    throw e; // честный отказ наверх (§3: никакого silent fallback)
  }
  governorReportSuccess(lane);
  const reply = res.reply_isolated && res.reply ? res.reply : res.text;
  cachePut(key, reply);
  return reply;
}
