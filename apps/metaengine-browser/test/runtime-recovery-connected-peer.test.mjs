import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSameExecutableRuntimeRecoveryAdapter} from '../src/runtime-recovery-process-adapter.mjs';
import {openGuardianConnectedPeerNative} from '../src/guardian-connected-peer-native.mjs';

test('native peer loader accepts no caller provider and refuses an ordinary Node process', async () => {
  await assert.rejects(openGuardianConnectedPeerNative({verified:true}), {code:'GUARDIAN_CONNECTED_PEER_OPTIONS_FORBIDDEN'});
  await assert.rejects(openGuardianConnectedPeerNative('caller-selected.node'), {code:'GUARDIAN_CONNECTED_PEER_OPTIONS_FORBIDDEN'});
  await assert.rejects(openGuardianConnectedPeerNative(), {code:'GUARDIAN_CONNECTED_PEER_PACKAGED_MAIN_REQUIRED'});
});

test('an unqualified Node caller cannot reach planned quit or legacy relaunch through an app-shaped object', async () => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-peer-quit-fence-')));
  try {
    const executable = path.join(temporary, 'inert-browser.exe');
    await fs.writeFile(executable, 'inert process-image oracle; never executed');
    const processState = {schema:'metaengine.browser.runtime-recovery-process.v1',state:'PRESENT',
      pid:process.pid,created_100ns:'134000000000000000',executable,authority_effect:false};
    let before = 0, relaunched = 0, quit = 0;
    const adapter = createSameExecutableRuntimeRecoveryAdapter({
      app:{isPackaged:true,getPath:()=>executable,relaunch:()=>{relaunched++;},quit:()=>{quit++;}},
      beforeRelaunch:async()=>{before++;},readProcess:async()=>processState,
    });
    const origin = await adapter.capture();
    await assert.rejects(adapter.requestRelaunch(randomUUID(),origin), /guardian_connected_peer|controlled_main_launch/);
    assert.deepEqual({before,relaunched,quit},{before:0,relaunched:0,quit:0});
  } finally { await fs.rm(temporary,{recursive:true,force:true}); }
});
