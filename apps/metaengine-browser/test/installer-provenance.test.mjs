import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ACQUIRE_SCHEMA,
  DOWNLOAD_SCHEMA,
  PROVENANCE_SCHEMA,
  PRODUCER_WORKFLOW,
  RESOLUTION_SCHEMA,
  VERIFY_SCHEMA,
  acquireArtifact,
  downloadArtifact,
  fileEvidence,
  resolveProducerRun,
  verifyProvenance,
  writeProvenance,
} from '../scripts/installer-provenance.mjs';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const scriptPath = fileURLToPath(new URL('../scripts/installer-provenance.mjs', import.meta.url));

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'installer-provenance-'));
  const payload = path.join(root, 'payload');
  await mkdir(payload, { recursive: true });
  const installer = path.join(payload, 'METAENGINE-Browser-Test-Setup-1.0.0-dev.1.1-x64.exe');
  const blockmap = `${installer}.blockmap`;
  const config = path.join(payload, 'electron-builder.test.json');
  const provenance = path.join(payload, 'installer-provenance.json');
  await writeFile(installer, Buffer.from('installer-bytes-v1'));
  await writeFile(blockmap, Buffer.from('blockmap-bytes-v1'));
  await writeFile(config, Buffer.from('{"config":true}\n'));
  return { root, payload, installer, blockmap, config, provenance };
}

async function writtenFixture() {
  const f = await fixture();
  await writeProvenance({
    sourceHead: HEAD,
    runId: 101,
    runAttempt: 2,
    artifactName: `metaengine-browser-windows-candidate-${HEAD}`,
    installerPath: f.installer,
    blockmapPath: f.blockmap,
    configPath: f.config,
    outputPath: f.provenance,
  });
  return f;
}

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

test('fileEvidence returns stable sha256 and size', async () => {
  const f = await fixture();
  const evidence = await fileEvidence(f.installer);
  assert.equal(evidence.name, path.basename(f.installer));
  assert.equal(evidence.size_bytes, Buffer.byteLength('installer-bytes-v1'));
  assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
});

test('writeProvenance binds exact head, producer run and three immutable inputs', async () => {
  const f = await writtenFixture();
  const row = JSON.parse(await readFile(f.provenance, 'utf8'));
  assert.equal(row.schema, PROVENANCE_SCHEMA);
  assert.equal(row.source_head, HEAD);
  assert.equal(row.producer.workflow, PRODUCER_WORKFLOW);
  assert.equal(row.producer.run_id, 101);
  assert.equal(row.producer.run_attempt, 2);
  assert.match(row.assets.installer.sha256, /^[a-f0-9]{64}$/);
  assert.match(row.assets.blockmap.sha256, /^[a-f0-9]{64}$/);
  assert.match(row.assets.builder_config.sha256, /^[a-f0-9]{64}$/);
  assert.equal(row.authority_effect, false);
});

test('writeProvenance rejects malformed source head', async () => {
  const f = await fixture();
  await assert.rejects(
    writeProvenance({
      sourceHead: 'not-a-sha',
      runId: 1,
      artifactName: 'a',
      installerPath: f.installer,
      blockmapPath: f.blockmap,
      configPath: f.config,
      outputPath: f.provenance,
    }),
    (error) => error?.code === 'head_invalid',
  );
});

test('writeProvenance rejects non-positive producer run id', async () => {
  const f = await fixture();
  await assert.rejects(
    writeProvenance({
      sourceHead: HEAD,
      runId: 0,
      artifactName: 'a',
      installerPath: f.installer,
      blockmapPath: f.blockmap,
      configPath: f.config,
      outputPath: f.provenance,
    }),
    (error) => error?.code === 'run_id_invalid',
  );
});

test('verifyProvenance accepts exact immutable bytes', async () => {
  const f = await writtenFixture();
  const result = await verifyProvenance({
    provenancePath: f.provenance,
    expectedHead: HEAD,
    installerPath: f.installer,
    blockmapPath: f.blockmap,
    configPath: f.config,
  });
  assert.equal(result.schema, VERIFY_SCHEMA);
  assert.equal(result.source_head, HEAD);
  assert.equal(result.producer_run_id, 101);
  assert.equal(result.verified, true);
});

test('verifyProvenance fails closed on source-head drift', async () => {
  const f = await writtenFixture();
  await assert.rejects(
    verifyProvenance({
      provenancePath: f.provenance,
      expectedHead: OTHER_HEAD,
      installerPath: f.installer,
      blockmapPath: f.blockmap,
      configPath: f.config,
    }),
    (error) => error?.code === 'head_mismatch',
  );
});

test('verifyProvenance fails closed on installer sha drift', async () => {
  const f = await writtenFixture();
  await writeFile(f.installer, Buffer.from('tampered-installer'));
  await assert.rejects(
    verifyProvenance({
      provenancePath: f.provenance,
      expectedHead: HEAD,
      installerPath: f.installer,
      blockmapPath: f.blockmap,
      configPath: f.config,
    }),
    (error) => error?.code === 'sha_mismatch' || error?.code === 'size_mismatch',
  );
});

