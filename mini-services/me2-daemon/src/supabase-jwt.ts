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
 *   3) service_proxy   — читает сам daemon через legacy service_role JWT (ключ НЕ покидает daemon;
 *                        RLS-гейт так НЕ демонстрируется — панель маркирует честно);
 *   4) mint            — HS256 минт (сохранён для eval/офлайн-верификации; облако отвергает —
 *                        панель покажет живой 401);
 *   5) ok:false no_read_channel — честный отказ.
 */
export function uiTokenBundle(): {
  ok: boolean; reason?: string; schema?: string; table?: string; rest?: string;
  channel?: "publishable" | "anon_registered" | "service_proxy" | "mint";
  token?: string; anon_token?: string; role?: string; ttl?: number; mirror_state?: string; note?: string;
} {
  const restBase =
    tokenGet("SUPABASE_URL") ?? process.env.ME2_SQL_MIRROR_URL ?? "https://xpeibufgzjknrhbhpffp.supabase.co";
  const pub = publishableKey();
  if (pub) {
    // канонический RLS-гейт: ключ публичный, роль anon — видимость строк диктует RLS (sql/0003)
    return { ok: true, schema: SUPABASE_JWT_SCHEMA, table: SQLMIRROR_TABLE, channel: "publishable",
             rest: `${restBase.replace(/\/$/, "")}/rest/v1`, token: pub, anon_token: pub, role: "anon", ttl: 0 };
  }
  const anonJwt = anonRegisteredJwt();
  if (anonJwt) {
    // зарегистрированный legacy anon-ключ: роль anon, RLS-гейт канонический, публичен по дизайну
    return { ok: true, schema: SUPABASE_JWT_SCHEMA, table: SQLMIRROR_TABLE, channel: "anon_registered",
             rest: `${restBase.replace(/\/$/, "")}/rest/v1`, token: anonJwt, anon_token: anonJwt, role: "anon", ttl: 0 };
  }
  if (serviceRoleLegacyJwt()) {
    // рабочий режим R54: читает daemon, ключ не покидает сервер; RLS-демонстрация ждёт publishable/anon
    return { ok: true, schema: SUPABASE_JWT_SCHEMA, table: SQLMIRROR_TABLE, channel: "service_proxy",
             rest: `${restBase.replace(/\/$/, "")}/rest/v1`, role: "service", ttl: 0,
             note: "читает daemon (service_role legacy) — ключ не покидает сервер; RLS-гейт демонстрируется при sb_publishable или зарегистрированном legacy anon-ключе" };
  }
  if (jwtSecretPresent()) {
    return { ok: true, schema: SUPABASE_JWT_SCHEMA, table: SQLMIRROR_TABLE, channel: "mint",
             rest: `${restBase.replace(/\/$/, "")}/rest/v1`,
             token: mintSupabaseJwt("authenticated", 120) ?? "", anon_token: mintSupabaseJwt("anon", 120) ?? "",
             role: "authenticated", ttl: 120,
             note: "сам-минт: облако принимает только точные строки зарегистрированных ключей — ожидаем честный 401" };
  }
  return { ok: false, reason: "no_read_channel" };
}
