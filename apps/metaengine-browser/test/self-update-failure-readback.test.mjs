import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {collectSelfUpdateFailureReadback, projectSelfUpdateFailureReadback} from './self-update-failure-readback.mjs';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const helper = fileURLToPath(new URL('./self-update-failure-readback.mjs', import.meta.url));
const privateText = 'DO_NOT_EXPORT_PRIVATE_PATH_TOKEN_OR_ERROR';
const baseline = '0.7.0-dev.100.1';
const target = '0.7.0-dev.101.1';
const preName = 'metaengine-self-update-pre-install-receipt-v1.json';
const txName = 'metaengine-self-update-transaction-v1.json';
const successorName = 'metaengine-self-update-successor-receipt-v1.json';
const json = value => JSON.stringify(value) + '\n';

async function fixture(t) {
  const asar = require('@electron/asar');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'self-update-failure-readback-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const profile = path.join(root, 'profile');
  const packageRoot = path.join(root, 'package-input');
  const resources = path.join(root, 'installation', 'resources');
  await Promise.all([profile, packageRoot, resources].map(dir => fs.mkdir(dir, {recursive: true})));
  const archive = path.join(resources, 'app.asar');
  const makeImage = async version => {
    await fs.writeFile(path.join(packageRoot, 'package.json'), json({name: 'generated-inert-fixture', version, private: privateText}));
    asar.uncache(archive);
    await fs.rm(archive, {force: true});
    await asar.createPackage(packageRoot, archive);
  };
  await makeImage(baseline);
  const context = {
    schema: 'metaengine.self-update.failure-context.v1', source_head: 'a'.repeat(40),
    profile_path: profile, installed_asar_path: archive,
    baseline_version: baseline, target_version: target,
    baseline_asar_sha256: sha(await fs.readFile(archive)),
  };
  const pre = {schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: target, available_version: target, metadata_verified: true,
    restart_gate_safe: true, successor_startup: 'PROBE_ONLY', authority_effect: false,
    private_path: privateText, raw_error: privateText};
  const transaction = {schema: 'metaengine.self-update.transaction.v1', state: 'INSTALLING',
    transaction_id: '12345678-1234-4234-9234-123456789abc', source_version: baseline,
    target_version: target, automatic_retry_allowed: false, authority_effect: false,
    evidence: {physical_effect_attempted: true, token: privateText, reason: privateText}};
  await fs.writeFile(path.join(profile, preName), json(pre));
  await fs.writeFile(path.join(profile, txName), json(transaction));
  return {root, profile, archive, context, pre, transaction, makeImage};
}
async function unchangedFiles(f) {
  const names = [f.archive, path.join(f.profile, preName), path.join(f.profile, txName)];
  return Promise.all(names.map(async file => sha(await fs.readFile(file))));
}

test('missing successor retains bounded journal observations without claiming installation failure or touching input', async t => {
  const f = await fixture(t);
  const before = await unchangedFiles(f);
  const result = await collectSelfUpdateFailureReadback(f.context);
  assert.equal(result.classification, 'BASELINE_BYTES_PRESENT_SUCCESSOR_UNPROVEN');
  assert.equal(result.pre_install_binding_observed, true);
  assert.equal(result.successor.observation, 'ABSENT');
  assert.equal(result.transaction.state, 'INSTALLING');
  assert.equal(result.transaction.physical_effect_attempted, true);
  assert.equal(result.installed_image.package_version, baseline);
  assert.equal(result.installer_result_observed, false);
  assert.equal(result.installation_outcome_proven, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.deepEqual(await unchangedFiles(f), before);
  const output = JSON.stringify(result);
  assert.ok(Buffer.byteLength(output) < 16384);
  assert.ok(!output.includes(privateText) && !output.includes(f.root));
  assert.ok(!output.includes('INSTALLER_NOT_APPLIED'));
});

test('changed target-version ASAR is observed using a fresh header but never becomes exact target/image proof', async t => {
  const f = await fixture(t);
  await collectSelfUpdateFailureReadback(f.context); // populate the archive-reader cache
  await f.makeImage(target);
  const result = await collectSelfUpdateFailureReadback(f.context);
  assert.equal(result.classification, 'TARGET_VERSION_PRESENT_SUCCESSOR_UNPROVEN');
  assert.equal(result.installed_image.package_version, target);
  assert.equal(result.installed_image.matches_baseline_bytes, false);
  assert.equal(result.installed_image.exact_target_bytes_verified, false);
  assert.equal(result.installed_image.installed_executable_verified, false);
  assert.equal(result.installation_outcome_proven, false);
  await f.makeImage('0.7.0-dev.999.1');
  assert.equal((await collectSelfUpdateFailureReadback(f.context)).classification, 'CHANGED_IMAGE_SUCCESSOR_UNPROVEN');
});

test('invalid, oversized and absent receipts remain explicitly unproven without raw payloads', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.profile, preName), privateText.repeat(3000));
  await fs.writeFile(path.join(f.profile, txName), '{"broken":');
  await fs.writeFile(path.join(f.profile, successorName), 'null');
  await fs.rm(f.archive);
  const result = await collectSelfUpdateFailureReadback(f.context);
  assert.equal(result.pre_install.observation, 'OVERSIZE');
  assert.equal(result.transaction.observation, 'INVALID_JSON');
  assert.equal(result.successor.observation, 'INVALID_JSON');
  assert.equal(result.installed_image.observation, 'ABSENT');
  assert.equal(result.classification, 'INSTALLED_IMAGE_UNPROVEN');
  assert.equal(result.pre_install_binding_observed, false);
  assert.equal(result.successor_binding_observed, false);
  assert.ok(!JSON.stringify(result).includes(privateText));
});

