import path from 'node:path';

// Test-only execution modes. ASAR_NODE qualifies Electron's real filesystem
// patches, not Chromium startup, GUI behavior or the Browser sandbox.
export function nativeCodingAsarQualificationMode({mode:requested,platform=process.platform,electron,explicitExecutable=false}={}){
  const mode=requested===undefined?'MAIN_PROCESS':requested;
  if(!['MAIN_PROCESS','ASAR_NODE'].includes(mode))throw Error('native_asar_qualification_mode_invalid');
  if(mode==='ASAR_NODE'&&platform!=='linux')throw Error('native_asar_node_qualification_requires_linux');
  if(typeof electron!=='string'||!path.isAbsolute(electron)){
    if(requested!==undefined||explicitExecutable)throw Error('native_asar_qualification_electron_required');
    return Object.freeze({mode,skip:'Electron executable unavailable; set METAENGINE_TEST_ELECTRON_EXECUTABLE'});
  }
  return Object.freeze({mode,skip:false});
}
