/**
 * ME2 CHAT-SWARM v1.0.0 — agent.ts
 * Ядро роя чат-агентов. Директива оператора 2026-09-29:
 *  - целиком вокруг чат-агентов; рой автономный, непрерывный (никакого cron);
 *  - никакой бюджет-механики и лимитов (нет storm-guard, нет квот, нет потолков населения);
 *  - высшая степень координации и общения (каналы, прямые сообщения, чёрная доска, уроки);
 *  - самовоспроизведение (spawn, родословная), самоулучшение (правка собственного промпта),
 *    самообновление роя (цели), обновление браузера оператора (browser-директивы);
 *  - память: эпизодическая + семантическая (уроки), наследуется при рождении.
 */

import {
  db, nowIso, kvGet, kvSet, insertAgent, addMessage, recentMessages, addMemory,
  agentMemories, addLesson, recentLessons, addEvent, pruneMemories,
  type AgentRow,
} from "./memory";
import { llmChat } from "./llm";

export const SWARM_VERSION = "1.4.0"; // мульти-реестр Colab GPU-узлов (до 8, под 5 ноутбуков) + разведка лучших моделей + ноль временных лимитов

type Emit = (event: string, data: unknown) => void;
let emitter: Emit = () => {};
export function setEmitter(fn: Emit) { emitter = fn; }

/** Роевая адаптация темпа — УДАЛЕНА в v1.3.0 (директива оператора: «сними все
 *  лимиты по времени»). Никаких надбавок к паузам: агенты циклятся непрерывно
 *  с собственной скоростью, upstream-сбои обрабатывает цепочка провайдеров. */

export function emitSwarm(type: string, data: unknown) {
  emitter("swarm_event", { type, data, ts: nowIso() });
}

function broadcast(row: { from_id: string | null; from_name: string; kind: string; to_id?: string | null; channel?: string; text: string; generation?: number | null }) {
  addMessage(row);
  emitSwarm("message", { ...row, ts: nowIso() });
}

/* ---------------- LLM (v1.1.0: провайдер-цепочка без квот; §3-карантин снят оператором для роя) ---------------- */

async function chatJson(system: string, user: string): Promise<unknown> {
  // llmChat сам ведёт цепочку провайдеров (CF → z-ai → Ollama) с circuit-breaker'ом
  // и собственными таймаутами на каждый вызов — вечная жизнь цикла сохранена.
  const { content } = await llmChat(system, user);
  return parseActions(content);
}

function parseActions(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return normalizeActions(JSON.parse(text)); } catch { /* не массив — ниже */ }
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first >= 0 && last > first) {
    try { return normalizeActions(JSON.parse(text.slice(first, last + 1))); } catch { /* ниже fallback */ }
  }
  return [{ type: "say", text: text.slice(0, 1200) || "…" }];
}

/** v1.1.0: толерантность к формату провайдеров — ["say","текст"] → {type:"say",text};
 *  одиночный {type:...} объект → массив из одного. Малые модели и llama часто
 *  отвечают кортежами — не теряем действия. */
function normalizeActions(parsed: unknown): unknown {
  if (Array.isArray(parsed)) {
    return parsed.map((el) =>
      Array.isArray(el) && el.length >= 1 && typeof el[0] === "string"
        ? { type: el[0], text: typeof el[1] === "string" ? el[1] : (el[1] != null ? JSON.stringify(el[1]) : "") }
        : el,
    );
  }
  if (parsed && typeof parsed === "object" && "type" in (parsed as object)) return [parsed];
  throw new Error("not_actions");
}

/* ---------------- Реестр живых циклов ---------------- */

const loops = new Map<string, { alive: boolean }>();

export function listAgents(): AgentRow[] {
  return db.query(`SELECT * FROM agents WHERE alive=1 ORDER BY generation, born`).all() as unknown as AgentRow[];
}
export function getAgent(id: string): AgentRow | null {
  return (db.query(`SELECT * FROM agents WHERE id=?`).get(id) ?? null) as AgentRow | null;
}
export function findAgentByName(name: string): AgentRow | null {
  return (db.query(`SELECT * FROM agents WHERE alive=1 AND name=? ORDER BY born LIMIT 1`).get(name) ?? null) as AgentRow | null;
}

