import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
const same = (left, right) => left.toLowerCase() === right.toLowerCase();
const failure = code => Object.assign(new Error(code), { code });
const maximumDiagnosticBytes = 32768;

async function regularFile(filename) {
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw failure('owned_postgres_executable_invalid');
  return fs.realpath(filename);
}

async function canonicalDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || /^(?:\\\\|\/\/)/.test(directory)) throw failure('owned_postgres_data_directory_invalid');
  const resolved = path.resolve(directory);
  let current = path.parse(resolved).root;
  for (const part of path.relative(current, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw failure('owned_postgres_data_directory_invalid');
  }
  return fs.realpath(resolved);
}

// Parse the Windows argv quoting used by pg_ctl's CreateRestrictedProcess.
// A path substring is insufficient: a different database can mention an owned
// path in an unrelated option while running from its own -D directory.
export function windowsPostgresCommandMatches(commandLine, { postgresExecutable, pgDataDir, databasePort }) {
  if (typeof commandLine !== 'string' || commandLine.length > 32768) return false;
  const args = [];
  let offset = 0;
  while (offset < commandLine.length) {
    while (/\s/.test(commandLine[offset] || '') && offset < commandLine.length) offset++;
    if (offset >= commandLine.length) break;
    let argument = '';
    let quoted = false;
    while (offset < commandLine.length && (quoted || !/\s/.test(commandLine[offset]))) {
      let slashes = 0;
      while (commandLine[offset] === '\\') { slashes++; offset++; }
      if (commandLine[offset] === '"') {
        argument += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) argument += '"';
        else if (quoted && commandLine[offset + 1] === '"') { argument += '"'; offset++; }
        else quoted = !quoted;
        offset++;
      } else {
        argument += '\\'.repeat(slashes);
        if (offset < commandLine.length) argument += commandLine[offset++];
      }
    }
    if (quoted) return false;
    args.push(argument);
  }
  const expected = [postgresExecutable, '-D', pgDataDir, '-h', '127.0.0.1', '-p', String(databasePort)];
  return args.length === expected.length && args.every((argument, index) =>
    index === 0 || index === 2 ? same(path.win32.normalize(argument), path.win32.normalize(expected[index])) : argument === expected[index]);
}

async function processRecord(pid, env, timeoutMs = 10000) {
  const powershell = path.join(env.SystemRoot || env.SYSTEMROOT || process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Only a validated numeric PID enters this program. Process paths and
  // command output remain private and never become public error messages.
  const program = `$ErrorActionPreference='Stop'; $ownedPgProcess=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop; if ($null -eq $ownedPgProcess) { [Console]::Out.Write('null'); exit 0 }; [pscustomobject]@{pid=[int]$ownedPgProcess.ProcessId; executable=[string]$ownedPgProcess.ExecutablePath; command_line=[string]$ownedPgProcess.CommandLine; created_at=$ownedPgProcess.CreationDate.ToUniversalTime().ToString('O')} | ConvertTo-Json -Compress`;
  try {
    const result = await exec(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', program],
      { env, shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: maximumDiagnosticBytes });
    const record = JSON.parse(result.stdout);
    if (record === null) return null;
    if (record.pid !== pid || typeof record.executable !== 'string' || !record.executable
      || typeof record.command_line !== 'string' || !record.command_line
      || typeof record.created_at !== 'string' || !Number.isFinite(Date.parse(record.created_at))) {
      throw failure('owned_postgres_process_inventory_unavailable');
    }
    return record;
  } catch { throw failure('owned_postgres_process_inventory_unavailable'); }
}

async function portClosed(port, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); reject(failure('owned_postgres_port_probe_unconfirmed')); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
    socket.once('error', error => {
      clearTimeout(timer);
      socket.destroy();
      error.code === 'ECONNREFUSED' ? resolve(true) : reject(failure('owned_postgres_port_probe_unconfirmed'));
    });
  });
}

async function pidFileIdentity(filename, dataDirectory, databasePort) {
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8192) throw failure('owned_postgres_pid_file_invalid');
  const lines = (await fs.readFile(filename, 'utf8')).trim().split(/\r?\n/);
  const pid = Number(lines[0]);
  const started = Number(lines[2]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid
    || !Number.isSafeInteger(started) || started <= 0 || Number(lines[3]) !== databasePort
    || !same(await fs.realpath(lines[1]), dataDirectory)) throw failure('owned_postgres_pid_file_invalid');
  return { pid, postmasterStartIdentity: lines[2], status: lines[7] };
}

