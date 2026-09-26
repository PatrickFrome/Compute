// R58: VLM-верификация операторских скриншотов (r56-mirror-live, r57-gotrue-matrix).
// Канон: z-ai-web-dev-sdk ТОЛЬКО в backend-скриптах; model не указываем (бэкенд песочницы
// сам выбирает vision-модель). Выход: r58-vlm-qa1.json — честные вердикты, факты, а не фантазии.
// Запуск: cd mini-services/me2-daemon && bun ../../research/2026/r58-vlm-qa.ts
import ZAI from "z-ai-web-dev-sdk";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const ROOT = "/home/z/my-project";
const SHOTS: Array<{ file: string; expect: string[] }> = [
  {
    file: "download/r56-mirror-live.png",
    expect: ["панель с LIVE-состоянием SQL-зеркала", "RLS-вердикт (fail-closed / anon)", "лента событий (seq)"],
  },
  {
    file: "download/r57-gotrue-matrix.png",
    expect: ["gotrue-канал или auth-строка", "RLS-матрица: anon отказ + authenticated чтение", "состояние LIVE/WARMUP"],
  },
];

async function verifyShot(zai: Awaited<ReturnType<typeof ZAI.create>>, shot: { file: string; expect: string[] }) {
  const p = `${ROOT}/${shot.file}`;
  if (!existsSync(p)) return { file: shot.file, ok: false, error: "file_missing" };
  const b64 = readFileSync(p).toString("base64");
  const prompt = [
    "Ты QA-верификатор скриншотов веб-панели (Mission Control daemon'а ME2). Отвечай СТРОГО JSON без markdown.",
    "Поля: {\"rendered\": bool, \"console_errors_visible\": bool, \"panels\": string[], \"expectations\": [{\"what\": string, \"found\": bool, \"evidence\": string}], \"mobile_issues\": string|null, \"honesty_note\": string}.",
    "Проверь: страница отрендерена (не белая), какие панели видны, и по каждой ожидаемой детали ниже — найдена ли она (с цитатой-фактом).",
    `Ожидания: ${shot.expect.map((e, i) => `${i + 1}) ${e}`).join("; ")}.`,
    "Не выдумывай: если детали не видно — found=false и честно скажи, что видно вместо неё.",
  ].join("\n");
  const r = await zai.chat.completions.create({
    messages: [{ role: "user", content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
    ] as any }],
  });
  const text = String(r.choices?.[0]?.message?.content ?? "");
  const m = text.match(/\{[\s\S]*\}/);
  let parsed: unknown = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  return { file: shot.file, ok: Boolean(parsed), raw_text_head: text.slice(0, 200), verdict: parsed };
}

async function main() {
  const zai = await ZAI.create();
  const results: unknown[] = [];
  for (const shot of SHOTS) {
    try { results.push(await verifyShot(zai, shot)); }
    catch (e) { results.push({ file: shot.file, ok: false, error: String(e).slice(0, 300) }); }
  }
  const out = { schema: "me2.vlm-qa.v1", round: "R58", ran_at: new Date().toISOString(), shots: results };
  writeFileSync(`${ROOT}/research/2026/r58-vlm-qa1.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.shots.map((s: any) => ({ file: s.file, ok: s.ok, error: s.error ?? undefined })), null, 2));
  console.log("written: research/2026/r58-vlm-qa1.json");
}
main().catch((e) => { console.error("VLM-QA failed:", String(e).slice(0, 300)); process.exit(1); });
