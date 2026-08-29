import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_FILENAME_RE = /^[0-9A-Za-z][0-9A-Za-z._ -]{0,179}$/;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const HARD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_REDIRECT_CHAIN = 12;

function clipError(error) { return String(error?.message || error || 'unknown_error').slice(0, 300); }
function clone(value) { return value == null ? value : structuredClone(value); }

function validateSafeHttpsUrl(value, errorPrefix = 'verified_download') {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 4096) throw new Error(`${errorPrefix}_url_invalid`);
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error(`${errorPrefix}_https_required`);
  if (url.username || url.password || url.hash) throw new Error(`${errorPrefix}_url_components_invalid`);
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127\./.test(hostname)) {
    throw new Error(`${errorPrefix}_loopback_blocked`);
  }
  return url.href;
}

export function validateVerifiedDownloadRequest(input = {}) {
  const safeUrl = validateSafeHttpsUrl(input?.url);
  const filename = String(input?.filename || '').trim();
  if (!SAFE_FILENAME_RE.test(filename) || filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) {
    throw new Error('verified_download_filename_invalid');
  }
  const expectedSha256 = String(input?.expected_sha256 || '').trim().toLowerCase();
  if (!SHA256_RE.test(expectedSha256)) throw new Error('verified_download_sha256_required');
  const maxBytes = Number(input?.max_bytes ?? DEFAULT_MAX_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > HARD_MAX_BYTES) throw new Error('verified_download_max_bytes_invalid');
  return Object.freeze({
    url: safeUrl,
    filename,
    expected_sha256: expectedSha256,
    max_bytes: maxBytes,
  });
}

function validateObservedChain(item, expectedUrl) {
  const rawChain = typeof item?.getURLChain === 'function' ? item.getURLChain() : [];
  const rawCurrent = String(item?.getURL?.() || '').trim();
  const chain = Array.isArray(rawChain) && rawChain.length > 0 ? rawChain.map(String) : (rawCurrent ? [rawCurrent] : []);
  if (chain.length === 0 || chain.length > MAX_REDIRECT_CHAIN) throw new Error('verified_download_url_chain_invalid');
  const normalized = chain.map((url) => validateSafeHttpsUrl(url, 'verified_download_redirect'));
  if (!normalized.includes(expectedUrl)) throw new Error('verified_download_url_binding_mismatch');
  return normalized;
}

export class VerifiedDownloadManager {
  #session;
  #root;
  #clock;
  #active = null;
  #last = null;
  #closed = false;
  #listener;

