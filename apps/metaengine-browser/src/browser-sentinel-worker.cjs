'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STATE_PATH = String(process.env.METAENGINE_SENTINEL_STATE_PATH || '');
const TOKEN = String(process.env.METAENGINE_SENTINEL_TOKEN || '');
const PARENT_PID = Number(process.env.METAENGINE_SENTINEL_PARENT_PID || 0);
const POLL_MS = 2000;
const EXPECTED_RESTART_GRACE_MS = 45000;
const RELAUNCH_ACK_TIMEOUT_MS = 5000;

async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_PATH, 'utf8')); }
  catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
}

async function writeState(value) {
  const next = { ...value, updated_at: new Date().toISOString(), authority_effect: false };
  const temp = `${STATE_PATH}.tmp`;
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, STATE_PATH);
}

function parentAlive() {
  if (!Number.isSafeInteger(PARENT_PID) || PARENT_PID <= 0) return false;
  try { process.kill(PARENT_PID, 0); return true; }
  catch (error) { return error && error.code === 'EPERM'; }
}

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

async function relaunchOnce(state) {
  if (state.relaunch_attempted === true) return;
  const intent = {
    ...state,
    lifecycle: 'RELAUNCH_INTENT',
    relaunch_attempted: true,
    relaunch_intent_at: new Date().toISOString(),
    relaunch_pid: null,
    relaunch_result: null,
  };
  await writeState(intent);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.METAENGINE_SENTINEL_STATE_PATH;
  delete env.METAENGINE_SENTINEL_TOKEN;
  delete env.METAENGINE_SENTINEL_PARENT_PID;

  let child;
  try {
    child = spawn(state.executable, [`--metaengine-sentinel-recovery=${TOKEN}`], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
      env,
    });
  } catch (error) {
    await writeState({
      ...intent,
      lifecycle: 'RELAUNCH_FAILED',
      relaunch_result: String(error && error.message || error).slice(0, 240),
    });
    return;
  }

  const outcome = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ lifecycle: 'RELAUNCH_AMBIGUOUS', pid: null, result: 'spawn_ack_timeout' }), RELAUNCH_ACK_TIMEOUT_MS);
    child.once('spawn', () => finish({ lifecycle: 'RELAUNCH_DISPATCHED', pid: Number(child.pid || 0) || null, result: `pid:${child.pid || 0}` }));
    child.once('error', (error) => finish({ lifecycle: 'RELAUNCH_FAILED', pid: null, result: String(error && error.message || error).slice(0, 240) }));
  });

  if (outcome.lifecycle === 'RELAUNCH_DISPATCHED') child.unref && child.unref();
  await writeState({
    ...intent,
    lifecycle: outcome.lifecycle,
    relaunch_pid: outcome.pid,
    relaunch_result: outcome.result,
  });
}

async function main() {
  if (!STATE_PATH || !TOKEN || !Number.isSafeInteger(PARENT_PID) || PARENT_PID <= 0) process.exit(2);
  const initial = await readState();
  if (!validBinding(initial)) process.exit(3);

  while (parentAlive()) await sleep(POLL_MS);

  let state = await readState();
  if (!validBinding(state)) return;
  if (state.lifecycle === 'PLANNED_SHUTDOWN') return;

  if (state.expected_restart === true || state.lifecycle === 'EXPECTED_RESTART') {
    if (await awaitExpectedSuccessor()) return;
    state = await readState();
    if (!validBinding(state)) return;
  }

  await relaunchOnce(state);
}

main().then(() => process.exit(0)).catch(async (error) => {
  try {
    const state = await readState();
    if (validBinding(state)) await writeState({ ...state, lifecycle: 'SENTINEL_ERROR', relaunch_result: String(error && error.message || error).slice(0, 240) });
  } catch {}
  process.exit(1);
});
