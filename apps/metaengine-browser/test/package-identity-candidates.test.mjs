import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  MAX_PACKAGE_IDENTITY_CANDIDATES,
  deriveDistinctCandidatePackageVersion,
  evaluatePackageBuildReservation,
  planDistinctPackageBuildIdentity,
  reservationArtifactName,
  candidateArtifactName,
} from '../scripts/package-build-reservation.mjs';

const VERSION = '0.7.0-dev.37781000062.1';
const PRIOR_HEAD = '46d215039ee2b9725827ff9a98b1843e152812bc';
const HEADS = [
  '85a11b2aa8777f5981a6cd5c4ed30de877417875', // #1221
  '5c4e5dc951266c5995f4c90c2db97e482c4cffba', // #1224
  '3035e0fb246b9081b3010894d83eb470d95fd472', // #1225
];
const opts = {
  repository: 'PatrickFrome/Compute',
  sourceHead: HEADS[0],
  packageVersion: VERSION,
  runId: 38454761383,
  runAttempt: 1,
  token: 'test-only-token',
  apiBase: 'https://api.github.test',
};

function prior(name, head = PRIOR_HEAD, id = 11737587692) {
  return { id, name, expired: false, workflow_run: { id: 38229120450, head_sha: head } };
}
function fakeArtifactApi(resolver) {
  const original = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const name = parsed.searchParams.get('name');
    queries.push(name);
    const result = resolver(name, queries.length);
    if (result?.status) return { ok: false, status: result.status };
    const artifacts = result?.artifacts ?? result ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ total_count: result?.total_count ?? artifacts.length, artifacts }),
    };
  };
  return { queries, restore() { globalThis.fetch = original; } };
}
function withMock(resolver, fn) {
  const mock = fakeArtifactApi(resolver);
  return Promise.resolve().then(() => fn(mock)).finally(() => mock.restore());
}

test('three exact failed PR source heads receive reproducible distinct candidate identities', () => {
  const candidates = HEADS.map((sourceHead) => deriveDistinctCandidatePackageVersion({
    packageVersion: VERSION, sourceHead,
  }));
  assert.equal(new Set(candidates).size, HEADS.length);
  for (let i = 0; i < HEADS.length; i += 1) {
    assert.match(candidates[i], /^0\.7\.0-dev\.8[0-9]{11}\.1$/);
    assert.notEqual(candidates[i], VERSION);
    assert.equal(candidates[i], deriveDistinctCandidatePackageVersion({
      packageVersion: VERSION, sourceHead: HEADS[i].toUpperCase(),
    }));
  }
});

test('candidate derivation rejects malformed source, package and unbounded slot', () => {
  assert.throws(() => deriveDistinctCandidatePackageVersion({ packageVersion: VERSION, sourceHead: 'bad' }), /source_head_invalid/);
  assert.throws(() => deriveDistinctCandidatePackageVersion({ packageVersion: '0.7.0', sourceHead: HEADS[0] }), /version_invalid/);
  for (const slot of [-1, 1.1, Infinity, MAX_PACKAGE_IDENTITY_CANDIDATES]) {
    assert.throws(() => deriveDistinctCandidatePackageVersion({ packageVersion: VERSION, sourceHead: HEADS[0], slot }), /candidate_slot_invalid/);
  }
});

test('distinct proposals advance beyond the manifest serial across namespace and safe-integer boundaries', () => {
  const serialOf = version => BigInt(version.match(/^0\.7\.0-dev\.([0-9]+)\.1$/)[1]);
  for (const serial of [799999999999n, 800000000000n, 899999999999n,
    999999999999n, 1107139874591n, 9007199254740993n]) {
    for (let slot = 0; slot < MAX_PACKAGE_IDENTITY_CANDIDATES; slot++) {
      const options = { packageVersion: `0.7.0-dev.${serial}.1`, sourceHead: HEADS[0], slot };
      const candidate = deriveDistinctCandidatePackageVersion(options);
      assert.ok(serialOf(candidate) > serial, `${candidate} must advance beyond ${options.packageVersion}`);
      assert.equal(candidate, deriveDistinctCandidatePackageVersion(options));
    }
  }
});

