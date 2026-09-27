// installer-provenance.test.mjs — unit + CI-contract tests for the R85
// build-once installer provenance slice.
//
// Part 1: behavioral tests of scripts/installer-provenance.mjs (cross-platform).
// Part 2: contract tests pinning the forge wiring inside the Package Smoke
//         workflow and the standalone forge workflow, so the build-once
//         guarantee cannot silently regress.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const SCRIPT = path.join(APP_ROOT, 'scripts', 'installer-provenance.mjs');
const PACKAGE_SMOKE_YML = path.join(REPO_ROOT, '.github', 'workflows', 'browser-windows-package-smoke.yml');
const FORGE_YML = path.join(REPO_ROOT, '.github', 'workflows', 'browser-installer-forge-v1.yml');

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

async function makeScratch(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'installer-provenance-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function digestOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('write stamps schema-valid provenance with exact sha256 and bytes', async (t) => {
  const dir = await makeScratch(t);
  const payload = Buffer.from('metaengine forge installer payload\n'.repeat(1024));
  const installer = path.join(dir, 'METAENGINE-Browser-Test-Setup-0.8.2-x64.exe');
  const out = path.join(dir, 'installer-provenance.json');
  await writeFile(installer, payload);

  const run = runScript(['write', '--installer', installer, '--out', out, '--source-head', 'a'.repeat(64), '--builder-pin', 'electron-builder@26.15.7', '--run-id', '36281483845', '--run-attempt', '1', '--workflow', 'Browser Installer Forge (build once)']);
  assert.equal(run.status, 0, run.stderr);
  const record = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(record.schema, 'metaengine.installer.provenance.v1');
  assert.equal(record.installer_name, 'METAENGINE-Browser-Test-Setup-0.8.2-x64.exe');
  assert.equal(record.installer_sha256, digestOf(payload));
  assert.equal(record.installer_bytes, payload.length);
  assert.equal(record.source_head, 'a'.repeat(64));
  assert.equal(record.builder_pin, 'electron-builder@26.15.7');
  assert.equal(record.run_id, '36281483845');
  assert.ok(!Number.isNaN(Date.parse(record.created_at)));
  const stdout = JSON.parse(run.stdout);
  assert.equal(stdout.ok, true);
  assert.equal(stdout.installer_sha256, digestOf(payload));
});

test('verify accepts installer bytes matching provenance', async (t) => {
  const dir = await makeScratch(t);
  const payload = Buffer.from('matching-bytes\n');
  const installer = path.join(dir, 'setup.exe');
  const out = path.join(dir, 'installer-provenance.json');
  await writeFile(installer, payload);
  assert.equal(runScript(['write', '--installer', installer, '--out', out]).status, 0);

  const run = runScript(['verify', '--installer', installer, '--provenance', out]);
  assert.equal(run.status, 0, run.stderr);
  const stdout = JSON.parse(run.stdout);
  assert.equal(stdout.ok, true);
  assert.equal(stdout.installer_sha256, digestOf(payload));
});

test('verify honors --expect-sha256 on match and mismatch', async (t) => {
  const dir = await makeScratch(t);
  const payload = Buffer.from('expect-sha case\n');
  const installer = path.join(dir, 'setup.exe');
  const out = path.join(dir, 'installer-provenance.json');
  await writeFile(installer, payload);
  assert.equal(runScript(['write', '--installer', installer, '--out', out]).status, 0);

  const good = runScript(['verify', '--installer', installer, '--provenance', out, '--expect-sha256', digestOf(payload)]);
  assert.equal(good.status, 0, good.stderr);

  const bad = runScript(['verify', '--installer', installer, '--provenance', out, '--expect-sha256', 'b'.repeat(64)]);
  assert.equal(bad.status, 4);
  assert.match(bad.stderr, /expected_sha_mismatch/);
});

test('verify detects tampered installer bytes with machine code', async (t) => {
  const dir = await makeScratch(t);
  const installer = path.join(dir, 'setup.exe');
  const out = path.join(dir, 'installer-provenance.json');
  await writeFile(installer, Buffer.from('original bytes\n'));
  assert.equal(runScript(['write', '--installer', installer, '--out', out]).status, 0);
  await writeFile(installer, Buffer.from('TAMPERED bytes\n'));

  const run = runScript(['verify', '--installer', installer, '--provenance', out]);
  assert.equal(run.status, 4);
  assert.match(run.stderr, /provenance_sha_mismatch/);
});