  constructor({ session, rootPath, clock = () => Date.now() } = {}) {
    if (!session || typeof session.on !== 'function' || typeof session.downloadURL !== 'function') throw new Error('verified_download_session_invalid');
    if (!rootPath || !path.isAbsolute(String(rootPath))) throw new Error('verified_download_root_invalid');
    this.#session = session;
    this.#root = path.resolve(String(rootPath));
    this.#clock = clock;
    this.#listener = (event, item) => { void this.#onWillDownload(event, item); };
    this.#session.on('will-download', this.#listener);
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.verified-download-manager.v1',
      root_path: this.#root,
      active: this.#active ? {
        request_id: this.#active.request_id,
        url: this.#active.request.url,
        filename: this.#active.request.filename,
        expected_sha256: this.#active.request.expected_sha256,
        max_bytes: this.#active.request.max_bytes,
        state: this.#active.state,
        received_bytes: this.#active.received_bytes,
        started_at: this.#active.started_at,
      } : null,
      last: clone(this.#last),
      arbitrary_execution: false,
      install_authority: false,
      authority_effect: false,
    });
  }

  async download(input = {}) {
    if (this.#closed) throw new Error('verified_download_manager_closed');
    if (this.#active) throw new Error('verified_download_busy');
    const request = validateVerifiedDownloadRequest(input);
    await fs.mkdir(this.#root, { recursive: true });
    const targetPath = path.join(this.#root, request.filename);
    const partialPath = `${targetPath}.partial`;
    await fs.rm(partialPath, { force: true });

    const requestId = crypto.randomUUID();
    const startedAt = new Date(this.#clock()).toISOString();
    let resolveResult;
    let rejectResult;
    const completion = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    this.#active = {
      request_id: requestId,
      request,
      state: 'ARMED',
      received_bytes: 0,
      started_at: startedAt,
      target_path: targetPath,
      partial_path: partialPath,
      item: null,
      settled: false,
      resolve: resolveResult,
      reject: rejectResult,
    };

    try {
      this.#session.downloadURL(request.url);
    } catch (error) {
      await this.#failActive(error);
    }
    return completion;
  }

  async cancel() {
    const active = this.#active;
    if (!active) return { cancelled: false, authority_effect: false };
    try { active.item?.cancel?.(); } catch {}
    await this.#failActive(new Error('verified_download_cancelled'));
    return { cancelled: true, request_id: active.request_id, authority_effect: true };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.cancel().catch(() => {});
    this.#session.removeListener?.('will-download', this.#listener);
  }

  async #onWillDownload(event, item) {
    const active = this.#active;
    if (!active || active.settled) {
      event?.preventDefault?.();
      try { item?.cancel?.(); } catch {}
      return;
    }

    let chain;
    try {
      chain = validateObservedChain(item, active.request.url);
    } catch (error) {
      event?.preventDefault?.();
      try { item?.cancel?.(); } catch {}
      await this.#failActive(error);
      return;
    }

    active.item = item;
    active.state = 'DOWNLOADING';
    active.url_chain = chain;
    item.setSavePath(active.partial_path);
    item.on?.('updated', () => {
      if (!this.#active || this.#active.request_id !== active.request_id || active.settled) return;
      const received = Number(item.getReceivedBytes?.() || 0);
      active.received_bytes = Math.max(0, received);
      if (active.received_bytes > active.request.max_bytes) {
        try { item.cancel?.(); } catch {}
        void this.#failActive(new Error('verified_download_size_limit_exceeded'));
      }
    });
    item.once?.('done', (_event, state) => { void this.#finishActive(active, item, state); });
  }

  async #finishActive(active, item, state) {
    if (!this.#active || this.#active.request_id !== active.request_id || active.settled) return;
    if (state !== 'completed') {
      await this.#failActive(new Error(`verified_download_${String(state || 'failed')}`));
      return;
    }
    try {
      const stat = await fs.stat(active.partial_path);
      if (!stat.isFile() || stat.size < 1 || stat.size > active.request.max_bytes) throw new Error('verified_download_size_invalid');
      const hash = crypto.createHash('sha256');
      const handle = await fs.open(active.partial_path, 'r');
      try {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let offset = 0;
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
          if (!bytesRead) break;
          hash.update(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
      } finally {
        await handle.close();
      }
      const actualSha256 = hash.digest('hex');
      if (actualSha256 !== active.request.expected_sha256) throw new Error('verified_download_digest_mismatch');
      await fs.rm(active.target_path, { force: true });
      await fs.rename(active.partial_path, active.target_path);
      const row = {
        schema: 'metaengine.verified-download-receipt.v1',
        request_id: active.request_id,
        url: active.request.url,
        url_chain: clone(active.url_chain || [active.request.url]),
        filename: active.request.filename,
        path: active.target_path,
        bytes: stat.size,
        sha256: actualSha256,
        completed_at: new Date(this.#clock()).toISOString(),
        executable_started: false,
        authority_effect: true,
      };
      active.settled = true;
      this.#last = row;
      this.#active = null;
      active.resolve(row);
    } catch (error) {
      await this.#failActive(error);
    }
  }

  async #failActive(error) {
    const active = this.#active;
    if (!active || active.settled) return;
    active.settled = true;
    try { active.item?.cancel?.(); } catch {}
    await fs.rm(active.partial_path, { force: true }).catch(() => {});
    const row = {
      schema: 'metaengine.verified-download-failure.v1',
      request_id: active.request_id,
      filename: active.request.filename,
      error: clipError(error),
      failed_at: new Date(this.#clock()).toISOString(),
      executable_started: false,
      authority_effect: false,
    };
    this.#last = row;
    this.#active = null;
    active.reject(new Error(row.error));
  }
}
