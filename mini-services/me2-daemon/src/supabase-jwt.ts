// ── R53 (фаза D-исполнение, план D8/H6): read-канал Supabase для чтения SQL-зеркала
// из UI С ГЕЙТОМ RLS ──
//
// Роль (план §D8): таблица me2_event_mirror_h205f22 (sql/0001) открыта на SELECT только
// роли `authenticated` (sql/0003); anon-политики НЕТ — fail-closed.
//
// R53-проба живого облака выявила честный факт: ключ SUPABASE_SERVICE_ROLE_JWT в
// vault'е — на самом деле НОВЫЙ формат sb_secret_… (не JWT), а mint HS256 по
// SUPABASE_JWT_SECRET облаком ОТВЕРГАЕТСЯ (401) — legacy JWT-аутентификация в проекте
// выключена. Поэтому канал чтения двухрежимный (честный приоритет):
//   1) channel=publishable — sb_publishable_… ключ (роль anon, RLS-управляемый,
//      публичный по дизайну — оператор кладёт в vault/env; канонический RLS-гейт);
//   2) channel=anon_registered — зарегистрированный legacy anon JWT (роль anon; RLS-гейт);
//   3) channel=service_proxy — читает daemon через legacy service_role JWT (ключ не покидает сервер);
//   4) channel=mint — HS256 JWT (authenticated/anon, ttl 120с) — сохранён для eval/офлайн;
//      пробы R54 доказали: облако отвергает сам-минт (точный матч зарегистрированных строк);
//   5) ok:false reason=no_read_channel — честный отказ.
// Zero-authority: модуль только выдаёт read-каналы; на шину, решения и self-update не влияет.
import { tokenGet } from "./tokens";
import { SQLMIRROR_TABLE } from "./sqlmirror";

export const SUPABASE_JWT_SCHEMA = "me2.supabase.jwt-mint.v1";

function b64url(input: Uint8Array | string): string {
  const bin = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let s = "";
  for (const b of bin) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hmacSha256(key: string, data: string): Uint8Array {
  // bun:crypto (BoringSSL) — честный HMAC-SHA256 без внешних зависимостей
  const h = new Bun.CryptoHasher("sha256", key);
  h.update(data);
  return h.digest();
}

function jwtSecret(): string {
  return tokenGet("SUPABASE_JWT_SECRET") ?? "";
}

export function jwtSecretPresent(): boolean {
  return jwtSecret().length > 0;
}

/** Подписать HS256 JWT с заданной ролью. Возвращает null, если секрета нет (честный отказ). */
export function mintSupabaseJwt(role: "authenticated" | "anon", ttlSec = 120): string | null {
  const secret = jwtSecret();
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub: "me2-ui", role, iat: now, exp: now + Math.max(10, Math.min(ttlSec, 600)) }),
  );
  const sig = b64url(hmacSha256(secret, `${header}.${payload}`));
  return `${header}.${payload}.${sig}`;
}

/** Верификация (для eval и само-проверки): подпись + срок + роль. */
export function verifySupabaseJwt(token: string, expectRole?: string): { ok: boolean; reason: string; role?: string } {
  const secret = jwtSecret();
  if (!secret) return { ok: false, reason: "jwt_secret_missing" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [header, payload, sig] = parts;
  const expected = b64url(hmacSha256(secret, `${header}.${payload}`));
  if (sig !== expected) return { ok: false, reason: "bad_signature" };
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    ));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) return { ok: false, reason: "expired" };
  if (expectRole && claims.role !== expectRole) return { ok: false, reason: "role_mismatch", role: String(claims.role) };
  return { ok: true, reason: "ok", role: String(claims.role) };
}

// ── R57: GoTrue-канал — настоящий сервис-аккаунт (создан админ-API R55, aud=authenticated).
// Канонический паттерн клиента (Supabase Studio/JS SDK): логин паролем → короткоживущий
// access_token (role=authenticated, ~1ч) в UI, refresh_token в хранилище клиента. Здесь клиент —
// сам daemon (единая точка): кэш токена, рефреш за 120с до exp, ре-логин при отказе, single-flight,
// анти-шторм (не чаще 30с). Пароль/email НИКОГДА не покидают daemon (в bundle уходит только
// короткоживущий JWT пользователя — публичный по природе access-токена).
let gotrueCache: { access_token: string; refresh_token: string; expires_at: number } | null = null;
let gotrueBusy: Promise<boolean> | null = null;
let gotrueLastError: string | null = null;
let gotrueLastAt = 0;

/** R57: креденшалы сервис-аккаунта из vault БД (R47-принцип: все токены в БД). */
export function gotrueCreds(): { email: string; password: string } | null {
  const email = tokenGet("SUPABASE_UI_ACCOUNT_EMAIL") ?? "";
  const password = tokenGet("SUPABASE_UI_ACCOUNT_PASSWORD") ?? "";
  if (!email || !password) return null;
  return { email, password };
}

