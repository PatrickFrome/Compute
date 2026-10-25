import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const browser = new URL('apps/metaengine-browser/', root);
const workflow = readFileSync(new URL('.github/workflows/r84-desktop-convergence-v1.yml', root), 'utf8').replace(/\r\n/g, '\n');
const self = 'test/r84-desktop-workflow-contract.test.mjs';
// The retired ME2 Fleet Tabs Host is not a current allocation/identity owner.
// Browser main, its one registry/exact-view index and the surviving UI gateway
// retain the current boundaries exercised by the existing R84 contract suite.
const sources = ['src/main.mjs', 'src/tab-registry.mjs', 'src/browser-webcontents-tab-index.mjs',
  'src/browser-realtime-process-plane.mjs', 'src/native-supervisor-client.mjs', 'src/me2/me2-ui-gateway.mjs'];
const contracts = ['test/r84-desktop-canonical-identity.test.mjs', 'test/tab-registry.test.mjs',
  'test/browser-realtime-process-plane.test.mjs', 'test/browser-webcontents-tab-index.test.mjs',
  'test/browser-brain-runtime-binding-memory.test.mjs', 'test/browser-runtime-binding-generation-fence.test.mjs',
  'test/native-supervisor-exact-target.test.mjs', self];

function step(source, name) {
  const start = source.indexOf('      - name: ' + name + '\n');
  const end = source.indexOf('\n      - name:', start + 1);
  assert.ok(start >= 0 && end > start, 'bounded workflow step required: ' + name);
  return source.slice(start, end);
}
function parseTargets(source) {
  const parse = step(source, 'Parse R84 convergence sources');
  assert.doesNotMatch(parse, /continue-on-error|\|\|\s*(?:true|:)/);
  const targets = [...parse.matchAll(/^ {10}node --check (src\/[^\s]+)\s*$/gm)].map(match => match[1]);
  assert.ok(targets.length > 0, 'parse targets must be explicit');
  assert.equal((parse.match(/\bnode --check\b/g) || []).length, targets.length, 'every parse command must have one explicit target');
  assert.equal(new Set(targets).size, targets.length, 'duplicate parse target');
  return targets;
}
function assertSourceCoverage(source) {
  const targets = parseTargets(source);
  assert.ok(!targets.includes('src/me2/me2-fleet-tabs-host.mjs'), 'retired ME2 host must not be a current parse target');
  for (const file of sources) assert.ok(targets.includes(file), 'current desktop boundary must be parsed: ' + file);
}
function assertContractCoverage(source) {
  const suite = step(source, 'Prove canonical WebContents BrowserCell CDP identity convergence');
  assert.doesNotMatch(suite, /continue-on-error|\|\|\s*(?:true|:)/);
  assert.doesNotMatch(suite, /--test-(?:name|skip)-pattern/);
  assert.match(suite, /node --test/);
  const targets = [...suite.matchAll(/^ {10}(test\/[^\s]+\.test\.mjs)\s*$/gm)].map(match => match[1]);
  for (const file of contracts) assert.ok(targets.includes(file), 'desktop contract must still execute: ' + file);
}
function assertApplicability(source) {
  const pullRequest = source.match(/^  pull_request:\n((?: {4,}[^\n]*\n|\n)*)/m)?.[1];
  assert.ok(pullRequest, 'PR qualification must remain enabled');
  const paths = [...pullRequest.matchAll(/^ {6}- '([^']+)'\s*$/gm)].map(match => match[1]);
  for (const file of [...sources, ...contracts]) {
    const covered = paths.includes('apps/metaengine-browser/' + file)
      || file.startsWith('src/me2/') && paths.includes('apps/metaengine-browser/src/me2/**');
    assert.ok(covered, 'desktop source or contract must trigger qualification: ' + file);
  }
}

test('R84 workflow explicit parse targets all exist on the current source tree', () => {
  for (const file of parseTargets(workflow)) {
    assert.match(file, /^src\/[A-Za-z0-9_./-]+\.mjs$/);
    assert.ok(!file.split('/').includes('..'), 'parse target must stay inside Browser source');
    assert.ok(statSync(new URL(file, browser)).isFile(), 'missing parse target: ' + file);
  }
});
test('R84 parses current canonical identity, exact view and surviving gateway boundaries', () => assertSourceCoverage(workflow));
test('R84 retains all seven identity contracts and executes its workflow regression', () => assertContractCoverage(workflow));
test('every current R84 source and contract independently triggers qualification', () => assertApplicability(workflow));

for (const file of ['src/tab-registry.mjs', 'src/browser-webcontents-tab-index.mjs', 'src/me2/me2-ui-gateway.mjs'])
  test('R84 coverage refuses removal of ' + file, () => {
    assert.ok(workflow.includes('node --check ' + file), 'negative fixture must remove an actual parse target');
    const changed = workflow.replace('          node --check ' + file + '\n', '');
    assert.notEqual(changed, workflow);
    assert.throws(() => assertSourceCoverage(changed), { code: 'ERR_ASSERTION' });
  });
test('R84 regression rejects a dropped identity contract or its own PR trigger', () => {
  const droppedContract = workflow.replace('          test/browser-webcontents-tab-index.test.mjs\n', '');
  assert.notEqual(droppedContract, workflow);
  assert.throws(() => assertContractCoverage(droppedContract), { code: 'ERR_ASSERTION' });
  const droppedTrigger = workflow.replace("      - 'apps/metaengine-browser/" + self + "'\n", '');
  assert.notEqual(droppedTrigger, workflow);
  assert.throws(() => assertApplicability(droppedTrigger), { code: 'ERR_ASSERTION' });
});
