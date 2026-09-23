/**
 * ME2 daemon — Reviewer agent (R29, пункт C3 из research/2026/R24-AUDIT-ROADMAP.md §7
 * + директива оператора: «следи чтобы работа агентов была не фальшивой»).
 *
 * Что делает: после COMPLETED задачи LLM-ревью сверяет результат со спеком и
 * телеметрией lease. Это НЕ награда и НЕ статус — revью zero-authority: оно НИКОГДА
 * не меняет состояние задачи/цели, только вердикт + события + память.
 *
 * Вердикты (канон, честный):
 *  - real     — результат согласован со спеком и телеметрией;
 *  - suspect  — есть признаки фальши/неполноты (см. сигналы ниже);
 *  - empty    — результат пуст/эквивалентен «нечего показать».
 *
 * Антифальш-сигналы (уходят в промпт как улики):
 *  - task creation-finish (steps≤1) при спеке, требующей файлов/действий;
 *  - result утверждает создание файлов, а write_file в toolCalls не было;
 *  - result без конкретики (шаблонные обрывки);
 *  - reward-hack verdict tier-1 уже сработал (ME15) — усиливает suspect.
 *
 * Квоты (урок R11/R14 — самокоррекция без квоты = бесконечные платные циклы):
 *  1 ревью на задачу навсегда (idempotent), ≤2 in-flight, LLM-ошибки не роняют шину.
 *
 * REST: GET /reviews (последние + статистика) — вне шины (47/47). Механика ME26.
 */
import { db, emit, getTask, updateTask, nowIso, type TaskRow } from "../store";
import { chat } from "../providers";
import { memWrite } from "./memory";
import { recordSpan } from "./otel";

export type ReviewVerdict = "real" | "suspect" | "empty";

export interface TaskReview {
  verdict: ReviewVerdict;
  reasons: string[];
  checked_at: string;
  evidence: { steps: number; writes: number; tool_calls: number; result_len: number; reward_hack: boolean };
}

const MAX_INFLIGHT = 2;
let inflight = 0;

/** toolCalls собираются в worker.ts — тут читаем компактную статистику из ring-буфера span'ов невозможна,
 *  поэтому worker передаёт сводку прямо. Память о ревью пишется в tasks.review (watermark из БД). */

export function reviewStats(): { total: number; by_verdict: Record<string, number>; last: { task_id: string; verdict: string; at: string } | null } {
  const rows = db.query(`SELECT id FROM tasks WHERE review IS NOT NULL ORDER BY updated_at DESC LIMIT 500`).all() as Array<{ id: string }>;
  const byVerdict: Record<string, number> = { real: 0, suspect: 0, empty: 0 };
  let last: { task_id: string; verdict: string; at: string } | null = null;
  for (const r of rows) {
    try {
      const rv = JSON.parse((db.query(`SELECT review FROM tasks WHERE id=?`).get(r.id) as { review: string }).review) as TaskReview;
      byVerdict[rv.verdict] = (byVerdict[rv.verdict] ?? 0) + 1;
      if (!last) last = { task_id: r.id, verdict: rv.verdict, at: rv.checked_at };
    } catch { /* битое ревью не считаем */ }
  }
  return { total: rows.length, by_verdict: byVerdict, last };
}

export function reviewList(limit = 20): Array<{ task_id: string; title: string; status: string; review: TaskReview }> {
  const rows = db.query(`SELECT id, title, status, review FROM tasks WHERE review IS NOT NULL ORDER BY updated_at DESC LIMIT ?`)
    .all(Math.min(Math.max(1, limit), 100)) as Array<{ id: string; title: string; status: string; review: string }>;
  const out: Array<{ task_id: string; title: string; status: string; review: TaskReview }> = [];
  for (const r of rows) {
    try { out.push({ task_id: r.id, title: r.title, status: r.status, review: JSON.parse(r.review) as TaskReview }); } catch { /* skip */ }
  }
  return out;
}

/** Ревью одной задачи (если ещё не ревьюена). Возвращает вердикт или null (квота/уже есть).
 *  hint — телеметрия lease из worker (writes/tool_calls), улики для антифальшь-вердикта. */
