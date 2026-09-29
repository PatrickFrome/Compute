/**
 * ME2 CHAT-SWARM v1.4.0 — colab.ts
 * Внешние GPU-узлы Google Colab (директивы оператора 2026-09-29: «подключи Google
 * Colab» + «подготовь 5 notebooks» + «сними все лимиты по времени»).
 *
 * v1.4.0: РЕЕСТР МУЛЬТИ-УЗЛОВОЙ — рой держит ДО 8 GPU-узлов одновременно
 * (5 ноутбуков оператора + запас). Каждый узел:
 *   - регистрируется POST /colab/register {url, model?, name?} (self-service из ноутбука);
 *   - зондируется фоном каждые PROBE_MS; 3 промаха подряд → узел деактивируется
 *     (рой продолжает жить на остальных — смерть одного GPU не останавливает рой);
 *   - попадает в LLM-цепочку КАК ДИНАМИЧЕСКИЙ провайдер (llm.ts): порядок
 *     определяется tier-оценкой модели узла, слабые устпают сильным.
 *
 * Как это работает (ноутбук colab/colab-node.ipynb и 5 вариантов в download/):
 *   1) Оператор запускает ноутбук в Colab: Ollama (модель варианта) + cloudflared
 *      quick-tunnel (бесплатный trycloudflare.com, без аккаунта).
 *   2) Ноутбук сам регистрирует свой tunnel-URL у роя через публичный адрес
 *      песочницы: POST {PUBLIC_BASE}/colab/register?XTransformPort=3046.
 *   3) Реестр живёт в state/colab.json (переживает рестарты роя; старый
 *      одно-узловой файл мигрируется автоматически).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { addMessage, addEvent } from "./memory";
import { tierScore } from "./tier";

const STATE_DIR = join(import.meta.dir, "..", "state");
const STATE_FILE = join(STATE_DIR, "colab.json");
const MAX_NODES = 8; // предел реестра (безопасность структуры, не лимит времени)

export interface ColabNode {
  name: string;           // уникальное имя узла (напр. "colab-qwen3-8b")
  url: string;            // публичный tunnel-URL, указывающий на Ollama :11434
  model: string;          // модель на узле (напр. qwen3:8b)
  registeredAt: string;
  lastProbeAt: string | null;
  lastProbeOk: boolean;
  failStreak: number;
  probesOk: number;
  probesErr: number;
  active: boolean;        // false = зарегистрирован, но мёртв (провайдер пропускается)
  lastEvent: string;
}

interface Registry { nodes: ColabNode[] }

let registry: Registry = load();

function load(): Registry {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      // миграция v1.2-v1.3 (одиночный узел) → v1.4 (реестр)
      if (raw && Array.isArray((raw as Registry).nodes)) return raw as Registry;
      if (raw && typeof (raw as ColabNode).url === "string") {
        const old = raw as ColabNode;
        return { nodes: [{ ...old, name: old.name || "colab-1", failStreak: old.active ? 0 : 999 }] };
      }
    }
  } catch { /* битый файл — начинаем с пустого реестра */ }
  return { nodes: [] };
}

function save() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(registry, null, 2));
  } catch { /* диск недоступен — держим состояние в памяти */ }
}

export function colabStatus(): Record<string, unknown> {
  const nodes = registry.nodes;
  return {
    registered: nodes.length > 0,
    count: nodes.length,
    activeCount: nodes.filter((n) => n.active).length,
    nodes,
  };
}

export function colabNodes(): ColabNode[] {
  return registry.nodes.filter((n) => n.active);
}

/** Совместимость v1.2-v1.3: есть ли хоть один живой узел. */
export function colabActive(): boolean { return colabNodes().length > 0; }

