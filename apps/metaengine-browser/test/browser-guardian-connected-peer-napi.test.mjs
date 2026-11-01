import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(root, 'test/native/guardian-peer-napi-synthetic');
const native = path.join(root, 'native/browser-guardian-scm');
const compiler = process.platform === 'linux' ? spawnSync('c++', ['--version'], { encoding: 'utf8' }) : null;

const nodeApiRelative = 'native/third_party/node-api-24.0.0';
const nodeApiPins = {
  'node_api.h': 'd14db85d16f182045c42745a6e44b96e932dfe6e3bfcaac7a1096fae8412c579',
  'node_api_types.h': '8d5d854088d5725fec9775510e0aeeeb790a41ad083c49bb721d950b86e6bd61',
  'js_native_api.h': '048b4efdcd823f30afd323d61c8aba5be285077f9d790feb52a6fa6382df2541',
  'js_native_api_types.h': '0410c31e227f81e2981363c4d543f4832ac3df785343ec64cee621742ff8a034',
  LICENSE: 'b58bb782ec115892f61475a6199db165545926d93624ae172f25b7a6e1dafffe',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function assertPinnedNodeApi(directory) {
  for (const [name, expected] of Object.entries(nodeApiPins)) {
    assert.equal(sha256(fs.readFileSync(path.join(directory, name))), expected, `pinned Node-API bytes changed: ${name}`);
  }
}

test('vendored Node-API headers and license retain the existing upstream byte pins', () => {
  assertPinnedNodeApi(path.join(root, nodeApiRelative));
  const provenance = JSON.parse(fs.readFileSync(path.join(root, nodeApiRelative, 'PROVENANCE.json'), 'utf8'));
  const { LICENSE, ...headers } = nodeApiPins;
  assert.deepEqual(provenance.files, headers);
  assert.equal(provenance.license_sha256, LICENSE);
  const builder = fs.readFileSync(path.join(root, 'scripts/build-guardian-native-peer.ps1'), 'utf8');
  for (const digest of Object.values(nodeApiPins)) assert.ok(builder.includes(digest), 'test pin diverged from actual producer');
});

test('autocrlf checkout preserves pinned Node-API bytes and still rejects a one-byte mutation', { timeout: 60_000 }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-node-api-checkout-'));
  try {
    const repository = path.join(temporary, 'repo');
    const emptyConfig = path.join(temporary, 'empty-config');
    const emptyAttributes = path.join(temporary, 'empty-attributes');
    fs.mkdirSync(repository);
    fs.writeFileSync(emptyConfig, ''); fs.writeFileSync(emptyAttributes, '');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_ATTR_NOSYSTEM: '1' });
    const git = (autocrlf, ...args) => execFileSync('git', [
      '-c', `core.autocrlf=${autocrlf}`, '-c', `core.attributesFile=${emptyAttributes}`, ...args,
    ], { cwd: repository, env, encoding: 'utf8', timeout: 10_000 });
    git('false', 'init', '--quiet');
    const destination = path.join(repository, nodeApiRelative);
    fs.mkdirSync(destination, { recursive: true });
    const original = Object.fromEntries(Object.keys(nodeApiPins).map(name => [name,
      fs.readFileSync(path.join(root, nodeApiRelative, name))]));
    const paths = Object.keys(nodeApiPins).map(name => `${nodeApiRelative}/${name}`);
    for (const [name, bytes] of Object.entries(original)) fs.writeFileSync(path.join(destination, name), bytes);
    git('false', 'add', '--', ...paths);
    const checkout = () => {
      for (const name of Object.keys(nodeApiPins)) fs.unlinkSync(path.join(destination, name));
      git('true', 'checkout-index', '--all', '--force');
    };

    // Negative control: the same indexed LF bytes are changed by an autocrlf
    // checkout when the exact-byte attributes are absent. This is real Git,
    // not a source-regex assertion or a replacement of the approved hashes.
    checkout();
    for (const [name, bytes] of Object.entries(original)) {
      const converted = fs.readFileSync(path.join(destination, name));
      assert.notEqual(sha256(converted), nodeApiPins[name], `negative control did not change ${name}`);
      assert.deepEqual(converted, Buffer.from(bytes.toString('utf8').replace(/\n/g, '\r\n')));
    }

    fs.copyFileSync(path.join(root, '.gitattributes'), path.join(repository, '.gitattributes'));
    git('false', 'add', '--', '.gitattributes');
    checkout();
    assertPinnedNodeApi(destination);
    for (const [name, bytes] of Object.entries(original)) assert.deepEqual(fs.readFileSync(path.join(destination, name)), bytes);

    const changed = Buffer.from(original['node_api.h']); changed[0] ^= 1;
    fs.writeFileSync(path.join(destination, 'node_api.h'), changed);
    assert.throws(() => assertPinnedNodeApi(destination), /pinned Node-API bytes changed: node_api\.h/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('actual N-API async ownership and immediate cancellation with an explicit synthetic core', {
  skip: process.platform !== 'linux' ? 'Linux symbol shim only; does not qualify Windows or Electron' :
    compiler?.error ? 'requires a build-host C++ compiler for the synthetic N-API fixture' : false,
  timeout: 30_000,
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-peer-napi-lifetime-'));
  try {
    const binary = path.join(temporary, 'synthetic-connected-peer.node');
    execFileSync('c++', ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-fPIC', '-shared', '-pthread',
      '-I', fixture, '-I', path.join(root, 'native/third_party/node-api-24.0.0'), '-I', native,
      path.join(native, 'browser-guardian-connected-peer-napi.cpp'), path.join(fixture, 'core.cpp'),
      '-ldl', '-o', binary], { encoding: 'utf8', timeout: 20_000 });
    const result = spawnSync(process.execPath, ['--expose-gc', path.join(fixture, 'lifecycle.cjs'), binary], {
      encoding: 'utf8', timeout: 20_000, env: { ...process.env, UV_THREADPOOL_SIZE: '4' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NAPI_OPEN_COMPLETION_CANCEL=PASS/);
    assert.match(result.stdout, /NAPI_PENDING_OPEN_CANCEL=PASS/);
    assert.match(result.stdout, /NAPI_LIFETIME_TESTS=PASS; SYNTHETIC_CORE_NOT_WINDOWS/);
    assert.match(result.stdout, /environment_termination_wait=UNQUALIFIED/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
