import test from 'node:test';
import assert from 'node:assert/strict';
import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {PRIVATE_NATIVE_TOOL_REQUIRED_FILES, privateNativeToolsBinding, resolvePrivateNativeTools} from '../src/private-native-tools.mjs';
import {createShellFreeGitExecutor} from '../src/managed-task-project-runtime.mjs';
import {readManagedTaskProjectRepository} from '../src/managed-task-project-repository.mjs';
import candidateModule from '../src/candidate-capsule.cjs';
import {createDevelopmentVerificationSqliteJournal, verificationDigest} from '../src/development-verification-sqlite-journal.mjs';

// These adapters are explicitly generated source-only. They exercise the
// production default composition without privateTools/runGit/gitExecutor DI,
// but are NOT a genuine packaged-Electron launch fixture. No fixture EXE/DLL
// bytes are executed, and no verification hook is added to production source.
const HEAD = '1'.repeat(40);
const ENTRY = 'source/infra/client-state-runtime/fresh-client-provider.mjs';
const IDENTITY_ENTRY = 'source/infra/client-state-runtime/fresh-provider-native-device-identity.mjs';
const PROTECTED = ['GIT_EXEC_PATH', 'GIT_SSL_CAINFO', 'SSL_CERT_FILE', 'OPENSSL_CONF', 'OPENSSL_MODULES', 'PATH'];
const HOSTILE = {
  PATH: '/source-only-shadow-helper', GIT_EXEC_PATH: '/source-only-shadow-helper',
  GIT_SSL_CAINFO: '/untrusted-ca', SSL_CERT_FILE: '/untrusted-cert',
  OPENSSL_CONF: '/untrusted-config', OPENSSL_MODULES: '/untrusted-modules',
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: 'source-only-shadow',
  GIT_DIR: '/untrusted-git-dir', GIT_WORK_TREE: '/untrusted-worktree',
  GITHUB_TOKEN: 'inert-source-only-value', SSH_AUTH_SOCK: '/inert-source-only-agent',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Source-only storage adapter. No native ACL observer or policy mutation runs
// in these generated composition tests; separate native storage suites own it.
const sourceOnlyStorage = {platform: 'win32',
  protectStorage: async () => ({operation: 'PROTECT_DIRECTORY', owner_dacl_verified: true}),
  verifyStorage: async (_path, {operation = 'VERIFY_FILE'} = {}) => ({operation, owner_dacl_verified: true})};
function replaceOnce(source, old, replacement) {
  assert.equal(source.split(old).length - 1, 1, `source-only fixture anchor: ${old}`);
  return source.replace(old, replacement);
}

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'private-tools-main-source-'));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const resources = path.join(root, 'resources');
  const toolsRoot = path.join(resources, 'private-native-tools');
  const appPath = path.join(root, 'app');
  const code = path.join(root, 'generated-source-only');
  const repo = path.join(root, 'repo');
  const managed = path.join(root, 'projects');
  const userData = path.join(root, 'user-data');
  const snapshots = path.join(root, 'snapshots');
  const owner = path.join(root, 'owner');
  for (const directory of [toolsRoot, appPath, code, repo, managed, userData, snapshots, owner])
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
  const components = [];
  for (const [id, entrypoint] of [['git', 'ucrt64/bin/git.exe'], ['codex', 'bin/codex.exe']]) {
    const extras = id === 'git' ? ['ucrt64/libexec/git-core/git-helper', 'ucrt64/etc/ssl/cert.pem',
      'ucrt64/etc/ssl/openssl.cnf', 'ucrt64/lib/ossl-modules/source-only.txt'] : [];
    const rows = [];
    for (const name of [...new Set([...PRIVATE_NATIVE_TOOL_REQUIRED_FILES[id], ...extras])].sort()) {
      const file = path.join(toolsRoot, id, name);
      const bytes = Buffer.from('inert generated source-only fixture: ' + name);
      await fs.mkdir(path.dirname(file), {recursive: true});
      await fs.writeFile(file, bytes);
      rows.push({path: name, bytes: bytes.length, sha256: sha(bytes)});
    }
    components.push({id, version: id === 'git' ? '2.56.0.4' : '0.166.0',
      repository: id === 'git' ? 'git-for-windows/git' : 'openai/codex', tag: 'source-only', release_id: 1, asset_id: 2,
      archive_name: id + '.zip', archive_sha256: 'a'.repeat(64), archive_bytes: 1, entrypoint, files: rows});
  }
  const bytes = Buffer.from(JSON.stringify({schema: 'metaengine.private-native-tools.v1', platform: 'win32', arch: 'x64', components}));
  await fs.writeFile(path.join(toolsRoot, 'manifest.json'), bytes);
  const binding = privateNativeToolsBinding(bytes);
  await fs.writeFile(path.join(appPath, 'package.json'), JSON.stringify({metaenginePrivateNativeTools: binding}));
  const expected = await resolvePrivateNativeTools({toolsRoot, binding});
  const output = name => pathToFileURL(path.join(code, name)).href;
  const contextURL = output('source-only-context.mjs');
  const childURL = output('source-only-child-process.mjs');
  await fs.writeFile(new URL(contextURL), `
import realProcess from 'node:process';
export const state = {events: [], syncOutputs: [], holdToolsRead: null};
export const app = {isPackaged: true, getAppPath: () => ${JSON.stringify(appPath)},
  whenReady: async () => {state.events.push({kind: 'ready'});}};
export const mainProcess = {versions: {electron: 'generated-source-only'}, type: 'browser',
  platform: 'win32', arch: 'x64', resourcesPath: ${JSON.stringify(resources)}};
export const sourceProcess = {platform: realProcess.platform, pid: realProcess.pid,
  kill: (...args) => realProcess.kill(...args), env: ${JSON.stringify(HOSTILE)}};
`);
  await fs.writeFile(new URL(childURL), `
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {promisify} from 'node:util';
import {state} from ${JSON.stringify(contextURL)};
const record = (kind, executable, argv, options) => state.events.push({kind, executable,
  argv: [...argv], cwd: options.cwd, env: {...options.env}, input: options.input});
export function spawn(executable, argv, options) {
  record('spawn', executable, argv, options);
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
  queueMicrotask(() => {child.stdout.end('source-only fixed readback'); child.stderr.end(); child.emit('close', 0, null);});
  return child;
}
export function execFile() {throw Error('source_only_callback_exec_not_used');}
execFile[promisify.custom] = async (executable, argv, options) => {
  record('exec', executable, argv, options);
  if (argv.join(' ') === 'rev-parse --show-toplevel') return {stdout: options.cwd + String.fromCharCode(10), stderr: ''};
  if (argv.join(' ') === 'rev-parse --verify HEAD^{commit}') return {stdout: ${JSON.stringify(HEAD)} + String.fromCharCode(10), stderr: ''};
  throw Error('source_only_unexpected_repository_argv');
};
export function execFileSync(executable, argv, options) {
  record('sync', executable, argv, options);
  if (!state.syncOutputs.length) throw Error('source_only_missing_git_frame');
  return Buffer.from(state.syncOutputs.shift());
}
`);
  const names = ['private-native-tools.mjs', 'managed-task-project-runtime.mjs', 'managed-task-project-repository.mjs',
    'managed-task-project-host.mjs', 'development-verification-runtime.mjs', 'installed-fresh-provider-setup.mjs'];
  for (const name of names) {
    const originalURL = new URL('../src/' + name, import.meta.url);
    let source = await fs.readFile(originalURL, 'utf8');
    source = source.replace(/from '(\.[^']+)'/g, (match, specifier) => {
      const target = names.includes(specifier.slice(2)) ? output(specifier.slice(2)) : new URL(specifier, originalURL).href;
      return 'from ' + JSON.stringify(target);
    });
    if (name === 'private-native-tools.mjs') {
      source = replaceOnce(source,
        "const fs = (process.versions.electron ? createRequire(import.meta.url)('original-fs') : nodeFs).promises;",
        'const fs = nodeFs.promises;');
      source = replaceOnce(source, "await import('electron')", 'await import(' + JSON.stringify(contextURL) + ')');
      source = replaceOnce(source, 'const revalidate=async()=>{', "const revalidate=async()=>{state.events.push({kind:'revalidate'});");
      const reader = 'export async function readPackagedPrivateNativeTools({app,resourcesPath}={}) {';
      source = replaceOnce(source, reader, reader + "\n  state.events.push({kind:'tools-read'});\n  if(state.holdToolsRead)await state.holdToolsRead();");
      source = `import {mainProcess as process, state} from ${JSON.stringify(contextURL)};
${source}`;
    } else {
      source = `import {sourceProcess as process} from ${JSON.stringify(contextURL)};
${source}`;
    }
    for (const imported of ['spawn', 'execFile', 'execFileSync']) {
      const old = `import { ${imported} } from 'node:child_process';`;
      if (source.includes(old)) source = replaceOnce(source, old, `import { ${imported} } from ${JSON.stringify(childURL)};`);
    }
    if (name === 'development-verification-runtime.mjs') {
      // Expose only the unmodified source observation body in this generated
      // copy; no public observer/testing method is added to production.
      source = replaceOnce(source, '  async #readSource(sourceHead) {', '  async readSourceForSourceFixture(sourceHead) {');
      source = replaceOnce(source, 'await this.#readSource(capsule.source.head)', 'await this.readSourceForSourceFixture(capsule.source.head)');
    }
    await fs.writeFile(new URL(output(name)), source);
  }
  const context = await import(contextURL);
  return {root, resources, toolsRoot, appPath, repo, managed, userData, snapshots, owner, binding, expected, contextURL,
    app: context.app, state: context.state,
    runtime: await import(output('managed-task-project-runtime.mjs')),
    repository: await import(output('managed-task-project-repository.mjs')),
    host: await import(output('managed-task-project-host.mjs')),
    development: await import(output('development-verification-runtime.mjs')),
    setup: await import(output('installed-fresh-provider-setup.mjs')),
    child: await import(childURL)};
}

