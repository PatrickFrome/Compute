import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  evaluateSuccessorHealth,
  installSelfUpdateHealthQualificationFetchHook,
} from '../src/self-update-health-qualification.mjs';
import {
  beginSelfUpdateTransaction,
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';

async function fixture(source = '0.6.3-dev.151.1', target = '0.6.3-dev.152.1') {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-health-qual-'));
  let current = source;
  const app = {
    getPath: (name) => { assert.equal(name, 'userData'); return userData; },
    getVersion: () => current,
    setVersion: (value) => { current = String(value); },
  };
  await beginSelfUpdateTransaction(app, {
    version: target,
    available_version: target,
    metadata_verified: true,
    restart_gate_safe: true,
    resolved_git_sha: 'b'.repeat(40),
    authority_effect: false,
  });
  await transitionSelfUpdateTransaction(app, 'SUCCESSOR_BOOTED', { requireTargetVersion: target });
  app.setVersion(target);
  return { app, target };
}

function healthyHeartbeat(version, continuity = 'RESTORED') {
  return {
    state: {
      shell_version: version,
      self_update_session_continuity: { state: continuity, authority_effect: false },
      self_update: {
        state: 'CURRENT',
        current_version: version,
        last_error: null,
        host_resilience: {
          state: 'ACTIVE',
          sentinel: { lifecycle: 'ARMED' },
        },
      },
    },
  };
}

test('pure health gate requires accepted signed heartbeat, continuity and sentinel', () => {
  const version = '0.6.3-dev.152.1';
  const transaction = { state: 'SUCCESSOR_BOOTED', target_version: version };
  assert.equal(evaluateSuccessorHealth({ appVersion: version, transaction, heartbeatPayload: healthyHeartbeat(version), responseStatus: 202 }).action, 'QUALIFY');
  assert.equal(evaluateSuccessorHealth({ appVersion: version, transaction, heartbeatPayload: healthyHeartbeat(version, 'PARTIAL'), responseStatus: 202 }).action, 'QUARANTINE');
  const errored = healthyHeartbeat(version);
  errored.state.self_update.last_error = 'resolver_failed';
  assert.equal(evaluateSuccessorHealth({ appVersion: version, transaction, heartbeatPayload: errored, responseStatus: 202 }).action, 'WAIT');
  const noSentinel = healthyHeartbeat(version);
  noSentinel.state.self_update.host_resilience.sentinel.lifecycle = 'STOPPED';
  assert.equal(evaluateSuccessorHealth({ appVersion: version, transaction, heartbeatPayload: noSentinel, responseStatus: 202 }).action, 'WAIT');
});

test('accepted native supervisor heartbeat durably qualifies exact successor', async () => {
  const { app, target } = await fixture();
  const fetchImpl = async () => new Response('', { status: 202 });
  const wrapped = installSelfUpdateHealthQualificationFetchHook({ app, fetchImpl });
  const response = await wrapped('https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1/v1/state', {
    method: 'POST',
    body: JSON.stringify(healthyHeartbeat(target)),
  });
  assert.equal(response.status, 202);
  const row = await readSelfUpdateTransaction(app);
  assert.equal(row.state, 'QUALIFIED');
  assert.equal(row.qualified, true);
  assert.equal(row.evidence.signed_heartbeat_accepted, true);
  assert.equal(row.evidence.session_continuity_restored, true);
  assert.equal(row.evidence.sentinel_armed, true);
});

test('accepted heartbeat with partial continuity quarantines successor and never retries', async () => {
  const { app, target } = await fixture();
  const wrapped = installSelfUpdateHealthQualificationFetchHook({ app, fetchImpl: async () => new Response('', { status: 202 }) });
  await wrapped('https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1/v1/state', {
    method: 'POST',
    body: JSON.stringify(healthyHeartbeat(target, 'PARTIAL')),
  });
  const row = await readSelfUpdateTransaction(app);
  assert.equal(row.state, 'QUARANTINED');
  assert.equal(row.quarantined, true);
  assert.equal(row.automatic_retry_allowed, false);
});
