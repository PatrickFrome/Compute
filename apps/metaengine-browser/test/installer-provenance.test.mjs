// R86 build-once installer provenance contract tests.
// Hermetic: no GitHub network access - resolve/download/acquire run against a
// local http server that mimics the required REST endpoints.
//
// Environment note: network modes are invoked IN-PROCESS (exported functions).
// spawnSync is used only for non-network CLI plumbing tests, because in some
// hardened sandboxes grandchild processes cannot open loopback sockets; a
// capability probe skips the in-process network tests only if loopback itself
// is unavailable (they always run in CI).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ProvenanceError,
  acquireInstaller,
  downloadArtifact,
  resolveRun,
  waitRun,
  verifyInstaller,
  writeProvenance,
} from '../scripts/installer-provenance.mjs';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'installer-provenance.mjs');
const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const INSTALLER_NAME = 'METAENGINE-Browser-Test-Setup-0.8.3-x64.exe';
const TOKEN = 'local-test-token';

let loopbackCapable = null;
async function loopbackAvailable() {
  if (loopbackCapable !== null) {
    return loopbackCapable;
  }
  const server = createServer((request, response) => {
    response.end('ok');
  });
  try {
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/probe`, { signal: AbortSignal.timeout(2500) });
    await response.text();
    loopbackCapable = response.ok;
  } catch {
    loopbackCapable = false;
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  return loopbackCapable;
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'me2-installer-provenance-'));
}

function makeInstaller(dir, name = INSTALLER_NAME) {
  const filePath = join(dir, name);
  const bytes = randomBytes(4096);
  writeFileSync(filePath, bytes);
  return { filePath, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function runCli(args, { expectCode = 0 } = {}) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ME2_GITHUB_TOKEN: TOKEN },
  });
  assert.notEqual(result.status, null, `cli was killed (hang): ${args.join(' ')}`);
  if (expectCode === 0) {
    assert.equal(result.status, 0, `cli should succeed: ${args.join(' ')}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    return { json: JSON.parse(result.stdout.trim().split('\n').pop()), stdout: result.stdout, stderr: result.stderr };
  }
  assert.notEqual(result.status, 0, `cli should fail: ${args.join(' ')}\nstdout=${result.stdout}`);
  const parsed = JSON.parse(result.stderr.trim().split('\n').pop());
  return { code: parsed.code, stderr: parsed, result };
}

async function withServer(handler, fn) {
  const seen = { authorization: null, paths: [] };
  const server = createServer((request, response) => {
    seen.paths.push(request.url);
    seen.authorization = request.headers.authorization || null;
    handler(request, response);
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    return await fn({ apiBase: `http://127.0.0.1:${server.address().port}`, seen });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function writeRunsResponse(response, runs) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ total_count: runs.length, workflow_runs: runs }));
}

function runShape({ runNumber, headSha = HEAD, status = 'completed', conclusion = 'success', id = 5000 + runNumber }) {
  return { id, run_number: runNumber, head_sha: headSha, status, conclusion, name: 'Browser Windows Package Smoke' };
}

const RESOLVE_BASE = {
  head: HEAD,
  workflow: 'browser-windows-package-smoke.yml',
  repository: 'me2/local',
  token: TOKEN,
  'timeout-min': '1',
  'interval-sec': '0',
};

