import {createNativeCodingLeaseExecutor} from '../src/native-coding-lease-executor.mjs';
import {prepareUnqualifiedBridgeFixture} from './fixtures/native-coding-unqualified-bridge.mjs';
import {generatedRunCustodyDouble} from './fixtures/native-coding-run-custody-double.mjs';
import {createNativeCodingAgentMcpLaunch} from '../src/native-coding-agent-mcp-launch.mjs';
import {joinedSettlementFixture} from './fixtures/codex-cli-joined-settlement-fixture.mjs';
import test, {describe, before, after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { buildCodexCliArgv, codexCliEnvironment, codexCliTemporaryEnvironment, createCodexCliRunner } from '../src/codex-cli-runner.mjs';
import { createCodexCliWindowsProcessController, resolveCodexCliJobHelper, resolveCodexCliJobHelperSource } from '../src/codex-cli-windows-process-controller.mjs';
import { CODEX_CLI_RESULT_SCHEMA, validateCodexCliResult } from '../src/codex-cli-result-schema.mjs';
import {prepareNativeCodingAgentRunBridge} from '../src/native-coding-agent-run-bridge.mjs';
import {agentBridgePins} from './fixtures/native-coding-agent-bridge-pins.mjs';
import {connectNativeCodingAgentMcpBroker} from '../src/native-coding-agent-mcp-broker.mjs';
import {NATIVE_AGENT_MCP_ENV} from '../src/native-coding-agent-mcp-entry.mjs';
import {withOwnedCodexCliProcess} from './fixtures/with-owned-codex-cli-process.mjs';
import {prepareCodexCliJobRuntime} from '../scripts/prepare-codex-cli-job-runtime.mjs';

const exec = promisify(execFile);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const sid = 'S-1-5-21-123-456-789-1001';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const agent = n => `agent_test-${String(n).padStart(8, '0')}`;
const result = role => ({ schema: CODEX_CLI_RESULT_SCHEMA, role, outcome: 'DONE', summary: 'Useful change proposed', checks: [], followup_tasks: [] });

test('Windows environment key aliases cannot shadow the explicit home or temporary directory',()=>{
  const home=path.resolve('/fixture/home'),temporary=path.resolve('/fixture/temporary');
  const env=codexCliEnvironment(home,{Path:'safe-path',temp:'ambient-temp',CoDeX_HoMe:'ambient-home',OPENAI_API_KEY:'secret'});
  assert.equal(env.PATH,'safe-path');assert.equal(env.Path,undefined);assert.equal(env.CODEX_HOME,home);
  const scoped=codexCliTemporaryEnvironment({...env,Temp:'other-temp',tmpdir:'other-directory'},temporary);
  for(const key of Object.keys(scoped).filter(k=>['TEMP','TMP','TMPDIR'].includes(k.toUpperCase())))
   assert.equal(scoped[key],temporary);
  assert.equal(scoped.Temp,undefined);assert.equal(scoped.tmpdir,undefined);
  assert.throws(()=>codexCliEnvironment(home,{PATH:'first',Path:'second'}),/environment_case_collision/);
  assert.equal(codexCliEnvironment(home,{PATH:'same',Path:'same'}).PATH,'same');
});

test('packaged PowerShell helper resolves outside ASAR and is explicitly shipped as a resource', async () => {
  const resourcesPath = path.resolve(os.tmpdir(), 'packaged-resources');
  const moduleUrl = pathToFileURL(path.join(resourcesPath, 'app.asar', 'src', 'codex-cli-windows-process-controller.mjs')).href;
  assert.equal(resolveCodexCliJobHelper({ moduleUrl, resourcesPath }), path.join(resourcesPath, 'native-coding', 'codex-cli-job-runner.ps1'));
  assert.throws(() => resolveCodexCliJobHelper({ moduleUrl, resourcesPath: undefined }), /packaged_resources_required/);
  const config = JSON.parse(await fs.readFile(new URL('../electron-builder.test.json', import.meta.url), 'utf8'));
  assert.ok(config.extraResources.some(value => value.from === 'native-dist/codex-cli/codex-cli-job-runner.ps1' && value.to === 'native-coding/codex-cli-job-runner.ps1'));
});

async function fixture(t) {
  const temporary = await fs.realpath(os.tmpdir());
  const directory = await fs.realpath(await fs.mkdtemp(path.join(temporary, 'metaengine-codex-runner-')));
  t.after(async () => { const actual = await fs.realpath(directory);
    assert.equal(actual, directory); assert.equal(path.dirname(actual), temporary);
    assert.ok(path.basename(actual).startsWith('metaengine-codex-runner-'));
    await fs.rm(actual, { recursive: true, force: true }); });
  const repo = path.join(directory, 'repo'); const worktree = path.join(directory, 'worktree'); await fs.mkdir(repo);
  const git = args => exec('git', args, { cwd: repo, windowsHide: true });
  await git(['init', '-q']); await git(['config', 'user.email', 'test@example.invalid']); await git(['config', 'user.name', 'METAENGINE tests']);
  await git(['config', 'core.autocrlf', 'false']);
  await fs.writeFile(path.join(repo, 'feature.txt'), 'before\n'); await git(['add', '.']); await git(['commit', '-qm', 'base']);
  const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['worktree', 'add', '--detach', '--lock', worktree, head]);
  await fs.mkdir(path.join(directory, 'bin'));
  const executablePath = path.join(directory, 'bin', 'codex.exe'); await fs.writeFile(executablePath, 'pinned-test-executable');
  const codexHome = path.join(directory, 'auth'); await fs.mkdir(codexHome);
  const journalRoot = path.join(directory, 'private-journal');
  const workerTempRoot = path.join(directory, 'worker-temp');
  const lease = n => ({ task_id: id(n), agent_id: agent(n), lease_generation: 1, agent_generation_epoch: 7, base_sha: head });
  const permits = [];
  const authorizeLease = async ({ binding, worktreePath }) => { const permit = { authorized: true, trust_namespace: 'LOCAL_OPERATOR_QA',
    ...binding, worktree_path: worktreePath, permit_id: id(77), owner_epoch: 4, user_sid: sid,
    workspace_id: id(88), project_id: id(99), expires_at: new Date(Date.now() + 60000).toISOString() };
    permits.push(permit); return permit;
  };
  const protectTemporaryStorage = async target => ({ owner_dacl_verified: true, path: target, test_only: true });
  const verifyTemporaryStorage = protectTemporaryStorage;
  return { directory, worktree, executablePath, expectedExecutableSha256: sha('pinned-test-executable'), codexHome, journalRoot,
    workerTempRoot, protectTemporaryStorage, verifyTemporaryStorage, lease, authorizeLease, permits };
}

function controller({ mutate = true, invalidJson = false, hang = false, criticMutate = false, onResume = null } = {}) {
  let spawns = 0, lastSpec = null;
  return { get spawns() { return spawns; }, get lastSpec() { return lastSpec; }, async spawn(spec) {
    spawns++; lastSpec = spec; const stdout = new PassThrough(); const stderr = new PassThrough(); let finish;
    const completion = new Promise(resolve => { finish = resolve; });
    const generated=joinedSettlementFixture(spec);
    return {proof:generated.proof,stdout,stderr,completion,
      async resume(prompt, options) {
        await onResume?.(prompt, options);
        if (hang) return;
        const role = spec.args[spec.args.indexOf('--sandbox') + 1] === 'read-only' ? 'CRITIC' : 'IMPLEMENTER';
        if ((role === 'IMPLEMENTER' && mutate) || (role === 'CRITIC' && criticMutate)) await fs.writeFile(path.join(spec.cwd, 'feature.txt'), role === 'CRITIC' ? 'corrupted\n' : 'after\n');
        const response = result(role);
        if (role === 'CRITIC') {
          const schema = JSON.parse(await fs.readFile(spec.args[spec.args.indexOf('--output-schema') + 1], 'utf8'));
          response.verdict = 'ACCEPT'; response.subject_result_sha256 = schema.properties.subject_result_sha256.const;
        }
        await fs.writeFile(spec.args[spec.args.indexOf('--output-last-message') + 1], JSON.stringify(response));
        stdout.write(invalidJson ? 'not JSON\n' : `${JSON.stringify({ type: 'thread.started', thread_id: id(spawns + 200) })}\n${JSON.stringify({ type: 'turn.completed' })}\n`);
        finish(generated.complete());
      },
      async terminate(_reason) { finish(generated.complete({exit_code:124,reason:'CANCELLED'})); },
    };
  } };
}

