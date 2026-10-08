import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, LOCAL_STATE_PROVIDER_PROFILE, localStateProviderOwnerFile, validateLocalStateProviderConfig } from '../../apps/metaengine-browser/src/local-state-provider-policy.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isInside = (parent, file) => {
  const relative = path.relative(parent, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export async function provisionPersistentClientProvider({
  ownerFile,
  baseUrl,
  runtimeIdentityFile,
  ownerChoice,
  appDataDirectory,
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
  });
  let existingOwnerFile = false;
  try {
    const existingStat = await fs.lstat(ownerFile);
    if (!existingStat.isFile() || existingStat.isSymbolicLink()) throw new Error('persistent_client_existing_file_invalid');
    existingOwnerFile = true;
    const existing = validateLocalStateProviderConfig(JSON.parse(await fs.readFile(ownerFile, 'utf8')));
    if (JSON.stringify(existing) === JSON.stringify(config)) return Object.freeze({ state: 'ALREADY_CONFIGURED', owner_file: ownerFile, config, authority_effect: false });
    if (!replaceExisting) throw new Error('persistent_client_owner_file_exists');
  } catch (error) {
    if (error?.message === 'persistent_client_existing_file_invalid') throw error;
    if (error?.code !== 'ENOENT' && !replaceExisting) throw error;
  }
  await fs.mkdir(path.dirname(ownerFile), { recursive: true });
  const stat = await fs.lstat(path.dirname(ownerFile));
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('persistent_client_owner_directory_invalid');
  const temporary = `${ownerFile}.${process.pid}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
  try {
    if (existingOwnerFile && replaceExisting) await fs.rename(temporary, ownerFile);
    else {
      // Exclusive hard-link publication preserves a concurrent owner's file.
      await fs.link(temporary, ownerFile);
      await fs.rm(temporary);
    }
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return Object.freeze({ state: 'CONFIGURED', owner_file: ownerFile, config, authority_effect: false });
}
