import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMe2DaemonRoutingAuthority } from '../src/me2/me2-daemon-host.mjs';

const now = Date.parse('2026-10-07T12:00:00Z');
const owned = () => ({ now, state: 'HEALTHY', stopped: false, lastHealthOkAt: new Date(now - 1000).toISOString(),
  child: { pid: 123, exitCode: null, signalCode: null } });
test('only an owned live child with fresh health can authorize a diagnostic route', () => {
  assert.equal(projectMe2DaemonRoutingAuthority(owned()).routing_authorized, true);
  for (const patch of [{ child: null }, { state: 'ADOPTED' }, { stopped: true }, { state: 'DEGRADED' },
    { child: { pid: 123, exitCode: 0 } }, { child: { pid: 123, signalCode: 'SIGTERM' } },
    { lastHealthOkAt: new Date(now - 30_001).toISOString() }, { lastHealthOkAt: new Date(now + 5_001).toISOString() }]) {
    const result = projectMe2DaemonRoutingAuthority({ ...owned(), ...patch });
    assert.equal(result.routing_authorized, false, JSON.stringify(patch));
    assert.equal(result.external_adoption_authorized, false);
  }
});
