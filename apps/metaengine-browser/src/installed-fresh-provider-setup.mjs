import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyInstalledClientStateResources} from './local-runtime-host-controller.mjs';
const ACTION='INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT';
const ENTRY='source/infra/client-state-runtime/fresh-client-provider.mjs';
const IDENTITY_ENTRY='source/infra/client-state-runtime/fresh-provider-native-device-identity.mjs';

// Fixed phase evidence only: no paths, errors, credentials or admission claims.
// A first-run native consent wait is not an admitted Browser runtime.
function observeSetup(state) {
  console.error(JSON.stringify({schema:'metaengine.browser.fresh-provider-setup.v1',state,
    pid:process.pid,browser_runtime_started:false,automatic_cloud_fallback:false,
    diagnostic_only:true,authority_effect:false}));
}


export function validateInstalledFreshProviderReceipt(receipt,digest) {
  if(receipt?.schema!=='compute.fresh-client-provider.v1'||receipt.state!=='CONFIGURED'||receipt.provider!=='LOCAL_POSTGRES'
    ||receipt.bundle_sha256!==digest||receipt.database_initialized!==true||receipt.schema_provisioned!==true
    ||receipt.owner_profile_written!==true||receipt.cleanup_confirmed!==true||receipt.device_enrolled!==true||receipt.admin_ready!==true
    ||![receipt.device_id,receipt.client_id,receipt.request_id].every(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value||''))
    ||!/^[0-9a-f]{64}$/.test(receipt.key_fingerprint_sha256||'')
    ||receipt.guardian_ready!==false||receipt.runtime_ready!==false||receipt.automatic_retry_allowed!==false
    ||receipt.automatic_cloud_fallback!==false||receipt.authority_effect!==false)throw Error('installed_fresh_provider_receipt_unconfirmed');
  return Object.freeze({state:'CONFIGURED',owner_profile_written:true,device_enrolled:true,admin_ready:true,guardian_ready:false,runtime_ready:false,authority_effect:false});
}

// Called by the admitted primary only after existing-owner and attached-Keeper
// discovery. The owning operator requests native consent; this invocation is
// NOT permission to initialize a database or approve a device.
export async function setupInstalledFreshProvider({app,resourcesPath=process.resourcesPath,
  packageFile=new URL('../package.json',import.meta.url),verify=verifyInstalledClientStateResources,
  platform=process.platform,env=process.env}={}) {
  if(platform!=='win32'||app?.isPackaged!==true)throw Error('installed_fresh_provider_windows_package_required');
  const pkg=JSON.parse(await fs.readFile(packageFile,'utf8'));
  const digest=pkg.metaengineClientStateRuntime?.bundle_sha256;
  if(!/^[a-f0-9]{64}$/.test(digest||'')||pkg.metaengineClientStateRuntime.package_version!==pkg.version)throw Error('installed_fresh_provider_binding_invalid');
  const bundleDirectory=path.join(resourcesPath,'client-state-runtime');
  observeSetup('RESOURCE_VERIFICATION_STARTED');
  const verified=await verify({bundleDirectory,expectedBundleDigest:digest});
  observeSetup('RESOURCE_VERIFICATION_COMPLETED');
  if(![ENTRY,IDENTITY_ENTRY].every(entry=>verified.manifest.files.some(row=>row.path===entry)))throw Error('installed_fresh_provider_entry_not_packaged');
  if(!path.isAbsolute(env.LOCALAPPDATA||'')||!path.isAbsolute(env.APPDATA||''))throw Error('installed_fresh_provider_owner_roots_invalid');
  const setupRoot=path.join(env.LOCALAPPDATA,'METAENGINE','client-first-run-v1');
  // A prior journal, partial DB or unknown result is never another automatic
  // install attempt, even if the Browser Owner profile was not published.
  try {await fs.lstat(setupRoot);throw Error('installed_fresh_provider_existing_setup_requires_review');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  // Release top-level Electron ESM readiness in main-entry before awaiting here.
  observeSetup('ELECTRON_READY_AWAITED');
  await app.whenReady();
  observeSetup('ELECTRON_READY_OBSERVED');
  if(globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__===true)throw Error('installed_fresh_provider_cancelled');
  // The operator acquires the actual Electron app/safeStorage/profile itself,
  // only after native consent. No signer, storage or identity path is supplied.
  // Execute the verified module in trusted native main, never a renderer or a
  // second Node identity. No credentials traverse argv, IPC, environment or logs.
  // This module owns and stops its own temporary host before main can continue.
  let receipt;
  try {
    const {provisionFreshClientProvider}=await import(pathToFileURL(path.join(bundleDirectory,ENTRY)).href);
    observeSetup('NATIVE_OPERATOR_ENTERED');
    receipt=await provisionFreshClientProvider({bundleDirectory,expectedBundleDigest:digest,ownerAction:ACTION,
      localAppData:env.LOCALAPPDATA,appData:env.APPDATA});
  }catch(error) {
    if(error?.message==='fresh_provider_native_consent_declined')throw Error('installed_fresh_provider_consent_declined');
    throw Error('installed_fresh_provider_setup_requires_review');
  }
  return validateInstalledFreshProviderReceipt(receipt,digest);
}
