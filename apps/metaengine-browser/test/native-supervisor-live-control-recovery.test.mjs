import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSupervisorEnrollmentBootstrap } from '../src/native-supervisor-client.mjs';

test('enrollment bootstrap exposes no control authority while approval is pending', async () => {
  let calls = 0;
  const result = await runSupervisorEnrollmentBootstrap({
    async ensureEnrollment() {
      calls += 1;
      return { status: 'PENDING_APPROVAL', request_id: '00000000-0000-4000-8000-000000000001', device_id: null };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'PENDING_APPROVAL');
  assert.equal(result.device_id, null);
  assert.equal(result.command_leasing, false);
  assert.equal(result.browser_authority, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.second_polling_loop, false);
  assert.equal(result.authority_effect, false);
});

test('enrollment bootstrap reports an already-approved device without granting command authority itself', async () => {
  const result = await runSupervisorEnrollmentBootstrap({
    async ensureEnrollment() {
      return {
        status: 'APPROVED',
        request_id: '00000000-0000-4000-8000-000000000001',
        device_id: '00000000-0000-4000-8000-000000000002',
      };
    },
  });
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.device_id, '00000000-0000-4000-8000-000000000002');
  assert.equal(result.command_leasing, false);
  assert.equal(result.browser_authority, false);
});

test('public wrapper recovers enrollment through startup and the one existing command cycle only', async () => {
  const source = await readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  const startIndex = source.indexOf('async start()');
  const processIndex = source.indexOf('await this.#startRealtimeProcessPlane()', startIndex);
  const enrollIndex = source.indexOf('await this.#bootstrapEnrollment()', startIndex);
  const baseStartIndex = source.indexOf('await super.start()', startIndex);
  assert.ok(startIndex >= 0 && processIndex > startIndex, 'startup must initialize observation plane');
  assert.ok(enrollIndex > processIndex, 'enrollment must follow local observation bootstrap');
  assert.ok(baseStartIndex > enrollIndex, 'existing supervisor runtime must start only after bounded enrollment bootstrap');

  const cycleIndex = source.indexOf('async cycle()');
  const cycleEnrollIndex = source.indexOf('await this.#bootstrapEnrollment()', cycleIndex);
  const baseCycleIndex = source.indexOf('await super.cycle()', cycleIndex);
  assert.ok(cycleIndex >= 0 && cycleEnrollIndex > cycleIndex && baseCycleIndex > cycleEnrollIndex);

  // Observation may debounce state pushes, but it must never create another command
  // lease/poll loop. Only the inherited supervisor cycle is command authority.
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /commands\/next|commands\/wait-batch|lease_batch|executeCommandBatch/);
  assert.match(source, /realtime_process_plane_second_scheduler:\s*false/);
  assert.match(source, /command_leasing:\s*false/);
  assert.match(source, /enrollment_bootstrap_auto_approval:\s*false/);
  assert.match(source, /automatic_retry_allowed:\s*false/);
});