function readPlan(cwd) {
  return {schema: 'metaengine.devos.workspace-git-plan.v1', executable: 'git', shell: false,
    argv: ['worktree', 'list', '--porcelain', '-z'], cwd,
    workspace_id: '11111111-1111-4111-8111-111111111111', task_id: '22222222-2222-4222-8222-222222222222',
    lease_generation: 1, effect: 'WORKTREE_INVENTORY_READ', authority_effect: false, automatic_retry_allowed: false};
}
function repositoryConfig(f) {
  return {schema: 'metaengine.devos.managed-project-repository-config.v1',
    coordination_workspace_id: '33333333-3333-4333-8333-333333333333', repo_id: 'PatrickFrome/Compute',
    repo_root: f.repo, managed_root: f.managed};
}
function hostOptions(f, createJournal) {
  return {userDataPath: f.userData, executeCommand: async () => null, resolveProjectBinding: async () => null,
    reserveBinding: async () => null, finalizeBinding: async () => null, createJournal, ...sourceOnlyStorage};
}
const isGit = event => ['spawn', 'exec', 'sync'].includes(event.kind);
function assertPrivateGit(f, preceding = 'revalidate') {
  for (let index = 0; index < f.state.events.length; index++) {
    const event = f.state.events[index];
    if (!isGit(event)) continue;
    assert.equal(event.executable, path.join(f.toolsRoot, 'git/ucrt64/bin/git.exe'));
    assert.equal(f.state.events[index - 1]?.kind, preceding);
    for (const key of PROTECTED) assert.equal(event.env[key], f.expected.environment[key], key);
    for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_DIR', 'GIT_WORK_TREE', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK'])
      assert.equal(Object.hasOwn(event.env, key), false, key);
    assert.equal(event.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(event.env.GIT_CONFIG_GLOBAL, 'NUL');
    assert.equal(event.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(event.env.GCM_INTERACTIVE, 'never');
    assert.equal(event.env.GCM_GUI_PROMPT, '0');
    assert.equal(event.env.PATH.includes(HOSTILE.PATH), false);
  }
}
async function freshOptions(f) {
  const bundle = path.join(f.resources, 'client-state-runtime');
  for (const entry of [ENTRY, IDENTITY_ENTRY]) await fs.mkdir(path.dirname(path.join(bundle, entry)), {recursive: true});
  await fs.writeFile(path.join(bundle, ENTRY), `import {state} from ${JSON.stringify(f.contextURL)};
state.events.push({kind:'provider-import'});
export async function provisionFreshClientProvider(){state.events.push({kind:'provider-provision'});throw Error('source_only_provider_must_not_run');}
`);
  await fs.writeFile(path.join(bundle, IDENTITY_ENTRY), 'export {};');
  const packageFile = path.join(f.root, 'fresh-source-only-package.json');
  await fs.writeFile(packageFile, JSON.stringify({version: 'source-only',
    metaengineClientStateRuntime: {package_version: 'source-only', bundle_sha256: 'b'.repeat(64)}}));
  return {app: f.app, resourcesPath: f.resources, packageFile, platform: 'win32',
    env: {LOCALAPPDATA: f.owner, APPDATA: f.owner},
    verify: async () => ({manifest: {files: [{path: ENTRY}, {path: IDENTITY_ENTRY}]}})};
}
async function assertNoProviderEffect(f) {
  assert.equal(f.state.events.some(event => event.kind.startsWith('provider-')), false);
  await assert.rejects(fs.lstat(path.join(f.owner, 'METAENGINE', 'client-first-run-v1')), {code: 'ENOENT'});
}
function verificationRuntime(f, extra = {}) {
  const inactive = async () => {throw Error('source_only_executor_not_activated');};
  return new f.development.DevelopmentVerificationRuntime({repoRoot: f.repo, repository: 'PatrickFrome/Compute',
    sourcePaths: ['src/source.txt'], editablePrefixes: ['src/'], snapshotRoot: f.snapshots,
    catalog: {CHECK: {executable: 'source-only-inactive', args: []}},
    executor: {executor_id: 'source-only', configuration_digest: 'sha256:' + 'a'.repeat(64),
      createSession: inactive, runStep: inactive, stop: inactive, recover: inactive},
    journal: {find() {throw Error('source_only_journal_not_used');}, read() {throw Error('source_only_journal_not_used');},
      append() {throw Error('source_only_journal_not_used');}}, ...extra});
}
function sourceFrames(end = HEAD) {
  const bytes = Buffer.from('source-only blob\n');
  const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  return {bytes, oid, outputs: [Buffer.from(HEAD + '\n'), Buffer.from(`100644 blob ${oid}\tsrc/source.txt\0`),
    Buffer.concat([Buffer.from(`${oid} blob ${bytes.length}\n`), bytes, Buffer.from('\n')]), Buffer.from(end + '\n')]};
}

