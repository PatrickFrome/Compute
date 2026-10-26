import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {publishOwnerFile} from '../scripts/qa-owner-runtime-upgrade.mjs';
import {restorePinnedQaImage} from '../scripts/qa-operator-install-recovery.mjs';
import {captureInstalledTreeFingerprint} from '../scripts/qa-installed-tree-fingerprint.mjs';

// Exercise exported production helpers on generated physical files only. These
// tests never call the CLI, private ACL checks, registry, a process actuator or an
// installer. No generated receipt represents native readiness or capabilities.
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureParent = path.join(repository, '.rollback-verifier-fixtures');
const samePath = (a, b) => path.resolve(a) === path.resolve(b);
const missing = file => assert.rejects(fs.lstat(file), {code: 'ENOENT'});
const ioError = label => Object.assign(new Error(label), {code: 'EIO'});
async function failed(operation) {
  try { await operation(); } catch (error) { return error; }
  assert.fail('fault did not reject; effect must not be reported as ready');
}
async function fixture(t) {
  await fs.mkdir(fixtureParent, {recursive: true});
  const root = await fs.mkdtemp(path.join(fixtureParent, 'owner-image-'));
  assert.equal(path.dirname(root), fixtureParent);
  const preservedRoot = path.join(root, 'preserved');
  const markers = new Map([
    ['dummy-token.bin', Buffer.from('SYNTHETIC TOKEN ONLY\0' + randomUUID())],
    ['bridge/dummy-bridge.json', Buffer.from(JSON.stringify({dummy_bridge: randomUUID()}))],
    ['profile/Default/Preferences', Buffer.from('{"synthetic_profile":"keep bytes"}\r\n')],
    ['profile/Default/Session.bin', Buffer.from([0, 255, 13, 10, 42])],
    ['journal/unrelated-transaction.json', Buffer.from('{"state":"AMBIGUOUS","automatic_retry_allowed":false}\n')],
  ]);
  for (const [relative, bytes] of markers) {
    const file = path.join(preservedRoot, relative);
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, bytes, {flag: 'wx'});
  }
  t.after(async () => {
    try {
      const actual = [];
      async function walk(dir, prefix = '') {
        for (const name of await fs.readdir(dir)) {
          const relative = prefix ? prefix + '/' + name : name;
          const file = path.join(dir, name), stat = await fs.lstat(file);
          assert.equal(stat.isSymbolicLink(), false);
          if (stat.isDirectory()) await walk(file, relative);
          else actual.push(relative);
        }
      }
      await walk(preservedRoot);
      assert.deepEqual(actual.sort(), [...markers.keys()].sort(), 'preserved file inventory');
      for (const [relative, bytes] of markers) {
        assert.deepEqual(await fs.readFile(path.join(preservedRoot, relative)), bytes, relative);
      }
    } finally {
      const actual = await fs.realpath(root), parent = await fs.realpath(fixtureParent);
      assert.equal(path.dirname(actual), parent, 'cleanup stays inside this verifier root');
      await fs.rm(actual, {recursive: true, force: true});
    }
  });
  return {root};
}
async function ownerFixture(t) {
  const f = await fixture(t);
  const args = {ownerFile: path.join(f.root, 'owner.json'), stagedFile: path.join(f.root, 'staged-owner.json'),
    rollbackFile: path.join(f.root, 'rollback-owner.json'), oldBytes: Buffer.from('{"owner":"synthetic-predecessor"}\n'),
    nextBytes: Buffer.from('{"owner":"synthetic-successor"}\n')};
  await fs.writeFile(args.ownerFile, args.oldBytes, {flag: 'wx'});
  await fs.writeFile(args.stagedFile, args.nextBytes, {flag: 'wx'});
  return {...f, args};
}
async function imageFixture(t) {
  const f = await fixture(t), installedRoot = path.join(f.root, 'installed'), snapshotRoot = path.join(f.root, 'snapshot');
  for (const [directory, version] of [[installedRoot, 'partial-current'], [snapshotRoot, 'predecessor']]) {
    await fs.mkdir(path.join(directory, 'resources', 'empty'), {recursive: true});
    await fs.writeFile(path.join(directory, 'app.exe'), 'GENERATED EXE ' + version);
    await fs.writeFile(path.join(directory, 'resources', 'app.asar'), 'GENERATED ASAR ' + version);
  }
  const args = {installedRoot, snapshotRoot, journalFile: path.join(f.root, 'restore-journal.json'),
    expectedSnapshotSha256: (await captureInstalledTreeFingerprint(snapshotRoot)).tree_sha256,
    expectedPreimageSha256: (await captureInstalledTreeFingerprint(installedRoot)).tree_sha256};
  return {...f, args};
}
const readRecord = f => fs.readFile(f.args.journalFile, 'utf8').then(JSON.parse);
const assertFenced = record => {
  assert.equal(record.automatic_retry_allowed, false);
  assert.equal(record.production_authorized, false);
  assert.equal(record.authority_effect, false);
};

