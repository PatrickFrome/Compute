/**
 * ME2 H2 (R44) — policy-файл T0/T1/T2: ЯВНАЯ доверительная модель флота.
 *
 * Роадмап R38 §5 требовал: политика — не разрозненные if'ы в коде, а ФАЙЛ,
 * который оператор видит и правит; каждое решение — с ledger-полями в hash-chain.
 *
 * Ярусы:
 *   T0 = оператор (REST-семейства, человек за консолью) — полный авторитет (tools:"*").
 *   T1 = супервизоры флота (role=SUPERVISOR) — вся chat-плоскость: create_chat,
 *        set_objective (в т.ч. чужие), schedule_cron, все инструменты хода.
 *   T2 = рабочие чаты (CHAT/CODE/RESEARCH/DEBUG) — рабочие инструменты, эластичное
 *        create_chat (потолок CHAT_CEILING как был), но НЕ чужие цели и НЕ admin.
 *
 * Принцип ЧЕСТНОСТИ: дефолты файла повторяют фактическое поведение системы до R44
 * (никаких скрытых ужесточений) + НОВЫЕ гейты новых инструментов (cron-капы).
 * Запреты не молчат: каждое POLICY_DENIED — событие в hash-chain (ledger-поля:
 * tier, subject, tool, reason, verdict="deny") — супервизор и оператор видят.
 *
 * REST: GET /policy (эффективная политика + счётчики), POST /policy {op:"reload"}.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, emit, nowIso } from "../store";

export type Tier = "T0" | "T1" | "T2";

export interface TierPolicy {
  who: string;               // человеко-читаемое описание яруса
  tools: string[];           // допустимые инструменты ("*" = все)
  schedule: boolean;         // может ставить cron-задания из чатов (G7)
  objective_any: boolean;    // может назначать цели ДРУГИМ чатам (свои — всегда)
  admin: boolean;            // админ-плоскость (close/delete чужих сессий, конфиги)
}

export interface PolicyFile {
  version: number;
  tiers: Record<Tier, TierPolicy>;
  caps: {
    crons_per_chat: number;  // G7: активных cron-заданий на один чат
    crons_global: number;    // G7: глобальный потолок активных cron-заданий
    cron_min_minutes: number; // G7: минимальный интервал every-задания (анти-шторм)
  };
  classifier: ClassifierPolicy; // R63 P0-b: тир-3 классификатор пре-исполнения (/review)
  sandbox: SandboxPolicy;       // R64 P0-2: OS-сандбокс (/sandbox) — sec.sandbox-config как данные
}

export interface ClassifierPolicy {
  enabled: boolean;        // тир-3 включён (false → команды идут без классификации, честно "off")
  llm_enabled: boolean;    // LLM-путь (агентная модель, <=timeout_ms; таймаут → ask)
  timeout_ms: number;      // потолок LLM-вызова классификатора
  queue_max: number;       // потолок pending-очереди одобрений (переполнение → block, fail-closed)
  model: string;           // модель LLM-классификатора (канон Cursor: малая модель)
}

export interface SandboxPolicy {
  // R64 P0-2 (sec.sandbox-config — «конфигурация как данные», канон Cursor):
  auto_sandbox: boolean;   // классификатор выдаёт вердикт «sandbox» на fs-риски (tier-2 реален); false → ask (R63-поведение)
  net: "deny" | "allow";   // режим сети сандбокса (canon: default-deny + allowlist; доменный allowlist = P1)
  extra_hide: string[];    // дополнительные каталоги под tmpfs-RO (сверх /home/z/.a2)
  strict: boolean;         // strict fail-closed: обязательные слои не применились → команда НЕ исполняется
  tmp_size: string;        // размер приватного tmpfs /tmp (перезатирает общий)
}

const POLICY_PATH = join(import.meta.dir, "..", "policy.json");

const DEFAULTS: PolicyFile = {
  version: 1,
  tiers: {
    T0: { who: "оператор (человек за консолью, REST-семейства)", tools: ["*"], schedule: true, objective_any: true, admin: true },
    T1: {
      who: "супервизоры флота (role=SUPERVISOR)",
      tools: ["list_dir", "read_file", "write_file", "shell", "web_search", "daemon_status", "create_task", "list_chats", "chat_send", "create_chat", "set_objective", "schedule_cron", "list_crons", "cancel_cron", "report_outcome", "reply"],
      schedule: true, objective_any: true, admin: false,
    },
    T2: {
      who: "рабочие чаты (CHAT/CODE/RESEARCH/DEBUG)",
      tools: ["list_dir", "read_file", "write_file", "shell", "web_search", "daemon_status", "create_task", "list_chats", "chat_send", "create_chat", "set_objective", "schedule_cron", "list_crons", "cancel_cron", "report_outcome", "reply"],
      schedule: true, objective_any: false, admin: false,
    },
  },
  caps: { crons_per_chat: 8, crons_global: 48, cron_min_minutes: 5 },
  classifier: { enabled: true, llm_enabled: false, timeout_ms: 3000, queue_max: 20, model: "zai" },
  sandbox: { auto_sandbox: false, net: "deny", extra_hide: [], strict: true, tmp_size: "64m" },
};

let cache: PolicyFile | null = null;
let loadError: string | null = null;

export function loadPolicy(force = false): PolicyFile {
  if (cache && !force) return cache;
  try {
    const raw = JSON.parse(readFileSync(POLICY_PATH, "utf8")) as PolicyFile;
    // валидация: все три яруса присутствуют, caps — положительные числа
    for (const t of ["T0", "T1", "T2"] as Tier[]) {
      if (!raw.tiers?.[t]?.tools) throw new Error(`tier ${t} отсутствует или пуст`);
    }
    raw.caps = { ...DEFAULTS.caps, ...(raw.caps ?? {}) };
    raw.classifier = { ...DEFAULTS.classifier, ...(raw.classifier ?? {}) };
    raw.sandbox = { ...DEFAULTS.sandbox, ...(raw.sandbox ?? {}) };
    cache = raw;
    loadError = null;
  } catch (e) {
    // ФАЙЛ БИТ/ОТСУТСТВУЕТ → дефолты (система не должна умирать от политики),
    // но loadError честно показывается в /policy и пишется один раз в chain.
    const msg = e instanceof Error ? e.message : String(e);
    if (loadError !== msg) {
      loadError = msg;
      try { emit("POLICY_LOAD_ERROR", { error: msg.slice(0, 160), fallback: "defaults" }, null, null); } catch { /* chain не критичен */ }
    }
    cache = JSON.parse(JSON.stringify(DEFAULTS)) as PolicyFile;
    cache.classifier = { ...DEFAULTS.classifier };
    cache.sandbox = { ...DEFAULTS.sandbox };
  }
  return cache;
}

