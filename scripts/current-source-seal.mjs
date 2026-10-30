// Prepare the existing current-source seal from reviewed, committed bytes.
// This never edits the checkout, historical ledgers, versions or authority flags.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CURRENT_SEAL_PATH = 'coordination/operator-control/client-critical-closure.manifest.json';
const sha = /^[0-9a-f]{40}$/;
const fail = reason => { throw new Error('current_source_seal_' + reason); };
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function git(root, args, input) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', input, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
function safePath(file) {
  if (typeof file !== 'string' || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file) ||
      file.split('/').some(part => part === '.' || part === '..' || part.toLowerCase() === '.git') ||
      file === CURRENT_SEAL_PATH) fail('invalid_or_self_referencing_path');
  return file;
}
function cleanHead(root, sourceSha) {
  if (!sha.test(sourceSha) || git(root, ['rev-parse', 'HEAD']).trim() !== sourceSha) fail('exact_source_required');
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=no']).trim()) fail('tracked_source_dirty');
}

export function inspectCurrentSourceSeal({ root, sourceSha, includePaths = [] }) {
  cleanHead(root, sourceSha);
  const previousBytes = git(root, ['show', sourceSha + ':' + CURRENT_SEAL_PATH]);
  const previousManifestBlob = git(root, ['rev-parse', sourceSha + ':' + CURRENT_SEAL_PATH]).trim();
  const manifest = JSON.parse(previousBytes);
  if (manifest.schema !== 'metaengine.client.critical-closure.v1' ||
      manifest.repository !== 'PatrickFrome/Compute' || !manifest.current_tree_blobs ||
      typeof manifest.current_tree_blobs !== 'object' || Array.isArray(manifest.current_tree_blobs) ||
      Object.keys(manifest.current_tree_blobs).length === 0) fail('manifest_schema');
  const tree = new Map(git(root, ['ls-tree', '-r', '-z', sourceSha]).split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(row);
    if (!match) fail('tree_encoding');
    return [match[4], { mode: match[1], kind: match[2], blob: match[3] }];
  }));
  const added = includePaths.map(safePath);
  if (new Set(added).size !== added.length) fail('duplicate_include');
  const files = [...new Set([...Object.keys(manifest.current_tree_blobs), ...added])].sort();
  const current = {};
  const delta = [];
  for (const file of files) {
    safePath(file);
    const before = manifest.current_tree_blobs[file] ?? null;
    if (before !== null && !sha.test(before)) fail('invalid_previous_blob');
    const entry = tree.get(file);
    // Removal requires a separate reviewed contract change, never shrinking the seal here.
    if (!entry || entry.kind !== 'blob' || !['100644', '100755'].includes(entry.mode)) fail('missing_or_nonregular_source:' + file);
    current[file] = entry.blob;
    if (before !== entry.blob) delta.push({ path: file, previous_blob: before, current_blob: entry.blob });
  }
  // Git's clean filters preserve canonical identity on a real CRLF checkout.
  const worktree = git(root, ['hash-object', '--stdin-paths'], files.join('\n') + '\n').trim().split(/\r?\n/);
  if (worktree.length !== files.length || files.some((file, i) => worktree[i] !== current[file])) fail('worktree_bytes_changed');
  cleanHead(root, sourceSha);
  return {
    review: { schema: 'metaengine.reviewed-current-source-seal-delta.v1',
      functional_source: sourceSha, previous_manifest_blob: previousManifestBlob, changes: delta },
    manifest: { ...manifest, current_tree_blobs: current },
  };
}

export function prepareCurrentSourceSeal({ root, sourceSha, reviewedDelta, outputDir }) {
  if (!reviewedDelta || !Array.isArray(reviewedDelta.changes)) fail('review_required');
  const includePaths = reviewedDelta.changes.filter(row => row?.previous_blob === null).map(row => row.path);
  const candidate = inspectCurrentSourceSeal({ root, sourceSha, includePaths });
  // Compare full exact evidence, including both blob identities and the source commit.
  // Missing, stale, extra, reordered or duplicate review rows are not approval.
  if (JSON.stringify(reviewedDelta) !== JSON.stringify(candidate.review)) fail('review_delta_mismatch');
  if (candidate.review.changes.length === 0) fail('no_new_seal');
  const output = path.resolve(outputDir);
  const repository = fs.realpathSync(root);
  const relative = path.relative(repository, output);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) fail('output_must_be_outside_checkout');
  const parent = path.dirname(output);
  if (fs.realpathSync(parent).toLowerCase() !== parent.toLowerCase()) fail('output_parent_reparse');
  const manifestBytes = json(candidate.manifest);
  const changes = candidate.review.changes;
  const receipt = {
    schema: 'metaengine.reviewed-current-source-seal-refresh.v1',
    functional_source: sourceSha,
    previous_manifest_blob: candidate.review.previous_manifest_blob,
    current_manifest_sha256: hash(manifestBytes),
    updated_existing_paths: changes.filter(row => row.previous_blob !== null).map(row => row.path),
    newly_sealed_paths: changes.filter(row => row.previous_blob === null).map(row => row.path),
    reviewed_changes: changes,
    total_sealed_files: Object.keys(candidate.manifest.current_tree_blobs).length,
    all_non_blob_manifest_fields_unchanged: true,
    package_version_changed: false,
    qualification_promoted: false,
    authority_effect: false,
    validation: 'PENDING_FINAL_COMMIT_TESTS_AND_EXACT_HEAD_CI',
  };
  // A new directory and exclusive writes preserve every previous candidate.
  fs.mkdirSync(output);
  for (const [name, bytes] of [['client-critical-closure.manifest.json', manifestBytes], ['source-seal-refresh.json', json(receipt)]]) {
    const target = path.join(output, name);
    fs.writeFileSync(target, bytes, { flag: 'wx' });
    if (fs.readFileSync(target, 'utf8') !== bytes) fail('output_readback');
  }
  cleanHead(root, sourceSha);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const options = new Map();
    const includePaths = [];
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i], value = args[i + 1];
      if (!value || !['--source-sha', '--review', '--output', '--include'].includes(key)) fail('arguments');
      if (key === '--include') includePaths.push(value);
      else { if (options.has(key)) fail('duplicate_argument'); options.set(key, value); }
    }
    const root = fileURLToPath(new URL('../', import.meta.url));
    const sourceSha = options.get('--source-sha');
    let result;
    if (command === 'inspect' && !options.has('--review') && !options.has('--output')) {
      result = inspectCurrentSourceSeal({ root, sourceSha, includePaths }).review;
    } else if (command === 'prepare' && !includePaths.length && options.has('--review') && options.has('--output')) {
      result = prepareCurrentSourceSeal({ root, sourceSha,
        reviewedDelta: JSON.parse(fs.readFileSync(options.get('--review'), 'utf8').replace(/^\uFEFF/, '')),
        outputDir: options.get('--output') });
    } else fail('arguments');
    process.stdout.write(json(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