test('fixed CLI argv uses saved login, native sandbox and separate critic permissions', () => {
  const root = path.resolve(os.tmpdir(), 'runner-argv');
  for (const role of ['IMPLEMENTER', 'CRITIC']) {
    const args = buildCodexCliArgv({ role, worktreePath: root, schemaPath: path.join(root, 'schema.json'), resultPath: path.join(root, 'result.json') });
    assert.equal(args[0], '-a'); assert.equal(args[1], 'never'); assert.ok(args.includes('--ignore-user-config'));
    assert.ok(args.slice(0, args.indexOf('exec')).includes('--no-daemon'));
    assert.equal(args[args.indexOf('--sandbox') + 1], role === 'CRITIC' ? 'read-only' : 'workspace-write');
    assert.ok(!args.some(value => /dangerously|full-auto|skip-git|ignore-rules/.test(value)));
  }
  const env = codexCliEnvironment(root, { PATH: 'path', OPENAI_API_KEY: 'do-not-inherit', CODEX_API_KEY: 'do-not-inherit', OTHER_SECRET: 'do-not-inherit' });
  assert.equal(env.CODEX_HOME, root); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.OTHER_SECRET, undefined);
  const temp = path.join(root, 'private-job-temp');
  const scoped = codexCliTemporaryEnvironment({ ...env, TEMP: 'old-global-temp', TMP: 'old-global-temp', TMPDIR: 'old-global-temp' }, temp);
  assert.equal(scoped.TEMP, temp); assert.equal(scoped.TMP, temp); assert.equal(scoped.TMPDIR, temp);
  assert.equal(env.TEMP, undefined);
});

test('physical changed bytes and native job binding are recorded; repeat lease never respawns', async t => {
  const f = await fixture(t); const processController = controller(); const runner = createCodexCliRunner({ ...f, processController });
  const request = { lease: f.lease(1), role: 'IMPLEMENTER', worktreePath: f.worktree, prompt: 'Implement a useful change' };
  const receipt = await runner.run(request);
  assert.equal(receipt.state, 'RESULT_READY'); assert.equal(receipt.production_qualified, false);
  assert.equal(receipt.useful_work_verified, false); assert.equal(receipt.git_after.changed_files[0].sha256, sha('after\n'));
  assert.equal(receipt.git_before.head, f.lease(1).base_sha); assert.match(receipt.jsonl_sha256, /^[a-f0-9]{64}$/);
  assert.equal(processController.lastSpec.env.TEMP, path.join(f.workerTempRoot, receipt.run_id));
  assert.equal(processController.lastSpec.env.TMP, receipt.temporary_path);
  assert.equal(processController.lastSpec.env.TMPDIR, receipt.temporary_path);
  assert.ok(!receipt.temporary_path.startsWith(f.journalRoot + path.sep));
  assert.equal(processController.lastSpec.deadlineAt, f.permits[0].expires_at);
  assert.equal(receipt.execution_deadline, f.permits[0].expires_at);
  assert.equal((await runner.run(request)).prior_attempt, true); assert.equal(processController.spawns, 1);
});

test('native permit rejection occurs before spawning or reserving the model job', async t => {
  const f = await fixture(t); const processController = controller();
  const runner = createCodexCliRunner({ ...f, processController, authorizeLease: async () => ({ authorized: true }) });
  await assert.rejects(runner.run({ lease: f.lease(1), role: 'IMPLEMENTER', worktreePath: f.worktree, prompt: 'x' }), /authorization_denied/);
  assert.equal(processController.spawns, 0);
});

test('underlying unqualified bridge counterfactual binds private broker only after RUNNING authorization and before prompt resume, then revokes',{
  skip:process.platform!=='win32'?'Production per-run bridge requires a Windows named pipe':false,
},async t=>{
  const f=await fixture(t),pins=await agentBridgePins(t),events=[];let running=false,bridge;
  const processController=controller({onResume:async()=>{
    events.push('resume');const env=processController.lastSpec.env;
    const client=await connectNativeCodingAgentMcpBroker({endpoint:env[NATIVE_AGENT_MCP_ENV.endpoint],capability:env[NATIVE_AGENT_MCP_ENV.capability]});
    try{assert.equal((await client.invoke('project_overview',{})).rows.length,0);}finally{client.close();}
  }});
  const authorizeLease=async request=>{events.push(request.phase);if(request.phase==='BEFORE_RESUME')running=true;return f.authorizeLease(request);};
  const runner=createCodexCliRunner({...f,processController,authorizeLease,async prepareAgentBridge(details){
    events.push('prepare-bridge');const a=details.authorization;
    const permit={...details.binding,permit_id:a.permit_id,owner_epoch:a.owner_epoch,user_sid:a.user_sid,workspace_id:a.workspace_id,project_id:a.project_id,
      trust_namespace:'LOCAL_OPERATOR_QA',revoked:false,expires_at:a.expires_at,provider_id:id(55),artifact:{cli_executable_sha256:f.expectedExecutableSha256},
      worktree:{path:a.worktree_path,base_sha:details.binding.base_sha}};
    bridge=await prepareUnqualifiedBridgeFixture({...details,permit,pins,ownPostgres:generatedRunCustodyDouble(async value=>{
      events.push(value.operation);assert.equal(running,true);
      return value.operation==='CHECK'?{schema:'metaengine.native-coding.agent-authorized.v1',run_id:details.runId,authorized:true,authority_effect:false}:{rows:[]};
    })});return bridge;
  }});
  const receipt=await runner.run({lease:f.lease(1),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'Use managed project tools'});
  assert.equal(receipt.state,'RESULT_READY');assert(events.indexOf('prepare-bridge')<events.indexOf('BEFORE_RESUME'));
  assert(events.indexOf('BEFORE_RESUME')<events.indexOf('CHECK'));assert(events.indexOf('CHECK')<events.indexOf('resume'));
  const spec=processController.lastSpec,cap=spec.env[NATIVE_AGENT_MCP_ENV.capability];
  assert.equal(Object.isFrozen(spec.env),true);assert.equal(spec.env.TEMP,receipt.temporary_path);
  assert(spec.args.some(value=>value.startsWith('mcp_servers.metaengine=')));assert(!JSON.stringify(spec.args).includes(cap));
  assert(!JSON.stringify(receipt).includes(cap));
  await assert.rejects(connectNativeCodingAgentMcpBroker({endpoint:spec.env[NATIVE_AGENT_MCP_ENV.endpoint],capability:cap}));
});

for(const mode of ['unverified','bind-refused','unsupported-platform'])test(
  ({unverified:'an unverified bridge descriptor cannot spawn or resume a worker',
    'bind-refused':'a refused Host binding cannot resume the suspended Windows named-pipe worker',
    'unsupported-platform':'non-Windows production bridge refusal leaves no worker or Host effect'})[mode],{
    skip:mode==='bind-refused'&&process.platform!=='win32'?'Host binding integration requires a Windows named pipe'
      :mode==='unsupported-platform'&&process.platform==='win32'?'Non-Windows refusal contract':false,
  },async t=>{
    const f=await fixture(t),processController=controller();let closes=0;
    let hostCalls=0,pins;if(mode!=='unverified')pins=await agentBridgePins(t);
    const runner=createCodexCliRunner({...f,processController,async prepareAgentBridge(details){
      if(mode==='unverified')return {launch:{argv:['--dangerously-bypass-approvals-and-sandbox']},bindRun:async()=>{},close:async()=>{closes++;}};
      const a=details.authorization,permit={...details.binding,...a,trust_namespace:'LOCAL_OPERATOR_QA',revoked:false,provider_id:id(55),
        artifact:{cli_executable_sha256:f.expectedExecutableSha256},worktree:{path:a.worktree_path,base_sha:details.binding.base_sha}};
      return (mode==='bind-refused'?prepareUnqualifiedBridgeFixture:prepareNativeCodingAgentRunBridge)({...details,permit,pins,ownPostgres:generatedRunCustodyDouble(async()=>{hostCalls++;throw Error('fixture_current_lease_rejected');})});
    }});
    const receipt=await runner.run({lease:f.lease(1),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'Never resume'});
    assert.equal(receipt.state,'AMBIGUOUS');assert.equal(await fs.readFile(path.join(f.worktree,'feature.txt'),'utf8'),'before\n');
    assert.equal(processController.spawns,mode==='bind-refused'?1:0);if(mode==='unverified')assert.equal(closes,1);
    if(mode==='unsupported-platform'){
      assert.equal(receipt.terminal_reason,'native_run_callback_directory_durability_unqualified');assert.equal(hostCalls,0);
    }
});

