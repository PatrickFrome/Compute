import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processScript, ABSENT_PROCESS_ERROR, ABSENT_PROCESS_TYPE,
  ABSENT_PROCESS_FIELDS,
} from '../src/win32-kernel-process-query-w60.mjs';

test('W60 uses fixed managed OS process and handle readback without dynamic compilation', () => {
  const script=processScript(1337);
  assert.match(script, /^\$ErrorActionPreference = "Stop"/);
  assert.match(script, /\$requestedPid = 1337/);
  for (const fragment of [
    '[System.Diagnostics.Process]::GetProcessById($requestedPid)',
    '$p.Handle',
    '$p.Id -ne $requestedPid',
    '$p.StartTime.ToUniversalTime().ToString("o")',
    '$p.MainModule.FileName',
    '$p.Dispose()',
    'W60_MANAGED_API_READY',
    'W60_PROCESS_OPENED',
    'W60_RESULT_WRITTEN',
  ]) assert(script.includes(fragment),fragment);
  assert.doesNotMatch(script, /Add-Type|Get-Process -Id|Get-CimInstance|Invoke-Expression|Start-Process|MetaengineWinProcessW60/);
  assert.equal(ABSENT_PROCESS_ERROR,'SYSTEM_DIAGNOSTICS_PROCESS_ID_NOT_FOUND');
  assert.equal(ABSENT_PROCESS_TYPE,'System.ArgumentException');
  assert.deepEqual(ABSENT_PROCESS_FIELDS,[
    'pid','state','native_error_id','native_error_category','native_error_type','native_target_pid',
  ]);
});

test('W60 only confirms absence from the scoped managed exception; access and unrelated errors stay UNKNOWN', () => {
  const script=processScript(214);
  assert.match(script,/\$requestedPid = 214/);
  assert.match(script,/System\.Management\.Automation\.MethodInvocationException/);
  assert.match(script,/\$inner.GetType\(\).FullName -ceq "System.ArgumentException"/);
  assert.match(script,/\[string\]::IsNullOrEmpty\(\[string\]\$inner.ParamName\)/);
  assert.match(script,/native_error_category = "ObjectNotFound"/);
  assert.match(script,/\s+throw\s/);
  assert.doesNotMatch(script,/\$requestedPid = 1337/);
});

test('W60 validates fixed numeric PID at the native-script boundary', () => {
  for (const unsafe of ['1337','1; Write-Output UNTRUSTED',0,-1,1.5,NaN,2147483648,null]) {
    assert.throws(() => processScript(unsafe),/w60_fixed_positive_kernel_pid_required/);
  }
});
