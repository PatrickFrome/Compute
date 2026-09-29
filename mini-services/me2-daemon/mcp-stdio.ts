/**
 * ME2 daemon — MCP stdio-адаптер (R25, A1).
 *
 * Стандартный транспорт MCP для десктопных клиентов: клиент спавнит процесс,
 * обменивается line-delimited JSON-RPC через stdin/stdout. Адаптер проксирует
 * каждый запрос в REST daemon'а (POST :3041/mcp) и пишет ответы в stdout.
 * Логи/ошибки — только в stderr (stdout = протокол, инвариант MCP).
 *
 * Проверка из шелла:
 *   printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
 *     '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"daemon_health","arguments":{}}}' \
 *     | ME2_REST=http://localhost:3041 bun src/mcp-stdio.ts
 */
import { createInterface } from "node:readline";

const REST = process.env.ME2_REST ?? "http://localhost:3041";

const rl = createInterface({ input: process.stdin, terminal: false });

// дренаж: stdin может закрыться раньше, чем улетят последние fetch — ждём их (инвариант MCP:
// клиент должен получить ответы на все запросы до EOF процесса)
let pending = 0;
let stdinClosed = false;
function maybeExit(): void { if (stdinClosed && pending === 0) process.exit(0); }

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch {
    process.stderr.write(`[mcp-stdio] bad json line ignored\n`);
    return;
  }
  pending++;
  void (async () => {
    try {
      const res = await fetch(`${REST}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (res.status !== 202) { // notification — ответа нет
        const json = await res.json();
        process.stdout.write(JSON.stringify(json) + "\n");
      }
    } catch (e) {
      // протокольная ошибка уровня транспорта — отвечаем JSON-RPC error, чтобы клиент не завис
      const body = parsed as { id?: unknown } | undefined;
      const id = body && typeof body === "object" && "id" in body ? (body as { id: unknown }).id : null;
      if (id !== undefined && id !== null) {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0", id,
          error: { code: -32603, message: String(e instanceof Error ? e.message : e) },
        }) + "\n");
      }
    } finally {
      pending--;
      maybeExit();
    }
  })();
});

rl.on("close", () => { stdinClosed = true; maybeExit(); });
process.stderr.write(`[mcp-stdio] proxying JSON-RPC → ${REST}/mcp\n`);
