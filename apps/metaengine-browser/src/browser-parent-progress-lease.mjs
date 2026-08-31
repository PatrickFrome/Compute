import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parentProgressPath } = require('./browser-sentinel-liveness.cjs');

async function atomicWrite(target, value) {
  const temp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, target);
}

export class BrowserParentProgressLease {
  #statePath;
  #getBinding;
  #seq = 0;
  #last = null;

  constructor({ statePath, getBinding } = {}) {
    if (!statePath || typeof getBinding !== 'function') throw new Error('browser_parent_progress_dependencies_required');
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

  async mark({ kind = 'CONTROL_PLANE_CYCLE', detail = null } = {}) {
    const binding = this.#getBinding();
    const token = String(binding?.token || '');
    const parentPid = Number(binding?.parent_pid || 0);
    if (!token || !Number.isSafeInteger(parentPid) || parentPid !== process.pid) {
      throw new Error('browser_parent_progress_binding_invalid');
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
    await atomicWrite(parentProgressPath(this.#statePath), row);
    this.#last = Object.freeze(row);
    return this.snapshot();
  }
}
