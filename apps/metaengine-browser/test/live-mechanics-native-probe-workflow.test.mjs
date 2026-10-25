import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { browserCiResourceObservation } from '../../../.github/browser-ci-resource-observation.mjs';

const root = new URL('../../../', import.meta.url), browser = new URL('apps/metaengine-browser/', root);
const workflow = readFileSync(new URL('.github/workflows/client-live-mechanics-recovery-v1.yml', root), 'utf8').replace(/\r\n/g, '\n');
const self = 'test/live-mechanics-native-probe-workflow.test.mjs';
const observation = '../../.github/browser-ci-resource-observation.mjs';
const files = ['test/codex-cli-runner.test.mjs', 'test/codex-cli-sandbox-probe.test.mjs',
  'test/native-coding-host-observers.test.mjs', 'test/windows-local-computer-executor.test.mjs',
  'test/codex-cli-windows-output-order.test.mjs'];
const fullGate = "        if: ${{ !cancelled() && steps.qualification_prerequisites.outcome == 'success' }}";

function step(source, name) {
  const start = source.indexOf('      - name: ' + name + '\n');
  assert.ok(start >= 0, 'required qualification step: ' + name);
  const end = source.indexOf('\n      - name:', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}
function assertProbeAndFull(source) {
  const probe = step(source, 'Isolated Windows native diagnostic (not contention proof)');
  const full = step(source, 'Exercise all Browser mechanics including real local IPC');
  assert.match(probe, /^        if: runner\.os == 'Windows'$/m);
  assert.match(probe, /^        timeout-minutes: 10$/m);
  assert.match(probe, /^          node --test --test-concurrency=1 \\$/m);
  const targets = [...probe.matchAll(/^ {12}(test\/[^\s]+\.test\.mjs)(?: \\)?$/gm)].map(match => match[1]);
  assert.deepEqual(targets, files, 'all five complete native-bearing files must run serially');
  assert.match(full, /^        timeout-minutes: 20$/m);
  assert.match(full, /^          node --test --test-concurrency=4 'test\/\*\.test\.mjs'$/m);
  assert.ok(full.includes(fullGate), 'a failed/timed-out probe must not suppress the full suite after successful prerequisites');
  assert.doesNotMatch(full, /steps\.windows_native_probe|\bsuccess\(\)/);
  for (const block of [probe, full]) {
    assert.match(block, /^        shell: bash$/m);
    assert.match(block, /^          set -euo pipefail$/m);
    assert.doesNotMatch(block, /continue-on-error|--test-(?:name|skip)-pattern|--test-only|--test-shard|set \+e|\|\|\s*(?:true|:)/);
  }
}

test('Live Mechanics keeps the existing two jobs, platform matrix and bounded per-platform qualification budgets', () => {
  const jobs = workflow.split('\njobs:\n')[1]; assert.ok(jobs);
  assert.deepEqual([...jobs.matchAll(/^  ([a-z][\w-]*):$/gm)].map(match => match[1]), ['browser-mechanics', 'cognitive-postgres']);
  const mechanics = jobs.split('\n  cognitive-postgres:')[0];
  assert.match(mechanics, /fail-fast: false\n      matrix:\n        os: \[ubuntu-24\.04, windows-2025\]/);
  assert.match(mechanics, /^    timeout-minutes: \$\{\{ matrix\.os == 'windows-2025' && 35 \|\| 20 \}\}$/m);
  assert.doesNotMatch(mechanics, /continue-on-error|\n        (?:include|exclude):|max-parallel/);
});
test('Windows gets five complete serial diagnostic files and both platforms still execute the unchanged full four-worker glob', () => {
  assertProbeAndFull(workflow);
  for (const file of files) assert.ok(statSync(new URL(file, browser)).isFile());
  const full = step(workflow, 'Exercise all Browser mechanics including real local IPC');
  assert.match(full, /METAENGINE_TEST_ELECTRON_MODE: \$\{\{ matrix\.os == 'ubuntu-24.04' && 'ASAR_NODE' \|\| 'MAIN_PROCESS' \}\}/);
});
test('full coverage and source readback depend on all successful prerequisites, never on probe success', () => {
  const prerequisites = step(workflow, 'Parse runtime contracts');
  assert.match(prerequisites, /^        id: qualification_prerequisites$/m);
  assert.match(prerequisites, /^          npm run check$/m);
  assert.ok(prerequisites.includes('          node --test ' + self));
  assert.match(prerequisites, /^          set -euo pipefail$/m);
  assert.doesNotMatch(prerequisites, /if:|continue-on-error|set \+e/);
  assert.ok(workflow.indexOf('name: Parse runtime contracts') < workflow.indexOf('name: Isolated Windows native diagnostic'));
  const inspect = step(workflow, 'Inspect generated artifacts and prove tracked source unchanged');
  assert.ok(inspect.includes(fullGate)); assert.match(inspect, /git diff --exit-code/);
});
test('both qualification steps emit safe resource/timestamp observations and helper changes trigger CI', () => {
  const probe = step(workflow, 'Isolated Windows native diagnostic (not contention proof)');
  const full = step(workflow, 'Exercise all Browser mechanics including real local IPC');
  assert.ok(probe.includes('node ' + observation + ' isolated-windows-native'));
  assert.ok(full.includes('node ' + observation + ' full-browser-suite'));
  assert.ok(workflow.includes("      - '.github/browser-ci-resource-observation.mjs'"));
  const record = browserCiResourceObservation('isolated-windows-native', {
    environment: { ImageOS: 'win25-vs2026', ImageVersion: '20261021.278.1', TOKEN: 'secret-token', USERPROFILE: 'private-profile' },
    system: { cpus: () => [1, 2], availableParallelism: () => 2, totalmem: () => 1000, freemem: () => 500 },
    now: () => new Date('2026-10-25T00:00:00.000Z'),
  });
  assert.deepEqual(Object.keys(record), ['schema', 'phase', 'observed_at', 'platform', 'node_version', 'cpu_count',
    'available_parallelism', 'total_memory_bytes', 'free_memory_bytes', 'image_os', 'image_version', 'contention_proven', 'native_qualification_proven']);
  assert.equal(record.cpu_count, 2); assert.equal(record.available_parallelism, 2);
  assert.equal(record.observed_at, '2026-10-25T00:00:00.000Z');
  assert.equal(record.contention_proven, false); assert.equal(record.native_qualification_proven, false);
  assert.doesNotMatch(JSON.stringify(record), /secret-token|private-profile/);
  assert.equal(browserCiResourceObservation('full-browser-suite', { environment: { ImageVersion: 'bad\nlabel' } }).image_version, null);
  assert.throws(() => browserCiResourceObservation('untrusted-phase'), /phase_invalid/);
});
for (const [name, before, after] of [
  ['omitted native file', '            test/codex-cli-sandbox-probe.test.mjs \\\n', ''],
  ['omitted output-order native file', '            test/codex-cli-windows-output-order.test.mjs\n', ''],
  ['parallel native diagnostic', '--test-concurrency=1 \\', '--test-concurrency=4 \\'],
  ['filtered full suite', "--test-concurrency=4 'test/*.test.mjs'", "--test-concurrency=4 --test-name-pattern=selected 'test/*.test.mjs'"],
  ['probe-dependent full suite', fullGate, "        if: ${{ success() && steps.windows_native_probe.outcome == 'success' }}"],
  ['suppressed probe failure', '        id: windows_native_probe', '        continue-on-error: true\n        id: windows_native_probe'],
]) test('Live Mechanics qualification guard rejects ' + name, () => {
  assert.ok(workflow.includes(before), 'mutation must target the actual workflow');
  const changed = workflow.replace(before, after); assert.notEqual(changed, workflow);
  assert.throws(() => assertProbeAndFull(changed), { code: 'ERR_ASSERTION' });
});

test('Node expands the literal full-test glob and executes every matching fixture without shell expansion', async t => {
  const temporary = await fs.realpath(os.tmpdir());
  const directory = await fs.realpath(await fs.mkdtemp(path.join(temporary, 'metaengine-node-literal-glob-')));
  t.after(async () => {
    assert.equal(await fs.realpath(directory), directory); assert.equal(path.dirname(directory), temporary);
    assert.ok(path.basename(directory).startsWith('metaengine-node-literal-glob-'));
    await fs.rm(directory, { recursive: true, force: false });
  });
  await fs.mkdir(path.join(directory, 'test'));
  for (const name of ['alpha', 'beta']) await fs.writeFile(path.join(directory, 'test', name + '.test.mjs'),
    `import test from 'node:test';test('literal-glob-${name}',()=>{});\n`);
  await fs.writeFile(path.join(directory, 'test', 'not-a-test.mjs'), "throw Error('nonmatching_file_must_not_run');\n");
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; // Independent disposable test runner, not this parent test's child protocol.
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--test', '--test-concurrency=4', '--test-reporter=tap', 'test/*.test.mjs'],
    { cwd: directory, env, shell: false, windowsHide: true, timeout: 15000, maxBuffer: 65536 });
  for (const name of ['alpha', 'beta']) assert.match(stdout, new RegExp('^ok \\d+ - literal-glob-' + name + '$', 'm'));
  assert.match(stdout, /^# tests 2$/m); assert.match(stdout, /^# pass 2$/m); assert.match(stdout, /^# fail 0$/m);
});
