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
 *  - ME2_API_TOKEN задан → удалённые пиры ОБЯЗАНЫ предъявить bearer-токен
 *    (Authorization: Bearer <token> либо x-me2-token / socket.io auth.token).
 *  - Токен НЕ задан → любые не-loopback пиры отклоняются (403) — дефолт fail-closed.
 *  - Loopback-пиры (127.0.0.1/::1) разрешены без токена: UI, probe.sh, gate, Electron.
 *    Браузерный CSRF с внешнего origin гасится проверкой Origin (браузер ВСЕГДА
 *    прикладывает Origin к cross-origin запросам; curl/bun/scripts — нет).
 *  - Кросс-доменное чтение из браузера теперь диктует CORS-белый список
 *    ME2_ALLOWED_ORIGINS (запятая-разделённый) вместо `*`; по умолчанию кросс-домен закрыт.
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const ME2_API_TOKEN: string = process.env.ME2_API_TOKEN ?? "";

const PUBLIC_PATHS = new Set(["/health", "/ui"]);

function allowedOrigins(): string[] {
  return (process.env.ME2_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, "").replace(/^\[|\]$/g, "");
  return a === "127.0.0.1" || a === "::1" || a === "localhost";
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return isLoopbackAddress(u.hostname);
  } catch { return false; }
}

/** Сравнение секретов с выравниванием времени (длина нормализуется двойным проходом). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (!ba.length || !bb.length) return false;
  if (ba.length !== bb.length) {
    // длина различается — токен заведомо неверен; сравнение с самим собой держит
    // время ответа константным, чтобы оно не выдавало длину ожидаемого секрета
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function suppliedToken(headers: Record<string, unknown>, authPayload?: unknown): string {
  const h = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : "";
  };
  const bearer = /^Bearer\s+(.+)$/i.exec(h("authorization"));
  if (bearer?.[1]) return bearer[1].trim();
  if (h("x-me2-token")) return h("x-me2-token").trim();
  if (typeof authPayload === "string" && authPayload) return authPayload;
  return "";
}

export type AuthVerdict =
  | { ok: true; via: "public" | "hmac_webhook" | "token" | "loopback" }
  | { ok: false; status: 401 | 403; error: string };

function authorize(headers: Record<string, unknown>, peer: string | undefined | null, urlPath: string, authPayload?: unknown): AuthVerdict {
  if (PUBLIC_PATHS.has(urlPath)) return { ok: true, via: "public" };
  if (urlPath === "/hooks/github") return { ok: true, via: "hmac_webhook" }; // аутентичность — внутри (HMAC подписи GitHub)

  const loopback = isLoopbackAddress(peer);
  const token = suppliedToken(headers, authPayload);
  if (ME2_API_TOKEN) {
    if (token) {
      if (safeEqual(token, ME2_API_TOKEN)) return { ok: true, via: "token" };
      return { ok: false, status: 401, error: "unauthorized_invalid_token" };
    }
    if (!loopback) return { ok: false, status: 401, error: "unauthorized_token_required" };
  } else if (!loopback) {
    return { ok: false, status: 403, error: "remote_forbidden_no_token_configured" };
  }

  // CSRF-гейт для loopback: браузер прикладывает Origin к cross-origin запросам;
  // локальные CLI/probe/gate Origin не шлют. Внешний/чужой origin → отказ.
  const origin = typeof headers.origin === "string" ? headers.origin : "";
  if (origin && !isLoopbackOrigin(origin) && !allowedOrigins().includes(origin)) {
    return { ok: false, status: 403, error: "cross_origin_forbidden" };
  }
  return { ok: true, via: loopback ? "loopback" : "token" };
}

export function authorizeRequest(req: IncomingMessage): AuthVerdict {
  const path = new URL(req.url ?? "/", "http://local").pathname.replace(/\/+$/, "") || "/";
  return authorize(req.headers as Record<string, unknown>, req.socket?.remoteAddress, path);
}

export function authorizeHandshake(handshake: { headers: Record<string, unknown>; address?: string; auth?: Record<string, unknown> }): AuthVerdict {
  const path = "/";
  return authorize(handshake.headers as Record<string, unknown>, handshake.address, path, handshake.auth?.token);
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
