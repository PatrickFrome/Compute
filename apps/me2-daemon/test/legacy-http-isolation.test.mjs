import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const bun = process.env.METAENGINE_TEST_BUN;
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}

test('real Bun daemon keeps GET eval observational and rejects private loopback calls without bearer', { skip: !bun || !existsSync(bun), timeout: 30000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'metaengine-legacy-http-test-'));
  const paths = Object.fromEntries(['data', 'contour', 'profile', 'temp'].map((name) => [name, join(root, name)]));
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true });
  mkdirSync(join(paths.contour, 'my-project'), { recursive: true });
  const ports = new Set(); while (ports.size < 3) ports.add(await freePort());
  const [rest, ws, mirror] = [...ports];
  const token = randomUUID();
  const child = spawn(bun, ['index.ts'], {
    cwd: daemonRoot, windowsHide: true,
    env: {
      PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', WINDIR: process.env.WINDIR ?? '',
      HOME: paths.profile, USERPROFILE: paths.profile, APPDATA: paths.profile, LOCALAPPDATA: paths.profile,
      TEMP: paths.temp, TMP: paths.temp, TMPDIR: paths.temp,
      ME2_BOOT_MODE: 'probe', ME2_API_TOKEN: token, ME2_DATA_DIR: paths.data,
      ME2_CONTOUR_HOME: paths.contour, ME2_REPO_ROOT: join(paths.contour, 'my-project'),
      ME2_LOCK_FILE: join(root, 'daemon.lock'), ME2_REST_PORT: String(rest), ME2_WS_PORT: String(ws), ME2_LEGACY_MIRROR_PORT: String(mirror),
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-8000); }); child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
  const closed = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await closed;
    // Test roots are retained for failure diagnosis; no operator path is cleaned.
  });
  const base = `http://127.0.0.1:${rest}`;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    assert.equal(child.exitCode, null, `isolated daemon exited: ${output}`);
    try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(300) })).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `isolated daemon not ready: ${output}`);
  const db = new DatabaseSync(join(paths.data, 'me2.db'), { readOnly: true });
  t.after(() => db.close());
  const state = () => Object.fromEntries(['eval_runs', 'commands', 'events', 'tasks', 'tokens'].map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  const before = state();
  assert.equal(before.tokens, 0, 'imports must not bootstrap vault credentials');
  assert.equal((await fetch(base + '/state', { signal: AbortSignal.timeout(3000) })).status, 401);
  const headers = { Authorization: `Bearer ${token}` };
  const observation = await fetch(base + '/eval?run=1', { headers, signal: AbortSignal.timeout(3000) });
  assert.equal(observation.status, 200);
  assert.equal((await observation.json()).runs_total, 0);
  const denied = await fetch(base + '/eval/run', { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(3000) });
  assert.equal(denied.status, 403);
  assert.deepEqual(state(), before, 'GET query and rejected POST must not mutate durable work/eval/vault state');
  assert.equal((await fetch(base + '/health', { headers: { Host: 'host-poison.invalid' }, signal: AbortSignal.timeout(3000) })).status, 200);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='public_origin_last'").get(), undefined);
  assert.equal(relative(root, paths.data), 'data');
});