test('generated Main default executor selects ucrt64 once and permanently refuses changed inventory', async t => {
  const f = await fixture(t);
  const executor = f.runtime.createShellFreeGitExecutor();
  const plan = readPlan(f.repo);
  await executor.execute(plan);
  await executor.execute(plan);
  assert.equal(f.state.events.filter(event => event.kind === 'tools-read').length, 1);
  assert.equal(f.state.events.filter(isGit).length, 2);
  assertPrivateGit(f);
  const expectedArgv = process.platform === 'win32' ? ['-c', 'core.longpaths=true', ...plan.argv] : plan.argv;
  for (const event of f.state.events.filter(isGit)) assert.deepEqual(event.argv, expectedArgv);
  const dependency = path.join(f.toolsRoot, 'git/ucrt64/bin/libcurl-4.dll');
  const old = await fs.readFile(dependency);
  await fs.writeFile(dependency, 'changed source-only dependency');
  await assert.rejects(executor.execute(plan), /inventory_changed/);
  await fs.writeFile(dependency, old);
  await assert.rejects(executor.execute(plan), /invalidated/);
  assert.equal(f.state.events.filter(isGit).length, 2);
  assert.equal(f.state.events.filter(event => event.kind === 'tools-read').length, 1);
});

test('generated Main repository/configure/default host share their original selections', async t => {
  const f = await fixture(t);
  const repository = repositoryConfig(f);
  await f.repository.configureManagedTaskProjectRepository({userDataPath: f.userData, repository, ...sourceOnlyStorage});
  assert.deepEqual(await f.repository.readManagedTaskProjectRepository({userDataPath: f.userData, ...sourceOnlyStorage}), repository);
  assert.equal(f.state.events.filter(event => event.kind === 'tools-read').length, 2);
  let closed = 0;
  const host = await f.host.createManagedTaskProjectHost(hostOptions(f, ({filePath}) => {
    nodeFs.writeFileSync(filePath, 'inert source-only journal fixture', {flag: 'wx', mode: 0o600});
    return {find: async () => null, append: async entry => entry, close: async () => {closed++;}};
  }));
  try {
    await host.readSourceSyncGit(readPlan(f.repo));
    assert.equal(f.state.events.filter(event => event.kind === 'tools-read').length, 3);
    assertPrivateGit(f);
    const reads = f.state.events.filter(event => event.kind === 'exec');
    assert.ok(reads.length >= 2);
    for (const event of reads) assert.ok(['rev-parse --show-toplevel', 'rev-parse --verify HEAD^{commit}'].includes(event.argv.join(' ')));
  } finally {await host.close();}
  assert.equal(closed, 1);
  assert.equal(host.snapshot().state, 'CLOSED');
});

