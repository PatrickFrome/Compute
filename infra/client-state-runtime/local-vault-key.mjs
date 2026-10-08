import { randomBytes } from 'node:crypto';
import { chmod, lstat, open, realpath, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function secureKeyFile(keyPath) {
  if (process.platform !== 'win32') return chmod(keyPath, 0o600);
  const script = `$ErrorActionPreference = 'Stop'
$vaultKeyPath = [Environment]::GetEnvironmentVariable('LOCAL_VAULT_KEY_PATH')
$vaultIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$vaultAcl = New-Object System.Security.AccessControl.FileSecurity
$vaultAcl.SetAccessRuleProtection($true, $false)
$vaultAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($vaultIdentity.User, 'Read,Write', 'Allow'))
$vaultSystem = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$vaultAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($vaultSystem, 'FullControl', 'Allow'))
[System.IO.File]::SetAccessControl($vaultKeyPath, $vaultAcl)
`;
  const acl = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 65536, env: { ...process.env, LOCAL_VAULT_KEY_PATH: keyPath },
  });
  if (acl.status !== 0) throw new Error('local_vault_key_acl_failed');
}

export async function initializeLocalVaultKey({ dataDirectory }) {
  if (!isAbsolute(String(dataDirectory || ''))) throw new Error('local_vault_data_directory_absolute_required');
  const directory = resolve(dataDirectory);
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (await realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw new Error('local_vault_data_directory_invalid');
  const version = (await readFile(join(directory, 'PG_VERSION'), 'utf8')).trim();
  if (version !== '17') throw new Error('local_vault_pg17_data_directory_required');
  const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const insideRepository = relative(repository, directory);
  if (!insideRepository.startsWith('..') && !isAbsolute(insideRepository)) throw new Error('local_vault_key_must_be_outside_repository');
  const keyPath = join(directory, 'client-vault.key');
  let created = false;
  try {
    const handle = await open(keyPath, 'wx', 0o600);
    try {
      await secureKeyFile(keyPath);
      await handle.writeFile(randomBytes(32).toString('hex') + '\n');
      await handle.sync();
    }
    finally { await handle.close(); }
    created = true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const info = await lstat(keyPath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== 65) throw new Error('local_vault_key_file_invalid');
  if (!/^[0-9a-f]{64}\n$/.test(await readFile(keyPath, 'utf8'))) throw new Error('local_vault_key_format_invalid');
  if (!created) await secureKeyFile(keyPath);
  return { created, key_file: keyPath, provider: 'PGCRYPTO_PGP_AES256', plaintext_key_logged: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initializeLocalVaultKey({ dataDirectory: process.env.LOCAL_STATE_POSTGRES_DATA_DIRECTORY }).then((result) => {
    console.log(JSON.stringify(result));
  }).catch((error) => {
    console.error(JSON.stringify({ event: 'local_vault_key_failed', code: String(error.message || 'key_setup_failed') }));
    process.exitCode = 1;
  });
}
