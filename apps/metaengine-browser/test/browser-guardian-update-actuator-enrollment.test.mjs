import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserGuardianUpdateActuatorClient,
  browserGuardianUpdateActuatorClientContract,
} from '../src/browser-guardian-update-actuator-client.mjs';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const NONCE = 'abcdefghijklmnopqrstuvwxyzABCDEF123456';
const FINGERPRINT = 'a'.repeat(64);
const TICKET = 'B'.repeat(43);
const TICKET_SHA = 'c'.repeat(64);
const JWK = { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) };

function result(state, reason, extra = {}) {
  return {
    schema: 'metaengine.browser-guardian.update-actuator-result.v1',
    state,
    reason,
    automatic_retry_allowed: false,
    caller_supplied_path_used: false,
    caller_supplied_url_used: false,
    caller_supplied_shell_used: false,
    authority_effect: false,
    ...extra,
  };
}

function identity() {
  return {
    async guardianOwnerChallenge(input) {
      if (input.enrollment_ticket_sha256 != null) assert.equal(input.enrollment_ticket_sha256, TICKET_SHA);
      return {
        schema: 'metaengine.browser-guardian.owner-challenge-proof.v1',
        public_jwk: JWK,
        key_fingerprint_sha256: FINGERPRINT,
        enrollment_ticket_sha256: input.enrollment_ticket_sha256 ?? null,
        signature: 'A'.repeat(86),
      };
    },
    async guardianUpdateActuatorProof() { throw new Error('not_used'); },
  };
}

test('read-only owner probe precedes exactly one ticket-bound enrollment attempt', async () => {
  const wires = [];
  let ticketCalls = 0;
  const client = new BrowserGuardianUpdateActuatorClient({
    identity: identity(),
    enrollmentTicketProvider: async () => {
      ticketCalls += 1;
      return {
        ticket: TICKET,
        ticket_sha256: TICKET_SHA,
        single_use: true,
        persisted_locally: false,
      };
    },
    transport: async (wire) => {
      wires.push(wire);
      if (wires.length === 1) {
        assert.doesNotMatch(wire, /enrollment_ticket=/);
        return result('NO_EFFECT_PROVEN', 'OWNER_ENROLLMENT_TICKET_REQUIRED', {
          effect_absent_proven: true,
        });
      }
      if (wires.length === 2) {
        assert.match(wire, new RegExp(`enrollment_ticket=${TICKET}\\n`));
        assert.match(wire, new RegExp(`enrollment_ticket_sha256=${TICKET_SHA}\\n`));
      } else {
        assert.doesNotMatch(wire, /enrollment_ticket=/);
      }
      return result('OWNER_BOUND', 'DURABLE_OWNER_AND_DEVICE_CHALLENGE_EXACT', {
        effect_absent_proven: wires.length === 3,
        owner_binding_proven: true,
        device_binding_proven: true,
        device_key_fingerprint_sha256: FINGERPRINT,
      });
    },
  });

  const bound = await client.ensureOwnerBound({ command_id: COMMAND_ID, request_nonce: NONCE });
  assert.equal(bound.state, 'OWNER_BOUND');
  assert.equal(ticketCalls, 1);
  assert.equal(wires.length, 3);
});

test('durable enrollment success followed by lost readback blocks dispatch without a second ticket', async () => {
  let calls = 0;
  let tickets = 0;
  const client = new BrowserGuardianUpdateActuatorClient({
    identity: identity(),
    enrollmentTicketProvider: async () => {
      tickets += 1;
      return { ticket: TICKET, ticket_sha256: TICKET_SHA, single_use: true, persisted_locally: false };
    },
    transport: async () => {
      calls += 1;
      if (calls === 1) return result('NO_EFFECT_PROVEN', 'OWNER_ENROLLMENT_TICKET_REQUIRED', { effect_absent_proven: true });
      if (calls === 2) return result('OWNER_BOUND', 'DURABLE_OWNER_AND_ADMIN_DEVICE_ENROLLMENT_EXACT', {
        effect_absent_proven: false, owner_binding_proven: true, device_binding_proven: true,
        device_key_fingerprint_sha256: FINGERPRINT,
      });
      throw new Error('readback_lost');
    },
  });
  await assert.rejects(client.ensureOwnerBound({ command_id: COMMAND_ID, request_nonce: NONCE }),
    { code: 'GUARDIAN_OWNER_ENROLLMENT_AMBIGUOUS' });
  assert.equal(tickets, 1);
  assert.equal(calls, 3);
});

test('ticket-bound transport loss is ambiguous and never auto-retried', async () => {
  let transports = 0;
  let ticketCalls = 0;
  const client = new BrowserGuardianUpdateActuatorClient({
    identity: identity(),
    enrollmentTicketProvider: async () => {
      ticketCalls += 1;
      return { ticket: TICKET, ticket_sha256: TICKET_SHA, single_use: true, persisted_locally: false };
    },
    transport: async () => {
      transports += 1;
      if (transports === 1) return result('NO_EFFECT_PROVEN', 'OWNER_ENROLLMENT_TICKET_REQUIRED', { effect_absent_proven: true });
      throw new Error('pipe_lost_after_ticket_write');
    },
  });

  await assert.rejects(
    () => client.ensureOwnerBound({ command_id: COMMAND_ID, request_nonce: NONCE }),
    (error) => error?.code === 'GUARDIAN_OWNER_ENROLLMENT_AMBIGUOUS',
  );
  assert.equal(ticketCalls, 1);
  assert.equal(transports, 2);
});

test('ticket is never requested for already-bound owner or for non-exact missing-owner result', async () => {
  for (const first of [
    result('OWNER_BOUND', 'DURABLE_OWNER_AND_DEVICE_CHALLENGE_EXACT', {
      effect_absent_proven: true,
      owner_binding_proven: true,
      device_binding_proven: true,
      device_key_fingerprint_sha256: FINGERPRINT,
    }),
    result('NO_EFFECT_PROVEN', 'OWNER_SESSION_BINDING_UNPROVEN', { effect_absent_proven: true }),
  ]) {
    let ticketCalls = 0;
    const client = new BrowserGuardianUpdateActuatorClient({
      identity: identity(),
      enrollmentTicketProvider: async () => { ticketCalls += 1; throw new Error('unexpected_ticket'); },
      transport: async () => first,
    });
    if (first.state === 'OWNER_BOUND') {
      assert.equal((await client.ensureOwnerBound({ command_id: COMMAND_ID, request_nonce: NONCE })).state, 'OWNER_BOUND');
    } else {
      await assert.rejects(
        () => client.ensureOwnerBound({ command_id: COMMAND_ID, request_nonce: NONCE }),
        /guardian_owner_probe_unproven/,
      );
    }
    assert.equal(ticketCalls, 0);
  }
});

test('actuator contract explicitly forbids automatic owner-enrollment retry', () => {
  const row = browserGuardianUpdateActuatorClientContract();
  assert.equal(row.read_only_owner_probe_precedes_enrollment, true);
  assert.equal(row.single_use_admin_ticket_required_for_first_binding, true);
  assert.equal(row.ticket_bound_device_signature_required, true);
  assert.equal(row.owner_enrollment_transport_loss_outcome, 'AMBIGUOUS');
  assert.equal(row.automatic_owner_enrollment_retry_allowed, false);
});
