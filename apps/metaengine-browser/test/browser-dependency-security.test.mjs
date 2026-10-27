import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import test from 'node:test';
import { checkR97ElectronInputs, PIN } from '../scripts/qualify-r97-electron-w78.mjs';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root)));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root)));
const reviewed = [
  ['electron', '44.9.3'],
  ['fast-uri', '3.1.9'],
  ['http-cache-semantics', '4.3.0'],
  ['node-gyp/node_modules/undici', '6.29.1'],
  ['undici', '7.30.1'],
];

test('reviewed Browser dependency pins match installed packages and preserve the product version', async () => {
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
  for (const [name, version] of reviewed) {
    const entry = lock.packages['node_modules/' + name];
    assert.equal(entry.version, version, name);
    assert.equal(entry.resolved, `https://registry.npmjs.org/${name.split('/').at(-1)}/-/${name.split('/').at(-1)}-${version}.tgz`);
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
    assert.equal(require(name + '/package.json').version, version, name);
  }
  assert.equal(manifest.devDependencies.electron, PIN.version);
  assert.equal(lock.packages['node_modules/electron'].integrity, PIN.integrity);
  // Checks metadata only: never require('electron') or materialize its binary.
  assert.deepEqual(await checkR97ElectronInputs(undefined, {}), { electron_version: PIN.version, locked_upstream: true });
});

test('fast-uri does not activate a percent-encoded scheme', () => {
  const uri = require('fast-uri');
  for (const value of ['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)', '%68ttp://a/']) {
    assert.equal(uri.parse(value).error, 'URI scheme is malformed.');
    assert.equal(uri.normalize(value), value);
    assert.throws(() => uri.resolve('https://example.test/', value), /scheme is malformed/);
  }
  assert.equal(uri.resolve('https://example.test/a/', '../b'), 'https://example.test/b');
});

test('undici 7 rejects invalid integrity with both lowercase and uppercase algorithm tokens', async () => {
  const { fetch } = require('undici');
  for (const algorithm of ['sha256', 'SHA256']) {
    await assert.rejects(fetch('data:text/plain,dependency-regression', {
      integrity: algorithm + '-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    }), error => error.cause?.message === 'integrity mismatch');
  }
});

for (const module of ['undici', 'node-gyp/node_modules/undici']) {
  test(`${module} rejects truncated excessive content-encoding without crashing its process`, async () => {
    // Each actual HTTP parser runs in a disposable child, so a reintroduced
    // unhandled stream error fails the child rather than the entire test runner.
    const source = `
      const assert = require('node:assert/strict');
      const http = require('node:http');
      const { fetch } = require(${JSON.stringify(require.resolve(module))});
      (async () => {
        const server = http.createServer((request, response) => {
          response.writeHead(200, {
            'content-encoding': 'gzip, gzip, gzip, gzip, gzip, gzip',
            'content-length': '1024', 'connection': 'close',
          });
          response.end();
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
          await assert.rejects(fetch('http://127.0.0.1:' + server.address().port));
          await new Promise(resolve => setTimeout(resolve, 100));
        } finally {
          server.closeAllConnections();
          await new Promise(resolve => server.close(resolve));
        }
        console.log('encoding-rejected-process-survived');
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, ['-e', source], {
      env: environment, timeout: 10000, maxBuffer: 65536,
    });
    assert.match(stdout, /encoding-rejected-process-survived/);
  });
}
