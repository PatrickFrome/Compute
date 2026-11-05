// Manual, inert static regression against the GitHub transfer branch.
// Execute from an actual checkout containing d53ccd... + source-transfer files:
//   node --test coordination/reviews/data-preservation-c265-e30-20261105/tests/source-contracts.manual.mjs
// This is structural evidence, not a physical data/restore qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const read = relative => fs.readFile(path.join(root, relative), 'utf8');
const sourceDir = 'apps/metaengine-browser/src/';
const transfer = 'coordination/source-transfer/c26565e/integrated-c265-to-e30.patch';
const patchSection = (patch, filename) => patch.split(/(?=^diff --git a\/)/m)
  .find(section => section.startsWith(`diff --git a/${filename} `)) || '';

let sources;
test.before(async () => {
  const [patch, journal, updater, installer] = await Promise.all([
    read(transfer), read(sourceDir + 'self-update-transaction-journal.mjs'),
    read(sourceDir + 'self-update-runtime.mjs'),
    read('apps/metaengine-browser/test/installer-upgrade-identity.test.mjs'),
  ]);
  sources = {patch, journal, updater, installer};
});

test('unresolved upgrade attempt retains a non-retry journal on sequential begin', () => {
  assert.match(sources.journal, /BEGIN_ALLOWED_PRIOR_STATES = new Set\(\['QUALIFIED', 'SUPERSEDED'\]\)/);
  assert.match(sources.journal, /self_update_transaction_unresolved_prior/);
  assert.match(sources.journal, /automatic_retry_allowed: false/);
});

test('transaction evidence and state never declare authority effect', () => {
  assert.match(sources.journal, /authority_effect: false/);
  assert.match(sources.journal, /SELF_UPDATE_INSTALL_EFFECT_BARRIER = 'WRITE_AHEAD_V1'/);
});

test('install-effect write-ahead precedes final updater handoff', () => {
  assert.match(sources.journal, /markSelfUpdateInstallEffectAttempted/);
  assert.match(sources.journal, /transitionSelfUpdateTransaction\(app, 'INSTALLING'/);
  assert.match(sources.updater, /await installEffectBarrier\(structuredClone\(receipt\)\)/);
});

test('fresh provider restart fence remains in integrated transfer', () => {
  const section = patchSection(sources.patch, sourceDir + 'local-state-provider-bootstrap.mjs');
  assert.match(section, /assertFreshProviderRestartFence\(ownerRead.value\)/);
  assert.match(section, /local_state_provider_fresh_install_incomplete/);
});

test('protected root cannot create a new registration without native parent custody', () => {
  const section = patchSection(sources.patch, sourceDir + 'owned-protected-backup-root.mjs');
  assert.match(section, /fail\('original_parent_namespace_custody_required'\)/);
  assert.match(section, /if\(pin.state!=='READY'\)fail\('registration_incomplete'\)/);
});

test('PG17 source connection is not reached before original recovery custody', () => {
  const section = patchSection(sources.patch, 'infra/client-state-runtime/pg17-recovery-producer.mjs');
  const custody = section.indexOf('await beginOriginalRecoveryDirectoryCustody(');
  const sql = section.indexOf('row.sourcePool=bindNativeCodingTransactionPool(');
  assert.ok(custody >= 0 && sql > custody, 'source PG connect precedes custody');
});

test('disposable restore test has explicit prior-attempt readback barrier', () => {
  const section = patchSection(sources.patch, 'apps/metaengine-browser/test/qa-disposable-image-restore.test.mjs');
  assert.match(section, /existing_attempt_requires_readback/);
  assert.match(section, /automatic_retry_allowed,false/);
});

test('portable qualification must not assert production or physical restore proof', () => {
  const section = patchSection(sources.patch, 'apps/metaengine-browser/test/safe-install-qualification.mjs');
  assert.match(section, /production_qualified:false/);
  assert.match(section, /physical_restore_proven:false/);
  assert.match(section, /Physical PostgreSQL restore/);
});

test('NSIS identity test checks app data retention rather than declaring full preservation', () => {
  assert.match(sources.installer, /deleteAppDataOnUninstall, false/);
});

test('new PREPARED attempts use the same lease as INSTALLING (known issue; expected to fail)', () => {
  const begin = sources.journal.slice(
    sources.journal.indexOf('export async function beginSelfUpdateTransaction'),
    sources.journal.indexOf('export async function transitionSelfUpdateTransaction'));
  assert.match(begin, /serializeInstallEffectBarrier\(/,
    'begin performs read-then-replace without the serialized effect barrier; prior attempt may be overwritten');
});
