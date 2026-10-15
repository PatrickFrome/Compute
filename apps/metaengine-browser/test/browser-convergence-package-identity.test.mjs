import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pkg from '../package.json' with { type: 'json' };
import { parseMetaengineDevVersion } from '../src/trusted-dev-release-resolver.mjs';
import { inspectUnfrozenPackageIdentityW68, RESERVED_PACKAGE_IDENTITIES_W68 } from '../src/client-package-identity-w68.mjs';

const candidateDoc = await readFile(new URL('../CONVERGENCE_CANDIDATE.md', import.meta.url), 'utf8');
// CONVERGENCE_CANDIDATE.md contains dated *historical* build notes. Its old
// "Candidate package identity" sentence does NOT reserve a fresh physical NSIS
// identity for new source changes. W69 owns the next distinct version freeze.
const historicalCandidate = candidateDoc.match(/^Candidate package identity is \x60([^\x60]+)\x60; the physical build reservation remains pending for this head\./m)?.[1] ?? null;
const priorInstalledVersion = candidateDoc.match(/Previous installed package identity is \x60([^\x60]+)\x60\./)?.[1] ?? null;
const priorQualifiedVersion = candidateDoc.match(/Previous qualified package identity is \x60([^\x60]+)\x60/)?.[1] ?? null;
const priorEphemeralVersions = [...candidateDoc.matchAll(/(?:physically built \(but did not publish\/upload\)|reached physical NSIS build with) \x60([^\x60]+)\x60/g)].map((match) => match[1]);

test('unfrozen source package identity is monotonic but historical document is not a new NSIS reservation', () => {
  assert.ok(historicalCandidate, 'historical candidate identity must remain visible');
  const parsed = parseMetaengineDevVersion(pkg.version);
  const historical = parseMetaengineDevVersion(historicalCandidate);
  assert.ok(parsed && historical, 'current and historical package identities must be parseable');
  assert.ok(Number.isSafeInteger(parsed.build));
  assert.ok(parsed.build > historical.build, 'current source must be newer than historical documentary candidate');
  const installed = parseMetaengineDevVersion(priorInstalledVersion);
  const qualified = parseMetaengineDevVersion(priorQualifiedVersion);
  const prior = priorEphemeralVersions.map(version => parseMetaengineDevVersion(version));
  assert.ok(installed && qualified && prior.length >= 2 && prior.every(Boolean));
  assert.ok(parsed.build > installed.build && parsed.build > qualified.build);
  assert.ok(prior.every(row => parsed.build > row.build));
  // Source checks MUST NOT interpret a previously consumed version as a
  // new package identity, even if all source-only unit tests are green.
  const assessment = inspectUnfrozenPackageIdentityW68({
    version: pkg.version, sourceSha: 'a'.repeat(40),
  });
  assert.equal(assessment.installer_authorized, false);
  assert.equal(assessment.release_authorized, false);
  if (RESERVED_PACKAGE_IDENTITIES_W68.includes(pkg.version)) {
    assert.equal(assessment.disposition, 'BLOCKED_RESERVED_PACKAGE_IDENTITY');
  } else {
    assert.equal(assessment.disposition, 'SOURCE_ONLY_RELEASE_PROOF_REQUIRED');
  }
});

test('reserved identities and source-free input fail closed; no JSON verified flag can authorize a build', () => {
  for (const version of RESERVED_PACKAGE_IDENTITIES_W68) {
    const result = inspectUnfrozenPackageIdentityW68({
      version, sourceSha:'b'.repeat(40), verified:true, installer_authorized:true,
    });
    assert.equal(result.disposition,'BLOCKED_RESERVED_PACKAGE_IDENTITY');
    assert.equal(result.installer_authorized,false);
  }
  assert.equal(inspectUnfrozenPackageIdentityW68({version:'bad'}).disposition,'INVALID_VERSION');
  assert.equal(inspectUnfrozenPackageIdentityW68({version:'0.7.0-dev.999999999999.1'}).disposition,'BLOCKED_UNBOUND_SOURCE');
});
