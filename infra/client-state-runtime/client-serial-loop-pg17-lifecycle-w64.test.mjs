import test from 'node:test';
import assert from 'node:assert/strict';
import { isW64PostmasterBirthWithinStartupEnvelope } from './client-serial-loop-pg17-lifecycle-w64.mjs';

// postmaster.pid time(NULL) can precede pg_postmaster_start_time() across
// a second boundary. No arbitrary birth drift, negative skew or foreign PID
// may substitute for the independent PID/PGDATA/port/SQL readbacks.
test('W64 PG17 start-time fence accepts only same or immediately next second', () => {
  const birth=1792029805;
  assert.equal(isW64PostmasterBirthWithinStartupEnvelope(birth,1792029805500),true);
  assert.equal(isW64PostmasterBirthWithinStartupEnvelope(birth,1792029806001),true);
  for (const sql of [1792029804999,1792029807000,1792029810000,0,-1,
    Number.NaN,Number.POSITIVE_INFINITY,'1792029806001']) {
    assert.equal(isW64PostmasterBirthWithinStartupEnvelope(birth,sql),false);
  }
  for (const bad of [0,-1,1.5,'1792029805',NaN,Infinity]) {
    assert.equal(isW64PostmasterBirthWithinStartupEnvelope(bad,1792029806000),false);
  }
});
