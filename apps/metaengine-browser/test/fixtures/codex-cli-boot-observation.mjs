import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {readWindowsSandboxHostBoot} from '../../src/codex-cli-sandbox-probe.mjs';
import {createNativePhaseParser} from './codex-cli-startup-observation.mjs';

// Test-only timing labels. They cannot establish a boot identity or explain why
// WinPS is delayed; the original reader still validates the native JSON itself.
export const CODEX_BOOT_READ_STAGES = Object.freeze(['SCRIPT_ENTER', 'ADD_TYPE_BEGIN', 'ADD_TYPE_END',
  'TELEMETRY_BEGIN', 'TELEMETRY_END', 'PID4_READ_BEGIN', 'PID4_READ_END', 'OS_READ_BEGIN',
  'OS_READ_END', 'RECHECK_BEGIN', 'RECHECK_END', 'JSON_WRITE_BEGIN', 'JSON_WRITE_END']);
const prefix = 'ME_CODEX_BOOT_READ_V1 ';
const marker = stage => `[Console]::Error.WriteLine('${prefix}${stage}'); [Console]::Error.Flush()\n`;
const invalidSource = () => Error('native_boot_observation_source_anchor_invalid');

export function instrumentWindowsBootReadScript(source) {
  if (typeof source !== 'string' || source.includes(prefix)) throw invalidSource();
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const insertions = [
    ["$ErrorActionPreference='Stop'", marker('SCRIPT_ENTER'), false],
    ['Add-Type -TypeDefinition $source', marker('ADD_TYPE_BEGIN'), false],
    ['Add-Type -TypeDefinition $source', '\n' + marker('ADD_TYPE_END').trimEnd(), true],
    ['$boot=[MetaengineKernelBoot]::BootId()', marker('TELEMETRY_BEGIN'), false],
    ['$boot=[MetaengineKernelBoot]::BootId()', '\n' + marker('TELEMETRY_END').trimEnd(), true],
    ["$system=Get-CimInstance Win32_Process -Filter 'ProcessId=4'", marker('PID4_READ_BEGIN'), false],
    ["$system=Get-CimInstance Win32_Process -Filter 'ProcessId=4'", '\n' + marker('PID4_READ_END').trimEnd(), true],
    ['$os=Get-CimInstance Win32_OperatingSystem', '\n' + marker('OS_READ_BEGIN'), false],
    ['$os=Get-CimInstance Win32_OperatingSystem', '\n' + marker('OS_READ_END').trimEnd(), true],
    ["$again=Get-CimInstance Win32_Process -Filter 'ProcessId=4'", marker('RECHECK_BEGIN'), false],
    ["if(-not $again -or $again.CreationDate.ToUniversalTime().ToFileTimeUtc() -ne $birth.ToFileTimeUtc() -or [MetaengineKernelBoot]::BootId() -ne $boot){throw 'kernel_boot_changed'}",
      '\n' + marker('RECHECK_END').trimEnd(), true],
    ["@{schema='metaengine.windows.kernel-boot.v1';kernel_boot_id=$boot;", marker('JSON_WRITE_BEGIN'), false],
    ['last_boot_at=$os.LastBootUpTime.ToUniversalTime().ToString(\'o\');os_version=$os.Version}|ConvertTo-Json -Depth 4 -Compress',
      '\n' + marker('JSON_WRITE_END').trimEnd(), true],
  ];
  const edits = insertions.map(([anchor, text, after], order) => {
    anchor = anchor.replaceAll('\n', eol); text = text.replaceAll('\n', eol);
    if (source.split(anchor).length !== 2) throw invalidSource();
    return {at: source.indexOf(anchor) + (after ? anchor.length : 0), text, order};
  });
  for (const edit of edits.sort((a, b) => b.at - a.at || b.order - a.order)) {
    source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
  }
  return source;
}

export function createWindowsBootReadPhaseParser(options = {}) {
  return createNativePhaseParser({...options, stageNames: CODEX_BOOT_READ_STAGES, markerPrefix: prefix});
}

export async function readWindowsBootWithPhaseObservation({report, execute = promisify(execFile),
  platform = process.platform, now = () => performance.now()} = {}) {
  let primary, result, ownedClose, childClosed = false, spawnAt = null, closeAt = null, calls = 0;
  const started = now();
  const parser = createWindowsBootReadPhaseParser({now, startedAt: started});
  const exec = (executable, args, options) => {
    if (calls !== 0 || executable !== 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
      || !Array.isArray(args) || args.length !== 5
      || args.slice(0, 4).join('|') !== '-NoLogo|-NoProfile|-NonInteractive|-EncodedCommand'
      || options?.timeout !== 12000 || options.shell !== false) throw Error('native_boot_observation_transport_scope_invalid');
    calls++;
    const originalScript = Buffer.from(args[4], 'base64').toString('utf16le');
    const instrumented = instrumentWindowsBootReadScript(originalScript);
    // Preserve exact production options and returned Promise.child: the reader
    // closes its unused stdin, and its unchanged 12s bound still owns timeout.
    const pending = execute(executable, [...args.slice(0, 4), Buffer.from(instrumented, 'utf16le').toString('base64')], options);
    const child = pending?.child;
    if (!pending || typeof pending.then !== 'function' || typeof child?.once !== 'function'
      || typeof child.stderr?.on !== 'function') throw Error('native_boot_observation_owned_transport_required');
    child.stderr.on('data', chunk => parser.write(chunk));
    child.once('spawn', () => { spawnAt = now(); });
    ownedClose = new Promise(resolve => child.once('close', () => {
      childClosed = true; closeAt = now(); resolve();
    }));
    return pending;
  };
  try { result = await readWindowsSandboxHostBoot({exec, platform}); }
  catch (error) { primary = {error}; }
  finally {
    if (ownedClose) await ownedClose;
    const elapsed = at => at === null ? null : Math.max(0, Math.round(at - started));
    const record = {schema: 'metaengine.codex-cli.test-boot-read-phases.v1', reader_variant: 'FIRST_NATIVE_BOOT_READ',
      production_timeout_ms: 12000, transport_calls: calls, spawn_event_elapsed_ms: elapsed(spawnAt),
      close_elapsed_ms: elapsed(closeAt), ...parser.snapshot(),
      outcome: primary ? 'READ_FAILED' : 'READ_RETURNED', owned_transport_closed: childClosed,
      phase_timing_observation_only: true, causal_attribution_proven: false, native_qualification_proven: false};
    try { report(record); }
    catch { if (!primary) primary = {error: Error('native_boot_observation_report_failed')}; }
  }
  if (primary) throw primary.error;
  return result;
}
