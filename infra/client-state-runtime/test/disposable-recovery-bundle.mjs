// TEST SUPPORT ONLY. All databases, keys and effects belong to fresh disposable
// fixtures. A successful run never grants installed or production authority.
import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startOwnedWindowsPostgres } from '../owned-postgres-process.mjs';
import { initializeLocalVaultKey } from '../local-vault-key.mjs';
import { secureAttachedPrivateFile } from '../attached-postgres-onboarding.mjs';
import { buildBackupEffectIntent, crossBackupEffectBarrier, readBackupEffectFence }
  from '../pg17-backup-effect-barrier.mjs';
import { executeDisposableOneShotPg17Dump } from '../pg17-one-shot-disposable-dump-executor.mjs';
import { verifyInstalledUpgradeBackup } from '../upgrade-backup-gate.mjs';
import { qualifyIndependentDisposableRestore } from '../upgrade-backup-restore-gate.mjs';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage }
  from '../../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';
import { readRecoveryFile, recoveryPathDigest, verifyRecoveryBundle }
  from './disposable-recovery-bundle-guard.mjs';
import { createRecoveryBundleReceipt, validateRecoveryBundleReceipt,
  RECOVERY_BUNDLE_BINARIES, RECOVERY_BUNDLE_PG_ARCHIVE_SHA256 }
  from './disposable-recovery-bundle-receipt.mjs';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const errors = new WeakMap();
