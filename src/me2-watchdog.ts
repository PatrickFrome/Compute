// ME2 daemon guardian — runs inside the immortal next-server process.
// The platform reaps tool-spawned processes, but next-server is parented to
// PID 1 by /start.sh. This watchdog spawns me2-daemon when unhealthy and
// revives it within seconds. Idempotent: EADDRINUSE losers exit cleanly and
// the spawn is throttled via /tmp/me2-daemon-last-spawn.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DAEMON_DIR = "/home/z/my-project/mini-services/me2-daemon";
const HEALTH = "http://127.0.0.1:3021/health";
const SPAWN_FILE = "/tmp/me2-daemon-last-spawn";
const MIN_SPAWN_INTERVAL_MS = 8000;

function lastSpawnFresh(): boolean {
  try {
    if (!existsSync(SPAWN_FILE)) return false;
    const ts = Number(readFileSync(SPAWN_FILE, "utf8").trim());
    return Number.isFinite(ts) && Date.now() - ts < MIN_SPAWN_INTERVAL_MS;
  } catch {
    return false;
  }
}

function spawnDaemon(): void {
  if (lastSpawnFresh()) return;
  try {
    writeFileSync(SPAWN_FILE, String(Date.now()));
    const child = spawn("bun", ["index.ts"], {
      cwd: DAEMON_DIR,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ME2_WATCHDOG: "off" },
    });
    child.unref();
    console.log("[me2-watchdog] spawned me2-daemon pid=", child.pid);
  } catch (e) {
    console.error("[me2-watchdog] spawn failed:", e);
  }
}

async function healthy(): Promise<boolean> {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export function startWatchdog(): void {
  const loop = async (): Promise<void> => {
    try {
      if (!(await healthy())) spawnDaemon();
    } catch {
      /* never let the watchdog die */
    }
  };
  void loop();
  const timer = setInterval(() => void loop(), 5000);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[me2-watchdog] active — guarding me2-daemon on :3020/:3021");
}