for (const mutation of ['missing-binding', 'malformed-binding', 'missing-resources', 'changed-inventory']) {
  test('generated Main fails closed before default Git and fresh-provider effects: ' + mutation, async t => {
    const f = await fixture(t);
    // An existing protected config requires repository verification. Absence
    // itself must remain readable without admitting tools or native effects.
    const configDirectory = path.join(f.userData, 'managed-task-projects-v1');
    await fs.mkdir(configDirectory, {mode: 0o700});
    await fs.writeFile(path.join(configDirectory, 'repository.json'), JSON.stringify(repositoryConfig(f)), {mode: 0o600});
    const packageFile = path.join(f.appPath, 'package.json');
    const packageBytes = await fs.readFile(packageFile);
    let restore = () => fs.writeFile(packageFile, packageBytes);
    if (mutation === 'missing-binding') await fs.writeFile(packageFile, '{}');
    if (mutation === 'malformed-binding') await fs.writeFile(packageFile, JSON.stringify({metaenginePrivateNativeTools: null}));
    if (mutation === 'missing-resources') {
      const displaced = f.toolsRoot + '-removed';
      await fs.rename(f.toolsRoot, displaced);
      restore = () => fs.rename(displaced, f.toolsRoot);
    }
    if (mutation === 'changed-inventory') {
      const file = path.join(f.toolsRoot, 'git/ucrt64/bin/libcurl-4.dll');
      const original = await fs.readFile(file);
      await fs.writeFile(file, Buffer.alloc(original.length, 120));
      restore = () => fs.writeFile(file, original);
    }
    const denied = /private_native_tools_|ENOENT/;
    const executor = f.runtime.createShellFreeGitExecutor();
    await assert.rejects(executor.execute(readPlan(f.repo)), denied);
    await assert.rejects(f.repository.readManagedTaskProjectRepository({userDataPath: f.userData, ...sourceOnlyStorage}), denied);
    await assert.rejects(f.repository.configureManagedTaskProjectRepository({userDataPath: f.userData, repository: repositoryConfig(f)}), denied);
    let journalOpened = 0;
    await assert.rejects(f.host.createManagedTaskProjectHost(hostOptions(f, () => {
      journalOpened++; throw Error('source_only_journal_must_not_open');
    })), denied);
    assert.equal(journalOpened, 0);
    assert.equal(f.state.events.some(isGit), false);
    f.state.events.length = 0;
    await assert.rejects(f.setup.setupInstalledFreshProvider(await freshOptions(f)), denied);
    const ready = f.state.events.findIndex(event => event.kind === 'ready');
    const toolsRead = f.state.events.findIndex(event => event.kind === 'tools-read');
    assert.ok(ready >= 0 && toolsRead > ready);
    await assertNoProviderEffect(f);
    assert.equal(f.state.events.some(isGit), false);
    await restore();
    const selections = f.state.events.filter(event => event.kind === 'tools-read').length;
    await assert.rejects(executor.execute(readPlan(f.repo)), denied);
    assert.equal(f.state.events.filter(event => event.kind === 'tools-read').length, selections);
    assert.equal(f.state.events.some(isGit), false);
  });
}

