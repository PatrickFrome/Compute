import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parentProgressPath } = require('./browser-sentinel-liveness.cjs');

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicWrite(target, value, sequence) {
  const directory = path.dirname(target);
  const temp = `${target}.${process.pid}.${Number(sequence) || 0}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  const handle = await fs.open(temp, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, target);
  // Windows requires a write-capable handle for FlushFileBuffers/fsync. Opening the
  // already-committed file r+ does not alter its contents and preserves cross-platform
  // post-rename durability without a second write.
  const committed = await fs.open(target, 'r+');
  try { await committed.sync(); } finally { await committed.close(); }
  await syncDirectory(directory);
}

export class BrowserParentProgressLease {
  #statePath;
  #getBinding;
  #seq = 0;
  #last = null;
  #writeTail = Promise.resolve();

  constructor({ statePath, getBinding = null } = {}) {
    if (!statePath || (getBinding != null && typeof getBinding !== 'function')) throw new Error('browser_parent_progress_dependencies_required');
    this.#statePath = String(statePath);
    this.#getBinding = getBinding;
  }

  snapshot() {
    return this.#last ? structuredClone(this.#last) : Object.freeze({
      schema: 'metaengine.browser-sentinel.parent-progress.v1',
      progress_seq: this.#seq,
      progress_at: null,
      progress_kind: null,
      authority_effect: false,
    });
  }

  async #binding() {
    const supplied = this.#getBinding?.();
    return supplied && typeof supplied.then === 'function' ? supplied : (supplied || readJson(this.#statePath));
  }

  async #markOne({ kind = 'CONTROL_PLANE_CYCLE', detail = null } = {}) {
    const binding = await this.#binding();
    const token = String(binding?.token || '');
    const parentPid = Number(binding?.parent_pid || 0);
    if (binding?.schema !== 'metaengine.browser-sentinel.state.v1' || !token || !Number.isSafeInteger(parentPid) || parentPid !== process.pid) {
      throw new Error('browser_parent_progress_binding_invalid');
    }
    if (binding?.lifecycle === 'PLANNED_SHUTDOWN' || binding?.expected_restart === true || binding?.installer_handoff === true) {
      return this.snapshot();
    }
    this.#seq += 1;
    const row = {
      schema: 'metaengine.browser-sentinel.parent-progress.v1',
      token,
      parent_pid: parentPid,
      progress_seq: this.#seq,
      progress_kind: String(kind || 'CONTROL_PLANE_CYCLE').slice(0, 80),
      detail: detail == null ? null : String(detail).slice(0, 160),
      progress_at: new Date().toISOString(),
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    await atomicWrite(parentProgressPath(this.#statePath), row, this.#seq);
    this.#last = Object.freeze(row);
    return this.snapshot();
  }

  mark({ kind = 'CONTROL_PLANE_CYCLE', detail = null } = {}) {
    const operation = this.#writeTail.then(() => this.#markOne({ kind, detail }));
    this.#writeTail = operation.catch(() => {});
    return operation;
  }
}
