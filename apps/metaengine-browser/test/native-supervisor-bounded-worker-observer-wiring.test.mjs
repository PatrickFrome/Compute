import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildWorkerObserverHeartbeatProjection } from '../src/native-supervisor-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = (name) => path.resolve(here, '..', 'src', name);

test('worker observer heartbeat projection strips authority-bearing signal fields', () => {
  const projection = buildWorkerObserverHeartbeatProjection({
    observerSnapshot: {
      schema: 'metaengine.bounded-worker-observer.v2',
      budget: 4,
      cursor: 2,
      cached_bindings: 1,
      lease_eligible: false,
      scheduler_authority: false,
      authority_effect: false,
    },
    observedAt: '2026-08-31T19:30:00.000Z',
    lastError: null,
    signals: [{
      agent_id: 'agent_12345678',
      lifecycle_state: 'BOUND_UNVERIFIED',
      generation_state: 'IDLE',
      observation_state: 'CAPTURED_EXACT_LOCAL_TARGET',
      lease_eligible: true,
      scheduler_authority: true,
      automatic_retry_allowed: true,
      authority_effect: true,
      page_text: 'untrusted page text must not cross the projection',
    }],
  });

  assert.equal(projection.schema, 'metaengine.bounded-worker-observer.heartbeat.v1');
  assert.equal(projection.lease_eligible, false);
  assert.equal(projection.scheduler_authority, false);
  assert.equal(projection.control_authority, false);
  assert.equal(projection.command_leasing, false);
  assert.equal(projection.devos_leasing, false);
  assert.equal(projection.second_polling_loop, false);
  assert.equal(projection.authority_effect, false);
  assert.equal(projection.signals.length, 1);
  assert.deepEqual(projection.signals[0], {
    agent_id: 'agent_12345678',
    lifecycle_state: 'BOUND_UNVERIFIED',
    generation_state: 'IDLE',
    observation_state: 'CAPTURED_EXACT_LOCAL_TARGET',
    lease_eligible: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
  assert.equal('page_text' in projection.signals[0], false);
});

test('worker observation is wired into the existing primary heartbeat before DevOS and has no timer', async () => {
  const wrapper = await fs.readFile(sourcePath('native-supervisor-client.mjs'), 'utf8');
  assert.match(wrapper, /export \* from '\.\/native-supervisor-client-core\.mjs'/, 'compatibility wrapper must preserve the proven core export surface');
  const source = await fs.readFile(sourcePath('native-supervisor-client-core.mjs'), 'utf8');
  const observeIndex = source.indexOf('await this.#observeWorkers();');
  const heartbeatIndex = source.indexOf('await super.cycle();', observeIndex);
  const devosIndex = source.indexOf('await this.#devosTaskCycle.cycle();', heartbeatIndex);

  assert.ok(observeIndex > 0, 'worker observer stage missing');
  assert.ok(heartbeatIndex > observeIndex, 'worker observer must run before the primary heartbeat');
  assert.ok(devosIndex > heartbeatIndex, 'DevOS must remain the post-heartbeat scheduling stage');
  assert.match(source, /worker_observer_source:\s*this\.#workerObserver\s*\?\s*'NATIVE_SUPERVISOR_HEARTBEAT'/);
  assert.match(source, /worker_observer_second_polling_loop:\s*false/);

  const intervalMatches = source.match(/setInterval\s*\(/g) || [];
  assert.equal(intervalMatches.length, 1, 'observer must not add a second timer/polling loop');
  assert.match(source, /#startBootstrapPump[\s\S]*setInterval\s*\(\(\) => \{ void this\.#bootstrapPulse/);
  assert.doesNotMatch(wrapper, /setInterval\s*\(/, 'workspace wrapper must not add another timer');
});

test('Browser root supplies a trusted local WebContents observer with bounded budget', async () => {
  const source = await fs.readFile(sourcePath('main.mjs'), 'utf8');
  assert.match(source, /createFleetTargetLocalObserver/);
  assert.match(source, /lookupView:\s*\(tabId\) => views\.get\(String\(tabId\)\) \|\| null/);
  assert.match(source, /observeLocalTarget,/);
  assert.match(source, /workerObservationBudget:\s*4/);
  assert.doesNotMatch(source, /setInterval[\s\S]{0,200}workerObservation/);
});