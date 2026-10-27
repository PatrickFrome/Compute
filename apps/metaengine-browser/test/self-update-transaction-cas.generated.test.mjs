import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const require = createRequire(import.meta.url);
const fsp = require('node:fs/promises');
const here = path.dirname(fileURLToPath(import.meta.url));
const journalFile = 'metaengine-self-update-transaction-v1.json';
const lockFile = journalFile + '.lock';
const sourceVersion = '0.7.0-dev.27.1';
const targetVersion = '0.7.0-dev.28.1';
const receipt = {version: targetVersion, available_version: targetVersion,
  metadata_verified: true, restart_gate_safe: true, authority_effect: false};
const serialize = row => `${JSON.stringify(row, null, 2)}\n`;

async function sourceFile(name) {
  try { return await fs.readFile(path.join(here, name), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return fs.readFile(path.join(here, '..', 'src', name), 'utf8');
  }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-tx-cas-generated-'));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('metaengine-tx-cas-generated-'));
    await fs.rm(resolved, {recursive: true, force: true});
  });
  const moduleDirectory = path.join(directory, 'module');
  const profile = path.join(directory, 'profile');
  await fs.mkdir(moduleDirectory);
  await fs.mkdir(profile);
  for (const name of ['durable-json-file.cjs', 'self-update-transaction-journal.mjs']) {
    await fs.writeFile(path.join(moduleDirectory, name), await sourceFile(name));
  }
  const url = pathToFileURL(path.join(moduleDirectory, 'self-update-transaction-journal.mjs')).href;
  const journal = await import(url);
  const app = {getPath: key => { assert.equal(key, 'userData'); return profile; }, getVersion: () => sourceVersion};
  return {directory, profile, url, journal, app, target: path.join(profile, journalFile), lock: path.join(profile, lockFile)};
}

const childSource = `import fs from 'node:fs/promises';
const journal=await import(process.argv[2]);
const app={getPath:()=>process.argv[3],getVersion:()=>${JSON.stringify(sourceVersion)}};
process.send({ready:true});
await new Promise(resolve=>process.once('message',resolve));
try {
  const row=process.argv[4]==='mark'
    ? await journal.markSelfUpdateInstallEffectAttempted(app,{targetVersion:${JSON.stringify(targetVersion)}})
    : await journal.beginSelfUpdateTransaction(app,${JSON.stringify(receipt)});
  process.stdout.write(JSON.stringify({admitted:true,id:row.transaction_id})+'\\n');
} catch(error) {
  process.stdout.write(JSON.stringify({admitted:false,error:String(error.message)})+'\\n');
}
process.disconnect();
`;

function childEnvironment() {
  const result = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP']) {
    if (process.env[key]) result[key] = process.env[key];
  }
  return result;
}

function startChild(script, url, profile, operation) {
  const child = spawn(process.execPath, [script, url, profile, operation], {
    env: childEnvironment(), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  child.on('message', message => { if (message?.ready === true) readyResolve(); });
  child.once('error', readyReject);
  const completion = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('generated_child_timeout')); }, 15000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code !== 0) { const error = new Error(`generated_child_exit_${code}:${stderr}`); readyReject(error); reject(error); return; }
      try { assert.equal(stderr, ''); resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
  return {child, ready, completion};
}

function competingTransaction(original) {
  return {...original, transaction_id: randomUUID(), target_version: '0.7.0-dev.99.1',
    updated_at: '2026-10-26T12:00:00.000Z', evidence: {generated_competing_writer: true}};
}

async function retainedEvidence(f) {
  const names = await fs.readdir(f.profile);
  assert.ok(names.includes(lockFile), 'unknown mutation must retain its durable exclusion lock');
  assert.ok(names.some(name => name.endsWith('.tmp')), 'unknown mutation discarded its generated temp');
  assert.ok(names.some(name => name.includes('.previous')), 'unknown mutation discarded claimed previous bytes');
  return names;
}

