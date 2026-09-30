import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { nativeSupervisorEnrollmentMetadata } from '../src/native-supervisor-client-base.mjs';
import { normalizeEnrollmentMetadata } from '../supabase/a2-browser-native-supervisor-v1/enrollment-metadata.mjs';

test('installed Electron enrollment correlation is bounded and opt-in', () => {
  const sourceHead = 'a'.repeat(40);
  assert.deepEqual(
    nativeSupervisorEnrollmentMetadata('0.7.0-dev.test', {
      env: {
        METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'INSTALLED_ELECTRON',
        METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: '36559917708',
        METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ATTEMPT: '2',
        METAENGINE_ENROLLMENT_SOURCE_HEAD: sourceHead,
      },
    }),
    {
      shell_version: '0.7.0-dev.test',
      qualification_kind: 'INSTALLED_ELECTRON',
      qualification_run_id: '36559917708',
      qualification_run_attempt: '2',
      source_head: sourceHead,
    },
  );

  for (const env of [
    {},
    {
      METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'INSTALLED_ELECTRON',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: 'not-a-run',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ATTEMPT: '2',
      METAENGINE_ENROLLMENT_SOURCE_HEAD: sourceHead,
    },
    {
      METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'OTHER',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: '36559917708',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ATTEMPT: '2',
      METAENGINE_ENROLLMENT_SOURCE_HEAD: sourceHead,
    },
    {
      METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'INSTALLED_ELECTRON',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: '36559917708',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ATTEMPT: '0',
      METAENGINE_ENROLLMENT_SOURCE_HEAD: sourceHead,
    },
    {
      METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'INSTALLED_ELECTRON',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: '36559917708',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ATTEMPT: '2',
      METAENGINE_ENROLLMENT_SOURCE_HEAD: 'bad',
    },
  ]) {
    const metadata = nativeSupervisorEnrollmentMetadata('0.7.0-dev.test', { env });
    assert.deepEqual(metadata, { shell_version: '0.7.0-dev.test' });
  }
});

test('Edge revalidates installed Electron correlation and does not trust arbitrary metadata', async () => {
  const edge = await readFile(
    new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url),
    'utf8',
  );
  const normalizer = await readFile(
    new URL('../supabase/a2-browser-native-supervisor-v1/enrollment-metadata.mjs', import.meta.url),
    'utf8',
  );
  assert.match(edge, /function enrollmentMetadata\(body:any\)/);
  assert.match(edge, /import \{ normalizeEnrollmentMetadata \} from '\.\/enrollment-metadata\.mjs'/);
  assert.match(edge, /return normalizeEnrollmentMetadata\(body\)/);
  assert.match(normalizer, /kind === 'INSTALLED_ELECTRON'/);
  assert.match(normalizer, /\/\^\[0-9\]\{1,20\}\$\//);
  assert.match(normalizer, /\/\^\[0-9a-f\]\{40\}\$\//);
  assert.match(normalizer, /\/\^\[1-9\]\[0-9\]\{0,5\}\$\//);
  assert.match(edge, /enrollmentInsert\(proof\.id!,proof\.jwk,proof\.fingerprint!,enrollmentMetadata\(body\)\)/);
  assert.doesNotMatch(edge, /metadata\s*:\s*body\?\.metadata/);
});

test('installed workflow nonce survives Native Browser to Edge metadata normalization', () => {
  const metadata = nativeSupervisorEnrollmentMetadata('0.7.0-dev.36753232676.1', {
    env: {
      METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'INSTALLED_ELECTRON',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: '36753232589',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ATTEMPT: '2',
      METAENGINE_ENROLLMENT_SOURCE_HEAD: 'c'.repeat(40),
      METAENGINE_ENROLLMENT_QUALIFICATION_NONCE_SHA256: 'd'.repeat(64),
    },
  });
  const persisted = normalizeEnrollmentMetadata({ metadata: {
    ...metadata, client_kind: 'UNTRUSTED', service_role: 'must-not-persist',
  } });
  assert.deepEqual(persisted, {
    client_kind: 'METAENGINE_BROWSER_ELECTRON_NATIVE', ...metadata,
  });
  assert.equal(persisted.qualification_nonce_sha256, 'd'.repeat(64));
  assert.equal(persisted.qualification_run_attempt, '2');
  assert.equal(persisted.source_head, 'c'.repeat(40));
  assert.equal(Object.hasOwn(persisted, 'service_role'), false);
});

test('nonce is never promoted from malformed or unqualified enrollment metadata', () => {
  const valid = {
    qualification_kind: 'INSTALLED_ELECTRON', qualification_run_id: '36753232589',
    qualification_run_attempt: '2', source_head: 'c'.repeat(40),
    qualification_nonce_sha256: 'd'.repeat(64),
  };
  for (const patch of [
    { qualification_kind: 'MANUAL' }, { qualification_run_id: '../run' },
    { qualification_run_attempt: '0' }, { source_head: 'wrong-head' },
    { qualification_nonce_sha256: '' }, { qualification_nonce_sha256: 'd'.repeat(63) },
    { qualification_nonce_sha256: 'g'.repeat(64) },
  ]) {
    const persisted = normalizeEnrollmentMetadata({ metadata: { ...valid, ...patch } });
    assert.equal(Object.hasOwn(persisted, 'qualification_nonce_sha256'), false);
  }
  assert.deepEqual(normalizeEnrollmentMetadata({ metadata: { qualification_nonce_sha256: 'd'.repeat(64) } }), {
    client_kind: 'METAENGINE_BROWSER_ELECTRON_NATIVE', shell_version: '',
  });
});


test('installed qualification workflow injects exact enrollment provenance', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/browser-windows-installed-chat-qualification.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /METAENGINE_ENROLLMENT_QUALIFICATION_KIND:\s*INSTALLED_ELECTRON/);
  assert.match(workflow, /METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID:\s*\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ATTEMPT:\s*\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /METAENGINE_ENROLLMENT_SOURCE_HEAD:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
});
