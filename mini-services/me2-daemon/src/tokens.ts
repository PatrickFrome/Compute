/**
 * ME2 R47 — ТОКЕНЫ В БД: единый vault всех секретов системы в SQLite (store-level).
 *
 * Постановка оператора: «Все Токены должны быть в бд». До R47 секреты жили в файлах
 * /home/z/.a2 (*.env) и читались потребителями напрямую (selfupdate/evidence/mirror/providers)
 * — env-reset терял их, а видимостью была только файловая система.
 *
 * Теперь:
 *  - таблица tokens в той же SQLite, что и events/tasks/meta (один источник истины,
 *    переживает рестарты и env-reset вместе со всей шиной и hash-chain);
 *  - ОДНОРАЗОВЫЙ bootstrap из /home/z/.a2 при пустых именах (source="file:…") —
 *    миграция честная: существующие значения в БД НИКОГДА не перезаписываются файлом;
 *  - все потребители (selfupdate/evidence/mirror/providers) читают ТОЛЬКО tokenGet;
 *  - VERCEL_AI_GATEWAY_API_KEY, добытый из Supabase RPC, сам падает в БД (tokenSet) —
 *    добыча не повторяется после рестарта;
 *  - операции set/delete — REST POST /tokens {op} + socket.io "tokens:op" (ack) —
 *    T0-плоскость оператора (политика H2); чат-агентам токены НЕДОСТУПНЫ (их tool-набор
 *    не содержит tokens-операций — vault не протекает во флот);
 *  - НИКАКИХ значений наружу: tokenList/tokensStatus/события цепи несут только
 *    маску (первые 5 + последние 3 + длина) — raw value живёт ТОЛЬКО в tokenGet.
 */
import { db, emit, nowIso, getMeta, setMeta } from "../store";
import { readFileSync, existsSync } from "node:fs";

export type TokenTier = "T1" | "T2";

export interface TokenRow {
  name: string; value: string; tier: TokenTier; source: string; updated_at: string; updated_by: string;
}

/** Реестр известных токенов системы (ярусы в семантике H2 policy). */
export const KNOWN_TOKENS: Record<string, { tier: TokenTier; desc: string }> = {
  GITHUB_TOKEN_ADMIN: { tier: "T2", desc: "GitHub admin: selfupdate (ff-only sandbox/me2-os), push релизов" },
  GITHUB_TOKEN_SANDBOX: { tier: "T1", desc: "GitHub sandbox: push-токен рабочей ветки" },
  SUPABASE_URL: { tier: "T2", desc: "Supabase project URL: evidence-mirror, DDL-хилер" },
  SUPABASE_SERVICE_ROLE_JWT: { tier: "T2", desc: "Supabase service role key: outbox-доставка, RPC gateway-ключа" },
  SUPABASE_JWT_SECRET: { tier: "T2", desc: "Supabase JWT secret: mint service_role HS256 (канал mgmt_minted_jwt)" },
  VERCEL_AI_GATEWAY_API_KEY: { tier: "T1", desc: "Vercel AI Gateway: LLM-провайдер gateway:<model>" },
};

const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

db.exec(`
CREATE TABLE IF NOT EXISTS tokens (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'T2',
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
`);

// ── маскирование: единственная разрешённая проекция значения наружу ──
export function maskValue(v: string): string {
  if (!v) return "(empty)";
  if (v.length <= 10) return `*** (len ${v.length})`;
  return `${v.slice(0, 5)}…${v.slice(-3)} (len ${v.length})`;
}

// ── подписки на изменение (потребители сбрасывают свои кэши) ────────
type ChangeFn = (name: string) => void;
const changeListeners: ChangeFn[] = [];
export function onTokenChange(fn: ChangeFn): () => void {
  changeListeners.push(fn);
  return () => { const i = changeListeners.indexOf(fn); if (i >= 0) changeListeners.splice(i, 1); };
}
function notify(name: string) {
  for (const fn of changeListeners) { try { fn(name); } catch { /* слушатель не роняет vault */ } }
}