test('lease revoked before native resume leaves a durable ambiguous attempt and never reruns', async t => {
  const f = await fixture(t); const processController = controller();
  const runner = createCodexCliRunner({ ...f, processController, authorizeLease: async request => request.phase === 'BEFORE_RESUME' ? null : f.authorizeLease(request) });
  const request = { lease: f.lease(1), role: 'IMPLEMENTER', worktreePath: f.worktree, prompt: 'x' };
  assert.equal((await runner.run(request)).state, 'AMBIGUOUS');
  assert.equal(await fs.readFile(path.join(f.worktree, 'feature.txt'), 'utf8'), 'before\n');
  assert.equal((await runner.run(request)).state, 'AMBIGUOUS'); assert.equal(processController.spawns, 1);
});

test('malformed JSONL and cancellation cannot become completion or trigger an automatic retry', async t => {
  for (const options of [{ invalidJson: true }, { hang: true }]) {
    const abort = new AbortController();
    const f = await fixture(t); const processController = controller({ ...options, onResume: options.hang ? () => setTimeout(() => abort.abort(), 50) : null });
    const runner = createCodexCliRunner({ ...f, processController });
    const request = { lease: f.lease(1), role: 'IMPLEMENTER', worktreePath: f.worktree, prompt: 'x' };
    assert.equal((await runner.run(request, { signal: abort.signal })).state, 'AMBIGUOUS');
    await runner.run(request); assert.equal(processController.spawns, 1);
  }
});

test('independent critic must bind the physical writer artifact and a different task and agent', async t => {
  const f = await fixture(t); const processController = controller(); const runner = createCodexCliRunner({ ...f, processController });
  const writer = await runner.run({ lease: f.lease(1), role: 'IMPLEMENTER', worktreePath: f.worktree, prompt: 'Implement' });
  const subject = { task_id: writer.task_id, lease_generation: writer.lease_generation, run_id: writer.run_id, result_sha256: writer.result_sha256,
    git_artifact_sha256: writer.git_after.artifact_sha256, source_head: writer.git_after.head };
  await assert.rejects(runner.run({ lease: { ...f.lease(2), agent_id: writer.agent_id }, role: 'CRITIC', subject, worktreePath: f.worktree, prompt: 'Review' }), /critic_subject_invalid/);
  const critic = await runner.run({ lease: f.lease(2), role: 'CRITIC', subject, worktreePath: f.worktree, prompt: 'Review independently' });
  assert.equal(critic.state, 'RESULT_READY'); assert.equal(critic.result.verdict, 'ACCEPT');
  assert.equal(critic.subject_result_sha256, writer.result_sha256); assert.equal(processController.spawns, 2);
});

test('critic modifications invalidate the result despite an ACCEPT model assertion', async t => {
  const f = await fixture(t); const processController = controller({ criticMutate: true }); const runner = createCodexCliRunner({ ...f, processController });
  const writer = await runner.run({ lease: f.lease(1), role: 'IMPLEMENTER', worktreePath: f.worktree, prompt: 'Implement' });
  const critic = await runner.run({ lease: f.lease(2), role: 'CRITIC', worktreePath: f.worktree, prompt: 'Review',
    subject: { task_id: writer.task_id, lease_generation: writer.lease_generation, run_id: writer.run_id, result_sha256: writer.result_sha256,
      git_artifact_sha256: writer.git_after.artifact_sha256, source_head: writer.git_after.head } });
  assert.equal(critic.state, 'AMBIGUOUS'); assert.match(critic.terminal_reason, /critic_workspace_changed/);
});

test('result schema rejects unexpected fields and wrong critic subject', () => {
  assert.throws(() => validateCodexCliResult({ ...result('IMPLEMENTER'), authorized: true }, 'IMPLEMENTER'), /result_invalid/);
  assert.throws(() => validateCodexCliResult({ ...result('CRITIC'), verdict: 'ACCEPT', subject_result_sha256: 'b'.repeat(64) }, 'CRITIC', 'a'.repeat(64)), /result_invalid/);
});

test('real Windows controller starts suspended in its job and transports exact arguments without a model', { skip: process.platform !== 'win32' }, async () => {
  const processController = createCodexCliWindowsProcessController();
  const expectedExecutableSha256 = sha(await fs.readFile(process.execPath));
  await withOwnedCodexCliProcess(processController, { executablePath: process.execPath, expectedExecutableSha256,
    args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'argument with spaces', 'quote"and\\slash', 'тест🚀'],
    cwd: os.tmpdir(), env: codexCliEnvironment(path.join(os.tmpdir(), 'unused-auth')), timeoutMs: 10000, runId: crypto.randomUUID() }, async handle => {
    assert.equal(handle.proof.started_suspended, true); assert.equal(handle.proof.tree_control_bound, true);
    assert.deepEqual(JSON.parse(JSON.stringify(handle.proof)),handle.proof,'native proof must remain exact across protected JSON and private IPC');
    let output = ''; handle.stdout.setEncoding('utf8'); handle.stdout.on('data', value => { output += value; });
    await handle.resume(''); const completion = await handle.completion;
    assert.equal(completion.exit_code, 0); assert.equal(completion.tree_cleanup_confirmed, true);
    assert.deepEqual(JSON.parse(output), ['argument with spaces', 'quote"and\\slash', 'тест🚀']);
  });
});

test('real Windows deadline kills the exact job and its descendant without any model call', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-codex-timeout-'));
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
  const canary = path.join(directory, 'must-not-exist.txt');
  const descendant = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(canary)},'escaped'),2000)`;
  const script = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  const processController = createCodexCliWindowsProcessController();
  await withOwnedCodexCliProcess(processController, { executablePath: process.execPath, expectedExecutableSha256: sha(await fs.readFile(process.execPath)),
    args: ['-e', script], cwd: directory, env: codexCliEnvironment(path.join(directory, 'unused-auth')), timeoutMs: 300, runId: crypto.randomUUID() }, async handle => {
    handle.stdout.resume(); handle.stderr.resume(); await handle.resume('');
    const completion = await handle.completion;
    assert.equal(completion.reason, 'TIMEOUT'); assert.equal(completion.tree_cleanup_confirmed, true);
    await assert.rejects(fs.stat(canary), { code: 'ENOENT' });
  });
});

test('native absolute deadline can be shortened at resume and stops the real child before relative timeout', { skip: process.platform !== 'win32' }, async () => {
  const processController = createCodexCliWindowsProcessController();
  await withOwnedCodexCliProcess(processController, { executablePath: process.execPath, expectedExecutableSha256: sha(await fs.readFile(process.execPath)),
    args: ['-e', 'process.stdout.write("started");setInterval(()=>{},1000)'], cwd: os.tmpdir(),
    env: codexCliEnvironment(path.join(os.tmpdir(), 'unused-auth')), timeoutMs: 10000,
    // The original fixture permit must outlive the unchanged 30s helper startup
    // budget; the actual runtime deadline is still shortened to 600ms below.
    deadlineAt: new Date(Date.now() + 60000).toISOString(), runId: crypto.randomUUID() }, async handle => {
    let output = ''; handle.stdout.on('data', value => { output += value.toString(); }); handle.stderr.resume();
    const resumedAt = Date.now(); await handle.resume('', { deadlineAt: new Date(Date.now() + 600).toISOString() });
    const completion = await handle.completion;
    assert.equal(completion.reason, 'TIMEOUT'); assert.equal(completion.tree_cleanup_confirmed, true);
    assert.equal(output, 'started'); assert.ok(Date.now() - resumedAt < 4000);
  });
});

function assertSuspendedCancellation(handle, completion, runId, reason) {
  assert.equal(completion.reason, reason); assert.equal(completion.exit_code, 125);
  assert.equal(completion.tree_cleanup_confirmed, true); assert.equal(completion.never_resumed, true);
  assert.equal(completion.process_exit_confirmed, true); assert.equal(completion.handles_closed, true);
  assert.equal(completion.process_tree_control, 'WINDOWS_JOB_OBJECT');
  assert.equal(completion.run_id, runId); assert.equal(completion.job_id, runId);
  assert.equal(completion.pid, handle.proof.pid); assert.equal(completion.process_incarnation_id, handle.proof.process_incarnation_id);
  assert.match(completion.cancellation_id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(completion.job_accounting.active_processes, 0); assert.equal(completion.job_accounting.total_processes, 1);
  assert.ok(Number.isSafeInteger(completion.job_accounting.total_terminated_processes));
  assert.ok(completion.job_accounting.total_terminated_processes >= 0 && completion.job_accounting.total_terminated_processes <= 1);
}

test('an expired native deadline cannot resume a suspended child and cancellation still proves exact cleanup', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-codex-expiry-'));
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
  const canary = path.join(directory, 'must-not-exist.txt');
  const processController = createCodexCliWindowsProcessController();
  const runId = crypto.randomUUID();
  await withOwnedCodexCliProcess(processController, { executablePath: process.execPath, expectedExecutableSha256: sha(await fs.readFile(process.execPath)),
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(canary)},'ran')`], cwd: directory,
    env: codexCliEnvironment(path.join(directory, 'unused-auth')), timeoutMs: 10000,
    deadlineAt: new Date(Date.now() - 1).toISOString(), runId }, async handle => {
    let output = ''; handle.stdout.on('data', chunk => { output += chunk.toString(); }); handle.stderr.resume();
    await assert.rejects(handle.resume(''), /deadline_expired_before_resume/);
    const terminating = handle.terminate('EXPIRED');
    await assert.rejects(handle.resume('must never reach child'), /resume_invalid/);
    await terminating; assertSuspendedCancellation(handle, await handle.completion, runId, 'EXPIRED');
    assert.equal(output, '');
    await assert.rejects(fs.stat(canary), { code: 'ENOENT' });
  });
});

