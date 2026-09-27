import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ACQUIRE_SCHEMA,
  InstallerProvenanceError,
  PROVENANCE_SCHEMA,
  acquireArtifact,
  resolveProducerArtifact,
  validateProvenance,
  verifyProvenance,
  writeProvenance,
} from '../scripts/installer-provenance.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const REPO = 'PatrickFrome/Compute';
const TOKEN = 'test-token';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-provenance-'));
  const installer = path.join(root, 'METAENGINE-Browser-Test-Setup-0.7.0-dev.1-x64.exe');
  const blockmap = path.join(root, 'METAENGINE-Browser-Test-Setup-0.7.0-dev.1-x64.exe.blockmap');
  const config = path.join(root, 'electron-builder.test.json');
  await Promise.all([
    writeFile(installer, Buffer.from('installer-bytes')),
    writeFile(blockmap, Buffer.from('blockmap-bytes')),
    writeFile(config, Buffer.from('{"config":true}')),
  ]);
  return { root, installer, blockmap, config, provenance: path.join(root, 'installer-provenance.json') };
}

function fakeFetchFactory({ runStatus = 'completed', conclusion = 'success', includeRun = true, includeArtifact = true, zip = 'zip-bytes' } = {}) {
  return async (input) => {
    const url = String(input);
    if (url.includes('/actions/workflows/')) {
      return new Response(JSON.stringify({
        workflow_runs: includeRun ? [{
          id: 42,
          head_sha: HEAD,
          status: runStatus,
          conclusion,
        }] : [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/actions/runs/42/artifacts')) {
      return new Response(JSON.stringify({
        artifacts: includeArtifact ? [{
          id: 99,
          name: `metaengine-browser-windows-candidate-${HEAD}`,
          expired: false,
        }] : [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/actions/artifacts/99/zip')) {
      return new Response(Buffer.from(zip), { status: 200, headers: { 'content-type': 'application/zip' } });
    }
    return new Response('{}', { status: 404 });
  };
}

test('write + verify binds installer, blockmap and config to exact source head', async () => {
  const f = await fixture();
  const row = await writeProvenance({
    output: f.provenance,
    sourceHead: HEAD,
    producerRunId: 42,
    repository: REPO,
    artifactName: `metaengine-browser-windows-candidate-${HEAD}`,
    packageVersion: '0.7.0-dev.1.1',
    installer: f.installer,
    blockmap: f.blockmap,
    config: f.config,
  });
  assert.equal(row.schema, PROVENANCE_SCHEMA);
  assert.equal(row.source_head, HEAD);
  assert.equal(row.files.installer.name, path.basename(f.installer));
  const verified = await verifyProvenance({ provenance: f.provenance, root: f.root, expectedHead: HEAD });
  assert.equal(verified.exact_bytes_verified, true);
  assert.equal(verified.files.installer.sha256, row.files.installer.sha256);
});

test('verify rejects exact-head drift', async () => {
  const f = await fixture();
  await writeProvenance({
    output: f.provenance,
    sourceHead: HEAD,
    producerRunId: 42,
    repository: REPO,
    artifactName: 'a',
    packageVersion: '0.7.0-dev.1.1',
    installer: f.installer,
    blockmap: f.blockmap,
    config: f.config,
  });
  await assert.rejects(
    verifyProvenance({ provenance: f.provenance, root: f.root, expectedHead: '1111111111111111111111111111111111111111' }),
    (error) => error instanceof InstallerProvenanceError && error.code === 'installer_provenance_head_mismatch',
  );
});

test('verify rejects installer digest drift', async () => {
  const f = await fixture();
  await writeProvenance({
    output: f.provenance,
    sourceHead: HEAD,
    producerRunId: 42,
    repository: REPO,
    artifactName: 'a',
    packageVersion: '0.7.0-dev.1.1',
    installer: f.installer,
    blockmap: f.blockmap,
    config: f.config,
  });
  await writeFile(f.installer, Buffer.from('tampered-installer'));
  await assert.rejects(
    verifyProvenance({ provenance: f.provenance, root: f.root, expectedHead: HEAD }),
    (error) => error instanceof InstallerProvenanceError && ['sha_mismatch', 'size_mismatch'].includes(error.code),
  );
});

test('validate rejects authority-bearing provenance', () => {
  assert.throws(
    () => validateProvenance({
      schema: PROVENANCE_SCHEMA,
      source_head: HEAD,
      producer_run_id: 42,
      repository: REPO,
      artifact_name: 'a',
      package_version: '0.7.0-dev.1.1',
      files: {
        installer: { name: 'a.exe', sha256: 'a'.repeat(64), bytes: 1 },
        blockmap: { name: 'a.exe.blockmap', sha256: 'b'.repeat(64), bytes: 1 },
        config: { name: 'electron-builder.test.json', sha256: 'c'.repeat(64), bytes: 1 },
      },
      signed: false,
      published: false,
      promotion_authorized: false,
      authority_effect: true,
    }),
    (error) => error instanceof InstallerProvenanceError && error.code === 'installer_provenance_authority_invalid',
  );
});

test('resolve returns ABSENT when exact-head producer run does not exist', async () => {
  const row = await resolveProducerArtifact({
    repository: REPO,
    sourceHead: HEAD,
    token: TOKEN,
    fetchImpl: fakeFetchFactory({ includeRun: false }),
  });
  assert.equal(row.state, 'ABSENT');
});

test('resolve returns PENDING while producer is running', async () => {
  const row = await resolveProducerArtifact({
    repository: REPO,
    sourceHead: HEAD,
    token: TOKEN,
    fetchImpl: fakeFetchFactory({ runStatus: 'in_progress', conclusion: null }),
  });
  assert.equal(row.state, 'PENDING');
  assert.equal(row.run_id, 42);
});

test('resolve fails closed when exact-head producer failed', async () => {
  await assert.rejects(
    resolveProducerArtifact({
      repository: REPO,
      sourceHead: HEAD,
      token: TOKEN,
      fetchImpl: fakeFetchFactory({ conclusion: 'failure' }),
    }),
    (error) => error instanceof InstallerProvenanceError && error.code === 'installer_provenance_producer_failed',
  );
});

test('resolve waits for exact named artifact after successful run', async () => {
  const row = await resolveProducerArtifact({
    repository: REPO,
    sourceHead: HEAD,
    token: TOKEN,
    fetchImpl: fakeFetchFactory({ includeArtifact: false }),
  });
  assert.equal(row.state, 'ARTIFACT_PENDING');
  assert.equal(row.run_id, 42);
});

test('resolve returns only exact-head exact-name artifact', async () => {
  const row = await resolveProducerArtifact({
    repository: REPO,
    sourceHead: HEAD,
    token: TOKEN,
    fetchImpl: fakeFetchFactory(),
  });
  assert.equal(row.state, 'READY');
  assert.equal(row.run_id, 42);
  assert.equal(row.artifact_id, 99);
  assert.equal(row.artifact_name, `metaengine-browser-windows-candidate-${HEAD}`);
});

test('acquire downloads the resolved artifact without granting authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-acquire-'));
  const output = path.join(root, 'candidate.zip');
  const row = await acquireArtifact({
    repository: REPO,
    sourceHead: HEAD,
    token: TOKEN,
    output,
    timeoutMs: 1000,
    pollMs: 100,
    fetchImpl: fakeFetchFactory({ zip: 'immutable-artifact' }),
    sleepImpl: async () => {},
  });
  assert.equal(row.schema, ACQUIRE_SCHEMA);
  assert.equal(row.exact_head_bound, true);
  assert.equal(row.authority_effect, false);
  assert.equal(await readFile(output, 'utf8'), 'immutable-artifact');
});

test('acquire reports run absence rather than inventing a producer', async () => {
  await assert.rejects(
    acquireArtifact({
      repository: REPO,
      sourceHead: HEAD,
      token: TOKEN,
      output: path.join(os.tmpdir(), 'never.zip'),
      timeoutMs: 1000,
      pollMs: 100,
      fetchImpl: fakeFetchFactory({ includeRun: false }),
      sleepImpl: async () => new Promise((resolve) => setTimeout(resolve, 2)),
    }),
    (error) => error instanceof InstallerProvenanceError
      && ['installer_provenance_producer_run_absent', 'installer_provenance_timeout'].includes(error.code),
  );
});

test('asset names cannot escape extraction root', () => {
  assert.throws(
    () => validateProvenance({
      schema: PROVENANCE_SCHEMA,
      source_head: HEAD,
      producer_run_id: 42,
      repository: REPO,
      artifact_name: 'a',
      package_version: '0.7.0-dev.1.1',
      files: {
        installer: { name: '../a.exe', sha256: 'a'.repeat(64), bytes: 1 },
        blockmap: { name: 'a.blockmap', sha256: 'b'.repeat(64), bytes: 1 },
        config: { name: 'electron-builder.test.json', sha256: 'c'.repeat(64), bytes: 1 },
      },
      signed: false,
      published: false,
      promotion_authorized: false,
      authority_effect: false,
    }),
    (error) => error instanceof InstallerProvenanceError && error.code === 'installer_provenance_asset_name_unsafe',
  );
});