test('generated development observer retains protected environment, original capability and both HEAD fences', async t => {
  const f = await fixture(t);
  const runtime = verificationRuntime(f);
  const frames = sourceFrames();
  f.state.syncOutputs.push(...frames.outputs);
  const files = await runtime.readSourceForSourceFixture(HEAD);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'src/source.txt');
  assert.equal(files[0].mode, '100644');
  assert.deepEqual(files[0].bytes, frames.bytes);
  const reads = f.state.events.filter(event => event.kind === 'sync');
  assert.deepEqual(reads.map(event => event.argv), [
    ['-c', 'core.fsmonitor=false', '-C', f.repo, 'rev-parse', '--verify', 'HEAD'],
    ['-c', 'core.fsmonitor=false', '-C', f.repo, 'ls-tree', '-rz', '--full-tree', HEAD],
    ['-c', 'core.fsmonitor=false', '-C', f.repo, 'cat-file', '--batch'],
    ['-c', 'core.fsmonitor=false', '-C', f.repo, 'rev-parse', '--verify', 'HEAD'],
  ]);
  assert.equal(reads[2].input, frames.oid + '\n');
  for (const event of reads) assert.equal(event.env.GIT_NO_REPLACE_OBJECTS, '1');
  assertPrivateGit(f);
  f.state.syncOutputs.push(...sourceFrames('2'.repeat(40)).outputs);
  await assert.rejects(runtime.readSourceForSourceFixture(HEAD), /source_head_changed/);
  f.state.syncOutputs.push(Buffer.from('2'.repeat(40)));
  await assert.rejects(runtime.readSourceForSourceFixture(HEAD), /source_head_changed/);
  assert.equal(f.state.events.filter(event => event.kind === 'tools-read').length, 1);
  const count = f.state.events.filter(isGit).length;
  const dependency = path.join(f.toolsRoot, 'git/ucrt64/etc/ssl/certs/ca-bundle.crt');
  const old = await fs.readFile(dependency);
  await fs.writeFile(dependency, 'changed source-only CA');
  await assert.rejects(runtime.readSourceForSourceFixture(HEAD), /inventory_changed/);
  await fs.writeFile(dependency, old);
  await assert.rejects(runtime.readSourceForSourceFixture(HEAD), /invalidated/);
  assert.equal(f.state.events.filter(isGit).length, count);
  assert.equal(f.state.events.filter(event => event.kind === 'tools-read').length, 1);
});