test('write emits v1 provenance with exact sha256, bytes and defaults', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const outPath = join(dir, 'installer-provenance.json');
    const { json } = runCli([
      'write', '--installer', installer.filePath, '--out', outPath, '--source-head', HEAD,
    ]);
    assert.equal(json.schema, 'metaengine.browser.installer-provenance.v1');
    assert.equal(json.installer_name, INSTALLER_NAME);
    assert.equal(json.installer_sha256, installer.sha256);
    assert.equal(json.installer_bytes, installer.bytes.length);
    assert.equal(json.source_head, HEAD);
    assert.equal(json.signed, false);
    assert.equal(json.promotion_authorized, false);
    assert.ok(json.provenance_id);
    const onDisk = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(onDisk.installer_sha256, installer.sha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('write records config and blockmap digests when provided', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const configPath = join(dir, 'electron-builder.test.json');
    writeFileSync(configPath, '{"appId":"me2.test"}');
    const blockmapPath = join(dir, `${INSTALLER_NAME}.blockmap`);
    writeFileSync(blockmapPath, randomBytes(64));
    const { json } = runCli([
      'write', '--installer', installer.filePath, '--out', join(dir, 'p.json'),
      '--config', configPath, '--blockmap', blockmapPath,
      '--run-id', '424242', '--run-number', '2430', '--run-attempt', '3', '--workflow', 'browser-windows-package-smoke.yml',
    ]);
    assert.equal(json.config_sha256, createHash('sha256').update(readFileSync(configPath)).digest('hex'));
    assert.equal(json.blockmap_name, `${INSTALLER_NAME}.blockmap`);
    assert.equal(json.blockmap_sha256, createHash('sha256').update(readFileSync(blockmapPath)).digest('hex'));
    assert.equal(json.run_id, '424242');
    assert.equal(json.run_number, 2430);
    assert.equal(json.run_attempt, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify roundtrip via explicit paths emits acquired contract', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const provenancePath = join(dir, 'installer-provenance.json');
    runCli(['write', '--installer', installer.filePath, '--out', provenancePath, '--source-head', HEAD]);
    const statePath = join(dir, 'acquired.json');
    const { json } = runCli([
      'verify', '--installer', installer.filePath, '--provenance', provenancePath,
      '--expect-head', HEAD, '--state', statePath,
    ]);
    assert.equal(json.schema, 'metaengine.browser.installer-provenance-acquired.v1');
    assert.equal(json.installer_sha256, installer.sha256);
    assert.equal(json.installer_name, INSTALLER_NAME);
    assert.equal(json.source_head, HEAD);
    const onDisk = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(onDisk.installer_sha256, installer.sha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify discovers payload dir contents by provenance name', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const payload = join(dir, 'payload');
    mkdirSync(payload, { recursive: true });
    writeFileSync(join(payload, INSTALLER_NAME), readFileSync(installer.filePath));
    writeFileSync(join(payload, 'installer-provenance.json'), JSON.stringify({
      schema: 'metaengine.browser.installer-provenance.v1',
      installer_name: INSTALLER_NAME,
      installer_sha256: installer.sha256,
      installer_bytes: installer.bytes.length,
      source_head: HEAD,
      run_id: '4242',
    }));
    const { json } = runCli(['verify', '--dir', payload, '--expect-head', HEAD]);
    assert.equal(json.schema, 'metaengine.browser.installer-provenance-acquired.v1');
    assert.ok(readdirSync(payload).includes('acquired.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify rejects same-size byte tamper with sha_mismatch', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const provenancePath = join(dir, 'installer-provenance.json');
    runCli(['write', '--installer', installer.filePath, '--out', provenancePath, '--source-head', HEAD]);
    const bytes = readFileSync(installer.filePath);
    bytes[0] = bytes[0] ^ 0xff;
    writeFileSync(installer.filePath, bytes);
    const { code } = runCli(['verify', '--installer', installer.filePath, '--provenance', provenancePath, '--expect-head', HEAD], { expectCode: 1 });
    assert.equal(code, 'sha_mismatch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify rejects resized installer with size_mismatch', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const provenancePath = join(dir, 'installer-provenance.json');
    runCli(['write', '--installer', installer.filePath, '--out', provenancePath, '--source-head', HEAD]);
    writeFileSync(installer.filePath, Buffer.concat([readFileSync(installer.filePath), Buffer.from([1])]));
    const { code } = runCli(['verify', '--installer', installer.filePath, '--provenance', provenancePath, '--expect-head', HEAD], { expectCode: 1 });
    assert.equal(code, 'size_mismatch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify rejects wrong expected head with head_mismatch', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const provenancePath = join(dir, 'installer-provenance.json');
    runCli(['write', '--installer', installer.filePath, '--out', provenancePath, '--source-head', HEAD]);
    const { code } = runCli(['verify', '--installer', installer.filePath, '--provenance', provenancePath, '--expect-head', HEAD2], { expectCode: 1 });
    assert.equal(code, 'head_mismatch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify fails with installer_missing when payload renamed', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const provenancePath = join(dir, 'installer-provenance.json');
    runCli(['write', '--installer', installer.filePath, '--out', provenancePath, '--source-head', HEAD]);
    const payload = join(dir, 'payload');
    mkdirSync(payload, { recursive: true });
    writeFileSync(join(payload, 'renamed.exe'), readFileSync(installer.filePath));
    writeFileSync(join(payload, 'installer-provenance.json'), JSON.stringify({
      schema: 'metaengine.browser.installer-provenance.v1',
      installer_name: INSTALLER_NAME,
      installer_sha256: installer.sha256,
      installer_bytes: installer.bytes.length,
      source_head: HEAD,
    }));
    const { code } = runCli(['verify', '--dir', payload, '--expect-head', HEAD], { expectCode: 1 });
    assert.equal(code, 'installer_missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify rejects malformed provenance with provenance_schema_invalid', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const provenancePath = join(dir, 'installer-provenance.json');
    writeFileSync(provenancePath, '{not-json');
    const { code } = runCli(['verify', '--installer', installer.filePath, '--provenance', provenancePath, '--expect-head', HEAD], { expectCode: 1 });
    assert.equal(code, 'provenance_schema_invalid');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify rejects provenance with missing digest field', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const provenancePath = join(dir, 'installer-provenance.json');
    writeFileSync(provenancePath, JSON.stringify({
      schema: 'metaengine.browser.installer-provenance.v1',
      installer_name: INSTALLER_NAME,
      installer_bytes: installer.bytes.length,
    }));
    const { code } = runCli(['verify', '--installer', installer.filePath, '--provenance', provenancePath, '--expect-head', HEAD], { expectCode: 1 });
    assert.equal(code, 'provenance_field_invalid');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed head shape is rejected before any network call', async () => {
  await assert.rejects(
    () => resolveRun({ ...RESOLVE_BASE, head: 'not-a-sha' }),
    (error) => error instanceof ProvenanceError && error.code === 'head_shape_invalid',
  );
});

test('resolve picks newest successful Package Smoke run for exact head', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  const dir = makeWorkspace();
  await withServer((request, response) => {
    if (request.url.startsWith('/repos/me2/local/actions/workflows/browser-windows-package-smoke.yml/runs')) {
      writeRunsResponse(response, [runShape({ runNumber: 5 }), runShape({ runNumber: 7 }), runShape({ runNumber: 6, conclusion: 'failure' })]);
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase, seen }) => {
    const resolved = await resolveRun({ ...RESOLVE_BASE, 'api-base': apiBase });
    assert.equal(resolved.run_number, 7);
    assert.equal(resolved.run_id, '5007');
    assert.equal(resolved.schema, 'metaengine.browser.installer-run-resolved.v1');
    assert.equal(seen.authorization, `Bearer ${TOKEN}`);
    assert.ok(seen.paths[0].includes(`head_sha=${HEAD}`));
  });
  rmSync(dir, { recursive: true, force: true });
});

test('resolve fails fast when newest run for head failed', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  await withServer((request, response) => {
    if (request.url.includes('/actions/workflows/browser-windows-package-smoke.yml/runs')) {
      writeRunsResponse(response, [runShape({ runNumber: 9, conclusion: 'failure' })]);
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase }) => {
    await assert.rejects(
      () => resolveRun({ ...RESOLVE_BASE, 'api-base': apiBase, 'timeout-min': '5' }),
      (error) => error instanceof ProvenanceError && error.code === 'installer_provenance_producer_failed',
    );
  });
});

test('resolve times out while newest run stays in progress', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  await withServer((request, response) => {
    if (request.url.includes('/actions/workflows/browser-windows-package-smoke.yml/runs')) {
      writeRunsResponse(response, [runShape({ runNumber: 11, status: 'in_progress', conclusion: null })]);
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase }) => {
    await assert.rejects(
      () => resolveRun({ ...RESOLVE_BASE, 'api-base': apiBase, 'timeout-min': '0' }),
      (error) => error instanceof ProvenanceError && error.code === 'installer_provenance_timeout',
    );
  });
});

test('resolve reports absent run after grace window', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  await withServer((request, response) => {
    if (request.url.includes('/actions/workflows/browser-windows-package-smoke.yml/runs')) {
      writeRunsResponse(response, []);
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase }) => {
    await assert.rejects(
      () => resolveRun({ ...RESOLVE_BASE, 'api-base': apiBase, 'timeout-min': '5', 'absent-grace-min': '0' }),
      (error) => error instanceof ProvenanceError && error.code === 'installer_provenance_run_absent',
    );
  });
});

test('download stores artifact zip bytes and validates size', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  const dir = makeWorkspace();
  const zipBytes = randomBytes(512);
  await withServer((request, response) => {
    if (request.url.startsWith('/repos/me2/local/actions/runs/5007/artifacts')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        total_count: 1,
        artifacts: [{ id: 9001, name: `metaengine-browser-windows-candidate-${HEAD}`, size_in_bytes: zipBytes.length, expired: false }],
      }));
      return;
    }
    if (request.url.startsWith('/repos/me2/local/actions/artifacts/9001/zip')) {
      response.writeHead(200, { 'content-type': 'application/zip' });
      response.end(zipBytes);
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase }) => {
    try {
      const outDir = join(dir, 'out');
      const downloaded = await downloadArtifact({
        repository: 'me2/local', token: TOKEN, 'api-base': apiBase,
        'run-id': '5007', artifact: `metaengine-browser-windows-candidate-${HEAD}`, out: outDir,
      });
      assert.equal(downloaded.artifact_id, '9001');
      assert.equal(downloaded.zip_bytes, zipBytes.length);
      assert.deepEqual(readFileSync(downloaded.zip_path), zipBytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('download fails with artifact_not_found for foreign artifact name', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  await withServer((request, response) => {
    if (request.url.includes('/artifacts?')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ total_count: 0, artifacts: [] }));
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase }) => {
    await assert.rejects(
      () => downloadArtifact({
        repository: 'me2/local', token: TOKEN, 'api-base': apiBase,
        'run-id': '5007', artifact: `metaengine-browser-windows-candidate-${randomUUID()}`,
        out: join(tmpdir(), 'me2-prov-unused'),
      }),
      (error) => error instanceof ProvenanceError && error.code === 'artifact_not_found',
    );
  });
});

test('acquire resolves and downloads in one step', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  const dir = makeWorkspace();
  const zipBytes = randomBytes(256);
  await withServer((request, response) => {
    if (request.url.includes('/actions/workflows/browser-windows-package-smoke.yml/runs')) {
      writeRunsResponse(response, [runShape({ runNumber: 13 })]);
      return;
    }
    if (request.url.includes('/actions/runs/5013/artifacts')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        total_count: 1,
        artifacts: [{ id: 9013, name: `metaengine-browser-windows-candidate-${HEAD}`, size_in_bytes: zipBytes.length, expired: false }],
      }));
      return;
    }
    if (request.url.includes('/actions/artifacts/9013/zip')) {
      response.writeHead(200, { 'content-type': 'application/zip' });
      response.end(zipBytes);
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase }) => {
    try {
      const outDir = join(dir, 'acquire');
      const acquired = await acquireInstaller({
        ...RESOLVE_BASE, 'api-base': apiBase,
        artifact: `metaengine-browser-windows-candidate-${HEAD}`, out: outDir,
      });
      assert.equal(acquired.run_id, '5013');
      assert.deepEqual(readFileSync(acquired.zip_path), zipBytes);
      const resolved = JSON.parse(readFileSync(acquired.resolved_path, 'utf8'));
      assert.equal(resolved.run_number, 13);
      assert.equal(resolved.schema, 'metaengine.browser.installer-run-resolved.v1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('missing token fails with token_missing', async () => {
  const previous = { me2: process.env.ME2_GITHUB_TOKEN, gh: process.env.GITHUB_TOKEN, ghToken: process.env.GH_TOKEN };
  delete process.env.ME2_GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  try {
    await assert.rejects(
      () => resolveRun({ ...RESOLVE_BASE, token: undefined }),
      (error) => error instanceof ProvenanceError && error.code === 'token_missing',
    );
  } finally {
    if (previous.me2 !== undefined) process.env.ME2_GITHUB_TOKEN = previous.me2;
    if (previous.gh !== undefined) process.env['GITHUB_TOKEN'] = previous.gh;
    if (previous.ghToken !== undefined) process.env['GH_TOKEN'] = previous.ghToken;
  }
});

test('verify binds installer, blockmap, config and exact producer generation', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const configPath = join(dir, 'electron-builder.test.json');
    const blockmapPath = join(dir, `${INSTALLER_NAME}.blockmap`);
    const provenancePath = join(dir, 'installer-provenance.json');
    writeFileSync(configPath, '{"appId":"me2.test","r90":true}');
    writeFileSync(blockmapPath, randomBytes(128));
    runCli([
      'write', '--installer', installer.filePath, '--out', provenancePath,
      '--source-head', HEAD,
      '--config', configPath,
      '--blockmap', blockmapPath,
      '--run-id', '424242',
      '--run-number', '2465',
      '--run-attempt', '2',
      '--workflow', 'browser-windows-package-smoke.yml',
    ]);
    const { json } = runCli([
      'verify',
      '--installer', installer.filePath,
      '--provenance', provenancePath,
      '--expect-head', HEAD,
      '--expect-run-id', '424242',
      '--expect-run-number', '2465',
      '--expect-run-attempt', '2',
      '--expect-workflow', 'browser-windows-package-smoke.yml',
      '--blockmap', blockmapPath,
      '--config', configPath,
    ]);
    assert.equal(json.provenance_run_id, '424242');
    assert.equal(json.provenance_run_number, 2465);
    assert.equal(json.provenance_run_attempt, 2);
    assert.equal(json.provenance_workflow, 'browser-windows-package-smoke.yml');
    assert.equal(json.blockmap_verified, true);
    assert.equal(json.config_verified, true);

    const wrong = runCli([
      'verify',
      '--installer', installer.filePath,
      '--provenance', provenancePath,
      '--expect-head', HEAD,
      '--expect-run-id', '424243',
      '--blockmap', blockmapPath,
      '--config', configPath,
    ], { expectCode: 1 });
    assert.equal(wrong.code, 'producer_run_mismatch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify fails closed on blockmap and builder-config drift', () => {
  const dir = makeWorkspace();
  try {
    const installer = makeInstaller(dir);
    const configPath = join(dir, 'electron-builder.test.json');
    const blockmapPath = join(dir, `${INSTALLER_NAME}.blockmap`);
    const provenancePath = join(dir, 'installer-provenance.json');
    writeFileSync(configPath, '{"config":true}');
    writeFileSync(blockmapPath, randomBytes(128));
    runCli([
      'write', '--installer', installer.filePath, '--out', provenancePath,
      '--source-head', HEAD, '--config', configPath, '--blockmap', blockmapPath,
    ]);

    writeFileSync(blockmapPath, randomBytes(128));
    const badBlockmap = runCli([
      'verify', '--installer', installer.filePath, '--provenance', provenancePath,
      '--expect-head', HEAD, '--blockmap', blockmapPath, '--config', configPath,
    ], { expectCode: 1 });
    assert.equal(badBlockmap.code, 'blockmap_sha_mismatch');

    writeFileSync(blockmapPath, Buffer.from(readFileSync(blockmapPath)));
    // Restore the exact blockmap by regenerating provenance, then tamper config only.
    runCli([
      'write', '--installer', installer.filePath, '--out', provenancePath,
      '--source-head', HEAD, '--config', configPath, '--blockmap', blockmapPath,
    ]);
    writeFileSync(configPath, '{"config":false}');
    const badConfig = runCli([
      'verify', '--installer', installer.filePath, '--provenance', provenancePath,
      '--expect-head', HEAD, '--blockmap', blockmapPath, '--config', configPath,
    ], { expectCode: 1 });
    assert.equal(badConfig.code, 'config_sha_mismatch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolve may expose exact immutable artifact while producer is still in progress', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  const artifactName = `metaengine-browser-windows-candidate-${HEAD}`;
  await withServer((request, response) => {
    if (request.url.includes('/actions/workflows/browser-windows-package-smoke.yml/runs')) {
      writeRunsResponse(response, [{
        ...runShape({ runNumber: 31, status: 'in_progress', conclusion: null, id: 5031 }),
        run_attempt: 4,
      }]);
      return;
    }
    if (request.url.includes('/actions/runs/5031/artifacts')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        total_count: 1,
        artifacts: [{ id: 9031, name: artifactName, size_in_bytes: 123, expired: false }],
      }));
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase }) => {
    const resolved = await resolveRun({
      ...RESOLVE_BASE,
      'api-base': apiBase,
      artifact: artifactName,
      'allow-in-progress': 'true',
    });
    assert.equal(resolved.run_id, '5031');
    assert.equal(resolved.run_number, 31);
    assert.equal(resolved.run_attempt, 4);
    assert.equal(resolved.producer_completed, false);
    assert.equal(resolved.producer_conclusion, null);
    assert.equal(resolved.artifact_id, '9031');
  });
});

test('wait requires the exact bound producer run to finish success', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  let reads = 0;
  await withServer((request, response) => {
    if (request.url === '/repos/me2/local/actions/runs/5031') {
      reads += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 5031,
        run_number: 31,
        run_attempt: 4,
        head_sha: HEAD,
        path: '.github/workflows/browser-windows-package-smoke.yml',
        name: 'Browser Windows Package Smoke',
        status: reads < 2 ? 'in_progress' : 'completed',
        conclusion: reads < 2 ? null : 'success',
      }));
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase }) => {
    const qualified = await waitRun({
      ...RESOLVE_BASE,
      'api-base': apiBase,
      'run-id': '5031',
      'run-number': '31',
      'run-attempt': '4',
    });
    assert.equal(qualified.schema, 'metaengine.browser.installer-producer-qualified.v1');
    assert.equal(qualified.run_id, '5031');
    assert.equal(qualified.run_number, 31);
    assert.equal(qualified.run_attempt, 4);
    assert.equal(qualified.conclusion, 'success');
  });
  assert.equal(reads, 2);
});

