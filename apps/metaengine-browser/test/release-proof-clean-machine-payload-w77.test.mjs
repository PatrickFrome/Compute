// SOURCE-only payload-presence fixtures. SHA/size placeholders are inert
// manifest data, never installed proof, release authorization or runtime QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  requiredSelfContainedPayloadsW77,
  validateRequiredSelfContainedPayloadsW77,
  probeProductionReleaseProofW77,
} from '../scripts/release-proof-producer-w77.mjs';

const SOURCE = 'a'.repeat(40);
const VERSION = '0.7.0-dev.999900003.1';
const EXE = 'METAENGINE Browser Test.exe';
const BUNDLE = 'resources/client-state-runtime';
const PAYLOADS = Object.freeze({
  browser_exe: EXE,
  browser_asar: 'resources/app.asar',
  codex_job_helper: 'resources/native-coding/codex-cli-job-runner.ps1',
  offline_manifest: `${BUNDLE}/offline-runtime-bundle.json`,
  runtime_host: `${BUNDLE}/source/infra/client-state-runtime/runtime-host.mjs`,
  fresh_pg17_initdb: `${BUNDLE}/source/infra/client-state-runtime/fresh-pg17-initdb.mjs`,
  bundled_node: `${BUNDLE}/runtime/node/node.exe`,
  bundled_deno: `${BUNDLE}/runtime/deno/deno.exe`,
  pg17_postgres: `${BUNDLE}/runtime/postgresql/bin/postgres.exe`,
  pg17_psql: `${BUNDLE}/runtime/postgresql/bin/psql.exe`,
  pg17_initdb: `${BUNDLE}/runtime/postgresql/bin/initdb.exe`,
  pg17_pg_ctl: `${BUNDLE}/runtime/postgresql/bin/pg_ctl.exe`,
  pg17_pg_config: `${BUNDLE}/runtime/postgresql/bin/pg_config.exe`,
  pg17_plpgsql: `${BUNDLE}/runtime/postgresql/lib/plpgsql.dll`,
  pg17_catalog: `${BUNDLE}/runtime/postgresql/share/postgres.bki`,
  guardian_manifest: 'resources/guardian-native/guardian-native-manifest.json',
  guardian_service: 'resources/guardian-native/METAENGINEBrowserGuardian.exe',
  guardian_configurator: 'resources/guardian-native/METAENGINEBrowserGuardianConfigure.exe',
  guardian_bootstrap_binding: 'resources/guardian-bootstrap/guardian-machine-bootstrap-binding.json',
  guardian_bootstrap: `resources/guardian-bootstrap/METAENGINE-Guardian-Bootstrap-${VERSION}-x64.exe`,
});

function manifest({version = VERSION, exeName = EXE} = {}) {
  const payloads = {...PAYLOADS,
    browser_exe: exeName,
    guardian_bootstrap: PAYLOADS.guardian_bootstrap.replace(VERSION, version)};
  const directories = new Set();
  for (const file of Object.values(payloads)) {
    for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent)) directories.add(parent);
  }
  const entries = [...directories].map(relative => ({path: relative, kind: 'directory'}));
  for (const relative of Object.values(payloads)) entries.push({path: relative, kind: 'file', size: 1, sha256: '8'.repeat(64)});
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {schema: 'metaengine.browser.installed-package-code.v1', source_sha: SOURCE,
    package_version: version, exe_name: exeName, entries};
}
const verify = (value, options = {}) => validateRequiredSelfContainedPayloadsW77(value, {
  sourceSha: SOURCE, version: VERSION, ...options,
});

test('required payload map follows existing package resource contracts and exact version-bound bootstrap', () => {
  const result = requiredSelfContainedPayloadsW77(VERSION);
  assert.deepEqual(result, PAYLOADS);
  assert.equal(Object.isFrozen(result), true);
});

test('complete declared source payload stays explicitly unqualified for clean-machine installation and CLI closure', () => {
  const input = manifest(), before = structuredClone(input), result = verify(input);
  assert.equal(result.scope, 'SOURCE_PAYLOAD_PRESENCE_ONLY');
  assert.equal(result.clean_machine_installation_qualified, false);
  assert.deepEqual(result.required_roles, PAYLOADS);
  assert.deepEqual(result.unresolved_role_bindings, [
    'codex_cli_executable_and_dependencies', 'git_executable_and_dependencies',
  ]);
  assert.equal(result.authority_effect, false);
  for (const claim of ['ready', 'execution_ready', 'release_authorized', 'installed_authority',
    'production_authorized', 'verified', 'clean_machine_verified']) assert.notEqual(result[claim], true, claim);
  assert.deepEqual(input, before, 'validation must preserve caller-owned manifest data');
  assert.equal(Object.isFrozen(input), false, 'validation cannot freeze caller data');
  assert.equal(Object.isFrozen(input.entries), false, 'validation cannot freeze caller entries');
  input.entries[0].path = 'caller remains mutable';
  assert.notEqual(input.entries[0].path, before.entries[0].path);
});

