import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(root, 'test/native/guardian-peer-napi-synthetic');
const native = path.join(root, 'native/browser-guardian-scm');
const compiler = process.platform === 'linux' ? spawnSync('c++', ['--version'], { encoding: 'utf8' }) : null;

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
