import {readNativeCodingWindowsProcess} from './native-coding-windows-process-observer.mjs';
import {CODEX_CLI_JOB_PROTOCOL,CODEX_CLI_JOINED_SETTLEMENT_SCHEMA,createCodexCliLaunch,validateCodexCliLaunch,codexCliLaunchWire,codexCliLaunchIdentity,codexCliPublicProcess,codexCliProcessIdentity,codexCliSettlementSha256,validateCodexCliNativeTerminal,validateCodexCliJoinedSettlement,codexCliHelperFileIdentitySha256} from './codex-cli-physical-settlement.mjs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = reason => new Error(`codex_cli_process_${reason}`);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const policyType = 'metaengine.effective_policy.v1';
const policyAckType = 'metaengine.effective_policy.accept.v1';
const contextId = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // A phase can fail before its caller starts awaiting it. The original promise
  // still rejects, but never leaks an unhandled rejection during owned cleanup.
  promise.catch(() => {});
  return { promise, resolve, reject };
}
function helperFileIdentity(file){
  const s=fs.lstatSync(file,{bigint:true});
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||path.resolve(fs.realpathSync(file)).toLowerCase()!==path.resolve(file).toLowerCase())throw fail('helper_file_identity');
  return codexCliHelperFileIdentitySha256(s);
}

export function resolveCodexCliJobRuntime({ moduleUrl = import.meta.url, resourcesPath = process.resourcesPath } = {}) {
  const modulePath = fileURLToPath(moduleUrl);
  if (/\.asar(?:[\\/]|$)/i.test(modulePath)) {
    if (!path.isAbsolute(resourcesPath || '')) throw fail('packaged_resources_required');
    return Object.freeze({ helperPath: path.join(resourcesPath, 'native-coding', 'codex-cli-job-runner.ps1'),
      manifestPath: fileURLToPath(new URL('../native-coding-job-runtime.json', moduleUrl)), templatePath: null });
  }
  return Object.freeze({ helperPath: fileURLToPath(new URL('../native-dist/codex-cli/codex-cli-job-runner.ps1', moduleUrl)),
    manifestPath: fileURLToPath(new URL('../native-dist/codex-cli/manifest.json', moduleUrl)),
    templatePath: resolveCodexCliJobHelperSource({ moduleUrl }) });
}

export function resolveCodexCliJobHelper(options) { return resolveCodexCliJobRuntime(options).helperPath; }

// Source assertions and explicit build preparation read this template. Runtime
// launch must resolve the prepared, manifest-bound output instead.
export function resolveCodexCliJobHelperSource({ moduleUrl = import.meta.url } = {}) {
  if (/\.asar(?:[\\/]|$)/i.test(fileURLToPath(moduleUrl))) throw fail('packaged_source_template_unavailable');
  return fileURLToPath(new URL('../scripts/codex-cli-job-runner.ps1', moduleUrl));
}

function readBoundedFile(file, limit, reason) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw fail(reason);
    const bytes = fs.readFileSync(file);
    if (bytes.length < 1 || bytes.length > limit) throw fail(reason);
    return bytes;
  } catch { throw fail(reason); }
}

export function verifyCodexCliJobHelper({ helperPath, expectedHelperSha256, moduleUrl = import.meta.url, resourcesPath = process.resourcesPath } = {}) {
  if (helperPath !== undefined) {
    if (!path.isAbsolute(helperPath || '') || !validDigest(expectedHelperSha256)) throw fail('helper_pin_required');
    const bytes = readBoundedFile(helperPath, 4 * 1024 * 1024, 'helper_unreadable');
    if (sha256(bytes) !== expectedHelperSha256) throw fail('helper_digest_mismatch');
    return Object.freeze({ helperPath, helperSha256: expectedHelperSha256, runtimeManifestSha256: null });
  }
  if (expectedHelperSha256 !== undefined) throw fail('helper_pin_requires_explicit_path');
  const runtime = resolveCodexCliJobRuntime({ moduleUrl, resourcesPath });
  let manifest,manifestBytes;
  try { manifestBytes=readBoundedFile(runtime.manifestPath,16384,'runtime_unprepared');manifest = JSON.parse(manifestBytes.toString('utf8')); }
  catch (error) { if (error.message === 'codex_cli_process_runtime_unprepared') throw error; throw fail('runtime_manifest_invalid'); }
  if (manifest?.schema !== 'metaengine.codex-cli.job-runtime.v1' || manifest.build_mode !== 'PRECOMPILED_FRAMEWORK_CSHARP' || manifest.custody_protocol!==CODEX_CLI_JOB_PROTOCOL
    || !['template_sha256', 'csharp_sha256', 'assembly_sha256', 'helper_sha256', 'compiler_executable_sha256'].every(key => validDigest(manifest[key])))
    throw fail('runtime_manifest_invalid');
  if (runtime.templatePath && sha256(readBoundedFile(runtime.templatePath, 1024 * 1024, 'runtime_template_unreadable')) !== manifest.template_sha256)
    throw fail('runtime_template_changed');
  const bytes = readBoundedFile(runtime.helperPath, 4 * 1024 * 1024, 'runtime_unprepared');
  if (sha256(bytes) !== manifest.helper_sha256) throw fail('helper_digest_mismatch');
  return Object.freeze({ helperPath: runtime.helperPath, helperSha256: manifest.helper_sha256, runtimeManifestSha256:sha256(manifestBytes) });
}

