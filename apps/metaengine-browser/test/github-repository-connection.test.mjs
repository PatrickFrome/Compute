import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createGithubRepositoryConnection, githubRepositoryFromPackage, parseGcmGithubCredential,
  readWindowsGcmGithubCredential, trustedWindowsProgramFiles, readInstalledGithubCredential, installGithubRepositoryConnection } from '../src/github-repository-connection.mjs';

const token = 'test_private_github_credential_opaque_only';
const repository = 'PatrickFrome/Compute';
const account = { id: 123, login: 'PatrickFrome', token: 'private_extra_field_never_returned' };
const remote = { id: 456, full_name: repository, html_url: 'https://github.com/' + repository,
  permissions: { pull: true, push: true }, private_information: 'not_returned' };
const json = value => new Response(JSON.stringify(value), { status: 200 });

test('package repository parsing rejects substituted hosts, credentials, queries and paths', () => {
  assert.equal(githubRepositoryFromPackage({ type: 'git', url: 'https://github.com/PatrickFrome/Compute.git' }), repository);
  for (const url of ['http://github.com/PatrickFrome/Compute.git', 'https://token@github.com/PatrickFrome/Compute.git',
    'https://github.com.evil/PatrickFrome/Compute', 'https://github.com/PatrickFrome/Compute?auth=secret',
    'https://github.com/PatrickFrome/Compute/extra', 'https://github.com/PatrickFrome/..']) {
    assert.throws(() => githubRepositoryFromPackage(url), /repository_not_configured/);
  }
});

test('GCM parser binds credentials to GitHub and rejects duplicates or non-protocol stdout', () => {
  assert.equal(parseGcmGithubCredential('protocol=https\nhost=github.com\nusername=account\npassword=' + token + '\n'), token);
  for (const text of ['password=short\n', 'host=evil.com\npassword=' + token + '\n',
    'password=' + token + '\npassword=' + token + '\n', 'debug: secret\npassword=' + token, 'password=' + token + '\u0000']) {
    assert.throws(() => parseGcmGithubCredential(text), /credential_unavailable/);
  }
});