test('native supplied selection cannot redirect a spawn or recover after original revalidation failure', async t => {
  const f = await fixture(t);
  for (const mutation of ['path', 'environment', 'method', 'during-revalidate', 'rejected-revalidate']) {
    f.state.events.length = 0;
    let active = false;
    let replacementCalls = 0;
    const supplied = {gitExecutable: f.expected.gitExecutable, environment: {...f.expected.environment},
      async revalidate() {
        assert.equal(this, supplied);
        f.state.events.push({kind: 'original'});
        await f.expected.revalidate();
        if (active && mutation === 'during-revalidate') this.environment.GIT_EXEC_PATH = '/source-only-redirect';
        if (active && mutation === 'rejected-revalidate') throw Error('original_rejected');
      }};
    const originalRevalidate = supplied.revalidate;
    const originalExecPath = supplied.environment.GIT_EXEC_PATH;
    const executor = f.runtime.createShellFreeGitExecutor({privateTools: supplied});
    await executor.execute(readPlan(f.repo));
    assertPrivateGit(f, 'original');
    active = true;
    if (mutation === 'path') supplied.gitExecutable = path.join(f.root, 'source-only-shadow.exe');
    if (mutation === 'environment') supplied.environment.GIT_EXEC_PATH = '/source-only-redirect';
    if (mutation === 'method') supplied.revalidate = async () => {replacementCalls++;};
    await assert.rejects(executor.execute(readPlan(f.repo)), /private_tools_changed|original_rejected/);
    assert.equal(f.state.events.filter(isGit).length, 1);
    assert.equal(replacementCalls, 0);
    active = false;
    supplied.gitExecutable = f.expected.gitExecutable;
    supplied.environment.GIT_EXEC_PATH = originalExecPath;
    supplied.revalidate = originalRevalidate;
    await assert.rejects(executor.execute(readPlan(f.repo)), /private_tools_invalidated/);
    assert.equal(f.state.events.filter(isGit).length, 1);
  }
});

test('development observer snapshots the native supplied selection before asynchronous reads', async t => {
  const f = await fixture(t);
  let originalCalls = 0;
  const supplied = {gitExecutable: f.expected.gitExecutable, environment: {...f.expected.environment},
    revalidate: async () => {originalCalls++; await f.expected.revalidate();}};
  const runtime = verificationRuntime(f, {privateTools: supplied});
  const original = supplied.environment.OPENSSL_CONF;
  supplied.environment.OPENSSL_CONF = '/source-only-redirect';
  await assert.rejects(runtime.readSourceForSourceFixture(HEAD), /private_tools_changed/);
  supplied.environment.OPENSSL_CONF = original;
  await assert.rejects(runtime.readSourceForSourceFixture(HEAD), /private_tools_invalidated/);
  assert.equal(originalCalls, 0);
  assert.equal(f.state.events.some(isGit), false);
});

test('ordinary non-Electron source default retains the existing Git selection and fixed argv', async t => {
  if (process.versions.electron) {t.skip('ordinary source Node execution only'); return;}
  const f = await fixture(t);
  const executor = createShellFreeGitExecutor({spawnProcess: f.child.spawn});
  const plan = readPlan(f.repo);
  await executor.execute(plan);
  const calls = f.state.events.filter(isGit);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'git');
  assert.deepEqual(calls[0].argv, process.platform === 'win32' ? ['-c', 'core.longpaths=true', ...plan.argv] : plan.argv);
  assert.equal(f.state.events.some(event => event.kind === 'tools-read'), false);
});

