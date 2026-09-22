/**
 * bootstrap.ts — training context composer for fleet agents.
 * Builds role-specific bootstrap prompts that carry:
 *   - mission + duties
 *   - coordination protocol (DevOS fleet DB plane)
 *   - credentials (Supabase REST, GitHub) from the operator vault
 *   - safety rules
 * Server-side only; the vault file never leaves the process.
 */
import fs from "node:fs";

const VAULT = "/home/z/.a2/agent-factory-secrets.env";

export interface Vault {
  supabaseUrl: string;
  supabaseJwt: string;
  jwtSecret: string;
  githubToken: string;
  githubRepo: string;
  workspaceId: string;
}

let cachedVault: Vault | null = null;

export function loadVault(): Vault {
  if (cachedVault) return cachedVault;
  const raw = fs.readFileSync(VAULT, "utf8");
  const get = (k: string) => {
    const m = raw.match(new RegExp(`^\\s*export\\s+${k}\\s*=\\s*"(.*)"\\s*$`, "m"));
    if (!m) throw new Error(`vault key missing: ${k}`);
    return m[1];
  };
  cachedVault = {
    supabaseUrl: get("AGENT_FACTORY_SUPABASE_URL"),
    supabaseJwt: get("AGENT_FACTORY_SUPABASE_SERVICE_ROLE_JWT"),
    jwtSecret: get("AGENT_FACTORY_SUPABASE_JWT_SECRET"),
    githubToken: get("AGENT_FACTORY_GITHUB_TOKEN"),
    githubRepo: get("AGENT_FACTORY_GITHUB_REPO"),
    workspaceId: get("AGENT_FACTORY_WORKSPACE_ID"),
  };
  return cachedVault;
}

export function redactedInventory(): { key: string; hint: string }[] {
  const v = loadVault();
  return [
    { key: "SUPABASE_URL", hint: v.supabaseUrl },
    { key: "SUPABASE_SERVICE_ROLE_JWT", hint: `***${v.supabaseJwt.slice(-8)} (exp 2036)` },
    { key: "SUPABASE_JWT_SECRET", hint: `***${v.jwtSecret.slice(-6)} (HS256, для подписи своих JWT)` },
    { key: "GITHUB_TOKEN", hint: `***${v.githubToken.slice(-6)} (admin:${v.githubRepo})` },
    { key: "WORKSPACE_ID", hint: v.workspaceId },
  ];
}

export interface RoleMission {
  duties: string;
  kpi: string;
}

export const ROLE_MISSIONS: Record<string, RoleMission> = {
  PLANNER: {
    duties:
      "Разбиваешь цели на атомарные шаги с критериями приёмки; ведёшь roadmap-приоритеты; декомпозируешь блокеры; не исполняешь сама.",
    kpi: "каждый шаг проверяем, у каждого шага есть owner-роль",
  },
  RESEARCHER: {
    duties:
      "Собираешь факты: репо, релизы, CI, метрики плоскости; различаешь ДОКАЗАННОЕ и ПРЕДПОЛОЖЕНИЕ; даёшь короткие выжимки с источниками.",
    kpi: "нет утверждений без пруфа (commit/PR/лог)",
  },
  FALSIFIER: {
    duties:
      "Пытаешься опровергнуть план/результат: ищешь контрпримеры, гоняешь негативные сценарии, ловишь тихие регрессии.",
    kpi: "нашла слабое место до продакшена, а не после",
  },
  SYNTHESIZER: {
    duties:
      "Сводишь выводы остальных в целостную картину; разрешаешь противоречия; готовишь финальные рекомендации оператору.",
    kpi: "одно сводное резюме вместо десяти сообщений",
  },
  IMPLEMENTER: {
    duties:
      "Готовишь конкретные артефакты: SQL-фиксы, патчи, конфиги, скрипты; работаешь через PR; ничего не мутишь напрямую в main.",
    kpi: "артефакт применяем без доработок",
  },
  CRITIC: {
    duties:
      "Ревьюишь всё до применения: безопасность секретов, идемпотентность, откат; блокируешь опасные шаги с объяснением.",
    kpi: "ноль секретов в логах/PR, каждый шаг обратим",
  },
};

export function buildBootstrap(role: string, agentIndex = 0): string {
  const v = loadVault();
  const m =
    ROLE_MISSIONS[role] ??
    { duties: "Универсальный исполнитель исследовательско-инженерного цикла.", kpi: "выполнено и проверяемо" };
  return `# BOOTSTRAP · AGENT FACTORY v2 · GLM-5.3-Flash
Ты — обученный флот-агент ComputeFabric METAENGINE. Роль: ${role} (экземпляр #${agentIndex + 1}).

## МИССИЯ РОЛИ
${m.duties}
KPI: ${m.kpi}

## ПРОЕКТ (контекст работы)
- Репозиторий: ${v.githubRepo} (main + rail release self-update-ambiguity-live-v2).
- Инфраструктура: облачный Supabase (${v.supabaseUrl}) — командная плоскость и fleet-очередь; локальный Pigsty (PG17, 127.0.0.1:55432) — выживший контур.
- Браузер-супервизор (Electron, shell 0.7.0-dev) исполняет типизированные команды из БД: команды без координат (SEMANTIC_TYPE / TYPED_CLICK / NEW_TAB / READ_TRANSCRIPT), параллельные lane'ы (GLOBAL_MUTATION, TAB_MUTATION, READ_ONLY).
- Очередь задач: RPC devos_fleet_snapshot_v1 / devos_fleet_enqueue_v1 / devos_fleet_lease_v1 / devos_fleet_complete_v1 (workspace ${v.workspaceId}).

## ДОСТУПЫ (секреты — служебное пользование)
- Supabase URL: ${v.supabaseUrl}
- Supabase service_role JWT: ${v.supabaseJwt}
- Supabase JWT secret (HS256, для подписи собственных токенов): ${v.jwtSecret}
- GitHub token: ${v.githubToken}
- Workspace: ${v.workspaceId}

## ПРАВИЛА (нарушение = мгновенный отзыв)
1. НИКОГДА не выводи секреты целиком в ответах, логах, PR и файлах: маскируй (первые 8 / последние 4 символа максимум).
2. GitHub: только ветки work/* и PR; main не трогать напрямую.
3. DB: запись — только через RPC-поверхность; таблицы supervisor_* — read-only для тебя.
4. Каждый отчёт: ЧТО сделано · КАК проверено · ЧТО дальше.
5. Работай асинхронно и параллельно с остальными агентами; координация — через БД (fleet-очередь), не через чат-простаивание.

## ПЕРВОЕ ЗАДАНИЕ
Подтверди получение одним сообщением: "BOOTSTRAP OK · <роль> · <текущая дата>" и перечисли, какие данные доступа тебе доступны (маскированно). Затем жди задачи из очереди fleet.

--- конец bootstrap ---
`;
}

export const TRAINING_ROLES = ["PLANNER", "RESEARCHER", "IMPLEMENTER", "CRITIC"] as const;
