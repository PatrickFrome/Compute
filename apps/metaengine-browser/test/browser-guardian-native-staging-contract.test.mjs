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
const buildPath = path.join(root, 'scripts/build-guardian-native-staging.ps1');
const verifyPath = path.join(root, 'scripts/verify-installed-guardian-native-staging.ps1');
const hook = read('scripts/electron-builder-before-pack.cjs');
const build = read('scripts/build-guardian-native-staging.ps1');
const verify = read('scripts/verify-installed-guardian-native-staging.ps1');
const packageSmoke = read('../../.github/workflows/browser-windows-package-smoke.yml');
const fastE2e = read('../../.github/workflows/metaengine-browser-self-update-fast-e2e.yml');
const fullE2e = read('../../.github/workflows/metaengine-browser-self-update-e2e.yml');
const publisher = read('../../.github/workflows/metaengine-browser-fast-autorelease.yml');

function parsePowerShellFile(file) {
  const escaped = file.replaceAll("'", "''");
  const command = `$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.ToString()}|Write-Error;exit 2}`;
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' });
}

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

test('native staging package identity is read without JavaScript Windows path interpolation', () => {
  assert.match(build, /\$packageJsonPath\s*=\s*Join-Path\s+\$root\s+'package\.json'/);
  assert.match(build, /Get-Content\s+\$packageJsonPath\s+-Raw\s+\|\s+ConvertFrom-Json/);
  assert.doesNotMatch(build, /node\s+-p\s+.*require\s*\(/i);
  assert.match(build, /git\s+-C\s+\$root\s+rev-parse\s+HEAD/);
});

test('Guardian staging PowerShell remains parse-safe on Windows', { skip: process.platform !== 'win32' }, () => {
  for (const file of [buildPath, verifyPath]) {
    const parsed = parsePowerShellFile(file);
    assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
  }
  assert.doesNotMatch(verify, /^\s+-or\b/m, 'continuation operators must not begin unescaped PowerShell lines');
  assert.doesNotMatch(verify, /\$ExpectedPackageVersion:\$/m, 'PowerShell variable followed by colon requires ${} delimiting');
  assert.match(verify, /\$\{ExpectedPackageVersion\}:\$verifiedVersion/);
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

test('installed verifier requires exact source, digests, absence of Guardian service, and capturable JSON proof', () => {
  assert.match(verify, /ExpectedSourceHead/);
  assert.match(verify, /Get-Service\s+-Name\s+'METAENGINEBrowserGuardian'/);
  assert.match(verify, /guardian_service_must_not_be_activated_by_per_user_browser_update/);
  assert.match(verify, /Get-FileHash[^\n]+SHA256/);
  assert.match(verify, /installed_guardian_binary_digest_mismatch/);
  assert.match(verify, /guardian_native_staging_verified/);
  assert.match(verify, /guardian_native_no_activation/);
  assert.match(verify, /guardian_native_requires_machine_secure_copy/);
  assert.match(verify, /guardian_native_release_assets_verified/);
  assert.match(verify, /Write-Output\s*\(\$proof\s*\|\s*ConvertTo-Json\s+-Depth\s+6\s+-Compress\)/);
  assert.doesNotMatch(verify, /Write-Host\s*\(\$proof\s*\|\s*ConvertTo-Json/);
});

test('package and both physical self-update lanes require the reusable staging verifier', () => {
  assert.match(packageSmoke, /verify-installed-guardian-native-staging\.ps1/);
  assert.doesNotMatch(packageSmoke, /Build inert exact-head Guardian native staging payload/);
  assert.match(fastE2e, /verify-installed-guardian-native-staging\.ps1/);
  assert.match(fastE2e, /guardian_native_staging_physical_proof_missing/);
  assert.match(fullE2e, /verify-installed-guardian-native-staging\.ps1/);
  assert.match(fullE2e, /guardian_native_evidence_digest_mismatch/);
});

test('verified publisher refuses releases without staged-only Guardian evidence and publishes exact native assets', () => {
  for (const token of [
    'guardian_native_staging_present',
    'guardian_native_staging_verified',
    'guardian_native_no_activation',
    'guardian_native_requires_machine_secure_copy',
    'guardian_native_release_assets_verified',
    'guardian-native-staging-manifest.json',
    'METAENGINEBrowserGuardian.exe',
    'METAENGINEBrowserGuardianConfigure.exe',
    'guardian_manifest_digest_mismatch',
    'guardian_release_binary_digest_mismatch',
    'guardian_release_binary_size_mismatch',
    'github_asset_digest_missing_or_mismatch',
    'github_asset_size_mismatch',
    'guardian_forbidden_authority',
    'guardian_user_writable_activation_fence_missing',
  ]) assert.match(publisher, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(publisher, /GUARDIAN_MANIFEST_SHA256/);
  assert.match(publisher, /GUARDIAN_SERVICE_SHA256/);
  assert.match(publisher, /GUARDIAN_CONFIGURATOR_SHA256/);
  assert.match(publisher, /both exact native binaries are release assets/);
});
