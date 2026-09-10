'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const REPO_SOURCE_TRACKER_SCHEMA = 'metaengine.development-plane.repo-source-tracker.v1';
const SHA_RE = /^[0-9a-f]{40}$/;

function validRepository(value) {
  const repository = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('repo_source_repository_invalid');
  return repository;
}

async function readText(file) {
  return (await fsp.readFile(file, 'utf8')).trim();
}

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

async function resolveGitDirs(repoRoot) {
  const marker = path.join(repoRoot, '.git');
  const stat = await fsp.stat(marker);
  let gitDir = marker;
  if (stat.isFile()) {
    const text = await readText(marker);
    if (!text.startsWith('gitdir: ')) throw new Error('repo_git_pointer_invalid');
    gitDir = path.resolve(repoRoot, text.slice('gitdir: '.length).trim());
  }
  let commonDir = gitDir;
  const commonMarker = path.join(gitDir, 'commondir');
  if (await exists(commonMarker)) commonDir = path.resolve(gitDir, await readText(commonMarker));
  return { gitDir, commonDir };
}

async function resolveRef(ref, gitDir, commonDir) {
  for (const base of new Set([gitDir, commonDir])) {
    const loose = path.join(base, ref);
    try {
      const sha = (await readText(loose)).toLowerCase();
      if (SHA_RE.test(sha)) return sha;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const packed = path.join(commonDir, 'packed-refs');
  try {
    const text = await fsp.readFile(packed, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('#') || line.startsWith('^')) continue;
      const space = line.indexOf(' ');
      if (space < 0) continue;
      const sha = line.slice(0, space).toLowerCase();
      const name = line.slice(space + 1).trim();
      if (name === ref && SHA_RE.test(sha)) return sha;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return null;
}

async function readGitSource(repoRoot, repository) {
  const { gitDir, commonDir } = await resolveGitDirs(repoRoot);
  const headText = await readText(path.join(gitDir, 'HEAD'));
  if (headText.startsWith('ref: ')) {
    const ref = headText.slice(5).trim();
    const head = await resolveRef(ref, gitDir, commonDir);
    if (!head) throw new Error('repo_head_unavailable');
    return { source: { repository_present: true, repository, head, ref }, gitDir, commonDir, ref };
  }
  const head = headText.toLowerCase();
  if (!SHA_RE.test(head)) throw new Error('repo_head_unavailable');
  return { source: { repository_present: true, repository, head, ref: null }, gitDir, commonDir, ref: null };
}

async function readPackagedSource(sourceProvenancePath, repository) {
  const provenance = JSON.parse(await fsp.readFile(sourceProvenancePath, 'utf8'));
  const repo = validRepository(provenance?.repository || repository);
  const head = String(provenance?.head || '').toLowerCase();
  const ref = provenance?.ref == null ? null : String(provenance.ref);
  if (provenance?.schema !== 'metaengine.devos.packaged-source-snapshot.v1' || !SHA_RE.test(head)) throw new Error('repo_packaged_provenance_invalid');
  return { repository_present: true, repository: repo, head, ref, packaged_source_snapshot: true };
}

class RepoSourceTracker {
  #repoRoot;
  #repository;
  #sourceProvenancePath;
  #watcherFactory;
  #watchers = [];
  #source = null;
  #dirty = true;
  #epoch = 0;
  #refreshes = 0;
  #lastError = null;
  #watching = false;

  constructor({ repoRoot, repository, sourceProvenancePath = null, watcherFactory = fs.watch } = {}) {
    this.#repoRoot = path.resolve(String(repoRoot || ''));
    this.#repository = validRepository(repository);
    this.#sourceProvenancePath = path.resolve(sourceProvenancePath || path.join(this.#repoRoot, '.metaengine-source-provenance.json'));
    if (typeof watcherFactory !== 'function') throw new Error('repo_source_watcher_invalid');
    this.#watcherFactory = watcherFactory;
  }

  invalidate() {
    this.#dirty = true;
    this.#epoch += 1;
    return this.snapshot();
  }

  #watch(target) {
    try {
      const watcher = this.#watcherFactory(target, { persistent: false }, () => this.invalidate());
      watcher?.on?.('error', (error) => {
        this.#lastError = String(error?.code || error?.message || error).slice(0, 160);
        this.invalidate();
      });
      this.#watchers.push(watcher);
    } catch (error) {
      if (error?.code !== 'ENOENT') this.#lastError = String(error?.code || error?.message || error).slice(0, 160);
    }
  }

  async #installGitWatchers(gitDir, commonDir, ref) {
    if (this.#watching) return;
    this.#watching = true;
    this.#watch(path.join(gitDir, 'HEAD'));
    this.#watch(gitDir);
    if (commonDir !== gitDir) this.#watch(commonDir);
    this.#watch(path.join(commonDir, 'packed-refs'));
    if (ref) {
      this.#watch(path.join(gitDir, ref));
      if (commonDir !== gitDir) this.#watch(path.join(commonDir, ref));
      this.#watch(path.dirname(path.join(commonDir, ref)));
    }
  }

  async refresh() {
    try {
      const gitMarker = path.join(this.#repoRoot, '.git');
      let resolved;
      try {
        resolved = await readGitSource(this.#repoRoot, this.#repository);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        this.#source = await readPackagedSource(this.#sourceProvenancePath, this.#repository);
        this.#dirty = false;
        this.#refreshes += 1;
        this.#lastError = null;
        return this.snapshot();
      }
      void gitMarker;
      this.#source = resolved.source;
      this.#dirty = false;
      this.#refreshes += 1;
      this.#lastError = null;
      await this.#installGitWatchers(resolved.gitDir, resolved.commonDir, resolved.ref);
      return this.snapshot();
    } catch (error) {
      this.#lastError = String(error?.message || error).slice(0, 160);
      throw error;
    }
  }

  async get() {
    if (this.#dirty || !this.#source) await this.refresh();
    return Object.freeze({ ...this.#source });
  }

  close() {
    for (const watcher of this.#watchers.splice(0)) {
      try { watcher?.close?.(); } catch {}
    }
    this.#watching = false;
  }

  snapshot() {
    return Object.freeze({
      schema: REPO_SOURCE_TRACKER_SCHEMA,
      source: this.#source ? { ...this.#source } : null,
      source_epoch: this.#epoch,
      dirty: this.#dirty,
      refresh_count: this.#refreshes,
      watcher_count: this.#watchers.length,
      watcher_enabled: this.#watching,
      last_error: this.#lastError,
      warm_get_filesystem_reads: 0,
      authority_effect: false,
    });
  }
}

module.exports = Object.freeze({ REPO_SOURCE_TRACKER_SCHEMA, RepoSourceTracker });