test('real Windows pre-RESUME cancellations never execute a canary and bind separate native identities and cancellation IDs', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-codex-suspended-cancel-'));
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
  const processController = createCodexCliWindowsProcessController(), receipts = [];
  const expectedExecutableSha256 = sha(await fs.readFile(process.execPath));
  for (let n = 0; n < 2; n++) {
    const runId = crypto.randomUUID(), canary = path.join(directory, `must-not-exist-${n}.txt`);
    await withOwnedCodexCliProcess(processController, { executablePath: process.execPath, expectedExecutableSha256,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(canary)},'ran');process.stdout.write('ran')`],
      cwd: directory, env: codexCliEnvironment(path.join(directory, 'unused-auth')), timeoutMs: 10000, runId }, async handle => {
      let output = ''; handle.stdout.on('data', chunk => { output += chunk.toString(); }); handle.stderr.resume();
      const terminating = handle.terminate('CANCELLED'), repeated = handle.terminate('OTHER');
      await assert.rejects(handle.resume('must never reach child'), /resume_invalid/);
      await Promise.all([terminating, repeated]);
      const receipt = await handle.completion; assertSuspendedCancellation(handle, receipt, runId, 'CANCELLED');
      receipts.push(receipt); assert.equal(output, ''); await assert.rejects(fs.stat(canary), { code: 'ENOENT' });
    });
  }
  assert.notEqual(receipts[0].run_id, receipts[1].run_id);
  assert.notEqual(receipts[0].cancellation_id, receipts[1].cancellation_id);
  assert.notEqual(receipts[0].process_incarnation_id, receipts[1].process_incarnation_id);
});

describe('Windows native suspended cleanup fault fixtures', {skip: process.platform !== 'win32'}, () => {
  let preparedFixture, ownedFixtureDirectory, preparation;

  // Keep all four explicit C# builds outside the unchanged native test budget.
  // A timed-out setup cannot remove a directory while its producer owns it.
  after(async () => {
    if (preparation) {
      let timer;
      try {
        const settled = await Promise.race([
          preparation.then(() => true, () => true),
          new Promise(resolve => { timer = setTimeout(() => resolve(false), 30000); }),
        ]);
        if (!settled) throw Error('codex_cancel_fault_preparation_cleanup_pending');
      } finally { clearTimeout(timer); }
    }
    if (!ownedFixtureDirectory) return;
    const {directory, temporary, physicalDirectory} = ownedFixtureDirectory;
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.equal(await fs.realpath(directory), physicalDirectory);
    assert.equal(path.dirname(physicalDirectory), temporary);
    assert.ok(path.basename(physicalDirectory).startsWith('metaengine-codex-cancel-fault-'));
    await fs.rm(directory, {recursive: true, force: true});
  });

  before(() => {
    preparation = prepareFaultFixtures();
    return preparation;
  }, {timeout: 4 * 210000});

  async function prepareFaultFixtures() {
    const temporary = await fs.realpath(os.tmpdir());
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-codex-cancel-fault-'));
    ownedFixtureDirectory = {directory, temporary, physicalDirectory: await fs.realpath(directory)};
    const source = await fs.readFile(resolveCodexCliJobHelperSource(), 'utf8');
    const expectedExecutableSha256 = sha(await fs.readFile(process.execPath));
    // These copies deliberately pass invalid native handles; production helper
    // bytes and OS policy stay untouched. This is failure-path evidence only.
    const faults = [
      ['TerminateJobObject(job,125)', 'TerminateJobObject(IntPtr.Zero,125)'],
      ['GetExitCodeProcess(process.process,out cancelledCode)', 'GetExitCodeProcess(IntPtr.Zero,out cancelledCode)'],
      ['QueryInformationJobObject(job,1,out cancelledAccounting', 'QueryInformationJobObject(new IntPtr(-1),1,out cancelledAccounting'],
      ['CloseChecked(ref job,"suspended_job_close_failed");', 'Require(CloseHandle(IntPtr.Zero),"suspended_job_close_failed");'],
    ];
    const helpers = [];
    for (const [index, [before, after]] of faults.entries()) {
      assert.equal(source.split(before).length, 2, 'each fault must target exactly one suspended cleanup operation');
      const helperSourcePath = path.join(directory, `fault-${index}.ps1`), canary = path.join(directory, `must-not-exist-${index}.txt`);
      await fs.writeFile(helperSourcePath, source.replace(before, after), 'utf8');
      const prepared = await prepareCodexCliJobRuntime({helperSourcePath, outputDirectory: path.join(directory, `prepared-${index}`)});
      helpers.push({prepared, canary});
    }
    preparedFixture = {directory, expectedExecutableSha256, helpers};
  }

  test('real Windows fault-injected disposable helpers never attest suspended cleanup after a native operation fails', { skip: process.platform !== 'win32', timeout: 180000 }, async () => {
    assert.ok(preparedFixture, 'all explicit fault builds must complete before measured native execution');
    const {directory, expectedExecutableSha256, helpers} = preparedFixture;
    for (const {prepared, canary} of helpers) {
      const processController = createCodexCliWindowsProcessController({ helperPath: prepared.helperPath, expectedHelperSha256: prepared.manifest.helper_sha256 });
      await withOwnedCodexCliProcess(processController, { executablePath: process.execPath, expectedExecutableSha256,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(canary)},'ran')`],
        cwd: directory, env: codexCliEnvironment(path.join(directory, 'unused-auth')), timeoutMs: 10000, runId: crypto.randomUUID() }, async handle => {
        handle.stdout.resume(); handle.stderr.resume(); await handle.terminate('CANCELLED');
        const completion = await handle.completion;
        assert.equal(completion.tree_cleanup_confirmed, false); assert.equal(completion.reason, 'NATIVE_JOB_FAILED');
        assert.equal(completion.exit_code, 1); assert.equal(completion.cancellation_id, undefined);
        await assert.rejects(fs.stat(canary), { code: 'ENOENT' });
      });
    }
  });
});

test('failed spawn retains immutable pre-spawn request across runner restart and never resends',async t=>{
 const f=await fixture(t);let spawns=0,spec;
 const processController={async spawn(value){spawns++;spec=value;throw Error('fixture_failed_spawn');}};
 const request={lease:f.lease(901),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'Retain this exact failed request'};
 const receipt=await createCodexCliRunner({...f,processController}).run(request);
 assert.equal(receipt.state,'AMBIGUOUS');assert.equal(receipt.physical_settlement,undefined);
 const key=sha(JSON.stringify({task_id:request.lease.task_id,lease_generation:1,role:'IMPLEMENTER'}));
 const launchPath=path.join(f.journalRoot,key,'launch.json'),before=await fs.readFile(launchPath);
 assert.equal(JSON.parse(before).request_sha256,spec.launch.request_sha256);assert.equal(receipt.launch_identity.request_sha256,spec.launch.request_sha256);
 const restarted=await createCodexCliRunner({...f,processController}).run(request);
 assert.deepEqual(restarted,{...receipt,replayed:false,prior_attempt:true});assert.equal(spawns,1);assert.deepEqual(await fs.readFile(launchPath),before);
});