test('fresh setup cancellation while canonical tools verification is held prevents provider import and provisioning', async t => {
  const f = await fixture(t);
  const options = await freshOptions(f);
  const previous = globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
  globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__ = false;
  t.after(() => {
    if (previous === undefined) delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
    else globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__ = previous;
  });
  let entered;
  let release;
  const enteredRead = new Promise(resolve => {entered = resolve;});
  const held = new Promise(resolve => {release = resolve;});
  f.state.holdToolsRead = async () => {entered(); await held;};
  const observed = f.setup.setupInstalledFreshProvider(options).then(value => ({value}), error => ({error}));
  await Promise.race([enteredRead, observed.then(result => {throw result.error || Error('source_only_expected_held_tools_read');})]);
  assert.deepEqual(f.state.events.map(event => event.kind), ['ready', 'tools-read']);
  globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__ = true;
  release();
  const result = await observed;
  assert.match(result.error?.message || '', /installed_fresh_provider_cancelled/);
  assert.ok(f.state.events.some(event => event.kind === 'revalidate'));
  assert.equal(f.state.events.some(isGit), false);
  await assertNoProviderEffect(f);
});

test('missing protected repository config stays read-only absence without discovering tools', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.appPath, 'package.json'), '{}');
  assert.equal(await f.repository.readManagedTaskProjectRepository({userDataPath: f.userData}), null);
  assert.equal(f.state.events.length, 0);
});

test('configure snapshots original operator choice before held Main tool discovery', async t => {
  const f = await fixture(t);
  const selected = repositoryConfig(f), original = {...selected};
  let entered, release;
  const started = new Promise(resolve => {entered = resolve;});
  const held = new Promise(resolve => {release = resolve;});
  f.state.holdToolsRead = async () => {entered(); await held;};
  const pending = f.repository.configureManagedTaskProjectRepository({userDataPath: f.userData, repository: selected, ...sourceOnlyStorage})
    .then(value => ({value}), error => ({error}));
  try {
    await Promise.race([started, pending.then(result => {throw result.error || Error('expected_held_read');})]);
    selected.repo_id = 'changed/repository';
  } finally {release();}
  const result = await pending;
  if(result.error)throw result.error;
  assert.equal(result.value.configured, true);
  assert.deepEqual(await f.repository.readManagedTaskProjectRepository({userDataPath: f.userData, ...sourceOnlyStorage}), original);
  assertPrivateGit(f);
});

test('historical verification receipt readback stays independent of present tools and never re-executes', async t => {
  const f = await fixture(t);
  const journal = createDevelopmentVerificationSqliteJournal({filePath: path.join(f.root, 'verification.sqlite')});
  let receipt;
  try {
    let sessions = 0, steps = 0;
    // Explicitly inert generated executor, not a sandbox/native qualification.
    const executor = {executor_id: 'SOURCE_ONLY_INERT', configuration_digest: 'sha256:' + 'a'.repeat(64),
      createSession: async () => {sessions++; return {session_id: 'source-only-session'};},
      runStep: async () => {steps++; return {exit_code: 0, timed_out: false, output_limit_exceeded: false, stdout: '', stderr: ''};},
      stop: async () => ({stopped: true, persistent_state_deleted: true}),
      recover: async () => {throw Error('historical_receipt_must_not_recover_execution');}};
    const bytes = Buffer.from('modified source-only blob\n');
    const capsule = candidateModule.createCandidateCapsule({source_head: HEAD, sequence: 1, intent: 'Source-only readback regression',
      components: [{path: 'src/source.txt', change: 'MODIFY', digest: verificationDigest(bytes)}],
      verification_plan: [{id: 'CHECK', required: true}]}, {repository: 'PatrickFrome/Compute', head: HEAD, ref: 'refs/heads/main'});
    const request = {idempotency_key: 'source-only-readback', capsule,
      edits: [{path: 'src/source.txt', content_base64: bytes.toString('base64')}]};
    f.state.syncOutputs.push(...sourceFrames().outputs);
    receipt = await verificationRuntime(f, {executor, journal}).run(request);
    assert.equal(receipt.state, 'PASSED');
    assert.equal(receipt.promotion_authorized, false);
    assert.equal(receipt.isolation_qualification, 'NOT_ESTABLISHED_BY_THIS_RECEIPT');
    await fs.writeFile(path.join(f.appPath, 'package.json'), '{}');
    await fs.rm(f.toolsRoot, {recursive: true});
    const originalEvents = [...f.state.events];
    const restarted = verificationRuntime(f, {executor, journal});
    assert.deepEqual(await restarted.run(request), receipt);
    assert.deepEqual(await restarted.recover(receipt.run_id), receipt);
    assert.deepEqual(f.state.events, originalEvents);
    assert.equal(sessions, 1); assert.equal(steps, 1);
  } finally {journal.close();}
});

