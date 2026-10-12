import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readPrivateRelayFile } from './github-chat-relay-journal.mjs';
import { verifyOwnerOnlyWindowsStorage } from './private-windows-storage-acl.mjs';
import { GITHUB_CHAT_TOKEN_FILE } from './github-chat-relay-bootstrap.mjs';

export const GITHUB_REPOSITORY_CONNECTION_SCHEMA = 'metaengine.github-repository-connection.v1';
const execute = promisify(execFile);
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const tokenValid = value => typeof value === 'string' && /^\S{20,512}$/.test(value);
const failure = reason => Object.assign(new Error('github_repository_' + reason.toLowerCase()), { publicReason: reason });

export function githubRepositoryFromPackage(value) {
  const url = typeof value === 'string' ? value : value?.url;
  if (typeof url !== 'string') throw failure('REPOSITORY_NOT_CONFIGURED');
  const match = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+?)(?:\.git)?$/.exec(url);
  if (!match || !REPOSITORY.test(match[1]) || /(?:^|\/)\.{1,2}$/.test(match[1])) throw failure('REPOSITORY_NOT_CONFIGURED');
  return match[1];
}

async function physicalExecutable(filename) {
  if (!path.isAbsolute(filename) || /^(?:\\\\|\/\/)/.test(filename)) return false;
  let current = path.parse(filename).root;
  for (const part of path.relative(current, filename).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const item = await fs.lstat(current).catch(() => null);
    if (!item || item.isSymbolicLink() || (current === filename ? !item.isFile() : !item.isDirectory())) return false;
  }
  return path.resolve(await fs.realpath(filename)).toLowerCase() === path.resolve(filename).toLowerCase();
}

export function parseGcmGithubCredential(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 8192 || stdout.includes('\u0000')) throw failure('CREDENTIAL_UNAVAILABLE');
  const values = new Map();
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const match = /^([a-zA-Z_][a-zA-Z_0-9]*)=(.*)$/.exec(line);
    if (!match || values.has(match[1])) throw failure('CREDENTIAL_UNAVAILABLE');
    values.set(match[1], match[2]);
  }
  if ((values.has('protocol') && values.get('protocol') !== 'https')
    || (values.has('host') && values.get('host') !== 'github.com')
    || !tokenValid(values.get('password'))) throw failure('CREDENTIAL_UNAVAILABLE');
  return values.get('password');
}

/** Machine registry selects the installed Program Files folder. Caller env
 * cannot replace it or the fixed OS reader executable. Nonstandard Windows
 * system drives remain unavailable until a native KnownFolder rail is added. */
export async function trustedWindowsProgramFiles({ run = execute, executableVerified = physicalExecutable } = {}) {
  const windows = 'C:\\Windows';
  const executable = path.win32.join(windows, 'System32', 'reg.exe');
  if (!await executableVerified(executable)) return null;
  const env = { SystemRoot: windows, SYSTEMROOT: windows, WINDIR: windows, PATH: path.win32.join(windows, 'System32') };
  for (const name of ['ProgramW6432Dir', 'ProgramFilesDir']) {
    let result;
    try {
      result = await run(executable, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion', '/v', name, '/reg:64'],
        { env, shell: false, windowsHide: true, timeout: 10000, maxBuffer: 8192 });
    } catch { continue; }
    const rows = String(result?.stdout || '').split(/\r?\n/).map(line =>
      new RegExp('^\\s*' + name + '\\s+REG_SZ\\s+(.+?)\\s*$').exec(line)).filter(Boolean);
    if (rows.length !== 1 || !path.win32.isAbsolute(rows[0][1]) || !/^[A-Za-z]:\\/.test(rows[0][1])
      || rows[0][1].length > 2048 || /[\x00-\x1f]/.test(rows[0][1])) continue;
    return path.win32.normalize(rows[0][1]);
  }
  return null;
}

