import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const uiRoot = new URL('apps/me2-ui/', root);
const workflow = readFileSync(new URL('.github/workflows/browser-critical-audit-v1.yml', root), 'utf8').replace(/\r\n/g, '\n');
const readinessBoundaries = [
  'src/components/me2/store.tsx',
  'src/components/me2/interrupted-setup-recovery.tsx',
  'src/hooks/use-client-runtime-status.ts',
  'src/lib/client-runtime-resource.ts',
  'src/lib/client-readiness-labels.ts',
  'src/lib/client-work-badge-text.mjs',
];
const qualityInputs = ['package.json', 'bun.lock', 'eslint.config.mjs', 'tsconfig.json'];

function coverage(source) {
  const lint = source.split('      - name: Lint modified UI boundaries')[1]?.split(/\r?\n      - name:/)[0];
  assert.ok(lint, 'critical audit must retain its UI lint step');
  assert.match(lint, /node node_modules\/eslint\/bin\/eslint\.js/);
  assert.doesNotMatch(lint, /continue-on-error|--no-error-on-unmatched-pattern|\|\|\s*(?:true|:)/);
  const targets = [...lint.matchAll(/^ {10}(src\/[^\s]+)\s*$/gm)].map(match => match[1]);
  assert.ok(targets.length > 0, 'UI lint targets must be explicit');
  assert.equal(new Set(targets).size, targets.length, 'duplicate UI lint target');
  const pullRequest = source.match(/^  pull_request:\r?\n((?: {4,}[^\r\n]*\r?\n|\r?\n)*)/m)?.[1];
  assert.ok(pullRequest, 'critical audit must retain PR applicability');
  const paths = [...pullRequest.matchAll(/^ {6}- '([^']+)'\s*$/gm)].map(match => match[1]);
  return { targets, paths };
}

function assertApplicable(source) {
  const { targets, paths } = coverage(source);
  for (const file of [...targets, ...qualityInputs]) {
    assert.ok(paths.includes('apps/me2-ui/' + file), 'UI boundary or quality input must trigger critical audit: ' + file);
  }
}

test('critical audit explicit UI lint targets all exist on the current source tree', () => {
  for (const file of coverage(workflow).targets) {
    assert.match(file, /^src\/[A-Za-z0-9_./-]+\.(?:tsx?|mjs)$/);
    assert.ok(!file.split('/').includes('..'), 'lint target must remain inside UI source');
    assert.ok(statSync(new URL(file, uiRoot)).isFile(), 'missing UI lint target: ' + file);
  }
});

test('critical audit lints every current page and shell plus readiness and recovery boundaries', () => {
  const { targets } = coverage(workflow);
  const surfaces = ['src/components/me2/pages/', 'src/components/me2/shell/'].flatMap(directory =>
    readdirSync(new URL(directory, uiRoot)).filter(file => file.endsWith('.tsx')).map(file => directory + file));
  for (const file of [...surfaces, ...readinessBoundaries]) {
    assert.ok(targets.includes(file), 'current UI boundary missing from critical lint: ' + file);
  }
});

test('every critical UI lint target and frozen quality input independently triggers PR qualification', () => {
  assertApplicable(workflow);
  for (const file of ['src/components/me2/pages/code.tsx', 'src/lib/client-runtime-resource.ts', 'bun.lock']) {
    const changed = workflow.replace("      - 'apps/me2-ui/" + file + "'\n", '');
    assert.notEqual(changed, workflow, 'negative fixture must remove an existing applicability entry');
    assert.throws(() => assertApplicable(changed), { code: 'ERR_ASSERTION' });
  }
});

test('focused critical contracts run the UI coverage guard before the complete Browser suite', () => {
  const focused = workflow.split('  focused-critical-contracts:')[1]?.split('\n  full-browser-regression:')[0];
  assert.ok(focused);
  assert.match(focused, /test\/browser-critical-audit-ui-coverage\.test\.mjs/);
});