/** Зонд узла: GET {url}/api/tags — живая Ollama отвечает списком моделей. */
export async function probeColab(url: string, timeoutMs = 15_000): Promise<boolean> {
  const r = await fetch(`${url.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`tags_http_${r.status}`);
  const d = (await r.json()) as { models?: unknown[] };
  if (!Array.isArray(d?.models)) throw new Error("tags_bad_shape");
  return true;
}

function genName(model: string): string {
  const base = String(model || "node").toLowerCase().replace(/[^a-z0-9.:-]+/g, "-").replace(/[:.]+/g, "");
  for (let i = 1; i <= MAX_NODES; i++) {
    const cand = `colab-${base}-${i}`;
    if (!registry.nodes.some((n) => n.name === cand)) return cand;
  }
  return `colab-${Date.now() % 100000}`;
}

export interface RegisterResult { ok: boolean; detail: string; node?: ColabNode }

/** Регистрация узла: зонд обязателен — в реестр попадает только живой узел. */
export async function registerColab(rawUrl: string, model?: string, name?: string): Promise<RegisterResult> {
  const url = String(rawUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/.+/.test(url)) return { ok: false, detail: "url должен начинаться с http(s)://" };
  try {
    await probeColab(url);
    const existing = registry.nodes.find((n) => n.url === url);
    const nodeName = (name ?? "").trim().slice(0, 48) || existing?.name || genName(model ?? "node");
    const wasActive = !!existing?.active;
    const node: ColabNode = {
      name: nodeName,
      url,
      model: (model ?? "").trim() || existing?.model || "llama3.1:8b",
      registeredAt: new Date().toISOString(),
      lastProbeAt: new Date().toISOString(),
      lastProbeOk: true,
      failStreak: 0,
      probesOk: (existing?.probesOk ?? 0) + 1,
      probesErr: existing?.probesErr ?? 0,
      active: true,
      lastEvent: existing ? "re-registered" : "registered",
    };
    if (existing) registry.nodes = registry.nodes.map((n) => (n.url === url ? node : n));
    else if (registry.nodes.length >= MAX_NODES) {
      // вытесняем самый мёртвый узел (минимум зондов ок + максимум failStreak)
      const weakest = [...registry.nodes].sort((a, b) => (a.active ? 1 : 0) - (b.active ? 1 : 0) || b.failStreak - a.failStreak || a.probesOk - b.probesOk)[0];
      registry.nodes = registry.nodes.filter((n) => n !== weakest);
      addEvent("colab_evicted", { name: weakest.name });
    } else registry.nodes.push(node);
    save();
    addEvent("colab_register", { name: nodeName, url: url.slice(0, 160), model: node.model });
    addMessage({
      from_id: null, from_name: "СИСТЕМА", kind: "system", channel: "#all",
      text: `🟢 GPU-узел «${nodeName}» подключён: ${url.slice(0, 80)} (модель ${node.model}, tier ${tierScore(node.model)}). Узлов в реестре: ${registry.nodes.filter((n) => n.active).length}. Ёмкость роя увеличена.`,
    });
    return { ok: true, detail: wasActive ? "узел перерегистрирован (URL обновлён)" : `узел «${nodeName}» подключён и включён в LLM-цепочку`, node };
  } catch (e) {
    return { ok: false, detail: `узел не отвечает на /api/tags: ${String(e).slice(0, 140)}` };
  }
}

export function unregisterColab(key: string, reason: string) {
  const k = String(key ?? "").trim();
  const victim = registry.nodes.find((n) => n.name === k || n.url === k);
  if (victim) {
    registry.nodes = registry.nodes.filter((n) => n !== victim);
    save();
    addEvent("colab_unregister", { key: victim.name, reason: String(reason).slice(0, 120) });
    addMessage({
      from_id: null, from_name: "СИСТЕМА", kind: "system", channel: "#all",
      text: `⚪ GPU-узел «${victim.name}» отключён (${String(reason).slice(0, 80)}). Осталось узлов: ${registry.nodes.filter((n) => n.active).length}.`,
    });
    return { ok: true, reason: String(reason).slice(0, 120) };
  }
  return { ok: false, reason: `узел «${k.slice(0, 40)}» не найден в реестре` };
}

const PROBE_MS = 5 * 60_000;   // зонд живости каждые 5 минут
const FAIL_LIMIT = 3;          // 3 зонда подряд мимо → узел умер

/** Вечный зонд: живость КАЖДОГО узла отслеживается фоном, чтобы LLM-цепочка
 *  не тратила ни слот, ни ожидание на мёртвый узел. */
export function startColabProbeLoop() {
  setInterval(async () => {
    for (const node of registry.nodes.filter((n) => n.active)) {
      try {
        await probeColab(node.url, 15_000);
        node.lastProbeAt = new Date().toISOString();
        node.lastProbeOk = true;
        node.failStreak = 0;
        node.probesOk++;
      } catch {
        node.lastProbeAt = new Date().toISOString();
        node.lastProbeOk = false;
        node.failStreak++;
        node.probesErr++;
        if (node.failStreak >= FAIL_LIMIT) {
          node.active = false;
          node.lastEvent = "auto-disabled: node down x3 probes";
          addEvent("colab_down", { name: node.name, url: node.url.slice(0, 160) });
          addMessage({
            from_id: null, from_name: "СИСТЕМА", kind: "system", channel: "#all",
            text: `🔴 GPU-узел «${node.name}» недоступен (3 зонда подряд). Автоматически выведен из цепочки; остальные узлы продолжают работу.`,
          });
        }
      }
    }
    save();
  }, PROBE_MS);
}
