/**
 * ME2 daemon — аутентификация REST/WS-плоскости (аудит 2026-10-18, CRITICAL C2).
 *
 * Проблема: ~60 REST-маршрутов и socket.io-канал (command/agentchat:op/tokens:op)
 * были доступны БЕЗ какой-либо аутентификации, а CORS отвечал `Access-Control-Allow-Origin: *`
 * — любой сайт в браузере (drive-by CSRF) или любой хост с сетевой досягаемостью
 * управлял демоном: POST /exec (RCE), POST /tokens (чтение/подмена vault), POST /sandbox.
 *
 * Модель доступа (канон локального agent-runtime; ничего не ломает у оператора):
 *  - ПУБЛИЧНЫЕ поверхности: GET /health (health-проба), GET /ui (статический шелл),
 *    POST /hooks/github (сам HMAC-верифицирует подпись x-hub-signature-256).
 *  - ME2_API_TOKEN задан → все непубличные клиенты ОБЯЗАНЫ предъявить bearer-токен
 *    (Authorization: Bearer <token> либо x-me2-token / socket.io auth.token).
 *  - Токен НЕ задан → непубличная плоскость закрыта (403), включая loopback.
 *  - Адрес loopback не идентифицирует клиента за локальным reverse proxy.
 *    Browser использует отдельный standalone read-only browser-probe-entry.ts.
 *  - Кросс-доменное чтение из браузера теперь диктует CORS-белый список
 *    ME2_ALLOWED_ORIGINS (запятая-разделённый) вместо `*`; по умолчанию кросс-домен закрыт.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const ME2_API_TOKEN: string = process.env.ME2_API_TOKEN ?? "";

const PUBLIC_PATHS = new Set(["/health", "/ui"]);

function allowedOrigins(): string[] {
  return (process.env.ME2_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Сравнение секретов с выравниванием времени (длина нормализуется двойным проходом). */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length > 1024 || b.length > 1024) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function suppliedToken(headers: Record<string, unknown>, authPayload?: unknown): string {
  const h = (name: string) => {
    const v = headers[name];
    return typeof v === "string" ? v : "";
  };
  if (headers.authorization !== undefined) return /^Bearer\s+(\S+)$/i.exec(h("authorization"))?.[1] ?? "";
  if (headers["x-me2-token"] !== undefined) return h("x-me2-token").trim();
  if (typeof authPayload === "string" && authPayload) return authPayload;
  return "";
}

export type AuthVerdict =
  | { ok: true; via: "public" | "hmac_webhook" | "token" }
  | { ok: false; status: 401 | 403; error: string };

function authorize(headers: Record<string, unknown>, method: string, urlPath: string, authPayload?: unknown): AuthVerdict {
  if (method === "GET" && PUBLIC_PATHS.has(urlPath)) return { ok: true, via: "public" };
  if (method === "POST" && urlPath === "/hooks/github") return { ok: true, via: "hmac_webhook" };

  // A local proxy has a loopback peer too. Transport address cannot identify its
  // remote caller; every non-public request needs the same bearer capability.
  if (!ME2_API_TOKEN) return { ok: false, status: 403, error: "control_forbidden_no_token_configured" };
  const token = suppliedToken(headers, authPayload);
  if (!token) return { ok: false, status: 401, error: "unauthorized_token_required" };
  if (!safeEqual(token, ME2_API_TOKEN)) return { ok: false, status: 401, error: "unauthorized_invalid_token" };

  // An allowed Origin complements authentication; it never replaces it.
  const origin = typeof headers.origin === "string" ? headers.origin : "";
  if (origin && !allowedOrigins().includes(origin)) {
    return { ok: false, status: 403, error: "cross_origin_forbidden" };
  }
  return { ok: true, via: "token" };
}

export function authorizeRequest(req: IncomingMessage): AuthVerdict {
  const path = new URL(req.url ?? "/", "http://local").pathname.replace(/\/+$/, "") || "/";
  return authorize(req.headers as Record<string, unknown>, String(req.method ?? "GET").toUpperCase(), path);
}

export function authorizeHandshake(handshake: { headers: Record<string, unknown>; address?: string; auth?: Record<string, unknown> }): AuthVerdict {
  const path = "/";
  return authorize(handshake.headers as Record<string, unknown>, "WS", path, handshake.auth?.token);
}

/**
 * CORS-заголовки: reflect-origin ТОЛЬКО для явно разрешённых значений
 * (ME2_ALLOWED_ORIGINS); по умолчанию кросс-доменные заголовки не выдаются вовсе.
 */
export function corsHeadersFor(req: { headers: Record<string, unknown> }): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,x-me2-token",
    Vary: "Origin",
  };
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) {
    if (allowedOrigins().includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
