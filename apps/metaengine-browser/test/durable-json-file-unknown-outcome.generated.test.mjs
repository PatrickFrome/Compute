import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
let helperUrl = new URL('./durable-json-file.cjs', import.meta.url);
if (!fs.existsSync(helperUrl)) helperUrl = new URL('../src/durable-json-file.cjs', import.meta.url);
const helperSource = fs.readFileSync(helperUrl, 'utf8');
const value = {generation: 27, authority_effect: false};
const payload = `${JSON.stringify(value, null, 2)}\n`;
const previousPayload = '{"generation":26,"authority_effect":false}\n';

function simulatedError(code) {
  return Object.assign(new Error(`generated fixture ${code}`), {code});
}

async function fixture(t, mode, {committed = false, initial = false, readbackError = null,
  firstRenameError = 'EPERM', alwaysFail = false, afterCommit = null,
  alterTemp = null, tempReadError = null} = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'metaengine-durable-unknown-generated-'));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  t.after(async () => {
    for (const entry of await fsp.readdir(directory, {withFileTypes: true})) {
      assert.equal(entry.isFile(), true, 'fixture must contain only its generated files');
      await fsp.unlink(path.join(directory, entry.name));
    }
    await fsp.rmdir(directory);
  });
  const target = path.join(directory, 'state.json');
  if (initial) await fsp.writeFile(target, previousPayload);
  const ackError = simulatedError(firstRenameError);
  const counters = {renames: 0, reads: 0, unlinks: 0};
  const nativePromises = {...fsp};
  const nativeSync = {...fs};
  const blockedRead = () => {
    counters.reads++;
    if (readbackError) throw simulatedError(readbackError);
  };
  nativePromises.rename = async (...args) => {
    counters.renames++;
    if (counters.renames === 1 || alwaysFail) {
      if (committed) await fsp.rename(...args);
      if (afterCommit === 'replace') await fsp.writeFile(target, previousPayload);
      if (afterCommit === 'delete') await fsp.unlink(target);
      if (alterTemp === 'replace') {
        await fsp.writeFile(args[0] + '.replacement', payload);
        await fsp.rename(args[0] + '.replacement', args[0]);
      }
      if (alterTemp === 'corrupt') await fsp.writeFile(args[0], 'generated mismatched temp bytes');
      throw ackError;
    }
    return fsp.rename(...args);
  };
  nativePromises.readFile = async (file, ...args) => {
    if (file === target) blockedRead();
    return fsp.readFile(file, ...args);
  };
  nativePromises.unlink = async (...args) => { counters.unlinks++; return fsp.unlink(...args); };
  nativePromises.open = async (file, flags, ...args) => {
    if (tempReadError && flags === 'r' && String(file).endsWith('.tmp')) throw simulatedError(tempReadError);
    return fsp.open(file, flags, ...args);
  };
  nativeSync.renameSync = (...args) => {
    counters.renames++;
    if (counters.renames === 1 || alwaysFail) {
      if (committed) fs.renameSync(...args);
      if (afterCommit === 'replace') fs.writeFileSync(target, previousPayload);
      if (afterCommit === 'delete') fs.unlinkSync(target);
      if (alterTemp === 'replace') {
        fs.writeFileSync(args[0] + '.replacement', payload);
        fs.renameSync(args[0] + '.replacement', args[0]);
      }
      if (alterTemp === 'corrupt') fs.writeFileSync(args[0], 'generated mismatched temp bytes');
      throw ackError;
    }
    return fs.renameSync(...args);
  };
  nativeSync.readFileSync = (file, ...args) => {
    if (file === target) blockedRead();
    return fs.readFileSync(file, ...args);
  };
  nativeSync.unlinkSync = (...args) => { counters.unlinks++; return fs.unlinkSync(...args); };
  nativeSync.openSync = (file, flags, ...args) => {
    if (tempReadError && flags === 'r' && String(file).endsWith('.tmp')) throw simulatedError(tempReadError);
    return fs.openSync(file, flags, ...args);
  };
  const module = {exports: {}};
  vm.runInNewContext(helperSource, {
    module, exports: module.exports,
    require: id => id === 'node:fs' ? nativeSync : id === 'node:fs/promises' ? nativePromises : require(id),
    process: {pid: process.pid, platform: process.platform},
    setTimeout, SharedArrayBuffer, Int32Array, Atomics,
  }, {filename: fileURLToPath(helperUrl)});
  const invoke = () => mode === 'async'
    ? module.exports.durableWriteJson(target, value, {sequence: 27})
    : module.exports.durableWriteJsonSync(target, value, {sequence: 27});
  return {directory, target, counters, ackError, invoke};
}

