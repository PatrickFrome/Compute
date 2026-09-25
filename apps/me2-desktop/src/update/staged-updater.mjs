/**
 * Staged updater — poll → fetch manifest → verify → download → sha256 verify →
 * stage into userData → journal handoff record. NO silent execution: activation
 * is a separate, journaled, operator-visible step (Guardian parity lands next
 * round; this module guarantees the honest "staged, verified, handed off" state).
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { appendJournal, readJournal, readJson, writeJsonAtomic } from '../shared/durable-file.mjs';
import { UPDATE } from '../shared/me2-constants.mjs';
import { verifyManifest, shouldTakeUpdate, verifyFileEntry } from './verified-manifest.mjs';

export class StagedUpdater {
  constructor({ userDataDir, currentVersion, runningSourceSha = null, manifestUrl = '', fetchImpl = fetch, log = () => {} }) {
    this.userDataDir = userDataDir;
    this.currentVersion = currentVersion;
    this.runningSourceSha = runningSourceSha;
    this.fetchImpl = fetchImpl;
    this.manifestUrl = manifestUrl;
    this.log = log;
    this.stagedDir = join(userDataDir, UPDATE.STAGED_DIR_NAME);
    this.journalFile = join(userDataDir, UPDATE.JOURNAL_NAME);
    this.state = readJson(join(userDataDir, 'update-state.json')) ?? { last_check: null, last_staged: null };
  }

  journal(record) {
    return appendJournal(this.journalFile, { plane: 'update', ...record });
  }

  journalHistory() {
    const [records, corrupt] = readJournal(this.journalFile);
    return { records, corrupt };
  }

  async checkOnce({ manifestUrl = this.manifestUrl } = {}) {
    if (!manifestUrl) return { ok: false, reason: 'update_channel_not_configured' };
    this.journal({ stage: 'poll', manifestUrl });
    let res;
    try {
      res = await this.fetchImpl(manifestUrl, { signal: AbortSignal.timeout(20000) });
    } catch (err) {
      this.journal({ stage: 'poll_failed', error: String(err?.message ?? err).slice(0, 200) });
      return { ok: false, reason: 'network_error' };
    }
    if (!res.ok) {
      this.journal({ stage: 'poll_failed', status: res.status });
      return { ok: false, reason: `http_${res.status}` };
    }
    const raw = await res.text();
    const verdict = verifyManifest(raw);
    if (!verdict.ok) {
      this.journal({ stage: 'manifest_rejected', reason: verdict.reason });
      return { ok: false, reason: verdict.reason };
    }
    const manifest = verdict.manifest;
    const decision = shouldTakeUpdate({
      current: this.currentVersion,
      candidate: manifest.version,
      minPrevious: manifest.min_previous_version,
      sourceSha: manifest.source_sha,
      runningSourceSha: this.runningSourceSha,
    });
    this.journal({ stage: 'decision', current: this.currentVersion, candidate: manifest.version, ...decision });
    if (!decision.take) return { ok: true, staged: false, ...decision };
    return this.stageManifest(manifest);
  }

  async stageManifest(manifest) {
    const validated = verifyManifest(manifest);
    if (!validated.ok) return validated;
    await mkdir(this.stagedDir, { recursive: true });
    const targetDir = join(this.stagedDir, manifest.version);
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    for (const entry of manifest.files) {
      const dest = join(targetDir, entry.name.replace(/[\\/]/g, '_'));
      let res;
      try {
        res = await this.fetchImpl(entry.url, { signal: AbortSignal.timeout(120000) });
      } catch (err) {
        this.journal({ stage: 'download_failed', file: entry.name, error: String(err?.message ?? err).slice(0, 200) });
        return { ok: false, reason: 'download_error', file: entry.name };
      }
      if (!res.ok) {
        this.journal({ stage: 'download_failed', file: entry.name, status: res.status });
        return { ok: false, reason: `download_http_${res.status}`, file: entry.name };
      }
      const hash = createHash('sha256');
      let size = 0;
      const sink = createWriteStream(dest);
      const source = Readable.fromWeb(res.body);
      source.on('data', (chunk) => {
        hash.update(chunk);
        size += chunk.length;
      });
      await pipeline(source, sink);
      const verdict = verifyFileEntry(entry, hash.digest('hex'), size);
      if (!verdict.ok) {
        await rm(dest, { force: true });
        this.journal({ stage: 'verify_failed', ...verdict });
        return { ok: false, ...verdict };
      }
    }
    const record = {
      stage: 'staged',
      version: manifest.version,
      dir: targetDir,
      files: manifest.files.map((f) => f.name),
      handed_off: false, // No installer activation/qualification has occurred.
    };
    this.journal(record);
    this.state = { ...this.state, last_check: new Date().toISOString(), last_staged: manifest.version };
    writeJsonAtomic(join(this.userDataDir, 'update-state.json'), this.state);
    await this.pruneRetention();
    return { ok: true, staged: true, version: manifest.version, dir: targetDir };
  }

  async pruneRetention() {
    let names;
    try {
      names = await readdir(this.stagedDir);
    } catch {
      return;
    }
    const withTimes = [];
    for (const name of names) {
      try {
        const st = await stat(join(this.stagedDir, name));
        withTimes.push({ name, mtime: st.mtimeMs });
      } catch {
        /* raced removal — honest skip */
      }
    }
    withTimes.sort((a, b) => b.mtime - a.mtime);
    for (const old of withTimes.slice(UPDATE.MAX_STAGED_RETENTION)) {
      await rm(join(this.stagedDir, old.name), { recursive: true, force: true });
      this.journal({ stage: 'pruned', version: old.name });
    }
  }

  stagedVersions() {
    return this.journalHistory().records.filter((r) => r.stage === 'staged').map((r) => r.version);
  }
}
