import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { nativeSupervisorEnrollmentMetadata } from '../src/native-supervisor-client-base.mjs';

test('installed Electron enrollment correlation is bounded and opt-in', () => {
  const sourceHead = 'a'.repeat(40);
  assert.deepEqual(
    nativeSupervisorEnrollmentMetadata('0.7.0-dev.test', {
      env: {
        METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'INSTALLED_ELECTRON',
        METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: '36559917708',
        METAENGINE_ENROLLMENT_SOURCE_HEAD: sourceHead,
      },
    }),
    {
      shell_version: '0.7.0-dev.test',
      qualification_kind: 'INSTALLED_ELECTRON',
      qualification_run_id: '36559917708',
      source_head: sourceHead,
    },
  );

  for (const env of [
    {},
    {
      METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'INSTALLED_ELECTRON',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: 'not-a-run',
      METAENGINE_ENROLLMENT_SOURCE_HEAD: sourceHead,
    },
    {
      METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'OTHER',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: '36559917708',
      METAENGINE_ENROLLMENT_SOURCE_HEAD: sourceHead,
    },
    {
      METAENGINE_ENROLLMENT_QUALIFICATION_KIND: 'INSTALLED_ELECTRON',
      METAENGINE_ENROLLMENT_QUALIFICATION_RUN_ID: '36559917708',
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
  assert.match(edge, /function enrollmentMetadata\(body:any\)/);
  assert.match(edge, /kind==='INSTALLED_ELECTRON'/);
  assert.match(edge, /\/\^\[0-9\]\{1,20\}\$\//);
  assert.match(edge, /\/\^\[0-9a-f\]\{40\}\$\//);
  assert.match(edge, /metadata\.qualification_kind=kind/);
  assert.match(edge, /metadata\.qualification_run_id=runId/);
  assert.match(edge, /metadata\.source_head=sourceHead/);
  assert.match(edge, /enrollmentInsert\(proof\.id!,proof\.jwk,proof\.fingerprint!,enrollmentMetadata\(body\)\)/);
  assert.doesNotMatch(edge, /metadata\s*:\s*body\?\.metadata/);
});
