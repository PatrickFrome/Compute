import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const RELEASE_BRANCH = 'release/self-update-ambiguity-live-v2';

const REQUIRED_GATE_WORKFLOWS = [
  'metaengine-browser-bootstrap-autostart-e2e.yml',
  'metaengine-browser-self-update-fast-e2e.yml',
  'metaengine-browser-self-update-e2e.yml',
  'browser-critical-audit-v1.yml',
  'metaengine-browser-analysis-stack-v1.yml',
  'browser-developer-emergency-update-v1.yml',
  'browser-parent-progress-durability-gate.yml',
  'browser-self-update-durability-gate.yml',
  'browser-windows-package-smoke.yml',
  'browser-windows-autonomous-soak-v1.yml',
  'browser-final-runtime-activation-v1.yml',
  'browser-windows-installed-chat-qualification.yml',
];

const CENTRAL_GATE = 'metaengine-browser-release-evidence-gate.yml';
const PUBLISHER = 'metaengine-browser-fast-autorelease.yml';

function workflowUrl(name) {
  return new URL(`../../../.github/workflows/${name}`, import.meta.url);
}

async function workflowSource(name) {
  return readFile(workflowUrl(name), 'utf8');
}

function eventBlock(source, eventName) {
  const lines = source.split(/\r?\n/);
  const onIndex = lines.findIndex((line) => line === 'on:');
  assert.notEqual(onIndex, -1, 'workflow must contain a top-level on: block');
  const onEnd = lines.findIndex((line, index) => index > onIndex && /^[A-Za-z_][A-Za-z0-9_-]*:/.test(line));
  const end = onEnd === -1 ? lines.length : onEnd;
  const onLines = lines.slice(onIndex + 1, end);
  const eventIndex = onLines.findIndex((line) => line === `  ${eventName}:`);
  assert.notEqual(eventIndex, -1, `workflow must contain on.${eventName}`);
  let eventEnd = onLines.length;
  for (let index = eventIndex + 1; index < onLines.length; index += 1) {
    if (/^  [A-Za-z_][A-Za-z0-9_-]*:/.test(onLines[index])) { eventEnd = index; break; }
  }
  return onLines.slice(eventIndex, eventEnd).join('\n');
}

function branchEntries(pushBlock) {
  const lines = pushBlock.split(/\r?\n/);
  const branchesIndex = lines.findIndex((line) => line.trim() === 'branches:');
  assert.notEqual(branchesIndex, -1, 'push event must declare branches');
  const branches = [];
  for (let index = branchesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^    [A-Za-z_][A-Za-z0-9_-]*:/.test(line)) break;
    const match = line.match(/^      - ['"]?([^'"]+)['"]?$/);
    if (match) branches.push(match[1]);
  }
  return branches;
}

function assertUnconditionalReleasePush(source, workflowName) {
  const push = eventBlock(source, 'push');
  const branches = branchEntries(push);
  assert.ok(branches.includes(RELEASE_BRANCH), `${workflowName} must run on every release-branch push`);
  assert.doesNotMatch(push, /^    paths(?:-ignore)?:/m, `${workflowName} release push must not be path-filtered`);
}

test('every independent release evidence workflow runs unconditionally for every release SHA', async () => {
  for (const workflowName of [...REQUIRED_GATE_WORKFLOWS, CENTRAL_GATE]) {
    const source = await workflowSource(workflowName);
    assertUnconditionalReleasePush(source, workflowName);
  }
});

test('central release evidence gate requires the complete independent exact-SHA workflow set', async () => {
  const source = await workflowSource(CENTRAL_GATE);
  for (const workflowName of REQUIRED_GATE_WORKFLOWS) {
    assert.match(source, new RegExp(workflowName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `central gate must require ${workflowName}`);
  }
  assert.match(source, /local_analysis_stack/, 'central release evidence must require local analysis stack');
  assert.match(source, /required_gate_count['"]?:\s*len\(required\)/, 'central evidence must record the required gate count');
});

test('publisher is release-only, unconditional, and waits for central exact-SHA evidence', async () => {
  const source = await workflowSource(PUBLISHER);
  const push = eventBlock(source, 'push');
  const branches = branchEntries(push);
  assert.deepEqual(branches, [RELEASE_BRANCH], 'publisher must be restricted to the release branch');
  assert.doesNotMatch(push, /^    paths(?:-ignore)?:/m, 'publisher must run for every release SHA');
  assert.match(source, /metaengine-browser-release-evidence-gate\.yml/, 'publisher must wait for central evidence gate');
  assert.match(source, /head_sha=\"\$EXPECTED_SHA\"/, 'publisher must query evidence by exact SHA');
});

test('bootstrap/autostart release proof cannot disable Sentinel through test environment', async () => {
  const source = await workflowSource('metaengine-browser-bootstrap-autostart-e2e.yml');
  assert.doesNotMatch(source, /METAENGINE_DISABLE_CRASH_SENTINEL\s*:/, 'bootstrap/autostart must exercise Sentinel-enabled runtime');
});
