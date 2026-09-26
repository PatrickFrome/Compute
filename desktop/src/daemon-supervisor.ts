/**
 * ME2 · вечный супервизор процессов (R46, унификация).
 *
 * Постановка «вечного надзирателя» перенесена из ядра ME2 в оболочку:
 * Electron-главный процесс — PID-1 всей системы, он порождает и оживляет
 *   • me2-daemon (bun, SQLite + command bus + флот чат-агентов),
 *   • Next UI (bun run dev / start).
 * Политика повторов — экспоненциальный backoff с потолком; честный учёт
 * инкарнаций; кооперация со стражем инкарнации daemon'а (exit 13 = «второй
 * экземпляр жив» → не молотим, переходим в режим присоединения).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export type ProcKind = "daemon" | "ui";

export interface ProcStatus {
  kind: ProcKind;
  alive: boolean;
  pid: number | null;
  restarts: number;
  attached: boolean;
  lastExitCode: number | null;
  lastError: string | null;
  startedAt: number | null;
  healthy: boolean;
}

interface ProcSpec {
  cmd: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

interface ProcState {
  spec: ProcSpec;
  child: ChildProcess | null;
  want: boolean;
  restarts: number;
  attached: boolean;
  timer: NodeJS.Timeout | null;
  backoffMs: number;
  startedAt: number | null;
  lastExitCode: number | null;
  lastError: string | null;
  healthy: boolean;
}

const RESTART_BASE_MS = 1_500;
const RESTART_MAX_MS = 10 * 60_000;

export class ProcessSupervisor extends EventEmitter {
  private procs = new Map<ProcKind, ProcState>();

  constructor(
    private readonly log: (kind: ProcKind, line: string) => void,
  ) { super(); }

  register(kind: ProcKind, spec: ProcSpec): void {
    this.procs.set(kind, {
      spec, child: null, want: false, restarts: 0, attached: false,
      timer: null, backoffMs: RESTART_BASE_MS, startedAt: null,
      lastExitCode: null, lastError: null, healthy: false,
    });
  }

  start(kind: ProcKind): void {
    const st = this.procs.get(kind);
    if (!st) return;
    st.want = true;
    this.spawnNow(kind);
  }

  private spawnNow(kind: ProcKind): void {
    const st = this.procs.get(kind);
    if (!st) return;
    if (st.child) return;
    try {
      const child = spawn(st.spec.cmd, st.spec.args, {
        cwd: st.spec.cwd,
        env: { ...process.env, ...st.spec.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      st.child = child;
      st.startedAt = Date.now();
      st.healthy = false;
      this.log(kind, `spawn pid=${child.pid} (${st.spec.cmd} ${st.spec.args.join(" ")} @ ${st.spec.cwd})`);
      const pipe = (src: NodeJS.ReadableStream, err: boolean) => {
        let buf = "";
        src.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).replace(/\s+$/, "");
            buf = buf.slice(nl + 1);
            if (line) this.log(kind, err ? `! ${line}` : line);
          }
        });
        // хвост без перевода строки не теряем — сбрасываем по завершению потока
        src.on("end", () => { if (buf.trim()) this.log(kind, err ? `! ${buf.trim()}` : buf.trim()); buf = ""; });
      };
      if (child.stdout) pipe(child.stdout, false);
      if (child.stderr) pipe(child.stderr, true);
      child.on("exit", (code, signal) => {
        st.child = null;
        st.lastExitCode = code;
        this.log(kind, `exit code=${code} signal=${signal ?? "-"} (uptime ${Math.round((Date.now() - (st.startedAt ?? Date.now())) / 1000)}s, рестартов ${st.restarts})`);
        this.emit("status", this.status(kind));
        if (!st.want) return;
        // Страж инкарнации daemon'а (R34): exit 13 = «уже жив другой экземпляр».
        // Не амплифицируем: присоединяемся к живому через health-пинг, без спавна.
        if (code === 13) {
          st.attached = true;
          this.log(kind, "exit 13 — другой экземпляр уже жив (страж инкарнации); режим присоединения");
          this.emit("status", this.status(kind));
          return;
        }
        this.scheduleRestart(kind);
      });
      child.on("error", (e) => {
        st.lastError = String(e).slice(0, 200);
        this.log(kind, `spawn error: ${st.lastError}`);
      });
    } catch (e) {
      st.lastError = String(e).slice(0, 200);
      this.log(kind, `spawn throw: ${st.lastError}`);
      this.scheduleRestart(kind);
    }
    this.emit("status", this.status(kind));
  }

  private scheduleRestart(kind: ProcKind): void {
    const st = this.procs.get(kind);
    if (!st || !st.want || st.timer) return;
    const delay = Math.min(st.backoffMs, RESTART_MAX_MS);
    st.backoffMs = Math.min(st.backoffMs * 2, RESTART_MAX_MS);
    st.restarts += 1;
    this.log(kind, `рестарт #${st.restarts} через ${Math.round(delay / 100) / 10}s (backoff)`);
    st.timer = setTimeout(() => {
      st.timer = null;
      if (st.want) this.spawnNow(kind);
    }, delay);
  }

  /** Успешный health-пинг сбрасывает backoff (система реально жива). */
  reportHealth(kind: ProcKind, healthy: boolean): void {
    const st = this.procs.get(kind);
    if (!st) return;
    if (healthy) {
      st.healthy = true;
      st.backoffMs = RESTART_BASE_MS;
      st.attached = false;
    } else {
      st.healthy = false;
    }
  }

  stop(kind: ProcKind): void {
    const st = this.procs.get(kind);
    if (!st) return;
    st.want = false;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    if (st.child) {
      try { st.child.kill("SIGTERM"); } catch { /* уже мёртв */ }
      const c = st.child;
      setTimeout(() => { try { if (!c.killed) c.kill("SIGKILL"); } catch { /* уже мёртв */ } }, 5_000);
      st.child = null;
    }
  }

  restart(kind: ProcKind): void {
    this.stop(kind);
    this.start(kind);
  }

  stopAll(): void {
    for (const kind of this.procs.keys()) this.stop(kind);
  }

  status(kind: ProcKind): ProcStatus {
    const st = this.procs.get(kind);
    if (!st) {
      return { kind, alive: false, pid: null, restarts: 0, attached: false, lastExitCode: null, lastError: null, startedAt: null, healthy: false };
    }
    return {
      kind,
      alive: st.child !== null,
      pid: st.child?.pid ?? null,
      restarts: st.restarts,
      attached: st.attached,
      lastExitCode: st.lastExitCode,
      lastError: st.lastError,
      startedAt: st.startedAt,
      healthy: st.healthy,
    };
  }

  statusAll(): Record<ProcKind, ProcStatus> {
    return { daemon: this.status("daemon"), ui: this.status("ui") };
  }
}