test('one failed revalidation fences an already-held concurrent selection before spawn', async t => {
  const f = await fixture(t);
  let calls = 0, firstEntered, secondEntered, rejectFirst, releaseSecond;
  const firstStarted = new Promise(resolve => {firstEntered = resolve;});
  const secondStarted = new Promise(resolve => {secondEntered = resolve;});
  const first = new Promise((_resolve, reject) => {rejectFirst = reject;});
  const second = new Promise(resolve => {releaseSecond = resolve;});
  const supplied = {gitExecutable: f.expected.gitExecutable, environment: {...f.expected.environment},
    async revalidate() {if(++calls === 1){firstEntered();await first;}else{secondEntered();await second;}}};
  const executor = f.runtime.createShellFreeGitExecutor({privateTools: supplied});
  const a = executor.execute(readPlan(f.repo)).then(value => ({value}), error => ({error}));
  await firstStarted;
  const b = executor.execute(readPlan(f.repo)).then(value => ({value}), error => ({error}));
  await secondStarted;
  rejectFirst(Error('original_revalidation_failed'));
  assert.match((await a).error?.message || '', /original_revalidation_failed/);
  releaseSecond();
  assert.match((await b).error?.message || '', /private_tools_invalidated/);
  assert.equal(f.state.events.some(isGit), false);
});

for (const invalid of ['renderer', 'missing-packaged-decision']) {
  test('generated default Main refuses invalid process context before tools or Git: ' + invalid, async t => {
    const f = await fixture(t), context = await import(f.contextURL);
    if (invalid === 'renderer') context.mainProcess.type = 'renderer';
    else delete context.app.isPackaged;
    const executor = f.runtime.createShellFreeGitExecutor();
    await assert.rejects(executor.execute(readPlan(f.repo)), /main_process_required|main_context_invalid/);
    assert.equal(f.state.events.length, 0);
  });
}

test('validated Git plan is snapshotted before held default discovery', async t => {
  const f = await fixture(t);
  let entered, release;
  const started = new Promise(resolve => {entered = resolve;});
  const held = new Promise(resolve => {release = resolve;});
  f.state.holdToolsRead = async () => {entered(); await held;};
  const plan = readPlan(f.repo), original = structuredClone(plan);
  const pending = f.runtime.createShellFreeGitExecutor().execute(plan)
    .then(value => ({value}), error => ({error}));
  try {
    await Promise.race([started, pending.then(result => {throw result.error || Error('expected_held_read');})]);
    plan.cwd = f.owner; plan.argv.splice(0, plan.argv.length, 'config', '--global', 'redirect', 'true');
    plan.effect = 'WORKTREE_CREATE_LOCKED';
  } finally {release();}
  const result = await pending; if(result.error)throw result.error;
  const [spawn] = f.state.events.filter(isGit);
  assert.equal(spawn.cwd, original.cwd);
  assert.deepEqual(spawn.argv, process.platform === 'win32' ? ['-c', 'core.longpaths=true', ...original.argv] : original.argv);
  assert.equal(spawn.env.GIT_OPTIONAL_LOCKS, '0');
  assertPrivateGit(f);
});

for (const mutation of ['executable', 'environment']) {
  test('actual repository reader snapshots supplied selection before filesystem awaits: ' + mutation, async t => {
    const f = await fixture(t);
    const directory = path.join(f.userData, 'managed-task-projects-v1');
    await fs.mkdir(directory, {mode: 0o700});
    await fs.writeFile(path.join(directory, 'repository.json'), JSON.stringify(repositoryConfig(f)), {mode: 0o600});
    let reads = 0, validations = 0;
    const supplied = {gitExecutable: f.expected.gitExecutable, environment: {...f.expected.environment},
      async revalidate() {validations++; await f.expected.revalidate();}};
    // Use the actual reader import, not the copied Main context. Only process
    // execution/storage observations are inert fixture callbacks.
    const pending = readManagedTaskProjectRepository({userDataPath: f.userData, privateTools: supplied,
      ...sourceOnlyStorage, runGit: async (_executable, argv, options) => {
        reads++;
        return {stdout: argv.includes('--show-toplevel') ? options.cwd + '\n' : HEAD + '\n', stderr: ''};
      }});
    if (mutation === 'executable') supplied.gitExecutable = path.join(f.root, 'redirected-git.exe');
    else supplied.environment.PATH = path.join(f.root, 'redirected-helpers');
    await assert.rejects(pending, /managed_project_git_private_tools_changed/);
    assert.equal(validations, 0);
    assert.equal(reads, 0);
  });
}