export function policyReload(): PolicyFile {
  return loadPolicy(true);
}

/** Ярус субъекта по роли флота. SUPERVISOR→T1, рабочие роли→T2, оператор (REST) → T0. */
export function tierForRole(role: string): Tier {
  if (role === "SUPERVISOR") return "T1";
  return "T2";
}

export interface PolicyVerdict {
  ok: boolean;
  tier: Tier;
  reason: string;
}

/** Проверка инструмента без ledger (чистый предикат). */
export function policyAllows(tier: Tier, tool: string): boolean {
  const p = loadPolicy();
  const tp = p.tiers[tier];
  if (!tp) return false;
  if (tp.tools.includes("*")) return true;
  return tp.tools.includes(tool);
}

/**
 * Гейт с ledger: запрет НЕ молчит — POLICY_DENIED в hash-chain с ledger-полями
 * (tier, subject, tool, reason) + счётчики для /policy.
 */
export function policyCheckTool(tier: Tier, tool: string, subject: string): PolicyVerdict {
  const ok = policyAllows(tier, tool);
  if (ok) return { ok: true, tier, reason: "allowed" };
  const p = loadPolicy();
  const reason = `policy_denied: инструмент «${tool}» не входит в ярус ${tier} (${p.tiers[tier]?.who ?? "?"}); policy.json v${p.version}`;
  denyCounters.denied++;
  denyCounters.by_tier[tier] = (denyCounters.by_tier[tier] ?? 0) + 1;
  lastDenials.unshift({ at: nowIso(), tier, tool, subject, reason });
  if (lastDenials.length > 20) lastDenials.length = 20;
  try { emit("POLICY_DENIED", { tier, subject: subject.slice(0, 64), tool, reason, verdict: "deny", policy_version: p.version }, subject.startsWith("ac_") ? null : subject, null); } catch { /* chain не критичен */ }
  return { ok: false, tier, reason };
}

const denyCounters = { denied: 0, by_tier: {} as Record<string, number> };
const lastDenials: Array<{ at: string; tier: string; tool: string; subject: string; reason: string }> = [];

export function policyStatus(): {
  ok: true;
  policy: PolicyFile;
  source: string;
  load_error: string | null;
  counters: { denied: number; by_tier: Record<string, number> };
  last_denials: Array<{ at: string; tier: string; tool: string; subject: string; reason: string }>;
  events: number;
} {
  const ev = db.query(`SELECT COUNT(*) AS n FROM events WHERE type='POLICY_DENIED'`).get() as { n: number };
  return {
    ok: true,
    policy: loadPolicy(),
    source: POLICY_PATH,
    load_error: loadError,
    counters: denyCounters,
    last_denials: lastDenials,
    events: Number(ev?.n ?? 0),
  };
}

/** Капы для G7 (cron) — из файла, с дефолтами. */
export function policyCaps(): PolicyFile["caps"] {
  return loadPolicy().caps;
}
