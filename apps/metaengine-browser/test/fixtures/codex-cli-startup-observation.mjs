import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {performance} from 'node:perf_hooks';
import {CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX, CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX} from '../../scripts/prepare-codex-cli-job-runtime.mjs';

// Disposable-helper diagnostics only. These labels carry no native authority,
// and neither helper stderr nor process arguments/environment are exported.
export const CODEX_STARTUP_STAGES = Object.freeze(['PS_ENTER', 'ASSEMBLY_LOAD_BEGIN', 'ASSEMBLY_LOAD_END',
  'REQUEST_READ_BEGIN', 'REQUEST_READ_END', 'NATIVE_RUN_ENTER', 'IMAGE_DIGEST_CHECKED',
  'CHILD_JOB_BOUND', 'IDENTITY_READBACK_COMPLETE', 'READY_WRITE_BEGIN', 'READY_FLUSH_RETURNED']);
const prefix = 'ME_CODEX_STARTUP_V1 ';
const ps = stage => `[Console]::Error.WriteLine('${prefix}${stage}'); [Console]::Error.Flush()\n`;
const cs = stage => `      Console.Error.WriteLine("${prefix}${stage}"); Console.Error.Flush();\n`;
const invalidSource = () => Error('native_startup_observation_source_anchor_invalid');

export function instrumentCodexCliHelperStartup(source) {
  if (typeof source !== 'string' || source.includes(prefix)) throw invalidSource();
  if (source.split("Add-Type -TypeDefinition @'").length !== 2) throw invalidSource();
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const insertions = [
    ["$ErrorActionPreference = 'Stop'", ps('PS_ENTER'), false],
    ['  $request = [Console]::In.ReadLine() | ConvertFrom-Json', '  ' + ps('REQUEST_READ_BEGIN'), false],
    ['  $request = [Console]::In.ReadLine() | ConvertFrom-Json', '\n  ' + ps('REQUEST_READ_END').trimEnd(), true],
    ['  public static void Run(string exe,string[] args,string cwd,string runId,uint timeout,string expectedSha,string absoluteDeadlineMs) {', '\n' + cs('NATIVE_RUN_ENTER').trimEnd(), true],
    ['      job=CreateJobObject(IntPtr.Zero,null);', cs('IMAGE_DIGEST_CHECKED'), false],
    ['bool inJob; Require(IsProcessInJob(process.process,job,out inJob)&&inJob,"membership_readback_failed");', '\n' + cs('CHILD_JOB_BOUND').trimEnd(), true],
    ['      string sid=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;', '\n' + cs('IDENTITY_READBACK_COMPLETE').trimEnd(), true],
    [String.raw`      Emit("{\"type\":\"ready\",`, cs('READY_WRITE_BEGIN'), false],
    ["      // No model prompt or child execution before the native host's second authorization.", cs('READY_FLUSH_RETURNED'), false],
  ];
  // Compute against the original bytes so a source drift cannot silently move a
  // marker into generated code or a different request/native operation.
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

// Apply after the normal producer compiles the instrumented C# template. The
// timed helper observes an assembly load, never an Add-Type compilation proxy.
export function instrumentCodexCliRuntimeStartup(source) {
  if (typeof source !== 'string' || source.includes(prefix + 'ASSEMBLY_LOAD_') || source.includes('Add-Type -TypeDefinition')) throw invalidSource();
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(eol), loaders = lines.filter(line => line.startsWith(CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX)
    && line.endsWith(CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX));
  if (loaders.length !== 1) throw invalidSource();
  const loader = loaders[0], bytes = loader.slice(CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX.length, -CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(bytes)) throw invalidSource();
  return source.replace(loader, ps('ASSEMBLY_LOAD_BEGIN').replaceAll('\n', eol) + loader
    + eol + ps('ASSEMBLY_LOAD_END').trimEnd());
}

export function createCodexCliStartupPhaseParser({now = () => performance.now(), startedAt = now()} = {}) {
  const stages = []; let pending = '', lineBytes = 0, discardedLine = false, bytes = 0, unknownBytes = 0;
  let lastStage = -1, invalid = false, overflow = false;
  const elapsed = () => Math.max(0, Math.round(now() - startedAt));
  const line = () => {
    const value = pending.endsWith('\r') ? pending.slice(0, -1) : pending;
    const index = CODEX_STARTUP_STAGES.indexOf(value.slice(prefix.length));
    if (!discardedLine && value.startsWith(prefix) && index > lastStage) {
      lastStage = index; stages.push({stage: CODEX_STARTUP_STAGES[index], elapsed_ms: elapsed()});
    } else {
      unknownBytes = Math.min(65537, unknownBytes + lineBytes);
      if (value.startsWith(prefix)) invalid = true;
    }
    pending = ''; lineBytes = 0; discardedLine = false;
  };
  return {
    write(chunk) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (const byte of data) {
        bytes = Math.min(65537, bytes + 1);
        if (bytes > 4096) { overflow = true; unknownBytes = Math.min(65537, unknownBytes + 1); continue; }
        lineBytes++;
        if (byte === 10) { line(); continue; }
        if (pending.length < 128 && !discardedLine) pending += String.fromCharCode(byte);
        else { pending = ''; discardedLine = true; }
      }
    },
    snapshot() {
      return {stages: stages.map(stage => ({...stage})), unknown_stderr_bytes: Math.min(65537, unknownBytes + lineBytes),
        phase_stream_invalid: invalid, phase_stream_overflow: overflow};
    },
  };
}