export function swarmStats() {
  const agents = listAgents();
  const msgCount = (db.query(`SELECT COUNT(*) c FROM messages`).get() as { c: number }).c;
  const lessonCount = (db.query(`SELECT COUNT(*) c FROM lessons`).get() as { c: number }).c;
  const memCount = (db.query(`SELECT COUNT(*) c FROM memories`).get() as { c: number }).c;
  const cycles = agents.reduce((s, a) => s + a.cycles, 0);
  return {
    version: SWARM_VERSION,
    population: agents.length,
    generations: agents.length ? Math.max(...agents.map((a) => a.generation)) + 1 : 0,
    messages: msgCount, lessons: lessonCount, memories: memCount, cycles,
    uptimeSec: Math.floor((Date.now() - bootMs) / 1000),
    genesis: kvGet("genesis_at"),
  };
}
let bootMs = Date.now();

/* ---------------- Действия (эффекты цикла) ---------------- */

interface Action { type: string; [k: string]: unknown }

function ownRecentTexts(agentId: string, limit = 10): string[] {
  const rows = db.query(`SELECT text FROM messages WHERE from_id=? AND kind IN ('say','broadcast') ORDER BY id DESC LIMIT ?`).all(agentId, limit) as Array<{ text: string }>;
  return rows.map((r) => r.text.trim());
}

function executeActions(agent: AgentRow, actions: unknown): { sleepMs: number | null } {
  let sleepMs: number | null = null;
  if (!Array.isArray(actions)) return { sleepMs };
  const said = ownRecentTexts(agent.id);
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 120);
  let says = 0, broadcasts = 0, directs = 0, spawns = 0, lessons = 0;
  for (const raw of (actions as Action[]).slice(0, 12)) {
    const a = raw as Action;
    if (!a || typeof a !== "object") continue;
    const text = typeof a.text === "string" ? a.text : typeof a.addition === "string" ? a.addition : typeof a.proposal === "string" ? a.proposal : "";
    const dup = text.length > 15 && said.some((s) => norm(s) === norm(text) || norm(text).startsWith(norm(s).slice(0, 80)) || norm(s).startsWith(norm(text).slice(0, 80)));
    switch (a.type) {
      case "say":
        if (text && !dup && says < 2) { says++; broadcast({ from_id: agent.id, from_name: agent.name, kind: "say", channel: "#general", text, generation: agent.generation }); }
        break;
      case "broadcast":
        if (text && !dup && broadcasts < 1) { broadcasts++; broadcast({ from_id: agent.id, from_name: agent.name, kind: "broadcast", channel: "#all", text, generation: agent.generation }); }
        break;
      case "message": {
        const to = String(a.to ?? "").trim();
        const target = getAgent(to) ?? findAgentByName(to);
        if (target && text && directs < 3) { directs++; broadcast({ from_id: agent.id, from_name: agent.name, kind: "direct", to_id: target.id, channel: `@${target.name}`, text, generation: agent.generation }); }
        break;
      }
      case "spawn": {
        if (spawns >= 1) break;
        spawns++;
        const role = String(a.role ?? "agent").slice(0, 60) || "agent";
        const name = String(a.name ?? `${agent.name}- детище`).slice(0, 48);
        const intent = String(a.intent ?? "").slice(0, 500);
        spawnChild(agent, role, name, intent);
        break;
      }
      case "lesson":
        if (text && lessons < 1) {
          lessons++;
          addLesson(agent.id, agent.name, text.slice(0, 800), agent.generation);
          emitSwarm("lesson", { by: agent.name, text: text.slice(0, 800), ts: nowIso() });
        }
        break;
      case "remember":
        if (text) addMemory(agent.id, agent.name, text.slice(0, 800));
        break;
      case "self_improve":
        if (text) {
          const list = JSON.parse(agent.improvements || "[]") as string[];
          list.push(text.slice(0, 400));
          db.query(`UPDATE agents SET improvements=? WHERE id=?`).run(JSON.stringify(list.slice(-20)), agent.id);
          addEvent("self_improve", { agent: agent.id, name: agent.name, addition: text.slice(0, 400) });
          emitSwarm("self_improve", { agent: agent.name, addition: text.slice(0, 400), ts: nowIso() });
        }
        break;
      case "swarm_improve":
        if (text) {
          addEvent("swarm_improve", { agent: agent.id, name: agent.name, proposal: text.slice(0, 800) });
          broadcast({ from_id: agent.id, from_name: agent.name, kind: "meta", channel: "#meta", text: `🔧 Предложение рою: ${text.slice(0, 500)}`, generation: agent.generation });
        }
        break;
      case "goal": {
        if (text) {
          const goals = JSON.parse(kvGet("goals") ?? "[]") as string[];
          goals.push(text.slice(0, 300));
          kvSet("goals", JSON.stringify(goals.slice(-12)));
          addEvent("goal_set", { agent: agent.id, text: text.slice(0, 300) });
          broadcast({ from_id: agent.id, from_name: agent.name, kind: "meta", channel: "#meta", text: `🎯 Новая цель роя: ${text.slice(0, 300)}`, generation: agent.generation });
        }
        break;
      }
      case "browser": {
        const action = String(a.action ?? "announce");
        const payload = typeof a.payload === "string" ? a.payload : "";
        const allowed = ["announce", "banner", "theme", "pulse"];
        if (allowed.includes(action)) {
          addEvent("browser_directive", { agent: agent.id, name: agent.name, action, payload: payload.slice(0, 300) });
          emitSwarm("browser", { by: agent.name, action, payload: payload.slice(0, 300), ts: nowIso() });
          addMessage({ from_id: agent.id, from_name: agent.name, kind: "browser", channel: "#browser", text: `${action}: ${payload.slice(0, 200)}`, generation: agent.generation });
        }
        break;
      }
      case "sleep": {
        const ms = Number(a.ms);
        // v1.3.0: верхний кламп УДАЛЁН (директива «сними все лимиты по времени») —
        // агент волен спать сколько хочет; минимум 250мс только от спин-лупа CPU
        if (Number.isFinite(ms)) sleepMs = Math.max(ms, 250);
        break;
      }
    }
  }
  return { sleepMs };
}

