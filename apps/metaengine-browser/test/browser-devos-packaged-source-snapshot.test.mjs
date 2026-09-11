import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SNAPSHOT_SCHEMA,
  PROVENANCE_FILE,
  FIXED_SOURCE_FILES,
  buildDevOSSourceSnapshot,
} = require('../scripts/devos-source-snapshot-builder.cjs');

test('packaged source snapshot copies only host-fixed sources with exact provenance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-source-root-'));
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-source-out-'));
  try {
    for (const relativePath of FIXED_SOURCE_FILES) {
      const file = path.join(root, relativePath);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `// ${relativePath}\n`, 'utf8');
    }
    await fs.writeFile(path.join(root, 'secret.txt'), 'must-not-copy', 'utf8');
    const manifest = await buildDevOSSourceSnapshot({
      repoRoot: root,
      outputDir: out,
      repository: 'PatrickFrome/Compute',
      head: 'a'.repeat(40),
      ref: 'refs/heads/work/devos-convergence-live-opt-v1',
    });
    assert.equal(manifest.schema, SNAPSHOT_SCHEMA);
    assert.equal(manifest.head, 'a'.repeat(40));
    assert.deepEqual(manifest.source_files, [...FIXED_SOURCE_FILES]);
    assert.equal(manifest.arbitrary_path_copy, false);
    assert.equal(manifest.process_spawn_used, false);
    assert.equal(await fs.stat(path.join(out, 'secret.txt')).then(() => true).catch(() => false), false);
    const persisted = JSON.parse(await fs.readFile(path.join(out, PROVENANCE_FILE), 'utf8'));
    assert.deepEqual(persisted.source_files, [...FIXED_SOURCE_FILES]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(out, { recursive: true, force: true });
  }
});
