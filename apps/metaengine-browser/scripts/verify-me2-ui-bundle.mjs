import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

// Verify the installed copy, not merely a source manifest or extraResources entry.
// electron-builder 26 excludes node_modules at the root of each FileSet.
export function verifyMe2UiBundle(directory, expectedSha) {
  assert.match(expectedSha || '', /^[0-9a-f]{40}$/, 'me2_ui_expected_sha_invalid');
  const root = realpathSync(directory);
  for (const rel of ['server.js', 'package.json', '.next/BUILD_ID', 'me2-ui-manifest.json']) {
    assert.ok(statSync(path.join(root, rel)).isFile(), `me2_ui_file_missing:${rel}`);
  }
  assert.ok(statSync(path.join(root, '.next/static')).isDirectory(), 'me2_ui_static_missing');
  const manifestBytes = readFileSync(path.join(root, 'me2-ui-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schema, 'me2.ui-bundle-manifest.v1', 'me2_ui_schema_mismatch');
  assert.equal(manifest.git_sha, expectedSha, 'me2_ui_source_sha_mismatch');
  assert.equal(manifest.build_id, readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim(), 'me2_ui_build_id_mismatch');
  assert.ok(Number.isSafeInteger(manifest.size_bytes) && manifest.size_bytes > 0, 'me2_ui_manifest_size_invalid');

  // pack-me2-ui computes size_bytes before writing me2-ui-manifest.json, so the
  // installed tree excluding that manifest must retain exactly the same total bytes.
  let installedSizeBytes = 0;
  const stack = [root];
  const manifestPath = path.join(root, 'me2-ui-manifest.json');
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      const absolute = path.join(current, name);
      if (absolute === manifestPath) continue;
      const stat = statSync(absolute);
      if (stat.isDirectory()) stack.push(absolute);
      else installedSizeBytes += stat.size;
    }
  }
  assert.equal(installedSizeBytes, manifest.size_bytes, `me2_ui_installed_size_mismatch:${installedSizeBytes}:${manifest.size_bytes}`);

  const require = createRequire(path.join(root, 'server.js'));
  const dependencies = {};
  for (const request of ['next/package.json', 'next/dist/server/lib/start-server', 'react/package.json', 'react-dom/package.json']) {
    const resolved = realpathSync(require.resolve(request));
    const relative = path.relative(root, resolved);
    assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), `me2_ui_dependency_outside_bundle:${request}`);
    dependencies[request] = relative.split(path.sep).join('/');
  }
  return {
    schema: 'metaengine.browser.me2.installed-ui-proof.v1',
    git_sha: expectedSha,
    build_id: manifest.build_id,
    manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex'),
    manifest_size_bytes: manifest.size_bytes,
    installed_size_bytes: installedSizeBytes,
    dependencies,
    runtime_smoke: 'NOT_RUN',
  };
}

export async function smokeMe2UiBundle(directory, runtime = process.execPath, timeoutMs = 30000) {
  const root = realpathSync(directory);
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const child = spawn(runtime, ['server.js'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '1', HOSTNAME: '127.0.0.1', PORT: String(port), NODE_PATH: '', NODE_OPTIONS: '' },
  });
  let output = '';
  let spawnError;
  child.on('error', error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-4000); });
  const exited = new Promise(resolve => child.once('close', resolve));
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`me2_ui_server_exited:${child.exitCode}:${output}`);
      let response;
      try { response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }); } catch { await delay(100); continue; }
      if (!response.ok) { await response.body?.cancel(); await delay(100); continue; }
      assert.match(response.headers.get('content-type') || '', /text\/html/i, 'me2_ui_not_html');
      const html = await response.text();
      assert.match(html, /<html/i, 'me2_ui_html_missing');
      const staticPath = html.match(/(?:src|href)="(\/_next\/static\/[^"?]+\.js)(?:\?[^" ]*)?"/)?.[1];
      assert.ok(staticPath, 'me2_ui_static_script_missing');
      const asset = await fetch(`http://127.0.0.1:${port}${staticPath}`, { signal: AbortSignal.timeout(5000) });
      assert.ok(asset.ok, `me2_ui_static_http_${asset.status}`);
      const assetBytes = Buffer.from(await asset.arrayBuffer());
      assert.ok(assetBytes.length, 'me2_ui_static_empty');
      assert.ok(child.exitCode === null && child.signalCode === null, 'me2_ui_server_died_during_probe');
      return { runtime_smoke: 'PASS', html_sha256: createHash('sha256').update(html).digest('hex'), static_path: staticPath, static_sha256: createHash('sha256').update(assetBytes).digest('hex') };
    }
    throw new Error(`me2_ui_smoke_timeout:${output}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { root: { type: 'string' }, 'expected-sha': { type: 'string' }, runtime: { type: 'string' }, evidence: { type: 'string' }, smoke: { type: 'boolean' } } });
    const proof = verifyMe2UiBundle(values.root, values['expected-sha']);
    if (values.smoke) Object.assign(proof, await smokeMe2UiBundle(values.root, values.runtime));
    const json = JSON.stringify(proof, null, 2) + '\n';
    if (values.evidence) writeFileSync(values.evidence, json);
    process.stdout.write(json);
  } catch (error) {
    console.error(`ME2_UI_BUNDLE_VERIFICATION_FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