test('a consumed modern manifest yields a strictly newer proposal, not build authority', async () => {
  const packageVersion = '0.7.0-dev.1107139874591.1';
  await withMock(name => name === reservationArtifactName(packageVersion) ? [prior(name)] : [], async () => {
    const plan = await planDistinctPackageBuildIdentity({ ...opts, packageVersion });
    assert.ok(BigInt(plan.candidate_package_version.split('-dev.')[1].split('.')[0]) > 1107139874591n);
    assert.equal(plan.manifest_update_required, true);
    assert.equal(plan.physical_package_build_allowed, false);
    assert.equal(plan.promotion_authorized, false);
    assert.equal(plan.authority_effect, false);
  });
});

test('original duplicate version never becomes build-authorized merely by candidate derivation', () => {
  assert.throws(
    () => evaluatePackageBuildReservation({
      ...opts, versionArtifacts: [prior(reservationArtifactName(VERSION))],
    }),
    (error) => error?.code === 'PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED',
  );
});

test('planner retains clean manifest version but cannot authorize physical build', async () => {
  await withMock(() => [], async ({ queries }) => {
    const plan = await planDistinctPackageBuildIdentity(opts);
    assert.equal(plan.candidate_package_version, VERSION);
    assert.equal(plan.manifest_update_required, false);
    assert.equal(plan.physical_package_build_allowed, false);
    assert.equal(plan.authority_effect, false);
    assert.deepEqual(queries, [candidateArtifactName(HEADS[0]), reservationArtifactName(VERSION)]);
  });
});

test('reserved physical package identity yields bounded distinct proposal requiring a new source commit', async () => {
  await withMock((name) => name === reservationArtifactName(VERSION) ? [prior(name)] : [], async ({ queries }) => {
    const plan = await planDistinctPackageBuildIdentity(opts);
    assert.equal(plan.candidate_package_version, deriveDistinctCandidatePackageVersion({
      packageVersion: VERSION, sourceHead: opts.sourceHead,
    }));
    assert.equal(plan.manifest_update_required, true);
    assert.equal(plan.physical_package_build_allowed, false);
    assert.equal(plan.promotion_authorized, false);
    assert.equal(plan.authority_effect, false);
    assert.equal(queries.length, 3);
  });
});

test('actual candidate-version collision probes next deterministic slot, not same identity', async () => {
  const first = deriveDistinctCandidatePackageVersion({ packageVersion: VERSION, sourceHead: opts.sourceHead, slot: 0 });
  const next = deriveDistinctCandidatePackageVersion({ packageVersion: VERSION, sourceHead: opts.sourceHead, slot: 1 });
  await withMock((name) => [reservationArtifactName(VERSION), reservationArtifactName(first)].includes(name) ? [prior(name)] : [], async () => {
    const plan = await planDistinctPackageBuildIdentity(opts);
    assert.equal(plan.candidate_package_version, next);
    assert.equal(plan.candidate_slot, 1);
    assert.deepEqual(plan.rejected_reserved_candidate_versions, [first]);
  });
});

test('all four occupied candidate identities fail closed; no fifth or random retry', async () => {
  const names = new Set([VERSION, ...Array.from({ length: MAX_PACKAGE_IDENTITY_CANDIDATES }, (_, slot) =>
    deriveDistinctCandidatePackageVersion({ packageVersion: VERSION, sourceHead: opts.sourceHead, slot }),
  )].map(reservationArtifactName));
  await withMock((name) => names.has(name) ? [prior(name)] : [], async ({ queries }) => {
    await assert.rejects(() => planDistinctPackageBuildIdentity(opts),
      (error) => error?.code === 'PACKAGE_IDENTITY_CANDIDATES_EXHAUSTED');
    assert.equal(queries.length, 2 + MAX_PACKAGE_IDENTITY_CANDIDATES);
  });
});

test('previous package for same source blocks candidate-version reuse', async () => {
  await withMock((name) => {
    if (name === candidateArtifactName(HEADS[0])) return [prior(name, HEADS[0])];
    if (name === reservationArtifactName(VERSION)) return [prior(name)];
    return [];
  }, async () => {
    await assert.rejects(() => planDistinctPackageBuildIdentity(opts),
      (error) => error?.code === 'PACKAGE_IDENTITY_SOURCE_ALREADY_BUILT');
  });
});

test('rerun and invalid source fail BEFORE making any API request', async () => {
  await withMock(() => [], async ({ queries }) => {
    await assert.rejects(() => planDistinctPackageBuildIdentity({ ...opts, runAttempt: 2 }),
      (error) => error?.code === 'PACKAGE_IDENTITY_RERUN_REQUIRES_NEW_SOURCE_AND_VERSION');
    await assert.rejects(() => planDistinctPackageBuildIdentity({ ...opts, sourceHead: 'bad' }), /source_head_invalid/);
    assert.equal(queries.length, 0);
  });
});