export async function readWindowsGcmGithubCredential({ env = process.env, platform = process.platform,
  run = execute, executableVerified = physicalExecutable, resolveProgramFiles = trustedWindowsProgramFiles } = {}) {
  if (platform !== 'win32') return null;
  const programFiles = await resolveProgramFiles({ executableVerified });
  if (!programFiles) return null;
  let executable;
  for (const root of [programFiles]) {
    for (const relative of ['Git/mingw64/bin/git-credential-manager.exe', 'Git/bin/git-credential-manager.exe']) {
      const candidate = path.win32.join(root, relative);
      if (await executableVerified(candidate)) { executable = candidate; break; }
    }
    if (executable) break;
  }
  if (!executable) return null;
  const windows = 'C:\\Windows';
  const helperDirectory = path.win32.dirname(executable);
  const gitRoot = path.win32.basename(path.win32.dirname(helperDirectory)).toLowerCase() === 'mingw64'
    ? path.win32.resolve(helperDirectory, '../..') : path.win32.resolve(helperDirectory, '..');
  const safeEnv = Object.fromEntries(['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH']
    .filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
  Object.assign(safeEnv, { SystemRoot: windows, SYSTEMROOT: windows, WINDIR: windows,
    ProgramFiles: programFiles, ProgramW6432: programFiles,
    PATH: [helperDirectory, path.win32.join(gitRoot, 'cmd'), path.win32.join(windows, 'System32')].join(';'),
    GCM_INTERACTIVE: 'never', GCM_GUI_PROMPT: '0', GCM_MODAL_PROMPT: '0', GIT_TERMINAL_PROMPT: '0',
    GCM_TRACE: '0', GCM_TRACE_SECRETS: '0',
    // The connection is host-scoped. Local repository credential helpers,
    // askpass programs and includeIf overrides cannot select executable code.
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: 'NUL', GIT_CONFIG_GLOBAL: 'NUL' });
  let result;
  try {
    const pending = run(executable, ['get'], { env: safeEnv, cwd: path.win32.dirname(executable),
      shell: false, windowsHide: true, timeout: 30000, maxBuffer: 8192 });
    pending.child?.stdin.end('protocol=https\nhost=github.com\n\n');
    result = await pending;
  } catch { return null; }
  if (typeof result?.stderr === 'string' && /(?:warning:|error:).*credential/i.test(result.stderr)) return null;
  let token;
  try { token = parseGcmGithubCredential(result.stdout); } catch { return null; }
  return { token, source: 'WINDOWS_GCM' };
}

export async function readInstalledGithubCredential({ userDataPath, safeStorage, env = process.env,
  platform = process.platform, readGcm = readWindowsGcmGithubCredential,
  verifyStorage = verifyOwnerOnlyWindowsStorage } = {}) {
  const gcm = await readGcm({ env, platform });
  if (gcm) return gcm;
  if (!safeStorage?.isEncryptionAvailable?.() || typeof safeStorage.decryptString !== 'function'
    || safeStorage.getSelectedStorageBackend?.() === 'basic_text' || typeof userDataPath !== 'string') return null;
  const filename = path.join(userDataPath, GITHUB_CHAT_TOKEN_FILE);
  try {
    if (platform === 'win32') {
      const receipt = await verifyStorage(filename, { operation: 'VERIFY_PRIVATE_FILE' });
      if (receipt?.owner_dacl_verified !== true || receipt.operation !== 'VERIFY_PRIVATE_FILE') return null;
    }
    const token = safeStorage.decryptString(await readPrivateRelayFile(filename, 4096));
    return tokenValid(token) ? { token, source: 'SECURE_STORAGE' } : null;
  } catch { return null; }
}

async function publicApiRead(endpoint, token, fetchImpl, signal) {
  let response;
  try {
    response = await fetchImpl('https://api.github.com' + endpoint, { method: 'GET', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token,
        'x-github-api-version': '2026-03-10', 'user-agent': 'METAENGINE-Browser' } });
  } catch { throw failure('NETWORK_UNAVAILABLE'); }
  if (response.status === 401) throw failure('AUTHENTICATION_REQUIRED');
  if (response.status === 403 || response.status === 404) throw failure('REPOSITORY_ACCESS_UNCONFIRMED');
  if (!response.ok) throw failure('NETWORK_UNAVAILABLE');
  let text;
  try { text = await response.text(); } catch { throw failure('NETWORK_UNAVAILABLE'); }
  if (Buffer.byteLength(text) > 128 * 1024) throw failure('API_IDENTITY_UNVERIFIED');
  try { return JSON.parse(text); } catch { throw failure('API_IDENTITY_UNVERIFIED'); }
}

