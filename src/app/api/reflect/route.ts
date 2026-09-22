/**
 * POST /api/reflect — tier-2 LLM-рефлексия провалившейся задачи ME2 (R10).
 *
 * Контур: консоль (кнопка ✦ на FAILED/CANCELLED строке ВЕТКИ) → этот роут (backend,
 * z-ai-web-dev-sdk) → daemon REST :3041 (чтение задачи + запись llm-блока в
 * tasks.reflection + событие TASK_REFLECTED → WS-снапшот → UI обновился).
 *
 * tier-1 (детерминированный диагноз worker'а) уже лежит в reflection.cause/what/hint;
 * tier-2 добавляет вербальный урок (Reflexion) в поле llm — его видит оператор в
 * tooltip и получает агент-потомок при TASK_RETRY (retry_memory).
 */
import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const dynamic = "force-dynamic";

const DAEMON = "http://127.0.0.1:3041";

type TaskLike = {
  id: string;
  title: string;
  spec?: string | null;
  status?: string;
  steps?: number;
  max_steps?: number;
  error?: string | null;
  result?: string | null;
  reflection?: string | null;
  parent_id?: string | null;
};

type Tier1 = { cause?: string; what?: string; hint?: string; error?: string };

function parseJsonLoose(text: string): { lesson?: string; fix?: string } | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as { lesson?: string; fix?: string };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let taskId = "";
  let source = "operator";
  try {
    const body = (await req.json()) as { taskId?: string; source?: string };
    taskId = String(body.taskId ?? "").trim();
    if (body.source) source = String(body.source).slice(0, 32);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!taskId) return NextResponse.json({ ok: false, error: "taskId_required" }, { status: 400 });

  // 1) читаем задачу из daemon (server-side, без gateway)
  const tr = await fetch(`${DAEMON}/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" }).catch(() => null);
  if (!tr || !tr.ok) {
    return NextResponse.json({ ok: false, error: tr ? `daemon_${tr.status}` : "daemon_unreachable" }, { status: 502 });
  }
  const { task } = (await tr.json()) as { task: TaskLike };
  if (!task) return NextResponse.json({ ok: false, error: "task_not_found" }, { status: 404 });

  let tier1: Tier1 = {};
  if (task.reflection) {
    try { tier1 = JSON.parse(task.reflection) as Tier1; } catch { tier1 = {}; }
  }

  // 2) вербальная рефлексия (Reflexion-паттерн): диагноз + урок + конкретное исправление
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: [
      {
        role: "assistant",
        content:
          "Ты — инженер-диагност агентной операционной системы ME2. Тебе дают провалившуюся задачу: " +
          "спецификацию, ошибку, детерминированный диагноз tier-1 и потраченные шаги. " +
          "Ответь СТРОГО одним JSON-объектом без markdown: {\"lesson\": string, \"fix\": string}. " +
          "lesson — один конкретный вербальный урок (что именно пошло не так и какой принцип нарушен), " +
          "по-русски, 1–2 предложения, без воды и без повторов очевидного из диагноза. " +
          "fix — конкретное действие для следующей попытки (что изменить: спеку, число шагов, селектор, путь), " +
          "по-русски, 1 предложение. Никакого текста вне JSON.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            id: task.id,
            title: task.title,
            status: task.status,
            steps_used: task.steps,
            max_steps: task.max_steps,
            spec: (task.spec ?? "").slice(0, 1500),
            error: (task.error ?? tier1.error ?? "").slice(0, 500),
            result_tail: (task.result ?? "").slice(0, 300),
            tier1_diagnosis: { cause: tier1.cause ?? null, what: tier1.what ?? null, hint: tier1.hint ?? null },
            parent_id: task.parent_id ?? null,
          },
          null,
          1,
        ),
      },
    ],
    thinking: { type: "disabled" },
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = parseJsonLoose(raw);
  const lesson = (parsed?.lesson ?? raw).trim().slice(0, 2000);
  if (!lesson) return NextResponse.json({ ok: false, error: "empty_reflection" }, { status: 502 });
  const fix = (parsed?.fix ?? "").trim().slice(0, 1000) || undefined;

  // 3) пишем llm-блок в daemon (enrichment-эндпоинт, не шина)
  const wr = await fetch(`${DAEMON}/tasks/${encodeURIComponent(taskId)}/reflect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lesson, fix, model: "glm", source }),
  }).catch(() => null);
  if (!wr || !wr.ok) {
    return NextResponse.json({ ok: false, error: wr ? `daemon_write_${wr.status}` : "daemon_write_unreachable" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, id: taskId, lesson, fix, model: "glm", source });
}
