import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const read = relative => fs.readFile(new URL(relative, import.meta.url), 'utf8');

test('assisted installer preview has no client shutdown and committed install gates old-version removal and extraction', async () => {
  const [custom, entry, section, check, assisted] = await Promise.all([
    read('../build/installer.nsh'),
    read('../node_modules/app-builder-lib/templates/nsis/installer.nsi'),
    read('../node_modules/app-builder-lib/templates/nsis/installSection.nsh'),
    read('../node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh'),
    read('../node_modules/app-builder-lib/templates/nsis/assistedInstaller.nsh'),
  ]);
  // Validate the actual dependency hook placement: customInstall runs too late.
  const running = section.indexOf('!insertmacro CHECK_APP_RUNNING');
  const remove = section.indexOf('!insertmacro uninstallOldVersion');
  const extract = section.indexOf('!insertmacro installApplicationFiles');
  assert.ok(running >= 0 && running < remove && remove < extract);
  assert.ok(section.indexOf('!insertmacro customInstall') > extract);
  assert.match(check, /!macro CHECK_APP_RUNNING[\s\S]*?!ifmacrodef customCheckAppRunning\s*!insertmacro customCheckAppRunning/);

  const onInit = /Function \.onInit\b([\s\S]*?)FunctionEnd/.exec(entry)?.[1];
  assert.ok(onInit);
  assert.doesNotMatch(onInit, /CHECK_APP_RUNNING|customCheckAppRunning|customInstall/);
  assert.doesNotMatch(custom, /!macro (?:customInit|preInit)\b/);
  const welcome = /!macro customWelcomePage\b([\s\S]*?)!macroend/.exec(custom)?.[1];
  assert.match(welcome, /!insertmacro MUI_PAGE_WELCOME/);
  assert.doesNotMatch(welcome, /Exec|CHECK_APP_RUNNING|shutdown|Call/i);
  assert.ok(assisted.indexOf('!insertmacro customWelcomePage') < assisted.indexOf('!insertmacro MUI_PAGE_INSTFILES'));

  const shutdown = /!macro customCheckAppRunning\b([\s\S]*?)!macroend/.exec(custom)?.[1];
  assert.ok(shutdown);
  assert.match(shutdown, /File \/oname=\$PLUGINSDIR\\metaengine-installer-shutdown\.ps1/);
  assert.match(shutdown, /ExecWait [^\n]+-InstalledExe "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/);
  assert.match(shutdown, /-WindowStyle Hidden/);
  assert.doesNotMatch(shutdown, /IfFileExists/);
  assert.match(shutdown, /StrCmp \$0 "0" metaengine_installer_shutdown_done/);
  assert.match(shutdown, /metaengine_installer_shutdown_abort:\s*Abort/);
  assert.doesNotMatch(shutdown, /taskkill|Stop-Process\s+-Name/i);
});

test('new uninstaller uses the same exact-path cleanup gate before removing files', async () => {
  const custom = await read('../build/installer.nsh');
  const uninstaller = await read('../node_modules/app-builder-lib/templates/nsis/uninstaller.nsh');
  assert.match(custom, /!macro customCheckAppRunning/);
  assert.match(uninstaller, /Function un\.checkAppRunning\s*!insertmacro CHECK_APP_RUNNING\s*FunctionEnd/);
  const section = /Section "un\.\$\{UNINSTALL_SECTION_NAME\}"([\s\S]*?)SectionEnd/.exec(uninstaller)?.[1];
  assert.ok(section);
  assert.ok(section.indexOf('call un.checkAppRunning') < section.indexOf('!insertmacro customRemoveFiles'));
});

test('installer colors the existing outer dialog after the bundled MUI controls are initialized', async t => {
  const nsisRoot = process.env.METAENGINE_NSIS_TEST_ROOT || path.join(os.homedir(), 'AppData', 'Local',
    'electron-builder', 'Cache', 'nsis-3.0.4.1', 'nsis-3.0.4.1-1mx3n');
  let template;
  try {
    template = await fs.readFile(path.join(nsisRoot, 'Contrib', 'Modern UI 2', 'Interface.nsh'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('NSIS bundled Modern UI 2 template is unavailable on this host');
    return;
  }
  const custom = await read('../build/installer.nsh');
  const guiInit = /!macro MUI_FUNCTION_GUIINIT\b([\s\S]*?)!macroend/.exec(template)?.[1];
  assert.ok(guiInit, 'the actual NSIS template must expose the GUI initialization callback');
  const initControls = guiInit.indexOf('!insertmacro MUI_GUIINIT_OUTERDIALOG');
  const callCustom = guiInit.indexOf('Call "${MUI_CUSTOMFUNCTION_GUIINIT}"');
  assert.ok(initControls >= 0 && callCustom > initControls, 'brand handles exist before our callback');
  assert.match(template, /GetDlgItem \$mui\.Branding\.Background \$HWNDPARENT 1028/);
  assert.match(template, /GetDlgItem \$mui\.Branding\.Text \$HWNDPARENT 1256/);
  assert.match(custom, /!define MUI_CUSTOMFUNCTION_GUIINIT metaengineInstallerGuiInit/);
  const callback = /Function metaengineInstallerGuiInit\b([\s\S]*?)FunctionEnd/.exec(custom)?.[1];
  assert.ok(callback);
  assert.match(callback, /SetCtlColors \$HWNDPARENT/);
  assert.match(callback, /GetDlgItem \$0 \$HWNDPARENT 1028\s*SetCtlColors \$0/);
  assert.match(callback, /GetDlgItem \$0 \$HWNDPARENT 1256\s*SetCtlColors \$0/);
  assert.match(callback, /DwmSetWindowAttribute\(p \$HWNDPARENT, i 20/);
  assert.match(callback, /Push \$0[\s\S]*Pop \$0/);
  assert.doesNotMatch(callback, /Exec|shutdown|CHECK_APP_RUNNING|SendMessage|GetDlgItem.*(?: 1| 2| 3)\b/i);
});

test('NSIS helper launch errors branch to HOLD before an undefined/stale exit variable is inspected', async () => {
  const source=await read('../build/installer.nsh');
  const macro=/!macro customCheckAppRunning\b([\s\S]*?)!macroend/.exec(source)?.[1];
  assert.ok(macro);
  assert.match(macro,/ClearErrors\s+ExecWait[^\n]+\n\s+IfErrors metaengine_installer_shutdown_failed\s+StrCmp \$0 "0" metaengine_installer_shutdown_done/);
  assert.match(macro,/metaengine_installer_shutdown_failed:\s+IfSilent metaengine_installer_shutdown_abort 0/);
  // Inert control-flow model of the actual macro; this is not an NSIS binary
  // execution proof. ExecWait's output is deliberately left stale on failure.
  const lines=macro.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith(';'));
  const labels=new Map(lines.map((line,index)=>[line.endsWith(':')?line.slice(0,-1):'',index]));
  const run=({launchFailed,exitCode,initialError=false})=>{
    let error=initialError,code='0';
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(line==='ClearErrors')error=false;
      else if(line.startsWith('ExecWait')){if(launchFailed)error=true;else code=String(exitCode);}
      else if(line.startsWith('IfErrors ')&&error)i=labels.get(line.split(/\s+/)[1]);
      else if(line.startsWith('StrCmp $0 "0" ')&&code==='0')i=labels.get(line.split(/\s+/)[3]);
      else if(line.startsWith('IfSilent '))i=labels.get(line.split(/\s+/)[1]);
      else if(line==='Abort')return 'HOLD';
    }
    return 'FILE_GATE_PASSED';
  };
  assert.equal(run({launchFailed:true,exitCode:0}),'HOLD','undefined stale zero cannot confirm helper execution');
  assert.equal(run({launchFailed:false,exitCode:23}),'HOLD');
  assert.equal(run({launchFailed:false,exitCode:0,initialError:true}),'FILE_GATE_PASSED');
});

test('existing-install transition is held before old uninstaller execution; fresh staging stays outside the target',async()=>{
  const [custom,helper,entry,section,util,common,config]=await Promise.all([
    read('../build/installer.nsh'),read('../build/installer-shutdown.ps1'),
    read('../node_modules/app-builder-lib/templates/nsis/installer.nsi'),read('../node_modules/app-builder-lib/templates/nsis/installSection.nsh'),
    read('../node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh'),read('../node_modules/app-builder-lib/templates/nsis/common.nsh'),read('../electron-builder.test.json'),
  ]);
  const macro=/!macro customCheckAppRunning\b([\s\S]*?)!macroend/.exec(custom)?.[1];
  assert.match(macro,/!ifndef BUILD_UNINSTALLER[\s\S]*?!define METAENGINE_FRESH_INSTALL_ARGS '-RequireFreshInstall -InstallRegistryKey "\$\{INSTALL_REGISTRY_KEY\}" -UninstallRegistryKey "\$\{UNINSTALL_REGISTRY_KEY\}"'/);
  assert.match(macro,/UNINSTALL_REGISTRY_KEY_2[\s\S]*?-UninstallRegistryKey2/);
  assert.match(macro,/ExecWait[^\n]+\$\{METAENGINE_FRESH_INSTALL_ARGS\} \$\{METAENGINE_FRESH_INSTALL_EXTRA_ARGS\}/);
  assert.match(helper,/if \(\$RequireFreshInstall\)[\s\S]*?Get-ChildItem[^\n]+-Force[\s\S]*?existing_installation_unqualified/);
  assert.match(helper,/RegistryHive\]::CurrentUser, \[Microsoft.Win32.RegistryHive\]::LocalMachine/);
  assert.match(helper,/RegistryView\]::Registry32, \[Microsoft.Win32.RegistryView\]::Registry64/);
  assert.match(helper,/OpenSubKey\(\$keyName, \$false\)/);
  assert.match(helper,/catch\s*\{\s*throw 'installer_transition_registry_presence_unknown'/);
  assert.doesNotMatch(helper,/Set-Item|New-Item|SetValue|CreateSubKey|DeleteSubKey/);
  assert.ok(section.indexOf('!insertmacro CHECK_APP_RUNNING')<section.indexOf('!insertmacro uninstallOldVersion'));
  assert.match(util,/ExecWait[^\n]+old-uninstaller|ExecWait[^\n]+\$uninstallerFileNameTemp/);
  assert.match(macro,/File \/oname=\$PLUGINSDIR\\metaengine-installer-shutdown\.ps1/);
  const beforeCheck=section.slice(0,section.indexOf('!insertmacro CHECK_APP_RUNNING'));
  assert.doesNotMatch(beforeCheck,/SetOutPath \$INSTDIR|File \/oname=\$INSTDIR/);
  // onInit may create the directory, but the enabled configuration does not
  // emit debug logs there. Empty pre-created roots must pass the fresh check.
  assert.match(entry,/SetOutPath \$INSTDIR\s+\$\{LogSet\} on/);
  assert.match(common,/!macro LogSetMacro SETTING[\s\S]*?!ifdef/);
  assert.notEqual(JSON.parse(config).nsis?.customNsisBinary?.debugLogging,true);
  assert.match(helper,/Get-ChildItem[^\n]+Select-Object -First 1/);
});
