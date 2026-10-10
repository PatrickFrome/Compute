import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, parseArgs } from 'node:util';

const execute = promisify(execFile);

function checkedIdentity(port, pid) {
  if (!Number.isInteger(port) || port < 1 || port > 65535
      || !Number.isInteger(pid) || pid < 1 || pid > 0xffffffff) {
    throw new Error('me2_ui_os_listener_identity_invalid');
  }
}

// An HTTP response does not prove the address or process that owns the socket.
// Check every listener on the port, so a second wildcard/LAN listener cannot be
// concealed by a successful request to 127.0.0.1.
export function assertWindowsTcpListener(rows, { port, pid } = {}) {
  checkedIdentity(port, pid);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 64) {
    throw new Error('me2_ui_os_listener_rows_invalid');
  }
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || !Number.isInteger(row.LocalPort) || !Number.isInteger(row.OwningProcess)
        || typeof row.LocalAddress !== 'string') {
      throw new Error('me2_ui_os_listener_rows_invalid');
    }
    if (row.LocalPort !== port) throw new Error('me2_ui_os_listener_port_mismatch');
    if (row.OwningProcess !== pid) throw new Error('me2_ui_os_listener_pid_mismatch');
    if (row.LocalAddress !== '127.0.0.1') throw new Error('me2_ui_os_listener_address_mismatch');
  }
  return Object.freeze({
    schema: 'metaengine.browser.me2.os-listener-proof.v1',
    method: 'WINDOWS_GET_NET_TCP_CONNECTION',
    local_address: '127.0.0.1',
    local_port: port,
    owner_pid: pid,
    listener_count: rows.length,
    loopback_only: true,
    expected_process_only: true,
    authority_effect: false,
  });
}

export async function verifyWindowsTcpListener({ port, pid, platform = process.platform, run = execute } = {}) {
  checkedIdentity(port, pid);
  if (platform !== 'win32') throw new Error('me2_ui_os_listener_windows_required');
  // Only validated integers enter the fixed read-only command. Do not echo
  // PowerShell diagnostics, process command lines, or inherited environment.
  const script = `$ErrorActionPreference='Stop'; $rows=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop | Select-Object -Property LocalAddress,LocalPort,OwningProcess); ConvertTo-Json -InputObject $rows -Compress -Depth 3`;
  let stdout;
  try {
    ({ stdout } = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024, encoding: 'utf8' }));
  } catch {
    throw new Error('me2_ui_os_listener_query_failed');
  }
  let rows;
  try { rows = JSON.parse(String(stdout)); }
  catch { throw new Error('me2_ui_os_listener_rows_invalid'); }
  return assertWindowsTcpListener(rows, { port, pid });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { port: { type: 'string' }, pid: { type: 'string' } } });
    const proof = await verifyWindowsTcpListener({ port: Number(values.port), pid: Number(values.pid) });
    process.stdout.write(JSON.stringify(proof) + '\n');
  } catch (error) {
    console.error(`ME2_UI_OS_LISTENER_VERIFICATION_FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
