// Package data only: this is neither a trust root nor loaded-image custody.
// The existing ASAR/release-proof domain binds the manifest and complete tree.
import nodeFs from 'node:fs';
import path from 'node:path';
import {resolvePrivateNativeTools} from './private-native-tools-core.mjs';
export * from './private-native-tools-core.mjs';
const archiveFs = nodeFs.promises;
const fail = reason => {throw Error('private_native_tools_' + reason);};
export async function readPackagedPrivateNativeTools({app,resourcesPath}={}) {
  if(app?.isPackaged===false) return null; // Only an explicit Electron developer context selects this branch.
  if(app?.isPackaged!==true||typeof app.getAppPath!=='function')fail('main_context_invalid');
  if(process.platform!=='win32'||process.arch!=='x64')fail('windows_x64_required');
  const packageDoc=JSON.parse(await archiveFs.readFile(path.join(app.getAppPath(),'package.json'),'utf8'));
  return resolvePrivateNativeTools({toolsRoot:path.join(resourcesPath,'private-native-tools'),binding:packageDoc.metaenginePrivateNativeTools});
}

// Default composition for Electron Main only. No caller supplies the app,
// packaged decision or resource path. Installed Node Host uses its separately
// verified offline bundle; absence of Electron never selects developer mode.
export async function readMainPrivateNativeTools() {
  if(!process.versions.electron)fail('main_context_required');
  if(process.type!=='browser')fail('main_process_required');
  const {app}=await import('electron');
  if(typeof app?.isPackaged!=='boolean')fail('main_context_invalid');
  return readPackagedPrivateNativeTools({app,resourcesPath:process.resourcesPath});
}
