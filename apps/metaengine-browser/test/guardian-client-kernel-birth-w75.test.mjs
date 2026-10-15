import test from 'node:test';
import assert from 'node:assert/strict';
import { guardianClientKernelBirthW67 } from '../src/guardian-client-kernel-birth-w67.mjs';

const epoch100ns = 116444736000000000n;
const ticks = String(epoch100ns + 17700000001234567n);
const pid = 4293;
const incarnation = `pid:${pid}:created_100ns:${ticks}`;
const good = Object.freeze({
  state: 'OWNER_BOUND', client_pid: pid, client_creation_time_100ns: ticks,
  client_process_incarnation_id: incarnation, client_kernel_birth_rechecked: true,
});
test('W75 exact native 100ns proof retains full FILETIME without Number rounding', () => {
  const result = guardianClientKernelBirthW67(good);
  assert.equal(result?.process_incarnation_id, incarnation);
  assert.equal(result?.pid, pid);
});
test('W75 same ISO millisecond but different 100ns birth is a hard reject', () => {
  const altered = String(BigInt(ticks) + 1n);
  assert.equal(guardianClientKernelBirthW67({ ...good, client_creation_time_100ns: altered }), null);
  assert.equal(guardianClientKernelBirthW67({
    ...good, client_process_incarnation_id: `pid:${pid}:created_100ns:${altered}`,
  }), null);
});
test('W75 reused PID, missing independent native postcheck, and truncated values reject', () => {
  for (const bad of [
    { client_pid: pid + 1 }, { client_pid: 0 }, { client_kernel_birth_rechecked: false },
    { client_kernel_birth_rechecked: null }, { client_kernel_birth_rechecked: 'true' },
    { client_creation_time_100ns: Number(ticks) }, { client_creation_time_100ns: '00'+ticks },
    { client_creation_time_100ns: ticks.slice(0, -3) }, { client_process_incarnation_id: null },
  ]) assert.equal(guardianClientKernelBirthW67({ ...good, ...bad }), null);
});
