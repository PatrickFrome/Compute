import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const BROWSER_BRAIN_DURABLE_PERSISTENCE_SCHEMA = 'metaengine.browser-brain.durable-persistence.v1';
export const BROWSER_BRAIN_DURABLE_FILE_NAME = 'metaengine-browser-brain-collaboration-v1.json';
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

function boundedBytes(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_MAX_BYTES;
  return Math.max(64 * 1024, Math.min(128 * 1024 * 1024, parsed));
}

export class BrowserBrainDurablePersistence {
  #filePath;
  #maxBytes;
  #loads = 0;
  #saves = 0;
  #loadMisses = 0;
  #loadErrors = 0;
  #lastError = null;

  constructor({ filePath, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    const normalized = path.resolve(String(filePath || ''));
    if (!normalized || normalized === path.parse(normalized).root) throw new Error('browser_brain_persistence_path_invalid');
    this.#filePath = normalized;
    this.#maxBytes = boundedBytes(maxBytes);
  }

  loadSync() {
    try {
      const stat = fs.statSync(this.#filePath);
      if (!stat.isFile() || stat.size < 2 || stat.size > this.#maxBytes) throw new Error('browser_brain_persistence_size_invalid');
      const value = JSON.parse(fs.readFileSync(this.#filePath, 'utf8'));
      this.#loads += 1;
      this.#lastError = null;
      return value;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.#loadMisses += 1;
        this.#lastError = null;
        return null;
      }
      if (error instanceof SyntaxError) {
        this.#loadErrors += 1;
        this.#lastError = 'CHECKPOINT_JSON_INVALID';
        return null;
      }
      this.#loadErrors += 1;
      this.#lastError = String(error?.message || error).slice(0, 240);
      return null;
    }
  }

  async save(value) {
    const body = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(body, 'utf8') > this.#maxBytes) throw new Error('browser_brain_persistence_checkpoint_too_large');
    const dir = path.dirname(this.#filePath);
    const temp = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.mkdir(dir, { recursive: true });
    try {
      await fsp.writeFile(temp, body, { mode: 0o600 });
      await fsp.rename(temp, this.#filePath);
      this.#saves += 1;
      this.#lastError = null;
    } catch (error) {
      this.#lastError = String(error?.message || error).slice(0, 240);
      await fsp.unlink(temp).catch(() => {});
      throw error;
    }
    return Object.freeze({ ok: true, bytes: Buffer.byteLength(body, 'utf8'), authority_effect: false });
  }

  snapshot() {
    return Object.freeze({
      schema: BROWSER_BRAIN_DURABLE_PERSISTENCE_SCHEMA,
      file_name: path.basename(this.#filePath),
      max_bytes: this.#maxBytes,
      load_count: this.#loads,
      save_count: this.#saves,
      load_miss_count: this.#loadMisses,
      load_error_count: this.#loadErrors,
      last_error: this.#lastError,
      atomic_temp_rename: true,
      file_mode: '0600',
      checkpoint_body_authority: false,
      scheduler_authority: false,
      execution_authority: false,
      authority_effect: false,
    });
  }
}

export function createBrowserBrainDurablePersistenceForApp(app, { fileName = BROWSER_BRAIN_DURABLE_FILE_NAME, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!app || typeof app.getPath !== 'function') throw new Error('browser_brain_persistence_app_required');
  const userData = String(app.getPath('userData') || '');
  if (!userData) throw new Error('browser_brain_persistence_user_data_unavailable');
  return new BrowserBrainDurablePersistence({ filePath: path.join(userData, String(fileName)), maxBytes });
}