const unknownUtilities = new WeakSet();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(code) {
  const error = new Error('recovery_bundle_' + code);
  errors.set(error, error.message);
  return error;
}
const requireProof = (condition, code) => { if (!condition) throw fail(code); };
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Never export child argv/environment/SQL/stderr/errors. A failed utility is
// not restarted. Only its own child handle may be terminated; postmasters use
// the existing ownership primitive. Output remains bounded and private.
async function command(binary, args, { env, input = '', timeoutMs = 30000,
  stage = 'utility', rejectWarnings = false } = {}) {
  return new Promise((resolve, reject) => {
    let child, settled = false, timer, size = 0, stderrBytes = 0;
    const stdout = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const abort = () => {
      try { child?.kill(); } catch { /* An uncertain utility stays failed. */ }
      const error = fail(stage + '_unconfirmed');
      unknownUtilities.add(error);
      finish(error);
    };
    try { child = spawn(binary, args, { env, shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { finish(fail(stage + '_spawn_failed')); return; }
    child.stdout.on('data', bytes => {
      size += bytes.length;
      if (size > 4 * 1024 * 1024) return abort();
      if (!settled) stdout.push(bytes);
    });
    child.stderr.on('data', bytes => {
      stderrBytes += bytes.length;
      if (stderrBytes > 65536) abort();
    });
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.once('error', abort);
    child.once('error', () => finish(fail(stage + '_spawn_failed')));
    child.once('close', (code, signal) => {
      if (code !== 0 || signal || (rejectWarnings && stderrBytes)) finish(fail(stage + '_failed'));
      else finish(null, Buffer.concat(stdout).toString('utf8'));
    });
    timer = setTimeout(abort, timeoutMs);
    child.stdin.end(input);
  });
}

function pgEnvironment(port, password) {
  const env = {};
  // No inherited PGOPTIONS/service/hostaddr/passfile redirection or credentials.
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC',
    'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  return { ...env, PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres',
    PGPASSWORD: password, PGDATABASE: 'postgres', PGSSLMODE: 'disable',
    PGCONNECT_TIMEOUT: '3', PGCLIENTENCODING: 'UTF8', PGTZ: 'UTC' };
}

async function portAvailable(port = 0) {
  const server = net.createServer();
  const selected = await new Promise((resolve, reject) => {
    server.once('error', () => reject(fail('port_unavailable')));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => resolve(server.address().port));
  });
  await new Promise((resolve, reject) => server.close(error => error
    ? reject(fail('port_release_unconfirmed')) : resolve()));
  requireProof(![55432, 55433, 55434].includes(selected), 'reserved_port_refused');
  return selected;
}

async function sql(bin, env, input) {
  return (await command(path.join(bin, 'psql.exe'), [
    '-X', '-qAt', '--no-password', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '--file=-',
  ], { env, input, stage: 'sql', timeoutMs: 30000 })).trim();
}

async function privateWrite(filename, bytes) {
  const handle = await fs.open(filename, 'wx', 0o600);
  try {
    await secureAttachedPrivateFile(filename); // Protect while still empty.
    await handle.writeFile(bytes); await handle.sync();
  } finally { await handle.close(); }
}

async function powershell(program, extraEnv, stage, timeoutMs = 45000) {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || '';
  requireProof(/^[A-Za-z]:\\Windows$/i.test(systemRoot), 'windows_root_unconfirmed');
  return command(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')],
    { env: { ...pgEnvironment(60000, ''), ...extraEnv,
      PSModulePath: path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') },
    stage, timeoutMs, rejectWarnings: true });
}

// Use the existing native verifier without injected observations, then perform
// a narrower fixture-only readback of protection and non-inherited key grants.
async function verifyPrivateKeys(files) {
  for (const file of files) {
    requireProof((await verifyOwnerOnlyWindowsStorage(file, {
      operation: 'VERIFY_PRIVATE_FILE',
    })).owner_dacl_verified === true, 'key_dacl_unknown');
    await readRecoveryFile(file);
  }
  const program = `$ErrorActionPreference='Stop'
$me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@($me,'S-1-5-18')|Select-Object -Unique
foreach($file in ($env:METAENGINE_RECOVERY_KEY_FILES|ConvertFrom-Json)) {
  $item=Get-Item -LiteralPath $file -Force
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'type' }
  $acl=Get-Acl -LiteralPath $file
  if(-not $acl.AreAccessRulesProtected) { throw 'inheritance' }
  $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if($owner -notin @($me,'S-1-5-18','S-1-5-32-544')) { throw 'owner' }
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  foreach($rule in $rules) {
    if($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $rule.IdentityReference.Value -notin $allowed) { throw 'grant' }
    $required=if($rule.IdentityReference.Value -eq $me){[Security.AccessControl.FileSystemRights]::ReadData -bor [Security.AccessControl.FileSystemRights]::WriteData}else{[Security.AccessControl.FileSystemRights]::FullControl}
    if(($rule.FileSystemRights -band $required) -ne $required) { throw 'rights' }
  }
  foreach($sid in $allowed) { if(-not @($rules|Where-Object{$_.IdentityReference.Value -eq $sid}).Count) { throw 'missing' } }
}
[Console]::Out.Write('VERIFIED')`;
  const output = await powershell(program, { METAENGINE_RECOVERY_KEY_FILES: JSON.stringify(files) }, 'key_dacl');
  requireProof(output === 'VERIFIED', 'key_dacl_unknown');
}

// Recheck the preparer's actual pinned ZIP, then compare every extracted
// bin/lib/share file, including pgcrypto and DLLs. A version string or a caller
// supplied staging receipt is insufficient to qualify the executed binaries.
async function qualifyPinnedBinaries(pgBinDir) {
  requireProof(typeof pgBinDir === 'string' && path.isAbsolute(pgBinDir), 'pg_bin_required');
  const bin = await fs.realpath(pgBinDir);
  requireProof(samePath(bin, pgBinDir) && path.basename(bin) === 'bin'
    && path.basename(path.dirname(bin)) === 'pgsql', 'pg_bin_layout_invalid');
  const extraction = path.dirname(path.dirname(bin));
  requireProof(path.basename(extraction) === 'postgresql', 'pg_bin_layout_invalid');
  const archive = path.join(path.dirname(extraction), 'archives', 'postgresql-17.11-1-windows-x64-binaries.zip');
  const before = await readRecoveryFile(archive);
  requireProof(before.sha256 === RECOVERY_BUNDLE_PG_ARCHIVE_SHA256, 'pg_archive_digest_mismatch');
  const program = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=$env:METAENGINE_RECOVERY_PG_EXTRACT
$zip=[IO.Compression.ZipFile]::OpenRead($env:METAENGINE_RECOVERY_PG_ARCHIVE)
$expected=@{}; $binaries=@{}
function Digest($stream) { $h=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($h.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $h.Dispose() } }
try {
  foreach($entry in $zip.Entries) {
    $name=$entry.FullName.Replace('\\','/')
    if($name -notmatch '^pgsql/(bin|lib|share)/' -or $name.EndsWith('/')) { continue }
    if($name.Contains(':') -or ($name.Split('/')|Where-Object{$_ -eq '..' -or $_ -eq '.' -or !$_}) -or $expected.ContainsKey($name.ToLowerInvariant())) { throw 'entry' }
    $expected[$name.ToLowerInvariant()]=$true
    $file=Join-Path $root $name
    $item=Get-Item -LiteralPath $file -Force
    if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -ne $entry.Length) { throw 'file' }
    $zs=$entry.Open(); try { $wanted=Digest $zs } finally { $zs.Dispose() }
    $fs=[IO.File]::OpenRead($file); try { $actual=Digest $fs } finally { $fs.Dispose() }
    if($actual -ne $wanted) { throw 'digest' }
    if($name -match '^pgsql/bin/(initdb|postgres|pg_ctl|pg_isready|psql|pg_dump|pg_restore)\\.exe$') { $binaries[$Matches[1]]=$actual }
  }
  $seen=0; $pending=[Collections.Generic.Stack[string]]::new(); $pending.Push($root)
  while($pending.Count) {
    $dir=$pending.Pop(); $item=Get-Item -LiteralPath $dir -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'alias' }
    foreach($child in (Get-ChildItem -LiteralPath $dir -Force)) {
      if($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'alias' }
      if($child.PSIsContainer) { $pending.Push($child.FullName) } else {
        $relative=$child.FullName.Substring($root.Length+1).Replace('\\','/').ToLowerInvariant()
        if(-not $expected.ContainsKey($relative)) { throw 'extra' }; $seen++
      }
    }
  }
  if($seen -ne $expected.Count -or $binaries.Count -ne 7) { throw 'inventory' }
  $binaries|ConvertTo-Json -Compress
} finally { $zip.Dispose() }`;
  let observed;
  try { observed = JSON.parse(await powershell(program, {
    METAENGINE_RECOVERY_PG_EXTRACT: extraction, METAENGINE_RECOVERY_PG_ARCHIVE: archive,
  }, 'pg_inventory', 120000)); } catch (error) { throw errors.has(error) ? error : fail('pg_inventory_invalid'); }
  const hashes = {};
  for (const name of RECOVERY_BUNDLE_BINARIES) {
    const file = path.join(bin, name + '.exe');
    const info = await readRecoveryFile(file);
    requireProof(info.sha256 === observed[name], 'pg_binary_digest_mismatch');
    const version = await command(file, ['--version'], { env: pgEnvironment(60000, ''),
      stage: 'pg_version', rejectWarnings: true, timeoutMs: 15000 });
    requireProof(version.trim() === name + ' (PostgreSQL) 17.11', 'pg_version_mismatch');
    hashes[name] = info.sha256;
  }
  requireProof((await readRecoveryFile(archive)).sha256 === before.sha256, 'pg_archive_changed');
  return { bin, hashes };
}

async function initializeCluster(root, bin, password) {
  await fs.mkdir(root);
  const passwordFile = path.join(root, 'initdb-password');
  await privateWrite(passwordFile, password);
  const data = path.join(root, 'cluster');
  await command(path.join(bin, 'initdb.exe'), ['-D', data, '--username=postgres',
    '--auth=scram-sha-256', '--pwfile=' + passwordFile, '--encoding=UTF8', '--no-locale'],
  { env: pgEnvironment(60000, password), stage: 'initdb', timeoutMs: 120000 });
  // Even failing secret-bearing stdin SQL must not reach a server statement log.
  await fs.appendFile(path.join(data, 'postgresql.conf'), "\nlog_statement='none'\n"
    + "log_min_error_statement='panic'\nlog_parameter_max_length=0\n"
    + "log_parameter_max_length_on_error=0\nlog_min_duration_statement=-1\n"
    + "log_min_duration_sample=-1\nlog_transaction_sample_rate=0\n"
    + "log_error_verbosity='terse'\ntimezone='UTC'\n");
  await fs.unlink(passwordFile);
  return fs.realpath(data);
}

async function clusterIdentity(bin, env, owned) {
  await owned.verify();
  const raw = await sql(bin, env, `SELECT json_build_object('system_identifier',
    (SELECT system_identifier::text FROM pg_control_system()), 'port',inet_server_port(),
    'version',current_setting('server_version_num')::int,'data_directory',current_setting('data_directory'),
    'host',host(inet_server_addr()),'started_at',pg_postmaster_start_time())::text;`);
  let value;
  try { value = JSON.parse(raw); } catch { throw fail('cluster_identity_invalid'); }
  requireProof(value.version === 170011 && value.host === '127.0.0.1'
    && value.port === owned.databasePort && samePath(value.data_directory, owned.pgDataDir)
    && /^[1-9][0-9]{9,19}$/.test(value.system_identifier)
    && Number.isFinite(Date.parse(value.started_at)), 'cluster_identity_invalid');
  return { dataDirectory: owned.pgDataDir, port: value.port, pid: owned.pid,
    systemIdentifier: value.system_identifier, startedAt: value.started_at };
}

function publicIdentity(value) {
  return { system_identifier: value.systemIdentifier, pid: value.pid, port: value.port,
    pgdata_sha256: recoveryPathDigest(value.dataDirectory) };
}

const snapshotSql = `SELECT json_build_object(
  'probe', (SELECT json_agg(json_build_array(id,body,encode(payload,'hex')) ORDER BY id) FROM public.recovery_probe),
  'vault', (SELECT json_agg(json_build_array(id::text,name,description,secret,key_id::text,encode(nonce,'hex'),created_at::text,updated_at::text) ORDER BY id) FROM vault.secrets),
  'sequences', (SELECT json_agg(json_build_array(c.relname,p.seqstart::text,p.seqincrement::text,
    p.seqmin::text,p.seqmax::text,p.seqcache::text,p.seqcycle,s.last_value,s.is_called) ORDER BY c.relname)
    FROM pg_sequence p JOIN pg_class c ON c.oid=p.seqrelid JOIN (
      SELECT 'recovery_counter' AS name,last_value::text,is_called FROM public.recovery_counter UNION ALL
      SELECT 'recovery_uncalled',last_value::text,is_called FROM public.recovery_uncalled
    ) s ON s.name=c.relname WHERE c.relnamespace='public'::regnamespace)
)::text;`;

async function snapshot(bin, env) {
  let value;
  try { value = JSON.parse(await sql(bin, env, snapshotSql)); }
  catch (error) { throw errors.has(error) ? error : fail('snapshot_invalid'); }
  requireProof(Array.isArray(value?.probe) && value.probe.length === 4
    && Array.isArray(value?.vault) && value.vault.length === 1
    && Array.isArray(value?.sequences) && value.sequences.length === 2, 'snapshot_incomplete');
  return { content: sha(JSON.stringify([value.probe, value.vault])),
    sequences: sha(JSON.stringify(value.sequences)), count: value.probe.length,
    probe: sha(JSON.stringify(value.probe)), sequenceValues: value.sequences };
}

function compareSnapshot(expected, actual) {
  requireProof(expected.count === actual.count && expected.content === actual.content, 'content_mismatch');
  requireProof(expected.sequences === actual.sequences, 'sequence_mismatch');
}

async function decryptWitness(bin, env, expectedDigest) {
  const result = await sql(bin, env, `SELECT encode(extensions.digest(convert_to(decrypted_secret,'UTF8'),
    'sha256'),'hex') FROM vault.decrypted_secrets WHERE name='recovery_fixture';`);
  requireProof(/^[a-f0-9]{64}$/.test(result) && result === expectedDigest, 'vault_decrypt_mismatch');
}

async function expectRejected(operation, allowed) {
  try { await operation(); } catch (error) {
    const code = errors.get(error) || error?.code;
    requireProof(typeof code === 'string' && allowed.test(code), 'negative_rejection_unconfirmed');
    return;
  }
  throw fail('negative_accepted');
}

async function bundleNegatives(options, receipt) {
  // Corrupt new copies, never the positive archive/key or either PGDATA.
  const { fixtureRoot, bundleDirectory, keyDirectory } = options;
  const archiveBytes = await fs.readFile(path.join(bundleDirectory, 'postgresql-17-snapshot.dump'));
  const keyBytes = await fs.readFile(path.join(keyDirectory, 'client-vault.key'));
  const manifestBytes = await fs.readFile(path.join(bundleDirectory, 'manifest.json'));
  async function scenario(name, expectedCode, mutate) {
    const directory = path.join(fixtureRoot, 'negative-' + name);
    await fs.mkdir(directory);
    const bundle = path.join(directory, 'bundle'), keys = path.join(directory, 'key');
    await fs.mkdir(bundle); await fs.mkdir(keys);
    await privateWrite(path.join(bundle, 'postgresql-17-snapshot.dump'), archiveBytes);
    await privateWrite(path.join(bundle, 'manifest.json'), manifestBytes);
    await privateWrite(path.join(keys, 'client-vault.key'), keyBytes);
    const altered = { ...options, bundleDirectory: bundle, keyDirectory: keys };
    await verifyRecoveryBundle(altered);
    await mutate(altered);
    await expectRejected(() => verifyRecoveryBundle(altered), new RegExp('^' + expectedCode + '$'));
    receipt.negatives[name] = 'REJECTED';
  }
  requireProof(archiveBytes.length > 1024, 'archive_control_too_small');
  await scenario('truncated_dump', 'recovery_bundle_dump_integrity_mismatch', async o => fs.truncate(path.join(o.bundleDirectory,
    'postgresql-17-snapshot.dump'), 1024));
  await scenario('substituted_dump', 'recovery_bundle_dump_integrity_mismatch', async o => {
    const bytes = Buffer.from(archiveBytes); bytes[bytes.length - 1] ^= 0x7f;
    await fs.writeFile(path.join(o.bundleDirectory, 'postgresql-17-snapshot.dump'), bytes);
  });
  await scenario('missing_key', 'recovery_bundle_key_missing', async o => fs.unlink(path.join(o.keyDirectory, 'client-vault.key')));
  await scenario('substituted_key', 'recovery_bundle_key_integrity_mismatch', async o => fs.writeFile(path.join(o.keyDirectory,
    'client-vault.key'), randomBytes(32).toString('hex') + '\n'));
  await scenario('invalid_manifest', 'recovery_bundle_manifest_digest_mismatch', async o => {
    const bytes = Buffer.from(archiveBytes); bytes[bytes.length - 2] ^= 0x3f;
    await fs.writeFile(path.join(o.bundleDirectory, 'postgresql-17-snapshot.dump'), bytes);
    const manifest = JSON.parse(manifestBytes);
    manifest.dump.sha256 = sha(bytes);
    await fs.writeFile(path.join(o.bundleDirectory, 'manifest.json'), JSON.stringify(manifest));
  });
  for (const [name, target, code] of [
    ['source_pgdata', { ...options.target, dataDirectory: options.source.dataDirectory }, 'paths_not_disjoint'],
    ['source_port', { ...options.target, port: options.source.port }, 'target_not_distinct'],
  ]) {
    await expectRejected(() => verifyRecoveryBundle({ ...options, target }), new RegExp('^recovery_bundle_' + code + '$'));
    receipt.negatives[name] = 'REJECTED';
  }
  await scenario('junction', 'recovery_bundle_directory_alias', async o => {
    const junction = path.join(fixtureRoot, 'actual-windows-junction');
    await fs.symlink(o.keyDirectory, junction, 'junction');
    o.keyDirectory = junction;
  });
  await scenario('hardlink', 'recovery_bundle_file_untrusted', async o => {
    await fs.link(path.join(o.keyDirectory, 'client-vault.key'), path.join(fixtureRoot, 'actual-key-hardlink'));
  });
  keyBytes.fill(0);
}

export async function runDisposableRecoveryBundle({ pgBinDir = process.env.LOCAL_STATE_TEST_PG_BIN_DIR,
  sourceSha = process.env.EXPECTED_SHA } = {}) {
  requireProof(typeof sourceSha === 'string' && /^[a-f0-9]{40}$/.test(sourceSha), 'expected_source_required');
  const receipt = createRecoveryBundleReceipt({ sourceSha,
    runId: process.env.GITHUB_RUN_ID || 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT || 'local' });
  let stage = 'preflight', root, source, target, sourceIdentity, targetBefore, targetAfter;
  let cleanupUnknown = false, failed = null, effectContext = null;
  const handles = [], stopAttempts = new Set(), stopped = new Set(), ports = new Set();
  async function stopOnce(owned) {
    requireProof(!stopAttempts.has(owned), 'cleanup_already_attempted');
    stopAttempts.add(owned);
    try {
      requireProof((await owned.stop()).cleanup_confirmed === true, 'cleanup_unconfirmed');
      requireProof(await owned.isAlive() === false, 'cleanup_unconfirmed');
      await portAvailable(owned.databasePort);
      stopped.add(owned);
    } catch { cleanupUnknown = true; throw fail('cleanup_unconfirmed'); }
  }
  try {
    requireProof(process.platform === 'win32' && process.arch === 'x64', 'windows_x64_required');
    const actualHead = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
    requireProof(actualHead === sourceSha, 'source_mismatch');
    await exec('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: repository });
    const changes = (await exec('git', ['status', '--porcelain', '--untracked-files=all'],
      { cwd: repository, maxBuffer: 1024 * 1024 })).stdout;
    requireProof(changes === '', 'source_worktree_not_clean');
    stage = 'binaries';
    const { bin, hashes } = await qualifyPinnedBinaries(pgBinDir);
    receipt.pg_version = '17.11'; receipt.pg_archive_sha256 = RECOVERY_BUNDLE_PG_ARCHIVE_SHA256;
    receipt.binaries_sha256 = hashes; receipt.observations.pinned_binaries_verified = true;
    stage = 'initialize';
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-recovery-bundle-')));
    await protectOwnerOnlyWindowsDirectory(root);
    const sourcePassword = randomBytes(32).toString('hex'), targetPassword = randomBytes(32).toString('hex');
    const from = await initializeCluster(path.join(root, 'source'), bin, sourcePassword);
    const to = await initializeCluster(path.join(root, 'target'), bin, targetPassword);
    const sourcePort = await portAvailable(), targetPort = await portAvailable();
    requireProof(sourcePort !== targetPort, 'ports_not_distinct');
    ports.add(sourcePort); ports.add(targetPort);
    const sourceEnv = pgEnvironment(sourcePort, sourcePassword), targetEnv = pgEnvironment(targetPort, targetPassword);
    const vault = await initializeLocalVaultKey({ dataDirectory: from });
    requireProof(vault.created === true && vault.plaintext_key_logged === false, 'source_key_not_fresh');
    const sourceKey = vault.key_file;
    const originalKey = await readRecoveryFile(sourceKey);
    await verifyPrivateKeys([sourceKey]);
    stage = 'source_start';
    source = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: from,
      databasePort: sourcePort, env: sourceEnv, startupTimeoutMs: 60000 });
    handles.push(source);
    sourceIdentity = await clusterIdentity(bin, sourceEnv, source);
    stage = 'seed';
    await sql(bin, sourceEnv, 'CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
    await sql(bin, sourceEnv, await fs.readFile(new URL('../local-vault-compat.sql', import.meta.url), 'utf8'));
    const plaintext = Buffer.from('generated-' + randomBytes(32).toString('hex') + '-\u2603', 'utf8');
    const plaintextDigest = sha(plaintext);
    const expectedProbe = [
      [1, 'Unicode: \u041f\u0440\u0438\u0432\u0435\u0442 \u4e16\u754c \ud83c\udf0d e\u0301', '00017f80feff'],
      [2, null, '00ff0000'], [3, '', ''], [4, 'line\n\ttab', null],
    ];
    const textValue = value => value === null ? 'NULL'
      : "convert_from(decode('" + Buffer.from(value, 'utf8').toString('hex') + "','hex'),'UTF8')";
    const tuples = expectedProbe.map(([id, body, payload]) => '(' + id + ',' + textValue(body) + ','
      + (payload === null ? 'NULL' : "decode('" + payload + "','hex')") + ')').join(',');
    await sql(bin, sourceEnv, `BEGIN;
      SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic';
      CREATE TABLE public.recovery_probe(id integer PRIMARY KEY,body text,payload bytea);
      INSERT INTO public.recovery_probe VALUES ${tuples};
      CREATE SEQUENCE public.recovery_counter AS bigint INCREMENT BY 17 MINVALUE -1000 MAXVALUE 1000000 START WITH 37 CACHE 1 NO CYCLE;
      CREATE SEQUENCE public.recovery_uncalled AS bigint INCREMENT BY -3 MINVALUE -1000 MAXVALUE 1000 START WITH 100 CACHE 1 CYCLE;
      SELECT setval('public.recovery_counter',901,true); SELECT setval('public.recovery_uncalled',88,false);
      DO $fixture$ BEGIN PERFORM vault.create_secret(convert_from(decode('${plaintext.toString('hex')}','hex'),'UTF8'),'recovery_fixture'); END $fixture$;
      COMMIT;`);
    plaintext.fill(0);
    const baseline = await snapshot(bin, sourceEnv);
    requireProof(baseline.probe === sha(JSON.stringify(expectedProbe)), 'fixture_seed_mismatch');
    requireProof(JSON.stringify(baseline.sequenceValues) === JSON.stringify([
      ['recovery_counter', '37', '17', '-1000', '1000000', '1', false, '901', true],
      ['recovery_uncalled', '100', '-3', '-1000', '1000', '1', true, '88', false],
    ]), 'fixture_sequence_mismatch');
    await decryptWitness(bin, sourceEnv, plaintextDigest);
    receipt.content_sha256 = baseline.content; receipt.sequence_sha256 = baseline.sequences;
    const bundle = path.join(root, 'bundle'), keys = path.join(root, 'protected-key');
    await fs.mkdir(bundle); await fs.mkdir(keys);
    await protectOwnerOnlyWindowsDirectory(bundle); await protectOwnerOnlyWindowsDirectory(keys);
    const archivePath = path.join(bundle, 'postgresql-17-snapshot.dump');
    const intent = buildBackupEffectIntent({ ownerPid: process.pid, keeperPid: source.pid,
      sourceHead: sourceSha, ownerSha256: (await readRecoveryFile(process.execPath)).sha256,
      postmasterSha256: hashes.postgres, archivePath });
    stage = 'backup';
    effectContext = { journalDirectory: bundle, intentId: intent.intent_id };
    // One physical pg_dump followed by deliberately losing its acknowledgement.
    // Discard the return value: subsequent proof uses independent file/SQL reads.
    // The fence stays UNKNOWN, never a successful installed backup/retry grant.
    receipt.dump_invocations++;
    await expectRejected(async () => {
      await executeDisposableOneShotPg17Dump({ intent, journalDirectory: bundle, pgBinDir: bin,
        expectedPgDumpSha256: hashes.pg_dump, sourceDataDirectory: from,
        sourcePort, connectionEnv: sourceEnv });
      throw fail('backup_ack_lost');
    }, /^recovery_bundle_backup_ack_lost$/);
    const fence = await readBackupEffectFence({ journalDirectory: bundle, intentId: intent.intent_id });
    requireProof(fence.state === 'EFFECT_UNKNOWN' && fence.automatic_retry_allowed === false, 'backup_fence_lost');
    receipt.backup_effect_state = fence.state;
    await expectRejected(() => crossBackupEffectBarrier({ journalDirectory: bundle, intent }),
      /^backup_effect_(archive_existing|write_ambiguous)$/);
    receipt.negatives.lost_backup_ack = 'REJECTED';
    receipt.observations.backup_effect_once = true;
    await secureAttachedPrivateFile(archivePath);
    const archive = await readRecoveryFile(archivePath);
    const toc = await command(path.join(bin, 'pg_restore.exe'), ['--list', archivePath],
      { env: targetEnv, stage: 'toc', rejectWarnings: true });
    requireProof(/TABLE DATA public recovery_probe/.test(toc) && /TABLE DATA vault secrets/.test(toc)
      && /SEQUENCE SET public recovery_counter/.test(toc) && /SEQUENCE SET public recovery_uncalled/.test(toc),
    'archive_toc_incomplete');
    const backupKeyPath = path.join(keys, 'client-vault.key');
    const keyBytes = await fs.readFile(sourceKey);
    try { await privateWrite(backupKeyPath, keyBytes); } finally { keyBytes.fill(0); }
    requireProof((await readRecoveryFile(backupKeyPath)).sha256 === originalKey.sha256, 'backup_key_mismatch');
    const manifest = { schema: 'metaengine.disposable-recovery-bundle.manifest.v1',
      evidence_class: 'SYNTHETIC/STAGING', source_sha: sourceSha, source: publicIdentity(sourceIdentity),
      dump: { file: 'postgresql-17-snapshot.dump', sha256: archive.sha256, bytes: archive.bytes },
      key: { file: 'client-vault.key', sha256: originalKey.sha256, bytes: originalKey.bytes },
      fixture: { content_sha256: baseline.content, sequence_sha256: baseline.sequences },
      automatic_retry_allowed: false, installed_backup_verified: false,
      upgrade_authorized: false, production_authorized: false };
    const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\n');
    const expectedManifestSha256 = sha(manifestBytes); // Independent immutable pin.
    await privateWrite(path.join(bundle, 'manifest.json'), manifestBytes);
    await verifyPrivateKeys([sourceKey, backupKeyPath, archivePath, path.join(bundle, 'manifest.json')]);
    receipt.archive_sha256 = archive.sha256; receipt.key_sha256 = originalKey.sha256;
    receipt.manifest_sha256 = expectedManifestSha256;
    stage = 'target_start';
    target = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: to,
      databasePort: targetPort, env: targetEnv, startupTimeoutMs: 60000 });
    handles.push(target);
    targetBefore = await clusterIdentity(bin, targetEnv, target);
    let options = { fixtureRoot: root, bundleDirectory: bundle, keyDirectory: keys,
      expectedManifestSha256, expectedSourceHead: sourceSha, source: sourceIdentity, target: targetBefore };
    stage = 'negative_integrity';
    await verifyRecoveryBundle(options);
    await bundleNegatives(options, receipt);
    stage = 'restore';
    const verified = await verifyRecoveryBundle(options);
    receipt.observations.distinct_clusters = true;
    const targetKey = path.join(to, 'client-vault.key');
    const restoredKeyBytes = await fs.readFile(verified.keyPath);
    try { await privateWrite(targetKey, restoredKeyBytes); } finally { restoredKeyBytes.fill(0); }
    await verifyPrivateKeys([sourceKey, backupKeyPath, targetKey, archivePath, path.join(bundle, 'manifest.json')]);
    requireProof((await readRecoveryFile(targetKey)).sha256 === originalKey.sha256, 'restored_key_mismatch');
    await source.verify(); await target.verify();
    await verifyRecoveryBundle(options);
    receipt.restore_invocations++;
    await command(path.join(bin, 'pg_restore.exe'), ['--exit-on-error', '--single-transaction',
      '--no-owner', '--no-acl', '--no-password', '--dbname=postgres', '--host=127.0.0.1',
      '--port=' + targetPort, '--username=postgres', verified.archivePath],
    { env: targetEnv, stage: 'restore', rejectWarnings: true, timeoutMs: 90000 });
    compareSnapshot(baseline, await snapshot(bin, targetEnv));
    await decryptWitness(bin, targetEnv, plaintextDigest);
    receipt.observations.content_matched = true; receipt.observations.sequence_matched = true;
    receipt.observations.vault_decrypted = true;
    stage = 'cold_restart';
    const firstTarget = target;
    await stopOnce(firstTarget);
    target = null;
    target = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: to,
      databasePort: targetPort, env: targetEnv, startupTimeoutMs: 60000 });
    handles.push(target);
    targetAfter = await clusterIdentity(bin, targetEnv, target);
    requireProof(targetAfter.systemIdentifier === targetBefore.systemIdentifier
      && targetAfter.pid !== targetBefore.pid && targetAfter.startedAt !== targetBefore.startedAt
      && target.processCreatedAt !== firstTarget.processCreatedAt, 'cold_restart_unconfirmed');
    receipt.clusters = { source: publicIdentity(sourceIdentity),
      target_before_restart: publicIdentity(targetBefore), target_after_restart: publicIdentity(targetAfter) };
    receipt.observations.cold_restart_verified = true;
    compareSnapshot(baseline, await snapshot(bin, targetEnv));
    await decryptWitness(bin, targetEnv, plaintextDigest);
    receipt.observations.post_restart_content_matched = true;
    receipt.observations.post_restart_sequence_matched = true;
    receipt.observations.post_restart_vault_decrypted = true;
    options = { ...options, target: targetAfter };
    await verifyRecoveryBundle(options);
    stage = 'final_readback';
    await verifyPrivateKeys([sourceKey, backupKeyPath, targetKey, archivePath, path.join(bundle, 'manifest.json')]);
    receipt.observations.windows_dacl_verified = true;
    for (const file of [sourceKey, backupKeyPath, targetKey]) {
      requireProof((await readRecoveryFile(file)).sha256 === originalKey.sha256, 'key_changed');
    }
    receipt.observations.key_unchanged = true;
    // Consume only the target sequences after both state comparisons. Source
    // nextval is never called. These are intentional target-only test effects.
    requireProof(await sql(bin, targetEnv, "SELECT nextval('public.recovery_counter')::text || ':' || nextval('public.recovery_uncalled')::text;")
      === '918:88', 'next_sequence_values_mismatch');
    receipt.observations.next_sequence_values_matched = true;
    await sql(bin, targetEnv, "UPDATE public.recovery_probe SET body='changed-fixture-cell' WHERE id=2;");
    const changed = await snapshot(bin, targetEnv);
    requireProof(changed.count === baseline.count && changed.content !== baseline.content,
      'equal_count_control_invalid');
    await expectRejected(async () => compareSnapshot(baseline, changed), /^recovery_bundle_content_mismatch$/);
    receipt.negatives.equal_count_changed_content = 'REJECTED';
    compareSnapshot(baseline, await snapshot(bin, sourceEnv));
    const sourceAfter = await clusterIdentity(bin, sourceEnv, source);
    requireProof(sourceAfter.systemIdentifier === sourceIdentity.systemIdentifier
      && sourceAfter.startedAt === sourceIdentity.startedAt && sourceAfter.pid === sourceIdentity.pid,
    'source_incarnation_changed');
    await decryptWitness(bin, sourceEnv, plaintextDigest);
    receipt.observations.source_unchanged = true;
    // Existing production consumers receive the actual fixture schema as a
    // rejection control, never a fabricated installed-backup receipt.
    const installed = await verifyInstalledUpgradeBackup({ receipt });
    const restore = qualifyIndependentDisposableRestore({ receipt });
    requireProof(installed.reason === 'STAGING_BACKUP_CANNOT_QUALIFY_INSTALLED'
      && installed.backup_verified === false && installed.upgrade_authorized === false
      && restore.physical_restore_proven === false && restore.restore_verified === false
      && restore.upgrade_authorized === false, 'production_gate_boundary_changed');
    requireProof((await readBackupEffectFence({ journalDirectory: bundle, intentId: intent.intent_id })).state
      === 'EFFECT_UNKNOWN', 'backup_fence_changed');
    for (const name of RECOVERY_BUNDLE_BINARIES) {
      requireProof((await readRecoveryFile(path.join(bin, name + '.exe'))).sha256 === hashes[name],
        'pg_binary_changed');
    }
  } catch (error) {
    if (error?.code === 'runtime_cleanup_unconfirmed' || unknownUtilities.has(error)
      || stage === 'backup') cleanupUnknown = true;
    if (effectContext) {
      try { receipt.backup_effect_state = (await readBackupEffectFence(effectContext)).state; }
      catch { receipt.backup_effect_state = 'READBACK_UNKNOWN'; }
    }
    failed = errors.get(error) || 'recovery_bundle_' + stage + '_failed';
  } finally {
    for (const owned of [...handles].reverse()) {
      if (stopAttempts.has(owned)) continue; // Never retry an ambiguous stop.
      try { await stopOnce(owned); } catch { cleanupUnknown = true; }
    }
    receipt.observations.postmasters_stopped = !cleanupUnknown && handles.length === 3
      && handles.every(owned => stopped.has(owned));
    try {
      for (const port of ports) await portAvailable(port);
      receipt.observations.ports_released = !cleanupUnknown && ports.size === 2;
    } catch { cleanupUnknown = true; receipt.observations.ports_released = false; }
    if (root && !cleanupUnknown && handles.every(owned => stopped.has(owned))) {
      try { await fs.rm(root, { recursive: true, force: false, maxRetries: 0 }); }
      catch { cleanupUnknown = true; }
    }
  }
  if (cleanupUnknown) failed = 'recovery_bundle_cleanup_unconfirmed';
  if (!failed) {
    // Remove one real cleanup witness: the final classifier must reject it.
    const unknown = structuredClone(receipt);
    unknown.status = 'PASS'; unknown.error_code = null;
    unknown.negatives.unknown_cleanup = 'REJECTED';
    unknown.observations.postmasters_stopped = false;
    try {
      await expectRejected(async () => validateRecoveryBundleReceipt(unknown, {
        expectedSourceSha: sourceSha, requirePass: true,
      }), /^recovery_receipt_observation_unproven$/);
      receipt.negatives.unknown_cleanup = 'REJECTED';
      receipt.status = 'PASS'; receipt.error_code = null;
      return validateRecoveryBundleReceipt(receipt, { expectedSourceSha: sourceSha, requirePass: true });
    } catch { failed = 'recovery_bundle_final_proof_incomplete'; }
  }
  receipt.status = 'FAIL'; receipt.error_code = failed;
  return validateRecoveryBundleReceipt(receipt, { expectedSourceSha: sourceSha });
}
