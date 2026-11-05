// Run from the VERIFIED e30 source tree (Git tree 90fa5633d7926dd71a7303266073e0625325e740).
// Read-only assertions; no services, installer, PG, listener or user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const read = name => fs.readFile(path.join(root, name), 'utf8');
const browser = 'apps/metaengine-browser/';
let source;
test.before(async () => {
  const paths = {
    journal: browser + 'src/self-update-transaction-journal.mjs',
    durable: browser + 'src/durable-json-file.cjs',
    updater: browser + 'src/self-update-runtime.mjs',
    config: browser + 'electron-builder.test.json',
    provider: browser + 'src/local-state-provider-bootstrap.mjs',
    root: browser + 'src/owned-protected-backup-root.mjs',
    pg: 'infra/client-state-runtime/pg17-recovery-producer.mjs',
    backup: 'infra/client-state-runtime/upgrade-backup-gate.mjs',
    project: browser + 'src/autonomous-project-journal.mjs',
    callback: browser + 'src/native-coding-run-callback-journal.mjs',
  };
  source = Object.fromEntries(await Promise.all(Object.entries(paths)
    .map(async ([key,value]) => [key,await read(value)])));
});

test('DP-01: PREPARED is decided under the same exclusive durable lock', () => {
  const begin = source.journal.split('export async function beginSelfUpdateTransaction')[1]
    .split('export async function transitionSelfUpdateTransaction')[0];
  assert.match(begin, /withTransactionLock\(app, async \(control\)/);
  assert.match(begin, /readSnapshot\(app, \{ locked: true \}\)/);
  assert.match(begin, /BEGIN_ALLOWED_PRIOR_STATES\.has\(prior\.state\)/);
  assert.match(begin, /expectedPreimage: snapshot\.raw/);
});

test('DP-01: transitions recheck exact preimage and retained attempt', () => {
  const transition = source.journal.split('export async function transitionSelfUpdateTransaction')[1]
    .split('export async function markSelfUpdateInstallEffectAttempted')[0];
  assert.match(transition, /requireTransactionId/);
  assert.match(transition, /if \(locked\.raw !== snapshot\.raw\)/);
  assert.match(transition, /withTransactionLock\(app, async \(control\)/);
  assert.match(transition, /expectedPreimage: snapshot\.raw/);
});

test('DP-01: effect barrier retains original identity and exact PREPARED state', () => {
  const effect = source.journal.split('export async function markSelfUpdateInstallEffectAttempted')[1]
    .split('export async function qualifySelfUpdateTransaction')[0];
  assert.match(effect, /requireTransactionId: current\.transaction_id/);
  assert.match(effect, /requireState: 'PREPARED'/);
  assert.match(effect, /effect_barrier_crossed: true/);
  assert.match(effect, /automatic_retry_allowed: false/);
});

test('DP-01: durable lock never has a guessed stale-reclaim path', () => {
  assert.match(source.journal, /fs\.open\(lock, 'wx', 0o600\)/);
  assert.match(source.journal, /self_update_transaction_lock_busy/);
  assert.match(source.journal, /self_update_transaction_write_outcome_unknown/);
  assert.doesNotMatch(source.journal, /unlink\(lock\).*catch\(\(\)\s*=>\s*\{\}\)/);
});

test('DP-01: byte-level CAS retains unknown publication evidence', () => {
  assert.match(source.durable, /publishWithPreimage/);
  assert.match(source.durable, /durable_json_preimage_mismatch/);
  assert.match(source.durable, /renameState\.outcome_unknown = true/);
  assert.match(source.durable, /await fsp\.link\(temp, file\)/);
});

test('physical installer effect is preceded by the write-ahead barrier', () => {
  assert.match(source.updater, /await installEffectBarrier\(structuredClone\(receipt\)\)/);
  assert.match(source.journal, /transitionSelfUpdateTransaction\(app, 'INSTALLING'/);
});

test('fresh provider restart keeps interrupted owner publication fenced', () => {
  assert.match(source.provider, /assertFreshProviderRestartFence\(ownerRead\.value\)/);
  assert.match(source.provider, /local_state_provider_fresh_install_incomplete/);
});

test('original backup root and PG source custody remain strict HOLD', () => {
  assert.match(source.root, /fail\('original_parent_namespace_custody_required'\)/);
  const custody = source.pg.indexOf('await beginOriginalRecoveryDirectoryCustody(');
  const sourcePool = source.pg.indexOf('row.sourcePool=bindNativeCodingTransactionPool(');
  assert.ok(custody >= 0 && sourcePool > custody);
  assert.match(source.backup, /upgrade_authorized:false/);
});

test('projects and callback results have additional non-PG durability owners', () => {
  assert.match(source.project, /createAutonomousProjectJournal/);
  assert.match(source.project, /FULL commits precede spawn POSTs/);
  assert.match(source.callback, /host-callback-custody/);
  assert.match(source.callback, /automatic_retry_allowed:false/);
});

test('installer configuration does not directly request AppData deletion', () => {
  const config = JSON.parse(source.config);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
});
