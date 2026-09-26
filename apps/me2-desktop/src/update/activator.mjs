/**
 * Self-update activator (GAP #1a) — the missing half of the staged updater:
 *   stage (R78) → handoff (spawn installer on quit, journaled) →
 *   qualification (next boot: version verdict + boot-alive window) →
 *   rollback (honest journal when the update did not take).
 * NO silent execution: every transition is a journal record; the operator can
 * audit the whole activation chain from two JSONL files (update + lifecycle).
 * Without Guardian (R81 backlog): the rollback is honest bookkeeping — the
 * staged artifacts stay on disk for a retry, the pending record does not.
 */
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from '../shared/durable-file.mjs';
import { ACTIVATION } from '../shared/me2-constants.mjs';

/** Extract the handoff flag value from argv (pure): `--me2-activation <id>` or `--me2-activation=<id>`. */
export function extractActivationArg(argv = []) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === ACTIVATION.ARG_FLAG) return argv[i + 1] ?? null;
    if (typeof a === 'string' && a.startsWith(`${ACTIVATION.ARG_FLAG}=`)) {
      return a.slice(ACTIVATION.ARG_FLAG.length + 1) || null;
    }
  }
  return null;
}

/**
 * Pure boot verdict (R80 GAP #1a):
 *   idle                — nothing pending, no handoff flag
 *   qualifying          — handoff flag + pending match + expected version is running
 *   version_mismatch    — handoff flag + pending match, but the running version differs
 *   id_mismatch         — handoff flag does not match the pending record's id
 *   applied_unconfirmed — no flag, pending exists, expected version is running
 *                         (installer finished; the previous run never confirmed)
 *   rolled_back         — no flag, pending exists, running version differs
 *   orphan_flag         — handoff flag present but no pending record survived
 *   stale               — pending record older than PENDING_TTL_MS (never came back)
 */
export function resolveBootActivation({ argv = [], pending, currentVersion, now = Date.now() } = {}) {
  const flagId = extractActivationArg(argv);
  if (!flagId && !pending) return { verdict: 'idle' };
  if (pending?.started_at) {
    const started = Date.parse(pending.started_at);
    if (Number.isFinite(started) && now - started > ACTIVATION.PENDING_TTL_MS) {
      return { verdict: 'stale', pending };
    }
  }
  if (flagId && pending) {
    if (flagId !== pending.id) return { verdict: 'id_mismatch', pending };
    return currentVersion === pending.version
      ? { verdict: 'qualifying', pending }
      : { verdict: 'version_mismatch', pending };
  }
  if (flagId) return { verdict: 'orphan_flag', pending: null };
  return currentVersion === pending.version
    ? { verdict: 'applied_unconfirmed', pending }
    : { verdict: 'rolled_back', pending };
}

/**
 * Activation manager — durable, journaled, injectable-spawn. No electron
 * imports: the main process wires it in, tests run it pure (node --test).
 */
export class ActivationManager {
  constructor({ userDataDir, currentVersion, argv = process.argv, journal = () => {}, spawnImpl = null } = {}) {
    this.userDataDir = userDataDir;
    this.currentVersion = currentVersion;
    this.argv = argv;
    this.journal = journal;
    this.spawnImpl = spawnImpl;
    this.pendingFile = join(userDataDir, ACTIVATION.PENDING_NAME);
    this.state = { verdict: 'unresolved', pending: null, armed: false };
    this.qualifyTimer = null;
  }

  /** Resolve the boot verdict, journal it, schedule qualification or roll back. */
  resolveBoot({ autoQualify = true, now = Date.now() } = {}) {
    const pending = readJson(this.pendingFile);
    const resolved = resolveBootActivation({ argv: this.argv, pending, currentVersion: this.currentVersion, now });
    this.state = { verdict: resolved.verdict, pending: resolved.pending ?? null, armed: false };
    this.journal({ event: 'boot_verdict', verdict: resolved.verdict, expected: pending?.version ?? null, running: this.currentVersion });
    if (resolved.verdict === 'qualifying' || resolved.verdict === 'applied_unconfirmed') {
      if (autoQualify) {
        this.qualifyTimer = setTimeout(() => this.qualify(), ACTIVATION.QUALIFY_WINDOW_MS);
        this.qualifyTimer.unref?.();
      }
    } else if (pending) {
      // rollback family (version_mismatch / id_mismatch / rolled_back / stale):
      // the pending record has no future — clear it, keep staged artifacts.
      this.clearPending();
      this.journal({ event: 'rolled_back', reason: resolved.verdict, expected: pending.version });
    }
    return this.snapshot();
  }

  /** Boot-alive window elapsed without a crash → the update is qualified. */
  qualify() {
    if (this.qualifyTimer) {
      clearTimeout(this.qualifyTimer);
      this.qualifyTimer = null;
    }
    if (this.state.verdict !== 'qualifying' && this.state.verdict !== 'applied_unconfirmed') {
      return { ok: false, reason: `not_qualifying:${this.state.verdict}` };
    }
    this.state = { ...this.state, verdict: 'qualified' };
    this.journal({ event: 'qualified', version: this.currentVersion });
    this.clearPending();
    return { ok: true, verdict: 'qualified' };
  }

  dispose() {
    if (this.qualifyTimer) {
      clearTimeout(this.qualifyTimer);
      this.qualifyTimer = null;
    }
  }

  /**
   * Arm the handoff from a staged record (StagedUpdater 'staged' journal entry).
   * Picks the installer entry (.exe — NSIS release rail), writes the durable
   * pending record, journals. Does NOT spawn — the spawn happens on quit.
   */
  requestFromStaged({ version, dir, files = [] } = {}) {
    if (!version || !dir) return { ok: false, reason: 'staged_record_incomplete' };
    const installer = files.find((name) => ACTIVATION.INSTALLER_PATTERN.test(name));
    if (!installer) return { ok: false, reason: 'no_installer_entry' };
    const id = randomBytes(8).toString('hex');
    const pending = { id, version, dir, installer, started_at: new Date().toISOString() };
    writeJsonAtomic(this.pendingFile, pending);
    this.state = { ...this.state, verdict: 'armed', pending, armed: true };
    this.journal({ event: 'pending', id, version, installer });
    return { ok: true, id, version, installerPath: join(dir, installer) };
  }

  /** Quit hook: spawn the installer detached (survives app exit), unref'd. */
  spawnHandoff() {
    const pending = readJson(this.pendingFile);
    if (!pending) return { ok: false, reason: 'no_pending_request' };
    if (!this.spawnImpl) return { ok: false, reason: 'spawn_unavailable' };
    try {
      const child = this.spawnImpl(join(pending.dir, pending.installer), [ACTIVATION.SILENT_ARG], { detached: true, stdio: 'ignore' });
      child?.unref?.();
      this.journal({ event: 'spawned', id: pending.id, version: pending.version, pid: child?.pid ?? null });
      return { ok: true, pid: child?.pid ?? null };
    } catch (err) {
      this.journal({ event: 'spawn_failed', error: String(err?.message ?? err).slice(0, 200) });
      return { ok: false, reason: 'spawn_error' };
    }
  }

  clearPending() {
    try {
      rmSync(this.pendingFile, { force: true });
    } catch {
      /* honest skip — a missing file is already the desired state */
    }
  }

  snapshot() {
    return { verdict: this.state.verdict, pending: readJson(this.pendingFile), armed: this.state.armed };
  }
}
