import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cpp = fs.readFileSync(path.join(root, 'native/browser-guardian-scm/browser-guardian-owner-enrollment-observer.cpp'), 'utf8');
const header = fs.readFileSync(path.join(root, 'native/browser-guardian-scm/browser-guardian-owner-enrollment-observer.hpp'), 'utf8');
const source = `${header}\n${cpp}`;

test('native owner observer uses fail-closed local pipe and OS-token identity primitives', () => {
  for (const token of [
    'CreateNamedPipeW',
    'FILE_FLAG_FIRST_PIPE_INSTANCE',
    'FILE_FLAG_OVERLAPPED',
    'PIPE_REJECT_REMOTE_CLIENTS',
    'ConvertStringSecurityDescriptorToSecurityDescriptorW',
    'GetNamedPipeClientProcessId',
    'ImpersonateNamedPipeClient',
    'OpenThreadToken',
    'TokenUser',
    'TokenSessionId',
    'RevertToSelf',
  ]) assert.match(source, new RegExp(token), `${token} missing`);

  assert.doesNotMatch(source, /WTSQueryUserToken|CreateProcessAsUserW|CreateProcessWithTokenW|ShellExecute|StartServiceW/);
  assert.doesNotMatch(source, /SetTimer|CreateTimerQueueTimer|std::this_thread::sleep_for/);
});

test('client access mask omits pipe-instance creation and generic write', () => {
  const match = cpp.match(/constexpr DWORD kClientAccessMask =([\s\S]*?);/);
  assert.ok(match, 'client access mask missing');
  const mask = match[1];
  assert.match(mask, /FILE_READ_DATA/);
  assert.match(mask, /FILE_WRITE_DATA/);
  assert.match(mask, /FILE_READ_ATTRIBUTES/);
  assert.match(mask, /FILE_WRITE_ATTRIBUTES/);
  assert.match(mask, /SYNCHRONIZE/);
  assert.doesNotMatch(mask, /FILE_APPEND_DATA|FILE_CREATE_PIPE_INSTANCE|GENERIC_WRITE|FILE_GENERIC_WRITE/);
});

test('native contract advertises evidence-only boundary', () => {
  assert.match(cpp, /"durable_enrollment_implemented\\":false/);
  assert.match(cpp, /"device_challenge_verification_implemented\\":false/);
  assert.match(cpp, /"wts_execution_allowed\\":false/);
  assert.match(cpp, /"process_effect_allowed\\":false/);
  assert.match(cpp, /"scm_effect_allowed\\":false/);
  assert.match(cpp, /"automatic_retry_allowed\\":false/);
  assert.match(cpp, /"second_scheduler_loop\\":false/);
  assert.match(cpp, /"authority_effect\\":false/);
});