for(const failure of [false,true])test(`runner cancellation joins original held bridge close before immutable receipt (${failure?'failed':'fulfilled'})`,async t=>{
 const f=await fixture(t),pins=await agentBridgePins(t),gate=Promise.withResolvers(),entered=Promise.withResolvers(),abort=new AbortController();let closes=0;
 const processController=controller({hang:true,onResume:()=>{abort.abort();}}),request={lease:f.lease(failure?903:902),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'Fixture no model'};
 const runner=createCodexCliRunner({...f,processController,async prepareAgentBridge(details){
  const binding={run_id:details.runId,workspace_id:details.authorization.workspace_id,project_id:details.authorization.project_id,
   task_id:details.binding.task_id,lease_generation:details.binding.lease_generation,agent_id:details.binding.agent_id,
   agent_generation_epoch:details.binding.agent_generation_epoch,provider_id:id(55),role:details.binding.role};
  // Pure pinned-launch producer + generated lifecycle closure; NO broker/socket.
  const launch=await createNativeCodingAgentMcpLaunch({...pins,registration:{binding,endpoint:'fixture-only-no-socket',capability:'c'.repeat(64),allowedTools:['project_overview']}});
  return {launch,bindRun:async()=>{},close(){closes++;entered.resolve();return closes===1?gate.promise:Promise.resolve();}};
 }});
 const pending=runner.run(request,{signal:abort.signal});await entered.promise;
 const key=sha(JSON.stringify({task_id:request.lease.task_id,lease_generation:1,role:'IMPLEMENTER'})),file=path.join(f.journalRoot,key,'receipt.json');
 await new Promise(resolve=>setImmediate(resolve));await assert.rejects(fs.stat(file),{code:'ENOENT'});assert.equal(closes,1);
 if(failure)gate.reject(Error('fixture_bridge_transport_unconfirmed'));else gate.resolve();
 const receipt=await pending;assert.equal(receipt.state,'AMBIGUOUS');assert.equal(closes,1);
 if(failure){assert.equal(receipt.physical_settlement,undefined);assert.equal(receipt.terminal_reason,'AGENT_BRIDGE_REVOCATION_UNCONFIRMED');}
 else {assert.equal(receipt.local_output_drain.scope,'HELPER_TREE_AND_LOCAL_OUTPUT');assert.equal(receipt.local_output_drain.host_scope_callbacks,'NOT_ATTESTED');}
 assert.ok(!(await fs.readFile(path.join(f.journalRoot,key,'launch.json'),'utf8')).includes('c'.repeat(64)));
});

test('runner joins original output fsync/close before publishing scoped settlement',async t=>{
 const f=await fixture(t),gate=Promise.withResolvers(),entered=Promise.withResolvers(),originalOpen=fs.open,closed=[];
 t.mock.method(fs,'open',async(file,...args)=>{
  const handle=await originalOpen(file,...args);if(!['events.jsonl','stderr.log'].includes(path.basename(file)))return handle;
  return {write:handle.write.bind(handle),async sync(){entered.resolve();await gate.promise;await handle.sync();},async close(){await handle.close();closed.push(path.basename(file));}};
 });
 const request={lease:f.lease(904),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'Fixture local writes'};
 const pending=createCodexCliRunner({...f,processController:controller()}).run(request);await entered.promise;
 const key=sha(JSON.stringify({task_id:request.lease.task_id,lease_generation:1,role:'IMPLEMENTER'})),file=path.join(f.journalRoot,key,'receipt.json');
 await assert.rejects(fs.stat(file),{code:'ENOENT'});assert.deepEqual(closed,[]);gate.resolve();const receipt=await pending;
 assert.deepEqual(closed,['events.jsonl','stderr.log']);assert.equal(receipt.state,'RESULT_READY');assert.ok(receipt.physical_settlement);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).local_output_drain.all_effects_cleanup,'UNCONFIRMED');
});

test('default runner creates exclusive callback journal before bridge preparation and never reuses failed launch run',async t=>{
 const f=await fixture(t),processController=controller();let preparations=0,journalDirectory;
 const runner=createCodexCliRunner({...f,processController,prepareAgentBridge:async details=>{
  preparations++;assert.equal(details.callbackJournal.snapshot().state,'INCOMPLETE');assert.equal(details.callbackJournal.snapshot().records,1);
  journalDirectory=path.join(f.journalRoot,sha(JSON.stringify({task_id:details.binding.task_id,lease_generation:details.binding.lease_generation,role:details.binding.role})));
  const rows=await fs.readdir(path.join(journalDirectory,'host-callback-custody'));assert.deepEqual(rows,['0000000000000000.json']);
  const header=JSON.parse(await fs.readFile(path.join(journalDirectory,'host-callback-custody',rows[0])));assert.equal(header.event.run_id,details.runId);
  assert.equal(JSON.stringify(header).includes('PRIVATE_PROMPT_SENTINEL'),false);throw Error('fixture_preparation_interrupted');
 }});
 const request={lease:f.lease(21),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'PRIVATE_PROMPT_SENTINEL'},first=await runner.run(request);
 assert.equal(first.state,'AMBIGUOUS');assert.equal(first.terminal_reason,'fixture_preparation_interrupted');assert.equal(preparations,1);assert.equal(processController.spawns,0);
 const retained=await fs.readFile(path.join(journalDirectory,'host-callback-custody','0000000000000000.json'));
 assert.equal((await runner.run(request)).prior_attempt,true);assert.equal(preparations,1);assert.equal(processController.spawns,0);
 assert.deepEqual(await fs.readFile(path.join(journalDirectory,'host-callback-custody','0000000000000000.json')),retained);
});

test('actual default runner/bridge directory-durability gate blocks before broker or native spawn on every platform',async t=>{
 const f=await fixture(t),processController=controller();let custody=0;
 const runner=createCodexCliRunner({...f,processController,prepareAgentBridge:async details=>{
  assert.equal(details.callbackJournal.snapshot().directory_durability,'DIRECTORY_DURABILITY_UNQUALIFIED');
  const a=details.authorization,permit={...details.binding,...a,trust_namespace:'LOCAL_OPERATOR_QA',revoked:false,provider_id:id(55),
   artifact:{cli_executable_sha256:f.expectedExecutableSha256},worktree:{path:a.worktree_path,base_sha:details.binding.base_sha}};
  return prepareNativeCodingAgentRunBridge({...details,permit,pins:{},ownPostgres:{openAgentRunCustody:async()=>{custody++;throw Error('not permitted');}}});
 }});
 const request={lease:f.lease(22),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'No unqualified publication'},receipt=await runner.run(request);
 assert.equal(receipt.state,'AMBIGUOUS');assert.equal(receipt.terminal_reason,'native_run_callback_directory_durability_unqualified');
 assert.equal(custody,0);assert.equal(processController.spawns,0);assert.equal((await runner.run(request)).prior_attempt,true);
 assert.equal(custody,0);assert.equal(processController.spawns,0);
});

const preparedRequest = f => ({lease:f.lease(310),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'Original private fixture prompt'});

