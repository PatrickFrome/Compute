import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Boot/revive endpoint for the ME2 daemon (idempotent).
// The console calls this when the daemon is unreachable; the watchdog
// (src/instrumentation.ts) uses the same guarded spawn logic.
const DAEMON_DIR = "/home/z/my-project/mini-services/me2-daemon";
const HEALTH = "http://127.0.0.1:3021/health";
const SPAWN_FILE = "/tmp/me2-daemon-last-spawn";
const MIN_SPAWN_INTERVAL_MS = 8000;

async function healthy(): Promise<boolean> {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function POST(): Promise<NextResponse> {
  if (await healthy()) {
    return NextResponse.json({ ok: true, already: true });
  }
  try {
    if (existsSync(SPAWN_FILE)) {
      const ts = Number(readFileSync(SPAWN_FILE, "utf8").trim());
      if (Number.isFinite(ts) && Date.now() - ts < MIN_SPAWN_INTERVAL_MS) {
        return NextResponse.json({ ok: false, reason: "spawn-throttled" }, { status: 429 });
      }
    }
    writeFileSync(SPAWN_FILE, String(Date.now()));
    const child = spawn("bun", ["index.ts"], {
      cwd: DAEMON_DIR,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ME2_WATCHDOG: "off" },
    });
    child.unref();
    return NextResponse.json({ ok: true, spawned: child.pid });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ healthy: await healthy() });
}