test('Windows GCM launches one fixed hidden helper with stdin host and strips loader, tracing and credentials', async () => {
  const env = { ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Test',
    GITHUB_TOKEN: token, GH_TOKEN: token, NODE_OPTIONS: '--import=hostile', GIT_CONFIG_COUNT: '3',
    GCM_TRACE: '1', GCM_TRACE_SECRETS: '1', PATH: 'C:\\hostile' };
  let input, call;
  const output = await readWindowsGcmGithubCredential({ platform: 'win32', env,
    resolveProgramFiles: async () => 'C:\\Program Files',
    executableVerified: async file => file === 'C:\\Program Files\\Git\\mingw64\\bin\\git-credential-manager.exe',
    run: (executable, argv, options) => {
      call = { executable, argv, options };
      const promise = Promise.resolve({ stdout: 'username=account\npassword=' + token + '\n' });
      promise.child = { stdin: { end: value => { input = value; } } };
      return promise;
    } });
  assert.equal(output.token, token); assert.equal(output.source, 'WINDOWS_GCM');
  assert.deepEqual(call.argv, ['get']); assert.equal(call.options.windowsHide, true); assert.equal(call.options.shell, false);
  assert.equal(input, 'protocol=https\nhost=github.com\n\n');
  assert.equal(call.options.env.GCM_INTERACTIVE, 'never'); assert.equal(call.options.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(call.options.env.GCM_TRACE_SECRETS, '0');
  assert.equal(call.options.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(call.options.env.GIT_CONFIG_GLOBAL, 'NUL');
  for (const key of ['GITHUB_TOKEN', 'GH_TOKEN', 'NODE_OPTIONS', 'GIT_CONFIG_COUNT']) assert.equal(call.options.env[key], undefined);
  assert.equal(JSON.stringify({ argv: call.argv, options: call.options }).includes(token), false);
});

test('machine Program Files discovery uses only a fixed trusted registry reader and rejects malformed folder readback', async () => {
  const calls = [];
  const resolved = await trustedWindowsProgramFiles({ executableVerified: async file => file === 'C:\\Windows\\System32\\reg.exe',
    run: async (file, args, options) => { calls.push({ file, args, options });
      return { stdout: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\r\n    ProgramW6432Dir    REG_SZ    C:\\Program Files\r\n' }; } });
  assert.equal(resolved, 'C:\\Program Files'); assert.equal(calls.length, 1);
  assert.equal(calls[0].options.windowsHide, true); assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.ProgramFiles, undefined); assert.equal(calls[0].options.env.SystemRoot, 'C:\\Windows');
  assert.equal(await trustedWindowsProgramFiles({ executableVerified: async () => false,
    run: async () => assert.fail('untrusted or nonstandard OS executable must not run') }), null);
  for (const pathText of ['relative', '\\\\evil\\share', 'C:\\Program Files\u0000']) {
    assert.equal(await trustedWindowsProgramFiles({ executableVerified: async () => true,
      run: async (_file, args) => ({ stdout: '    ' + args[3] + '    REG_SZ    ' + pathText + '\n' }) }), null);
  }
});

test('malicious inherited Program Files and SystemRoot cannot select a fake GCM executable', async () => {
  const discovered = [], spawned = [];
  const output = await readWindowsGcmGithubCredential({ platform: 'win32',
    env: { ProgramFiles: 'C:\\Users\\Attacker', ProgramW6432: 'D:\\malicious', SystemRoot: 'D:\\malicious\\Windows', GH_TOKEN: token },
    resolveProgramFiles: async () => 'C:\\Program Files',
    executableVerified: async file => { discovered.push(file); return file.startsWith('C:\\Program Files\\Git\\'); },
    run: (executable, args, options) => {
      spawned.push({ executable, args, options });
      const pending = Promise.resolve({ stdout: 'password=' + token + '\n' });
      pending.child = { stdin: { end() {} } }; return pending;
    } });
  assert.equal(output.source, 'WINDOWS_GCM');
  assert.equal(discovered.some(file => file.includes('Attacker') || file.includes('malicious')), false);
  assert.equal(spawned[0].options.env.ProgramFiles, 'C:\\Program Files');
  assert.equal(spawned[0].options.env.SystemRoot, 'C:\\Windows');
});

test('authentication requires real account and exact readable repository and publishes only fixed status fields', async () => {
  const calls = [];
  const connection = createGithubRepositoryConnection({ readRepository: async () => repository,
    readCredential: async () => ({ token, source: 'WINDOWS_GCM' }), fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return json(url.endsWith('/user') ? account : remote);
    } });
  assert.equal(connection.snapshot().authenticated, false);
  const status = await connection.connect();
  assert.equal(status.state, 'CONNECTED'); assert.equal(status.account_login, account.login);
  assert.equal(status.authenticated, true); assert.equal(status.repository_access_verified, true); assert.equal(status.can_push, true);
  assert.deepEqual(calls.map(c => c.url), ['https://api.github.com/user', 'https://api.github.com/repos/PatrickFrome/Compute']);
  for (const call of calls) { assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error'); }
  for (const value of [token, 'private_extra_field_never_returned', 'not_returned']) assert.equal(JSON.stringify(status).includes(value), false);
  assert.equal(status.authority_effect, false);
});

test('configured remote alone, expired credentials, offline failures and wrong repo never claim connected', async () => {
  for (const [credential, fetchImpl, state, reason] of [
    [null, async () => assert.fail('no network without credentials'), 'CREDENTIAL_UNAVAILABLE', 'CREDENTIAL_UNAVAILABLE'],
    [{ token, source: 'WINDOWS_GCM' }, async () => new Response('private auth detail', { status: 401 }), 'AUTHENTICATION_REQUIRED', 'AUTHENTICATION_REQUIRED'],
    [{ token, source: 'WINDOWS_GCM' }, async () => { throw Error(token); }, 'UNAVAILABLE', 'NETWORK_UNAVAILABLE'],
    [{ token, source: 'WINDOWS_GCM' }, async url => json(url.endsWith('/user') ? account : { ...remote, full_name: 'other/repo' }), 'BLOCKED', 'API_IDENTITY_UNVERIFIED'],
    [{ token, source: 'WINDOWS_GCM' }, async url => url.endsWith('/user') ? json(account) : new Response('private denial', { status: 404 }), 'BLOCKED', 'REPOSITORY_ACCESS_UNCONFIRMED'],
  ]) {
    const connection = createGithubRepositoryConnection({ readRepository: async () => repository, readCredential: async () => credential, fetchImpl });
    const result = await connection.connect();
    assert.equal(result.state, state); assert.equal(result.reason, reason);
    assert.equal(result.authenticated, false); assert.equal(result.repository_access_verified, false); assert.equal(result.can_push, false);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('connection shares a pending attempt, clears prior verified flags while retrying, and never schedules polling', async () => {
  let requests = 0, online = true, release;
  const wait = new Promise(resolve => { release = resolve; });
  const connection = createGithubRepositoryConnection({ readRepository: async () => { await wait; return repository; },
    readCredential: async () => ({ token, source: 'WINDOWS_GCM' }), fetchImpl: async url => {
      requests++; if (!online) throw Error('offline'); return json(url.endsWith('/user') ? account : remote);
    } });
  const first = connection.connect(); assert.equal(connection.connect(), first); release();
  assert.equal((await first).state, 'CONNECTED'); assert.equal(requests, 2);
  online = false; const next = connection.connect();
  assert.equal(connection.snapshot().state, 'CHECKING'); assert.equal(connection.snapshot().authenticated, false);
  assert.equal((await next).state, 'UNAVAILABLE'); assert.equal(requests, 3);
  connection.stop(); await connection.connect(); assert.equal(requests, 3);
});

test('offline qualification removes GCM and network capability and cannot manufacture authenticated connection', async () => {
  let credentialReads = 0, fetches = 0;
  const connection = createGithubRepositoryConnection({ offlineQualification: true,
    readRepository: async () => repository,
    readCredential: async () => { credentialReads++; return { token, source: 'WINDOWS_GCM' }; },
    fetchImpl: async () => { fetches++; return json(account); } });
  const status = await connection.connect();
  assert.equal(status.state, 'UNAVAILABLE'); assert.equal(status.reason, 'OFFLINE_QUALIFICATION');
  assert.equal(status.repository, repository); assert.equal(status.authenticated, false);
  assert.equal(status.repository_access_verified, false); assert.equal(status.can_push, false);
  assert.equal(status.credential_source, null); assert.equal(credentialReads, 0); assert.equal(fetches, 0);
});

test('secure storage fallback refuses plaintext backends and unverified Windows private files', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-github-credential-')));
  try {
    await fs.writeFile(path.join(root, 'github-chat-token-v1.bin'), 'encrypted-opaque-content', { mode: 0o600 });
    const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'dpapi', decryptString: () => token };
    const opts = { userDataPath: root, safeStorage, platform: 'win32', readGcm: async () => null,
      verifyStorage: async () => ({ owner_dacl_verified: true, operation: 'VERIFY_PRIVATE_FILE' }) };
    assert.equal((await readInstalledGithubCredential(opts)).source, 'SECURE_STORAGE');
    assert.equal(await readInstalledGithubCredential({ ...opts, safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' } }), null);
    assert.equal(await readInstalledGithubCredential({ ...opts, verifyStorage: async () => ({ owner_dacl_verified: false }) }), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('narrow preload exposes credential-free repository status and retry only to exact primary loopback document', async () => {
  const source = await fs.readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  for (const [port, allowed] of [['8137', true], ['3000', false]]) {
    const api = {}, calls = [];
    const context = vm.createContext({ location: { protocol: 'http:', hostname: '127.0.0.1', port },
      require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { api[name] = value; } },
        ipcRenderer: { on() {}, invoke: (...args) => { calls.push(args); return Promise.resolve({}); } } }) });
    new vm.Script(source).runInContext(context);
    assert.equal(Boolean(api.metaengineClient), allowed);
    if (allowed) {
      await api.metaengineClient.githubRepositoryStatus({ token });
      await api.metaengineClient.connectGithubRepository({ repository: 'hostile/repo', token });
      assert.deepEqual(calls.map(call => Array.from(call)), [['metaengine:client:github-repository-status'], ['metaengine:client:github-repository-connect']]);
      assert.equal(Object.keys(api.metaengineClient).some(name => /credential|token/i.test(name)), false);
    }
  }
});

test('registered repository handlers enforce the shell sender and exact main frame', () => {
  const app = new EventEmitter(); app.whenReady = () => new Promise(() => {}); app.getPath = () => os.tmpdir();
  const handlers = new Map(); let admitted = 0;
  installGithubRepositoryConnection({ app, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertShellSender: () => { admitted++; } });
  const frame = {};
  const trusted = { senderFrame: frame, sender: { mainFrame: frame } };
  const status = handlers.get('metaengine:client:github-repository-status');
  assert.equal(status(trusted).state, 'CHECKING'); assert.equal(admitted, 1);
  assert.throws(() => status({ ...trusted, senderFrame: {} }), /sender_frame_untrusted/);
  assert.throws(() => status(trusted, { token }), /caller_arguments_forbidden/);
  assert.equal(handlers.size, 2);
});

test('installed offline environment gate blocks both automatic startup and a manual typed retry before credential discovery', async () => {
  const app = new EventEmitter(); app.whenReady = () => Promise.resolve();
  app.getPath = () => assert.fail('offline qualification must not inspect credential storage or discover GCM');
  const handlers = new Map(); let fetches = 0;
  const connection = installGithubRepositoryConnection({ app, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertShellSender() {}, env: { METAENGINE_GITHUB_CONNECTION_OFFLINE: '1' },
    fetchImpl: async () => { fetches++; assert.fail('offline qualification must not contact GitHub'); } });
  const frame = {};
  const trusted = { senderFrame: frame, sender: { mainFrame: frame } };
  const result = await handlers.get('metaengine:client:github-repository-connect')(trusted);
  assert.equal(result.reason, 'OFFLINE_QUALIFICATION'); assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.credential_source, null); assert.equal(fetches, 0);
  assert.equal(connection.snapshot().authenticated, false);
});