let observationActive = false;

export async function withCodexCliStartupObservation({helperPath, powershellPath, report, now = () => performance.now()}, body) {
  if (observationActive) throw Error('native_startup_observation_scope_already_active');
  const originalSpawn = childProcess.spawn, owned = [];
  let readyAt = null, primary, result;
  function observedSpawn(...call) {
    const matches = call[0] === powershellPath && Array.isArray(call[1])
      && call[1].at(-2) === '-File' && call[1].at(-1) === helperPath;
    const startedAt = matches ? now() : null;
    const child = originalSpawn(...call); // Identical arguments, options and returned owned handle.
    if (matches) {
      const parser = createCodexCliStartupPhaseParser({now, startedAt});
      const item = {parser, startedAt, spawnedAt: null, closedAt: null};
      child.stderr.on('data', chunk => parser.write(chunk));
      child.once('spawn', () => { item.spawnedAt = now(); });
      item.closed = new Promise(resolve => child.once('close', () => { item.closedAt = now(); resolve(); }));
      owned.push(item);
    }
    return child;
  }
  observationActive = true;
  childProcess.spawn = observedSpawn; syncBuiltinESMExports();
  try {
    result = await body({readyValidated() { readyAt ??= now(); }});
  } catch (error) { primary = {error}; }
  finally {
    // The controller/withOwnedCodexCliProcess retain termination custody. This
    // observer never kills, writes to, or changes any child, and cannot restore
    // the global import binding or release this scope before owned helper close.
    await Promise.all(owned.map(item => item.closed));
    childProcess.spawn = originalSpawn; syncBuiltinESMExports(); observationActive = false;
    const first = owned[0], elapsed = value => first && value !== null ? Math.max(0, Math.round(value - first.startedAt)) : null;
    const record = {schema: 'metaengine.codex-cli.test-startup-phases.v1', helper_variant: 'FORCED_OUTPUT_WINDOW',
      startup_deadline_ms: 30000, helper_spawns_observed: owned.length,
      spawn_event_elapsed_ms: elapsed(first?.spawnedAt ?? null), ready_validated_elapsed_ms: elapsed(readyAt),
      close_elapsed_ms: elapsed(first?.closedAt ?? null),
      ...(first?.parser.snapshot() ?? {stages: [], unknown_stderr_bytes: 0, phase_stream_invalid: false, phase_stream_overflow: false}),
      body_failed: !!primary, phase_timing_observation_only: true, contention_proven: false, native_qualification_proven: false};
    try { report(record); }
    catch { if (!primary) primary = {error: Error('native_startup_observation_report_failed')}; }
  }
  if (primary) throw primary.error;
  if (owned.length !== 1) throw Error('native_startup_observation_owned_helper_count_invalid');
  return result;
}
