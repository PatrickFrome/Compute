import assert from 'node:assert/strict';
import test from 'node:test';
import { explicitLocalSupervisorBase } from '../src/explicit-local-supervisor-provider.mjs';
import { defaultAgentAccessCapsule, renderAgentAccessCapsuleBlock } from '../src/agent-access-capsule.mjs';

test('blocked native Owner is UNKNOWN and cannot publish even a claimed loopback URL', () => {
  const env = {
    METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES',
    METAENGINE_LOCAL_PROVIDER_BOOT_STATE: 'BLOCKED',
    METAENGINE_LOCAL_PROVIDER_BOOT_REASON: 'NO_OWNER_CONFIG',
    METAENGINE_SUPERVISOR_BASE_URL: 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1',
  };
  assert.equal(explicitLocalSupervisorBase({ env, activeBase: env.METAENGINE_SUPERVISOR_BASE_URL }), null);
  const capsule = defaultAgentAccessCapsule({ env, activeBase: env.METAENGINE_SUPERVISOR_BASE_URL });
  assert.match(capsule.infrastructure[0].name, /OWNER_UNKNOWN/);
  assert.equal(capsule.infrastructure[0].url, '');
  assert.doesNotMatch(renderAgentAccessCapsuleBlock(capsule), /127\.0\.0\.1:15433/);
});
test('blocked bootstrap cannot turn a hosted URL into a native Owner even if injected by process env', () => {
  const env = {
    METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES',
    METAENGINE_LOCAL_PROVIDER_BOOT_STATE: 'BLOCKED',
    METAENGINE_SUPERVISOR_BASE_URL: 'https://legacy.invalid/functions/v1/command',
    METAENGINE_LOCAL_STATE_INSTANCE_ID: '11111111-2222-4333-8444-555555555555',
  };
  assert.equal(explicitLocalSupervisorBase({ env, activeBase: env.METAENGINE_SUPERVISOR_BASE_URL }), null);
  const rendered = renderAgentAccessCapsuleBlock(defaultAgentAccessCapsule({ env, activeBase: env.METAENGINE_SUPERVISOR_BASE_URL }));
  assert.doesNotMatch(rendered, /legacy\.invalid|supabase\.co|postgresql:\/\//);
});