test('changed Owner before publication is rejected and all unrelated generated files survive', async t => {
  const f = await ownerFixture(t), concurrent = Buffer.from('different synthetic Owner\n');
  await fs.writeFile(f.args.ownerFile, concurrent);
  await assert.rejects(publishOwnerFile(f.args), /owner_cas_mismatch/);
  assert.deepEqual(await fs.readFile(f.args.ownerFile), concurrent);
  assert.deepEqual(await fs.readFile(f.args.stagedFile), f.args.nextBytes);
  await missing(f.args.rollbackFile);
});

test('Owner drift while staged preimage is being read must not be overwritten', async t => {
  const f = await ownerFixture(t), concurrent = Buffer.from('concurrent synthetic publication\n');
  const original = fs.readFile;
  let injected = false;
  t.mock.method(fs, 'readFile', async function (file, ...args) {
    const bytes = await original.call(this, file, ...args);
    if (!injected && samePath(file, f.args.stagedFile)) {
      injected = true;
      await fs.writeFile(f.args.ownerFile, concurrent);
    }
    return bytes;
  });
  let rejection;
  try { await publishOwnerFile(f.args); } catch (error) { rejection = error; }
  assert.equal(injected, true);
  assert.equal(await fs.readFile(f.args.ownerFile, 'utf8'), concurrent.toString('utf8'), 'concurrent Owner must survive the publication');
  assert.match(rejection?.message || '', /owner_cas_mismatch|publication_effect_unknown/);
});

test('failed verification preserves another writer Owner and reports an unknown publication', async t => {
  const f = await ownerFixture(t), concurrent = Buffer.from('newer synthetic Owner\n');
  await assert.rejects(publishOwnerFile(f.args, {verifyPublished: async () => {
    await fs.writeFile(f.args.ownerFile, concurrent);
    throw ioError('verification ACK lost');
  }}), /publication_effect_unknown/);
  assert.deepEqual(await fs.readFile(f.args.ownerFile), concurrent);
  await missing(f.args.rollbackFile);
});

test('lost publication link ACK preserves committed bytes and refuses blind replay', async t => {
  const f = await ownerFixture(t), original = fs.link;
  let commits = 0;
  t.mock.method(fs, 'link', async function (from, to) {
    const result = await original.call(this, from, to);
    if (samePath(from, f.args.stagedFile) && samePath(to, f.args.ownerFile)) {
      commits++;
      throw ioError('publication link ACK lost after commit');
    }
    return result;
  });
  const error = await failed(() => publishOwnerFile(f.args));
  assert.equal(error.rollbackConfirmed, undefined);
  assert.deepEqual(await fs.readFile(f.args.ownerFile), f.args.nextBytes);
  await assert.rejects(publishOwnerFile(f.args), /path_not_regular/);
  assert.equal(commits, 1);
  await missing(f.args.rollbackFile);
});

test('failed Owner rollback retains the captured current Owner and exact rollback source without confirmation', async t => {
  const f = await ownerFixture(t), original = fs.link;
  t.mock.method(fs, 'link', async function (from, to) {
    if (samePath(from, f.args.rollbackFile) && samePath(to, f.args.ownerFile)) throw ioError('rollback link failed');
    return original.call(this, from, to);
  });
  const error = await failed(() => publishOwnerFile(f.args, {verifyPublished: async () => {throw ioError('verification failed');}}));
  assert.equal(error.rollbackConfirmed, undefined);
  await missing(f.args.ownerFile);
  const custody=(await fs.readdir(f.root)).filter(name=>name.startsWith('owner.json.publication-'));
  const captured=await Promise.all(custody.map(name=>fs.readFile(path.join(f.root,name,'preimage'))));
  assert(captured.some(bytes=>bytes.equals(f.args.nextBytes)),'captured current Owner must survive');
  assert(captured.some(bytes=>bytes.equals(f.args.oldBytes)),'original predecessor must survive');
  assert.deepEqual(await fs.readFile(f.args.rollbackFile), f.args.oldBytes);
});

