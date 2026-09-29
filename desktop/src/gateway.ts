/**
 * ME2 · встроенный мини-gateway (R46, умное слияние Electron ⇄ ME2).
 *
 * UI Mission Control написан относительно gateway (Caddy :81 в песочнице): все запросы —
 * относительные пути с query `XTransformPort=NNNN`, WS — тот же принцип. Чтобы ЕДИНЫЙ UI
 * работал в Electron без единой правки, оболочка несёт собственный gateway:
 *   • обычные запросы → http://127.0.0.1:3000 (Next UI);
 *   • ?XTransformPort=NNNN → http://127.0.0.1:NNNN (daemon :3040/:3041, стримы :3042/:3043);
 *   • WebSocket-upgrade проксируется сырым TCP-pipe (socket.io, screencast).
 * Так Electron полностью заменяет Caddy на машине оператора — одна система, ноль внешних зависимостей.
 */
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as tcpConnect, type Socket as TcpSocket } from "node:net";

export const GATEWAY_PORT = 8137;
const UI_PORT = 3000;

function targetPort(reqUrl: string): number {
  const q = reqUrl.indexOf("XTransformPort=");
  if (q < 0) return UI_PORT;
  const end = reqUrl.indexOf("&", q);
  const raw = reqUrl.slice(q + "XTransformPort=".length, end < 0 ? undefined : end);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : UI_PORT;
}

/** URL без служебного query-параметра (upstream не должен его видеть). */
function stripTransform(rawUrl: string): string {
  const [path, query = ""] = rawUrl.split("?");
  if (!query) return path;
  const parts = query.split("&").filter((kv) => !kv.startsWith("XTransformPort="));
  return parts.length ? `${path}?${parts.join("&")}` : path;
}

function proxyHttp(req: IncomingMessage, res: ServerResponse): void {
  const port = targetPort(req.url ?? "/");
  const path = stripTransform(req.url ?? "/");
  const headers = { ...req.headers, host: `127.0.0.1:${port}`, connection: "close" as const };
  const upstream = httpRequest({ host: "127.0.0.1", port, path, method: req.method, headers }, (ur) => {
    res.writeHead(ur.statusCode ?? 502, ur.headers);
    ur.pipe(res);
  });
  upstream.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `gateway: upstream :${port} недоступен (${String(e).slice(0, 80)})` }));
  });
  req.pipe(upstream);
}

/** WS-upgrade: переписываем первую строку (path без XTransformPort) и Host, дальше — сырой pipe. */
function proxyUpgrade(req: IncomingMessage, socket: TcpSocket, head: Buffer): void {
  const port = targetPort(req.url ?? "/");
  const path = stripTransform(req.url ?? "/");
  const upstream = tcpConnect({ host: "127.0.0.1", port }, () => {
    const lines = [`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      if (!k || /^host$/i.test(k) || /^connection$/i.test(k) || /^upgrade$/i.test(k)) continue;
      lines.push(`${k}: ${req.rawHeaders[i + 1] ?? ""}`);
    }
    lines.push("Connection: Upgrade", "Upgrade: websocket", "\r\n");
    upstream.write(lines.join("\r\n"));
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  const kill = () => { try { socket.destroy(); } catch { /* уже мёртв */ } try { upstream.destroy(); } catch { /* уже мёртв */ } };
  upstream.on("error", kill);
  socket.on("error", kill);
  upstream.on("close", kill);
  socket.on("close", kill);
}

export function startGateway(port = GATEWAY_PORT): { url: string; close(): Promise<void> } {
  const server = createServer((req, res) => {
    try { proxyHttp(req, res); }
    catch (e) {
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: `gateway: ${String(e).slice(0, 100)}` }));
      } catch { /* сокет уже закрыт */ }
    }
  });
  server.on("upgrade", (req, socket, head) => {
    try { proxyUpgrade(req, socket as TcpSocket, head); }
    catch { try { (socket as TcpSocket).destroy(); } catch { /* noop */ } }
  });
  server.on("error", (e) => { console.error(`[gateway] :${port} ${String(e).slice(0, 120)}`); });
  server.listen(port, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
