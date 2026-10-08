import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, LOCAL_STATE_PROVIDER_PROFILE, localStateProviderOwnerFile, validateLocalStateProviderConfig } from '../../apps/metaengine-browser/src/local-state-provider-policy.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isInside = (parent, file) => {
  const relative = path.relative(parent, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

// Existing ancestors are checked both before and after mkdir; this avoids
// creating a provider profile through a pre-existing junction/symlink. The
// directory is a private owner-selected path, never an installer resource.
async function assertPrivateOwnerDirectory(directory, { allowMissing = false } = {}) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let info;
    try { info = await fs.lstat(current); }
    catch (error) {
      if (allowMissing && error?.code === 'ENOENT') continue;
      throw new Error('persistent_client_owner_directory_invalid');
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('persistent_client_owner_directory_invalid');
  }
  if (!allowMissing) {
    const [physical, repository] = await Promise.all([fs.realpath(absolute), fs.realpath(checkout)]);
    if (isInside(repository, physical) || isInside(physical, repository)) {
      throw new Error('persistent_client_owner_directory_invalid');
    }
  }
}

export async function provisionPersistentClientProvider({
  ownerFile,
  baseUrl,
  runtimeIdentityFile,
  ownerChoice,
  appDataDirectory,
  runtimeHost,
  replaceExisting = false,
} = {}) {
  if (ownerChoice !== 'LOCAL_POSTGRES') throw new Error('persistent_client_owner_choice_required');
  const expected = localStateProviderOwnerFile({ env: { APPDATA: appDataDirectory }, platform: 'win32' });
  if (!expected || !path.isAbsolute(String(ownerFile || '')) || path.resolve(ownerFile) !== path.resolve(expected) || isInside(checkout, ownerFile)) {
    throw new Error('persistent_client_owner_file_invalid');
  }
  const config = validateLocalStateProviderConfig({
    schema: LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, version: 1,
    profile: LOCAL_STATE_PROVIDER_PROFILE, provider: 'LOCAL_POSTGRES',
    base_url: baseUrl, runtime_identity_file: runtimeIdentityFile, authority_effect: false,
    ...(runtimeHost === undefined ? {} : { runtime_host: runtimeHost }),
  });
  const directory = path.dirname(ownerFile);
  // Check ancestors even for an unchanged existing owner: idempotent admission
  // must not trust a matching config reached through a reparse-point parent.
  await assertPrivateOwnerDirectory(directory, { allowMissing: true });
  // Never replace a live owner file by rename: there is no durable
  // expected-version CAS here. A malformed/unreadable prior file MUST NOT be
  // treated as permission to overwrite it even with replaceExisting=true.
  let existingStat = null;
  try { existingStat = await fs.lstat(ownerFile); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (existingStat) {
    if (!existingStat.isFile() || existingStat.isSymbolicLink() || existingStat.nlink !== 1
      || existingStat.size < 1 || existingStat.size > 16384) throw new Error('persistent_client_existing_file_invalid');
    let prior;
    try { prior = validateLocalStateProviderConfig(JSON.parse(await fs.readFile(ownerFile, 'utf8'))); }
    catch { throw new Error('persistent_client_existing_file_invalid'); }
    if (JSON.stringify(prior) === JSON.stringify(config)) {
      await assertPrivateOwnerDirectory(directory);
      return Object.freeze({ state: 'ALREADY_CONFIGURED', owner_file: ownerFile, config, authority_effect: false });
    }
    if (replaceExisting) throw new Error('persistent_client_owner_replacement_requires_verified_cas');
    throw new Error('persistent_client_owner_file_exists');
  }
  await fs.mkdir(directory, { recursive: true });
  await assertPrivateOwnerDirectory(directory);
  const temporary = `${ownerFile}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    // Atomic exclusive publication: a concurrent writer can create the
    // destination, but cannot have its bytes replaced or deleted by this call.
    await fs.link(temporary, ownerFile);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  return Object.freeze({ state: 'CONFIGURED', owner_file: ownerFile, config, authority_effect: false });
}