test('lost rollback link ACK leaves old Owner observable without declaring rollback confirmed', async t => {
  const f = await ownerFixture(t), original = fs.link;
  t.mock.method(fs, 'link', async function (from, to) {
    const result = await original.call(this, from, to);
    if (samePath(from, f.args.rollbackFile) && samePath(to, f.args.ownerFile)) throw ioError('rollback ACK lost after commit');
    return result;
  });
  const error = await failed(() => publishOwnerFile(f.args, {verifyPublished: async () => {throw ioError('verification failed');}}));
  assert.equal(error.rollbackConfirmed, undefined);
  assert.deepEqual(await fs.readFile(f.args.ownerFile), f.args.oldBytes);
  assert.deepEqual(await fs.readFile(f.args.rollbackFile), f.args.oldBytes);
  await assert.rejects(publishOwnerFile(f.args), /path_not_regular/);
});

for(const syscall of ['rename','link'])test('concurrent Owner survives a race inside publication '+syscall,async t=>{
  const f=await ownerFixture(t),concurrent=Buffer.from('independent concurrent Owner\n'),original=fs[syscall];let injected=false;
  t.mock.method(fs,syscall,async function(from,to){
    if(!injected&&(syscall==='rename'?samePath(from,f.args.ownerFile):samePath(to,f.args.ownerFile))){
      injected=true;await fs.writeFile(f.args.ownerFile,concurrent);
    }
    return original.call(this,from,to);
  });
  await assert.rejects(publishOwnerFile(f.args));assert.equal(injected,true);
  assert.deepEqual(await fs.readFile(f.args.ownerFile),concurrent);
  assert.deepEqual(await fs.readFile(f.args.stagedFile),f.args.nextBytes);
});

test('changed image preimage is rejected before rename and the concurrent bytes survive', async t => {
  const f = await imageFixture(t), current = path.join(f.args.installedRoot, 'resources', 'app.asar');
  await assert.rejects(restorePinnedQaImage({...f.args, beforeMutation: () => fs.writeFile(current, 'concurrent preimage')}), /preimage_changed/);
  assert.equal(await fs.readFile(current, 'utf8'), 'concurrent preimage');
  const record = await readRecord(f);
  assert.equal(record.state, 'PREPARED');
  assertFenced(record);
  await missing(record.quarantine_directory);
  await assert.rejects(restorePinnedQaImage(f.args), /existing_attempt_requires_readback/);
});

test('rename-gap failure restores the complete image preimage and keeps the attempt fenced', async t => {
  const f = await imageFixture(t);
  const error = await failed(() => restorePinnedQaImage({...f.args, onCheckpoint: async stage => {
    if (stage === 'QUARANTINED') throw ioError('failure in rename gap');
  }}));
  assert.equal(error.rollbackConfirmed, true);
  assert.equal((await captureInstalledTreeFingerprint(f.args.installedRoot)).tree_sha256, f.args.expectedPreimageSha256);
  const record = await readRecord(f);
  assert.equal(record.state, 'ABORTED_PREIMAGE_RESTORED');
  assertFenced(record);
  await assert.rejects(restorePinnedQaImage(f.args), /existing_attempt_requires_readback/);
});

