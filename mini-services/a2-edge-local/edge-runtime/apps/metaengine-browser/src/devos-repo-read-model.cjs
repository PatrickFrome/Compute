'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEVOS_REPO_READ_MODEL_SCHEMA = 'metaengine.development-plane.repo-read-model.v1';
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_EXPOSED_TEXT_BYTES = 24 * 1024;
const SOURCE_FILES = Object.freeze([
  Object.freeze({ relative_path: 'apps/metaengine-browser/src/main.mjs', language: 'javascript' }),
  Object.freeze({ relative_path: 'apps/metaengine-browser/ui/app.js', language: 'javascript' }),
]);

function zeroAuthorityContract() {
  return {
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  };
}

function exactSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('devos_repo_source_invalid');
  const repository = String(source.repository || '').trim();
  const head = String(source.head || '').toLowerCase();
  const ref = source.ref == null ? null : String(source.ref).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('devos_repo_repository_invalid');
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('devos_repo_head_invalid');
  if (ref != null && (!ref || ref.length > 400 || /[\u0000-\u001f\u007f]/.test(ref))) throw new Error('devos_repo_ref_invalid');
  return { repository, head, ref };
}

async function readCodeFile(repoRoot, descriptor) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, descriptor.relative_path);
  const rel = path.relative(root, absolute);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('devos_repo_source_path_escape');
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error('devos_repo_source_not_file');
  if (stat.size > MAX_FILE_BYTES) throw new Error('devos_repo_source_too_large');
  const bytes = await fs.readFile(absolute);
  const exposed = bytes.subarray(0, MAX_EXPOSED_TEXT_BYTES).toString('utf8');
  return Object.freeze({
    relative_path: descriptor.relative_path,
    language: descriptor.language,
    sha256: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
    bytes: bytes.length,
    truncated: bytes.length > MAX_EXPOSED_TEXT_BYTES,
    text: exposed,
    ...zeroAuthorityContract(),
  });
}

async function createDevOSRepoReadModel({ repoRoot, source }) {
  const root = path.resolve(String(repoRoot || ''));
  if (!root) throw new Error('devos_repo_root_invalid');
  const exact = exactSource(source);
  const codeFiles = [];
  for (const descriptor of SOURCE_FILES) {
    try { codeFiles.push(await readCodeFile(root, descriptor)); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
  }
  return Object.freeze({
    schema: DEVOS_REPO_READ_MODEL_SCHEMA,
    repository: exact.repository,
    head: exact.head,
    ref: exact.ref,
    code_files: Object.freeze(codeFiles),
    code_file_count: codeFiles.length,
    bounded: true,
    max_file_bytes: MAX_FILE_BYTES,
    max_exposed_text_bytes: MAX_EXPOSED_TEXT_BYTES,
    source_files_fixed_by_host: true,
    renderer_path_selection_allowed: false,
    arbitrary_path_read_allowed: false,
    process_spawn_used: false,
    ...zeroAuthorityContract(),
  });
}

module.exports = Object.freeze({
  DEVOS_REPO_READ_MODEL_SCHEMA,
  SOURCE_FILES,
  MAX_FILE_BYTES,
  MAX_EXPOSED_TEXT_BYTES,
  createDevOSRepoReadModel,
});
