import test from 'node:test';
import assert from 'node:assert/strict';
import { finiteRuntimeRecoveryHealthFailure } from '../src/runtime-recovery-policy.mjs';
import { normalizeRuntimeHealthFailure } from '../../../infra/client-state-runtime/launcher.mjs';

test('Host and Browser agree on bounded API and PostgreSQL timeout diagnostics', () => {
  const rows = [
    ...['health_http_api_capacity', 'health_http_api_database', 'health_http_api_catalog'].map(code => ({code, component:'api', http_status:503})),
    ...['postgres_inspection_connection_timeout', 'postgres_inspection_network_timeout', 'postgres_inspection_query_timeout'].map(code => ({code, component:'postgres', http_status:null})),
  ];
  for (const row of rows) {
    const witness = {schema:'metaengine.client-state.health-failure.v1', ...row, consecutive_failures:3, authority_effect:false};
    assert.deepEqual(finiteRuntimeRecoveryHealthFailure(normalizeRuntimeHealthFailure(witness)), witness);
    assert.equal(finiteRuntimeRecoveryHealthFailure({...witness, private_error:'secret'}), null);
    if (row.component === 'api') {
      assert.equal(finiteRuntimeRecoveryHealthFailure({...witness, http_status:500}), null);
      assert.equal(finiteRuntimeRecoveryHealthFailure({...witness, component:'edge'}), null);
    }
  }
});