/** R57: честная телеметрия канала (без секретов): настроен/кэш/остаток TTL/последняя ошибка. */
export function gotrueStatus(): {
  configured: boolean; cached: boolean; expires_in: number; last_error: string | null; last_attempt_at: number | null;
} {
  const c = gotrueCache;
  return {
    configured: Boolean(gotrueCreds()),
    cached: Boolean(c),
    expires_in: c ? Math.max(0, Math.round((c.expires_at - Date.now()) / 1000)) : 0,
    last_error: gotrueLastError,
    last_attempt_at: gotrueLastAt || null,
  };
}

/** R57: офлайн-проверка формы GoTrue access_token (iss /auth/v1, роль authenticated, aal, срок). */
export function gotrueVerifyShape(token: string): { ok: boolean; reason: string; role?: string; iss?: string; aal?: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    ));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  const now = Math.floor(Date.now() / 1000);
  const iss = String(claims.iss ?? "");
  if (typeof claims.exp !== "number" || claims.exp < now) return { ok: false, reason: "expired" };
  if (claims.role !== "authenticated") return { ok: false, reason: "role_mismatch", role: String(claims.role ?? "") };
  if (!iss.includes("/auth/v1")) return { ok: false, reason: "iss_not_gotrue", iss };
  if (typeof claims.aal !== "string") return { ok: false, reason: "no_aal" };
  return { ok: true, reason: "ok", role: String(claims.role), iss, aal: String(claims.aal) };
}

/** R57: валидный GoTrue access_token (кэш → refresh → пароль). Best-effort, никогда не бросает. */
export async function gotrueToken(): Promise<{ ok: boolean; token?: string; ttl?: number; error?: string }> {
  const creds = gotrueCreds();
  if (!creds) return { ok: false, error: "no_credentials" };
  const now = Date.now();
  if (gotrueCache && gotrueCache.expires_at - 120_000 > now) {
    return { ok: true, token: gotrueCache.access_token, ttl: Math.round((gotrueCache.expires_at - now) / 1000) };
  }
  // анти-шторм: недавняя честная ошибка — не бьём сеть повторно
  if (gotrueLastError && now - gotrueLastAt < 30_000) return { ok: false, error: gotrueLastError };
  if (gotrueBusy) return gotrueBusy.then((ok) => ok && gotrueCache
    ? { ok: true, token: gotrueCache.access_token, ttl: Math.max(0, Math.round((gotrueCache.expires_at - Date.now()) / 1000)) }
    : { ok: false, error: gotrueLastError ?? "login_failed" });
  gotrueBusy = (async (): Promise<boolean> => {
    gotrueLastAt = Date.now();
    try {
      const base = String(tokenGet("SUPABASE_URL") ?? process.env.ME2_SQL_MIRROR_URL ?? "").replace(/\/$/, "");
      const apikey = publishableKey() || anonRegisteredJwt() || serviceRoleLegacyJwt();
      if (!base || !apikey) { gotrueLastError = "no_base_or_apikey"; return false; }
      const headers = { apikey, "Content-Type": "application/json" };
      // 1) refresh_token grant (канонический рефреш клиента)
      if (gotrueCache?.refresh_token) {
        try {
          const r = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST", headers, body: JSON.stringify({ refresh_token: gotrueCache.refresh_token }),
          });
          if (r.ok) {
            const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
            if (j.access_token) {
              gotrueCache = { access_token: j.access_token, refresh_token: j.refresh_token ?? gotrueCache.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 };
              gotrueLastError = null;
              return true;
            }
          }
        } catch { /* рефреш не удался — падаем в пароль */ }
      }
      // 2) логин паролем (R55-4: настоящий access_token 806 зн., role=authenticated)
      const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
        method: "POST", headers, body: JSON.stringify({ email: creds.email, password: creds.password }),
      });
      if (!r.ok) { gotrueLastError = `login_http_${r.status}`; return false; }
      const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!j.access_token) { gotrueLastError = "no_access_token"; return false; }
      gotrueCache = { access_token: j.access_token, refresh_token: j.refresh_token ?? "", expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 };
      gotrueLastError = null;
      return true;
    } catch (e) {
      gotrueLastError = String(e).slice(0, 80);
      return false;
    } finally {
      gotrueBusy = null;
    }
  })();
  return gotrueBusy.then((ok) => ok && gotrueCache
    ? { ok: true, token: gotrueCache.access_token, ttl: Math.max(0, Math.round((gotrueCache.expires_at - Date.now()) / 1000)) }
    : { ok: false, error: gotrueLastError ?? "login_failed" });
}

/** Публичный read-ключ нового режима (роль anon, гейтится RLS; публичен по дизайну). */
export function publishableKey(): string {
  return process.env.ME2_SUPABASE_PUBLISHABLE_KEY || tokenGet("SUPABASE_PUBLISHABLE_KEY") || "";
}

/** R54: зарегистрированный legacy anon-ключ (слот: оператор кладёт строку из дашборда → канонический RLS-гейт). */
export function anonRegisteredJwt(): string {
  return tokenGet("SUPABASE_ANON_JWT") || "";
}

/** R54: legacy service_role JWT (операторский; канал service_proxy — ключ НЕ покидает daemon). */
export function serviceRoleLegacyJwt(): string {
  return tokenGet("SUPABASE_SERVICE_ROLE_JWT_LEGACY") || "";
}