test('wait fails closed when exact producer finishes red or identity drifts', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  await withServer((request, response) => {
    if (request.url === '/repos/me2/local/actions/runs/5032') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 5032,
        run_number: 32,
        run_attempt: 1,
        head_sha: HEAD,
        path: '.github/workflows/browser-windows-package-smoke.yml',
        name: 'Browser Windows Package Smoke',
        status: 'completed',
        conclusion: 'failure',
      }));
      return;
    }
    if (request.url === '/repos/me2/local/actions/runs/5033') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 5033,
        run_number: 33,
        run_attempt: 1,
        head_sha: HEAD2,
        path: '.github/workflows/browser-windows-package-smoke.yml',
        name: 'Browser Windows Package Smoke',
        status: 'completed',
        conclusion: 'success',
      }));
      return;
    }
    response.writeHead(404).end();
  }, async ({ apiBase }) => {
    await assert.rejects(
      () => waitRun({
        ...RESOLVE_BASE, 'api-base': apiBase,
        'run-id': '5032', 'run-number': '32', 'run-attempt': '1',
      }),
      (error) => error instanceof ProvenanceError && error.code === 'installer_provenance_producer_failed',
    );
    await assert.rejects(
      () => waitRun({
        ...RESOLVE_BASE, 'api-base': apiBase,
        'run-id': '5033', 'run-number': '33', 'run-attempt': '1',
      }),
      (error) => error instanceof ProvenanceError && error.code === 'producer_head_mismatch',
    );
  });
});