test('the existing W68 Browser alternative retains its exact executable role', () => {
  const exeName = 'METAENGINE-Browser.exe', input = manifest({exeName});
  const expected = {...PAYLOADS, browser_exe: exeName};
  assert.deepEqual(requiredSelfContainedPayloadsW77(VERSION, exeName), expected);
  assert.deepEqual(verify(input, {exeName}).required_roles, expected);
});

test('production probe records source guard wiring while retaining real clean-machine and signing blockers', () => {
  const probe = probeProductionReleaseProofW77();
  assert.equal(probe.self_contained_payload_presence_guard_wired, true);
  assert.equal(probe.clean_machine_installation_qualified, false);
  assert.ok(probe.missing_capabilities.includes('PACKAGED_CODEX_CLI_AND_GIT_ROLE_BINDINGS_NOT_DECLARED'));
  assert.ok(probe.missing_capabilities.includes('EXISTING_PROTECTED_RELEASE_ROOT_SIGNING_CAPABILITY_NOT_WIRED'));
  assert.ok(probe.missing_capabilities.includes('EXTERNAL_SIDECAR_INSTALLED_PLACEMENT_UNPROVEN'));
  assert.ok(probe.missing_capabilities.includes('IMMUTABLE_VERIFIED_GH_ARTIFACT_HANDOFF_RUNTIME_NOT_QUALIFIED'));
  assert.equal(probe.disposition, 'BLOCKED');
  assert.equal(probe.production_sidecars_emitted, false);
  assert.equal(probe.installed_authority, false);
  assert.equal(probe.release_authorized, false);
  assert.equal(probe.authority_effect, false);
});

for (const [role, relative] of Object.entries(PAYLOADS)) {
  test('missing payload role refuses signing handoff: ' + role, () => {
    const input = manifest(); input.entries = input.entries.filter(entry => entry.path !== relative);
    assert.throws(() => verify(input), /w77_release_proof_|w68_package_code_/);
  });
  test('empty payload role refuses signing handoff: ' + role, () => {
    const input = manifest(); input.entries.find(entry => entry.path === relative).size = 0;
    assert.throws(() => verify(input), /w77_release_proof_|w68_package_code_/);
  });
  test('directory cannot substitute for payload role: ' + role, () => {
    const input = manifest(), index = input.entries.findIndex(entry => entry.path === relative);
    input.entries[index] = {path: relative, kind: 'directory'};
    assert.throws(() => verify(input), /w77_release_proof_|w68_package_code_/);
  });
  test('case alias cannot substitute for canonical payload path: ' + role, () => {
    const input = manifest(), entry = input.entries.find(entry => entry.path === relative);
    entry.path = path.posix.join(path.posix.dirname(relative), path.posix.basename(relative).toUpperCase());
    input.entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    assert.throws(() => verify(input), /w77_release_proof_|w68_package_code_/);
  });
}

test('foreign version bootstrap cannot satisfy an otherwise matching payload inventory', () => {
  const input = manifest(), entry = input.entries.find(entry => entry.path === PAYLOADS.guardian_bootstrap);
  entry.path = entry.path.replace(VERSION, '0.7.0-dev.999900004.1');
  assert.throws(() => verify(input), /w77_release_proof_|w68_package_code_/);
});

for (const [label, mutate, options] of [
  ['source', input => { input.source_sha = 'b'.repeat(40); }, {}],
  ['package version', input => { input.package_version = '0.7.0-dev.999900004.1'; }, {}],
  ['executable', input => { input.exe_name = 'METAENGINE-Browser.exe'; }, {}],
  ['expected source', () => {}, {sourceSha: 'b'.repeat(40)}],
  ['expected version', () => {}, {version: '0.7.0-dev.999900004.1'}],
  ['unrecognized executable', () => {}, {exeName: 'ExternalBrowser.exe'}],
]) test('existing package identity validation rejects mismatched ' + label, () => {
  const input = manifest(); mutate(input);
  assert.throws(() => verify(input, options), /w77_release_proof_|w68_package_code_/);
});

for (const version of ['0.7.0', '', '0.7.0-dev.0.1', '0.7.0-dev.01.1',
  '0.7.0-dev.37781000062.1', '0.7.0-dev.842024784850.1', '../outside']) {
  test('payload role map rejects invalid or reserved version ' + JSON.stringify(version), () => {
    assert.throws(() => requiredSelfContainedPayloadsW77(version), /w77_release_proof_/);
  });
}
