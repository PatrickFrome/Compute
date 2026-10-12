import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RsiRuntimeLedger, planRsiRuntimeStartupForkRecovery } from '../src/rsi-runtime-ledger.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export async function recoverRsiRuntimeStartupFork({ ledgerPath, expected_sha256, source_sha, apply = false } = {}) {
  if (!path.isAbsolute(ledgerPath || '') || !/^[0-9a-f]{64}$/.test(expected_sha256 || '') || !/^[0-9a-f]{40}$/.test(source_sha || '')) {
    throw new Error('rsi_runtime_recovery_exact_identity_required');
  }
  const file = path.resolve(ledgerPath);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) throw new Error('rsi_runtime_recovery_regular_file_required');
  if ((await fs.realpath(file)).toLowerCase() !== file.toLowerCase()) throw new Error('rsi_runtime_recovery_physical_path_required');
  const original = await fs.readFile(file);
  if (hash(original) !== expected_sha256) throw new Error('rsi_runtime_recovery_original_digest_mismatch');
  const text = original.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(original)) throw new Error('rsi_runtime_recovery_utf8_required');
  const plan = planRsiRuntimeStartupForkRecovery(text);
  const { accepted_prefix, ...publicPlan } = plan;
  if (!apply) return Object.freeze({ ...publicPlan, applied: false });

  // The operator must stop the client first. Keep the whole original byte-for-byte
  // next to the live ledger; no event is rehashed, reinterpreted or destroyed.
  const archive = `${file}.startup-fork-original-${expected_sha256}.jsonl`;
  const staged = `${file}.startup-fork-staged-${crypto.randomUUID()}.jsonl`;
  const receiptPath = `${file}.startup-fork-recovery-${expected_sha256}.json`;
  for (const target of [archive, receiptPath]) {
    if (await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw new Error('rsi_runtime_recovery_archive_already_exists');
  }
  let originalMoved = false;
  let installed = false;
  try {
    await fs.writeFile(staged, accepted_prefix, { flag: 'wx', mode: 0o600 });
    const ledger = new RsiRuntimeLedger({ ledgerPath: staged, source_sha });
    await ledger.init();
    const recovery = await ledger.append('STARTUP_FORK_QUARANTINED', {
      original_sha256: expected_sha256,
      original_archive_basename: path.basename(archive),
      original_event_count: plan.original_event_count,
      accepted_event_count: plan.accepted_event_count,
      accepted_last_digest: plan.accepted_last_digest,
      quarantined_event_digests: [...plan.quarantined_event_digests],
      quarantined_events_replayed: false,
      authority_effect: false,
    });
    const restart = new RsiRuntimeLedger({ ledgerPath: staged, source_sha });
    await restart.init();
    if (restart.snapshot().last_event_digest !== recovery.event_digest) throw new Error('rsi_runtime_recovery_staged_replay_failed');
    const latest = await fs.lstat(file);
    if (latest.ino !== stat.ino || latest.size !== stat.size || hash(await fs.readFile(file)) !== expected_sha256) throw new Error('rsi_runtime_recovery_source_changed');
    await fs.rename(file, archive);
    originalMoved = true;
    if (hash(await fs.readFile(archive)) !== expected_sha256) throw new Error('rsi_runtime_recovery_archive_readback_failed');
    await fs.rename(staged, file);
    installed = true;
    const result = Object.freeze({ ...publicPlan, applied: true, ledger_file: file, archive_file: archive, receipt_file: receiptPath,
      restored_event_count: restart.snapshot().event_count, recovery_event_digest: recovery.event_digest,
      restored_sha256: hash(await fs.readFile(file)), original_bytes_preserved: true });
    const receiptHandle = await fs.open(receiptPath, 'wx', 0o600);
    try { await receiptHandle.writeFile(JSON.stringify(result, null, 2) + '\n'); await receiptHandle.sync(); }
    finally { await receiptHandle.close(); }
    return result;
  } catch (error) {
    if (originalMoved && !installed) await fs.rename(archive, file);
    throw error;
  } finally {
    await fs.unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  const result = await recoverRsiRuntimeStartupFork({ ledgerPath: value('--ledger-file'), expected_sha256: value('--expected-sha256'),
    source_sha: value('--source-sha'), apply: args.includes('--apply') });
  console.log(JSON.stringify(result));
}
