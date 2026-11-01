import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const workflow = name => fs.readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8');
const windows = workflow('client-source-candidate-w73.yml');
const validator = windows.match(/@'\s*\n([\s\S]*?)'@ \| node --input-type=module - \$tap/)?.[1];
assert.ok(validator, 'execute the actual Windows TAP validator');
const code = validator.replace(/^\s*import .*;\s*$/gm, '');

// Exact names from the two real fixture files, including their dynamic cases.
// These are source-only TAP fixtures, not evidence of Windows execution.
const names = `runtime inventory includes root, empty directories and the original manifest
relocatable content identity is separate from the original physical-root binding
runtime inventory rejects same-size file mutation
runtime inventory rejects self-rewritten manifest
runtime inventory rejects added empty cache directory
runtime inventory rejects removed empty directory
runtime inventory rejects new empty file
runtime inventory rejects file replaced by directory
empty directories remain covered even though the package content hash intentionally excludes them
runtime inventory rejects . mode changes
runtime inventory rejects empty mode changes
runtime inventory rejects server.js mode changes
same-byte link retargeting and file-to-link replacement are detected
internal absolute links retain relocatable identity without executor paths
escaping links, directory cycles and dangling links cannot qualify a snapshot
a same-name file replacement during the read cannot hide behind the opened descriptor
a mutation of an earlier file during a later read is caught by the final sweep
the final sweep rejects earlier content even when file-time observations alias
the original expected inventory must keep its own digest
an initially supplied root symlink or Windows junction is refused
root rename followed by a symlink or Windows junction cannot retain a PASS
a byte-identical replacement directory cannot reuse the original physical binding
a root reached through a symlink or Windows junction ancestor is refused
a legacy content-only snapshot cannot establish physical-root immutability
W73 invoked package scripts execute all new UI acceptance regressions
the harness refuses an original root symlink or Windows junction before creating evidence or launching children
a server already exited with code 0 cannot qualify owned shutdown
a server already exited with code 1 cannot qualify owned shutdown
a running owned server may exit 0 after the harness requests SIGTERM
a running owned server may exit 143 after the harness requests SIGTERM
an ordinary owned SIGTERM signal exit is accepted
a nonzero failure after the owned SIGTERM request is rejected
SIGKILL cleanup of an unresponsive owned child never qualifies as graceful acceptance
renderer evidence finishes finite transitions and cannot escape its output directory`.split('\n');
const posixNames = new Set([
  'runtime inventory rejects . mode changes',
  'runtime inventory rejects empty mode changes',
  'runtime inventory rejects server.js mode changes',
  'same-byte link retargeting and file-to-link replacement are detected',
  'internal absolute links retain relocatable identity without executor paths',
  'escaping links, directory cycles and dangling links cannot qualify a snapshot',
  'a running owned server may exit 0 after the harness requests SIGTERM',
  'a running owned server may exit 143 after the harness requests SIGTERM',
  'an ordinary owned SIGTERM signal exit is accepted',
  'a nonzero failure after the owned SIGTERM request is rejected',
  'SIGKILL cleanup of an unresponsive owned child never qualifies as graceful acceptance',
]);
const physicalRootCase = 'an initially supplied root symlink or Windows junction is refused';
const metadataCase = 'the final sweep rejects earlier content even when file-time observations alias';
const rows = () => names.map((name, i) => `ok ${i + 1} - ${name}${posixNames.has(name) ? ' # SKIP Windows POSIX fixture' : ''}`);
const tap = lines => ['TAP version 13', ...lines, '1..34', '# tests 34', '# suites 0', '# pass 23', '# fail 0',
  '# cancelled 0', '# skipped 11', '# todo 0'].join('\n');
const validate = text => vm.runInNewContext(code, { assert, fs: { readFileSync: () => text },
  process: { argv: ['node', '-', 'fixture.tap'] }, console: { log() {} } });

test('Windows CI accepts all 34 fixture results with exactly the 11 declared POSIX skips', () => {
  assert.equal(names.length, 34);
  assert.equal(new Set(names).size, 34);
  assert.equal(rows().filter(line => line.includes(' # SKIP ')).length, 11);
  assert.ok(rows().some(line => line.endsWith(' - ' + metadataCase)), 'new content case must be an unskipped result');
  validate(tap(rows()));
});

for (const [name, mutate] of [
  ['missing physical-root test', lines => lines.filter(s => !s.endsWith(' - ' + physicalRootCase))],
  ['duplicate physical-root name', lines => lines.map(s => s.replace('root rename followed by a symlink or Windows junction cannot retain a PASS', physicalRootCase))],
  ['missing renderer confinement test with unchanged count', lines => lines.map(s => s.replace('renderer evidence finishes finite transitions and cannot escape its output directory', 'unrelated test'))],
  ['skipped required physical-root test', lines => lines.map(s => s.endsWith(' - ' + physicalRootCase) ? s + ' # SKIP unsupported' : s)],
  ['missing metadata-alias test with unchanged count', lines => lines.map(s => s.replace(metadataCase, 'unrelated content test'))],
  ['skipped required metadata-alias test', lines => lines.map(s => s.endsWith(' - ' + metadataCase) ? s + ' # SKIP unsupported' : s)],
  ['failed fixture', lines => lines.map((s, i) => i === 0 ? s.replace(/^ok/, 'not ok') : s)],
  ['TODO fixture', lines => lines.map((s, i) => i === 0 ? s + ' # TODO later' : s)],
  ['unexpected POSIX pass replacing a declared skip', lines => lines.map(s => s.includes(' - runtime inventory rejects . mode changes # SKIP ') ? s.replace(/ # SKIP.*$/, '') : s)],
  ['TAP bailout', lines => [...lines, 'Bail out! incomplete']],
]) test(`Windows CI rejects ${name}`, () => assert.throws(() => validate(tap(mutate(rows())))));

test('W29 installs frozen UI dependencies before invoking TypeScript-dependent regression tests', () => {
  const source = workflow('metaengine-client-w29-primary-views.yml');
  assert.match(source, /oven-sh\/setup-bun@[a-f0-9]{40}/);
  assert.match(source, /bun-version: '1\.3\.3'/);
  const install = source.indexOf('bun install --frozen-lockfile --ignore-scripts');
  assert.ok(install >= 0 && install < source.indexOf('run: npm run test:operator-primary'));
  assert.match(source, /git diff --exit-code -- package\.json bun\.lock/);
  assert.match(source, /run: npm run test:operator-observatory/);
  assert.match(source, /run: node --test src\/lib\/\*\.test\.mjs scripts\/\*\.test\.mjs/);
});
