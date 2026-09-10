'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  DevOSRepoSearchIndex,
  ALLOWED_ROOTS,
} = require('./devos-repo-search-index.cjs');

const DEVOS_WORKTREE_REPO_SEARCH_SCHEMA = 'metaengine.development-plane.worktree-repo-search.v1';
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

function normalizeRelative(value) {
  if (value == null) return null;
  const normalized = String(value).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('\u0000')) return null;
  return normalized.slice(0, 500);
}

class WorktreeAwareDevOSRepoSearchIndex {
  #repoRoot;
  #watcherFactory;
  #index;
  #dirty = false;
  #worktreeEpoch = 0;
  #changeSeq = 0;
  #lastChange = null;
  #watchers = [];
  #watchErrors = [];
  #watching = false;

  constructor({ repoRoot, watch = false, watcherFactory = fs.watch } = {}) {
    const root = path.resolve(String(repoRoot || ''));
    if (!root) throw new Error('devos_worktree_repo_search_root_invalid');
    if (typeof watcherFactory !== 'function') throw new Error('devos_worktree_repo_search_watcher_invalid');
    this.#repoRoot = root;
    this.#watcherFactory = watcherFactory;
    this.#index = new DevOSRepoSearchIndex({ repoRoot: root });
    if (watch) this.startWatching();
  }

  invalidate({ event_type = 'change', relative_path = null, root = null } = {}) {
    this.#changeSeq += 1;
    this.#worktreeEpoch += 1;
    this.#dirty = true;
    this.#lastChange = Object.freeze({
      seq: this.#changeSeq,
      event_type: String(event_type || 'change').slice(0, 32),
      relative_path: normalizeRelative(relative_path),
      root: normalizeRelative(root),
      observed_at: new Date().toISOString(),
      authority_effect: false,
    });
    return this.snapshot();
  }

  #freshIndexIfNeeded() {
    if (!this.#dirty) return false;
    this.#index = new DevOSRepoSearchIndex({ repoRoot: this.#repoRoot });
    this.#dirty = false;
    return true;
  }

  #sourceRevision(inner = this.#index.snapshot()) {
    const head = String(inner?.head || '');
    const revision = String(inner?.revision || '');
    return `src:${sha256(`${head}:${this.#worktreeEpoch}:${revision}`)}`;
  }

  startWatching() {
    if (this.#watching) return this.snapshot();
    this.#watching = true;
    for (const root of ALLOWED_ROOTS) {
      const absolute = path.resolve(this.#repoRoot, root);
      try {
        const watcher = this.#watcherFactory(absolute, { recursive: true, persistent: false }, (eventType, filename) => {
          const relative = filename == null ? root : path.posix.join(root, String(filename).replaceAll('\\', '/'));
          this.invalidate({ event_type: eventType, relative_path: relative, root });
        });
        watcher?.on?.('error', (error) => {
          this.#watchErrors.push(`${root}:${String(error?.code || error?.message || error).slice(0, 120)}`);
          if (this.#watchErrors.length > 16) this.#watchErrors.shift();
          this.invalidate({ event_type: 'watch_error', root });
        });
        this.#watchers.push(watcher);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        this.#watchErrors.push(`${root}:${String(error?.code || error?.message || error).slice(0, 120)}`);
        if (this.#watchErrors.length > 16) this.#watchErrors.shift();
      }
    }
    return this.snapshot();
  }

  close() {
    for (const watcher of this.#watchers.splice(0)) {
      try { watcher?.close?.(); } catch {}
    }
    this.#watching = false;
    return this.snapshot();
  }

  async ensure(source) {
    const invalidated = this.#freshIndexIfNeeded();
    const result = await this.#index.ensure(source);
    return Object.freeze({
      rebuilt: invalidated || result.rebuilt,
      snapshot: this.snapshot(result.snapshot),
    });
  }

  async query(source, input = {}) {
    const invalidated = this.#freshIndexIfNeeded();
    const result = await this.#index.query(source, input);
    const inner = this.#index.snapshot();
    return Object.freeze({
      ...result,
      index_rebuilt: invalidated || result.index_rebuilt,
      worktree_epoch: this.#worktreeEpoch,
      source_revision: this.#sourceRevision(inner),
      search_strategy: 'HEAD_PLUS_WORKTREE_EVENT_INDEX',
      watcher_authority: false,
      authority_effect: false,
    });
  }

  snapshot(inner = this.#index.snapshot()) {
    return Object.freeze({
      ...inner,
      wrapper_schema: DEVOS_WORKTREE_REPO_SEARCH_SCHEMA,
      worktree_epoch: this.#worktreeEpoch,
      source_revision: this.#sourceRevision(inner),
      dirty_pending_rebuild: this.#dirty,
      watcher_enabled: this.#watching,
      watcher_count: this.#watchers.length,
      watcher_errors: Object.freeze([...this.#watchErrors]),
      last_change: this.#lastChange ? { ...this.#lastChange } : null,
      warm_query_filesystem_reads: 0,
      watcher_is_authority: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}

module.exports = Object.freeze({
  DEVOS_WORKTREE_REPO_SEARCH_SCHEMA,
  WorktreeAwareDevOSRepoSearchIndex,
});
