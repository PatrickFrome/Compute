import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configurePath = path.resolve(here, '../native/browser-guardian-scm/browser-guardian-scm-configure.cpp');
const hostPath = path.resolve(here, '../native/browser-guardian-scm/browser-guardian-scm-service.cpp');
const source = fs.readFileSync(configurePath, 'utf8');
const host = fs.readFileSync(hostPath, 'utf8');

function expect(pattern, message) { assert.match(source, pattern, message); }
function forbid(pattern, message) { assert.doesNotMatch(source, pattern, message); }

test('SCM recovery mutation requires an explicit apply mode and exact service binary', () => {
  expect(/--contract-json/, 'read-only contract probe is required');
  expect(/--apply/, 'configuration mutation requires an explicit apply flag');
  expect(/--service-binary/, 'exact service binary input is required');
  expect(/GetFullPathNameW\s*\(/, 'service binary is normalized to an absolute path');
  expect(/GetFileAttributesW\s*\(/, 'service binary existence is checked');
  expect(/imagePathMatches\s*\(/, 'existing and readback binary paths are compared exactly');
});

test('LocalSystem service binary must live under resolved machine-owned Program Files Guardian root', () => {
  expect(/SHGetKnownFolderPath\s*\(FOLDERID_ProgramFiles/, 'Program Files must come from a typed known-folder API');
  expect(/GetFinalPathNameByHandleW\s*\(/, 'service path must be resolved through a filesystem handle');
  expect(/kGuardianRelativeRoot\[\]\s*=\s*L"METAENGINE\\\\Guardian"/, 'machine Guardian root must be explicit');
  expect(/kServiceBinaryName\[\]\s*=\s*L"METAENGINEBrowserGuardian\.exe"/, 'service basename must be exact');
  expect(/machineSecureServiceBinary\s*\(/, 'machine trust decision must be centralized');
  expect(/SERVICE_BINARY_MACHINE_TRUST_INVALID/, 'insecure path must fail before SCM mutation');
  expect(/machine_secure_service_path_required\\\":true/, 'read-only contract must advertise machine-only path requirement');
  expect(/user_writable_service_binary_forbidden\\\":true/, 'user-writable service binaries must be explicitly forbidden');
});

test('machine service binary and parent ACLs reject low-privilege write/delete/owner-control grants', () => {
  expect(/GetNamedSecurityInfoW\s*\(/, 'file and directory security descriptors need typed readback');
  expect(/OWNER_SECURITY_INFORMATION\s*\|\s*DACL_SECURITY_INFORMATION/, 'owner and DACL must both be inspected');
  expect(/WinLocalSystemSid/, 'SYSTEM owner must be recognized');
  expect(/WinBuiltinAdministratorsSid/, 'Administrators owner must be recognized');
  expect(/WinWorldSid/, 'Everyone grants must be inspected');
  expect(/WinBuiltinUsersSid/, 'BUILTIN Users grants must be inspected');
  expect(/WinAuthenticatedUserSid/, 'Authenticated Users grants must be inspected');
  for (const right of ['FILE_WRITE_DATA','FILE_APPEND_DATA','FILE_WRITE_EA','FILE_WRITE_ATTRIBUTES','DELETE','WRITE_DAC','WRITE_OWNER','GENERIC_WRITE','GENERIC_ALL']) {
    expect(new RegExp(`\\b${right}\\b`), `${right} must be part of the low-privilege write fence`);
  }
  expect(/aclForbidsLowPrivilegeWrite\(finalRoot\)/, 'machine root ACL must be checked');
  expect(/aclForbidsLowPrivilegeWrite\(finalParent\)/, 'service parent ACL must be checked');
  expect(/aclForbidsLowPrivilegeWrite\(finalBinary\)/, 'service binary ACL must be checked');
});

test('configurator installs or converges only the intended own-process LocalSystem service', () => {
  expect(/OpenSCManagerW\s*\(/, 'typed SCM connection is required');
  expect(/OpenServiceW\s*\(/, 'existing service must be inspected first');
  expect(/CreateServiceW\s*\(/, 'missing service may be explicitly created');
  expect(/SERVICE_WIN32_OWN_PROCESS/, 'service must own its failure domain');
  expect(/SERVICE_AUTO_START/, 'boot-time service start is required');
  expect(/localSystemAccount\s*\(/, 'existing service account must be fenced to LocalSystem');
  expect(/SERVICE_EXISTING_TYPE_DRIFT/, 'type drift must fail closed');
  expect(/SERVICE_EXISTING_ACCOUNT_DRIFT/, 'account drift must fail closed');
  expect(/SERVICE_EXISTING_BINARY_DRIFT/, 'binary path drift must fail closed');
});

test('recovery policy is restart-only, non-resetting, and independently read back', () => {
  expect(/SC_ACTION_RESTART/, 'recovery actions must restart the Guardian service');
  expect(/kRestartDelaysMs\[\]\s*=\s*\{5'000,\s*15'000,\s*60'000\}/, 'bounded restart backoff sequence is fixed');
  expect(/dwResetPeriod\s*=\s*INFINITE/, 'failure counter must not reset while service remains configured');
  expect(/SERVICE_CONFIG_FAILURE_ACTIONS/, 'failure actions must be configured');
  expect(/SERVICE_CONFIG_FAILURE_ACTIONS_FLAG/, 'non-crash service failure handling must be explicit');
  expect(/fFailureActionsOnNonCrashFailures\s*=\s*TRUE/, 'non-crash failure actions must be enabled');
  expect(/QueryServiceConfigW\s*\(/, 'base service config needs exact readback');
  expect(/QueryServiceConfig2W\s*\(/, 'failure policy needs exact readback');
  expect(/SERVICE_RESTART_SEQUENCE_READBACK_MISMATCH/, 'restart action drift must fail closed');
  expect(/SERVICE_FORBIDDEN_FAILURE_ACTION_READBACK/, 'forbidden recovery actions must fail readback');
  expect(/last_failure_action_repeats/, 'result documents native repeated-last-action semantics');
});

test('configurator cannot turn SCM configuration into Browser or command execution authority', () => {
  for (const [pattern, message] of [
    [/\bStartService(?:A|W)?\s*\(/, 'configurator must not start the service'],
    [/\bControlService\s*\(/, 'configurator must not stop or control the service'],
    [/\bCreateProcess(?:A|W)?\s*\(/, 'configurator must not start Browser or broker processes'],
    [/\bCreateProcessAsUser(?:A|W)?\s*\(/, 'configurator must not cross into user-session spawning'],
    [/\bTerminateProcess\s*\(/, 'configurator must not kill processes'],
    [/\bShellExecute(?:A|W)?\s*\(/, 'configurator must not shell-execute'],
    [/\bWinExec\s*\(/, 'configurator must not use WinExec'],
    [/\bsystem\s*\(/, 'configurator must not execute shell commands'],
    [/\bpopen\s*\(/, 'configurator must not open command pipes'],
    [/\bSC_ACTION_REBOOT\b/, 'service recovery must never reboot the machine'],
    [/\bSC_ACTION_RUN_COMMAND\b/, 'service recovery must never run arbitrary commands'],
    [/\bWinHttp[A-Za-z0-9_]*\s*\(/, 'configurator must not use network transport'],
  ]) forbid(pattern, message);

  for (const field of ['browser_authority','task_authority','scheduler_authority','page_model_text_authority','release_authority','automatic_retry_allowed']) {
    expect(new RegExp(`\\\\\"${field}\\\\\":false`), `${field} must remain false in the read-only contract`);
  }
});

test('service host remains unable to install or rewrite its own SCM policy', () => {
  assert.match(host, /\\\"service_installation_implemented\\\":false/);
  assert.doesNotMatch(host, /\bCreateService(?:A|W)?\s*\(/);
  assert.doesNotMatch(host, /\bChangeServiceConfig(?:2)?(?:A|W)?\s*\(/);
});