test('image promotion with a lost higher level ACK remains unknown and preserves the quarantined preimage', async t => {
  const f = await imageFixture(t);
  const error = await failed(() => restorePinnedQaImage({...f.args, onCheckpoint: async stage => {
    if (stage === 'PROMOTED') throw ioError('promotion ACK lost');
  }}));
  assert.equal(error.rollbackConfirmed, undefined);
  const record = await readRecord(f);
  assert.equal(record.state, 'EFFECT_UNKNOWN_REQUIRES_READBACK');
  assertFenced(record);
  assert.equal((await captureInstalledTreeFingerprint(f.args.installedRoot)).tree_sha256, f.args.expectedSnapshotSha256);
  assert.equal((await captureInstalledTreeFingerprint(record.quarantine_directory)).tree_sha256, f.args.expectedPreimageSha256);
  const journalBytes = await fs.readFile(f.args.journalFile);
  await assert.rejects(restorePinnedQaImage(f.args), /existing_attempt_requires_readback/);
  assert.deepEqual(await fs.readFile(f.args.journalFile), journalBytes);
});

test('first image rename committed with lost ACK retains both trees and an UNKNOWN journal', async t => {
  const f = await imageFixture(t), original = fs.rename;
  t.mock.method(fs, 'rename', async function (from, to) {
    const result = await original.call(this, from, to);
    if (samePath(from, f.args.installedRoot) && String(to).includes('.qa-quarantine-')) throw ioError('first rename ACK lost');
    return result;
  });
  const error = await failed(() => restorePinnedQaImage(f.args));
  assert.equal(error.rollbackConfirmed, undefined);
  const record = await readRecord(f);
  assert.equal(record.state, 'EFFECT_UNKNOWN_REQUIRES_READBACK');
  assertFenced(record);
  await missing(f.args.installedRoot);
  assert.equal((await captureInstalledTreeFingerprint(record.quarantine_directory)).tree_sha256, f.args.expectedPreimageSha256);
  assert.equal((await captureInstalledTreeFingerprint(record.prepared_directory)).tree_sha256, f.args.expectedSnapshotSha256);
  await assert.rejects(restorePinnedQaImage(f.args), /existing_attempt_requires_readback/);
});

test('incomplete image rollback must persist UNKNOWN instead of a stale intermediate state', async t => {
  const f = await imageFixture(t), original = fs.rename;
  t.mock.method(fs, 'rename', async function (from, to) {
    if (String(from).includes('.qa-quarantine-') && samePath(to, f.args.installedRoot)) throw ioError('rollback rename failed');
    return original.call(this, from, to);
  });
  const error = await failed(() => restorePinnedQaImage({...f.args, onCheckpoint: async stage => {
    if (stage === 'QUARANTINED') throw ioError('failure requiring rollback');
  }}));
  assert.equal(error.rollbackConfirmed, undefined);
  const record = await readRecord(f);
  assertFenced(record);
  await missing(f.args.installedRoot);
  assert.equal((await captureInstalledTreeFingerprint(record.quarantine_directory)).tree_sha256, f.args.expectedPreimageSha256);
  assert.equal((await captureInstalledTreeFingerprint(record.prepared_directory)).tree_sha256, f.args.expectedSnapshotSha256);
  await assert.rejects(restorePinnedQaImage(f.args), /existing_attempt_requires_readback/);
  assert.equal(record.state, 'EFFECT_UNKNOWN_REQUIRES_READBACK', 'rollback failure must be durably visible');
});

test('image rollback must re-read the restored preimage before setting rollbackConfirmed', async t => {
  const f = await imageFixture(t), original = fs.rename;
  t.mock.method(fs, 'rename', async function (from, to) {
    const result = await original.call(this, from, to);
    if (String(from).includes('.qa-quarantine-') && samePath(to, f.args.installedRoot)) {
      await fs.writeFile(path.join(to, 'resources', 'app.asar'), 'concurrent bytes after rollback rename');
    }
    return result;
  });
  const error = await failed(() => restorePinnedQaImage({...f.args, onCheckpoint: async stage => {
    if (stage === 'QUARANTINED') throw ioError('failure requiring rollback');
  }}));
  const record = await readRecord(f);
  assertFenced(record);
  assert.notEqual((await captureInstalledTreeFingerprint(f.args.installedRoot)).tree_sha256, f.args.expectedPreimageSha256);
  assert.equal(await fs.readFile(path.join(f.args.installedRoot, 'resources', 'app.asar'), 'utf8'), 'concurrent bytes after rollback rename');
  assert.notEqual(error.rollbackConfirmed, true, 'a changed preimage cannot have a confirmed rollback');
  assert.equal(record.state, 'EFFECT_UNKNOWN_REQUIRES_READBACK');
});