test('verify rejects invalid provenance schema and unparseable JSON', async (t) => {
  const dir = await makeScratch(t);
  const installer = path.join(dir, 'setup.exe');
  await writeFile(installer, Buffer.from('schema cases\n'));

  const wrongSchema = path.join(dir, 'wrong-schema.json');
  await writeFile(wrongSchema, JSON.stringify({ schema: 'some.other.schema.v9', installer_sha256: digestOf(Buffer.from('schema cases\n')) }));
  const runSchema = runScript(['verify', '--installer', installer, '--provenance', wrongSchema]);
  assert.equal(runSchema.status, 5);
  assert.match(runSchema.stderr, /provenance_schema_invalid/);

  const unparseable = path.join(dir, 'broken.json');
  await writeFile(unparseable, '{not json');
  const runBroken = runScript(['verify', '--installer', installer, '--provenance', unparseable]);
  assert.equal(runBroken.status, 5);
  assert.match(runBroken.stderr, /provenance_unparseable/);
});

test('missing installer or provenance exits 3', async (t) => {
  const dir = await makeScratch(t);
  const runMissingInstaller = runScript(['verify', '--installer', path.join(dir, 'absent.exe'), '--provenance', path.join(dir, 'p.json')]);
  assert.equal(runMissingInstaller.status, 3);

  const installer = path.join(dir, 'setup.exe');
  await writeFile(installer, Buffer.from('missing provenance case\n'));
  const runMissingProvenance = runScript(['write', '--installer', installer, '--out', path.join(dir, 'absent-dir', 'p.json')]);
  assert.notEqual(runMissingProvenance.status, 0);
});

test('usage errors exit 2', async (t) => {
  const noArgs = runScript([]);
  assert.equal(noArgs.status, 2);

  const unknownFlag = runScript(['verify', '--installer', 'x', '--provenance', 'y', '--bogus', '1']);
  assert.equal(unknownFlag.status, 2);

  const missingValue = runScript(['verify', '--installer']);
  assert.equal(missingValue.status, 2);
});

test('package smoke wires forge resolve, import, verify and publish contract', async (t) => {
  const workflow = await readFile(PACKAGE_SMOKE_YML, 'utf8');
  // Cross-run artifact identity is pinned to the exact head.
  assert.match(workflow, /me2-installer-forge-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  // Resolve step lists forge artifacts and emits artifact_run_id.
  assert.match(workflow, /id: resolve-forge/);
  assert.match(workflow, /actions\/artifacts\?name=/);
  // Import uses the pinned download-artifact with run-id.
  assert.match(workflow, /download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/);
  assert.match(workflow, /run-id: \$\{\{ steps\.resolve-forge\.outputs\.artifact_run_id \}\}/);
  // Imported bytes are provenance-verified before any gate consumes them.
  assert.match(workflow, /installer-provenance\.mjs verify --installer/);
  assert.match(workflow, /forge_import_source_head_drift/);
  // Inline build remains available and stamps provenance too.
  assert.match(workflow, /installer_source='forge-shared'/);
  assert.match(workflow, /installer_source='inline-primary'/);
  // Build step is skipped exactly when shared bytes are imported.
  assert.match(workflow, /steps\.resolve-forge\.outputs\.artifact_run_id == ''/);
  // Forge publish upload exists for downstream gates.
  assert.match(workflow, /Publish shared forge installer for downstream gates/);
  // Listing artifacts from other runs requires actions: read.
  assert.match(workflow, /actions: read/);
});

test('forge workflow builds once and uploads immutable per-head artifact', async (t) => {
  const workflow = await readFile(FORGE_YML, 'utf8');
  assert.match(workflow, /^on:/m);
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /me2-installer-forge-\$\{\{ steps\.prove\.outputs\.forge_head \}\}/);
  assert.match(workflow, /npx --yes electron-builder@26\.15\.7 --win nsis --x64 --config electron-builder\.test\.json --publish never/);
  assert.match(workflow, /installer-provenance\.mjs write --installer/);
  assert.match(workflow, /if-no-files-found: error/);
  // Forge never cancels itself: bytes are precious.
  assert.match(workflow, /cancel-in-progress: false/);
});