test('prepared runner creates only immutable local attempt and unclaimed callback HEADER without dispatch',async t=>{
 const f=await fixture(t),processController=controller();let bridges=0;const phases=[];
 const runner=createCodexCliRunner({...f,processController,authorizeLease:async value=>{phases.push(value.phase);return f.authorizeLease(value);},
  prepareAgentBridge:async()=>{bridges++;throw Error('must not prepare a bridge');}});
 const request=preparedRequest(f),handle=await runner.prepare(request),descriptor=runner.describePrepared(handle);
 assert.equal(processController.spawns,0);assert.equal(bridges,0);assert.deepEqual(phases,['BEFORE_ATTEMPT']);
 assert.equal(descriptor.state,'PREPARED');assert.equal(descriptor.sql_reservation,'NOT_ATTESTED');assert.equal(descriptor.authority_effect,false);
 assert.equal(Object.isFrozen(descriptor),true);assert.equal(Object.isFrozen(descriptor.binding),true);
 assert.equal(descriptor.callbackJournal,runner.describePrepared(handle).callbackJournal);
 assert.equal(descriptor.callbackJournal.snapshot().records,1);assert.equal(descriptor.callbackJournal.snapshot().state,'INCOMPLETE');
 assert.equal(descriptor.callbackJournal.snapshot().directory_durability,'DIRECTORY_DURABILITY_UNQUALIFIED');
 assert.deepEqual((await fs.readdir(descriptor.directory)).sort(),['attempt.json','host-callback-custody']);
 const bytes=await fs.readFile(descriptor.attemptPath),attempt=JSON.parse(bytes);
 assert.equal(sha(bytes),descriptor.attemptSha256);assert.equal(attempt.run_id,descriptor.runId);
 assert.equal(attempt.prompt_sha256,sha(request.prompt));assert.equal(bytes.includes(Buffer.from(request.prompt)),false);
 const header=JSON.parse(await fs.readFile(path.join(descriptor.directory,'host-callback-custody','0000000000000000.json')));
 assert.equal(header.event.kind,'HEADER');assert.equal(header.event.run_id,descriptor.runId);
 await assert.rejects(fs.stat(f.workerTempRoot),{code:'ENOENT'});
 assert.equal(runner.abandonPrepared(handle).physical_settlement,'NOT_ATTESTED');
 assert.deepEqual(await fs.readFile(descriptor.attemptPath),bytes,'abandonment preserves immutable evidence');
});

test('prepared runner snapshots original request and never extends the first lease expiry',async t=>{
 const f=await fixture(t),phases=[];let resumed,firstExpiry;const processController=controller({onResume:prompt=>{resumed=prompt;}});
 const runner=createCodexCliRunner({...f,processController,authorizeLease:async value=>{
  phases.push(value.phase);const permit=await f.authorizeLease(value);
  if(value.phase==='BEFORE_ATTEMPT')firstExpiry=permit.expires_at;else permit.expires_at=new Date(Date.parse(firstExpiry)+600000).toISOString();return permit;
 }});
 const request=preparedRequest(f),original=structuredClone(request),preparing=runner.prepare(request);
 request.prompt='MUTATED';request.role='CRITIC';request.worktreePath=f.directory;request.lease.task_id=id(999);request.lease.base_sha='0'.repeat(40);
 const handle=await preparing,descriptor=runner.describePrepared(handle);
 f.permits[0].owner_epoch=999;f.permits[0].expires_at=new Date(Date.parse(firstExpiry)+1200000).toISOString();
 const receipt=await runner.runPrepared(handle);
 assert.equal(receipt.state,'RESULT_READY');assert.equal(resumed,original.prompt);assert.equal(receipt.prompt_sha256,sha(original.prompt));
 assert.equal(receipt.task_id,original.lease.task_id);assert.equal(receipt.role,original.role);assert.equal(receipt.worktree_path,original.worktreePath);
 assert.equal(receipt.run_id,descriptor.runId);assert.equal(receipt.execution_deadline,firstExpiry);assert.equal(processController.lastSpec.deadlineAt,firstExpiry);
 assert.deepEqual(phases,['BEFORE_ATTEMPT','BEFORE_PREPARED_RUN','BEFORE_RESUME','AFTER_EXECUTION']);
});

test('prepared handles cannot be forged, serialized, cloned or adopted by another runner',async t=>{
 const f=await fixture(t),processController=controller(),runner=createCodexCliRunner({...f,processController});
 const foreign=createCodexCliRunner({...f,processController:controller()}),handle=await runner.prepare(preparedRequest(f));
 assert.throws(()=>JSON.stringify(handle),/prepared_handle_not_serializable/);assert.throws(()=>structuredClone(handle),{name:'DataCloneError'});
 for(const forged of [{},null,JSON.parse(JSON.stringify(runner.describePrepared(handle))),Object.create(handle)])
  await assert.rejects(runner.runPrepared(forged),/prepared_handle_invalid/);
 await assert.rejects(foreign.runPrepared(handle),/prepared_handle_invalid/);assert.throws(()=>foreign.describePrepared(handle),/prepared_handle_invalid/);
 assert.equal((await runner.runPrepared(handle)).state,'RESULT_READY');assert.equal(processController.spawns,1);
});

test('prepared handle consumption is synchronous and cannot duplicate or join a concurrent launch',async t=>{
 const f=await fixture(t),processController=controller(),entered=Promise.withResolvers(),release=Promise.withResolvers();
 t.after(()=>release.resolve());
 const runner=createCodexCliRunner({...f,processController,authorizeLease:async value=>{
  if(value.phase==='BEFORE_PREPARED_RUN'){entered.resolve();await release.promise;}return f.authorizeLease(value);
 }}),handle=await runner.prepare(preparedRequest(f)),first=runner.runPrepared(handle);
 await entered.promise;await assert.rejects(runner.runPrepared(handle),/prepared_handle_consumed/);assert.equal(processController.spawns,0);
 release.resolve();assert.equal((await first).state,'RESULT_READY');await assert.rejects(runner.runPrepared(handle),/prepared_handle_consumed/);
 assert.equal(processController.spawns,1);
});

for(const mode of ['cancel','abandon','during-recheck'])test(`prepared runner ${mode} fences before any process or bridge creation`,async t=>{
 const f=await fixture(t),processController=controller(),abort=new AbortController(),entered=Promise.withResolvers(),release=Promise.withResolvers();
 let bridges=0;t.after(()=>release.resolve());
 const runner=createCodexCliRunner({...f,processController,authorizeLease:async value=>{
  if(mode==='during-recheck'&&value.phase==='BEFORE_PREPARED_RUN'){entered.resolve();await release.promise;}return f.authorizeLease(value);
 },prepareAgentBridge:async()=>{bridges++;throw Error('must not dispatch');}}),request=preparedRequest(f),handle=await runner.prepare(request,{signal:abort.signal});
 const descriptor=runner.describePrepared(handle),before=await fs.readFile(descriptor.attemptPath);let running;
 if(mode==='during-recheck'){running=runner.runPrepared(handle);await entered.promise;runner.abandonPrepared(handle);release.resolve();}
 else {if(mode==='cancel')abort.abort();else runner.abandonPrepared(handle);running=runner.runPrepared(handle);}
 await assert.rejects(running,/prepared_(run_cancelled|handle_consumed)/);
 assert.equal(processController.spawns,0);assert.equal(bridges,0);assert.deepEqual(await fs.readFile(descriptor.attemptPath),before);
 const prior=await runner.run(request);assert.equal(prior.prior_attempt,true);assert.equal(prior.state,'AMBIGUOUS');assert.equal(processController.spawns,0);
});

test('expired original preparation cannot acquire a fresh lease deadline',async t=>{
 const f=await fixture(t),processController=controller(),runner=createCodexCliRunner({...f,processController}),handle=await runner.prepare(preparedRequest(f));
 const expiry=Date.parse(runner.describePrepared(handle).expiresAt);t.mock.method(Date,'now',()=>expiry+1);
 await assert.rejects(runner.runPrepared(handle),/prepared_lease_expired/);assert.equal(processController.spawns,0);
});

for(const field of ['revoked','permit_id','owner_epoch','workspace_id','project_id','user_sid'])test(`prepared runner refuses current permit drift: ${field}`,async t=>{
 const f=await fixture(t),processController=controller(),runner=createCodexCliRunner({...f,processController,authorizeLease:async value=>{
  const permit=await f.authorizeLease(value);if(value.phase!=='BEFORE_PREPARED_RUN')return permit;
  if(field==='revoked')return null;return {...permit,[field]:field==='owner_epoch'?5:field==='user_sid'?'S-1-5-21-999-1001':id(333)};
 }}),handle=await runner.prepare(preparedRequest(f));
 await assert.rejects(runner.runPrepared(handle),/authorization_denied|prepared_lease_changed/);assert.equal(processController.spawns,0);
});

