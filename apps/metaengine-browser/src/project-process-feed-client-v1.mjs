import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROJECT_PROCESS_FEED_CLIENT_VERSION = '1.0.0';
const DEFAULT_MANIFEST = path.join(os.homedir(), '.a2', 'project-process-feed.json');

export function validateProjectProcessFeedManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('project_process_feed_manifest_invalid');
  const url = new URL(String(input.url || ''));
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname.toLowerCase()) || url.pathname !== '/rpc') {
    throw new Error('project_process_feed_endpoint_not_loopback_rpc');
  }
  const token = String(input.token || '');
  if (!token || token.length > 4096) throw new Error('project_process_feed_token_invalid');
  return Object.freeze({ url: url.href, token });
}

export class ProjectProcessFeedClient {
  #manifestPath;
  #fetch;

  constructor({ manifestPath = process.env.METAENGINE_PROJECT_PROCESS_FEED_MANIFEST || DEFAULT_MANIFEST, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('project_process_feed_fetch_required');
    this.#manifestPath = manifestPath;
    this.#fetch = fetchImpl;
  }

  async readManifest() {
    return validateProjectProcessFeedManifest(JSON.parse(await fs.readFile(this.#manifestPath, 'utf8')));
  }

  async snapshot() {
    const manifest = await this.readManifest();
    const response = await this.#fetch(manifest.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${manifest.token}`,
      },
      body: JSON.stringify({ method: 'project.process.snapshot', params: {}, id: `process-${crypto.randomUUID()}` }),
    });
    if (!response.ok) throw new Error(`project_process_feed_http_${response.status}`);
    const body = await response.json();
    if (body?.ok !== true || body?.effect_class !== 'READ_ONLY' || body?.authority_effect !== false) {
      throw new Error('project_process_feed_read_contract_failed');
    }
    if (body?.schema !== 'metaengine.project-process-feed.response.v1') throw new Error('project_process_feed_schema_invalid');
    if (!Array.isArray(body.observations)) throw new Error('project_process_feed_observations_invalid');
    if (body.observations.length > 4096) throw new Error('project_process_feed_observations_too_large');
    return {
      cursor: body.cursor == null ? null : String(body.cursor).slice(0, 500),
      observations: structuredClone(body.observations),
      authority_effect: false,
    };
  }

  asObserverSource(id = 'project-process-feed') {
    return Object.freeze({ id, read: () => this.snapshot() });
  }
}

export const PROJECT_PROCESS_FEED_POLICY = Object.freeze({
  transport: 'LOOPBACK_TYPED_RPC',
  method: 'project.process.snapshot',
  read_only: true,
  service_role_secret_in_browser: false,
  raw_database_credentials_in_browser: false,
  authority_effect: false,
});