test('even a bound successor and booted journal are diagnostic observations, never a PASS or physical proof', async t => {
  const f = await fixture(t);
  const preHash = sha(await fs.readFile(path.join(f.profile, preName)));
  const next = {schema: 'metaengine.self-update.successor-receipt.v1', version: target,
    app_id: 'com.metaengine.browser.test', primary_instance: true, successor_startup: 'PROBE_ONLY',
    pre_install_receipt_sha256: preHash, authority_effect: false, token: privateText};
  await fs.writeFile(path.join(f.profile, successorName), json(next));
  await fs.writeFile(path.join(f.profile, txName), json({...f.transaction, state: 'SUCCESSOR_BOOTED'}));
  const result = await collectSelfUpdateFailureReadback(f.context);
  assert.equal(result.classification, 'SUCCESSOR_RECEIPT_PRESENT_REQUIRES_QUALIFICATION');
  assert.equal(result.successor_binding_observed, true);
  assert.equal(result.verification_succeeded, false);
  assert.equal(result.installation_outcome_proven, false);
  next.pre_install_receipt_sha256 = 'f'.repeat(64);
  await fs.writeFile(path.join(f.profile, successorName), json(next));
  assert.equal((await collectSelfUpdateFailureReadback(f.context)).successor_binding_observed, false);
});

test('unknown states and arbitrary metadata are dropped by the pure projection', () => {
  const hostile = {observation: privateText, sha256: privateText, value: {schema: privateText, state: privateText, error: privateText}};
  const result = projectSelfUpdateFailureReadback({context: {source_head: privateText, target_version: privateText},
    preInstall: hostile, successor: hostile, transaction: hostile, installedImage: hostile});
  assert.equal(result.classification, 'INSTALLED_IMAGE_UNPROVEN');
  assert.equal(result.source_head, null);
  assert.equal(result.transaction.observation, 'UNREADABLE');
  assert.ok(!JSON.stringify(result).includes(privateText));
});

test('real CLI captures only established context and redacts invalid-context failure', async t => {
  const f = await fixture(t);
  const contextFile = path.join(f.root, 'self-update-failure-context.json');
  await fs.writeFile(contextFile, json(f.context));
  const run = async () => JSON.parse((await exec(process.execPath, [helper, '--context', contextFile], {timeout: 15000})).stdout);
  assert.equal((await run()).transaction.state, 'INSTALLING');
  await fs.writeFile(contextFile, json({...f.context, installed_asar_path: privateText}));
  const invalid = await run();
  assert.equal(invalid.classification, 'CAPTURE_UNAVAILABLE');
  assert.equal(invalid.verification_succeeded, false);
  assert.ok(!JSON.stringify(invalid).includes(privateText));
});

const windows = process.platform === 'win32';
const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const quotePs = text => "'" + text.replaceAll("'", "''") + "'";