for(const operation of ['begin','mark'])test('six generated Node processes admit only one '+operation+' transaction', {timeout: 25000}, async t => {
  const f = await fixture(t);
  if(operation==='mark')await f.journal.beginSelfUpdateTransaction(f.app,receipt);
  const script = path.join(f.directory, 'generated-begin-child.mjs');
  await fs.writeFile(script, childSource);
  const children = Array.from({length: 6}, () => startChild(script, f.url, f.profile, operation));
  t.after(() => { for (const {child} of children) if (child.exitCode === null) child.kill(); });
  await Promise.all(children.map(row => row.ready));
  for (const {child} of children) child.send({start: true});
  const results = await Promise.all(children.map(row => row.completion));
  assert.equal(results.filter(row => row.admitted).length, 1);
  const final = JSON.parse(await fs.readFile(f.target, 'utf8'));
  assert.equal(final.transaction_id, results.find(row => row.admitted).id);
  assert.equal(final.state, operation==='mark'?'INSTALLING':'PREPARED');
  assert.equal(final.attempt_count, 1);
  assert.equal(final.authority_effect, false);
  assert.equal(final.automatic_retry_allowed, false);
});

test('independent query-string module instances admit only one install barrier', async t => {
  const f = await fixture(t);
  const prior = await f.journal.beginSelfUpdateTransaction(f.app, receipt);
  const independent = await Promise.all([import(f.url + '?first=' + randomUUID()), import(f.url + '?second=' + randomUUID())]);
  const results = await Promise.allSettled(independent.map(journal => journal.markSelfUpdateInstallEffectAttempted(f.app, {targetVersion})));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  const final = JSON.parse(await fs.readFile(f.target, 'utf8'));
  assert.equal(final.transaction_id, prior.transaction_id);
  assert.equal(final.state, 'INSTALLING');
  assert.equal(final.evidence.effect_barrier_crossed, true);
  assert.equal(final.automatic_retry_allowed, false);
});

test('concurrent valid transaction inserted inside link-to-final is never overwritten', async t => {
  const f = await fixture(t);
  const prior = await f.journal.beginSelfUpdateTransaction(f.app, receipt);
  const concurrentBytes = serialize(competingTransaction(prior));
  const originalLink = fsp.link;
  const originalWrite = fsp.writeFile;
  let injected = false;
  fsp.link = async (source, destination) => {
    if (!injected && destination === f.target && String(source).endsWith('.tmp')) {
      injected = true;
      await originalWrite(f.target, concurrentBytes, 'utf8');
    }
    return originalLink(source, destination);
  };
  try {
    await assert.rejects(f.journal.markSelfUpdateInstallEffectAttempted(f.app, {targetVersion}));
    assert.equal(injected, true, 'adversarial publication hook was not exercised');
    assert.equal(await fs.readFile(f.target, 'utf8'), concurrentBytes);
    await retainedEvidence(f);
    const lockBytes = await fs.readFile(f.lock, 'utf8');
    await assert.rejects(f.journal.markSelfUpdateInstallEffectAttempted(f.app, {targetVersion}));
    assert.equal(await fs.readFile(f.target, 'utf8'), concurrentBytes);
    assert.equal(await fs.readFile(f.lock, 'utf8'), lockBytes);
  } finally { fsp.link = originalLink; }
});

test('concurrent valid bytes inserted immediately before claim rename are restored without overwrite', async t => {
  const f = await fixture(t);
  const prior = await f.journal.beginSelfUpdateTransaction(f.app, receipt);
  const concurrentBytes = serialize(competingTransaction(prior));
  const originalRename = fsp.rename;
  const originalWrite = fsp.writeFile;
  let injected = false;
  fsp.rename = async (source, destination) => {
    if (!injected && source === f.target && String(destination).includes('.previous')) {
      injected = true;
      await originalWrite(f.target, concurrentBytes, 'utf8');
    }
    return originalRename(source, destination);
  };
  try {
    await assert.rejects(f.journal.markSelfUpdateInstallEffectAttempted(f.app, {targetVersion}));
    assert.equal(injected, true, 'adversarial claim hook was not exercised');
    assert.equal(await fs.readFile(f.target, 'utf8'), concurrentBytes);
    const names = await retainedEvidence(f);
    const previous = names.filter(name => name.includes('.previous'));
    assert.ok((await Promise.all(previous.map(name => fs.readFile(path.join(f.profile, name), 'utf8')))).includes(concurrentBytes));
    await assert.rejects(f.journal.markSelfUpdateInstallEffectAttempted(f.app, {targetVersion}));
    assert.equal(await fs.readFile(f.target, 'utf8'), concurrentBytes);
  } finally { fsp.rename = originalRename; }
});

