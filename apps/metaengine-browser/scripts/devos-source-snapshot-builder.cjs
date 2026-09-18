'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SNAPSHOT_SCHEMA = 'metaengine.devos.packaged-source-snapshot.v1';
const PROVENANCE_FILE = '.metaengine-source-provenance.json';
const FIXED_SOURCE_FILES = Object.freeze([
  'apps/metaengine-browser/src/main.mjs',
  'apps/metaengine-browser/ui/app.js',
]);

async function readGitHead(repoRoot) {
  const gitPath = path.join(repoRoot, '.git');
  const stat = await fs.stat(gitPath);
  let gitDir = gitPath;
  if (stat.isFile()) {
    const marker = (await fs.readFile(gitPath, 'utf8')).trim();
    if (!marker.startsWith('gitdir: ')) throw new Error('source_snapshot_git_pointer_invalid');
    gitDir = path.resolve(repoRoot, marker.slice('gitdir: '.length).trim());
  }
  const headText = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
  if (!headText.startsWith('ref: ')) return { head: headText.toLowerCase(), ref: null };
  const ref = headText.slice(5).trim();
  let head = null;
  try { head = (await fs.readFile(path.join(gitDir, ref), 'utf8')).trim().toLowerCase(); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const packed = (await fs.readFile(path.join(gitDir, 'packed-refs'), 'utf8')).split(/\r?\n/);
    head = packed.find((line) => line.endsWith(` ${ref}`))?.split(' ')[0]?.toLowerCase() || null;
  }
  return { head, ref };
}

function exactProvenance({ repository, head, ref }) {
  const repo = String(repository || '').trim();
  const sha = String(head || '').trim().toLowerCase();
  const sourceRef = ref == null ? null : String(ref).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('source_snapshot_repository_invalid');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('source_snapshot_head_invalid');
  if (sourceRef != null && (!sourceRef || sourceRef.length > 400 || /[\u0000-\u001f\u007f]/.test(sourceRef))) throw new Error('source_snapshot_ref_invalid');
  return { repository: repo, head: sha, ref: sourceRef };
}

async function buildDevOSSourceSnapshot({ repoRoot, outputDir, repository = 'PatrickFrome/Compute', head = null, ref = null } = {}) {
  const root = path.resolve(String(repoRoot || ''));
  const out = path.resolve(String(outputDir || ''));
  if (!root || !out || root === out) throw new Error('source_snapshot_paths_invalid');
  const git = head ? { head, ref } : await readGitHead(root);
  const provenance = exactProvenance({ repository, head: git.head, ref: ref ?? git.ref });
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  const copied = [];
  for (const relativePath of FIXED_SOURCE_FILES) {
    const source = path.resolve(root, relativePath);
    const relative = path.relative(root, source);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('source_snapshot_path_escape');
    const target = path.resolve(out, relativePath);
    const targetRelative = path.relative(out, target);
    if (!targetRelative || targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) throw new Error('source_snapshot_output_escape');
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error(`source_snapshot_file_missing:${relativePath}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    copied.push(relativePath);
  }
  const manifest = Object.freeze({
    schema: SNAPSHOT_SCHEMA,
    ...provenance,
    source_files: copied,
    source_file_count: copied.length,
    bounded: true,
    arbitrary_path_copy: false,
    process_spawn_used: false,
    authority_effect: false,
  });
  await fs.writeFile(path.join(out, PROVENANCE_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

module.exports = Object.freeze({
  SNAPSHOT_SCHEMA,
  PROVENANCE_FILE,
  FIXED_SOURCE_FILES,
  buildDevOSSourceSnapshot,
});
