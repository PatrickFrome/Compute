import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const cpp = read('native/browser-guardian-scm/browser-guardian-pipe-client.cpp');
const js = read('src/browser-guardian-update-actuator-client.mjs');
const build = read('scripts/build-guardian-native-staging.ps1');
const verify = read('scripts/verify-installed-guardian-native-staging.ps1');
const observer = read('native/browser-guardian-scm/browser-guardian-owner-enrollment-observer.cpp');

test('Guardian user-session client requests only exact named-pipe rights', () => {
  assert.match(cpp, /FILE_READ_DATA\s*\|\s*FILE_WRITE_DATA\s*\|\s*FILE_READ_ATTRIBUTES\s*\|\s*FILE_WRITE_ATTRIBUTES\s*\|\s*SYNCHRONIZE/);
  assert.doesNotMatch(cpp, /\bGENERIC_READ\b/);
  assert.doesNotMatch(cpp, /\bGENERIC_WRITE\b/);
  assert.match(cpp, /METAENGINEBrowserGuardianUpdateV1/);
  assert.match(cpp, /caller_supplied_pipe_allowed\\":false/);
  assert.match(cpp, /client_create_pipe_instance_allowed\\":false/);
  assert.match(cpp, /FILE_FLAG_OVERLAPPED/);
});

test('Guardian service DACL still forbids client pipe-instance creation', () => {
  assert.match(observer, /0x00100183/);
  assert.match(observer, /FILE_READ_DATA\s*\|\s*FILE_WRITE_DATA\s*\|\s*FILE_READ_ATTRIBUTES\s*\|\s*FILE_WRITE_ATTRIBUTES\s*\|\s*SYNCHRONIZE/);
  const clientMask = observer.match(/constexpr DWORD kClientAccessMask =([\s\S]*?);/)?.[1] || '';
  assert.doesNotMatch(clientMask, /FILE_APPEND_DATA|FILE_CREATE_PIPE_INSTANCE|GENERIC_WRITE/);
});

test('Browser uses only the fixed packaged helper without a shell', () => {
  assert.match(js, /BROWSER_GUARDIAN_PIPE_CLIENT_BINARY\s*=\s*'METAENGINEBrowserGuardianPipeClient\.exe'/);
  assert.match(js, /process\.resourcesPath/);
  assert.match(js, /path\.join\(resources,\s*'guardian-native',\s*BROWSER_GUARDIAN_PIPE_CLIENT_BINARY\)/);
  assert.match(js, /spawnImpl\(binary,\s*\['--timeout-ms',\s*String\(timeout\)\]/);
  assert.match(js, /shell:\s*false/);
  assert.doesNotMatch(js, /net\.createConnection/);
  assert.doesNotMatch(js, /pipeName\s*=/);
});

test('staging manifest and installed verifier bind exact helper digest and access contract', () => {
  for (const source of [build, verify]) {
    assert.match(source, /METAENGINEBrowserGuardianPipeClient\.exe/);
    assert.match(source, /exact_access_mask/);
    assert.match(source, /1048963/);
    assert.match(source, /client_create_pipe_instance_allowed/);
  }
  assert.match(build, /browser_pipe_client\s*=\s*\[ordered\]@\{/);
  assert.match(build, /machine_secure_copy_required\s*=\s*\$false/);
  assert.match(verify, /installed_guardian_pipe_client_digest_mismatch/);
  assert.match(verify, /installed_guardian_pipe_client_size_mismatch/);
});
