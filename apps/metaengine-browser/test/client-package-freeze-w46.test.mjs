import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  deriveDistinctCandidatePackageVersion,
  evaluatePackageBuildReservation,
  reservationArtifactName,
  candidateArtifactName,
} from '../scripts/package-build-reservation.mjs';

const require = createRequire(import.meta.url);
const { createPackageLockMaterial } = require('../scripts/package-lock-material.cjs');
const browser = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = dirname(dirname(browser));
const packageJsonPath = join(browser, 'package.json');
const packageLockPath = join(browser, 'package-lock.json');

// Explicit frozen SOURCE planning input, after the W29 merge. This SHA is
// NOT the finished package HEAD, an installer attestation or installed Owner.
const PRE_VERSION_SOURCE_SHA = '3b8d5f69bb51d113bc25174b272e1a7aa8e0bd9a';
const PRIOR_RESERVED_VERSION = '0.7.0-dev.37781000062.1';
const CANDIDATE_VERSION = '0.7.0-dev.842024784850.1';
const SYNTHETIC_HEAD = 'f'.repeat(40);
const fixtureArtifact = (name, head = '46d215039ee2b9725827ff9a98b1843e152812bc') => ({
  id: 11737587692,
  name,
  workflow_run: { id: 38229120450, head_sha: head },
});

function syntheticPreflight(overrides = {}) {
  return {
    repository: 'PatrickFrome/Compute',
    sourceHead: SYNTHETIC_HEAD,
    packageVersion: CANDIDATE_VERSION,
    runId: 38649990000,
    runAttempt: 1,
    versionArtifacts: [],
    sourceArtifacts: [],
    ...overrides,
  };
}

test('W46 committed manifest, root lock and deterministic W13 identity are exact', () => {
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const lock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
  assert.equal(
    deriveDistinctCandidatePackageVersion({
      packageVersion: PRIOR_RESERVED_VERSION, sourceHead: PRE_VERSION_SOURCE_SHA, slot: 0,
    }), CANDIDATE_VERSION,
  );
  assert.equal(manifest.name, '@metaengine/browser-shell');
  assert.equal(manifest.version, CANDIDATE_VERSION);
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, CANDIDATE_VERSION);
  assert.equal(lock.packages[''].name, manifest.name);
  assert.equal(lock.packages[''].version, CANDIDATE_VERSION);
  assert.equal(lock.lockfileVersion, 3);
  assert.notEqual(CANDIDATE_VERSION, PRIOR_RESERVED_VERSION);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
});

test('W46 raw committed lock bytes match existing Build Identity material producer', () => {
  const bytes = readFileSync(packageLockPath);
  const material = createPackageLockMaterial({
    packageJsonPath, packageLockPath, nodeVersion: 'v24.21.0', npmVersion: '11.19.0',
  });
  assert.equal(material.schema, 'metaengine.browser.package-lock-material.v1');
  assert.equal(material.package_version, CANDIDATE_VERSION);
  assert.equal(material.package_lock_sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(material.package_lock_bytes, bytes.length);
  assert.equal(material.node_version, 'v24.21.0');
  assert.equal(material.npm_version, '11.19.0');
  assert.ok(material.package_entry_count > 100);
  assert.equal(material.authority_effect, false);
});

test('W46 immutable reservation rejects historical version even with a new source', () => {
  assert.throws(
    () => evaluatePackageBuildReservation(syntheticPreflight({
      packageVersion: PRIOR_RESERVED_VERSION,
      versionArtifacts: [fixtureArtifact(reservationArtifactName(PRIOR_RESERVED_VERSION))],
    })),
    (error) => error?.code === 'PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED',
  );
});

test('W46 immutable reservation also rejects collision of the distinct version', () => {
  assert.throws(
    () => evaluatePackageBuildReservation(syntheticPreflight({
      versionArtifacts: [fixtureArtifact(reservationArtifactName(CANDIDATE_VERSION))],
    })),
    (error) => error?.code === 'PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED',
  );
});

test('W46 repeat of same source, or ambiguous workflow rerun, is not admission', () => {
  assert.throws(
    () => evaluatePackageBuildReservation(syntheticPreflight({
      sourceArtifacts: [fixtureArtifact(candidateArtifactName(SYNTHETIC_HEAD), SYNTHETIC_HEAD)],
    })),
    (error) => error?.code === 'PACKAGE_IDENTITY_SOURCE_ALREADY_BUILT',
  );
  assert.throws(
    () => evaluatePackageBuildReservation(syntheticPreflight({ runAttempt: 2 })),
    (error) => error?.code === 'PACKAGE_IDENTITY_RERUN_REQUIRES_NEW_SOURCE_AND_VERSION',
  );
});

test('W46 changed planning source cannot silently reuse frozen version', () => {
  assert.notEqual(
    deriveDistinctCandidatePackageVersion({
      packageVersion: PRIOR_RESERVED_VERSION, sourceHead: SYNTHETIC_HEAD, slot: 0,
    }), CANDIDATE_VERSION,
  );
  assert.throws(
    () => deriveDistinctCandidatePackageVersion({
      packageVersion: PRIOR_RESERVED_VERSION, sourceHead: 'UNVERIFIED', slot: 0,
    }), /source_head_invalid/,
  );
});

test('W46 uses ordinary one-EXE Windows gate, frozen toolchain and signed proof boundary', () => {
  const workflow = readFileSync(join(repo, '.github/workflows/browser-windows-package-smoke.yml'), 'utf8');
  assert.match(workflow, /Refuse duplicate source\/version physical build/);
  assert.match(workflow, /Publish immutable package-version reservation/);
  assert.match(workflow, /Seal package-version reservation before physical build/);
  assert.match(workflow, /node-version: '24\.21\.0'/);
  assert.match(workflow, /bun-version: '1\.3\.3'/);
  assert.match(workflow, /npm --version/);
  assert.match(workflow, /Prove frozen package-lock material before dependency install/);
  assert.match(workflow, /sha256/i);
  const source = readFileSync(join(browser, 'scripts/client-windows-source-identity.cjs'), 'utf8');
  assert.match(source, /signed_attestation_verified/);
  assert.match(source, /promotion_authorized/);
});
