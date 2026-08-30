import fs from 'node:fs/promises';
import path from 'node:path';
import { parseMetaengineDevVersion } from './trusted-dev-release-resolver.mjs';

export const TRUSTED_RELEASE_HISTORY_SCHEMA = 'metaengine.trusted-release-history.v1';
export const TRUSTED_RELEASE_HISTORY_FILE = 'metaengine-trusted-release-history-v1.json';

function safeDigest(value) {
  const text = String(value || '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(text) ? text : null;
}

function safeSha(value) {
  const text = String(value || '').toLowerCase();
  return /^[0-9a-f]{40}$/.test(text) ? text : null;
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('trusted_release_history_invalid');
  if (value.schema !== TRUSTED_RELEASE_HISTORY_SCHEMA || value.authority_effect !== false) throw new Error('trusted_release_history_schema_invalid');
  const parsed = parseMetaengineDevVersion(value.highest_version);
  if (!parsed || parsed.core !== String(value.core || '') || parsed.build !== Number(value.highest_build)) {
    throw new Error('trusted_release_history_version_invalid');
  }
  const gitSha = safeSha(value.git_sha);
  const manifestSha = safeDigest(value.manifest_sha256);
  const devYmlSha = safeDigest(value.dev_yml_sha256);
  if (!gitSha || !manifestSha || !devYmlSha) throw new Error('trusted_release_history_digest_invalid');
  if (String(value.tag || '') !== `v${parsed.version}`) throw new Error('trusted_release_history_tag_invalid');
  return {
    schema: TRUSTED_RELEASE_HISTORY_SCHEMA,
    core: parsed.core,
    highest_build: parsed.build,
    highest_version: parsed.version,
    tag: `v${parsed.version}`,
    git_sha: gitSha,
    manifest_sha256: manifestSha,
    dev_yml_sha256: devYmlSha,
    recorded_at: String(value.recorded_at || ''),
    authority_effect: false,
  };
}

async function readJson(file) {
  try {
    return normalizeRecord(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

function recordFromRelease(release, now = new Date()) {
  const parsed = parseMetaengineDevVersion(release?.version);
  if (!parsed) throw new Error('trusted_release_history_candidate_version_invalid');
  const gitSha = safeSha(release?.git_sha);
  const manifestSha = safeDigest(release?.manifest_sha256);
  const devYmlSha = safeDigest(release?.dev_yml_sha256);
  if (!gitSha || !manifestSha || !devYmlSha || String(release?.tag || '') !== `v${parsed.version}`) {
    throw new Error('trusted_release_history_candidate_binding_invalid');
  }
  return {
    schema: TRUSTED_RELEASE_HISTORY_SCHEMA,
    core: parsed.core,
    highest_build: parsed.build,
    highest_version: parsed.version,
    tag: `v${parsed.version}`,
    git_sha: gitSha,
    manifest_sha256: manifestSha,
    dev_yml_sha256: devYmlSha,
    recorded_at: now.toISOString(),
    authority_effect: false,
  };
}

export class TrustedReleaseHistory {
  #statePath;
  #clock;
  #loaded = false;
  #record = null;

  constructor({ statePath, clock = () => new Date() } = {}) {
    if (!statePath) throw new Error('trusted_release_history_path_required');
    if (typeof clock !== 'function') throw new Error('trusted_release_history_clock_invalid');
    this.#statePath = String(statePath);
    this.#clock = clock;
  }

  async load() {
    if (!this.#loaded) {
      this.#record = await readJson(this.#statePath);
      this.#loaded = true;
    }
    return this.snapshot();
  }

  snapshot() {
    return this.#record ? structuredClone(this.#record) : null;
  }

  async observe(release) {
    await this.load();
    const candidate = recordFromRelease(release, this.#clock());
    const previous = this.#record;
    if (previous && previous.core === candidate.core) {
      if (candidate.highest_build < previous.highest_build) {
        throw new Error(`trusted_release_rollback_detected:${candidate.highest_version}:${previous.highest_version}`);
      }
      if (candidate.highest_build === previous.highest_build) {
        const equivalent = candidate.highest_version === previous.highest_version
          && candidate.tag === previous.tag
          && candidate.git_sha === previous.git_sha
          && candidate.manifest_sha256 === previous.manifest_sha256
          && candidate.dev_yml_sha256 === previous.dev_yml_sha256;
        if (!equivalent) throw new Error(`trusted_release_equivocation_detected:${candidate.highest_version}`);
        return this.snapshot();
      }
    }
    await writeJsonAtomic(this.#statePath, candidate);
    this.#record = candidate;
    return this.snapshot();
  }
}
