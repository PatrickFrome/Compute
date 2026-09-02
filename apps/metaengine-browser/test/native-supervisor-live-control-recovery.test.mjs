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

test('public wrapper recovers enrollment through startup and the one existing cycle only', async () => {
  const source = await readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  assert.match(source, /async start\(\)\s*\{[\s\S]*?await this\.#bootstrapEnrollment\(\);[\s\S]*?return super\.start\(\);/);
  assert.match(source, /async cycle\(\)\s*\{[\s\S]*?await this\.#bootstrapEnrollment\(\);[\s\S]*?await super\.cycle\(\);/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.match(source, /enrollment_bootstrap_auto_approval:\s*false/);
  assert.match(source, /automatic_retry_allowed:\s*false/);
});