for (const mode of ['async', 'sync']) {
  for (const afterCommit of ['replace', 'delete']) {
    test(`${mode}: committed rename then target ${afterCommit} cannot replay from final readback alone`, async t => {
      const f = await fixture(t, mode, {committed: true, afterCommit});
      if (mode === 'async') await assert.rejects(f.invoke, error => error === f.ackError);
      else assert.throws(f.invoke, error => error === f.ackError);
      assert.equal(f.counters.renames, 1);
      assert.equal(f.counters.reads, 1);
      assert.equal(f.counters.unlinks, 0);
      if (afterCommit === 'replace') assert.equal(await fsp.readFile(f.target, 'utf8'), previousPayload);
      else await assert.rejects(fsp.stat(f.target), {code: 'ENOENT'});
      assert.equal((await fsp.readdir(f.directory)).filter(name => name.endsWith('.tmp')).length, 0);
    });
  }

  for (const alterTemp of ['replace', 'corrupt']) {
    test(`${mode}: ${alterTemp} temp is UNKNOWN even while the final target is a readable mismatch`, async t => {
      const f = await fixture(t, mode, {initial: true, alterTemp});
      if (mode === 'async') await assert.rejects(f.invoke, error => error === f.ackError);
      else assert.throws(f.invoke, error => error === f.ackError);
      assert.equal(f.counters.renames, 1);
      assert.equal(f.counters.unlinks, 0);
      assert.equal(await fsp.readFile(f.target, 'utf8'), previousPayload);
      const temporary = (await fsp.readdir(f.directory)).filter(name => name.endsWith('.tmp'));
      assert.equal(temporary.length, 1);
      assert.equal(await fsp.readFile(path.join(f.directory, temporary[0]), 'utf8'),
        alterTemp === 'replace' ? payload : 'generated mismatched temp bytes');
    });
  }

  test(`${mode}: unreadable surviving temp is UNKNOWN and retained`, async t => {
    const f = await fixture(t, mode, {initial: true, tempReadError: 'EACCES'});
    if (mode === 'async') await assert.rejects(f.invoke, error => error === f.ackError);
    else assert.throws(f.invoke, error => error === f.ackError);
    assert.equal(f.counters.renames, 1);
    assert.equal(f.counters.unlinks, 0);
    const temporary = (await fsp.readdir(f.directory)).filter(name => name.endsWith('.tmp'));
    assert.equal(temporary.length, 1);
    assert.equal(await fsp.readFile(path.join(f.directory, temporary[0]), 'utf8'), payload);
  });

  test(`${mode}: physical rename plus EPERM ACK and unreadable target is never replayed`, async t => {
    const f = await fixture(t, mode, {committed: true, readbackError: 'EACCES'});
    if (mode === 'async') await assert.rejects(f.invoke, error => error === f.ackError);
    else assert.throws(f.invoke, error => error === f.ackError);
    assert.equal(f.counters.renames, 1);
    assert.equal(f.counters.reads, 1);
    assert.equal(f.counters.unlinks, 0, 'unknown outcome must never trigger temp cleanup');
    assert.equal(await fsp.readFile(f.target, 'utf8'), payload, 'physical commit remains intact');
    assert.deepEqual(await fsp.readdir(f.directory), ['state.json']);
  });

  for (const readbackError of ['EACCES', 'EPERM', 'EIO']) {
    test(`${mode}: ${readbackError} readback preserves temp evidence and stops after one rename`, async t => {
      const f = await fixture(t, mode, {initial: true, readbackError});
      if (mode === 'async') await assert.rejects(f.invoke, error => error === f.ackError);
      else assert.throws(f.invoke, error => error === f.ackError);
      assert.equal(f.counters.renames, 1);
      assert.equal(f.counters.reads, 1);
      assert.equal(f.counters.unlinks, 0);
      assert.equal(await fsp.readFile(f.target, 'utf8'), previousPayload);
      const temporary = (await fsp.readdir(f.directory)).filter(name => name.endsWith('.tmp'));
      assert.equal(temporary.length, 1, 'unknown outcome discarded the only remaining temporary payload');
      assert.equal(await fsp.readFile(path.join(f.directory, temporary[0]), 'utf8'), payload);
    });
  }

  for (const initial of [false, true]) {
    test(`${mode}: known ${initial ? 'readable mismatch' : 'ENOENT'} retains bounded transient retry`, async t => {
      const f = await fixture(t, mode, {initial});
      const result = await f.invoke();
      assert.equal(f.counters.renames, 2);
      assert.equal(result.rename_committed, true);
      assert.equal(result.rename_attempts, 2);
      assert.equal(result.rename_recovered_via_readback, false);
      assert.equal(await fsp.readFile(f.target, 'utf8'), payload);
      assert.deepEqual(await fsp.readdir(f.directory), ['state.json']);
    });
  }

  test(`${mode}: exact committed readback recovers without another rename`, async t => {
    const f = await fixture(t, mode, {committed: true});
    const result = await f.invoke();
    assert.equal(f.counters.renames, 1);
    assert.equal(result.rename_attempts, 1);
    assert.equal(result.rename_recovered_via_readback, true);
    assert.equal(await fsp.readFile(f.target, 'utf8'), payload);
  });

  test(`${mode}: unknown readback also preserves evidence after nontransient rename failure`, async t => {
    const f = await fixture(t, mode, {readbackError: 'EACCES', firstRenameError: 'EIO'});
    if (mode === 'async') await assert.rejects(f.invoke, error => error === f.ackError);
    else assert.throws(f.invoke, error => error === f.ackError);
    assert.equal(f.counters.renames, 1);
    assert.equal(f.counters.unlinks, 0);
    assert.equal((await fsp.readdir(f.directory)).filter(name => name.endsWith('.tmp')).length, 1);
  });

  test(`${mode}: proven absence and nontransient failure clean only the uncommitted temp`, async t => {
    const f = await fixture(t, mode, {firstRenameError: 'EIO'});
    if (mode === 'async') await assert.rejects(f.invoke, error => error === f.ackError);
    else assert.throws(f.invoke, error => error === f.ackError);
    assert.equal(f.counters.renames, 1);
    assert.equal(f.counters.unlinks, 1);
    assert.deepEqual(await fsp.readdir(f.directory), []);
  });

  test(`${mode}: proven absence still exhausts its fixed six-attempt retry budget`, async t => {
    const f = await fixture(t, mode, {alwaysFail: true});
    if (mode === 'async') await assert.rejects(f.invoke, error => error === f.ackError);
    else assert.throws(f.invoke, error => error === f.ackError);
    assert.equal(f.counters.renames, 6);
    assert.equal(f.counters.reads, 6);
    assert.equal(f.counters.unlinks, 1);
    assert.deepEqual(await fsp.readdir(f.directory), []);
  });
}