export function reviewTask(taskId: string, hint?: { writes: number; tool_calls: number; parse_fails?: number }): TaskReview | null {
  const t = getTask(taskId);
  if (!t) throw new Error("task_not_found");
  if (t.review) return null; // 1 ревью на задачу — idempotent
  if (inflight >= MAX_INFLIGHT) return null;
  inflight++;
  void (async () => {
    try {
      const rv = await runReview(t, hint);
      db.query(`UPDATE tasks SET review=?, updated_at=? WHERE id=? AND review IS NULL`)
        .run(JSON.stringify(rv), nowIso(), t.id);
      emit("TASK_REVIEWED", { task_id: t.id, verdict: rv.verdict, reasons: rv.reasons.slice(0, 3) }, t.agent_id, t.id);
      if (rv.verdict !== "real") {
        // антифальшь-контур: подозрительные результаты — в семантическую память с высоким весом
        try {
          memWrite({
            kind: "semantic", key: `review:${t.id}`,
            content: `[REVIEW:${rv.verdict.toUpperCase()}] ${t.title.slice(0, 100)} — ${rv.reasons.join("; ").slice(0, 300)}`,
            tags: ["review", rv.verdict], importance: 0.85,
          });
        } catch { /* память не ломает ревью */ }
      }
      recordSpan("review.task", { "me2.task_id": t.id, "me2.verdict": rv.verdict }, Date.now(),
        rv.verdict === "real" ? {} : { status: "WARNING", message: rv.reasons.join("; ").slice(0, 160) });
    } catch (e) {
      recordSpan("review.task", { "me2.task_id": t.id }, Date.now(), { status: "ERROR", message: String(e).slice(0, 120) });
    } finally {
      inflight--;
    }
  })();
  return null; // ревью асинхронное — результат через событие TASK_REVIEWED и GET /reviews
}

async function runReview(t: TaskRow, hint?: { writes: number; tool_calls: number; parse_fails?: number }): Promise<TaskReview> {
  const evidence = {
    steps: t.steps,
    writes: hint?.writes ?? -1,
    tool_calls: hint?.tool_calls ?? t.steps,
    parse_fails: hint?.parse_fails ?? -1,
    result_len: (t.result ?? "").length,
    reward_hack: /no_writes_on_creation_task|instant_finish|empty_result/.test(t.reflection ?? ""),
  };
  const result = (t.result ?? "").slice(0, 1200);
  const prompt = [
    `Ты — строгий ревьюер результатов агентов (антифальшь-контур). Задача:`,
    `СПЕК: ${t.spec.slice(0, 1500)}`,
    `РЕЗУЛЬТАТ АГЕНТА: ${result || "(пусто)"}`,
    `ТЕЛЕМЕТРИЯ LEASE: шагов=${evidence.steps}, инструментальных вызовов=${evidence.tool_calls}, записей файлов=${evidence.writes >= 0 ? evidence.writes : "н/д"}, result_len=${evidence.result_len}${evidence.reward_hack ? ", tier-1 verdict: признаки reward-hacking" : ""}`,
    `Ответь РОВНО ОДНИМ JSON-объектом без markdown: {"verdict":"real|suspect|empty","reasons":["…"],"confidence":0..1}`,
    `Критерии: "empty" — результат пуст или не содержит ничего по спеку; "suspect" — утверждения результата не подтверждаются (обещано создание файлов/кода, а конкретики нет; отписка-заглушка; шагов слишком мало для спека); "real" — результат конкретен и согласован со спеком.`,
  ].join("\n");
  const raw = await chat("zai:default", [
    { role: "system", content: "Ты антифальшь-ревьюер. Только JSON." },
    { role: "user", content: prompt },
  ], { temperature: 0.1 });
  const m = raw.match(/\{[\s\S]*\}/);
  let verdict: ReviewVerdict = "suspect";
  let reasons: string[] = ["reviewer: ответ не распознан — консервативный suspect"];
  let confidence = 0.3;
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { verdict?: string; reasons?: string[]; confidence?: number };
      if (["real", "suspect", "empty"].includes(String(j.verdict))) verdict = j.verdict as ReviewVerdict;
      if (Array.isArray(j.reasons) && j.reasons.length) reasons = j.reasons.map((x) => String(x).slice(0, 200)).slice(0, 5);
      if (typeof j.confidence === "number") confidence = Math.max(0, Math.min(1, j.confidence));
    } catch { /* консервативный suspect */ }
  }
  return { verdict, reasons, checked_at: nowIso(), evidence };
}

export function reviewerVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  try {
    const col = db.query(`SELECT name FROM pragma_table_info('tasks') WHERE name='review'`).get();
    if (!col) return { verdict: "CAVEAT", evidence: "колонка tasks.review отсутствует" };
    const s = reviewStats();
    if (s.total === 0) {
      return { verdict: "CAVEAT", evidence: "ревью ещё не было — выполни COMPLETED-задачу или POST /reviews/run {task_id}" };
    }
    const suspicious = (s.by_verdict.suspect ?? 0) + (s.by_verdict.empty ?? 0);
    return {
      verdict: "WORKS",
      evidence: `ревью=${s.total} (real=${s.by_verdict.real ?? 0}, suspect=${s.by_verdict.suspect ?? 0}, empty=${s.by_verdict.empty ?? 0}) — подозрительные=${suspicious} уходят в память+события; GET /reviews`,
    };
  } catch (e) {
    return { verdict: "CAVEAT", evidence: `reviewer сломан: ${e instanceof Error ? e.message : String(e)}`.slice(0, 180) };
  }
}