export function createGithubRepositoryConnection({ readRepository, readCredential, fetchImpl = fetch,
  now = () => new Date().toISOString(), changed = () => {}, offlineQualification = false } = {}) {
  if (typeof readRepository !== 'function' || typeof readCredential !== 'function') throw failure('CONFIGURATION_INVALID');
  const base = { schema: GITHUB_REPOSITORY_CONNECTION_SCHEMA, state: 'CHECKING', repository: null,
    account_login: null, account_id: null, authenticated: false, repository_access_verified: false,
    can_push: false, checked_at: null, reason: null, credential_source: null,
    automatic_cloud_fallback: false, authority_effect: false };
  let status = Object.freeze(base), pending = null, stopped = false;
  const abort = new AbortController();
  const publish = value => { status = Object.freeze({ ...base, ...value }); try { changed(status); } catch {} return status; };
  return Object.freeze({
    snapshot: () => status,
    connect() {
      if (pending) return pending;
      if (stopped) return Promise.resolve(status);
      pending = (async () => {
        let repository = null, credentialSource = null;
        publish({ state: 'CHECKING' });
        try {
          repository = await readRepository();
          if (!REPOSITORY.test(repository || '')) throw failure('REPOSITORY_NOT_CONFIGURED');
          // Qualification can remove this outbound capability. It never changes
          // provider/Owner admission and cannot manufacture CONNECTED evidence.
          if (offlineQualification === true) throw failure('OFFLINE_QUALIFICATION');
          const credential = await readCredential();
          if (!tokenValid(credential?.token) || !['WINDOWS_GCM', 'SECURE_STORAGE'].includes(credential?.source)) throw failure('CREDENTIAL_UNAVAILABLE');
          credentialSource = credential.source;
          const account = await publicApiRead('/user', credential.token, fetchImpl, abort.signal);
          if (!Number.isSafeInteger(account?.id) || account.id < 1 || !LOGIN.test(account?.login || '')) throw failure('API_IDENTITY_UNVERIFIED');
          const remote = await publicApiRead('/repos/' + repository, credential.token, fetchImpl, abort.signal);
          if (!Number.isSafeInteger(remote?.id) || remote.id < 1 || remote.full_name?.toLowerCase() !== repository.toLowerCase()
            || remote.html_url?.toLowerCase() !== ('https://github.com/' + repository).toLowerCase()
            || !remote.permissions || typeof remote.permissions.pull !== 'boolean' || remote.permissions.pull !== true
            || typeof remote.permissions.push !== 'boolean') throw failure('API_IDENTITY_UNVERIFIED');
          if (stopped) return status;
          return publish({ state: 'CONNECTED', repository: remote.full_name, account_login: account.login, account_id: account.id,
            authenticated: true, repository_access_verified: true, can_push: remote.permissions.push,
            checked_at: now(), credential_source: credentialSource });
        } catch (error) {
          if (stopped) return status;
          const reason = ['REPOSITORY_NOT_CONFIGURED', 'CREDENTIAL_UNAVAILABLE', 'AUTHENTICATION_REQUIRED', 'NETWORK_UNAVAILABLE',
            'REPOSITORY_ACCESS_UNCONFIRMED', 'API_IDENTITY_UNVERIFIED', 'OFFLINE_QUALIFICATION'].includes(error?.publicReason) ? error.publicReason : 'API_IDENTITY_UNVERIFIED';
          const state = ({ REPOSITORY_NOT_CONFIGURED: 'NOT_CONFIGURED', CREDENTIAL_UNAVAILABLE: 'CREDENTIAL_UNAVAILABLE',
            AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED', NETWORK_UNAVAILABLE: 'UNAVAILABLE', OFFLINE_QUALIFICATION: 'UNAVAILABLE' })[reason] || 'BLOCKED';
          return publish({ state, repository, checked_at: now(), reason, credential_source: credentialSource });
        }
      })().finally(() => { pending = null; });
      return pending;
    },
    stop() { stopped = true; abort.abort(); },
  });
}

export function installGithubRepositoryConnection({ app, ipcMain, safeStorage, assertShellSender,
  packageFile = new URL('../package.json', import.meta.url), fetchImpl, changed, env = process.env } = {}) {
  const connection = createGithubRepositoryConnection({
    readRepository: async () => githubRepositoryFromPackage(JSON.parse(await fs.readFile(packageFile, 'utf8')).repository),
    readCredential: () => readInstalledGithubCredential({ userDataPath: app.getPath('userData'), safeStorage }),
    offlineQualification: env.METAENGINE_GITHUB_CONNECTION_OFFLINE === '1',
    ...(fetchImpl ? { fetchImpl } : {}), ...(changed ? { changed } : {}),
  });
  const admit = (event, args) => {
    assertShellSender(event);
    if (event.senderFrame !== event.sender.mainFrame) throw failure('SENDER_FRAME_UNTRUSTED');
    if (args.length !== 0) throw failure('CALLER_ARGUMENTS_FORBIDDEN');
  };
  ipcMain.handle('metaengine:client:github-repository-status', (event, ...args) => { admit(event, args); return connection.snapshot(); });
  ipcMain.handle('metaengine:client:github-repository-connect', (event, ...args) => { admit(event, args); return connection.connect(); });
  app.whenReady().then(() => connection.connect()).catch(() => {});
  app.once('will-quit', () => connection.stop());
  return connection;
}