// ── парсинг env-файлов (тот же формат, что evidence/providers до R47) ──
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    if (!existsSync(path)) return out;
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      let k = line.slice(0, i).trim();
      if (k.startsWith("export ")) k = k.slice(7).trim();
      out[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
  } catch { /* файл не читается — честно пропускаем */ }
  return out;
}

const SEED_FILES = [
  // R54: +SUPABASE_SERVICE_ROLE_JWT_LEGACY (операторский legacy service_role JWT, HMAC-верифицирован
  // против SUPABASE_JWT_SECRET; облако принимает точную строку зарегистрированного ключа — пробы E2/E5)
  // и +SUPABASE_ANON_JWT (слот на будущее: зарегистрированный legacy anon-ключ → канонический RLS-гейт).
  { path: "/home/z/.a2/supabase-cloud.env", keys: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_JWT", "SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_JWT_LEGACY", "SUPABASE_ANON_JWT"] },
  { path: "/home/z/.a2/.github.env", keys: ["GITHUB_TOKEN_ADMIN"] },
];

let lastOps: Array<{ at: string; op: string; name: string; by: string; ok: boolean }> = [];
function opLog(op: string, name: string, by: string, ok = true) {
  lastOps.unshift({ at: nowIso(), op, name, by, ok });
  if (lastOps.length > 12) lastOps.length = 12;
}

/**
 * Bootstrap/миграция: заполняет ТОЛЬКО отсутствующие в БД имена из /home/z/.a2.
 * Идемпотентен (вызывается на каждом boot): существующие значения не трогаются никогда.
 */
export function tokensEnsure(): { seeded: string[]; missing: string[]; present: number } {
  const seeded: string[] = [];
  const missing: string[] = [];
  // 1) env-файлы
  for (const f of SEED_FILES) {
    const env = parseEnvFile(f.path);
    for (const key of f.keys) {
      if (!env[key]) { missing.push(`${key} (${f.path})`); continue; }
      const have = db.query(`SELECT name FROM tokens WHERE name=?`).get(key);
      if (have) continue;
      db.query(`INSERT INTO tokens (name,value,tier,source,updated_at,updated_by) VALUES (?,?,?,?,?,?)`)
        .run(key, env[key], KNOWN_TOKENS[key]?.tier ?? "T2", `file:${f.path}`, nowIso(), "bootstrap");
      seeded.push(key);
    }
  }
  // 2) raw-файлы (однозначение: весь файл = значение токена)
  const rawSandbox = "/home/z/.a2/.ghtoken-sandbox";
  if (existsSync(rawSandbox) && !db.query(`SELECT name FROM tokens WHERE name='GITHUB_TOKEN_SANDBOX'`).get()) {
    try {
      const v = readFileSync(rawSandbox, "utf8").trim();
      if (v) {
        db.query(`INSERT INTO tokens (name,value,tier,source,updated_at,updated_by) VALUES (?,?,?,?,?,?)`)
          .run("GITHUB_TOKEN_SANDBOX", v, KNOWN_TOKENS.GITHUB_TOKEN_SANDBOX.tier, `file:${rawSandbox}`, nowIso(), "bootstrap");
        seeded.push("GITHUB_TOKEN_SANDBOX");
      }
    } catch { /* честно пропускаем */ }
  }
  if (!getMeta("tokens_seeded_v1")) setMeta("tokens_seeded_v1", nowIso());
  if (seeded.length) {
    try { emit("TOKENS_SEEDED", { seeded, missing, note: "bootstrap из /home/z/.a2 → SQLite (R47)" }, null, null); } catch { /* chain не критичен */ }
  }
  const present = (db.query(`SELECT COUNT(*) AS n FROM tokens`).get() as { n: number }).n;
  return { seeded, missing, present };
}

/** Raw-значение токена из БД. ЕДИНСТВЕННАЯ точка чтения для всех потребителей. */
export function tokenGet(name: string): string | null {
  const r = db.query(`SELECT value FROM tokens WHERE name=?`).get(name) as { value: string } | null;
  return r?.value ?? null;
}

export function tokenSet(name: string, value: string, tier?: string, by = "operator"): { ok: boolean; error?: string } {
  if (!NAME_RE.test(name)) return { ok: false, error: "bad_name (^[A-Z][A-Z0-9_]{0,63}$)" };
  const v = String(value ?? "").trim();
  if (!v || v.length > 4096) return { ok: false, error: "bad_value (1..4096)" };
  const t: TokenTier = tier === "T1" ? "T1" : tier === "T2" ? "T2" : (KNOWN_TOKENS[name]?.tier ?? "T2");
  db.query(`INSERT INTO tokens (name,value,tier,source,updated_at,updated_by) VALUES (?,?,?,?,?,?)
            ON CONFLICT(name) DO UPDATE SET value=excluded.value, tier=excluded.tier, source='operator', updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .run(name, v, t, "operator", nowIso(), by.slice(0, 64));
  opLog("set", name, by);
  try { emit("TOKENS_SET", { name, tier: t, masked: maskValue(v), by: by.slice(0, 64), verdict: "set" }, null, null); } catch { /* chain не критичен */ }
  notify(name);
  return { ok: true };
}

export function tokenDelete(name: string, by = "operator"): { ok: boolean; error?: string } {
  const have = db.query(`SELECT name FROM tokens WHERE name=?`).get(name);
  if (!have) return { ok: false, error: "not_found" };
  db.query(`DELETE FROM tokens WHERE name=?`).run(name);
  opLog("delete", name, by);
  try { emit("TOKENS_DELETED", { name, by: by.slice(0, 64), verdict: "deleted" }, null, null); } catch { /* chain не критичен */ }
  notify(name);
  return { ok: true };
}

/** Список токенов БЕЗ значений (маска + метаданные) — наружная проекция vault'а. */
export function tokenList(): Array<{ name: string; tier: TokenTier; known: boolean; desc: string; source: string; masked: string; updated_at: string; updated_by: string }> {
  const rows = db.query(`SELECT * FROM tokens ORDER BY name`).all() as TokenRow[];
  return rows.map((r) => ({
    name: r.name,
    tier: (r.tier === "T1" ? "T1" : "T2") as TokenTier,
    known: Boolean(KNOWN_TOKENS[r.name]),
    desc: KNOWN_TOKENS[r.name]?.desc ?? "пользовательский токен",
    source: r.source,
    masked: maskValue(r.value),
    updated_at: r.updated_at,
    updated_by: r.updated_by,
  }));
}

export function tokensStatus() {
  const rows = db.query(`SELECT tier, source FROM tokens`).all() as Array<{ tier: string; source: string }>;
  const byTier: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
    bySource[r.source.split(":")[0]] = (bySource[r.source.split(":")[0]] ?? 0) + 1;
  }
  const knownMissing = Object.keys(KNOWN_TOKENS).filter((k) => !tokenGet(k));
  return {
    ok: true,
    total: rows.length,
    known_total: Object.keys(KNOWN_TOKENS).length,
    known_missing: knownMissing,
    by_tier: byTier,
    by_source: bySource,
    seeded_at: getMeta("tokens_seeded_v1"),
    last_ops: lastOps,
    surface: { rest: "GET /tokens · POST /tokens {op:set|delete}", socket: "tokens:op (ack)", note: "chat-агентам vault недоступен (T0-плоскость)" },
  };
}

// bootstrap при импорте модуля — потребители могут читать tokenGet сразу
try { tokensEnsure(); } catch (e) { console.error(`[tokens] bootstrap failed: ${String(e).slice(0, 160)}`); }
