import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { verifyInstalledClientStateResources } from './local-runtime-host-controller.mjs';
import { inspectRestoredRuntimePreparationMode, prepareDurableRestoredPg17, prepareInstalledAttachedPg17 } from './local-restored-pg17-auto-prepare.mjs';
import { verifyOwnerOnlyWindowsStorage } from './private-windows-storage-acl.mjs';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{64}$/;
const ACTION = 'USE_EXISTING_RESTORED_POSTGRES_17';
const local = value => typeof value === 'string' && value.length < 2048 && path.isAbsolute(value)
  && !/^(?:\\\\|\/\/)/.test(value) && !/[\x00-\x1f]/.test(value);
const fail = name => { throw new Error('installed_restored_setup_' + name); };

// A normal packaged launch consumes this path-only descriptor to attach the
// already configured Keeper. It contains no password, Vault material, or
// database URL, and replaces the interactive first-run database wizard.
export const LOCAL_ATTACHED_AUTOCONNECT_SCHEMA = 'metaengine.browser.local-attached-autoconnect.v1';
export const LOCAL_ATTACHED_AUTOCONNECT_FILE = 'attached-provider-autoconnect.json';
export const LOCAL_ATTACHED_AUTOCONNECT_DIRECTORY = 'client-state-attached-50';
const AUTOCONNECT_MAX_BYTES = 16 * 1024;

export function localAttachedProviderAutoConnectFile({ env = process.env, platform = process.platform } = {}) {
  const root = String(platform === 'win32' ? env.LOCALAPPDATA || '' : '').trim();
  if (!root || !path.isAbsolute(root) || /^(?:\\\\|\/\/)/.test(root)) return null;
  // Keep the descriptor beside the already protected attached runtime config.
  // The METAENGINE parent is intentionally not used: its broad user profile
  // ACL is unsuitable for an onboarding input that can select a database.
  return path.join(root, 'METAENGINE', LOCAL_ATTACHED_AUTOCONNECT_DIRECTORY, LOCAL_ATTACHED_AUTOCONNECT_FILE);
}

async function readAutoConnectDescriptor(file, verifyStorage) {
  let stat;
  try { stat = await fs.lstat(file); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('autoconnect_descriptor_unreadable');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > AUTOCONNECT_MAX_BYTES) {
    fail('autoconnect_descriptor_invalid');
  }
  // A descriptor selects a database at ordinary startup. Verify every physical
  // ancestor and its private DACL before accepting any selected config path.
  const physicalFile = path.resolve(file);
  let current = path.parse(physicalFile).root;
  for (const part of path.relative(current, physicalFile).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const item = await fs.lstat(current);
    if (item.isSymbolicLink() || (current !== physicalFile && !item.isDirectory())) fail('autoconnect_descriptor_invalid');
  }
  if (await fs.realpath(physicalFile) !== physicalFile) fail('autoconnect_descriptor_invalid');
  try {
    for (const [target, operation] of [[path.dirname(physicalFile), 'VERIFY_DIRECTORY'], [physicalFile, 'VERIFY_FILE']]) {
      const verified = await verifyStorage(target, { operation });
      if (verified?.owner_dacl_verified !== true || verified.operation !== operation) fail('autoconnect_descriptor_unverified');
    }
  } catch { fail('autoconnect_descriptor_unverified'); }
  const bytes = await fs.readFile(file);
  const after = await fs.lstat(file);
  if (bytes.length !== stat.size || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs
    || after.isSymbolicLink() || after.nlink !== 1) fail('autoconnect_descriptor_unreadable');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('autoconnect_descriptor_invalid'); }
  const keys = ['schema', 'version', 'postgres_mode', 'config_file', 'restore_receipt_file',
    'restore_receipt_sha256', 'authority_effect'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || value.schema !== LOCAL_ATTACHED_AUTOCONNECT_SCHEMA || value.version !== 1
    || value.postgres_mode !== 'attached' || value.authority_effect !== false
    || !local(value.config_file) || !local(value.restore_receipt_file)
    || !SHA.test(String(value.restore_receipt_sha256 || ''))) {
    fail('autoconnect_descriptor_invalid');
  }
  return Object.freeze({ schema: LOCAL_ATTACHED_AUTOCONNECT_SCHEMA, version: 1,
    postgres_mode: 'attached', config_file: path.normalize(value.config_file),
    restore_receipt_file: path.normalize(value.restore_receipt_file),
    restore_receipt_sha256: String(value.restore_receipt_sha256).toLowerCase(), authority_effect: false });
}

