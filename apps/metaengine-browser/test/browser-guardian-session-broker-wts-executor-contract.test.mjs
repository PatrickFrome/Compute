import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../native/browser-guardian-scm/browser-guardian-session-broker-wts-executor.cpp');
const headerPath = path.resolve(here, '../native/browser-guardian-scm/browser-guardian-session-broker-wts-executor.hpp');
const source = fs.readFileSync(sourcePath, 'utf8');
const header = fs.readFileSync(headerPath, 'utf8');

function expect(pattern, message, text = source) {
  assert.match(text, pattern, message);
}

function forbid(pattern, message, text = source) {
  assert.doesNotMatch(text, pattern, message);
}

function position(pattern, message) {
  const match = source.match(pattern);
  assert.ok(match?.index >= 0, message);
  return match.index;
}

test('executor is a journal-gated module owned by Guardian rather than a second long-running launcher', () => {
  expect(/metaengine\.browser-guardian\.session-broker-wts-executor\.v1/, 'typed executor contract is required');
  expect(/protocol_generation\\\":2/, 'Guardian-owned lease protocol generation is required');
  expect(/guardian_owned_broker_lease_v1\\\":true/, 'Guardian-owned Broker lease feature is required');
  expect(/requires_journal_gated_call\\\":true/, 'native effect boundary must declare durable journal gating');
  expect(/broker_may_own_job_handle\\\":false/, 'Broker must never own its supervision Job handle');
  expect(/guardian_owns_last_job_handle\\\":true/, 'Guardian must own the last Job Object handle');
  expect(/single_dispatch_per_call\\\":true/, 'one call may dispatch at most once');
  expect(/restart_supported\\\":false/, 'raw restart is not implemented in this boundary');
  expect(/automatic_retry_allowed\\\":false/, 'native effect retries are forbidden');
  expect(/second_scheduler_loop\\\":false/, 'executor must not add a scheduler loop');
  forbid(/\bwmain\s*\(/, 'executor must be linked into Guardian, not run as a second supervisor process');
  forbid(/\bDuplicateHandle\s*\(/, 'Job Object custody must never be duplicated into Broker or another process');
});

test('BrokerLease is move-only and retains both exact process and Job handles in Guardian', () => {
  expect(/class\s+BrokerLease/, 'move-only BrokerLease type is required', header);
  expect(/Guardian, not the Broker, owns this lease/, 'header must state the supervision ownership contract', header);
  expect(/BrokerLease\(const\s+BrokerLease&\)\s*=\s*delete/, 'BrokerLease copy construction must be forbidden', header);
  expect(/operator=\(const\s+BrokerLease&\)\s*=\s*delete/, 'BrokerLease copy assignment must be forbidden', header);
  expect(/HANDLE\s+process_\s*=\s*nullptr/, 'Guardian lease must retain exact process handle', header);
  expect(/HANDLE\s+job_\s*=\s*nullptr/, 'Guardian lease must retain Job Object handle', header);
  expect(/lease_out->process_\s*=\s*process\.release\(\)/, 'exact process handle custody must transfer to Guardian lease');
  expect(/lease_out->job_\s*=\s*job\.release\(\)/, 'Job Object handle custody must transfer to Guardian lease');
});

test('caller is LocalSystem and exact WTS session/owner token are proven without fallback selection', () => {
  expect(/S-1-5-18/, 'LocalSystem SID must be explicit');
  expect(/OpenProcessToken\s*\(GetCurrentProcess\(\),\s*TOKEN_QUERY/, 'caller token must be verified');
  expect(/WTSQueryUserToken\s*\(request\.session_id/, 'exact selected session token is required');
  expect(/GetTokenInformation\s*\([^;]+TokenUser/s, 'token owner SID must be read');
  expect(/ConvertSidToStringSidW\s*\(/, 'SID proof must use typed SID conversion');
  expect(/GetTokenInformation\s*\([^;]+TokenSessionId/s, 'token session id must be read');
  forbid(/\bWTSGetActiveConsoleSessionId\s*\(/, 'console-session fallback is forbidden');
  forbid(/\bWTSEnumerateSessions(?:A|W)?\s*\(/, 'executor cannot choose a session by enumeration');
});

test('physical spawn is suspended, exactly rebound, Job-fenced, then resumed once', () => {
  const create = position(/\bCreateProcessAsUserW\s*\(/, 'CreateProcessAsUserW is required');
  const creationTime = position(/\bGetProcessTimes\s*\(/, 'creation-time incarnation readback is required');
  const session = position(/\bProcessIdToSessionId\s*\(/, 'exact spawned session readback is required');
  const childToken = position(/\bOpenProcessToken\s*\(process\.get\(\),\s*TOKEN_QUERY/, 'spawned child token must be re-read');
  const assign = position(/\bAssignProcessToJobObject\s*\(/, 'Job Object assignment is required');
  const membership = position(/\bIsProcessInJob\s*\(/, 'Job membership readback is required');
  const jobReadback = position(/\bQueryInformationJobObject\s*\(/, 'Job limits need exact readback');
  const resume = position(/\bResumeThread\s*\(/, 'Broker may resume only after all fences are established');
  assert.ok(create < creationTime && creationTime < session && session < childToken
    && childToken < assign && assign < membership && membership < jobReadback && jobReadback < resume,
    'required order is suspended spawn -> exact incarnation/session/SID -> Job bind/readback -> resume');

  assert.equal((source.match(/\bCreateProcessAsUserW\s*\(/g) || []).length, 1, 'there must be exactly one physical spawn call site');
  assert.equal((source.match(/\bResumeThread\s*\(/g) || []).length, 1, 'there must be exactly one resume call site');
  expect(/CREATE_SUSPENDED\s*\|\s*CREATE_UNICODE_ENVIRONMENT/, 'spawn must be suspended with Unicode user environment');
  expect(/winsta0\\\\default/, 'interactive Browser Broker desktop must be explicit');
  expect(/CreateEnvironmentBlock\s*\(/, 'user environment must be constructed from exact user token');
  expect(/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/, 'Job Object must be kill-on-close');
  expect(/SetInformationJobObject\s*\(/, 'Job kill-on-close limit must be configured');
});

test('PID alone is never accepted as Broker identity', () => {
  expect(/GetProcessTimes\s*\(/, 'creation time is required for process incarnation');
  expect(/created_100ns/, 'process incarnation must include creation-time identity');
  expect(/ProcessIdToSessionId\s*\(/, 'spawned PID must still belong to exact session');
  expect(/OpenProcessToken\s*\(process\.get\(\),\s*TOKEN_QUERY/, 'spawned process owner token must be re-read');
  expect(/process_incarnation_id/, 'dispatch result must expose non-PID incarnation identity', header);
});

test('pre-resume failures clean only the exact suspended child and never retry', () => {
  expect(/bool\s+terminateNeverResumed\s*\(HANDLE\s+process\)/, 'exact suspended-child cleanup helper is required');
  assert.equal((source.match(/\bTerminateProcess\s*\(/g) || []).length, 1, 'TerminateProcess may exist only in exact pre-resume cleanup');
  expect(/child_never_resumed/, 'cleaned suspended child must be explicitly represented', header);
  forbid(/for\s*\([^)]*CreateProcessAsUser/, 'spawn retries are forbidden');
  forbid(/while\s*\([^)]*CreateProcessAsUser/, 'spawn retries are forbidden');
});

test('executor cannot smuggle Browser, shell, service, network, or scheduler authority', () => {
  for (const [pattern, message] of [
    [/\bCreateProcessW\s*\(/, 'generic process launch is forbidden'],
    [/\bCreateProcessA\s*\(/, 'generic ANSI process launch is forbidden'],
    [/\bShellExecute(?:A|W)?\s*\(/, 'shell execution is forbidden'],
    [/\bWinExec\s*\(/, 'WinExec is forbidden'],
    [/\bsystem\s*\(/, 'shell command execution is forbidden'],
    [/\bpopen\s*\(/, 'command pipes are forbidden'],
    [/\bStartService(?:A|W)?\s*\(/, 'service lifecycle authority is forbidden'],
    [/\bControlService\s*\(/, 'service stop/control authority is forbidden'],
    [/\bWinHttp[A-Za-z0-9_]*\s*\(/, 'network transport is forbidden'],
  ]) forbid(pattern, message);

  for (const field of ['browser_authority', 'task_authority', 'scheduler_authority', 'page_model_text_authority', 'release_authority', 'network_authority', 'shell_command_authority']) {
    expect(new RegExp(`${field}\\\\\":false`), `${field} must remain false`);
  }
});
