'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { durableWriteJson } = require('./durable-json-file.cjs');
const { BrowserSentinelActionJournal } = require('./browser-sentinel-action-journal.cjs');
const {
  DEFAULT_PARENT_TERMINATION_CONFIRM_MS,
  parentProgressPath,
  evaluateParentProgress,
} = require('./browser-sentinel-liveness.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STATE_PATH = String(process.env.METAENGINE_SENTINEL_STATE_PATH || '');
const TOKEN = String(process.env.METAENGINE_SENTINEL_TOKEN || '');
const PARENT_PID = Number(process.env.METAENGINE_SENTINEL_PARENT_PID || 0);
const POLL_MS = 2000;
const EXPECTED_RESTART_GRACE_MS = 45000;
const RELAUNCH_ACK_TIMEOUT_MS = 5000;
const RELAUNCH_RETRY_BASE_MS = 1000;
const RELAUNCH_RETRY_MAX_MS = 30000;
const RELAUNCH_RECEIPT_PATH = `${STATE_PATH}.relaunch-v1.json`;
const WORKER_HEARTBEAT_PATH = `${STATE_PATH}.worker-heartbeat-v1.json`;
const PARENT_PROGRESS_PATH = parentProgressPath(STATE_PATH);

async function readJson(target) {
  try { return JSON.parse(await fs.readFile(target, 'utf8')); }
  catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
}
async function readState() { return readJson(STATE_PATH); }
async function readParentProgress() { return readJson(PARENT_PROGRESS_PATH); }

async function writeWorkerHeartbeat() {
  const current = await readState().catch(() => null);
  if (!current || current.token !== TOKEN || Number(current.parent_pid) !== PARENT_PID) return false;
  const temp = `${WORKER_HEARTBEAT_PATH}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(WORKER_HEARTBEAT_PATH), { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify({
    schema: 'metaengine.browser-sentinel.worker-heartbeat.v1',
    token: TOKEN,
    parent_pid: PARENT_PID,
    worker_pid: process.pid,
    lifecycle: 'READY',
    heartbeat_at: new Date().toISOString(),
    authority_effect: false,
  }, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, WORKER_HEARTBEAT_PATH);
  return true;
}

function retryAllowedForOutcome(outcome) {
  const pid = Number(outcome?.pid || 0);
  return String(outcome?.lifecycle || '') === 'RELAUNCH_FAILED'
    && outcome?.relaunch_effect_absent === true
    && (!(Number.isSafeInteger(pid) && pid > 0) || outcome?.relaunch_pid_confirmed_absent === true);
}

async function writeRelaunchReceipt(state, outcome) {
  const receipt = {
    schema: 'metaengine.browser-sentinel.relaunch-receipt.v1',
    source_token: TOKEN,
    source_parent_pid: PARENT_PID,
    executable: String(state?.executable || ''),
    lifecycle: String(outcome?.lifecycle || 'RELAUNCH_AMBIGUOUS'),
    relaunch_pid: Number.isSafeInteger(Number(outcome?.pid)) && Number(outcome.pid) > 0 ? Number(outcome.pid) : null,
    relaunch_result: String(outcome?.result || '').slice(0, 240),
    relaunch_effect_absent: outcome?.relaunch_effect_absent === true,
    relaunch_pid_confirmed_absent: outcome?.relaunch_pid_confirmed_absent === true,
    automatic_retry_allowed: retryAllowedForOutcome(outcome),
    authority_effect: false,
    recorded_at: new Date().toISOString(),
  };
  await durableWriteJson(RELAUNCH_RECEIPT_PATH, receipt, { sequence: Date.now() });
  return receipt;
}

function processAlive(pid) {
  const exact = Number(pid || 0);
  if (!Number.isSafeInteger(exact) || exact <= 0) return false;
  try { process.kill(exact, 0); return true; }
  catch (error) { return error && error.code === 'EPERM'; }
}
function parentAlive() { return processAlive(PARENT_PID); }

function validBinding(state) {
  return Boolean(
    STATE_PATH && TOKEN && state && state.schema === 'metaengine.browser-sentinel.state.v1'
    && state.token === TOKEN && Number(state.parent_pid) === PARENT_PID
    && typeof state.executable === 'string' && state.executable.length > 0
  );
}

async function awaitExpectedSuccessor() {
  const deadline = Date.now() + EXPECTED_RESTART_GRACE_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const current = await readState().catch(() => null);
    if (!current || current.token !== TOKEN) return true;
  }
  return false;
}

async function terminateStalledParentOnce(state, decision, journal) {
  if (journal.terminationAttempted()) return false;
  await journal.beginTermination(state, decision);

  try {
    process.kill(PARENT_PID, 'SIGTERM');
  } catch (error) {
    if (!parentAlive()) {
      await journal.markTermination(state, 'PARENT_TERMINATION_CONFIRMED', 'parent_absent_after_signal_error');
      return true;
    }
    await journal.markTermination(state, 'PARENT_TERMINATION_AMBIGUOUS', String(error && error.message || error).slice(0, 240));
    return false;
  }

  const deadline = Date.now() + DEFAULT_PARENT_TERMINATION_CONFIRM_MS;
  while (Date.now() < deadline) {
    await sleep(250);
    if (!parentAlive()) {
      await journal.markTermination(state, 'PARENT_TERMINATION_CONFIRMED', 'exact_parent_pid_absent');
      return true;
    }
  }
  await journal.markTermination(state, 'PARENT_TERMINATION_AMBIGUOUS', 'exact_parent_pid_still_alive_after_signal');
  return false;
}

async function relaunchOnce(state, journal) {
  if (journal.relaunchAttempted()) return { lifecycle: 'RELAUNCH_BLOCKED', automatic_retry_allowed: false };
  await journal.beginRelaunch(state, 'EXACT_OLD_PARENT_ABSENT');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.METAENGINE_SENTINEL_STATE_PATH;
  delete env.METAENGINE_SENTINEL_TOKEN;
  delete env.METAENGINE_SENTINEL_PARENT_PID;

  let child;
  try {
    child = spawn(state.executable, [`--metaengine-sentinel-recovery=${TOKEN}`], { detached: true, stdio: 'ignore', shell: false, windowsHide: false, env });
  } catch (error) {
    const outcome = {
      lifecycle: 'RELAUNCH_FAILED', pid: null,
      result: String(error && error.message || error).slice(0, 240),
      relaunch_effect_absent: true,
      relaunch_pid_confirmed_absent: false,
    };
    await journal.markRelaunch(state, outcome);
    await writeRelaunchReceipt(state, outcome);
    return outcome;
  }

  const outcome = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({
      lifecycle: 'RELAUNCH_AMBIGUOUS', pid: null, result: 'spawn_ack_timeout',
      relaunch_effect_absent: false, relaunch_pid_confirmed_absent: false,
    }), RELAUNCH_ACK_TIMEOUT_MS);
    child.once('spawn', () => finish({
      lifecycle: 'RELAUNCH_DISPATCHED', pid: Number(child.pid || 0) || null, result: `pid:${child.pid || 0}`,
      relaunch_effect_absent: false, relaunch_pid_confirmed_absent: false,
    }));
    child.once('error', (error) => finish({
      lifecycle: 'RELAUNCH_FAILED', pid: null, result: String(error && error.message || error).slice(0, 240),
      relaunch_effect_absent: true, relaunch_pid_confirmed_absent: false,
    }));
  });

  if (outcome.lifecycle === 'RELAUNCH_DISPATCHED') child.unref && child.unref();
  await journal.markRelaunch(state, outcome);
  await writeRelaunchReceipt(state, outcome);
  return outcome;
}

async function awaitDispatchedRelaunchResolution(state, outcome, journal) {
  const pid = Number(outcome?.pid || 0);
  if (!Number.isSafeInteger(pid) || pid <= 0) return { lifecycle: 'RELAUNCH_AMBIGUOUS', automatic_retry_allowed: false };
  // Keep the old sentinel alive until either a successor writes a new binding or the
  // exact dispatched PID is positively absent. There is intentionally no time-based
  // replay permission here: time alone never converts an ambiguous spawn into a retry.
  while (true) {
    await sleep(POLL_MS);
    const current = await readState().catch(() => null);
    if (current && current.token !== TOKEN) return { lifecycle: 'SUCCESSOR_BOUND', automatic_retry_allowed: false };
    if (!current || !validBinding(current)) return { lifecycle: 'RELAUNCH_BINDING_AMBIGUOUS', automatic_retry_allowed: false };
    if (current.lifecycle === 'PLANNED_SHUTDOWN') return { lifecycle: 'PLANNED_SHUTDOWN', automatic_retry_allowed: false };
    if (!processAlive(pid)) {
      const failed = {
        lifecycle: 'RELAUNCH_FAILED', pid,
        result: 'exact_relaunch_pid_absent_without_successor_binding',
        relaunch_effect_absent: true,
        relaunch_pid_confirmed_absent: true,
      };
      await journal.confirmDispatchedRelaunchAbsent(state, pid, failed.result);
      await writeRelaunchReceipt(state, failed);
      return failed;
    }
  }
}

function retryBackoffMs(journal) {
  const attempt = Math.max(1, Number(journal.snapshot()?.relaunch_attempt || 1));
  return Math.min(RELAUNCH_RETRY_MAX_MS, RELAUNCH_RETRY_BASE_MS * (2 ** Math.min(10, attempt - 1)));
}

async function relaunchUntilResolved(state, journal) {
  while (true) {
    const current = await readState().catch(() => null);
    if (current && current.token !== TOKEN) return;
    if (!current || !validBinding(current) || current.lifecycle === 'PLANNED_SHUTDOWN' || parentAlive()) return;

    const outcome = await relaunchOnce(state, journal);
    if (retryAllowedForOutcome(outcome) && journal.relaunchRetryAllowed()) {
      await sleep(retryBackoffMs(journal));
      continue;
    }
    if (outcome.lifecycle === 'RELAUNCH_DISPATCHED') {
      const resolution = await awaitDispatchedRelaunchResolution(state, outcome, journal);
      if (retryAllowedForOutcome(resolution) && journal.relaunchRetryAllowed()) {
        await sleep(retryBackoffMs(journal));
        continue;
      }
      return;
    }
    // Ambiguous effects are terminal for actuation, not for evidence: never replay.
    return;
  }
}

async function main() {
  if (!STATE_PATH || !TOKEN || !Number.isSafeInteger(PARENT_PID) || PARENT_PID <= 0) process.exit(2);
  const initial = await readState();
  if (!validBinding(initial)) process.exit(3);
  const journal = new BrowserSentinelActionJournal({ statePath: STATE_PATH });
  await journal.init(initial);

  if (!(await writeWorkerHeartbeat())) process.exit(4);
  while (true) {
    await sleep(POLL_MS);
    if (!(await writeWorkerHeartbeat())) return;
    let state = await readState();
    if (!validBinding(state)) return;
    if (state.lifecycle === 'PLANNED_SHUTDOWN') return;
    if (!parentAlive()) break;

    const progress = await readParentProgress().catch(() => null);
    const decision = evaluateParentProgress({
      state: { ...state, parent_liveness_termination_attempted: journal.terminationAttempted() },
      progress,
    });
    if (decision.terminate_parent === true) {
      const terminated = await terminateStalledParentOnce(state, decision, journal);
      if (terminated) break;
    }
  }

  let state = await readState();
  if (!validBinding(state)) return;
  if (state.lifecycle === 'PLANNED_SHUTDOWN') return;

  if (state.expected_restart === true || state.lifecycle === 'EXPECTED_RESTART' || state.lifecycle === 'INSTALLER_HANDOFF') {
    if (await awaitExpectedSuccessor()) return;
    state = await readState();
    if (!validBinding(state)) return;
  }

  if (parentAlive()) return;
  await relaunchUntilResolved(state, journal);
}

main().then(() => process.exit(0)).catch(async (error) => {
  try {
    const state = await readState();
    if (validBinding(state)) {
      const journal = new BrowserSentinelActionJournal({ statePath: STATE_PATH });
      await journal.init(state);
      await journal.failClosed(state, String(error && error.message || error).slice(0, 240));
    }
  } catch {}
  process.exit(1);
});
