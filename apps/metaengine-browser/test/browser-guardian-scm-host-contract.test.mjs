import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../native/browser-guardian-scm/browser-guardian-scm-service.cpp');
const source = fs.readFileSync(sourcePath, 'utf8');

function expect(pattern, message) {
  assert.match(source, pattern, message);
}

function forbid(pattern, message) {
  assert.doesNotMatch(source, pattern, message);
}

test('SCM host uses the real Windows service dispatcher and status protocol', () => {
  expect(/StartServiceCtrlDispatcherW\s*\(/, 'SCM dispatcher handshake is required');
  expect(/RegisterServiceCtrlHandlerExW\s*\(/, 'SCM control handler registration is required');
  expect(/SetServiceStatus\s*\(/, 'SCM status readback is required');
  expect(/SERVICE_WIN32_OWN_PROCESS/, 'Guardian must be its own process failure domain');
  expect(/SERVICE_START_PENDING/, 'start-pending state must be explicit');
  expect(/SERVICE_RUNNING/, 'running state must be explicit');
  expect(/SERVICE_STOP_PENDING/, 'stop-pending state must be explicit');
  expect(/SERVICE_STOPPED/, 'stopped state must be explicit');
  expect(/SERVICE_ACCEPT_STOP\s*\|\s*SERVICE_ACCEPT_SHUTDOWN/, 'only bounded lifecycle controls are accepted');
  expect(/WaitForSingleObject\s*\(g_stop_event,\s*INFINITE\)/, 'service lifetime is fenced by the SCM stop event');
});

test('SCM host publishes a versioned read-only compatibility handshake', () => {
  expect(/\\\"schema\\\":\\\"metaengine\.browser-guardian\.scm-host\.v1\\\"/, 'SCM contract schema must be explicit');
  expect(/\\\"protocol_generation\\\":1/, 'SCM protocol generation must be explicit and monotonic');
  for (const feature of [
    'scm_service_dispatcher_v1',
    'scm_status_handshake_v1',
    'bounded_stop_shutdown_controls_v1',
    'read_only_contract_probe_v1',
  ]) {
    expect(new RegExp(`\\\\\\\"${feature}\\\\\\\":true`), `${feature} must be advertised only because it is implemented`);
  }
  expect(/\\\"second_scheduler_loop\\\":false/, 'SCM host must not advertise or introduce a second scheduler loop');
});

test('first SCM host slice has zero Browser/process/release effect authority', () => {
  for (const field of [
    'browser_authority',
    'task_authority',
    'scheduler_authority',
    'second_scheduler_loop',
    'page_model_text_authority',
    'release_authority',
    'process_effect_authority',
    'automatic_retry_allowed',
    'authority_effect',
  ]) {
    expect(new RegExp(`\\\\\"${field}\\\\\":false`), `${field} must remain false in the native contract`);
  }
  expect(/\\\"child_process_dispatch_implemented\\\":false/, 'Browser child dispatch is intentionally not implemented yet');
  expect(/\\\"service_installation_implemented\\\":false/, 'service installation is intentionally not implemented by the host');
});

test('SCM lifecycle host cannot secretly actuate Browser, shell, network or updater effects', () => {
  for (const [pattern, message] of [
    [/\bCreateProcess(?:A|W)?\s*\(/, 'must not spawn a child in this slice'],
    [/\bShellExecute(?:A|W)?\s*\(/, 'must not shell-execute'],
    [/\bWinExec\s*\(/, 'must not use WinExec'],
    [/\bTerminateProcess\s*\(/, 'must not terminate Browser processes'],
    [/\bCreateService(?:A|W)?\s*\(/, 'host must not install itself'],
    [/\bChangeServiceConfig(?:A|W)?\s*\(/, 'host must not alter SCM recovery policy'],
    [/\bWinHttp[A-Za-z0-9_]*\s*\(/, 'host must not open network transport'],
    [/\bURLDownloadToFile(?:A|W)?\s*\(/, 'host must not download releases'],
    [/\bsystem\s*\(/, 'host must not invoke a shell'],
    [/\bpopen\s*\(/, 'host must not open shell pipes'],
  ]) forbid(pattern, message);
});

test('console mode is read-only contract probing, not a fallback service loop', () => {
  expect(/--contract-json/, 'read-only contract probe is required');
  expect(/ERROR_FAILED_SERVICE_CONTROLLER_CONNECT/, 'non-SCM startup must fail closed');
  forbid(/while\s*\(\s*true\s*\)/, 'no hidden console watchdog loop is allowed');
  forbid(/setInterval|setTimeout/, 'native host must not introduce a second scheduler abstraction');
});