test('GitHub API 503 and truncated first-page result both fail closed', async () => {
  await withMock(() => ({ status: 503 }), async () => {
    await assert.rejects(() => planDistinctPackageBuildIdentity(opts),
      (error) => error?.code === 'PACKAGE_BUILD_RESERVATION_API_UNAVAILABLE');
  });
  await withMock(() => ({ total_count: 101, artifacts: [] }), async () => {
    await assert.rejects(() => planDistinctPackageBuildIdentity(opts),
      (error) => error?.code === 'PACKAGE_BUILD_RESERVATION_API_SHAPE_INVALID');
  });
});

test('source artifact metadata from current run cannot be reinterpreted as another source', () => {
  const plan = evaluatePackageBuildReservation({
    ...opts,
    versionArtifacts: [{ id: 7, name: reservationArtifactName(VERSION),
      workflow_run: { id: opts.runId, head_sha: opts.sourceHead } }],
  });
  assert.equal(plan.physical_package_build_allowed, true);
});

test('explicit exclusive floor advances every bounded candidate beyond manifest and consumed sibling', () => {
  const serialOf = version => BigInt(version.split('.')[3]);
  for (const [packageVersion, minimumPackageVersion] of [
    ['0.7.0-dev.1107139874594.1', '0.7.0-dev.1269944506140.1'],
    [VERSION, VERSION],
    [VERSION, '0.7.0-dev.9007199254740993.1'],
  ]) {
    for (let slot = 0; slot < MAX_PACKAGE_IDENTITY_CANDIDATES; slot++) {
      const input = { packageVersion, sourceHead: HEADS[0], minimumPackageVersion, slot };
      const candidate = deriveDistinctCandidatePackageVersion(input);
      assert.ok(serialOf(candidate) > serialOf(packageVersion));
      assert.ok(serialOf(candidate) > serialOf(minimumPackageVersion));
      assert.equal(candidate, deriveDistinctCandidatePackageVersion(input));
    }
  }
  assert.equal(deriveDistinctCandidatePackageVersion({ ...opts, minimumPackageVersion: '0.7.0-dev.1.1' }),
    deriveDistinctCandidatePackageVersion(opts), 'lower floor must not alter default derivation');
});

test('invalid explicit floors fail before artifact observation and cannot be silently omitted', async () => {
  await withMock(() => [], async ({ queries }) => {
    for (const minimumPackageVersion of [null, '', ' ', true, 1, '0.7.0', '0.8.0-dev.123.1',
      '0.7.0-dev.-1.1', '0.7.0-dev.1e12.1', '0.7.0-dev.123.2']) {
      assert.throws(() => deriveDistinctCandidatePackageVersion({ ...opts, minimumPackageVersion }),
        /minimum_package_version_invalid/);
      await assert.rejects(() => planDistinctPackageBuildIdentity({ ...opts, minimumPackageVersion }),
        /minimum_package_version_invalid/);
    }
    assert.equal(queries.length, 0);
  });
});

test('clean but equal or older manifest must advance beyond explicit consumed floor', async () => {
  for (const minimumPackageVersion of [VERSION, '0.7.0-dev.1269944506140.1']) {
    await withMock(() => [], async ({ queries }) => {
      const plan = await planDistinctPackageBuildIdentity({ ...opts, minimumPackageVersion });
      assert.equal(plan.manifest_update_required, true);
      assert.equal(plan.candidate_slot, 0);
      assert.equal(plan.minimum_package_version, minimumPackageVersion);
      assert.equal(plan.minimum_package_version_exclusive, true);
      assert.ok(BigInt(plan.candidate_package_version.split('.')[3]) > BigInt(minimumPackageVersion.split('.')[3]));
      for (const key of ['physical_package_build_allowed', 'promotion_authorized', 'authority_effect']) {
        assert.equal(plan[key], false);
      }
      assert.equal(queries.length, 3);
    });
  }
});