async function boundedPrivateDiagnostics(logFile) {
  try {
    const info = await fs.lstat(logFile);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) return null;
    const handle = await fs.open(logFile, 'r');
    try {
      const length = Math.min(info.size, maximumDiagnosticBytes);
      const bytes = Buffer.alloc(length);
      const { bytesRead } = await handle.read(bytes, 0, length, Math.max(0, info.size - length));
      return bytes.subarray(0, bytesRead);
    } finally { await handle.close(); }
  } catch { return null; }
}

// Windows pg_ctl creates postgres with a restricted token. Its own PID (and
// its intermediate cmd.exe PID) are not the postmaster PID and are never used
// as server ownership. The caller must already own this private PGDATA.
export async function startOwnedWindowsPostgres({
  pgBinDir, pgDataDir, databasePort, env = process.env, startupTimeoutMs = 30000, signal, logFile,
} = {}) {
  if (process.platform !== 'win32') throw failure('owned_postgres_windows_required');
  if (!Number.isInteger(databasePort) || databasePort <= 1023 || databasePort > 65535
    || !Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1000 || startupTimeoutMs > 120000) {
    throw failure('owned_postgres_configuration_invalid');
  }
  if (signal?.aborted) throw failure('owned_postgres_startup_cancelled');
  const dataDirectory = await canonicalDirectory(pgDataDir);
  const binDirectory = await canonicalDirectory(pgBinDir);
  const postgresExecutable = await regularFile(path.join(binDirectory, 'postgres.exe'));
  const pgCtlExecutable = await regularFile(path.join(binDirectory, 'pg_ctl.exe'));
  const pgIsReadyExecutable = await regularFile(path.join(binDirectory, 'pg_isready.exe'));
  const pidPath = path.join(dataDirectory, 'postmaster.pid');
  try { await fs.lstat(pidPath); throw failure('owned_postgres_existing_pid_file'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (!(await portClosed(databasePort))) throw failure('owned_postgres_existing_endpoint');
  const privateLog = logFile || path.join(dataDirectory, `owned-postgres-startup-${randomUUID()}.log`);
  if (!path.isAbsolute(privateLog) || !same(await fs.realpath(path.dirname(privateLog)), dataDirectory)) {
    throw failure('owned_postgres_private_log_invalid');
  }
  try { await fs.lstat(privateLog); throw failure('owned_postgres_private_log_exists'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const launchedAt = Date.now();
  let identity;
  let stopAttempt = null;
  const commandMatches = record => windowsPostgresCommandMatches(record.command_line,
    { postgresExecutable, pgDataDir: dataDirectory, databasePort });

  async function claim() {
    const selected = await pidFileIdentity(pidPath, dataDirectory, databasePort);
    const processIdentity = await processRecord(selected.pid, env);
    if (!processIdentity || !same(processIdentity.executable, postgresExecutable) || !commandMatches(processIdentity)
      || Date.parse(processIdentity.created_at) < launchedAt - 2000
      || Date.parse(processIdentity.created_at) > Date.now() + 2000
      || Number(selected.postmasterStartIdentity) * 1000 < launchedAt - 2000
      || Number(selected.postmasterStartIdentity) * 1000 > Date.now() + 2000
      || Math.abs(Number(selected.postmasterStartIdentity) * 1000 - Date.parse(processIdentity.created_at)) > 2500) {
      throw failure('owned_postgres_process_identity_unconfirmed');
    }
    return Object.freeze({ ...selected, processCreatedAt: processIdentity.created_at });
  }

  async function verify({ timeoutMs = 10000 } = {}) {
    const current = await pidFileIdentity(pidPath, dataDirectory, databasePort);
    const processIdentity = await processRecord(identity.pid, env, timeoutMs);
    if (current.pid !== identity.pid || current.postmasterStartIdentity !== identity.postmasterStartIdentity
      || !processIdentity || processIdentity.created_at !== identity.processCreatedAt
      || !same(processIdentity.executable, postgresExecutable) || !commandMatches(processIdentity)) throw failure('owned_postgres_process_identity_unconfirmed');
    return Object.freeze({ pid: identity.pid, postmasterStartIdentity: identity.postmasterStartIdentity,
      processCreatedAt: identity.processCreatedAt });
  }

  async function isAlive({ timeoutMs = 10000 } = {}) {
    const current = await processRecord(identity.pid, env, timeoutMs);
    if (current === null || current.created_at !== identity.processCreatedAt) return false;
    if (!same(current.executable, postgresExecutable) || !commandMatches(current)) throw failure('owned_postgres_process_identity_unconfirmed');
    return true;
  }

  async function stopped(deadline) {
    const remaining = () => Math.max(1, deadline - Date.now());
    if (await isAlive({ timeoutMs: Math.min(10000, remaining()) })) return false;
    try { await fs.lstat(pidPath); return false; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    return portClosed(databasePort, Math.min(2000, remaining()));
  }

  async function performStop(timeoutMs) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 45000) throw failure('runtime_cleanup_unconfirmed');
    const deadline = Date.now() + timeoutMs;
    try {
      if (await stopped(deadline)) return Object.freeze({ cleanup_confirmed: true, pid: identity.pid });
      if (Date.now() >= deadline) throw failure('runtime_cleanup_unconfirmed');
      await verify({ timeoutMs: Math.max(1, Math.min(10000, deadline - Date.now())) });
      const remaining = deadline - Date.now();
      if (remaining < 1000) throw failure('runtime_cleanup_unconfirmed');
      await exec(pgCtlExecutable, ['stop', '-D', dataDirectory, '-m', 'fast', '-w', '-t', String(Math.max(1, Math.floor((remaining - 1000) / 1000)))],
        { env, shell: false, windowsHide: true, timeout: remaining, maxBuffer: maximumDiagnosticBytes });
      do {
        if (await stopped(deadline)) return Object.freeze({ cleanup_confirmed: true, pid: identity.pid });
        await sleep(100);
      } while (Date.now() < deadline);
    } catch { /* Uncertain identity or exit never authorizes a generic PID kill. */ }
    throw failure('runtime_cleanup_unconfirmed');
  }

  async function stop({ timeoutMs = 25000 } = {}) {
    if (stopAttempt) return stopAttempt;
    const pending = performStop(timeoutMs);
    stopAttempt = pending;
    try { return await pending; }
    finally { if (stopAttempt === pending) stopAttempt = null; }
  }

  try {
    await exec(pgCtlExecutable, ['start', '-D', dataDirectory, '-p', postgresExecutable,
      '-o', `-h 127.0.0.1 -p ${databasePort}`, '-l', privateLog, '-w', '-t', String(Math.ceil(startupTimeoutMs / 1000))],
      { env, shell: false, windowsHide: true, timeout: startupTimeoutMs + 5000,
        maxBuffer: maximumDiagnosticBytes, ...(signal ? { signal } : {}) });
    identity = await claim();
    if (identity.status !== 'ready') throw failure('owned_postgres_readiness_unconfirmed');
    await exec(pgIsReadyExecutable, ['-h', '127.0.0.1', '-p', String(databasePort), '--timeout=3'],
      { env, shell: false, windowsHide: true, timeout: 5000, maxBuffer: maximumDiagnosticBytes });
    await verify();
    if (signal?.aborted) throw failure('owned_postgres_startup_cancelled');
    return Object.freeze({ pid: identity.pid, processCreatedAt: identity.processCreatedAt,
      postmasterStartIdentity: identity.postmasterStartIdentity, pgDataDir: dataDirectory, databasePort,
      verify, isAlive, stop });
  } catch {
    // Retain only a bounded private diagnostic snapshot. Neither paths nor
    // PostgreSQL stderr are included in the fixed public failure category.
    const diagnostic = await boundedPrivateDiagnostics(privateLog);
    if (diagnostic) {
      try { await fs.writeFile(path.join(dataDirectory, `owned-postgres-diagnostic-${randomUUID()}.txt`), diagnostic, { flag: 'wx', mode: 0o600 }); }
      catch { /* Diagnostic capture cannot authorize or prevent cleanup. */ }
    }
    try {
      identity ||= await claim();
      await stop();
    } catch {
      throw failure('runtime_cleanup_unconfirmed');
    }
    throw failure('owned_postgres_startup_unconfirmed');
  }
}
