import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verifyInstalledClientStateResources } from './local-runtime-host-controller.mjs';
import { prepareDurableRestoredPg17 } from './local-restored-pg17-auto-prepare.mjs';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{64}$/;
const ACTION = 'USE_EXISTING_RESTORED_POSTGRES_17';
const local = value => typeof value === 'string' && value.length < 2048 && path.isAbsolute(value)
  && !/^(?:\\\\|\/\/)/.test(value) && !/[\x00-\x1f]/.test(value);
const fail = name => { throw new Error('installed_restored_setup_' + name); };

// No PGDATA, Vault, credential or cloud connection is packaged here. The
// sealed installed runtime contains the reviewed provisioning operator, which
// alone qualifies the existing private local PG17 and publishes an absent owner.
export async function connectInstalledRestoredPostgres({
  configFile, restoreReceiptFile, restoreReceiptSha256, appDataDirectory,
  autoPrepareSource = false, localAppDataDirectory = process.env.LOCALAPPDATA,
  prepare = prepareDurableRestoredPg17,
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
  // Only the installed first-run wizard requests this step. Legacy direct
  // CLI callers still use their explicitly verified prepared configs.
  // No new DB is created, and all inputs stay on the owner's Windows host.
  let attachedConfigFile=configFile;
  if(autoPrepareSource===true){
    if(!local(localAppDataDirectory))fail('local_appdata_required');
    let prepared;
    try {
      prepared=await prepare({oldConfigFile:configFile,localAppData:localAppDataDirectory,
        bundleDirectory,bundleDigest:expectedBundleDigest,
        restoreReceiptFile,restoreReceiptSha256,
        postgresBinDirectory:verified.paths.postgresBinDirectory,platform});
    }catch{fail('durable_copy_or_rebinding_unconfirmed');}
    if(!local(prepared?.configFile)||prepared.copyVerified!==true
      ||prepared.vaultPreserved!==true)fail('durable_copy_unverified');
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
  // Return only fixed public booleans. Never return the subprocess' raw JSON.
  return Object.freeze({state:'CONFIGURED',provider:'LOCAL_POSTGRES',
    owner_profile_written:true,private_vault_key_preserved:true,
    cleanup_confirmed:true,runtime_ready:false,installed_cold_boot_verified:false,
    automatic_cloud_fallback:false,authority_effect:false});
}

// Called ONLY on first interactive launch with no registered owner. All
// effects are gated by the local OS file chooser and a separate confirmation.
export async function showInstalledRestoredProviderWizard({
  app, BrowserWindow, dialog, ipcMain, resourcesPath = process.resourcesPath,
  operator = connectInstalledRestoredPostgres, env = process.env,
} = {}) {
  if (!app?.isPackaged || process.platform !== 'win32' || !local(env.APPDATA)
    || !local(env.LOCALAPPDATA) || !local(resourcesPath))
    fail('installed_windows_required');
  await app.whenReady();
  const win = new BrowserWindow({
    width:740,height:770,minWidth:600,minHeight:630,show:false,
    title:'METAENGINE — Connect existing PostgreSQL 17',autoHideMenuBar:true,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,
      preload:fileURLToPath(new URL('./local-restored-pg17-setup-preload.cjs',import.meta.url))},
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  let configFile=null,restoreReceiptFile=null,claimed=false,busy=false,closed=false,verifiedClose=false;
  let resolveResult;
  const completed = new Promise(resolve=>{resolveResult=resolve;});
  const prefix='metaengine:local-postgres-setup:';
  const authorized=event=>!closed && !win.isDestroyed() && event.sender.id===win.webContents.id;
  ipcMain.handle(prefix+'choose',async(event,kind)=>{
    if(!authorized(event) || busy || !['config','receipt'].includes(kind)) fail('sender_invalid');
    const choice=await dialog.showOpenDialog(win,{
      title:kind==='config'?'Select existing private runtime-host config':'Select verified restore report',
      properties:['openFile'],filters:[{name:'JSON',extensions:['json']}],
    });
    if(choice.canceled || choice.filePaths?.length!==1) return {selected:false};
    const selected=choice.filePaths[0];
    if(!local(selected)) fail('file_invalid');
    if(kind==='config') configFile=selected; else restoreReceiptFile=selected;
    return {selected:true,name:path.basename(selected)};
  });
  ipcMain.handle(prefix+'connect',async(event,pin)=>{
    if(!authorized(event) || claimed || busy) return {state:'BLOCKED',reason:'attempt_already_claimed'};
    if(!local(configFile)||!local(restoreReceiptFile)||!SHA.test(String(pin||'')))
      return {state:'BLOCKED',reason:'independent_evidence_required'};
    busy=true;
    try {
      const approval=await dialog.showMessageBox(win,{
        type:'warning',buttons:['Cancel','Connect existing PostgreSQL'],defaultId:0,cancelId:0,
        title:'Confirm PostgreSQL owner registration',
        message:'Connect only the selected existing PostgreSQL 17',
        detail:'Configuration: '+configFile+'\nRestore report: '+restoreReceiptFile+
          '\nExpected report SHA-256: '+pin+
          '\n\nThis verifies one stopped TEMP PostgreSQL 17 copy, copies it to permanent LOCALAPPDATA/METAENGINE state with full file hash comparison, writes a NEW private config pinned to this installed package, and checks the database before registering the previously absent owner. The original PGDATA, private configuration and Vault are never overwritten. If anything is ambiguous the wizard stops without retry.',
        noLink:true,
      });
      if(!authorized(event) || approval.response!==1) return {state:'BLOCKED',reason:'local_approval_required'};
      claimed=true;
      let receipt;
      try { receipt=await operator({configFile,restoreReceiptFile,restoreReceiptSha256:pin,
        autoPrepareSource:true,localAppDataDirectory:env.LOCALAPPDATA,
        appDataDirectory:env.APPDATA,resourcesPath}); }
      catch { return {state:'BLOCKED',reason:'operator_not_confirmed_no_automatic_retry'}; }
      if(receipt?.state!=='CONFIGURED' || receipt?.owner_profile_written!==true)
        return {state:'BLOCKED',reason:'receipt_unverified'};
      verifiedClose=true;
      resolveResult(receipt);
      if(!win.isDestroyed()) win.close();
      return {state:'CONFIGURED'};
    } finally {busy=false;}
  });
  // Once the operator might have run, closing the dialog must never create
  // an invented NO_EFFECT receipt or invite an automatic replay.
  win.on('close',event=>{if(busy && claimed && !verifiedClose)event.preventDefault();});
  win.on('closed',()=>{
    closed=true;
    ipcMain.removeHandler(prefix+'choose');ipcMain.removeHandler(prefix+'connect');
    resolveResult({state:'CANCELLED',authority_effect:false});
  });
  await win.loadFile(fileURLToPath(new URL('./local-restored-pg17-setup.html',import.meta.url)));
  win.show();
  return completed;
}