/** A private process controller, not an OS sandbox or a lease issuer. */
export function createCodexCliWindowsProcessController({ helperPath, expectedHelperSha256,
  powershellPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  startupTimeoutMs = 30000, readProcess=readNativeCodingWindowsProcess } = {}) {
  if (process.platform !== 'win32') throw fail('windows_required');
  if(typeof readProcess!=='function')throw fail('native_observer_required');
  if (!path.isAbsolute(helperPath ?? resolveCodexCliJobHelper()) || !path.isAbsolute(powershellPath)) throw fail('absolute_paths_required');
  if (helperPath !== undefined && !validDigest(expectedHelperSha256)) throw fail('helper_pin_required');
  if (helperPath === undefined && expectedHelperSha256 !== undefined) throw fail('helper_pin_requires_explicit_path');
  return Object.freeze({
    async spawn(spec) {
      if (!path.isAbsolute(spec.executablePath || '') || !path.isAbsolute(spec.cwd || '')
        || !Array.isArray(spec.args) || spec.args.some(v => typeof v !== 'string' || v.includes('\0'))
        || !/^[a-f0-9]{64}$/.test(spec.expectedExecutableSha256 || '')
        || !/^[a-f0-9-]{36}$/.test(spec.runId || '')
        || (spec.deadlineAt != null && !Number.isFinite(Date.parse(spec.deadlineAt)))
        || !Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 100 || spec.timeoutMs > 1800000) throw fail('spec_invalid');
      // Revalidate immediately before every launch. A missing/stale preparation
      // cannot trigger compilation, choose a cache or fall back to the template.
      const launch=spec.launch??createCodexCliLaunch(spec),launchBody=validateCodexCliLaunch(launch,spec);
      const phased=launchBody.input_protocol==='EFFECTIVE_POLICY_ACK_V1';
      const launchIdentity=codexCliLaunchIdentity(launch);
      const verified = verifyCodexCliJobHelper({ helperPath, expectedHelperSha256 });
      const helperFile=helperFileIdentity(verified.helperPath);
      const helper = spawn(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', verified.helperPath], {
        cwd: spec.cwd, env: spec.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout = new PassThrough(); const stderr = new PassThrough();
      let proof = null, resumeIssued = false, resumed = false, terminationIssued = false, cancellation = null;
      let finished = false, pending = '', terminal = null, helperErrorBytes = 0, failureReason = null,helperValidated=false,killIssued=false;
      let phase='SUSPENDED', policyPending=Buffer.alloc(0), policyContext=null, executionPending=Buffer.alloc(0), earlyPending=Buffer.alloc(0), earlyOutput=[], earlyBytes=0, executionTimer=null, executionDeadline=null;
      const policyWait=deferred(),ackWait=deferred(),promptWait=deferred();
      let resolveReady, rejectReady, resolveCompletion;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const completion = new Promise(resolve => { resolveCompletion = resolve; });
      const end = (reason, exitCode = null, helperSignal = null) => {
        if (finished) return; finished = true; clearTimeout(startupTimer); clearTimeout(executionTimer);
        if(phased){
          if(phase==='ACK_PENDING')failureReason||='CONTROLLER_POLICY_ACK_UNCONFIRMED';
          else if(phase==='PROMPT_PENDING')failureReason||='CONTROLLER_POLICY_PROMPT_UNCONFIRMED';
          else if(!terminationIssued&&phase!=='EXECUTING'&&!['TIMEOUT','CANCELLED'].includes(terminal?.reason))failureReason||='CONTROLLER_POLICY_EOF';
          if(!failureReason&&phase==='EXECUTING'&&executionPending.length){
            try{if(JSON.parse(utf8(executionPending))?.type===policyType)failureReason='CONTROLLER_POLICY_PROTOCOL_INVALID';
              else stdout.write(executionPending);}catch{failureReason='CONTROLLER_POLICY_PROTOCOL_INVALID';}
          }
          const error=fail(failureReason||reason||'phase_closed');
          policyWait.reject(error);ackWait.reject(error);promptWait.reject(error);
        }
        if (!proof) rejectReady(fail(failureReason || reason || 'not_started'));
        stdout.end(); stderr.end();
        if (terminal && pending.length) failureReason ||= 'CONTROLLER_PROTOCOL_INVALID';
        if(terminal&&!failureReason&&helperValidated&&exitCode===0&&helperSignal===null&&!pending.length&&helperErrorBytes===0){
          const joined={schema:CODEX_CLI_JOINED_SETTLEMENT_SCHEMA,scope:'WINDOWS_HELPER_TREE',launch:launchIdentity,helper_process:proof.helper_process,
            helper_sha256:proof.helper_sha256,helper_file_identity_sha256:proof.helper_file_identity_sha256,runtime_manifest_sha256:proof.runtime_manifest_sha256,
            worker_process:codexCliPublicProcess(proof),native_terminal:terminal,native_terminal_sha256:codexCliSettlementSha256(terminal),
            parent_join:{event:'close',helper_pid:helper.pid,helper_process_incarnation_id:proof.helper_process.process_incarnation_id,
              exit_code:exitCode,signal:helperSignal,transport:'STDIO_CLOSE_DRAINED'}};
          try{validateCodexCliJoinedSettlement(joined,{proof,launch});
            resolveCompletion({...terminal,signal:null,joined_settlement:joined});return;
          }catch{failureReason='CONTROLLER_JOIN_INVALID';}
        }
        resolveCompletion({exit_code:exitCode,signal:null,reason:failureReason||reason||'CONTROLLER_EXIT_UNPROVEN',
          tree_cleanup_confirmed:false,process_tree_control:'WINDOWS_JOB_OBJECT'});
      };
      const stop = reason => { failureReason ||= reason;if(killIssued||finished)return;killIssued=true;
        try{helper.kill();}catch{/* An unconfirmed kill NEVER settles the owned close. */} };
      const protocolFailure = () => stop('CONTROLLER_PROTOCOL_INVALID');
      const policyFailure = () => stop('CONTROLLER_POLICY_PROTOCOL_INVALID');
      const uncertain = reason => phase==='ACK_PENDING'?'CONTROLLER_POLICY_ACK_UNCONFIRMED':phase==='PROMPT_PENDING'?'CONTROLLER_POLICY_PROMPT_UNCONFIRMED':reason;
      const executionOutput = (channel, bytes) => {
        if(channel==='stderr'){stderr.write(bytes);return;}
        // Retain each complete JSONL record until we know it is not a repeated
        // policy frame. Reserved frames never enter the runner/model transcript.
        executionPending=Buffer.concat([executionPending,bytes]);
        let newline;
        while((newline=executionPending.indexOf(10))>=0){
          const line=executionPending.subarray(0,newline),wire=executionPending.subarray(0,newline+1);
          executionPending=executionPending.subarray(newline+1);
          try{if(JSON.parse(utf8(line))?.type===policyType)return policyFailure();}catch{return policyFailure();}
          stdout.write(wire);
        }
        if(executionPending.length>8*1024*1024)policyFailure();
      };
      const workerOutput = (channel, bytes) => {
        if(!phased){(channel==='stdout'?stdout:stderr).write(bytes);return;}
        if(terminationIssued)return;
        if(phase==='BOOTSTRAP'){
          if(channel!=='stdout')return policyFailure();
          policyPending=Buffer.concat([policyPending,bytes]);const newline=policyPending.indexOf(10);
          if(newline<0){if(policyPending.length>65536)policyFailure();return;}
          if(newline<1||newline>65536||newline!==policyPending.length-1||policyPending[newline-1]===13)return policyFailure();
          const record=Buffer.from(policyPending.subarray(0,newline));let event;
          try{event=JSON.parse(utf8(record));}catch{return policyFailure();}
          // Only transport correlation is checked here. The private policy
          // consumer receives original bytes and owns all policy/schema checks.
          if(event?.type!==policyType||event.nonce!==launchBody.policy_nonce||!contextId.test(event.context_id||''))return policyFailure();
          policyContext=event.context_id;policyPending=Buffer.alloc(0);phase='POLICY_READY';policyWait.resolve(record);return;
        }
        if(phase==='ACK_PENDING'||phase==='ACK_WRITTEN'||phase==='PROMPT_PENDING'){
          // Native pipe writer and output pumps run concurrently. Output after
          // issuing ACK can overtake its delivery notification; expose it only
          // after the original prompt delivery is confirmed.
          earlyBytes+=bytes.length;if(earlyBytes>65536)return policyFailure();
          if(channel==='stdout'){
            earlyPending=Buffer.concat([earlyPending,bytes]);let newline;
            while((newline=earlyPending.indexOf(10))>=0){
              const line=earlyPending.subarray(0,newline);earlyPending=earlyPending.subarray(newline+1);
              try{if(JSON.parse(utf8(line))?.type===policyType)return policyFailure();}catch{return policyFailure();}
            }
          }
          earlyOutput.push([channel,Buffer.from(bytes)]);return;
        }
        if(phase!=='EXECUTING')return policyFailure();
        executionOutput(channel,bytes);
      };
      const startupTimer = setTimeout(() => stop('CONTROLLER_STARTUP_TIMEOUT'), startupTimeoutMs);
      const frame = value => {
        if (failureReason) return;
        if (!value || typeof value !== 'object' || terminal) return protocolFailure();
        if (value.type === 'ready') {
          if (proof || !Number.isSafeInteger(value.pid) || value.pid < 1
            || value.process_incarnation_id !== `pid:${value.pid}:created_100ns:${String(value.process_incarnation_id || '').split(':')[3]}`
            || !/^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$/.test(value.process_incarnation_id || '')
            || value.executable_sha256 !== spec.expectedExecutableSha256
            || path.resolve(value.executable_path || '').toLowerCase() !== path.resolve(spec.executablePath).toLowerCase()
            || value.tree_control_bound !== true || value.started_suspended !== true
            || value.process_tree_control !== 'WINDOWS_JOB_OBJECT'
            || value.job_bound_before_resume !== true || value.job_id !== spec.runId || !/^S-1-/.test(value.user_sid || '')) return protocolFailure();
          try{codexCliProcessIdentity(value.helper_process);codexCliProcessIdentity(codexCliPublicProcess(value));
            if(!Number.isSafeInteger(helper.pid)||value.helper_process.pid!==helper.pid||value.pid===helper.pid
              ||codexCliSettlementSha256(value.launch)!==codexCliSettlementSha256(launchIdentity))return protocolFailure();
          }catch{return protocolFailure();}
          const {type,...nativeProof}=value;
          proof = Object.freeze({...nativeProof,launch:Object.freeze({...launchIdentity}),helper_process:Object.freeze({...value.helper_process}),
            helper_sha256:verified.helperSha256,helper_file_identity_sha256:helperFile,
            runtime_manifest_sha256:verified.runtimeManifestSha256}); clearTimeout(startupTimer); resolveReady(proof);
        } else if (value.type === 'resumed') {
          if (!proof || !resumeIssued || cancellation || resumed||value.request_id!==launchIdentity.request_id
            ||value.request_sha256!==launchIdentity.request_sha256) return protocolFailure(); resumed = true;
        } else if(value.type==='policy_ack_written'){
          if(!phased||!resumed||phase!=='ACK_PENDING'||terminationIssued||value.request_id!==launchIdentity.request_id
            ||value.request_sha256!==launchIdentity.request_sha256||value.nonce!==launchBody.policy_nonce||value.context_id!==policyContext)return protocolFailure();
          phase='ACK_WRITTEN';ackWait.resolve();
        } else if(value.type==='prompt_written'){
          if(!phased||!resumed||phase!=='PROMPT_PENDING'||terminationIssued||value.request_id!==launchIdentity.request_id
            ||value.request_sha256!==launchIdentity.request_sha256)return protocolFailure();
          phase='EXECUTING';
          for(const [channel,bytes]of earlyOutput){if(failureReason)break;executionOutput(channel,bytes);}
          earlyOutput=[];earlyPending=Buffer.alloc(0);earlyBytes=0;if(!failureReason)promptWait.resolve();
        } else if (value.type === 'output') {
          if (!proof || !resumed || !['stdout', 'stderr'].includes(value.channel)
            || typeof value.data_b64 !== 'string' || value.data_b64.length > 8192
            || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data_b64)) return protocolFailure();
          const bytes=Buffer.from(value.data_b64,'base64');
          if(bytes.toString('base64')!==value.data_b64)return protocolFailure();
          workerOutput(value.channel,bytes);
        } else if (value.type === 'suspended_cancelled'||value.type==='exit') {
          if(!helperValidated||(value.type==='suspended_cancelled'&&(resumeIssued||resumed)))return protocolFailure();
          try{terminal=validateCodexCliNativeTerminal(value,{proof,launch:launchIdentity,cancellation,resumed});}
          catch{return protocolFailure();}
        } else if (value.type === 'error') { failureReason = 'NATIVE_JOB_FAILED'; }
        else protocolFailure();
      };
      helper.stdout.setEncoding('utf8');
      helper.stdout.on('data', chunk => {
        if (finished) return;
        if (terminal && chunk.length) return protocolFailure();
        pending += chunk;
        let index;
        while ((index = pending.indexOf('\n')) >= 0 && !finished) {
          const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1);
          try { if (line) frame(JSON.parse(line)); else if (terminal) protocolFailure(); } catch { protocolFailure(); }
        }
        if (pending.length > 65536) protocolFailure();
      });
      // Compiler/host errors are never exported as task output; keep them bounded.
      helper.stderr.on('data', chunk => { helperErrorBytes += chunk.length; if (helperErrorBytes > 65536) protocolFailure(); });
      helper.stdin.on('error', () => { if (!finished) stop(uncertain('CONTROLLER_INPUT_FAILED')); });
      helper.once('error', () => { failureReason ||= 'CONTROLLER_SPAWN_FAILED'; });
      // Only close proves that the helper released its job handle and cwd.
      // Resolving on an error frame can race native cleanup and leave a live tree.
      helper.once('close', (code, signal) => end(terminal ? terminal.reason : 'CONTROLLER_EXIT_UNPROVEN', code, signal ?? null));
      helper.stdin.write(`${JSON.stringify(codexCliLaunchWire(launch))}\n`);
      await ready;
      try{
        const actual=await readProcess(helper.pid),afterHelper=verifyCodexCliJobHelper({helperPath,expectedHelperSha256});
        if(finished||failureReason||actual.pid!==helper.pid||actual.process_incarnation_id!==proof.helper_process.process_incarnation_id
          ||actual.user_sid!==proof.user_sid||path.resolve(actual.exe_path).toLowerCase()!==path.resolve(powershellPath).toLowerCase()
          ||helperFileIdentity(verified.helperPath)!==helperFile||afterHelper.helperSha256!==verified.helperSha256||afterHelper.runtimeManifestSha256!==verified.runtimeManifestSha256)
          throw fail('helper_native_binding_changed');
        helperValidated=true;
      }catch{stop('CONTROLLER_HELPER_UNVERIFIED');await completion;throw fail('helper_native_binding_changed');}
      const resumeDeadline = deadlineAt => {
        if(deadlineAt!==null&&!Number.isFinite(Date.parse(deadlineAt)))throw fail('resume_deadline_invalid');
        const deadline=Math.min(Date.now()+spec.timeoutMs,spec.deadlineAt==null?Infinity:Date.parse(spec.deadlineAt),deadlineAt===null?Infinity:Date.parse(deadlineAt));
        if(deadline<=Date.now())throw fail('deadline_expired_before_resume');return deadline;
      };
      return Object.freeze({ proof, stdout, stderr, completion,
        async resume(prompt = '', { deadlineAt = null } = {}) {
          if (phased || finished || failureReason || terminationIssued || resumeIssued || typeof prompt!=='string' || Buffer.byteLength(prompt, 'utf8') > 65536 ||sha256(prompt)!==launchIdentity.prompt_sha256) throw fail('resume_invalid');
          const deadline=resumeDeadline(deadlineAt);
          resumeIssued = true;
          helper.stdin.write(`RESUME ${launchIdentity.request_id} ${launchIdentity.request_sha256} ${deadline} ${Buffer.from(prompt, 'utf8').toString('base64')}\n`);
        },
        async bootstrap({deadlineAt=null}={}) {
          if(!phased||finished||failureReason||terminationIssued||resumeIssued)throw fail('bootstrap_invalid');
          const deadline=resumeDeadline(deadlineAt);resumeIssued=true;phase='BOOTSTRAP';executionDeadline=deadline;
          // The native watchdog enforces the actual deadline (<=100 ms poll).
          // Give its exit/accounting/pipe joins time to finish before killing a
          // stuck helper; a simultaneous parent kill would erase native proof.
          executionTimer=setTimeout(()=>stop(uncertain('CONTROLLER_EXECUTION_TIMEOUT')),Math.max(1,deadline-Date.now())+11000);
          helper.stdin.write(`BOOTSTRAP ${launchIdentity.request_id} ${launchIdentity.request_sha256} ${deadline}\n`);
          return policyWait.promise;
        },
        async acceptPolicy(ack,prompt) {
          if(!phased||finished||failureReason||terminationIssued||phase!=='POLICY_READY'||Date.now()>=executionDeadline||!Buffer.isBuffer(ack)||ack.length>512||ack.length<2
            ||ack[ack.length-1]!==10||ack.subarray(0,-1).includes(10)||typeof prompt!=='string'||Buffer.byteLength(prompt)>65536||sha256(prompt)!==launchIdentity.prompt_sha256)throw fail('policy_accept_invalid');
          let value;try{value=JSON.parse(utf8(ack.subarray(0,-1)));}catch{throw fail('policy_accept_invalid');}
          if(!value||Object.keys(value).sort().join(',')!=='context_id,nonce,type'||value.type!==policyAckType||value.nonce!==launchBody.policy_nonce||value.context_id!==policyContext)throw fail('policy_accept_invalid');
          // Send canonical bytes only, once. No write callback is interpreted as
          // worker delivery; wait for the native writer's bound notification.
          const wire=Buffer.from(JSON.stringify({type:policyAckType,nonce:value.nonce,context_id:value.context_id})+'\n');
          phase='ACK_PENDING';helper.stdin.write(`POLICY_ACK ${launchIdentity.request_id} ${launchIdentity.request_sha256} ${wire.toString('base64')}\n`);
          await ackWait.promise;
          if(finished||failureReason||terminationIssued||phase!=='ACK_WRITTEN'||Date.now()>=executionDeadline){await completion;throw fail('policy_accept_cancelled');}
          phase='PROMPT_PENDING';helper.stdin.write(`PROMPT ${launchIdentity.request_id} ${launchIdentity.request_sha256} ${Buffer.from(prompt).toString('base64')}\n`);
          await promptWait.promise;
          if(finished||failureReason||terminationIssued){await completion;throw fail('policy_accept_cancelled');}
        },
        async terminate(reason = 'CANCELLED') {
          if (finished) return;
          if (terminationIssued) { await completion; return; }
          // Fence resume synchronously, before writing or waiting for native cleanup.
          terminationIssued = true;
          if(phased&&(phase==='ACK_PENDING'||phase==='PROMPT_PENDING'))failureReason||=uncertain('CANCELLED');
          const safeReason = String(reason).replace(/[^A-Z_]/g, '').slice(0, 80) || 'CANCELLED';
          // Helper holds the only job handle. Its termination kills exactly this tree.
          if (!resumeIssued) {
            cancellation = Object.freeze({ id: randomUUID(), reason: safeReason });
            helper.stdin.end(`CANCEL_SUSPENDED ${cancellation.id} ${cancellation.reason}\n`);
          } else helper.stdin.end(`CANCEL ${safeReason}\n`);
          // Suspended cleanup has separate bounded process-exit/accounting waits.
          const deadline = setTimeout(() => stop('CONTROLLER_TERMINATION_TIMEOUT'), cancellation ? 11000 : 6000);
          await completion; clearTimeout(deadline);
        },
      });
    },
  });
}