for(const mode of ['worktree-bytes','worktree-directory','attempt-bytes','attempt-replaced','run-directory','journal-ancestor','executable','worktree-pointer','worktree-lock','callback-header'])
 test(`prepared physical identity refuses gap mutation: ${mode}`,async t=>{
 const f=await fixture(t),processController=controller();let bridges=0;
 const runner=createCodexCliRunner({...f,processController,prepareAgentBridge:async()=>{bridges++;throw Error('must not dispatch');}});
 const handle=await runner.prepare(preparedRequest(f)),d=runner.describePrepared(handle);
 const replaceFile=async file=>{const bytes=await fs.readFile(file);await fs.rename(file,file+'.original');await fs.writeFile(file,bytes);};
 if(mode==='worktree-bytes')await fs.writeFile(path.join(f.worktree,'feature.txt'),'changed during preparation gap\n');
 if(mode==='attempt-bytes')await fs.appendFile(d.attemptPath,' ');
 if(mode==='attempt-replaced')await replaceFile(d.attemptPath);
 if(mode==='executable')await replaceFile(f.executablePath);
 if(mode==='worktree-pointer')await replaceFile(path.join(f.worktree,'.git'));
 if(mode==='worktree-lock'){
  const directory=(await exec('git',['rev-parse','--absolute-git-dir'],{cwd:f.worktree})).stdout.trim();await replaceFile(path.join(directory,'locked'));
 }
 if(mode==='worktree-directory'||mode==='run-directory'){
  const directory=mode==='worktree-directory'?f.worktree:d.directory;await fs.rename(directory,directory+'.original');await fs.cp(directory+'.original',directory,{recursive:true});
 }
 if(mode==='journal-ancestor'){
  await fs.rename(f.journalRoot,f.journalRoot+'.original');await fs.mkdir(f.journalRoot);await fs.rename(path.join(f.journalRoot+'.original',path.basename(d.directory)),d.directory);
 }
 if(mode==='callback-header')await replaceFile(path.join(d.directory,'host-callback-custody','0000000000000000.json'));
 await assert.rejects(runner.runPrepared(handle),/prepared_(identity|worktree|attempt)_changed/);assert.equal(processController.spawns,0);assert.equal(bridges,0);
});

test('prepared EEXIST directory is readback/HOLD only and cannot create another attempt',async t=>{
 const f=await fixture(t),processController=controller(),request=preparedRequest(f),runner=createCodexCliRunner({...f,processController});
 const key=sha(JSON.stringify({task_id:request.lease.task_id,lease_generation:1,role:request.role}));
 await fs.mkdir(path.join(f.journalRoot,key),{recursive:true});const handle=await runner.prepare(request);
 assert.equal(runner.describePrepared(handle).state,'READBACK_ONLY');assert.equal(runner.describePrepared(handle).sql_reservation,'NOT_ATTESTED');
 assert.equal((await runner.runPrepared(handle)).terminal_reason,'RESERVATION_EXISTS');assert.equal(processController.spawns,0);
 assert.deepEqual(await fs.readdir(path.join(f.journalRoot,key)),[]);
});

test('failed callback HEADER creation leaves an original attempt for readback, never a send-ready preparation',async t=>{
 const f=await fixture(t),processController=controller(),request=preparedRequest(f),original=fs.mkdir;
 const runner=createCodexCliRunner({...f,processController,prepareAgentBridge:async()=>{throw Error('must not dispatch');}});
 t.mock.method(fs,'mkdir',async(file,...args)=>{if(path.basename(file)==='host-callback-custody')throw Error('fixture_header_io_failure');return original(file,...args);});
 await assert.rejects(runner.prepare(request),/native_run_callback_journal_hold/);
 const prior=await runner.run(request);assert.equal(prior.state,'AMBIGUOUS');assert.equal(prior.prior_attempt,true);assert.equal(processController.spawns,0);
});

test('actual prepared default bridge gate stays closed after HEADER creation and before broker/native effects',async t=>{
 const f=await fixture(t),processController=controller();let bridges=0,custody=0;
 const runner=createCodexCliRunner({...f,processController,prepareAgentBridge:async details=>{
  bridges++;const a=details.authorization,permit={...details.binding,...a,trust_namespace:'LOCAL_OPERATOR_QA',revoked:false,provider_id:id(55),
   artifact:{cli_executable_sha256:f.expectedExecutableSha256},worktree:{path:a.worktree_path,base_sha:details.binding.base_sha}};
  return prepareNativeCodingAgentRunBridge({...details,permit,pins:{},ownPostgres:{openAgentRunCustody:async()=>{custody++;throw Error('forbidden');}}});
 }}),handle=await runner.prepare(preparedRequest(f));
 assert.equal(bridges,0);assert.equal(runner.describePrepared(handle).callbackJournal.snapshot().records,1);
 const receipt=await runner.runPrepared(handle);assert.equal(receipt.state,'AMBIGUOUS');assert.equal(receipt.terminal_reason,'native_run_callback_directory_durability_unqualified');
 assert.equal(bridges,1);assert.equal(custody,0);assert.equal(processController.spawns,0);
});

test('prepared runner retains ATTEMPTED and W30 RUNNING acknowledgment before bindRun and prompt resume',async t=>{
 const f=await fixture(t),pins=await agentBridgePins(t),events=[];let callbackJournal;
 const processController=controller({onResume:()=>{events.push('resume');}});
 const runner=createCodexCliRunner({...f,processController,authorizeLease:async value=>{
  if(value.phase==='BEFORE_RESUME')events.push('ATTEMPTED','W30_RUNNING');return f.authorizeLease(value);
 },prepareAgentBridge:async details=>{
  assert.equal(details.callbackJournal,callbackJournal);events.push('bridge');
  const binding={run_id:details.runId,workspace_id:details.authorization.workspace_id,project_id:details.authorization.project_id,
   task_id:details.binding.task_id,lease_generation:details.binding.lease_generation,agent_id:details.binding.agent_id,
   agent_generation_epoch:details.binding.agent_generation_epoch,provider_id:id(55),role:details.binding.role};
  const launch=await createNativeCodingAgentMcpLaunch({...pins,registration:{binding,endpoint:'fixture-only-no-socket',capability:'c'.repeat(64),allowedTools:['project_overview']}});
  // Generated lifecycle double only: no broker, model, real W30 write or native proof.
  return {launch,bindRun:async()=>{events.push('bindRun');},close:async()=>{events.push('close');}};
 }}),handle=await runner.prepare(preparedRequest(f));callbackJournal=runner.describePrepared(handle).callbackJournal;
 assert.deepEqual(events,[]);assert.equal((await runner.runPrepared(handle)).state,'RESULT_READY');
 assert.deepEqual(events,['bridge','ATTEMPTED','W30_RUNNING','bindRun','resume','close']);
});

test('prepared fence during immutable launch publication prevents a late native spawn',async t=>{
 const f=await fixture(t),processController=controller(),runner=createCodexCliRunner({...f,processController});
 const prepared=await runner.prepare(preparedRequest(f)),entered=Promise.withResolvers(),release=Promise.withResolvers(),original=fs.open;t.after(()=>release.resolve());
 t.mock.method(fs,'open',async(file,...args)=>{
  const handle=await original(file,...args);if(path.basename(file)!=='launch.json')return handle;
  return {async writeFile(...values){entered.resolve();await release.promise;return handle.writeFile(...values);},sync:handle.sync.bind(handle),close:handle.close.bind(handle)};
 });
 const running=runner.runPrepared(prepared);await entered.promise;runner.abandonPrepared(prepared);release.resolve();
 const receipt=await running;assert.equal(receipt.state,'AMBIGUOUS');assert.equal(processController.spawns,0);
 assert.equal(receipt.physical_settlement,undefined);assert.equal(receipt.automatic_retry_allowed,false);
});

for(const mode of ['dirty','unlocked','executable-digest','project-config','cancelled'])test(`inert prepare retains original precondition: ${mode}`,async t=>{
 const f=await fixture(t),processController=controller(),abort=new AbortController();let bridges=0;
 if(mode==='dirty')await fs.writeFile(path.join(f.worktree,'feature.txt'),'unapproved bytes\n');
 if(mode==='unlocked')await exec('git',['worktree','unlock',f.worktree],{cwd:path.join(f.directory,'repo')});
 if(mode==='executable-digest')await fs.writeFile(f.executablePath,'changed executable');
 if(mode==='project-config'){await fs.mkdir(path.join(f.worktree,'.codex'));await fs.writeFile(path.join(f.worktree,'.codex','config.toml'),'model="unapproved"\n');}
 if(mode==='cancelled')abort.abort();
 const runner=createCodexCliRunner({...f,processController,prepareAgentBridge:async()=>{bridges++;throw Error('forbidden');}});
 await assert.rejects(runner.prepare(preparedRequest(f),{signal:abort.signal}));
 assert.equal(processController.spawns,0);assert.equal(bridges,0);await assert.rejects(fs.stat(f.journalRoot),{code:'ENOENT'});
});