test('verifyProvenance fails closed on blockmap drift', async () => {
  const f = await writtenFixture();
  await writeFile(f.blockmap, Buffer.from('tampered-blockmap'));
  await assert.rejects(
    verifyProvenance({
      provenancePath: f.provenance,
      expectedHead: HEAD,
      installerPath: f.installer,
      blockmapPath: f.blockmap,
      configPath: f.config,
    }),
    (error) => error?.code === 'sha_mismatch' || error?.code === 'size_mismatch',
  );
});

test('verifyProvenance fails closed on builder-config drift', async () => {
  const f = await writtenFixture();
  await writeFile(f.config, Buffer.from('{"config":false}\n'));
  await assert.rejects(
    verifyProvenance({
      provenancePath: f.provenance,
      expectedHead: HEAD,
      installerPath: f.installer,
      blockmapPath: f.blockmap,
      configPath: f.config,
    }),
    (error) => error?.code === 'sha_mismatch' || error?.code === 'size_mismatch',
  );
});

test('verifyProvenance rejects malformed provenance JSON', async () => {
  const f = await fixture();
  await writeFile(f.provenance, '{broken');
  await assert.rejects(
    verifyProvenance({
      provenancePath: f.provenance,
      expectedHead: HEAD,
      installerPath: f.installer,
      blockmapPath: f.blockmap,
      configPath: f.config,
    }),
    (error) => error?.code === 'provenance_invalid_json',
  );
});

test('resolveProducerRun returns exact successful package-smoke artifact', async () => {
  await withServer((req, res) => {
    if (req.url.startsWith('/repos/o/r/actions/runs?')) {
      return json(res, 200, { workflow_runs: [{
        id: 77,
        run_attempt: 3,
        name: PRODUCER_WORKFLOW,
        head_sha: HEAD,
        status: 'completed',
        conclusion: 'success',
      }] });
    }
    if (req.url.startsWith('/repos/o/r/actions/runs/77/artifacts?')) {
      return json(res, 200, { artifacts: [{
        id: 88,
        name: `metaengine-browser-windows-candidate-${HEAD}`,
        expired: false,
        archive_download_url: 'http://127.0.0.1/unused',
      }] });
    }
    res.writeHead(404); res.end();
  }, async (base) => {
    const result = await resolveProducerRun({
      repo: 'o/r',
      head: HEAD,
      artifactName: `metaengine-browser-windows-candidate-${HEAD}`,
      apiBase: base,
      timeoutMs: 100,
      pollMs: 10,
    });
    assert.equal(result.schema, RESOLUTION_SCHEMA);
    assert.equal(result.producer_run_id, 77);
    assert.equal(result.producer_run_attempt, 3);
    assert.equal(result.artifact_id, 88);
  });
});

test('resolveProducerRun fails closed when producer completed non-success', async () => {
  await withServer((req, res) => {
    if (req.url.startsWith('/repos/o/r/actions/runs?')) {
      return json(res, 200, { workflow_runs: [{
        id: 77,
        name: PRODUCER_WORKFLOW,
        head_sha: HEAD,
        status: 'completed',
        conclusion: 'failure',
      }] });
    }
    res.writeHead(404); res.end();
  }, async (base) => {
    await assert.rejects(
      resolveProducerRun({
        repo: 'o/r',
        head: HEAD,
        artifactName: 'artifact',
        apiBase: base,
        timeoutMs: 100,
        pollMs: 10,
      }),
      (error) => error?.code === 'installer_provenance_producer_failed',
    );
  });
});

test('resolveProducerRun reports exact-head producer absence after bounded wait', async () => {
  await withServer((req, res) => {
    if (req.url.startsWith('/repos/o/r/actions/runs?')) return json(res, 200, { workflow_runs: [] });
    res.writeHead(404); res.end();
  }, async (base) => {
    await assert.rejects(
      resolveProducerRun({
        repo: 'o/r',
        head: HEAD,
        artifactName: 'artifact',
        apiBase: base,
        timeoutMs: 45,
        pollMs: 10,
      }),
      (error) => error?.code === 'installer_provenance_producer_run_absent',
    );
  });
});

test('resolveProducerRun reports bounded timeout for in-progress producer', async () => {
  await withServer((req, res) => {
    if (req.url.startsWith('/repos/o/r/actions/runs?')) {
      return json(res, 200, { workflow_runs: [{
        id: 77,
        name: PRODUCER_WORKFLOW,
        head_sha: HEAD,
        status: 'in_progress',
        conclusion: null,
      }] });
    }
    res.writeHead(404); res.end();
  }, async (base) => {
    await assert.rejects(
      resolveProducerRun({
        repo: 'o/r',
        head: HEAD,
        artifactName: 'artifact',
        apiBase: base,
        timeoutMs: 45,
        pollMs: 10,
      }),
      (error) => error?.code === 'installer_provenance_producer_timeout',
    );
  });
});

