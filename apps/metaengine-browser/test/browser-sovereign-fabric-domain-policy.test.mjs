import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS,
  BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP,
  browserFabricEffectDomainPolicyContract,
  evaluateBrowserFabricEffectDomain,
} from '../src/browser-fabric-effect-domain-policy.mjs';

test('audit freeze rejects unknown effect domains regardless of runtime input', () => {
  const unknown = evaluateBrowserFabricEffectDomain('MODEL_PURCHASE');
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.reason, 'NEW_EFFECT_DOMAIN_FROZEN');
  assert.equal(unknown.new_effect_domain_allowed, false);
  assert.equal(unknown.rfc_required_for_new_domain, true);
  assert.equal(unknown.automatic_retry_allowed, false);
});

test('existing effect domain may pass only without weakening one-attempt/readback semantics', () => {
  assert.equal(
    evaluateBrowserFabricEffectDomain('SESSION_BROKER').reason,
    'EXISTING_EFFECT_DOMAIN_PROOF_REQUIRED',
  );
  const recognized = evaluateBrowserFabricEffectDomain('SESSION_BROKER', {
    existing_domain_proof: {
      domain: 'SESSION_BROKER',
      one_attempt_journal: true,
      independent_readback: true,
      automatic_retry_allowed: false,
      ...BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP.SESSION_BROKER,
    },
  });
  assert.equal(recognized.allowed, true);

  const weakened = evaluateBrowserFabricEffectDomain('SESSION_BROKER', {
    existing_domain_proof: {
      domain: 'SESSION_BROKER',
      one_attempt_journal: true,
      independent_readback: false,
      automatic_retry_allowed: false,
      ...BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP.SESSION_BROKER,
    },
  });
  assert.equal(weakened.allowed, false);
  assert.equal(weakened.reason, 'EXISTING_EFFECT_DOMAIN_PROOF_INVALID');

  const competingActuator = evaluateBrowserFabricEffectDomain('SESSION_BROKER', {
    existing_domain_proof: {
      domain: 'SESSION_BROKER',
      one_attempt_journal: true,
      independent_readback: true,
      automatic_retry_allowed: false,
      ...BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP.SESSION_BROKER,
      actuator_owner: 'SECOND_WTS_ACTUATOR',
    },
  });
  assert.equal(competingActuator.reason, 'EXISTING_EFFECT_DOMAIN_PROOF_INVALID');
});

test('effect-domain registry cannot be extended from env/queue/config', () => {
  const contract = browserFabricEffectDomainPolicyContract();
  assert.equal(contract.runtime_domain_registration_allowed, false);
  assert.equal(contract.environment_domain_registration_allowed, false);
  assert.equal(contract.queue_domain_registration_allowed, false);
  assert.equal(contract.rfc_required_for_new_domain, true);
  assert.equal(contract.threat_model_required_for_new_domain, true);
  assert.ok(BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS.includes('PROCESS'));
  assert.ok(BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS.includes('SESSION_BROKER'));
  assert.equal(contract.one_journal_owner_per_domain, true);
  assert.equal(contract.one_actuator_owner_per_domain, true);
  assert.equal(contract.one_reconcile_owner_per_domain, true);
});