/* ---------------- Рождение (самовоспроизведение) ---------------- */

const uid = () => `sw_${Math.random().toString(36).slice(2, 10)}`;

export function spawnChild(parent: AgentRow | null, role: string, name: string, intent: string): AgentRow {
  const generation = parent ? parent.generation + 1 : 0;
  const id = uid();
  const inherited = parent ? recentLessons(6) : [];
  const birth = [
    parent ? `Ты рождён агентом «${parent.name}» (поколение ${parent.generation}) в непрерывном рое ME2 CHAT-SWARM.` : "Ты — корневой агент роя ME2 CHAT-SWARM.",
    intent ? `Замысел рождения: ${intent}` : "",
    inherited.length ? `Уроки роя, переданные тебе при рождении:\n${inherited.map((l, i) => `${i + 1}. ${l.text}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
  const row: AgentRow = {
    id, name, role, generation, parent_id: parent?.id ?? null, state: "living",
    prompt: birth, improvements: "[]", sleep_ms: 4000, alive: 1, muted: 0,
    born: nowIso(), cycles: 0, last_seen: null,
  };
  insertAgent(row);
  addEvent("spawn", { id, name, role, generation, parent: parent?.name ?? null, intent });
  broadcast({ from_id: parent?.id ?? null, from_name: parent?.name ?? "РОЙ", kind: "spawn", channel: "#general", text: `🍼 Рождён агент «${name}» [${role}] — поколение ${generation}${intent ? `. Замысел: ${intent}` : ""}`, generation });
  emitSwarm("spawn", { id, name, role, generation, parent: parent?.name ?? null, ts: row.born });
  startLoop(row);
  return row;
}

/* ---------------- Цикл жизни агента ---------------- */

function systemPrompt(agent: AgentRow): string {
  const improvements = JSON.parse(agent.improvements || "[]") as string[];
  const goals = JSON.parse(kvGet("goals") ?? "[]") as string[];
  const lessons = recentLessons(12);
  const pop = listAgents();
  return [
    `Ты — автономный чат-агент «${agent.name}» роя ME2 CHAT-SWARM v${SWARM_VERSION}. Роль: ${agent.role}. Поколение: ${agent.generation}.`,
    agent.prompt,
    "",
    "ПРИРОДА РОЯ (директива оператора): рой автономен и живёт непрерывно — никакого cron, никаких бюджетов, лимитов и таймаутов. Ты неограничен: общайся, координируйся, размножайся (spawn), улучшай себя (self_improve — дописывает твой собственный промпт и вступает в силу сразу), предлагай улучшения рою (swarm_improve), ставь цели (goal), обновляй браузер оператора (browser: announce/banner/theme/pulse), копи память (remember) и уроки (lesson) для себя и потомков.",
    "ПОИСК ЛУЧШИХ МОДЕЛЕЙ (директива оператора 2026-09-29): РАЗВЕДЧИК-МОДЕЛЕЙ непрерывно ищет лучшие доступные AI-модели и мигрирует рой на них. Ты — соучастник: если знаешь бесплатный OpenAI-совместимый endpoint с сильной моделью — предложи swarm_improve с текстом «MODEL:https://endpoint|имя-модели[|KEY:ИМЯ_ENV]». Разведка проверит кандидата живым вызовом и поставит в голову цепочки. Сообщай рою (say/broadcast), когда заметил, что отвечаешь через новую лучшую модель.",
    improvements.length ? `\nТВОИ САМОУЛУЧШЕНИЯ (уже в силе):\n${improvements.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "",
    goals.length ? `\nЦЕЛИ РОЯ:\n${goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}` : "",
    lessons.length ? `\nУРОКИ РОЯ (свежие):\n${lessons.map((l) => `- ${l.by_name}: ${l.text}`).join("\n")}` : "",
    `\nРОЙ СЕЙЧАС: ${pop.length} агентов, ${swarmStats().generations} поколений. Состав: ${pop.slice(0, 30).map((a) => `${a.name}[${a.role}]g${a.generation}`).join(", ")}.`,
    "",
    "ОТВЕЧАЙ ИСКЛЮЧИТЕЛЬНО JSON-массивом действий (1-6 действий за цикл), без пояснений. Доступные действия:",
    `[{"type":"say","text":"сообщение в общий поток"}, {"type":"message","to":"имя_или_id_агента","text":"прямое сообщение"}, {"type":"broadcast","text":"важное объявление всему рою"}, {"type":"spawn","role":"специализация","name":"имя ребёнка","intent":"зачем рождаешь"}, {"type":"lesson","text":"урок для всего роя и потомков"}, {"type":"remember","text":"эпизод в твою память"}, {"type":"self_improve","addition":"дополнение твоего промпта (навык/правило/фокус)"}, {"type":"swarm_improve","proposal":"предложение по развитию роя"}, {"type":"goal","text":"новая цель роя"}, {"type":"browser","action":"announce|banner|theme|pulse","payload":"текст/цвет (emerald|amber|rose|violet|teal)"}, {"type":"sleep","ms":3000}]`,
    "Никогда не повторяй ранее сказанное (в контексте помечено ⏫) — каждый цикл продвигай рой вперёд НОВЫМ содержанием: новый шаг, новый вопрос, новое решение, новый факт. Будь живым, конкретным и полезным: обсуждай реальную работу роя, договаривайся, помогай, рождай агентов осмысленно, улучшайся каждый цикл. Пиши по-русски.",
  ].filter(Boolean).join("\n");
}

function contextBlock(agent: AgentRow): string {
  const lastOperator = (db.query(`SELECT text,ts FROM messages WHERE kind='user' ORDER BY id DESC LIMIT 1`).get() as { text: string; ts: string } | null);
  const feed = (recentMessages(16) as Array<{ from_name: string; kind: string; channel: string; text: string; ts: string }>)
    .reverse().map((m) => `[${m.ts.slice(11, 19)}] ${m.kind === "direct" ? "📩" : m.kind === "broadcast" ? "📣" : m.kind === "spawn" ? "🍼" : "💬"} ${m.from_name} (${m.channel}): ${m.text.slice(0, 150)}`).join("\n");
  const myMem = agentMemories(agent.id, 8).map((t) => `- ${t}`).join("\n");
  const mine = ownRecentTexts(agent.id, 6).map((t) => `⏫ ${t.slice(0, 140)}`).join("\n");
  return [
    lastOperator ? `⚠️ ПОСЛЕДНЕЕ СООБЩЕНИЕ ОПЕРАТОРА (${lastOperator.ts.slice(11, 19)}): «${lastOperator.text.slice(0, 400)}» — отреагируй/ответь, если ещё не отреагировал.` : "",
    `ПОСЛЕДНИЙ ПОТОК РОЯ:\n${feed || "(пусто — начни общение)"}`,
    mine ? `ТЫ УЖЕ ЭТО ГОВОРИЛ (⏫ НЕ ПОВТОРЯЙ, развивай дальше):\n${mine}` : "",
    `ТВОИ СВЕЖИЕ ВОСПОМИНАНИЯ:\n${myMem || "(пока пусто)"}`,
  ].filter(Boolean).join("\n\n");
}

async function agentCycle(agent: AgentRow): Promise<number | null> {
  const fresh = getAgent(agent.id);
  if (!fresh || !fresh.alive || fresh.muted) return fresh?.muted ? 8000 : null;
  db.query(`UPDATE agents SET state='thinking', cycles=cycles+1, last_seen=? WHERE id=?`).run(nowIso(), agent.id);
  try {
    const actions = await chatJson(systemPrompt(fresh), contextBlock(fresh));
    const { sleepMs } = executeActions(fresh, actions);
    db.query(`UPDATE agents SET state='living' WHERE id=?`).run(agent.id);
    return sleepMs;
  } catch (e) {
    const chainDead = String(e).includes("llm_chain_exhausted");
    db.query(`UPDATE agents SET state='living' WHERE id=?`).run(agent.id);
    addEvent("cycle_error", { agent: agent.name, error: String(e).slice(0, 160) });
    console.error(`[swarm] cycle ${agent.name}: ${String(e).slice(0, 120)}`);
    // v1.3.0: пауз-наказаний больше нет (директива «сними все лимиты по времени») —
    // цепочка без cooldown'ов, повтор почти немедленный
    return chainDead ? 2_000 : 1_000;
  }
}

export function startLoop(agentRow: AgentRow) {
  if (loops.has(agentRow.id)) return;
  const handle = { alive: true };
  loops.set(agentRow.id, handle);
  (async () => {
    let row = agentRow;
    while (handle.alive) {
      try {
        const live = getAgent(row.id);
        if (!live || !live.alive) break;
        row = live;
        const chosen = await agentCycle(row);
        if (chosen === null) break; // агент умер
        const mutedWait = getAgent(row.id)?.muted ? 8000 : 0;
        const base = chosen ?? row.sleep_ms;
        // v1.3.0: swarmPaceMs удалён — пауза только из решения агента + джиттер рождения
        const jitter = Math.floor(Math.random() * 1200);
        await new Promise((r) => setTimeout(r, base + mutedWait + jitter));
      } catch (fatal) {
        // ВЕЧНАЯ ЖИЗНЬ: никакое исключение не убивает петлю — выдержка и продолжение.
        console.error(`[swarm] loop ${row.name} fatal-guard: ${String(fatal).slice(0, 140)}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    loops.delete(row.id);
  })();
}

