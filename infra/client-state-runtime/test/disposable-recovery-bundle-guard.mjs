// Test support only. Integrity and isolation are necessary preconditions, not
// proof that a dump restored, that a Windows DACL is private, or that an
// installed Owner backup is qualified. This module never runs PostgreSQL.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const SYSTEM = /^[1-9][0-9]{9,19}$/;
const maximumArchiveBytes = 1024 * 1024 * 1024;
const failureCodes = new WeakMap();
const fail = code => {
  const safeCode = 'recovery_bundle_' + code;
  const error = Object.assign(new Error(safeCode), { code: safeCode });
  failureCodes.set(error, safeCode);
  return error;
};
export function recoveryGuardFailureCode(error) {
  return error !== null && typeof error === 'object' ? (failureCodes.get(error) || null) : null;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
const same = (left, right) => canonical(left) === canonical(right);

function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 4096
    || /[\x00-\x1f]/.test(value) || /^(?:\\\\|\/\/)/.test(value)) {
    throw fail('path_untrusted');
  }
  const resolved = path.resolve(value);
  if (process.platform === 'win32' && (!/^[A-Za-z]:\\/.test(resolved)
    || resolved.slice(3).split('\\').some(part => part.includes(':')
      || part.endsWith('.') || part.endsWith(' ')))) throw fail('path_untrusted');
  return resolved;
}

export function recoveryPathDigest(value) {
  return digest(canonical(absolute(value)));
}

function within(parent, child) {
  const relative = path.relative(canonical(parent), canonical(child));
  return relative.length > 0 && relative !== '..' && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative);
}

// Some overlay mounts expose an unsigned inode through a signed bigint.
// Its stable 64-bit identity is still valid; only zero means unavailable.
const inode = stat => BigInt.asUintN(64, stat.ino);

function directoryIdentity(stat) {
  return [stat.dev, inode(stat), stat.mode, stat.birthtimeNs].map(String).join('/');
}

function fileIdentity(stat) {
  return [stat.dev, inode(stat), stat.nlink, stat.mode, stat.size,
    stat.birthtimeNs, stat.mtimeNs, stat.ctimeNs].map(String).join('/');
}

async function ancestry(input) {
  const selected = absolute(input);
  let current = path.parse(selected).root;
  const identities = [];
  for (const part of path.relative(current, selected).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || inode(stat) === 0n
      || !same(await fs.realpath(current), current)) throw fail('directory_alias');
    identities.push([current, directoryIdentity(stat)]);
  }
  return { path: selected, identities };
}

async function unchangedDirectories(samples) {
  for (const sample of samples) {
    const after = await ancestry(sample.path);
    if (JSON.stringify(after.identities) !== JSON.stringify(sample.identities)) {
      throw fail('directory_changed');
    }
  }
}

const phaseMarker = phase => 'RECOVERY_REPARSE_PHASE_' + phase;
const nativeReadbackText = value => typeof value === 'string' ? value
  : Buffer.isBuffer(value) ? value.toString('utf8') : '';

// Bounded classification only. Do not expose stderr, CLIXML, exception text,
// private paths or caller-controlled fragments through the public error code.
export function classifyRecoveryNativePathReadback({ stdout, stderr, error = null, pathCount } = {}) {
  const originalOutput = nativeReadbackText(stdout ?? error?.stdout);
  const output = originalOutput.slice(-8192);
  const diagnostic = nativeReadbackText(stderr ?? error?.stderr);
  const phases = output.split(/\r?\n/).filter(line =>
    /^RECOVERY_REPARSE_PHASE_(?:PARSE|ITEM|ANCESTRY|COMPLETE)$/.test(line));
  const phase = (phases.at(-1)?.slice('RECOVERY_REPARSE_PHASE_'.length) || 'NONE').toLowerCase();
  const code = category => 'native_path_readback_' + category + '_' + phase;
  if (originalOutput.length > 8192 || diagnostic.length > 8192) return code('output_limit');
  if (error) {
    if (error.code === 'ETIMEDOUT') return code('timeout');
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return code('output_limit');
    // Node execFile can use this same shape for a timer or explicit kill.
    if (error.killed === true) return code('termination_or_timeout');
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) return code('spawn');
    return code('exit');
  }
  if (diagnostic.length) return code('stderr');
  if (!Number.isSafeInteger(pathCount) || pathCount < 1 || pathCount > 64) return code('marker');
  const expected = [phaseMarker('PARSE'),
    ...Array.from({ length: pathCount }, () => [phaseMarker('ITEM'), phaseMarker('ANCESTRY')]).flat(),
    phaseMarker('COMPLETE'), 'VERIFIED'].join('\n');
  if (output.replaceAll('\r\n', '\n') !== expected) return code('marker');
  return null;
}

