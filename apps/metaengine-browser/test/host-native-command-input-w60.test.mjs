import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Install the hook before W60 captures execFile. No actual process or path is
// consulted: this verifies ownership of the private input pipe and preserves
// the real Windows physical tests as independent evidence.
test('W60 default native command closes only its own stdin and retains fail-closed deadlines', () => {
  const target = new URL('../src/host-native-owner-producers-w60.mjs', import.meta.url).href;
  const code = `
    import assert from 'node:assert/strict';
    import { promisify } from 'node:util';
    import { syncBuiltinESMExports } from 'node:module';
    import cp from 'node:child_process';
    let ended=0,calls=0,fail=false;
    const native=()=>{throw Error('unexpected_callback_call')};
    native[promisify.custom]=(program,args,options)=>{
      calls++;
      assert.equal(program,'C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe');
      assert.equal(options.shell,false);
      assert.equal(options.timeout,15000);
      assert.equal(options.maxBuffer,4096);
      assert.equal(options.windowsHide,true);
      assert.equal(options.env.PATH,'C:\\\\Windows\\\\System32');
      assert.match(args.at(-1),/Get-Process -Id/);
      const value=fail?Promise.reject(Object.assign(Error('private failure'),{
        code:'ETIMEDOUT',killed:true,stdout:'{"pid":1234,"state":"NOT_RUNNING"}'
      })):Promise.resolve({stdout:JSON.stringify({
        pid:1234,created_at:'2026-10-15T00:00:00.000Z',exe_path:'C:\\\\fixed.exe'
      })});
      value.child={stdin:{end(){ended++}}};
      return value;
    };
    cp.execFile=native;
    syncBuiltinESMExports();
    process.env.SystemRoot='C:\\\\Windows';
    process.env.SYSTEMROOT='C:\\\\Windows';
    process.env.WINDIR='C:\\\\Windows';
    const {readWindowsKernelProcessW60}=await import(${JSON.stringify(target)});
    assert.equal((await readWindowsKernelProcessW60(1234,{platform:'win32'}))?.state,'PRESENT');
    assert.equal(calls,1);
    assert.equal(ended,1);
    fail=true;
    assert.equal(await readWindowsKernelProcessW60(1234,{platform:'win32'}),null);
    assert.equal(calls,2);
    assert.equal(ended,2);
    assert.equal(await readWindowsKernelProcessW60('1234',{platform:'win32'}),null);
    assert.equal(calls,2);
    assert.equal(ended,2);
    process.stdout.write('W60_CHILD_INPUT_CLOSED');
  `;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{
    encoding:'utf8',windowsHide:true,timeout:15000,
  });
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),'W60_CHILD_INPUT_CLOSED');
});