test('clean manifest newer than explicit floor is retained without claiming build authority', async () => {
  await withMock(() => [], async ({ queries }) => {
    const plan = await planDistinctPackageBuildIdentity({ ...opts, minimumPackageVersion: '0.7.0-dev.1.1' });
    assert.equal(plan.candidate_package_version, VERSION);
    assert.equal(plan.candidate_slot, null);
    assert.equal(plan.manifest_update_required, false);
    assert.equal(plan.minimum_package_version, '0.7.0-dev.1.1');
    assert.equal(plan.minimum_package_version_exclusive, true);
    for (const key of ['physical_package_build_allowed', 'promotion_authorized', 'authority_effect']) {
      assert.equal(plan[key], false);
    }
    assert.equal(queries.length, 2);
  });
});

test('occupied first proposal cannot select a lower-than-sibling fallback with explicit floor', async () => {
  // Historical source is a deterministic fixture only, not a selected version.
  const input = { ...opts, packageVersion: '0.7.0-dev.1107139874594.1',
    sourceHead: '643c8c8b4306ffa4b708591b83c0992591e928b7' };
  const minimumPackageVersion = '0.7.0-dev.1269944506140.1';
  assert.ok(BigInt(deriveDistinctCandidatePackageVersion({ ...input, slot: 1 }).split('.')[3])
    < BigInt(minimumPackageVersion.split('.')[3]), 'generic planner has no sibling high-water mark');
  const first = deriveDistinctCandidatePackageVersion({ ...input, minimumPackageVersion, slot: 0 });
  await withMock(name => [reservationArtifactName(input.packageVersion), reservationArtifactName(first)].includes(name)
    ? [prior(name)] : [], async () => {
    const plan = await planDistinctPackageBuildIdentity({ ...input, minimumPackageVersion });
    assert.equal(plan.candidate_slot, 1);
    assert.equal(plan.candidate_package_version,
      deriveDistinctCandidatePackageVersion({ ...input, minimumPackageVersion, slot: 1 }));
    assert.ok(BigInt(plan.candidate_package_version.split('.')[3]) > BigInt(minimumPackageVersion.split('.')[3]));
    assert.deepEqual(plan.rejected_reserved_candidate_versions, [first]);
    for (const key of ['physical_package_build_allowed', 'promotion_authorized', 'authority_effect']) {
      assert.equal(plan[key], false);
    }
  });
});

test('explicit floor preserves four-candidate bound, source refusal, rerun and unavailable API fences', async () => {
  const input = { ...opts, minimumPackageVersion: '0.7.0-dev.1269944506140.1' };
  await withMock(name => [prior(name)], async ({ queries }) => {
    await assert.rejects(() => planDistinctPackageBuildIdentity(input),
      error => error?.code === 'PACKAGE_IDENTITY_CANDIDATES_EXHAUSTED');
    assert.equal(queries.length, 2 + MAX_PACKAGE_IDENTITY_CANDIDATES);
  });
  await withMock(name => name === candidateArtifactName(input.sourceHead) ? [prior(name)] : [], async () => {
    await assert.rejects(() => planDistinctPackageBuildIdentity(input),
      error => error?.code === 'PACKAGE_IDENTITY_SOURCE_ALREADY_BUILT');
  });
  await withMock(() => [], async ({ queries }) => {
    await assert.rejects(() => planDistinctPackageBuildIdentity({ ...input, runAttempt: 2 }),
      error => error?.code === 'PACKAGE_IDENTITY_RERUN_REQUIRES_NEW_SOURCE_AND_VERSION');
    assert.equal(queries.length, 0);
  });
  for (const response of [{ status: 503 }, { total_count: 101, artifacts: [] }]) {
    await withMock(() => response, async () => {
      await assert.rejects(() => planDistinctPackageBuildIdentity(input),
        error => ['PACKAGE_BUILD_RESERVATION_API_UNAVAILABLE', 'PACKAGE_BUILD_RESERVATION_API_SHAPE_INVALID'].includes(error?.code));
    });
  }
});

test('CLI rejects planner-only floor on ordinary preflight and rejects missing floor value before network', () => {
  const script = fileURLToPath(new URL('../scripts/package-build-reservation.mjs', import.meta.url));
  const ordinary = spawnSync(process.execPath, [script, '--minimum-package-version', VERSION], { encoding: 'utf8' });
  assert.equal(ordinary.status, 1);
  assert.match(ordinary.stderr, /package_identity_minimum_version_requires_planner/);
  const missing = spawnSync(process.execPath, [script, '--plan-distinct', '--repository', opts.repository,
    '--source-head', opts.sourceHead, '--package-version', opts.packageVersion,
    '--run-id', String(opts.runId), '--run-attempt', '1', '--minimum-package-version'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /minimum_package_version_invalid/);
});