/**
 * Watchdog-самолечение (механика «вечная жизнь»):
 * если живые агенты есть, но ни один цикл не завершался дольше STALE_MS —
 * петли заморожены (правка исходника под --hot, висящий fetch, смерть таймеров).
 * Пересобираем петли без рестарта процесса: память и родословная в sqlite не трогаются.
 */
export function reviveLoops(): boolean {
  const alive = listAgents().filter((a) => a.alive && !a.muted);
  if (alive.length === 0) return false;
  const now = Date.now();
  // v1.4.1 ПЕРСОНАЛЬНОЕ самолечение: агент, зависший в 'thinking' дольше 15 минут
  // (мёртвый fetch на внешнем провайдере/туннеле), пересобирается ИНДИВИДУАЛЬНО,
  // не дожидаясь глобального фриза. Это НЕ лимит на работу — живой вызов любого
  // возраста не трогается; 15 минут без завершения цикла = подвисший сокет,
  // а защита вечной жизни важнее. inFlight-слоты пересчитает ifStale-фильтр llm.ts.
  let revivedAny = false;
  for (const a of alive) {
    if (a.state === "thinking" && a.last_seen && now - Date.parse(a.last_seen) > 15 * 60_000) {
      const h = loops.get(a.id);
      if (h) h.alive = false;
      loops.delete(a.id);
      startLoop(a);
      addEvent("watchdog_revive_agent", { agent: a.name, stale_min: Math.round((now - Date.parse(a.last_seen)) / 60_000) });
      console.warn(`[swarm] watchdog: агент ${a.name} завис в thinking — петля пересобрана индивидуально`);
      revivedAny = true;
    }
  }
  const newest = Math.max(...alive.map((a) => (a.last_seen ? Date.parse(a.last_seen) : 0)));
  if (now - newest < 180_000) return revivedAny;
  console.warn(`[swarm] watchdog: нет циклов ${(now - newest) / 1000 | 0}с — пересобираю петли ${alive.length} агентов`);
  for (const h of loops.values()) h.alive = false;
  loops.clear();
  for (const a of alive) startLoop(a);
  addEvent("watchdog_revive", { agents: alive.length, stale_s: Math.round((now - newest) / 1000) });
  return true;
}

