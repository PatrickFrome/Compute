import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

const SOURCE = 'a'.repeat(40);

test('runtime initializes zero-authority shadow profile binding plane and freezes trust root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-shadow-runtime-'));
  try {
    const runtime = new RsiRuntimeService({
      source_sha: SOURCE,
      ledgerPath: path.join(root, 'runtime-ledger.jsonl'),
    });

    const snapshot = await runtime.start();

    assert.equal(snapshot.state, 'READY');
    assert.equal(snapshot.source_sha, SOURCE);
    assert.equal(snapshot.shadow_profile_binding.schema, 'metaengine.rsi.shadow-profile-binding-ledger.v1');
    assert.equal(snapshot.shadow_profile_binding.row_count, 0);
    assert.equal(snapshot.shadow_profile_binding.active_profile_digest, null);
    assert.equal(snapshot.shadow_profile_binding.canary_profile_digest, null);
    assert.equal(snapshot.shadow_profile_binding.ledger_can_activate_profile, false);
    assert.equal(snapshot.shadow_profile_binding.authority_effect, false);

    assert.equal(snapshot.trust_roots.shadow_profile_binding.schema, 'metaengine.rsi.shadow-profile-binding-root.v1');
    assert.equal(snapshot.trust_roots.shadow_profile_binding.authority_effect, false);
    assert.match(snapshot.trust_roots.shadow_profile_binding.digest, /^[0-9a-f]{64}$/);

    assert.equal(typeof runtime.bindQualifiedMetaProfileForShadow, 'function');
    assert.equal(typeof runtime.shadowProfileBindings, 'function');
    assert.deepEqual(runtime.shadowProfileBindings(), []);

    assert.equal(snapshot.browser_authority, false);
    assert.equal(snapshot.scheduler_authority, false);
    assert.equal(snapshot.execution_authority, false);
    assert.equal(snapshot.production_mutation_authority, false);
    assert.equal(snapshot.promotion_authority, false);
    assert.equal(snapshot.self_update_authority, false);
    assert.equal(snapshot.automatic_retry_allowed, false);
    assert.equal(snapshot.authority_effect, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