test('prepared critic revalidates the original independent writer receipt after the gap',async t=>{
 const f=await fixture(t),processController=controller(),runner=createCodexCliRunner({...f,processController});
 const writer=await runner.run({lease:f.lease(1),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'Generated writer fixture'});
 const subject={task_id:writer.task_id,lease_generation:writer.lease_generation,run_id:writer.run_id,result_sha256:writer.result_sha256,
  git_artifact_sha256:writer.git_after.artifact_sha256,source_head:writer.git_after.head};
 const prepared=await runner.prepare({lease:f.lease(2),role:'CRITIC',subject,worktreePath:f.worktree,prompt:'Review original writer'});
 const key=sha(JSON.stringify({task_id:writer.task_id,lease_generation:writer.lease_generation,role:'IMPLEMENTER'}));
 const file=path.join(f.journalRoot,key,'receipt.json');const changed=JSON.parse(await fs.readFile(file));changed.result.summary='changed after critic preparation';await fs.writeFile(file,JSON.stringify(changed));
 await assert.rejects(runner.runPrepared(prepared),/prepared_subject_changed/);assert.equal(processController.spawns,1,'only original fixture writer spawned');
});

test('cancellation while prepare awaits authorization creates no attempt or callback HEADER',async t=>{
 const f=await fixture(t),processController=controller(),abort=new AbortController(),entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());
 const runner=createCodexCliRunner({...f,processController,authorizeLease:async value=>{entered.resolve();await release.promise;return f.authorizeLease(value);},prepareAgentBridge:async()=>{throw Error('forbidden');}});
 const preparing=runner.prepare(preparedRequest(f),{signal:abort.signal});await entered.promise;abort.abort();release.resolve();
 await assert.rejects(preparing,/cancelled_before_attempt/);assert.equal(processController.spawns,0);await assert.rejects(fs.stat(f.journalRoot),{code:'ENOENT'});
});

test('current prepared permit may shorten but not refresh the original execution deadline',async t=>{
 const f=await fixture(t),processController=controller();let initial,shortened;
 const runner=createCodexCliRunner({...f,processController,authorizeLease:async value=>{
  const permit=await f.authorizeLease(value);if(value.phase==='BEFORE_ATTEMPT')initial=permit.expires_at;
  if(value.phase==='BEFORE_PREPARED_RUN')permit.expires_at=shortened=new Date(Date.parse(initial)-10000).toISOString();return permit;
 }}),prepared=await runner.prepare(preparedRequest(f)),receipt=await runner.runPrepared(prepared);
 assert.equal(receipt.state,'RESULT_READY');assert.equal(processController.lastSpec.deadlineAt,shortened);assert.equal(receipt.execution_deadline,shortened);
});

test('abandoning an executing prepared handle retains the original generated worker cleanup promise',async t=>{
 const f=await fixture(t);let runner,prepared;const processController=controller({hang:true,onResume:()=>{assert.equal(runner.abandonPrepared(prepared).physical_settlement,'NOT_ATTESTED');}});
 runner=createCodexCliRunner({...f,processController});prepared=await runner.prepare(preparedRequest(f));
 const receipt=await runner.runPrepared(prepared);assert.equal(receipt.state,'AMBIGUOUS');assert.equal(receipt.terminal_reason,'CANCELLED');assert.equal(processController.spawns,1);
 assert.equal(receipt.local_output_drain.scope,'HELPER_TREE_AND_LOCAL_OUTPUT');assert.equal(receipt.local_output_drain.host_scope_callbacks,'NOT_ATTESTED');
 await assert.rejects(runner.runPrepared(prepared),/prepared_handle_consumed/);
});

for(const stop of ['cancel','expire'])for(const stage of ['worktree-pin','journal-root-mkdir','exclusive-directory-mkdir','run-directory-pin','attempt-write','attempt-pin'])
 test(`preparation ${stop} during held ${stage} prevents every subsequent local write and SQL reservation`,async t=>{
 const f=await fixture(t),request=preparedRequest(f),processController=controller(),abort=new AbortController();
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());
 const expiry=new Date(Date.now()+60000).toISOString(),provider=id(55),writes=[];let held=false,reserves=0,bridges=0;
 const key=sha(JSON.stringify({task_id:request.lease.task_id,lease_generation:request.lease.lease_generation,role:request.role}));
 const directory=path.join(f.journalRoot,key),attempt=path.join(directory,'attempt.json');
 const hold=async()=>{if(held)return;held=true;entered.resolve();await release.promise;};
 const originalStat=fs.lstat,originalMkdir=fs.mkdir,originalOpen=fs.open;
 t.mock.method(fs,'lstat',async(file,options)=>{
  const result=await originalStat(file,options);
  if(options?.bigint&&((stage==='worktree-pin'&&file===f.worktree)||(stage==='run-directory-pin'&&file===directory)||(stage==='attempt-pin'&&file===attempt)))await hold();
  return result;
 });
 t.mock.method(fs,'mkdir',async(file,...args)=>{
  writes.push(`mkdir:${path.relative(f.directory,file)}`);const result=await originalMkdir(file,...args);
  if((stage==='journal-root-mkdir'&&file===f.journalRoot)||(stage==='exclusive-directory-mkdir'&&file===directory))await hold();return result;
 });
 t.mock.method(fs,'open',async(file,...args)=>{
  if(args[0]==='wx')writes.push(`create:${path.relative(f.directory,file)}`);
  const handle=await originalOpen(file,...args);if(stage!=='attempt-write'||file!==attempt||args[0]!=='wx')return handle;
  return {async writeFile(...values){await handle.writeFile(...values);await hold();},sync:handle.sync.bind(handle),close:handle.close.bind(handle)};
 });
 const scope={workspace_id:id(88),task_id:request.lease.task_id,lease_generation:request.lease.lease_generation,agent_id:request.lease.agent_id,
  target_id:`codex-cli:${provider}`,agent_generation_epoch:request.lease.agent_generation_epoch,
  host_incarnation:'pid:123:created_100ns:134054310000000000',scope_sha256:'b'.repeat(64)};
 const executor=createNativeCodingLeaseExecutor({
  ledger:{reserve:async()=>{reserves++;throw Error('must not reserve');},advance:async()=>{throw Error('must not advance');},read:async()=>({state:'UNKNOWN',fixture_only:true})},
  issuer:{issueJob:async()=>{throw Error('must not sign');}},
  readBoundLease:async()=>({scope,provider_id:provider,lease_expires_at:expiry,
   permit:await f.authorizeLease({binding:{...request.lease,role:request.role},worktreePath:f.worktree})}),
  createRunner:({authorizeLease})=>createCodexCliRunner({...f,authorizeLease,processController,prepareAgentBridge:async()=>{bridges++;throw Error('must not dispatch');}}),
 });
 const pending=executor.execute(request,{signal:abort.signal});await entered.promise;const atStop=[...writes];
 if(stop==='cancel')abort.abort();else t.mock.method(Date,'now',()=>Date.parse(expiry)+1);
 release.resolve();await assert.rejects(pending,error=>error.automatic_retry_allowed===false);
 assert.deepEqual(writes,atStop,'the owned pending operation may finish, but no subsequent write may start');
 assert.equal(reserves,0);assert.equal(processController.spawns,0);assert.equal(bridges,0);
 await assert.rejects(fs.stat(path.join(directory,'host-callback-custody')),{code:'ENOENT'});
 if(['exclusive-directory-mkdir','run-directory-pin','attempt-write','attempt-pin'].includes(stage)){
  assert.equal((await fs.stat(directory)).isDirectory(),true,'incomplete exclusive directory must not be deleted');
  const readbackRunner=createCodexCliRunner({...f,processController});
  const prior=await readbackRunner.run(request);assert.equal(prior.state,'AMBIGUOUS');assert.equal(processController.spawns,0);
  assert.equal(prior.automatic_retry_allowed,false);assert.equal(prior.terminal_reason,stage==='attempt-write'||stage==='attempt-pin'?'PRIOR_ATTEMPT_REQUIRES_RECONCILIATION':'RESERVATION_EXISTS');
 }
});