test('PowerShell parser accepts diagnostic wiring without executing the physical harness', {skip: !windows}, async () => {
  const files = ['self-update-fast-physical.ps1', 'self-update-fast-physical-ci.ps1']
    .map(name => fileURLToPath(new URL(name, import.meta.url)));
  const command = files.map(file => {
    return '$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('
      + quotePs(file) + ',[ref]$tokens,[ref]$errors);if($errors.Count){throw $errors[0].Message}';
  }).join('\n');
  await exec(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {timeout: 15000});
});

for (const validContext of [true, false]) {
  test('failure wrapper preserves original failure with ' + (validContext ? 'journal capture' : 'unavailable diagnostics'),
    {skip: !windows}, async t => {
      const f = await fixture(t);
      const testRoot = path.join(f.root, 'harness', 'test');
      const runner = path.join(f.root, 'runner');
      await fs.mkdir(testRoot, {recursive: true});
      await fs.mkdir(runner);
      let wrapper = await fs.readFile(new URL('./self-update-fast-physical-ci.ps1', import.meta.url), 'utf8');
      // The fixture replaces only git identity lookup. The actual wrapper and
      // actual reader execute; the physical installer script is a throwing stub.
      const lookup = '$head = (git rev-parse HEAD).Trim()';
      assert.equal(wrapper.split(lookup).length, 2);
      wrapper = wrapper.replace(lookup, "$head = '" + 'a'.repeat(40) + "'");
      const wrapperFile = path.join(testRoot, 'self-update-fast-physical-ci.ps1');
      await fs.writeFile(wrapperFile, wrapper);
      await fs.copyFile(helper, path.join(testRoot, 'self-update-failure-readback.mjs'));
      const context = validContext ? json(f.context) : '{"invalid":';
      const stub = "[IO.File]::WriteAllText((Join-Path $env:RUNNER_TEMP 'self-update-failure-context.json'),"
        + quotePs(context) + ",[Text.UTF8Encoding]::new($false))\nthrow 'generated_physical_failure'\n";
      await fs.writeFile(path.join(runner, 'self-update-fast-physical-qualified.ps1'), stub);
      await assert.rejects(exec(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapperFile],
        {cwd: path.dirname(testRoot), timeout: 25000, env: {...process.env, RUNNER_TEMP: runner, ME2_REQUIRE_QUALIFIED_INSTALLER: '1'}}),
        error => { assert.match(error.stderr, /generated_physical_failure/); return true; });
      const evidence = path.join(path.dirname(testRoot), 'self-update-fast-evidence');
      assert.equal((await fs.readFile(path.join(evidence, 'physical-script-status.txt'), 'utf8')).replace(/^\uFEFF/, '').trim(), 'FAIL');
      const result = JSON.parse(await fs.readFile(path.join(evidence, 'self-update-failure-readback.json'), 'utf8'));
      assert.equal(result.verification_succeeded, false);
      assert.equal(result.installation_outcome_proven, false);
      if (validContext) assert.equal(result.transaction.state, 'INSTALLING');
      else assert.equal(result.classification, 'CAPTURE_UNAVAILABLE');
      const failure = JSON.parse(await fs.readFile(path.join(evidence, 'self-update-diagnostic-failure.json'), 'utf8'));
      assert.match(failure.exception_message, /generated_physical_failure/);
      assert.ok(!JSON.stringify(result).includes(privateText));
    });
}

test('fresh-only production helper refuses a nonempty disposable install root without changing its bytes', {skip: !windows}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'self-update-fresh-hold-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const installed = path.join(root, 'METAENGINE Browser Test.exe');
  const inert = Buffer.from('INERT GENERATED FIXTURE; NOT AN EXECUTABLE');
  await fs.writeFile(installed, inert);
  const gate = fileURLToPath(new URL('../build/installer-shutdown.ps1', import.meta.url));
  // The real helper exits at its nonempty-root precheck, before registry or
  // process inventory. No NSIS, Browser, old uninstaller, or user profile runs.
  await assert.rejects(exec(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', gate, '-InstalledExe', installed, '-RequireFreshInstall',
    '-InstallRegistryKey', 'Software\\GeneratedInertFixture\\Install',
    '-UninstallRegistryKey', 'Software\\GeneratedInertFixture\\Uninstall'], {timeout: 15000}),
    error => { assert.equal(error.code, 23); assert.match(error.stderr, /installer_transition_existing_installation_unqualified/); return true; });
  assert.deepEqual(await fs.readFile(installed), inert);
  assert.deepEqual(await fs.readdir(root), ['METAENGINE Browser Test.exe']);
});
