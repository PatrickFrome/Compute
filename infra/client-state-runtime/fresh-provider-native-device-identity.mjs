// CONDITIONAL ELECTRON BUILT-IN: explicitly reviewed only at this module path.
// The ordinary Node runtime/CLI must never load it. No Electron npm dependency
// belongs in the offline Node bundle. Imported only after native setup consent.
import {app,safeStorage} from 'electron';
import path from 'node:path';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
import {validateInstalledFreshIdentityDirectory} from '../../apps/metaengine-browser/src/fresh-provider-device-profile.mjs';

export async function createFreshInstalledDeviceIdentity() {
  if(arguments.length||process.platform!=='win32'||!process.versions.electron||process.type!=='browser'
    ||app?.isPackaged!==true||app.isReady()!==true||app.hasSingleInstanceLock()!==true
    ||globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__===true)throw Error('fresh_native_device_identity_unavailable');
  const userData=await validateInstalledFreshIdentityDirectory(app.getPath('userData'),process.env.APPDATA);
  if(globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__===true)throw Error('fresh_native_device_identity_unavailable');
  // Constructor is deliberately side-effect free. The owning provider invokes
  // ensure only AFTER native confirmation. Main reloads this same profile file;
  // no alternate device, caller-selected secureStorage, or key export exists.
  return new SupervisorDeviceIdentity({statePath:path.join(userData,'metaengine-native-supervisor-device-v1.json'),secureStorage:safeStorage});
}