/** Attach the existing local Keeper during packaged startup. */
export async function autoConnectInstalledAttachedProvider({
  env = process.env, platform = process.platform, resourcesPath = process.resourcesPath,
  appDataDirectory = env.APPDATA, operator = connectInstalledRestoredPostgres,
  verifyStorage = verifyOwnerOnlyWindowsStorage,
} = {}) {
  if (platform !== 'win32') return Object.freeze({ state: 'NOT_APPLICABLE', authority_effect: false });
  const descriptorFile = localAttachedProviderAutoConnectFile({ env, platform });
  if (!descriptorFile) return Object.freeze({ state: 'NO_DESCRIPTOR', authority_effect: false });
  const descriptor = await readAutoConnectDescriptor(descriptorFile, verifyStorage);
  if (!descriptor) return Object.freeze({ state: 'NO_DESCRIPTOR', authority_effect: false });
  if (!local(appDataDirectory) || !local(resourcesPath)) fail('autoconnect_arguments_invalid');
  let result;
  try {
    result = await operator({ configFile: descriptor.config_file,
      restoreReceiptFile: descriptor.restore_receipt_file,
      restoreReceiptSha256: descriptor.restore_receipt_sha256, appDataDirectory, resourcesPath,
      autoPrepareSource: true, expectedPostgresMode: 'attached',
      localAppDataDirectory: env.LOCALAPPDATA, platform });
  } catch { fail('autoconnect_operator_not_confirmed'); }
  if (result?.state !== 'CONFIGURED' || result.owner_profile_written !== true
    || result.postgres_mode !== 'attached' || result.automatic_cloud_fallback !== false
    || result.authority_effect !== false) fail('autoconnect_receipt_unverified');
  return Object.freeze({ state: 'CONFIGURED', provider: 'LOCAL_POSTGRES', postgres_mode: 'attached',
    descriptor_file: descriptorFile, owner_profile_written: true, automatic_cloud_fallback: false,
    authority_effect: false });
}

