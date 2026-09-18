import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

const SOURCE = 'a'.repeat(40);

test('runtime initializes meta-profile admission as zero-authority shadow-only state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-meta-profile-runtime-'));
  try {
    const runtime = new RsiRuntimeService({
      source_sha: SOURCE,
      ledgerPath: path.join(root, 'runtime-ledger.json'),
    });
    await runtime.start();
    const snapshot = runtime.snapshot();

    assert.equal(snapshot.state, 'READY');
    assert.equal(snapshot.mode, 'SHADOW_VERIFIED');
    assert.equal(snapshot.runtime_meta_profile_admission.initialized, true);
    assert.equal(snapshot.runtime_meta_profile_admission.active_profile_digest, null);
    assert.equal(snapshot.runtime_meta_profile_admission.store_can_activate_profile, false);
    assert.equal(snapshot.runtime_meta_profile_admission.bounded_shadow_canary_required, true);
    assert.equal(snapshot.runtime_meta_profile_admission.production_activation_authorized, false);
    assert.equal(snapshot.runtime_meta_profile_admission.authority_effect, false);
    assert.equal(snapshot.trust_roots.runtime_meta_profile_admission.authority_effect, false);
    assert.equal(runtime.metaProfileShadowAdmissions().length, 0);

    await assert.rejects(
      runtime.recordMetaProfileShadowAdmission({
        record_id: 'missing.meta.record',
        plan: {},
        result: {},
        budget: {},
        risk_certificate: {},
        admission_id: 'meta.profile.admission.missing',
        external_admission_owner: true,
        authored_by_candidate: false,
      }),
      /rsi_runtime_meta_profile_record_unavailable/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
