import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const builder = JSON.parse(read('electron-builder.test.json'));
const hookPath = path.join(root, 'scripts/electron-builder-before-pack.cjs');
const hook = read('scripts/electron-builder-before-pack.cjs');
const build = read('scripts/build-guardian-native-staging.ps1');
const verify = read('scripts/verify-installed-guardian-native-staging.ps1');
const packageSmoke = read('../../.github/workflows/browser-windows-package-smoke.yml');
const fastE2e = read('../../.github/workflows/metaengine-browser-self-update-fast-e2e.yml');
const fullE2e = read('../../.github/workflows/metaengine-browser-self-update-e2e.yml');
const publisher = read('../../.github/workflows/metaengine-browser-fast-autorelease.yml');

test('electron-builder owns the single Guardian native staging build boundary', () => {
  assert.equal(builder.beforePack, './scripts/electron-builder-before-pack.cjs');
  assert.deepEqual(builder.extraResources, [{
    from: 'native-dist/guardian',
    to: 'guardian-native',
    filter: ['**/*'],
  }]);
  const parsed = spawnSync(process.execPath, ['--check', hookPath], { encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
  assert.match(hook, /electronPlatformName\s*!==\s*'win32'/);
  assert.match(hook, /build-guardian-native-staging\.ps1/);
  assert.match(hook, /guardian_native_staging_windows_toolchain_required/);
  assert.match(hook, /guardian_native_staging_build_failed/);
  assert.doesNotMatch(hook, /\b(?:sc\.exe|Start-Service|New-Service|CreateServiceW|StartServiceW)\b/i);
});

test('staging manifest grants no LocalSystem activation authority', () => {
  for (const expected of [
    /staging_only\s*=\s*\$true/,
    /service_activation_authorized\s*=\s*\$false/,
    /service_installation_authorized\s*=\s*\$false/,
    /service_start_authorized\s*=\s*\$false/,
    /user_writable_service_activation_forbidden\s*=\s*\$true/,
    /requires_machine_secure_copy\s*=\s*\$true/,
    /required_machine_root\s*=\s*'%ProgramFiles%\\METAENGINE\\Guardian'/,
    /authority_effect\s*=\s*\$false/,
  ]) assert.match(build, expected);
  assert.match(build, /METAENGINEBrowserGuardian\.exe/);
  assert.match(build, /METAENGINEBrowserGuardianConfigure\.exe/);
  assert.match(build, /Get-FileHash[^\n]+SHA256/);
  assert.doesNotMatch(build, /\b(?:sc\.exe|Start-Service|New-Service)\b/i);
});

test('installed verifier requires exact source, digests, and absence of Guardian service', () => {
  assert.match(verify, /ExpectedSourceHead/);
  assert.match(verify, /Get-Service\s+-Name\s+'METAENGINEBrowserGuardian'/);
  assert.match(verify, /guardian_service_must_not_be_activated_by_per_user_browser_update/);
  assert.match(verify, /Get-FileHash[^\n]+SHA256/);
  assert.match(verify, /installed_guardian_binary_digest_mismatch/);
  assert.match(verify, /guardian_native_staging_verified/);
  assert.match(verify, /guardian_native_no_activation/);
  assert.match(verify, /guardian_native_requires_machine_secure_copy/);
});

test('package and both physical self-update lanes require the reusable staging verifier', () => {
  assert.match(packageSmoke, /verify-installed-guardian-native-staging\.ps1/);
  assert.doesNotMatch(packageSmoke, /Build inert exact-head Guardian native staging payload/);
  assert.match(fastE2e, /verify-installed-guardian-native-staging\.ps1/);
  assert.match(fastE2e, /guardian_native_staging_physical_proof_missing/);
  assert.match(fullE2e, /verify-installed-guardian-native-staging\.ps1/);
  assert.match(fullE2e, /guardian_native_evidence_digest_mismatch/);
});

test('verified publisher refuses releases without staged-only Guardian evidence', () => {
  for (const token of [
    'guardian_native_staging_present',
    'guardian_native_staging_verified',
    'guardian_native_no_activation',
    'guardian_native_requires_machine_secure_copy',
    'guardian-native-staging-manifest.json',
    'guardian_manifest_digest_mismatch',
    'guardian_forbidden_authority',
    'guardian_user_writable_activation_fence_missing',
  ]) assert.match(publisher, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(publisher, /GUARDIAN_MANIFEST_SHA256/);
  assert.match(publisher, /staged-only and requires a separate machine-secure activation boundary/);
});
