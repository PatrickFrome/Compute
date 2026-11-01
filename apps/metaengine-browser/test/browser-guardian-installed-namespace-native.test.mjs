import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../native/browser-guardian-scm/', import.meta.url));
const source = path.join(directory, 'browser-guardian-installed-namespace.cpp');
const header = fs.readFileSync(path.join(directory, 'browser-guardian-installed-namespace.hpp'), 'utf8');
const probe = fileURLToPath(new URL('./native/browser-guardian-installed-namespace-probe.cpp', import.meta.url));
const probeSource = fs.readFileSync(probe, 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');

const runtimeCases = [
  'positive_disk_hash_and_empty_file', 'preexisting_writer_rejected',
  'retained_package_canonical_serialization', 'default_release_signature_build_unavailable',
  'unicode_package_binding_refused',
  'preexisting_mapped_writer_rejected', 'preexisting_writable_section_without_view_rejected',
  'writable_code_root_rejected', 'writable_code_child_rejected',
  'hardlink_rejected', 'symlink_reparse_rejected',
  'case_sensitive_directory_rejected', 'cancelled_capture_rejected', 'cancelled_retained_custody_rejected',
  'retained_file_blocks_writer_delete_and_rename', 'retained_root_and_ancestor_block_rename',
  'privileged_new_provider_detected', 'privileged_acl_drift_detected',
  'disposed_capture_releases_file_and_ancestor_handles',
];

test('namespace test adapter is available only through the private test friend', () => {
  assert.match(header, /private:[\s\S]*#ifdef METAENGINE_GUARDIAN_NAMESPACE_TEST\s+friend struct GuardianInstalledNamespaceTest;\s+#endif/);
  assert.match(header, /private:[\s\S]*static std::unique_ptr<GuardianInstalledNamespace> capture\(/);
  assert.match(probeSource, /#ifndef METAENGINE_GUARDIAN_NAMESPACE_TEST\s+#error/);
  assert.match(probeSource, /return GuardianInstalledNamespace::capture\(path, stop_event\)/);
  assert.match(probeSource, /return held\.serializeRetainedPackage\(manifest, bytes\)/);
  assert.match(probeSource, /return held\.bindRetainedReleaseSignature\(\)/);
  assert.doesNotMatch(fs.readFileSync(source, 'utf8'), /METAENGINE_GUARDIAN_NAMESPACE_TEST|verified\s*:\s*true/);
});

test('Windows probe covers original custody and mutations of a disposable machine-owned fixture', () => {
  for (const name of runtimeCases) assert.ok(probeSource.includes(`run("${name}"`), `missing native case: ${name}`);
  assert.match(probeSource, /O:BAD:P\(A;OICI;FA;;;SY\)\(A;OICI;FA;;;BA\)/);
  assert.match(probeSource, /GetTempFileNameW/);
  assert.match(probeSource, /CreateFileMappingW\(writer\.value, nullptr, PAGE_READWRITE/);
  assert.match(probeSource, /writer\.reset\(\);\s+rejected\(fixture, "INSTALLED_NAMESPACE_ENTRY_UNTRUSTED"\)/);
  assert.match(probeSource, /mappedWriterRejected\(fixture, false\)/);
  assert.doesNotMatch(probeSource, /PREEXISTING_WRITABLE_MAPPINGS_UNQUALIFIED|mutation_detected|mappedWriterDiagnostic/);
  assert.doesNotMatch(probeSource, /AdjustTokenPrivileges|SetTokenInformation|CreateProcess|ShellExecute|ProgramData|WTSQueryUserToken/);
});

test('distinct Unicode names demonstrate the ECMAScript lowercase collision refused by native package binding', () => {
  assert.notEqual('\u0130.bin', 'i\u0307.bin');
  assert.equal('\u0130.bin'.toLowerCase(), 'i\u0307.bin');
  assert.match(probeSource, /L"\\u0130\.bin"/);
  assert.match(probeSource, /L"i\\u0307\.bin"/);
});

function compilerEnvironment() {
  const available = spawnSync('cl.exe', ['/nologo', '/?'], { encoding: 'utf8' });
  if (!available.error) return process.env;
  assert.equal(available.error.code, 'ENOENT', 'MSVC discovery failed unexpectedly');
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const installation = execFileSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
  assert.ok(installation, 'Windows runtime test requires the MSVC x64 toolchain');
  const vcvars = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  assert.ok(fs.existsSync(vcvars), 'vcvars64.bat missing');
  assert.doesNotMatch(vcvars, /[%"&|<>\r\n]/, 'unexpected shell metacharacter in compiler installation path');
  const output = execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `call "${vcvars}" >nul && set`],
    { encoding: 'utf8' });
  return Object.fromEntries(output.split(/\r?\n/).filter(line => line.indexOf('=') > 0).map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
}

function expectedNamespaceDigest() {
  const entries = [
    ['METAENGINE Browser Test.exe', false, 'guardian namespace exe fixture\n'],
    ['empty.bin', false, ''],
    ['resources', true, null],
    ['resources\\app.asar', false, 'guardian namespace package fixture\n'],
  ];
  const framed = entries.flatMap(([name, directoryEntry, bytes]) => {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(name.length);
    return [length, Buffer.from(name, 'utf16le'), Buffer.from([directoryEntry ? 1 : 0]),
      Buffer.from(directoryEntry ? '' : sha256(bytes), 'ascii')];
  });
  return sha256(Buffer.concat(framed));
}

function expectedPackageBytes() {
  // Independent W68 JSON oracle: explicit key order, slash names and terminal LF.
  return JSON.stringify({
    schema: 'metaengine.browser.installed-package-code.v1',
    source_sha: 'a'.repeat(40),
    package_version: '0.7.0-dev.12345.1',
    exe_name: 'METAENGINE Browser Test.exe',
    entries: [
      { path: 'METAENGINE Browser Test.exe', kind: 'file', size: Buffer.byteLength('guardian namespace exe fixture\n'), sha256: sha256('guardian namespace exe fixture\n') },
      { path: 'empty.bin', kind: 'file', size: 0, sha256: sha256('') },
      { path: 'resources', kind: 'directory' },
      { path: 'resources/app.asar', kind: 'file', size: Buffer.byteLength('guardian namespace package fixture\n'), sha256: sha256('guardian namespace package fixture\n') },
    ],
  }) + '\n';
}

test('actual Windows namespace handles reject unsafe files and remain retained until disposal', {
  skip: process.platform !== 'win32' ? 'requires actual Windows tokens, ACLs and filesystem handles' : false,
  timeout: 150_000,
}, t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-namespace-native-'));
  try {
    const binary = path.join(temporary, 'guardian-installed-namespace-probe.exe');
    execFileSync('cl.exe', ['/nologo', '/std:c++20', '/EHsc', '/MT', '/W4', '/WX', '/DUNICODE', '/D_UNICODE',
      '/DMETAENGINE_GUARDIAN_NAMESPACE_TEST', '/I', directory, probe, source, `/Fe:${binary}`,
      '/link', 'advapi32.lib', 'bcrypt.lib'],
    { cwd: temporary, env: compilerEnvironment(), encoding: 'utf8', timeout: 120_000 });
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 25_000 });
    assert.ifError(run.error);
    const rows = run.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const summary = rows.find(row => row.name === 'summary');
    assert.ok(summary, `native summary missing: ${run.stderr}`);
    if (run.status === 77) {
      assert.equal(summary.state, 'SKIP');
      assert.match(summary.reason, /^MACHINE_OWNED_FIXTURE_UNAVAILABLE:/);
      t.skip(`${summary.reason}; Win32 ${summary.win32_error}`);
      return;
    }
    assert.equal(run.status, 0, JSON.stringify(rows.filter(row => row.state === 'FAIL')) + run.stderr);
    assert.equal(summary.state, 'PASS');
    assert.equal(summary.schema, 'metaengine.browser-guardian.installed-namespace-mechanical-tests.v1');
    assert.equal(summary.runtime, 'WINDOWS_NATIVE_FILESYSTEM');
    assert.equal(summary.failed, 0);
    assert.equal(summary.tests_passed, summary.passed);
    assert.equal(summary.authority_effect, false);
    assert.equal(summary.loaded_runtime_code_attested, false);
    assert.ok(summary.limitations.includes('WINDOWS_RUNTIME_QUALIFICATION_PENDING'));
    assert.equal(summary.passed + summary.skipped, runtimeCases.length);
    for (const name of runtimeCases) {
      const result = rows.find(row => row.name === name);
      assert.ok(result, `native case did not run: ${name}`);
      if (result.state === 'SKIP') {
        assert.ok(['hardlink_rejected', 'symlink_reparse_rejected', 'case_sensitive_directory_rejected'].includes(name), `unexpected native skip: ${name}`);
        t.diagnostic(`${name}: ${result.reason}; Win32 ${result.win32_error}`);
      } else assert.equal(result.state, 'PASS', `${name}: ${JSON.stringify(result)}`);
    }
    const oracle = rows.find(row => row.name === 'digest_oracle');
    assert.equal(oracle?.executable_sha256, sha256('guardian namespace exe fixture\n'));
    assert.equal(oracle.disk_sha256, oracle.executable_sha256);
    assert.equal(oracle.namespace_sha256, expectedNamespaceDigest());
    assert.equal(oracle.files, 3);
    const packageOracle = rows.find(row => row.name === 'retained_package_oracle');
    assert.equal(packageOracle?.sha256, sha256(expectedPackageBytes()));
    assert.equal(packageOracle.bytes, Buffer.byteLength(expectedPackageBytes()));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
