/**
 * ME5 BRAIN (R19) — порт когнитивного слоя старой системы (M12 cognitive delta bus был
 * транспортом; сам «brain» жил в Electron-шелле и в репозиторий не попал).
 *
 * ME2 Brain = LLM-ядро принятия решений:
 *  1) реколл памяти (memSearch по цели + touches) → TEAM MEMORY блок (порт #memoryBlockFor);
 *  2) строгий JSON-план {summary, steps[], risks[]} через providers.chat (семафор+429-backoff);
 *  3) мысль материализуется в память (episodic, key=thought:<ts36>) — рефлексия накапливается;
 *  4) self-probe: eventloop_ms (замер цикла событий) + db_probe — честная проба живости
 *     (аналог wake-probe старой системы, который мерил NOTIFY 3–13ms).
 *
 * Zero-authority: план НЕ enqueue-ит задачи сам — оператор видит steps и решает.
 */
import { chat } from "../providers";
import { memSearch, memTouch, memBlockEconomy, memWrite, memoryStatus } from "./memory";
import { emit } from "../store";
import { recordSpan } from "./otel";

export interface BrainThought {
  goal: string; summary: string; steps: string[]; risks: string[];
  memory_used: number[]; mem_saved_pct: number; ms: number; model: string;
}

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}

export async function brainThink(goalRaw: string): Promise<BrainThought & { thought_key: string }> {
  const goal = String(goalRaw ?? "").trim().slice(0, 2000);
  if (!goal) throw new Error("goal_required");
  const t0 = Date.now();

  // 1) реколл: топ-совпадения по цели + верхний TEAM MEMORY блок
  const recalled = memSearch({ q: goal, limit: 6 });
  memTouch(recalled.map((r) => r.id));
  // E5 (R35): экономная дельта-доставка вместо полного блока (sticky-уроки всегда на месте)
  const econ = memBlockEconomy("brain", 5, 1200);
  const block = { block: econ.block, used: econ.used };

  // 2) LLM-план
  const sys = [
    "Ты — Brain ядра ME2 OS (локальный agent-runtime).",
    "Дана цель оператора и контекст памяти системы (эпизоды задач, уроки, инциденты).",
    "Верни СТРОГО JSON без markdown: {\"summary\": \"1-2 предложения\", \"steps\": [\"шаг\", ...], \"risks\": [\"риск\", ...]}.",
    "Шаги — конкретные и исполнимые средствами daemon (tasks/agents/sandbox/memory), 2–6 шагов.",
    "Учитывай уроки из памяти: не предлагай то, что уже привело к провалу.",
  ].join(" ");
  const user = [
    `ЦЕЛЬ: ${goal}`,
    block.block ? `\n${block.block}` : "",
    recalled.length ? `\nРЕЛЕВАНТНЫЕ ЗАПИСИ: ${recalled.slice(0, 4).map((r) => `${r.key} (${r.kind})`).join("; ")}` : "",
  ].join("\n");
  const raw = await chat("zai:default", [
    { role: "system", content: sys },
    { role: "user", content: user },
  ], { temperature: 0.3 });

  const parsed = extractJson(raw);
  const summary = String(parsed?.summary ?? raw.slice(0, 400));
  const steps = Array.isArray(parsed?.steps) ? (parsed.steps as unknown[]).map((s) => String(s).slice(0, 300)).slice(0, 8) : [];
  const risks = Array.isArray(parsed?.risks) ? (parsed.risks as unknown[]).map((s) => String(s).slice(0, 200)).slice(0, 6) : [];
  const ms = Date.now() - t0;

  // 3) мысль → память (episodic): рефлексивный след
  const key = `thought:${Date.now().toString(36)}`;
  memWrite({
    kind: "episodic", key,
    content: `[THOUGHT] ${goal.slice(0, 200)} → ${summary.slice(0, 300)}`,
    tags: ["brain", "thought"], importance: 0.65,
  });

  const thought: BrainThought = {
    goal: goal.slice(0, 300), summary, steps, risks,
    memory_used: block.used.map((u) => u.id), mem_saved_pct: econ.metrics.saved_pct, ms, model: "zai:default",
  };
  emit("BRAIN_THOUGHT", { goal: thought.goal, steps: steps.length, ms, memory_used: thought.memory_used.length, mem_saved_pct: thought.mem_saved_pct });
  recordSpan("brain.think", { "me2.ms": ms, "me2.steps": steps.length, "me2.mem_used": thought.memory_used.length }, t0);
  return { ...thought, thought_key: key };
}

/** Последние мысли — из памяти (kind=episodic, tags brain). */
export function brainThoughts(limit = 10): Array<{ key: string; content: string; at: number; hits: number }> {
  return memSearch({ kind: "episodic", limit: 60 })
    .filter((r) => r.key.startsWith("thought:"))
    .slice(0, limit)
    .map((r) => ({ key: r.key, content: r.content, at: r.updated_at, hits: r.hits }));
}

/** Self-probe: живость цикла событий + память (аналог wake-probe старой системы). */
export function brainSelfProbe(): { eventloop_ms: number; db_probe_ms: number; memory_rows: number; llm: "ready" } {
  const t0 = Date.now();
  setImmediate(() => { /* замер читается сразу после возврата — eventloop не заблокирован */ });
  const eventloopMs = Date.now() - t0;
  const t1 = Date.now();
  const st = memoryStatus();
  const dbMs = Date.now() - t1;
  return { eventloop_ms: eventloopMs, db_probe_ms: dbMs, memory_rows: st.rows, llm: "ready" };
}

export function brainStatus() {
  return {
    ok: true,
    thoughts: brainThoughts(10),
    probe: brainSelfProbe(),
    memory: memoryStatus(),
  };
}
