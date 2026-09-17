import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEVOS_REPO_FILE_READ_SCHEMA,
  DEVOS_REPO_FILE_SAVE_SCHEMA,
  readDevOSRepoTextFile,
  saveDevOSRepoTextFile,
} = require('../src/devos-repo-file-io.cjs');

const source = Object.freeze({
  repository: 'PatrickFrome/Compute',
  head: 'a'.repeat(40),
  ref: 'refs/heads/work/devos-ide-typed-repo-io-v1',
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'metaengine-devos-file-io-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'sample.js'), 'export const value = 1;\n', 'utf8');
  return root;
}

async function open(root, relative_path = 'src/sample.js') {
  return readDevOSRepoTextFile({
    repoRoot: root,
    source,
    payload: { source, relative_path },
  });
}

test('typed repo read is exact-source, bounded, workspace-bound and authority-free', async () => {
  const root = await fixture();
  try {
    const result = await open(root);
    assert.equal(result.schema, DEVOS_REPO_FILE_READ_SCHEMA);
    assert.deepEqual(result.source, source);
    assert.equal(result.relative_path, 'src/sample.js');
    assert.equal(result.text, 'export const value = 1;\n');
    assert.match(result.file_sha256, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.workspace_fingerprint_sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(result.repository_effect, false);
    assert.equal(result.automatic_retry_allowed, false);
    assert.equal(result.authority_effect, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('typed repo read rejects stale source and path escape before touching content', async () => {
  const root = await fixture();
  try {
    await assert.rejects(
      readDevOSRepoTextFile({
        repoRoot: root,
        source,
        payload: { source: { ...source, head: 'b'.repeat(40) }, relative_path: 'src/sample.js' },
      }),
      /source_stale/,
    );
    for (const relative_path of ['../outside.js', '/absolute.js', 'src\\sample.js', '.git/HEAD']) {
      await assert.rejects(
        readDevOSRepoTextFile({ repoRoot: root, source, payload: { source, relative_path } }),
        /path_(?:escape|absolute|invalid|reserved)/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('typed repo IO rejects symlink components when the platform permits creating them', async (t) => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'outside'), { recursive: true });
    await writeFile(join(root, 'outside', 'target.js'), 'outside\n', 'utf8');
    try {
      await symlink(join(root, 'outside'), join(root, 'linked'), 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
        t.skip('symlink creation is not permitted on this runner');
        return;
      }
      throw error;
    }
    await assert.rejects(
      readDevOSRepoTextFile({ repoRoot: root, source, payload: { source, relative_path: 'linked/target.js' } }),
      /symlink_denied/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verified save requires workspace fingerprint, exact old digest and exact source', async () => {
  const root = await fixture();
  try {
    const opened = await open(root);
    const receipt = await saveDevOSRepoTextFile({
      repoRoot: root,
      currentSource: source,
      payload: {
        source,
        workspace_fingerprint_sha256: opened.workspace_fingerprint_sha256,
        relative_path: opened.relative_path,
        expected_file_sha256: opened.file_sha256,
        text: 'export const value = 2;\n',
      },
      readCurrentSource: async () => source,
    });
    assert.equal(receipt.schema, DEVOS_REPO_FILE_SAVE_SCHEMA);
    assert.equal(receipt.state, 'VERIFIED');
    assert.equal(receipt.previous_file_sha256, opened.file_sha256);
    assert.notEqual(receipt.file_sha256, opened.file_sha256);
    assert.equal(receipt.repository_effect, true);
    assert.equal(receipt.readback_verified, true);
    assert.equal(receipt.automatic_retry_allowed, false);
    assert.equal(await readFile(join(root, 'src', 'sample.js'), 'utf8'), 'export const value = 2;\n');

    await assert.rejects(
      saveDevOSRepoTextFile({
        repoRoot: root,
        currentSource: source,
        payload: {
          source,
          workspace_fingerprint_sha256: 'sha256:' + '0'.repeat(64),
          relative_path: opened.relative_path,
          expected_file_sha256: receipt.file_sha256,
          text: 'export const value = 3;\n',
        },
      }),
      /workspace_mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('save fails closed on stale file digest without modifying the file', async () => {
  const root = await fixture();
  try {
    const opened = await open(root);
    await writeFile(join(root, 'src', 'sample.js'), 'external change\n', 'utf8');
    await assert.rejects(
      saveDevOSRepoTextFile({
        repoRoot: root,
        currentSource: source,
        payload: {
          source,
          workspace_fingerprint_sha256: opened.workspace_fingerprint_sha256,
          relative_path: opened.relative_path,
          expected_file_sha256: opened.file_sha256,
          text: 'should not land\n',
        },
      }),
      /digest_mismatch/,
    );
    assert.equal(await readFile(join(root, 'src', 'sample.js'), 'utf8'), 'external change\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('save fails closed when repository source changes immediately before commit', async () => {
  const root = await fixture();
  try {
    const opened = await open(root);
    await assert.rejects(
      saveDevOSRepoTextFile({
        repoRoot: root,
        currentSource: source,
        payload: {
          source,
          workspace_fingerprint_sha256: opened.workspace_fingerprint_sha256,
          relative_path: opened.relative_path,
          expected_file_sha256: opened.file_sha256,
          text: 'should not land\n',
        },
        readCurrentSource: async () => ({ ...source, head: 'b'.repeat(40) }),
      }),
      /source_changed_before_commit/,
    );
    assert.equal(await readFile(join(root, 'src', 'sample.js'), 'utf8'), opened.text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('save detects a concurrent file change after source revalidation', async () => {
  const root = await fixture();
  try {
    const opened = await open(root);
    await assert.rejects(
      saveDevOSRepoTextFile({
        repoRoot: root,
        currentSource: source,
        payload: {
          source,
          workspace_fingerprint_sha256: opened.workspace_fingerprint_sha256,
          relative_path: opened.relative_path,
          expected_file_sha256: opened.file_sha256,
          text: 'should not land\n',
        },
        readCurrentSource: async () => {
          await writeFile(join(root, 'src', 'sample.js'), 'raced\n', 'utf8');
          return source;
        },
      }),
      /changed_before_commit/,
    );
    assert.equal(await readFile(join(root, 'src', 'sample.js'), 'utf8'), 'raced\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('save of identical content is a verified no-op', async () => {
  const root = await fixture();
  try {
    const opened = await open(root);
    const receipt = await saveDevOSRepoTextFile({
      repoRoot: root,
      currentSource: source,
      payload: {
        source,
        workspace_fingerprint_sha256: opened.workspace_fingerprint_sha256,
        relative_path: opened.relative_path,
        expected_file_sha256: opened.file_sha256,
        text: opened.text,
      },
      readCurrentSource: async () => { throw new Error('no-op must not need mutation revalidation'); },
    });
    assert.equal(receipt.state, 'NO_CHANGE');
    assert.equal(receipt.repository_effect, false);
    assert.equal(receipt.file_sha256, opened.file_sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
