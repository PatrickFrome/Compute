import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {ownerSessionSoakFailureCode} from '../scripts/qualify-installed-owner-consumer.mjs';

test('fixed PowerShell error categories survive without raw command or suffix data', () => {
  for (const [reason, expected] of [
    ['activation_p95_budget_exceeded:1250.43', 'activation_p95_budget_exceeded'],
    ['me2_runtime_not_settled:PRIVATE_PROFILE_AND_CREDENTIAL', 'me2_runtime_not_settled'],
    ['secondary_timeout:17', 'secondary_timeout'],
    ['profile_probe_exit_23', 'profile_probe_exit'],
    ['shutdown_primary_timeout', 'shutdown_primary_timeout'],
  ]) {
    const result = ownerSessionSoakFailureCode({code:1,cmd:'PRIVATE_COMMAND',
      stderr:`private diagnostic\r\n    + FullyQualifiedErrorId : soak_${reason}\r\n`});
    assert.equal(result, 'session_soak_' + expected);
    assert.ok(('installed_owner_consumer_' + result).length <= 125);
    assert.doesNotMatch(result, /PRIVATE|1250|17|23/);
  }
});

test('missing, unrecognized, ambiguous and oversized stderr stays unclassified', () => {
  const fallback = 'session_soak_physical_failed';
  for (const error of [null, {}, {stderr:Buffer.from('private')},
    {stderr:'soak_activation_p95_budget_exceeded:4'},
    {message:'FullyQualifiedErrorId : soak_activation_count_invalid'},
    {stderr:'FullyQualifiedErrorId : soak_private_unknown_value'},
    {stderr:'FullyQualifiedErrorId : soak_secondary_timeout\nFullyQualifiedErrorId : soak_shutdown_signal_timeout'},
    {stderr:'FullyQualifiedErrorId : soak_secondary_timeout\nFullyQualifiedErrorId : soak_unknown'},
    {stderr:' '.repeat(1024*1024+1)+'FullyQualifiedErrorId : soak_secondary_timeout'},
  ]) assert.equal(ownerSessionSoakFailureCode(error), fallback);
  assert.equal(ownerSessionSoakFailureCode({stderr:'FullyQualifiedErrorId : soak_secondary_timeout\r\nFullyQualifiedErrorId : soak_secondary_timeout'}), 'session_soak_secondary_timeout');
});

test('process failures are not confused with inner soak assertions', () => {
  assert.equal(ownerSessionSoakFailureCode({code:'ETIMEDOUT'}), 'session_soak_process_timeout');
  assert.equal(ownerSessionSoakFailureCode({code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',killed:true}), 'session_soak_output_limit');
  assert.equal(ownerSessionSoakFailureCode({killed:true}), 'session_soak_process_terminated');
});

test('every literal soak failure remains classified and preserves the outer failure boundary', async () => {
  const source = await fs.readFile(new URL('../scripts/windows-autonomous-session-soak.ps1', import.meta.url), 'utf8');
  for (const match of source.matchAll(/throw ['"]soak_([a-z0-9_]+)/g)) {
    const name = match[1].replace(/_$/, '');
    assert.notEqual(ownerSessionSoakFailureCode({stderr:`FullyQualifiedErrorId : soak_${name}`}),
      'session_soak_physical_failed', name);
  }
  const parent = await fs.readFile(new URL('../../../infra/client-state-runtime/attached-bundled-runtime.integration.test.mjs', import.meta.url), 'utf8');
  assert.match(parent, /assert\.deepEqual\(consumerClosed, \{ code: 0, signal: null \}\)/);
});
