import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processScript, ABSENT_PROCESS_ERROR, ABSENT_PROCESS_TYPE,
  ABSENT_PROCESS_FIELDS,
} from '../src/win32-kernel-process-query-w60.mjs';

test('W60 Win32 native kernel readback uses fixed handle and 100ns FILETIME, no Get-Process provider', () => {
  const script=processScript(1337);
  assert.match(script, /^\$ErrorActionPreference = "Stop"/);
  assert.match(script, /\$requestedPid = 1337/);
  for(const x of ['OpenProcess(', 'GetProcessTimes(', 'QueryFullProcessImageName(', 'CloseHandle(', 'DateTime.FromFileTimeUtc', 'ToString("o"', 'W60_NATIVE_TYPES_READY']) {
    assert(script.includes(x),x);
  }
  assert.doesNotMatch(script, /Get-Process -Id|Get-CimInstance|Invoke-Expression|Start-Process/);
  assert.match(script, /if \(\$p.State -eq "NOT_RUNNING" -and \$p.Error -eq 87\)/);
  assert.equal(ABSENT_PROCESS_ERROR,'ERROR_INVALID_PARAMETER_87');
  assert.equal(ABSENT_PROCESS_TYPE,'kernel32.OpenProcess');
  assert.deepEqual(ABSENT_PROCESS_FIELDS,[
    'pid','state','native_error_id','native_error_category','native_error_type','native_target_pid',
  ]);
});

test('W60 forbids PID injection at the native source generator boundary', () => {
  for (const unsafe of ['1337', '1; Write-Output UNTRUSTED', 0, -1, 1.5, NaN, 2147483648, null]) {
    assert.throws(() => processScript(unsafe), /w60_fixed_positive_kernel_pid_required/);
  }
});

test('W60 kernel script embeds only an integer process selector', () => {
  const script=processScript(214);
  assert.match(script,/\$requestedPid = 214/);
  assert.doesNotMatch(script,/\$requestedPid = 1337/);
  assert.match(script,/return new Readback \{State="UNKNOWN"\}/);
  assert.match(script,/native_error_category = "ObjectNotFound"/);
  assert.match(script,/W60_PROCESS_FIELDS_READ/);
  assert.match(script,/W60_RESULT_WRITTEN/);
  assert(!script.includes('METAENGINE_API_KEY'));
});
