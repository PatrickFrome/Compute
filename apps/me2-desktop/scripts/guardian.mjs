#!/usr/bin/env node
/**
 * METAENGINE Desktop — external guardian (R81, GAP #2: Guardian-parity light).
 *
 * Legacy parity of the native supervisor's watchdog, honestly reduced to the
 * zero-based client: watch the beacon, resurrect a fallen client, journal
 * everything with the SAME durable JSONL contract, never storm.
 *
 *   node scripts/guardian.mjs \
 *     --user-data-dir <dir> \        # the client's userData (beacon + journals)
 *     --client-cmd "<command>" \     # full command line to (re)start the client
 *     [--interval 5000] [--once]     # watch cadence; --once = single verdict
 *
 * Honest semantics:
 *   · clean_exit beacon (operator quit) is NEVER fought — monitor only.
 *   · restart backoff 15s→120s, reset after 5 min of stability.
 *   · restart cap 8/hour (sliding window read from the journal — evidence
 *     over memory, survives guardian restarts) → give_up event, exit 5.
 *   · every observation decision is journaled: guardian_observation /
 *     guardian_restart / guardian_give_up / guardian_exit.
 *
 * Exit codes (--once): 0 alive|monitor · 4 restarted · 5 give_up.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LifecycleJournal } from '../src/core/journal.mjs';
import { readJson } from '../src/shared/durable-file.mjs';
import { evaluateBeacon, decideRestart, nextBackoffMs, computeRestartsInWindow } from '../src/me2/guardian-contract.mjs';
import { GUARDIAN } from '../src/shared/me2-constants.mjs';

function parseArgv(argv) {
  const out = { interval: GUARDIAN.WATCH_INTERVAL_MS, once: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--once') out.once = true;
    else if (a === '--interval') out.interval = Number(argv[++i]);
    else if (a === '--user-data-dir') out.userDataDir = argv[++i];
    else if (a === '--client-cmd') out.clientCmd = argv[++i];
    else return { error: `unknown_arg:${a}` };
  }
  if (!out.userDataDir) return { error: 'user_data_dir_required' };
  if (!out.clientCmd) return { error: 'client_cmd_required' };
  if (!Number.isFinite(out.interval) || out.interval < 1000) return { error: 'interval_invalid' };
  return out;
}

/** PID liveness — signal 0 probes existence without harming the process. */
function aliveImpl(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Detached client start: outlives the guardian by design (parity with legacy). */
function startClient(cmd) {
  const child = spawn(cmd, { shell: true, detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid ?? null };
}

export function createGuardian({ userDataDir, clientCmd, interval = GUARDIAN.WATCH_INTERVAL_MS, spawnImpl = startClient, aliveImpl: aliveProbe = aliveImpl, log = () => {} }) {
  const beaconFile = join(userDataDir, GUARDIAN.BEACON_NAME);
  const journal = new LifecycleJournal({ userDataDir, name: GUARDIAN.JOURNAL_NAME });

  const state = { backoffMs: GUARDIAN.BACKOFF_START_MS, lastRestartAt: null, lastAliveAt: null, stableSince: null, restarts: 0 };

  /** One honest observation → decision → (maybe) action → journal. */
  function tick(now = Date.now()) {
    const raw = readJson(beaconFile);
    const evaluation = evaluateBeacon({ beacon: raw, now, aliveImpl: aliveProbe });
    const records = journal.history().records;
    const restartsInWindow = computeRestartsInWindow(records, { now });

    if (evaluation.alive && state.lastAliveAt == null) state.lastAliveAt = now;
    const decision = decideRestart({
      alive: evaluation.alive,
      reason: evaluation.reason,
      restartsInWindow,
      now,
      lastRestartAt: state.lastRestartAt,
      currentBackoffMs: state.backoffMs,
      lastAliveAt: state.lastAliveAt,
    });

    if (decision.action === 'monitor') {
      if (decision.resetBackoff) {
        state.backoffMs = GUARDIAN.BACKOFF_START_MS;
        state.lastAliveAt = now;
      }
      state.restarts = 0; // recovered — a future give_up may journal again
    }
    if (decision.action === 'restart') {
      const { pid } = spawnImpl(clientCmd);
      state.lastRestartAt = now;
      state.lastAliveAt = null;
      state.restarts += 1;
      state.backoffMs = nextBackoffMs({ currentMs: state.backoffMs });
      journal.record('guardian_restart', { reason: decision.reason, backoff_ms: state.backoffMs, spawned_pid: pid });
    } else if (decision.action === 'give_up') {
      if (state.restarts !== Number.POSITIVE_INFINITY) journal.record('guardian_give_up', { reason: decision.reason, restarts_in_window: restartsInWindow });
      state.restarts = Number.POSITIVE_INFINITY; // journal once; stay honest, stay quiet
    } else {
      journal.record('guardian_observation', { action: decision.action, reason: decision.reason, alive: evaluation.alive });
    }
    log({ decision, evaluation, restartsInWindow });
    return { decision, evaluation, restartsInWindow };
  }

  return {
    tick,
    journal,
    beaconFile,
    start() {
      journal.record('guardian_boot', { interval_ms: interval, client_cmd: clientCmd });
      if (this._timer) clearInterval(this._timer);
      this._timer = setInterval(() => this.tick(), interval);
      this._timer.unref?.();
    },
    stop({ clean = true } = {}) {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      journal.record('guardian_exit', { clean });
    },
  };
}

/** CLI mode — the operator-facing entry (tests use createGuardian directly). */
const IS_CLI = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (IS_CLI) {
  const cfg = parseArgv(process.argv);
  if (cfg.error) {
    console.error(`[guardian] ${cfg.error}`);
    process.exit(2);
  }
  const guardian = createGuardian({ userDataDir: cfg.userDataDir, clientCmd: cfg.clientCmd, interval: cfg.interval });

  if (cfg.once) {
    const { decision, evaluation } = guardian.tick();
    console.log(JSON.stringify({ verdict: decision.action, reason: decision.reason, alive: evaluation.alive, evaluation: evaluation.reason }, null, 2));
    process.exit(decision.action === 'restart' ? 4 : decision.action === 'give_up' ? 5 : 0);
  }

  guardian.start();
  console.log(`[guardian] watching ${guardian.beaconFile} every ${cfg.interval}ms — Ctrl+C to stop`);
  const shutdown = (sig) => { guardian.stop({ clean: true }); console.log(`[guardian] ${sig} — clean exit`); process.exit(0); };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