test('resolveProducerRun rejects success without exact artifact', async () => {
  await withServer((req, res) => {
    if (req.url.startsWith('/repos/o/r/actions/runs?')) {
      return json(res, 200, { workflow_runs: [{
        id: 77,
        name: PRODUCER_WORKFLOW,
        head_sha: HEAD,
        status: 'completed',
        conclusion: 'success',
      }] });
    }
    if (req.url.startsWith('/repos/o/r/actions/runs/77/artifacts?')) {
      return json(res, 200, { artifacts: [{ id: 1, name: 'other', expired: false }] });
    }
    res.writeHead(404); res.end();
  }, async (base) => {
    await assert.rejects(
      resolveProducerRun({
        repo: 'o/r',
        head: HEAD,
        artifactName: 'wanted',
        apiBase: base,
        timeoutMs: 100,
        pollMs: 10,
      }),
      (error) => error?.code === 'installer_provenance_artifact_absent',
    );
  });
});

test('downloadArtifact writes exact bytes and digest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'installer-download-'));
  const output = path.join(root, 'artifact.zip');
  await withServer((_req, res) => {
    const body = Buffer.from('zip-bytes');
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
    res.end(body);
  }, async (base) => {
    const result = await downloadArtifact({ url: `${base}/archive`, outputPath: output });
    assert.equal(result.schema, DOWNLOAD_SCHEMA);
    assert.equal(await readFile(output, 'utf8'), 'zip-bytes');
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
  });
});

test('downloadArtifact rejects empty archive', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'installer-download-'));
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-length': '0' });
    res.end();
  }, async (base) => {
    await assert.rejects(
      downloadArtifact({ url: `${base}/archive`, outputPath: path.join(root, 'artifact.zip') }),
      (error) => error?.code === 'artifact_download_empty',
    );
  });
});

test('acquireArtifact resolves producer and downloads same artifact archive', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'installer-acquire-'));
  const output = path.join(root, 'artifact.zip');
  await withServer((req, res) => {
    const port = req.socket.localPort;
    if (req.url.startsWith('/repos/o/r/actions/runs?')) {
      return json(res, 200, { workflow_runs: [{
        id: 77,
        run_attempt: 1,
        name: PRODUCER_WORKFLOW,
        head_sha: HEAD,
        status: 'completed',
        conclusion: 'success',
      }] });
    }
    if (req.url.startsWith('/repos/o/r/actions/runs/77/artifacts?')) {
      return json(res, 200, { artifacts: [{
        id: 88,
        name: `metaengine-browser-windows-candidate-${HEAD}`,
        expired: false,
        archive_download_url: `http://127.0.0.1:${port}/archive`,
      }] });
    }
    if (req.url === '/archive') {
      const body = Buffer.from('same-bytes');
      res.writeHead(200, { 'content-length': body.length });
      return res.end(body);
    }
    res.writeHead(404); res.end();
  }, async (base) => {
    const result = await acquireArtifact({
      repo: 'o/r',
      head: HEAD,
      artifactName: `metaengine-browser-windows-candidate-${HEAD}`,
      apiBase: base,
      timeoutMs: 100,
      pollMs: 10,
      outputPath: output,
    });
    assert.equal(result.schema, ACQUIRE_SCHEMA);
    assert.equal(result.producer_run_id, 77);
    assert.equal(result.artifact_id, 88);
    assert.equal(await readFile(output, 'utf8'), 'same-bytes');
  });
});

test('CLI write emits machine-readable provenance without secrets', async () => {
  const f = await fixture();
  const result = spawnSync(process.execPath, [
    scriptPath, 'write',
    '--source-head', HEAD,
    '--run-id', '101',
    '--run-attempt', '1',
    '--artifact-name', 'artifact',
    '--installer', f.installer,
    '--blockmap', f.blockmap,
    '--config', f.config,
    '--output', f.provenance,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const row = JSON.parse(result.stdout.trim());
  assert.equal(row.schema, PROVENANCE_SCHEMA);
  assert.equal(row.source_head, HEAD);
  assert.doesNotMatch(result.stdout + result.stderr, /authorization|bearer/i);
});

test('CLI verify returns nonzero on tampered installer', async () => {
  const f = await writtenFixture();
  await writeFile(f.installer, Buffer.from('tampered'));
  const result = spawnSync(process.execPath, [
    scriptPath, 'verify',
    '--provenance', f.provenance,
    '--expected-head', HEAD,
    '--installer', f.installer,
    '--blockmap', f.blockmap,
    '--config', f.config,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const row = JSON.parse(result.stderr.trim());
  assert.equal(row.ok, false);
  assert.ok(row.code === 'sha_mismatch' || row.code === 'size_mismatch');
  assert.equal(row.authority_effect, false);
});