// No PGDATA, Vault, credential or cloud connection is packaged here. The
// sealed installed runtime contains the reviewed provisioning operator, which
// alone qualifies the existing private local PG17 and publishes an absent owner.
export async function connectInstalledRestoredPostgres({
  configFile, restoreReceiptFile, restoreReceiptSha256, appDataDirectory,
  autoPrepareSource = false, localAppDataDirectory = process.env.LOCALAPPDATA,
  expectedPostgresMode,
  prepare = prepareDurableRestoredPg17,
  prepareAttached = prepareInstalledAttachedPg17, inspectMode = inspectRestoredRuntimePreparationMode,
  resourcesPath = process.resourcesPath, packageFile = new URL('../package.json', import.meta.url),
  verify = verifyInstalledClientStateResources, launch = exec, platform = process.platform,
} = {}) {
  if (platform !== 'win32' || ![configFile,restoreReceiptFile,appDataDirectory,resourcesPath].every(local)
    || !SHA.test(restoreReceiptSha256 || '')) fail('arguments_invalid');
  const bundleDirectory = path.join(resourcesPath, 'client-state-runtime');
  let pkg;
  try { pkg = JSON.parse(await fs.readFile(packageFile,'utf8')); }
  catch { fail('package_binding_unreadable'); }
  const expectedBundleDigest = pkg?.metaengineClientStateRuntime?.bundle_sha256;
  if (!SHA.test(expectedBundleDigest || '')
    || pkg?.metaengineClientStateRuntime?.package_version !== pkg?.version)
    fail('package_binding_invalid');
  let verified;
  try { verified = await verify({bundleDirectory,expectedBundleDigest}); }
  catch { fail('runtime_unverified'); }
  const entry = path.join(bundleDirectory,'source','infra','client-state-runtime','restored-client-provider-cli.mjs');
  if (!local(verified?.paths?.nodeExecutable)
    || !verified?.manifest?.files?.some(x => x.path === 'source/infra/client-state-runtime/restored-client-provider-cli.mjs'))
    fail('operator_not_in_verified_bundle');
  // Automatic installed startup requests rebinding. Legacy direct
  // CLI callers still use their explicitly verified prepared configs.
  // No new DB is created, and all inputs stay on the owner's Windows host.
  let attachedConfigFile=configFile;
  let postgresMode='owned';
  if(autoPrepareSource===true){
    if(!local(localAppDataDirectory))fail('local_appdata_required');
    let prepared;
    try {
      const selection=await inspectMode(configFile);
      postgresMode=selection?.postgresMode;
      if(!['owned','attached'].includes(postgresMode))fail('postgres_mode_unverified');
      if(expectedPostgresMode!==undefined&&postgresMode!==expectedPostgresMode)fail('postgres_mode_changed');
      prepared=postgresMode==='attached'
        ? await prepareAttached({oldConfigFile:configFile,bundleDirectory,bundleDigest:expectedBundleDigest,platform})
        : await prepare({oldConfigFile:configFile,localAppData:localAppDataDirectory,
        bundleDirectory,bundleDigest:expectedBundleDigest,
        restoreReceiptFile,restoreReceiptSha256,
        postgresBinDirectory:verified.paths.postgresBinDirectory,platform});
    }catch{fail('durable_copy_or_rebinding_unconfirmed');}
    if(!local(prepared?.configFile)||prepared.vaultPreserved!==true
      ||(postgresMode==='owned'&&prepared.copyVerified!==true)
      ||(postgresMode==='attached'&&(prepared.postgresMode!=='attached'||prepared.apiRoleMode!=='direct'
        ||prepared.clusterPinPreserved!==true||prepared.postgresLifecycleOwned!==false||prepared.copyVerified!==false)))
      fail('durable_copy_unverified');
    attachedConfigFile=prepared.configFile;
  }
  const argv = [entry,'--config',attachedConfigFile,'--bundle-sha256',expectedBundleDigest,
    '--restore-receipt',restoreReceiptFile,'--restore-receipt-sha256',restoreReceiptSha256,
    '--appdata',appDataDirectory,'--owner-action',ACTION];
  let output;
  try {
    output = await launch(verified.paths.nodeExecutable,argv,{
      windowsHide:true,shell:false,timeout:240000,maxBuffer:16384,
      env:Object.fromEntries(['SystemRoot','SYSTEMROOT','WINDIR','USERPROFILE','TEMP','TMP',
        'PATH','Path','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH']
        .filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]])),
    });
  } catch { fail('operator_not_confirmed'); }
  let receipt;
  try { receipt = JSON.parse(String(output?.stdout || '').trim()); }
  catch { fail('receipt_unverified'); }
  if (receipt?.schema !== 'compute.restored-client-provider-provisioning.v1'
    || receipt.state !== 'CONFIGURED' || receipt.provider !== 'LOCAL_POSTGRES'
    || receipt.existing_restored_database_selected !== true
    || receipt.source_restore_receipt_verified !== true
    || receipt.owner_profile_written !== true || receipt.cleanup_confirmed !== true
    || receipt.private_vault_key_preserved !== true || receipt.runtime_ready !== false
    || receipt.database_initialized !== false || receipt.authority_effect !== false
    || receipt.bundle_sha256 !== expectedBundleDigest
    || receipt.source_restore_receipt_sha256 !== restoreReceiptSha256)
    fail('receipt_unverified');
  if(postgresMode==='attached'&&(receipt.postgres_mode!=='attached'||receipt.api_role_mode!=='direct'
    ||receipt.postgres_lifecycle_owned!==false||receipt.attached_postmaster_preserved!==true))fail('attached_receipt_unverified');
  // Return only fixed public booleans. Never return the subprocess' raw JSON.
  return Object.freeze({state:'CONFIGURED',provider:'LOCAL_POSTGRES',
    postgres_mode:receipt.postgres_mode||postgresMode,
    owner_profile_written:true,private_vault_key_preserved:true,
    cleanup_confirmed:true,runtime_ready:false,installed_cold_boot_verified:false,
    automatic_cloud_fallback:false,authority_effect:false});
}
