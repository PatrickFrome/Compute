import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { resolveMe2UiLaunch } from '../src/me2/me2-ui-host.mjs';

const execute = promisify(execFile);
const uiDirectory = path.resolve('fixture-ui');
const exists = file => file === path.join(uiDirectory, 'package.json') || file === path.join(uiDirectory, 'server.js');

test('standalone and package-script UI pin hostname despite an inherited wildcard', () => {
  for (const extraEnv of [{}, { ME2_UI_BIN: 'bun-custom' }]) {
    const launch = resolveMe2UiLaunch({ resourcesPath: '', cwd: path.resolve('hostile-cwd'), execPath: process.execPath,
      env: { ME2_UI_DIR: uiDirectory, HOSTNAME: '0.0.0.0', ...extraEnv }, exists });
    assert.equal(launch.env_patch.HOSTNAME, '127.0.0.1');
    assert.deepEqual(launch.args, extraEnv.ME2_UI_BIN ? ['run', 'start'] : ['server.js']);
  }
});

test('Next development CLI receives loopback directly before any package shell pipeline', () => {
  const launch = resolveMe2UiLaunch({ resourcesPath: '', cwd: path.resolve('hostile-cwd'), execPath: process.execPath,
    env: { ME2_UI_DIR: uiDirectory, HOSTNAME: '192.168.1.20', ME2_UI_BIN: 'bun-custom', ME2_UI_DEV: '1' }, exists });
  assert.equal(launch.bin, 'bun-custom');
  assert.equal(launch.launch_mode, 'SOURCE_DEV');
  assert.deepEqual(launch.args.slice(0, 5), [path.join(uiDirectory, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port']);
  assert.equal(launch.env_patch.HOSTNAME, '127.0.0.1');
});

test('normal host spawns a real disposable UI on loopback with hostile inherited HOSTNAME', async () => {
  const temporaryRoot = await realpath(os.tmpdir());
  const fixture = await mkdtemp(path.join(temporaryRoot, 'me2-ui-loopback-host-'));
  const portReservation = net.createServer();
  portReservation.listen(0, '127.0.0.1');
  await once(portReservation, 'listening');
  const port = portReservation.address().port;
  await new Promise((resolve, reject) => portReservation.close(error => error ? reject(error) : resolve()));
  try {
    await writeFile(path.join(fixture, 'package.json'), '{"private":true,"type":"commonjs"}\n');
    await writeFile(path.join(fixture, 'server.js'), `const http = require('node:http');
const server = http.createServer((request, response) => { response.setHeader('content-type', 'text/html'); response.end('<html>disposable UI</html>'); });
server.listen(Number(process.env.PORT), process.env.HOSTNAME, () => console.log(JSON.stringify({ address: server.address().address, pid: process.pid, hostname: process.env.HOSTNAME })));
`);
    await writeFile(path.join(fixture, 'harness.mjs'), `const host = await import(process.argv[2]);
const sockets = await import(process.argv[3]);
try {
  const state = await host.startMe2UiHost();
  if (state.state !== 'HEALTHY' || state.mode !== 'spawned') throw new Error('disposable_ui_not_healthy');
  const listener = process.platform === 'win32' ? await sockets.verifyWindowsTcpListener({ port: Number(process.env.ME2_UI_PORT), pid: state.child_pid }) : null;
  console.log(JSON.stringify({ proof: 'normal-host-loopback', child_pid: state.child_pid, listener }));
} finally {
  const stopped = await host.stopMe2UiHostAndWait();
  if (!stopped.shutdown.confirmed) throw new Error('disposable_ui_shutdown_unconfirmed');
}
`);
    const { stdout } = await execute(process.execPath, [path.join(fixture, 'harness.mjs'),
      new URL('../src/me2/me2-ui-host.mjs', import.meta.url).href,
      new URL('../scripts/verify-windows-tcp-listener.mjs', import.meta.url).href], {
      cwd: fixture, windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024,
      env: { ...process.env, HOSTNAME: '0.0.0.0', ME2_UI_DIR: fixture, ME2_UI_PORT: String(port),
        ME2_UI_BIN: '', ME2_UI_DEV: '0', ME2_UI_ALLOW_EXTERNAL_ADOPT: '0', ME2_UI_HEALTH_URL: `http://127.0.0.1:${port}/` },
    });
    const rows = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    const child = rows.find(row => row.schema === 'metaengine.browser.me2.ui-stdout.v1');
    const address = JSON.parse(child.line);
    const proof = rows.find(row => row.proof === 'normal-host-loopback');
    assert.equal(address.address, '127.0.0.1');
    assert.equal(address.hostname, '127.0.0.1');
    assert.equal(address.pid, proof.child_pid);
    if (process.platform === 'win32') {
      assert.equal(proof.listener.owner_pid, proof.child_pid);
      assert.equal(proof.listener.local_port, port);
      assert.equal(proof.listener.loopback_only, true);
    }
  } finally {
    // This is the unique temp directory just created by this test.
    assert.equal(await realpath(fixture), fixture);
    assert.equal(path.dirname(fixture), temporaryRoot);
    await rm(fixture, { recursive: true, force: true });
  }
});