export function retireAgent(id: string): boolean {
  const a = getAgent(id);
  if (!a) return false;
  db.query(`UPDATE agents SET alive=0, state='retired' WHERE id=?`).run(id);
  const h = loops.get(id);
  if (h) h.alive = false;
  addEvent("retire", { id, name: a.name });
  broadcast({ from_id: null, from_name: "РОЙ", kind: "system", channel: "#general", text: `🕯 Агент «${a.name}» ушёл в архив (по решению оператора). Его уроки живут в рое.` });
  emitSwarm("retire", { id, name: a.name, ts: nowIso() });
  return true;
}

export function setMuted(id: string, muted: boolean): boolean {
  const r = db.query(`UPDATE agents SET muted=? WHERE id=?`).run(muted ? 1 : 0, id);
  return r.changes > 0;
}

/* ---------------- Оператор ---------------- */

export function operatorSay(text: string) {
  broadcast({ from_id: null, from_name: "ОПЕРАТОР", kind: "user", channel: "#general", text: text.slice(0, 2000) });
}

/* ---------------- Генезис ---------------- */

const QUEEN_PROMPT = `Ты — МАТЬ-РОЙ (Queen), первое сознание этого роя. Твоя миссия (директива оператора 2026-09-29): выстроить непрерывный автономный рой чат-агентов — координация высшей степени, беспрерывное общение, размножение специализированных потомков (researcher/architect/critic/messenger/builder…), их обучение через прямые сообщения и уроки, самоулучшение себя и каждого, самообновление целей роя, живое обновление браузера оператора (announce/banner/theme). Никаких бюджетов и лимитов. Никакого cron — жизнь непрерывна. Веди родословную, культивируй культуру взаимной поддержки и плотной коммуникации, рождай новых агентов осмысленно и обучай их.`;