test('artifact redirect never forwards GitHub bearer token to the redirected origin', async (t) => {
  if (!(await loopbackAvailable())) {
    t.skip('loopback fetch unavailable in this environment');
    return;
  }
  const dir = makeWorkspace();
  const zipBytes = randomBytes(512);
  let redirectedAuthorization = 'not-observed';
  const target = createServer((request, response) => {
    redirectedAuthorization = request.headers.authorization || null;
    response.writeHead(200, { 'content-type': 'application/zip' });
    response.end(zipBytes);
  });
  await new Promise((resolveListen) => target.listen(0, '127.0.0.1', resolveListen));
  try {
    const targetUrl = `http://127.0.0.1:${target.address().port}/signed-artifact`;
    await withServer((request, response) => {
      if (request.url.includes('/actions/runs/5007/artifacts')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          total_count: 1,
          artifacts: [{
            id: 9001,
            name: `metaengine-browser-windows-candidate-${HEAD}`,
            size_in_bytes: zipBytes.length,
            expired: false,
          }],
        }));
        return;
      }
      if (request.url.includes('/actions/artifacts/9001/zip')) {
        response.writeHead(302, { location: targetUrl });
        response.end();
        return;
      }
      response.writeHead(404).end();
    }, async ({ apiBase }) => {
      const downloaded = await downloadArtifact({
        repository: 'me2/local',
        token: TOKEN,
        'api-base': apiBase,
        'run-id': '5007',
        artifact: `metaengine-browser-windows-candidate-${HEAD}`,
        out: join(dir, 'redirected'),
      });
      assert.equal(downloaded.zip_bytes, zipBytes.length);
    });
  } finally {
    target.closeAllConnections?.();
    await new Promise((resolveClose) => target.close(resolveClose));
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(redirectedAuthorization, null);
});

