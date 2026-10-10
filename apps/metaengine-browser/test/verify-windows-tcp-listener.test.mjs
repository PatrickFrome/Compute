import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { assertWindowsTcpListener, verifyWindowsTcpListener } from '../scripts/verify-windows-tcp-listener.mjs';

const identity = { port: 3000, pid: 2468 };
const expected = { LocalAddress: '127.0.0.1', LocalPort: 3000, OwningProcess: 2468 };

test('socket proof requires the expected process and only the IPv4 loopback address', () => {
  assert.equal(assertWindowsTcpListener([expected], identity).loopback_only, true);
  assert.throws(() => assertWindowsTcpListener([{ ...expected, OwningProcess: 1357 }], identity), /pid_mismatch/);
  assert.throws(() => assertWindowsTcpListener([{ ...expected, LocalPort: 3001 }], identity), /port_mismatch/);
  for (const address of ['0.0.0.0', '::', '::1', '192.168.1.20', '127.0.0.2', 'localhost']) {
    assert.throws(() => assertWindowsTcpListener([{ ...expected, LocalAddress: address }], identity), /address_mismatch/);
    assert.throws(() => assertWindowsTcpListener([expected, { ...expected, LocalAddress: address }], identity), /address_mismatch/);
  }
});

test('missing or malformed OS observations cannot qualify an HTTP response', () => {
  for (const rows of [[], null, expected, [null], [{ ...expected, OwningProcess: '2468' }], Array(65).fill(expected)]) {
    assert.throws(() => assertWindowsTcpListener(rows, identity), /rows_invalid/);
  }
  for (const bad of [{ port: 0, pid: 2468 }, { port: 65536, pid: 2468 }, { port: 3000, pid: NaN }, { port: '3000', pid: 2468 }]) {
    assert.throws(() => assertWindowsTcpListener([expected], bad), /identity_invalid/);
  }
});

test('Windows query is bounded, numeric-only and omits raw diagnostics', async () => {
  let calls = 0;
  const run = async (executable, args, options) => {
    calls += 1;
    assert.match(executable, /powershell\.exe$/i);
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
    assert.match(args[3], /Get-NetTCPConnection -State Listen -LocalPort 3000/);
    assert.doesNotMatch(args[3], /CommandLine|Environment|Remove-|Stop-/);
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 15000);
    assert.equal(options.maxBuffer, 64 * 1024);
    return { stdout: JSON.stringify([expected]) };
  };
  assert.equal((await verifyWindowsTcpListener({ ...identity, platform: 'win32', run })).owner_pid, identity.pid);
  await assert.rejects(verifyWindowsTcpListener({ port: '3000; secret', pid: 2468, platform: 'win32', run }), /identity_invalid/);
  assert.equal(calls, 1);
  await assert.rejects(verifyWindowsTcpListener({ ...identity, platform: 'linux', run }), /windows_required/);
  assert.equal(calls, 1);
  await assert.rejects(verifyWindowsTcpListener({ ...identity, platform: 'win32', run: async () => { throw new Error('secret-private-diagnostic'); } }), error => {
    assert.equal(error.message, 'me2_ui_os_listener_query_failed');
    return true;
  });
  await assert.rejects(verifyWindowsTcpListener({ ...identity, platform: 'win32', run: async () => ({ stdout: 'not-json private diagnostic' }) }), /rows_invalid/);
});

async function withListener(address, action) {
  const server = net.createServer();
  server.listen(0, address);
  await once(server, 'listening');
  try { await action(server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('real Windows socket readback binds a disposable loopback listener to this PID', { skip: process.platform !== 'win32' }, async () => {
  await withListener('127.0.0.1', async port => {
    const proof = await verifyWindowsTcpListener({ port, pid: process.pid });
    assert.equal(proof.owner_pid, process.pid);
    assert.equal(proof.local_port, port);
    await assert.rejects(verifyWindowsTcpListener({ port, pid: process.pid + 1 }), /pid_mismatch/);
  });
});

test('real Windows socket readback rejects a disposable wildcard listener', { skip: process.platform !== 'win32' }, async () => {
  await withListener('0.0.0.0', port => assert.rejects(verifyWindowsTcpListener({ port, pid: process.pid }), /address_mismatch/));
});
