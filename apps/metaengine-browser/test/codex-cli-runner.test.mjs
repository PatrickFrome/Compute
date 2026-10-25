import test from 'node:test';
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
import { createCodexCliWindowsProcessController, resolveCodexCliJobHelper } from '../src/codex-cli-windows-process-controller.mjs';
import { CODEX_CLI_RESULT_SCHEMA, validateCodexCliResult } from '../src/codex-cli-result-schema.mjs';
import {prepareNativeCodingAgentRunBridge} from '../src/native-coding-agent-run-bridge.mjs';
import {agentBridgePins} from './fixtures/native-coding-agent-bridge-pins.mjs';
import {connectNativeCodingAgentMcpBroker} from '../src/native-coding-agent-mcp-broker.mjs';
import {NATIVE_AGENT_MCP_ENV} from '../src/native-coding-agent-mcp-entry.mjs';

const exec = promisify(execFile);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const sid = 'S-1-5-21-123-456-789-1001';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const agent = n => `agent_test-${String(n).padStart(8, '0')}`;
const result = role => ({ schema: CODEX_CLI_RESULT_SCHEMA, role, outcome: 'DONE', summary: 'Useful change proposed', checks: [], followup_tasks: [] });

test('packaged PowerShell helper resolves outside ASAR and is explicitly shipped as a resource', async () => {
  const resourcesPath = path.resolve(os.tmpdir(), 'packaged-resources');
  const moduleUrl = pathToFileURL(path.join(resourcesPath, 'app.asar', 'src', 'codex-cli-windows-process-controller.mjs')).href;
  assert.equal(resolveCodexCliJobHelper({ moduleUrl, resourcesPath }), path.join(resourcesPath, 'native-coding', 'codex-cli-job-runner.ps1'));
  assert.throws(() => resolveCodexCliJobHelper({ moduleUrl, resourcesPath: undefined }), /packaged_resources_required/);
  const config = JSON.parse(await fs.readFile(new URL('../electron-builder.test.json', import.meta.url), 'utf8'));
  assert.ok(config.extraResources.some(value => value.from === 'scripts/codex-cli-job-runner.ps1' && value.to === 'native-coding/codex-cli-job-runner.ps1'));
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-codex-runner-'));
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
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
    return { proof: { pid: 12345, process_incarnation_id: 'pid:12345:created_100ns:133333333333333333',
      user_sid: sid, job_id: spec.runId, tree_control_bound: true, started_suspended: true,job_bound_before_resume:true,
      executable_sha256: spec.expectedExecutableSha256 }, stdout, stderr, completion,
      async resume() {
        await onResume?.();
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
        finish({ exit_code: 0, reason: null, tree_cleanup_confirmed: true });
      },
      async terminate(reason) { finish({ exit_code: 124, reason, tree_cleanup_confirmed: true }); },
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

test('runner binds real private broker only after RUNNING authorization and before prompt resume, then revokes',async t=>{
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
    bridge=await prepareNativeCodingAgentRunBridge({...details,permit,pins,ownPostgres:{async agentOperation(value){
      events.push(value.operation);assert.equal(running,true);
      return value.operation==='CHECK'?{schema:'metaengine.native-coding.agent-authorized.v1',run_id:details.runId,authorized:true,authority_effect:false}:{rows:[]};
    }}});return bridge;
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

test('unverified bridge descriptor or Host bind refusal cannot resume the suspended worker',async t=>{
  for(const mode of ['unverified','bind-refused']){
    const f=await fixture(t),processController=controller();let closes=0;
    let pins;if(mode==='bind-refused')pins=await agentBridgePins(t);
    const runner=createCodexCliRunner({...f,processController,async prepareAgentBridge(details){
      if(mode==='unverified')return {launch:{argv:['--dangerously-bypass-approvals-and-sandbox']},bindRun:async()=>{},close:async()=>{closes++;}};
      const a=details.authorization,permit={...details.binding,...a,trust_namespace:'LOCAL_OPERATOR_QA',revoked:false,provider_id:id(55),
        artifact:{cli_executable_sha256:f.expectedExecutableSha256},worktree:{path:a.worktree_path,base_sha:details.binding.base_sha}};
      return prepareNativeCodingAgentRunBridge({...details,permit,pins,ownPostgres:{agentOperation:async()=>{throw Error('fixture_current_lease_rejected');}}});
    }});
    const receipt=await runner.run({lease:f.lease(1),role:'IMPLEMENTER',worktreePath:f.worktree,prompt:'Never resume'});
    assert.equal(receipt.state,'AMBIGUOUS');assert.equal(await fs.readFile(path.join(f.worktree,'feature.txt'),'utf8'),'before\n');
    assert.equal(processController.spawns,mode==='unverified'?0:1);if(mode==='unverified')assert.equal(closes,1);
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
  const handle = await processController.spawn({ executablePath: process.execPath, expectedExecutableSha256,
    args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'argument with spaces', 'quote"and\\slash', 'тест🚀'],
    cwd: os.tmpdir(), env: codexCliEnvironment(path.join(os.tmpdir(), 'unused-auth')), timeoutMs: 10000, runId: crypto.randomUUID() });
  assert.equal(handle.proof.started_suspended, true); assert.equal(handle.proof.tree_control_bound, true);
  assert.deepEqual(JSON.parse(JSON.stringify(handle.proof)),handle.proof,'native proof must remain exact across protected JSON and private IPC');
  let output = ''; handle.stdout.setEncoding('utf8'); handle.stdout.on('data', value => { output += value; });
  await handle.resume(''); const completion = await handle.completion;
  assert.equal(completion.exit_code, 0); assert.equal(completion.tree_cleanup_confirmed, true);
  assert.deepEqual(JSON.parse(output), ['argument with spaces', 'quote"and\\slash', 'тест🚀']);
});

test('real Windows deadline kills the exact job and its descendant without any model call', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-codex-timeout-'));
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
  const canary = path.join(directory, 'must-not-exist.txt');
  const descendant = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(canary)},'escaped'),2000)`;
  const script = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  const processController = createCodexCliWindowsProcessController();
  const handle = await processController.spawn({ executablePath: process.execPath, expectedExecutableSha256: sha(await fs.readFile(process.execPath)),
    args: ['-e', script], cwd: directory, env: codexCliEnvironment(path.join(directory, 'unused-auth')), timeoutMs: 300, runId: crypto.randomUUID() });
  handle.stdout.resume(); handle.stderr.resume(); await handle.resume('');
  const completion = await handle.completion;
  assert.equal(completion.reason, 'TIMEOUT'); assert.equal(completion.tree_cleanup_confirmed, true);
  await assert.rejects(fs.stat(canary), { code: 'ENOENT' });
});

test('native absolute deadline can be shortened at resume and stops the real child before relative timeout', { skip: process.platform !== 'win32' }, async () => {
  const processController = createCodexCliWindowsProcessController();
  const handle = await processController.spawn({ executablePath: process.execPath, expectedExecutableSha256: sha(await fs.readFile(process.execPath)),
    args: ['-e', 'process.stdout.write("started");setInterval(()=>{},1000)'], cwd: os.tmpdir(),
    env: codexCliEnvironment(path.join(os.tmpdir(), 'unused-auth')), timeoutMs: 10000,
    deadlineAt: new Date(Date.now() + 20000).toISOString(), runId: crypto.randomUUID() });
  let output = ''; handle.stdout.on('data', value => { output += value.toString(); }); handle.stderr.resume();
  const resumedAt = Date.now(); await handle.resume('', { deadlineAt: new Date(Date.now() + 600).toISOString() });
  const completion = await handle.completion;
  assert.equal(completion.reason, 'TIMEOUT'); assert.equal(completion.tree_cleanup_confirmed, true);
  assert.equal(output, 'started'); assert.ok(Date.now() - resumedAt < 4000);
});

test('an expired native deadline cannot resume a suspended child', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-codex-expiry-'));
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
  const canary = path.join(directory, 'must-not-exist.txt');
  const processController = createCodexCliWindowsProcessController();
  const handle = await processController.spawn({ executablePath: process.execPath, expectedExecutableSha256: sha(await fs.readFile(process.execPath)),
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(canary)},'ran')`], cwd: directory,
    env: codexCliEnvironment(path.join(directory, 'unused-auth')), timeoutMs: 10000,
    deadlineAt: new Date(Date.now() - 1).toISOString(), runId: crypto.randomUUID() });
  await assert.rejects(handle.resume(''), /deadline_expired_before_resume/);
  await handle.terminate('EXPIRED');
  await assert.rejects(fs.stat(canary), { code: 'ENOENT' });
});
