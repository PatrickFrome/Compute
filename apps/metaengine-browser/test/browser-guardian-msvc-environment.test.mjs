import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureVcvarsEnvironment, vcvarsEnvironmentInvocation } from './helpers/msvc-environment.mjs';

test('vcvars command uses literal cmd quotes rather than CRT backslash quoting', () => {
  const vcvars = String.raw`C:\Program Files (x86)\Microsoft Visual Studio\VC\Auxiliary\Build\vcvars64.bat`;
  const invocation = vcvarsEnvironmentInvocation(vcvars);
  assert.deepEqual(invocation.args, ['/d', '/s', '/c', `call "${vcvars}" >nul && set`]);
  assert.equal(invocation.options.windowsVerbatimArguments, true);
  assert.equal(invocation.options.encoding, 'utf8');
  assert.equal(invocation.options.timeout, 30_000);
  assert.equal(invocation.options.shell, undefined);
});

test('vcvars command refuses relative paths and shell expansion or control characters', () => {
  for (const input of ['', 'vcvars64.bat', 'C:vcvars64.bat', '\\vcvars64.bat', '\\\\host\\share\\vcvars64.bat', null]) {
    assert.throws(() => vcvarsEnvironmentInvocation(input));
  }
  for (const character of ['%', '!', '^', '"', '&', '|', '<', '>', '\0', '\r', '\n']) {
    assert.throws(() => vcvarsEnvironmentInvocation(`C:\\Compiler${character}Path\\vcvars64.bat`));
  }
});

test('all five native compiler wrappers use the reviewed vcvars transport', () => {
  for (const name of ['connected-peer-native', 'install-origin-link-native', 'install-origin-wire',
    'original-install-user-native', 'installed-namespace-native']) {
    const source = fs.readFileSync(new URL(`./browser-guardian-${name}.test.mjs`, import.meta.url), 'utf8');
    assert.match(source, /import \{ captureVcvarsEnvironment \} from '\.\/helpers\/msvc-environment\.mjs';/);
    assert.match(source, /return captureVcvarsEnvironment\(vcvars\);/);
    assert.doesNotMatch(source, /execFileSync\(process\.env\.ComSpec/);
    for (const flag of ['/MT', '/W4', '/WX']) assert.ok(source.includes(`'${flag}'`), `${name} lost ${flag}`);
  }
});

test('actual Windows cmd transports spaced batch paths and captures quoted environment values', {
  skip: process.platform !== 'win32' ? 'requires actual Windows cmd.exe; portable contract tests are not Windows execution' : false,
  timeout: 60_000,
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian vcvars transport-'));
  try {
    const directory = path.join(temporary, 'Compiler (fixture space)');
    fs.mkdirSync(directory);
    const vcvars = path.join(directory, 'vcvars64.bat');
    fs.writeFileSync(vcvars, '@echo off\r\nset "METAENGINE_VCVARS_TRANSPORT_VALUE=spaces = retained"\r\nset METAENGINE_VCVARS_TRANSPORT_QUOTES="quoted value"\r\nexit /b 0\r\n');
    const environment = captureVcvarsEnvironment(vcvars);
    assert.equal(environment.METAENGINE_VCVARS_TRANSPORT_VALUE, 'spaces = retained');
    assert.equal(environment.METAENGINE_VCVARS_TRANSPORT_QUOTES, '"quoted value"');
    assert.equal(Object.hasOwn(environment, '=C:'), false);

    // A failed batch must not fall through to `set` and appear successful.
    fs.writeFileSync(vcvars, '@echo off\r\nexit /b 23\r\n');
    assert.throws(() => captureVcvarsEnvironment(vcvars), error => error.status === 23);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
