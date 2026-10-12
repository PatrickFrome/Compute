import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pkg from '../package.json' with { type: 'json' };
import { parseMetaengineDevVersion } from '../src/trusted-dev-release-resolver.mjs';

const candidateDoc = await readFile(new URL('../CONVERGENCE_CANDIDATE.md', import.meta.url), 'utf8');
const candidate = candidateDoc.match(/^Candidate package identity is \`([^\`]+)\`; the physical build reservation remains pending for this head\./m)?.[1] ?? null;
const priorInstalledVersion = candidateDoc.match(/Previous installed package identity is \`([^\`]+)\`\./)?.[1] ?? null;
const priorQualifiedVersion = candidateDoc.match(/Previous qualified package identity is \`([^\`]+)\`/)?.[1] ?? null;
const priorEphemeralVersions = [...candidateDoc.matchAll(/(?:physically built \(but did not publish\/upload\)|reached physical NSIS build with) \`([^\`]+)\`/g)].map((match) => match[1]);

test('convergence candidate package identity matches the current source candidate', () => {
  assert.ok(candidate, 'current package identity must be declared in CONVERGENCE_CANDIDATE.md');
  assert.equal(pkg.version, candidate);

  const parsed = parseMetaengineDevVersion(pkg.version);
  assert.ok(parsed, "candidate package identity must be accepted by the trusted updater");
  assert.deepEqual(parsed, {
    version: candidate,
    core: '0.7.0',
    build: parsed.build,
  });
  assert.ok(Number.isSafeInteger(parsed.build));
  const priorInstalled = parseMetaengineDevVersion(priorInstalledVersion);
  const priorQualified = parseMetaengineDevVersion(priorQualifiedVersion);
  const priorEphemeral = priorEphemeralVersions.map((version) => parseMetaengineDevVersion(version));
  assert.ok(priorInstalled, 'the actual installed predecessor must have a trusted package identity');
  assert.ok(priorQualified, 'the last materialized qualified package must have a trusted package identity');
  assert.ok(priorEphemeral.length >= 2 && priorEphemeral.every(Boolean), 'every intermediate physically built package identity must be treated as consumed');
  assert.ok(parsed.build > priorInstalled.build, 'source-changing convergence candidate must advance above its installed predecessor');
  assert.ok(parsed.build > priorQualified.build, 'source-changing convergence candidate must advance above the last materialized package bytes');
  assert.ok(priorEphemeral.every((row) => parsed.build > row.build), 'final candidate must advance above every intermediate physically built package identity');
});
