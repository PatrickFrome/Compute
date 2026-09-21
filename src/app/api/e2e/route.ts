import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const E2E_DIR = "/home/z/my-project/mini-services/a2-edge-local";
const E2E_SCRIPT = "test-e2e.ts";
const TIMEOUT_MS = 90_000;

/**
 * Runs the canonical 10-check E2E suite (round EDGE-LOCAL-RUNTIME-004)
 * against the local edge + Pigsty and returns the full terminal output.
 */
export async function POST() {
  const started = Date.now();
  try {
    const output = await new Promise<string>((resolve, reject) => {
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
      let out = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`E2E_TIMEOUT after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (out += d.toString()));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        out += `\n[exit_code=${code}]`;
        resolve(out);
      });
    });

    const summaryMatch = output.match(/(\d+)\/(\d+)\s+PASS/);
    const exitMatch = output.match(/\[exit_code=(\d+)\]/);
    const durationMs = Date.now() - started;

    return Response.json({
      ok: exitMatch?.[1] === "0",
      output,
      summary: summaryMatch ? `${summaryMatch[1]}/${summaryMatch[2]} PASS` : null,
      passed: summaryMatch ? Number(summaryMatch[1]) : 0,
      total: summaryMatch ? Number(summaryMatch[2]) : 0,
      durationMs,
      script: path.join(E2E_DIR, E2E_SCRIPT),
    });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
      },
      { status: 500 },
    );
  }
}