test('physical publication with lost ACK and EACCES readback retains state, temp, backup and lock', async t => {
  const f = await fixture(t);
  const prior = await f.journal.beginSelfUpdateTransaction(f.app, receipt);
  const originalLink = fsp.link;
  const originalRead = fsp.readFile;
  let injected = false, finalLinks = 0;
  fsp.link = async (source, destination) => {
    if (destination === f.target && String(source).endsWith('.tmp')) {
      finalLinks++;
      await originalLink(source, destination);
      injected = true;
      throw Object.assign(new Error('generated lost link ACK'), {code: 'EPERM'});
    }
    return originalLink(source, destination);
  };
  fsp.readFile = async (file, ...args) => {
    if (injected && file === f.target) throw Object.assign(new Error('generated unreadable target'), {code: 'EACCES'});
    return originalRead(file, ...args);
  };
  try {
    await assert.rejects(f.journal.markSelfUpdateInstallEffectAttempted(f.app, {targetVersion}));
    assert.equal(injected, true);
    assert.equal(finalLinks, 1);
    const committedBytes = await originalRead(f.target, 'utf8');
    const final = JSON.parse(committedBytes);
    assert.equal(final.transaction_id, prior.transaction_id);
    assert.equal(final.state, 'INSTALLING');
    const names = await retainedEvidence(f);
    const preserved = new Map(await Promise.all(names.map(async name => [name, await originalRead(path.join(f.profile, name), 'utf8')])));
    await assert.rejects(f.journal.markSelfUpdateInstallEffectAttempted(f.app, {targetVersion}));
    assert.equal(finalLinks, 1, 'unknown publication was blindly retried');
    assert.equal(await originalRead(f.target, 'utf8'), committedBytes);
    assert.deepEqual((await fs.readdir(f.profile)).sort(), names.sort());
    for (const [name, bytes] of preserved) assert.equal(await originalRead(path.join(f.profile, name), 'utf8'), bytes);
  } finally { fsp.link = originalLink; fsp.readFile = originalRead; }
});

test('lost claim rename ACK preserves previous bytes and a missing final remains UNKNOWN', async t => {
  const f = await fixture(t);
  const prior = await f.journal.beginSelfUpdateTransaction(f.app, receipt);
  const priorBytes = await fs.readFile(f.target, 'utf8');
  const originalRename = fsp.rename;
  let injected = false, claimRenames = 0;
  fsp.rename = async (source, destination) => {
    if (source === f.target && String(destination).includes('.previous')) {
      claimRenames++;
      await originalRename(source, destination);
      injected = true;
      throw Object.assign(new Error('generated lost claim rename ACK'), {code: 'EPERM'});
    }
    return originalRename(source, destination);
  };
  try {
    await assert.rejects(f.journal.markSelfUpdateInstallEffectAttempted(f.app, {targetVersion}));
    assert.equal(injected, true);
    assert.equal(claimRenames, 1);
    await assert.rejects(fs.stat(f.target), {code: 'ENOENT'});
    const names = await retainedEvidence(f);
    const previous = names.filter(name => name.includes('.previous'));
    assert.equal(previous.length, 1);
    assert.equal(await fs.readFile(path.join(f.profile, previous[0]), 'utf8'), priorBytes);
    await assert.rejects(f.journal.readSelfUpdateTransaction(f.app), /self_update_transaction_write_outcome_unknown/);
    await assert.rejects(f.journal.beginSelfUpdateTransaction(f.app, receipt));
    await assert.rejects(f.journal.markSelfUpdateInstallEffectAttempted(f.app, {targetVersion}));
    assert.equal(claimRenames, 1);
    assert.deepEqual((await fs.readdir(f.profile)).sort(), names.sort());
    assert.equal(JSON.parse(await fs.readFile(path.join(f.profile, previous[0]), 'utf8')).transaction_id, prior.transaction_id);
  } finally { fsp.rename = originalRename; }
});
