import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyMe2UiBundle } from '../../metaengine-browser/scripts/verify-me2-ui-bundle.mjs';
import { inventoryUiRuntime, verifyUiRuntime } from './ui-runtime-inventory.mjs';

// Source-only acceptance. The Next server and Chromium are real processes; the
// typed renderer bridge below is an inert fixture, never an Owner/PG receipt.
// Run under an external network namespace/tracer for OS-wide network evidence.
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function digestFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};
function outputDirectory(input, root) {
  const requested = path.resolve(input);
  let ancestor = requested;
  const missing = [];
  while (!existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  const physical = path.join(realpathSync(ancestor), ...missing);
  assert.ok(!inside(root, physical), 'acceptance_evidence_must_be_outside_bundle');
  mkdirSync(physical, { recursive: true });
  return realpathSync(physical);
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function waitForServer(child, origin, spawnFailure) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnFailure()) throw spawnFailure();
    assert.ok(child.exitCode === null && child.signalCode === null, 'acceptance_server_exited_before_ready');
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      const body = await response.text();
      if (response.ok && /<html/i.test(body)) return;
    } catch { /* Startup may not have bound its loopback listener yet. */ }
    await delay(100);
  }
  throw new Error('acceptance_server_start_deadline');
}
export async function stopOwnedChild(child, closed) {
  const result = { pid: child.pid ?? null, running_before_shutdown: child.exitCode === null && child.signalCode === null,
    sigterm_sent: false, forced_shutdown: false };
  if (result.running_before_shutdown) {
    result.sigterm_sent = child.kill('SIGTERM');
  }
  let timer;
  const exited = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
  clearTimeout(timer);
  if (!exited) {
    result.forced_shutdown = true;
    child.kill('SIGKILL'); // Only this harness's exact child, never a name/group.
    await Promise.race([closed, delay(3000).then(() => { throw new Error('acceptance_owned_child_exit_deadline'); })]);
  }
  const observation = { ...result, exit_code: child.exitCode, signal: child.signalCode };
  // A clean pre-existing exit is still an unexpected server disappearance.
  // Only our own requested shutdown may qualify; cleanup is never acceptance.
  const acceptedExit = observation.signal === null && [0, 143].includes(observation.exit_code)
    || observation.exit_code === null && observation.signal === 'SIGTERM';
  const failure = !observation.running_before_shutdown ? 'acceptance_server_exited_before_shutdown'
    : observation.forced_shutdown ? 'acceptance_server_required_forced_shutdown'
      : !observation.sigterm_sent ? 'acceptance_server_shutdown_not_requested'
        : !acceptedExit ? 'acceptance_server_shutdown_exit_unexpected' : null;
  if (failure) {
    const error = new Error(failure);
    error.shutdown = observation;
    throw error;
  }
  return observation;
}
async function httpMatrix(origin) {
  const get = async (route, init = {}) => {
    const response = await fetch(`${origin}${route}`, { ...init, signal: AbortSignal.timeout(8000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { route, status: response.status, content_type: response.headers.get('content-type'),
      size_bytes: bytes.length, sha256: sha256(bytes), bytes };
  };
  const html = await get('/');
  assert.equal(html.status, 200);
  assert.match(html.content_type || '', /text\/html/i);
  const assetPath = html.bytes.toString().match(/(?:src|href)="(\/_next\/static\/[^"?]+\.js)(?:\?[^" ]*)?"/)?.[1];
  assert.ok(assetPath, 'acceptance_static_script_missing');
  const asset = await get(assetPath);
  assert.equal(asset.status, 200);
  assert.ok(asset.size_bytes > 0);
  const rsc = await get('/?_rsc=source-acceptance', { headers: { RSC: '1' } });
  assert.equal(rsc.status, 200);
  assert.match(rsc.content_type || '', /text\/x-component/i);
  const missing = await get('/__me2_source_acceptance_missing__');
  assert.equal(missing.status, 404);
  return [html, asset, rsc, missing].map(({ bytes: _bytes, ...observation }) => observation);
}

// Runs before page scripts. Its observations are visibly synthetic contract
// inputs; no HTTP request, database, native Host or external effect is made.
function installFixture({ kind }) {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const TASK = '11111111-1111-4111-8111-111111111111';
  const PROJECT = '11111111-2222-4333-8444-555555555555';
  const flags = { automatic_retry_allowed: false, authority_effect: false };
  const nativeReceipt = { schema: 'metaengine.native-coding.goal-admission.v1', state: 'ADMITTED',
    request_id: A, objective: 'Synthetic renderer contract observation', root_task_id: TASK, project_id: PROJECT,
    physical_execution_proven: false, production_qualified: false, ...flags };
  const browserReceipt = { schema: 'metaengine.client.goal-submission.v1', request_id: A,
    task_id: TASK, exact_activation_readback: true, ...flags };
  const progress = { schema: 'metaengine.client.goal-progress.v1', request_id: A, task_id: TASK,
    found: true, task_state: 'COMPLETED', terminal: true, reconciliation_required: false, ...flags };
  const proof = { schema: 'metaengine.client.goal-execution-proof.v1', request_id: A, task_id: TASK,
    task_state: 'COMPLETED', found: true, user_goal_to_agent_readback: true, user_goal_to_result_readback: true,
    result_proof: { available: true, claim_valid: true, origin_bound: true, accepted: false }, ...flags };
  const state = { fixture_only: true, kind, connected: true, failLatest: false, submissions: [], statusRequests: [],
    latest: { schema: 'metaengine.client.goal-journal-entry.v1', request_id: A, kind,
      goal: 'Synthetic renderer contract observation', state: kind === 'BROWSER' ? 'COMPLETED' : 'ADMITTED',
      receipt: kind === 'BROWSER' ? browserReceipt : nativeReceipt, progress: kind === 'BROWSER' ? progress : null,
      execution_proof: kind === 'BROWSER' ? proof : null, last_error: null, ...flags } };
  window.__me2SourceAcceptance = state;
  window.metaengineShell = {
    setPrimaryPage: async () => ({}), setPrimaryOverlay: async () => ({}),
    primaryChatFleetRoster: async () => ({ schema: 'metaengine.browser.primary-chat-fleet-roster.v1',
      actors: [], actor_count: 0, supervisor_count: 0, agent_count: 0, selected_actor_id: null }),
  };
  window.metaengineClient = {
    typed_positive_api: true, generic_command_exposed: false,
    connectionStatus: async () => {
      if (!state.connected) throw new Error('simulated_native_bridge_disconnected');
      return { schema: 'metaengine.client.connection-status.v1', local_runtime_ready: true,
        admin_ready: true, cloud_control_state: 'CONNECTED', authority_effect: false };
    },
    workReadiness: async () => {
      if (!state.connected) throw new Error('simulated_native_bridge_disconnected');
      return { schema: 'metaengine.client.work-readiness.v1', observed_at: new Date().toISOString(),
        state: 'READY', reason: null, label: 'Chats ready', detail: 'Synthetic renderer readiness input; no Owner proof.',
        execution_ready: true, readiness_scope: 'CHAT_DISPATCH', heartbeat_fresh: true,
        generation_floor: 1, local_generation_floor: 1, proven_agent_count: 1, active_agent_count: 1,
        bound_unverified_agent_count: 0, ambiguous_agent_count: 0, supervisor_state: 'WAITING', supervisor_cycle_seq: 1,
        capabilities: { chat_dispatch: { ready: true, reason: null },
          coding_execution: { ready: false, reason: 'FIXTURE_NOT_EXECUTION' },
          host_continuity: { ready: false, reason: 'FIXTURE_NOT_CONTINUITY' },
          continuous_autonomy: { ready: false, reason: 'FIXTURE_NOT_AUTONOMY' } },
        continuous_autonomy_ready: false, useful_work_verified: false, verified_self_improvement: false,
        recovery_effect_exposed: false, scheduler_authority: false, ...flags };
    },
    goalSubmissionMode: async () => ({ schema: 'metaengine.client.goal-submission-mode.v1', kind: state.kind,
      state: 'HOST_VERIFICATION_REQUIRED', reason: null, ...flags }),
    latestGoal: async () => {
      if (state.failLatest) throw new Error('simulated_latest_read_failure');
      return structuredClone(state.latest);
    },
    goalStatus: async requestId => {
      state.statusRequests.push(requestId);
      return state.latest.progress ?? { schema: 'metaengine.client.native-coding-goal-progress.v1',
        request_id: state.latest.request_id, found: false, terminal: true, reconciliation_required: false, ...flags };
    },
    submitGoal: async goal => {
      state.submissions.push(goal);
      state.latest = { schema: 'metaengine.client.goal-journal-entry.v1', request_id: B, kind: 'NATIVE_CODING',
        goal, state: 'FAILED', receipt: null, progress: null, execution_proof: null,
        last_error: 'native_goal_rejected_before_dispatch', ...flags };
      throw new Error('native_goal_rejected_before_dispatch');
    },
  };
}

async function textContains(page, selector, expected) {
  await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent?.includes(expected),
    { selector, expected }, { timeout: 10_000 });
}
async function attributeEquals(page, selector, attribute, expected) {
  await page.waitForFunction(({ selector, attribute, expected }) => document.querySelector(selector)?.getAttribute(attribute) === expected,
    { selector, attribute, expected }, { timeout: 10_000 });
}
async function browserMatrix(browser, origin, evidenceDir, report) {
  const contexts = [];
  const external = report.browser_external_requests = [];
  const pageErrors = report.browser_page_errors = [];
  async function pageFor(kind) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    contexts.push(context);
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (new URL(url).origin !== origin) {
        external.push({ method: route.request().method(), url });
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    if (typeof context.routeWebSocket === 'function') {
      await context.routeWebSocket('**/*', socket => {
        const url = new URL(socket.url());
        if (url.host !== new URL(origin).host || !['ws:', 'wss:'].includes(url.protocol)) {
          external.push({ method: 'WEBSOCKET', url: socket.url() });
          socket.close();
        } else socket.connectToServer();
      });
    }
    if (kind) await context.addInitScript(installFixture, { kind });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => pageErrors.push({ scenario: kind || 'NO_BRIDGE', message: error.message }));
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByTestId('me2-shell').waitFor({ state: 'visible' });
    return page;
  }
  const results = report.renderer_scenarios = [];
  const passed = (name, evidence) => results.push({ name, status: 'PASS', evidence, actual_owner: false });
  try {
    const absent = await pageFor(null);
    await textContains(absent, '[data-testid="admin-connection-badge"]', 'Status unavailable');
    await textContains(absent, '[data-testid="chat-fleet-rail"]', 'Roster unavailable');
    await textContains(absent, '[data-testid="client-native-goal-mode"]', 'Admission status unavailable');
    assert.equal(await absent.evaluate(() => typeof window.metaengineClient), 'undefined');
    await absent.screenshot({ path: path.join(evidenceDir, 'renderer-no-bridge.png') });
    passed('no_native_bridge_is_unavailable', 'Real shell renders unavailable connection, roster and admission.');
    await absent.context().close();

    const result = await pageFor('BROWSER');
    await attributeEquals(result, '[data-testid="admin-connection-badge"]', 'data-work-state', 'READY');
    await textContains(result, '[data-testid="client-goal-readback"]', 'Result received');
    await result.getByTestId('client-goal-details').click();
    await textContains(result, '[data-testid="client-goal-execution-proof"]', 'Received · review pending');
    const resultDialog = result.getByTestId('client-goal-status-dialog');
    assert.match(await resultDialog.innerText(), /independent verification before acceptance/);
    await result.screenshot({ path: path.join(evidenceDir, 'renderer-result-review-pending.png') });
    passed('simulated_result_remains_review_pending', 'Rendered result flag does not become independent acceptance.');
    await resultDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await result.evaluate(() => { window.__me2SourceAcceptance.connected = false; });
    await attributeEquals(result, '[data-testid="admin-connection-badge"]', 'data-work-state', 'UNAVAILABLE');
    await textContains(result, '[data-testid="admin-connection-badge"]', 'Status unavailable');
    passed('simulated_disconnect_clears_ready_badge', 'Native runtime polling clears the previously READY presentation.');
    assert.equal(await result.evaluate(() => window.__me2SourceAcceptance.submissions.length), 0);
    await result.context().close();

    const native = await pageFor('NATIVE_CODING');
    await textContains(native, '[data-testid="client-goal-readback"]', 'Native goal admitted');
    await native.getByTestId('client-goal-details').click();
    await textContains(native, '[data-testid="client-native-goal-project"]', '11111111-2222-4333-8444-555555555555');
    await native.getByTestId('client-goal-status-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await native.getByTestId('client-goal-input').fill('Reject this isolated follow-up');
    await native.getByTestId('client-goal-submit').click();
    await textContains(native, '[data-testid="client-goal-readback"]', 'Not started · admission rejected');
    await native.getByTestId('client-goal-details').click();
    await textContains(native, '[data-testid="client-native-goal-project"]', 'Awaiting admission');
    const dialog = native.getByTestId('client-goal-status-dialog');
    let rendered = await dialog.innerText();
    assert.ok(rendered.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    for (const oldId of ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', '11111111-2222-4333-8444-555555555555']) {
      assert.ok(!rendered.includes(oldId), 'acceptance_rejected_goal_inherited_previous_id');
    }
    passed('user_run_rejected_goal_clears_previous_receipt', 'A real click executes the shipped callback; fixture B inherits no task/project/request from A.');
    await native.evaluate(() => { window.__me2SourceAcceptance.failLatest = true; });
    const beforeRefresh = await native.evaluate(() => window.__me2SourceAcceptance.statusRequests.length);
    await native.getByTestId('client-goal-refresh').click();
    await textContains(native, '[data-testid="client-goal-status-dialog"] [role="alert"]', 'Task status unavailable. Previously read details may be stale.');
    const state = await native.evaluate(() => ({
      submissions: window.__me2SourceAcceptance.submissions,
      statusRequests: window.__me2SourceAcceptance.statusRequests,
    }));
    assert.deepEqual(state.submissions, ['Reject this isolated follow-up']);
    assert.ok(state.statusRequests.length > beforeRefresh);
    assert.ok(state.statusRequests.slice(beforeRefresh).every(id => id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    rendered = await dialog.innerText();
    assert.ok(!rendered.includes('11111111-2222-4333-8444-555555555555'));
    await native.screenshot({ path: path.join(evidenceDir, 'renderer-journal-read-failure.png') });
    passed('failed_read_visible_refresh_correlated_no_resend', { new_request_refreshes: state.statusRequests.slice(beforeRefresh), submit_count: state.submissions.length });
    assert.deepEqual(external, [], 'acceptance_browser_external_request_attempted');
    assert.deepEqual(pageErrors, [], 'acceptance_browser_page_error');
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
  }
}

export async function runSourceAcceptance(options) {
  assert.match(options['expected-sha'] || '', /^[0-9a-f]{40}$/, 'acceptance_expected_sha_required');
  for (const name of ['root', 'evidence-dir', 'chromium', 'playwright-module']) assert.ok(options[name], `acceptance_${name}_required`);
  const root = realpathSync(options.root);
  const evidenceDir = outputDirectory(options['evidence-dir'], root);
  const chromiumPath = realpathSync(options.chromium);
  const playwrightPath = realpathSync(options['playwright-module']);
  const report = { schema: 'metaengine.ui.source-acceptance.v1', status: 'RUNNING', expected_source_sha: options['expected-sha'],
    harness_sha256: await digestFile(fileURLToPath(import.meta.url)),
    started_at: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    proof_level: 'SOURCE_STANDALONE_AND_SIMULATED_RENDERER_CONTRACT',
    installed_owner: false, installer: false, fixture_bridge: true, embedded_node_binary: false,
    os_network_isolation_verified_by_harness: false, transient_filesystem_writes_ruled_out: false,
    note: 'Full inventories are sampled observations. External namespace/syscall evidence and central installer qualification are separate.',
    runtime: { executable: realpathSync(process.execPath), version: process.version, sha256: await digestFile(process.execPath) },
    browser: { executable: chromiumPath, sha256: await digestFile(chromiumPath) },
    playwright: { module: playwrightPath, sha256: await digestFile(playwrightPath) }, snapshots: {} };
  const save = (name, value) => {
    const file = path.join(evidenceDir, name);
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return { file: name, sha256: sha256(readFileSync(file)) };
  };
  let child, childClosed, browser, before, manifestBytes;
  let output = '', spawnError;
  const errors = [];
  const captureInventory = phase => {
    const observed = inventoryUiRuntime(root);
    report.snapshots[phase] = { ...save(`inventory-${phase}.json`, observed), tree_sha256: observed.tree_sha256,
      entry_count: observed.entries.length, size_bytes: observed.size_bytes };
    if (before) {
      assert.deepEqual(readFileSync(path.join(root, 'me2-ui-manifest.json')), manifestBytes, 'acceptance_original_manifest_changed');
      verifyUiRuntime(root, before);
    }
    return observed;
  };
  try {
    const bundle = verifyMe2UiBundle(root, options['expected-sha']);
    report.bundle = { git_sha: bundle.git_sha, build_id: bundle.build_id, manifest_sha256: bundle.manifest_sha256,
      content_sha256: bundle.content_sha256, content_file_count: bundle.content_file_count };
    manifestBytes = readFileSync(path.join(root, 'me2-ui-manifest.json'));
    assert.equal(sha256(manifestBytes), bundle.manifest_sha256, 'acceptance_manifest_changed_before_launch');
    before = captureInventory('before');
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    // An allowlist prevents ambient override/audit variables from changing the
    // controlled source probe. The installed embedded binary is not exercised.
    const env = { PATH: process.env.PATH || '', NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '1',
      HOSTNAME: '127.0.0.1', PORT: String(port), NODE_PATH: '', NODE_OPTIONS: '',
      METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES', ME2_HOSTED_BY_BROWSER: '1', ME2_WATCHDOG: 'off', NEXT_TELEMETRY_DISABLED: '1' };
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[name]) env[name] = process.env[name];
    child = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    child.on('error', error => { spawnError = error; });
    childClosed = new Promise(resolve => child.once('close', resolve));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes.toString()).slice(-200_000); });
    report.server = { owned_pid: child.pid ?? null, host: '127.0.0.1', port, watchdog: 'off', hosted_by_browser: true, explicit_runtime_override: false };
    await waitForServer(child, origin, () => spawnError);
    report.http_matrix = await httpMatrix(origin);
    const { chromium } = await import(pathToFileURL(playwrightPath).href);
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true, timeout: 20_000,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--no-first-run'] });
    report.browser.version = browser.version();
    await browserMatrix(browser, origin, evidenceDir, report);
    assert.ok(child.exitCode === null && child.signalCode === null, 'acceptance_server_exited_during_probe');
    captureInventory('running');
  } catch (error) {
    errors.push(String(error.message || error));
  } finally {
    if (browser) {
      try { await browser.close(); } catch (error) { errors.push(`browser_close:${error.message}`); }
    }
    if (child) {
      try {
        report.shutdown = await stopOwnedChild(child, childClosed);
      } catch (error) {
        if (error.shutdown) report.shutdown = error.shutdown;
        errors.push(`server_shutdown:${error.message}`);
      }
    }
    if (before) {
      try {
        captureInventory('after');
        verifyMe2UiBundle(root, options['expected-sha']);
        report.post_exit_inventory_verified = true;
      } catch (error) { errors.push(`post_exit_inventory:${error.message}`); }
    }
    writeFileSync(path.join(evidenceDir, 'standalone-output.log'), output);
    report.server_output = { file: 'standalone-output.log', sha256: sha256(output), retained_tail_limit_bytes: 200_000 };
    report.finished_at = new Date().toISOString();
    report.errors = errors;
    report.status = errors.length ? 'FAIL' : 'PASS';
    save('source-acceptance.json', report);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(
      ['root', 'expected-sha', 'evidence-dir', 'chromium', 'playwright-module'].map(name => [name, { type: 'string' }])) });
    const result = await runSourceAcceptance(values);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    console.error(`ME2_UI_SOURCE_ACCEPTANCE_FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
