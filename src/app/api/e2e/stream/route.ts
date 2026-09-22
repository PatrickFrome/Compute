import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const E2E_DIR = "/home/z/my-project/mini-services/a2-edge-local";
const E2E_SCRIPT = "test-e2e.ts";
const TIMEOUT_MS = 90_000;

/**
 * SSE stream of the canonical 10-check E2E suite (round EDGE-LOCAL-RUNTIME-004).
 * Lines are pushed as they arrive so the console terminal renders live output
 * instead of waiting for the whole run (round MC-WEB-CONSOLE-20260921-006).
 */
export async function GET(req: Request) {
  const started = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      send({ type: "meta", script: E2E_SCRIPT, startedAt: new Date().toISOString() });

      const child = spawn("bun", [E2E_SCRIPT], {
        cwd: E2E_DIR,
        env: {
          ...process.env,
          NO_COLOR: "1",
          // E2E script shells out to psql (operator-gate emulation):
          // psql wrapper lives in ~/.local/bin — must be visible to the child.
          PATH: `/home/z/.local/bin:${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let buf = "";
      const onChunk = (d: Buffer) => {
        buf += d.toString();
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (line.trim()) send({ type: "line", text: line });
        }
      };
      child.stdout.on("data", onChunk);
      child.stderr.on("data", onChunk);

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        send({ type: "line", text: `[timeout] E2E_TIMEOUT after ${TIMEOUT_MS}ms` });
        send({ type: "done", exitCode: -1, summary: null, durationMs: Date.now() - started });
        close();
      }, TIMEOUT_MS);

      child.on("error", (e) => {
        clearTimeout(timer);
        send({ type: "line", text: `[spawn-error] ${e.message}` });
        send({ type: "done", exitCode: -1, summary: null, durationMs: Date.now() - started });
        close();
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (buf.trim()) send({ type: "line", text: buf.trim() });
        send({ type: "line", text: `[exit_code=${code}]` });
        const full = `${buf}\n[exit_code=${code}]`;
        const m = full.match(/(\d+)\/(\d+)\s+PASS/);
        send({
          type: "done",
          exitCode: code,
          summary: m ? `${m[1]}/${m[2]} PASS` : null,
          durationMs: Date.now() - started,
        });
        close();
      });

      req.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
