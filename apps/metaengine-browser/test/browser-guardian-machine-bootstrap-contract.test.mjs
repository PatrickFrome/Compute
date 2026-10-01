import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const source = read('native/browser-guardian-scm/browser-guardian-machine-bootstrap.cpp');
const build = read('scripts/build-guardian-machine-bootstrap.ps1');
const producer = read('../../.github/workflows/browser-windows-package-smoke.yml');

test('machine bootstrap has only an explicit privileged embedded-asset install boundary', () => {
  assert.match(build, /requireAdministrator/);
  assert.match(build, /\/MT/);
  assert.match(build, /201 RCDATA/);
  assert.match(build, /202 RCDATA/);
  assert.match(build, /203 RCDATA/);
  assert.match(source, /argc == 2[^\n]+L"--install"/);
  assert.match(source, /CheckTokenMembership/);
  assert.doesNotMatch(source, /ShellExecute|CreateProcess|WinHttp|URLDownload|std::system|\bargv\[2\]/);
});

test('all embedded bytes are digest-checked before durable machine effects', () => {
  const verify = source.indexOf('digest(serviceBytes.data');
  const copy = source.indexOf('createExact(binary, serviceBytes)');
  const apply = source.indexOf('applyConfiguration(binary)');
  assert.ok(verify >= 0 && copy > verify && apply > copy);
  assert.match(source, /EMBEDDED_ASSET_DIGEST_MISMATCH/);
  assert.match(source, /strictMachineAcl/);
  assert.match(source, /FILE_FLAG_OPEN_REPARSE_POINT/);
  assert.match(source, /FILE_ATTRIBUTE_REPARSE_POINT/);
  assert.match(source, /FILE_SHARE_READ \| FILE_SHARE_WRITE, nullptr, OPEN_EXISTING/);
});

test('exclusive flushed intent gates physical copy/config/start and forbids blind recovery', () => {
  const begin = source.indexOf('createExact(intent, marker)');
  const copy = source.indexOf('createExact(binary, serviceBytes)');
  const start = source.indexOf('StartServiceW(installed.value');
  assert.ok(begin >= 0 && copy > begin && start > copy);
  assert.match(source, /CREATE_NEW/);
  assert.match(source, /FlushFileBuffers/);
  assert.match(source, /EXISTING_SERVICE_REQUIRES_EXPLICIT_REPLACEMENT_PROTOCOL/);
  assert.match(source, /EXISTING_EXACT_BOOTSTRAP_READBACK/);
  assert.match(source, /exactFile\(result, marker\)/);
  assert.match(source, /SERVICE_RUNNING/);
  assert.doesNotMatch(source, /StopService|ControlService|DeleteService|CREATE_ALWAYS|TRUNCATE_EXISTING/);
});

test('same Package Smoke producer packages and physically qualifies the companion bytes', () => {
  assert.match(producer, /METAENGINE-Guardian-Bootstrap-\*-x64\.exe/);
  assert.match(producer, /guardian-machine-bootstrap-binding\.json/);
  assert.match(producer, /browser-guardian-machine-bootstrap-physical\.ps1/);
  assert.match(producer, /resources\\guardian-bootstrap/);
  assert.match(producer, /guardian-machine-bootstrap-physical-proof\.json/);
  assert.match(read('scripts/electron-builder-before-pack.cjs'), /build-guardian-machine-bootstrap\.ps1/);
});
