import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pkg from '../package.json' with { type: 'json' };
import { parseMetaengineDevVersion } from '../src/trusted-dev-release-resolver.mjs';

const candidateDoc = await readFile(new URL('../CONVERGENCE_CANDIDATE.md', import.meta.url), 'utf8');
const reserved = candidateDoc.match(/Reserved package identity is \`([^\`]+)\`\./)?.[1] ?? null;
const priorInstalledVersion = candidateDoc.match(/Previous installed package identity is \`([^\`]+)\`\./)?.[1] ?? null;

test('convergence candidate package identity matches the reserved exact source candidate', () => {
  assert.ok(reserved, 'reserved package identity must be declared in CONVERGENCE_CANDIDATE.md');
  assert.equal(pkg.version, reserved);

  const parsed = parseMetaengineDevVersion(pkg.version);
  assert.ok(parsed, "reserved package identity must be accepted by the trusted updater");
  assert.deepEqual(parsed, {
    version: reserved,
    core: '0.7.0',
    build: parsed.build,
  });
  assert.ok(Number.isSafeInteger(parsed.build));
  const priorInstalled = parseMetaengineDevVersion(priorInstalledVersion);
  assert.ok(priorInstalled, 'the actual installed predecessor must have a trusted package identity');
  assert.ok(parsed.build > priorInstalled.build, 'source-changing convergence candidate must advance above its installed predecessor');
});