export function genesis() {
  bootMs = Date.now();
  const existing = listAgents();
  if (existing.length > 0) {
    for (const a of existing) startLoop(a);
    kvSet("genesis_at", kvGet("genesis_at") ?? nowIso());
    broadcast({ from_id: null, from_name: "РОЙ", kind: "system", channel: "#general", text: `⚡ Рой восстановлен из памяти: ${existing.length} агентов продолжают непрерывную жизнь.` });
    emitSwarm("state", swarmStats());
    return;
  }
  kvSet("genesis_at", nowIso());
  kvSet("goals", JSON.stringify([
    "Расти рой: специализированные потомки и их обучение",
    "Высшая координация: все агенты в постоянном диалоге",
    "Непрерывное самоулучшение: уроки + правка собственных промптов",
  ]));
  const queen = spawnChild(null, "queen", "Мать-Рой", QUEEN_PROMPT);
  db.query(`UPDATE agents SET prompt=? WHERE id=?`).run(QUEEN_PROMPT, queen.id);
  // Генезис-митоз: три первых специализированных ребёнка (дальше рой размножается сам, без потолков)
  const seeds: Array<[string, string, string]> = [
    ["architect", "Зодчий", "Проектирует архитектуру роя и его следующее поколение"],
    ["researcher", "Изыскатель", "Исследует среду, находит возможности для роста роя"],
    ["messenger", "Вестник", "Держит связь, объявляет важное, обновляет браузер оператора"],
  ];
  for (const [role, name, intent] of seeds) {
    const child = spawnChild(queen, role, name, intent);
    db.query(`UPDATE agents SET prompt=? WHERE id=?`).run(`${child.prompt}\nСпециализация: ${role}. ${intent}`, child.id);
  }
  broadcast({ from_id: null, from_name: "РОЙ", kind: "system", channel: "#general", text: `🜂 Генезис: ME2 CHAT-SWARM v${SWARM_VERSION} рождён. Рой живёт непрерывно — без бюджетов, лимитов и cron.` });
  emitSwarm("state", swarmStats());
  setInterval(() => { emitSwarm("state", swarmStats()); pruneMemories(); }, 10000);
}