/**
 * Полная раздача для UI: REST-база PostgREST, таблица зеркала и read-канал.
 *
 * R54 (пробы живого облака): gateway принимает ТОЛЬКО точную строку зарегистрированного ключа
 * (HMAC-подпись того же секрета с иным iat → 401 — E1; канонические iss/ref — 401 — probe C;
 * GoTrue-шейп — 401 — G1-G3; точная строка service_role — 200 — E2/E5). Сам-минт мёртв.
 * Честный приоритет каналов:
 *   1) publishable     — sb_publishable_… (роль anon, RLS-гейт канонический, публичен по дизайну);
 *   2) anon_registered — зарегистрированный legacy anon JWT (роль anon, RLS-гейт; публичен по дизайну);
 *   3) gotrue          — R57: настоящий GoTrue access_token сервис-аккаунта (роль authenticated,
 *                        ttl ~1ч, кэш+refresh; канонический клиент-паттерн; полный RLS-демонстрационный
 *                        цикл: authenticated ЧИТАЕТ строки по политике, не обходя RLS);
 *   4) service_proxy   — читает сам daemon через legacy service_role JWT (ключ НЕ покидает daemon;
 *                        RLS-гейт так НЕ демонстрируется — панель маркирует честно);
 *   5) mint            — HS256 минт (сохранён для eval/офлайн-верификации; облако отвергает —
 *                        панель покажет живой 401);
 *   6) ok:false no_read_channel — честный отказ.
 * R57: во всех режимах с публичным токеном дополнительно отдаётся auth_token (gotrue, из кэша)
 * — панель показывает ПОЛНУЮ RLS-матрицу: anon отказ ✓ + authenticated читает ✓.
 */
export function uiTokenBundle(): {
  ok: boolean; reason?: string; schema?: string; table?: string; rest?: string;
  channel?: "publishable" | "anon_registered" | "gotrue" | "service_proxy" | "mint";
  token?: string; anon_token?: string; auth_token?: string; auth_channel?: "gotrue";
  auth_ttl?: number; role?: string; ttl?: number; mirror_state?: string; note?: string;
} {
  const restBase =
    tokenGet("SUPABASE_URL") ?? process.env.ME2_SQL_MIRROR_URL ?? "https://xpeibufgzjknrhbhpffp.supabase.co";
  const rest = `${restBase.replace(/\/$/, "")}/rest/v1`;
  const g = gotrueCache;
  const authTok = g && g.expires_at > Date.now()
    ? { auth_token: g.access_token, auth_channel: "gotrue" as const, auth_ttl: Math.max(0, Math.round((g.expires_at - Date.now()) / 1000)) }
    : {};
  const pub = publishableKey();
  if (pub) {
    // канонический RLS-гейт: ключ публичный, роль anon — видимость строк диктует RLS (sql/0003)
    return { ok: true, schema: SUPABASE_JWT_SCHEMA, table: SQLMIRROR_TABLE, channel: "publishable",
             rest, token: pub, anon_token: pub, role: "anon", ttl: 0, ...authTok };
  }
  const anonJwt = anonRegisteredJwt();
  if (anonJwt) {
    // зарегистрированный legacy anon-ключ: роль anon, RLS-гейт канонический, публичен по дизайну
    return { ok: true, schema: SUPABASE_JWT_SCHEMA, table: SQLMIRROR_TABLE, channel: "anon_registered",
             rest, token: anonJwt, anon_token: anonJwt, role: "anon", ttl: 0, ...authTok };
  }
  if (g && g.expires_at > Date.now()) {
    // R57: публичных ключей нет, но настоящий GoTrue-токен есть — канал authenticated
    return { ok: true, schema: SUPABASE_JWT_SCHEMA, table: SQLMIRROR_TABLE, channel: "gotrue",
             rest, token: g.access_token, role: "authenticated", ttl: authTok.auth_ttl ?? 0,
             note: "настоящий GoTrue access_token сервис-аккаунта (кэш+refresh в daemon) — RLS-чтение канонически; anon-проба словами (публичного ключа нет)" };
  }
  if (serviceRoleLegacyJwt()) {
    // рабочий режим R54: читает daemon, ключ не покидает сервер; RLS-демонстрация ждёт publishable/anon
    return { ok: true, schema: SUPABASE_JWT_SCHEMA, table: SQLMIRROR_TABLE, channel: "service_proxy",
             rest, role: "service", ttl: 0,
             note: "читает daemon (service_role legacy) — ключ не покидает сервер; RLS-гейт демонстрируется при sb_publishable или зарегистрированном legacy anon-ключе" };
  }
  if (jwtSecretPresent()) {
    return { ok: true, schema: SUPABASE_JWT_SCHEMA, table: SQLMIRROR_TABLE, channel: "mint",
             rest,
             token: mintSupabaseJwt("authenticated", 120) ?? "", anon_token: mintSupabaseJwt("anon", 120) ?? "",
             role: "authenticated", ttl: 120,
             note: "сам-минт: облако принимает только точные строки зарегистрированных ключей — ожидаем честный 401" };
  }
  return { ok: false, reason: "no_read_channel" };
}
