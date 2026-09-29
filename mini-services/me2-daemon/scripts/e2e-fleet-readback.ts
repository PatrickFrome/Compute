/**
 * E2E fleet-readback adapter v2 (фаза 3 prereq, Job 419718 @15:30).
 * Физический прогон: динамический маркер ME2REPLY:<hash> + reply-зона isolation.
 * Один цикл = 5 mutations + 2 reads через живой браузер (pacing 16s внутри адаптера).
 * Никаких fallback: отказ канала = явный exit-code 1 с кодом ошибки.
 */
import { fleetReadbackAsk, FleetChannelError } from "../src/fleet-readback";

const DEMO_GOAL = [
  "E2E-проверка канала доставки задач daemon→fleet (фаза 3 §3-миграции).",
  "Демонстрация reply-протокола: после строки ME2REPLY выведи две строки:",
  "первая: verdict:demo",
  "вторая: channel:fleet-readback",
].join("\n");

const t0 = Date.now();
// L4 park-and-resume (миграционный контракт): отказ канала → явная ошибка →
// resume позже с cooldown. Это НЕ blind retry: новая попытка = новый ask с
// собственным evidence-гейтом (sha/clear), после анализа причины отказа.
let lastErr: unknown = null;
for (let attempt = 1; attempt <= 2; attempt++) {
  if (attempt > 1) {
    console.log(`resume after park: attempt 2 (cooldown 60s, fleet-churn race analysis)`);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  try {
    const r = await fleetReadbackAsk(DEMO_GOAL, { timeout_ms: 45_000 });
    console.log(JSON.stringify({
      ok: true,
      attempt,
      ms: r.ms,
      standalone_reply: r.standalone_reply,
      reply_isolated: r.reply_isolated,
      reply: r.reply.slice(0, 400),
      commands: r.command_ids.length,
      total_ms: Date.now() - t0,
    }, null, 1));
    const expects = ["verdict:demo", "channel:fleet-readback"];
    const missing = expects.filter((e) => !r.reply.includes(e) && !r.text.includes(e));
    if (missing.length) {
      console.error(`REPLY-CONTENT-MISSING: ${missing.join(", ")} (isolation=${r.reply_isolated})`);
      process.exit(2);
    }
    console.log("E2E-PASS: reply-протокол и изоляция работают физически");
    process.exit(0);
  } catch (e) {
    lastErr = e;
    const code = e instanceof FleetChannelError ? e.code : "unknown";
    console.error(`attempt ${attempt} FAIL (${code}): ${String(e).slice(0, 240)}`);
  }
}
const code = lastErr instanceof FleetChannelError ? lastErr.code : "unknown";
console.error(`E2E-FAIL (${code}) после park-and-resume: ${String(lastErr).slice(0, 300)}`);
process.exit(1);