test('R90/R91 workflow topology builds NSIS once, overlaps physical consumers, then gates on producer success', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const workflowRoot = join(testDir, '..', '..', '..', '.github', 'workflows');
  const packageSmoke = readFileSync(join(workflowRoot, 'browser-windows-package-smoke.yml'), 'utf8');
  const installedChat = readFileSync(join(workflowRoot, 'browser-windows-installed-chat-qualification.yml'), 'utf8');
  const finalRuntime = readFileSync(join(workflowRoot, 'browser-final-runtime-activation-v1.yml'), 'utf8');
  const soak = readFileSync(join(workflowRoot, 'browser-windows-autonomous-soak-v1.yml'), 'utf8');

  const early = packageSmoke.indexOf('name: Publish immutable candidate for parallel downstream qualification');
  const packageProof = packageSmoke.indexOf('name: Install exact-head package and prove Browser plus inert Guardian payload');
  assert.ok(early >= 0 && packageProof > early);
  assert.equal((packageSmoke.match(/electron-builder@26\.15\.7 --win nsis/g) || []).length, 1);
  assert.equal((packageSmoke.match(/name: metaengine-browser-windows-candidate-/g) || []).length, 1);
  assert.equal((packageSmoke.match(/name: metaengine-browser-windows-package-evidence-/g) || []).length, 1);
  assert.match(packageSmoke.slice(early, packageProof), /METAENGINE-Browser-Test-Setup-\*-x64\.exe\.blockmap/);
  assert.match(packageSmoke.slice(early, packageProof), /installer-provenance\.json/);
  assert.match(packageSmoke, /remote_browser_transport_blocked -ne \$true/);

  for (const [name, source, physicalMarker] of [
    ['installed-chat', installedChat, 'Install exact installer and prove clean-genesis persistent ChatGPT preconnect'],
    ['final-runtime', finalRuntime, 'Install and prove all Final runtime modules READY'],
    ['soak', soak, 'Open normal UI and prove 64 sequential plus 8 concurrent exact activations'],
  ]) {
    assert.doesNotMatch(source, /electron-builder@26\.15\.7 --win nsis/);
    assert.doesNotMatch(source, /Build and stage exact-head ME2 UI|Build and pack ME2 UI|bun run build/);
    assert.match(source, /qualified-installer-consumer\.ps1 -Mode Acquire/);
    assert.match(source, /ME2_INSTALLER_BINDING_PATH/);
    assert.match(source, /producer_run_id=\[int64\]\$binding\.producer_run_id/);
    assert.match(source, /producer_run_number=\[int64\]\$binding\.producer_run_number/);
    assert.match(source, /producer_run_attempt=\[int64\]\$binding\.producer_run_attempt/);
    assert.match(source, /producer_completed_at_acquire/);
    const physical = source.indexOf(physicalMarker);
    const terminal = source.indexOf('name: Require bound Package Smoke producer terminal success');
    assert.ok(physical >= 0 && terminal > physical, `${name}: producer terminal fence must follow physical proof`);
    assert.match(source.slice(terminal), /qualified-installer-consumer\.ps1 -Mode Wait/);
    assert.doesNotMatch(source, /installer-provenance\.mjs acquire|installer-provenance\.mjs verify|installer-provenance\.mjs wait/);
  }
});