// Node detects ordinary symbolic links and junctions. Also reject other native
// Windows reparse tags instead of assuming every reparse point is a symlink.
// The private paths travel through an environment variable, never argv or logs.
async function noNativeReparse(paths) {
  if (process.platform !== 'win32') return;
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || '';
  if (!/^[A-Za-z]:\\Windows$/i.test(systemRoot)) throw fail('native_path_readback_unknown');
  // Match private-windows-storage-acl: a pwsh7 parent can supply incompatible
  // module search paths to Windows PowerShell 5.1. Keep OS discovery inputs,
  // pin trusted system modules and exclude inherited PostgreSQL credentials.
  const systemKeys = ['PATH', 'PATHEXT', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA',
    'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE', 'TEMP', 'TMP', 'ProgramFiles', 'ProgramData'];
  const safeEnvironment = Object.fromEntries(systemKeys
    .filter(key => typeof process.env[key] === 'string' && process.env[key].length < 8192)
    .map(key => [key, process.env[key]]));
  const env = { ...safeEnvironment, SystemRoot: systemRoot, SYSTEMROOT: systemRoot, WINDIR: systemRoot,
    PSModulePath: path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
    TEMP: safeEnvironment.TEMP || path.win32.join(systemRoot, 'Temp'),
    TMP: safeEnvironment.TMP || path.win32.join(systemRoot, 'Temp'),
    USERPROFILE: safeEnvironment.USERPROFILE || systemRoot,
    METAENGINE_RECOVERY_GUARD_PATHS: JSON.stringify(paths) };
  const script = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$WarningPreference='Stop'
[Console]::Out.WriteLine('RECOVERY_REPARSE_PHASE_PARSE')
foreach($entry in ($env:METAENGINE_RECOVERY_GUARD_PATHS | ConvertFrom-Json)) {
  [Console]::Out.WriteLine('RECOVERY_REPARSE_PHASE_ITEM')
  $item=Get-Item -LiteralPath $entry -Force -ErrorAction Stop
  [Console]::Out.WriteLine('RECOVERY_REPARSE_PHASE_ANCESTRY')
  while($null -ne $item) {
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse' }
    if($item -is [IO.DirectoryInfo]) { $item=$item.Parent } else { $item=$item.Directory }
  }
}
[Console]::Out.WriteLine('RECOVERY_REPARSE_PHASE_COMPLETE')
[Console]::Out.Write('VERIFIED')`;
  let result;
  try {
    result = await exec(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell',
      'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], {
      env,
      windowsHide: true, shell: false, timeout: 15000, maxBuffer: 8192,
    });
  } catch (error) { throw fail(classifyRecoveryNativePathReadback({ error })); }
  const diagnosis = classifyRecoveryNativePathReadback({ ...result, pathCount: paths.length });
  if (diagnosis) throw fail(diagnosis);
}

async function inspectFile(filename, { min = 1, max = maximumArchiveBytes, retain = false } = {}) {
  const file = absolute(filename);
  const parent = await ancestry(path.dirname(file));
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
    || inode(before) === 0n || before.size < BigInt(min) || before.size > BigInt(max)
    || !same(await fs.realpath(file), file)) throw fail('file_untrusted');
  const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW || 0);
  const handle = await fs.open(file, constants.O_RDONLY | noFollow);
  try {
    if (fileIdentity(await handle.stat({ bigint: true })) !== fileIdentity(before)) {
      throw fail('file_changed');
    }
    const hash = createHash('sha256');
    const chunks = [];
    let bytes = 0;
    let signature = Buffer.alloc(0);
    const buffer = Buffer.alloc(65536);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > max || bytes > Number(before.size)) throw fail('file_changed');
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (signature.length < 5) signature = Buffer.concat([signature, chunk]).subarray(0, 5);
      if (retain) chunks.push(Buffer.from(chunk));
    }
    const after = await fs.lstat(file, { bigint: true });
    if (bytes !== Number(before.size) || fileIdentity(after) !== fileIdentity(before)
      || fileIdentity(await handle.stat({ bigint: true })) !== fileIdentity(before)
      || !same(await fs.realpath(file), file)) throw fail('file_changed');
    await unchangedDirectories([parent]);
    return { sha256: hash.digest('hex'), bytes, signature, identity: fileIdentity(after),
      ...(retain ? { contents: Buffer.concat(chunks) } : {}) };
  } finally { await handle.close(); }
}

export async function readRecoveryFile(filename) {
  try {
    const { sha256, bytes } = await inspectFile(filename);
    return Object.freeze({ sha256, bytes });
  } catch (error) {
    if (recoveryGuardFailureCode(error)) throw error;
    throw fail('file_read_unconfirmed');
  }
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validateManifest(manifest) {
  if (!exactKeys(manifest, ['schema', 'evidence_class', 'source_sha', 'source', 'dump',
    'key', 'fixture', 'automatic_retry_allowed', 'installed_backup_verified',
    'upgrade_authorized', 'production_authorized'])
    || manifest.schema !== 'metaengine.disposable-recovery-bundle.manifest.v1'
    || manifest.evidence_class !== 'SYNTHETIC/STAGING' || !HEAD.test(manifest.source_sha)
    || ['automatic_retry_allowed', 'installed_backup_verified', 'upgrade_authorized',
      'production_authorized'].some(key => manifest[key] !== false)
    || !exactKeys(manifest.source, ['system_identifier', 'pid', 'port', 'pgdata_sha256'])
    || typeof manifest.source.system_identifier !== 'string'
    || !SYSTEM.test(manifest.source.system_identifier)
    || !Number.isSafeInteger(manifest.source.pid) || manifest.source.pid <= 0
    || !validPort(manifest.source.port) || !SHA.test(manifest.source.pgdata_sha256 || '')
    || !exactKeys(manifest.dump, ['file', 'sha256', 'bytes'])
    || manifest.dump.file !== 'postgresql-17-snapshot.dump' || !SHA.test(manifest.dump.sha256 || '')
    || !Number.isSafeInteger(manifest.dump.bytes) || manifest.dump.bytes < 1024
    || manifest.dump.bytes > maximumArchiveBytes
    || !exactKeys(manifest.key, ['file', 'sha256', 'bytes'])
    || manifest.key.file !== 'client-vault.key' || !SHA.test(manifest.key.sha256 || '')
    || manifest.key.bytes !== 65
    || !exactKeys(manifest.fixture, ['content_sha256', 'sequence_sha256'])
    || !SHA.test(manifest.fixture.content_sha256 || '')
    || !SHA.test(manifest.fixture.sequence_sha256 || '')) throw fail('manifest_invalid');
}

function validPort(port) {
  return Number.isSafeInteger(port) && port >= 1024 && port <= 65535
    && ![55432, 55433, 55434].includes(port);
}

function clusterIdentity(cluster) {
  if (!cluster || !Number.isSafeInteger(cluster.pid) || cluster.pid <= 0
    || !validPort(cluster.port) || typeof cluster.systemIdentifier !== 'string'
    || !SYSTEM.test(cluster.systemIdentifier)) {
    throw fail('cluster_identity_invalid');
  }
  return absolute(cluster.dataDirectory);
}

export async function verifyRecoveryBundle({ fixtureRoot, bundleDirectory, keyDirectory,
  expectedManifestSha256, expectedSourceHead, source, target } = {}) {
  try {
    if (!SHA.test(expectedManifestSha256 || '') || !HEAD.test(expectedSourceHead || '')) {
      throw fail('expected_binding_required');
    }
    const sourcePath = clusterIdentity(source), targetPath = clusterIdentity(target);
    if (source.pid === target.pid || source.port === target.port
      || source.systemIdentifier === target.systemIdentifier) throw fail('target_not_distinct');
    const root = absolute(fixtureRoot), bundle = absolute(bundleDirectory), key = absolute(keyDirectory);
    const temporary = await fs.realpath(os.tmpdir());
    if (!within(temporary, root)) throw fail('fixture_scope_invalid');
    const allPaths = [root, sourcePath, targetPath, bundle, key];
    const samples = [];
    for (const selected of allPaths) samples.push(await ancestry(selected));
    const rootStat = await fs.lstat(root);
    if (process.platform !== 'win32' && (rootStat.mode & 0o077) !== 0) {
      throw fail('fixture_root_not_private');
    }
    for (const selected of allPaths.slice(1)) {
      if (!within(root, selected)) throw fail('fixture_scope_invalid');
    }
    for (let i = 1; i < allPaths.length; i++) {
      for (let j = i + 1; j < allPaths.length; j++) {
        if (same(allPaths[i], allPaths[j]) || within(allPaths[i], allPaths[j])
          || within(allPaths[j], allPaths[i])) throw fail('paths_not_disjoint');
        const left = samples[i].identities.at(-1)?.[1];
        const right = samples[j].identities.at(-1)?.[1];
        if (!left || left === right) throw fail('directory_alias');
      }
    }
    const manifestPath = path.join(bundle, 'manifest.json');
    const archivePath = path.join(bundle, 'postgresql-17-snapshot.dump');
    const keyPath = path.join(key, 'client-vault.key');
    try { await fs.lstat(keyPath); }
    catch (error) {
      if (error?.code === 'ENOENT') throw fail('key_missing');
      throw fail('key_read_unconfirmed');
    }
    await noNativeReparse([...allPaths, manifestPath, archivePath, keyPath]);
    const manifestFile = await inspectFile(manifestPath, { max: 16384, retain: true });
    if (manifestFile.sha256 !== expectedManifestSha256) throw fail('manifest_digest_mismatch');
    let manifest;
    try { manifest = JSON.parse(manifestFile.contents.toString('utf8')); }
    catch { throw fail('manifest_invalid'); }
    validateManifest(manifest);
    if (manifest.source_sha !== expectedSourceHead
      || manifest.source.system_identifier !== source.systemIdentifier
      || manifest.source.pid !== source.pid || manifest.source.port !== source.port
      || manifest.source.pgdata_sha256 !== recoveryPathDigest(sourcePath)) {
      throw fail('source_binding_mismatch');
    }
    const dump = await inspectFile(archivePath, { min: 1024 });
    if (dump.bytes !== manifest.dump.bytes || dump.sha256 !== manifest.dump.sha256
      || dump.signature.toString('ascii') !== 'PGDMP') throw fail('dump_integrity_mismatch');
    const vault = await inspectFile(keyPath, { min: 65, max: 65, retain: true });
    if (vault.bytes !== manifest.key.bytes || vault.sha256 !== manifest.key.sha256
      || !/^[0-9a-f]{64}\n$/.test(vault.contents.toString('utf8'))) throw fail('key_integrity_mismatch');
    // Recheck every already-observed file. The external manifest pin is never
    // learned again from mutable bundle contents after a corruption control.
    for (const [filename, sample, options] of [[manifestPath, manifestFile, { max: 16384 }],
      [archivePath, dump, { min: 1024 }], [keyPath, vault, { min: 65, max: 65 }]]) {
      const after = await inspectFile(filename, options);
      if (after.bytes !== sample.bytes || after.sha256 !== sample.sha256
        || after.identity !== sample.identity) throw fail('file_changed');
    }
    await unchangedDirectories(samples);
    await noNativeReparse([...allPaths, manifestPath, archivePath, keyPath]);
    return Object.freeze({ state: 'BUNDLE_VERIFIED', manifest, archivePath, keyPath });
  } catch (error) {
    if (recoveryGuardFailureCode(error)) throw error;
    throw fail('readback_unconfirmed');
  }
}
