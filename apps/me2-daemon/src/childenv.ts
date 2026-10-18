/**
 * ME2 daemon — общее окружение для child-process спавнов shell-инструментов
 * (аудит 2026-10-18, HIGH: наследование секретов).
 *
 * Проблема: bash -lc спавны в worker.ts (runShell) и src/agentchat.ts (tool shell)
 * создавались БЕЗ env → наследовали полный process.env daemon'а: секреты vault'а
 * (SUPABASE_SERVICE_ROLE_JWT, GITHUB_TOKEN_ADMIN, VERCEL_AI_GATEWAY_API_KEY, ...)
 * физически попадали в окружение shell-тула и в вывод `set`/`env`, который
 * модель видит как tool-result. src/sandbox.ts execInSandbox раскладывал
 * {...process.env} явно.
 *
 * Канон src/exec.ts §4: env ребёнка строится С НУЛЯ по белому списку —
 * секретов в окружении нет по построению. Этот модуль — единая точка белого
 * списка для всех не-exec спавнов daemon'а.
 */
const CHILD_ENV_ALLOW = [
  "PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP",
  "TERM", "SHELL", "USER", "LOGNAME", "PWD",
] as const;

const DEFAULT_PATH = "/home/z/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of CHILD_ENV_ALLOW) {
    const v = process.env[k];
    if (v !== undefined && v !== "") env[k] = v;
  }
  if (!env.PATH) env.PATH = DEFAULT_PATH;
  if (!env.HOME) env.HOME = "/tmp";
  if (!env.TMPDIR) env.TMPDIR = "/tmp";
  Object.assign(env, extra);
  return env;
}
