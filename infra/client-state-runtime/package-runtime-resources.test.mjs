import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { sourceClosure } from './startup-source-manifest.mjs';
import {
  BUNDLE_ENTRY_POINTS, BUNDLE_MANIFEST_FILE, BUNDLE_SCHEMA, RUNTIME_HOST_ENTRY, FIRST_RUN_INITDB_ENTRY, REMOTE_SUPPORT_ENTRY,
  reviewedBundlePlan, stageRuntimeSourceBundle, verifyRuntimeSourceBundle,
} from './package-runtime-resources.mjs';

const repositoryRoot = await realpath(fileURLToPath(new URL('../..', import.meta.url)));
const runtimeRoot = 'infra/client-state-runtime/';
const packageRoot = runtimeRoot + 'node_modules/postgres/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(sep).join('/');

async function files(root) {
  const result = [];
  const walk = async current => {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isDirectory()) await walk(path);
      else result.push(slash(relative(root, path)));
    }
  };
  await walk(root);
  return result.sort();
}

function refreshDigest(manifest) {
  const digest = hash(JSON.stringify({ files: manifest.source.files, policy: manifest.source.policy }));
  manifest.source.manifest_sha256 = digest;
  manifest.source_manifest_sha256 = digest;
  return digest;
}

async function receipt(root, { includeRuntimeHost = false } = {}) {
  const entries = includeRuntimeHost ? [...BUNDLE_ENTRY_POINTS, RUNTIME_HOST_ENTRY, FIRST_RUN_INITDB_ENTRY, REMOTE_SUPPORT_ENTRY] : BUNDLE_ENTRY_POINTS;
  const closure = await sourceClosure(entries.map(name => join(root, name)), root);
  const records = [];
  const add = async (path, id, kind) => {
    const bytes = await readFile(join(root, path));
    records.push({ id, kind, bytes: bytes.length, sha256: hash(bytes) });
  };
  for (const path of closure.files) await add(slash(relative(root, path)), 'repository/' + slash(relative(root, path)), 'source');
  for (const name of ['package.json', 'package-lock.json', 'deno.lock']) await add(runtimeRoot + name, 'repository/' + runtimeRoot + name, 'dependency_lock');
  for (const path of await files(join(root, packageRoot))) await add(packageRoot + path, 'node_npm/postgres@3.4.7/' + path, 'dependency');
  for (const name of ['node', 'deno', 'postgres', 'psql']) records.push({ id: 'binary/' + name, kind: 'binary', bytes: 128 * 1024 * 1024, sha256: hash('x') });
  records.push({ id: 'deno_npm/postgres@3.4.7/package.json', kind: 'dependency', bytes: 1, sha256: hash('x') });
  const manifest = {
    schema: 'compute.runtime-startup-manifest.v1', stable_during_startup: true, private_material_included: false,
    source: {
      schema: 'compute.runtime-source-snapshot.v1',
      files: records.sort((a, b) => a.id.localeCompare(b.id, 'en')),
      policy: { mode: 'LOCAL_POSTGRES', dependency_policy: 'FROZEN_LOCKFILE_AND_CACHED_ONLY', address: '127.0.0.1',
        automatic_cloud_fallback: false, credentials_included: false, private_config_included: false },
    },
  };
  refreshDigest(manifest);
  return manifest;
}

async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'compute-bundle-test-')));
  const repository = join(root, 'repository');
  const stage = join(root, 'stage');
  await mkdir(repository);
  await mkdir(stage);
  try {
    const closure = await sourceClosure(BUNDLE_ENTRY_POINTS.map(name => join(repositoryRoot, name)), repositoryRoot);
    const names = [...closure.files.map(path => slash(relative(repositoryRoot, path))),
      ...['package.json', 'package-lock.json', 'deno.lock'].map(name => runtimeRoot + name),
      ...(await files(join(repositoryRoot, packageRoot))).map(name => packageRoot + name)];
    for (const name of names) {
      await mkdir(dirname(join(repository, name)), { recursive: true });
      await copyFile(join(repositoryRoot, name), join(repository, name));
    }
    const manifest = await receipt(repository);
    const options = { repositoryRoot: repository, stagingDirectory: stage, startupManifest: manifest, expectedSourceDigest: manifest.source_manifest_sha256 };
    await run({ root, repository, stage, manifest, options });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('reviewed source bundle is deterministic, complete and omits runtime/private material', async () => {
  await fixture(async ({ root, repository, stage, options }) => {
    await writeFile(join(repository, 'private-config.json'), 'not-selected');
    await mkdir(join(repository, 'backups'));
    await writeFile(join(repository, 'backups', 'database.dump'), 'not-selected');
    const first = await stageRuntimeSourceBundle(options);
    assert.equal(first.schema, BUNDLE_SCHEMA);
    assert.equal(first.policy.database_included, false);
    assert.equal(first.policy.binary_runtime_included, false);
    assert.equal(first.policy.provider_bootstrap_included, false);
    assert.equal(first.policy.installed_client_qualified, false);
    assert.equal(first.policy.publisher_release_authority, false);
    assert.equal(first.policy.authority_effect, false);
    assert.deepEqual(first.entry_points, [...BUNDLE_ENTRY_POINTS]);
    assert.ok(first.files.some(file => file.path === packageRoot + 'src/index.js'));
    assert.ok(first.files.some(file => file.path === runtimeRoot + 'startup-source-manifest.mjs'));
    const secondStage = join(root, 'stage-2');
    await mkdir(secondStage);
    const second = await stageRuntimeSourceBundle({ ...options, stagingDirectory: secondStage });
    assert.deepEqual(first, second);
    assert.equal(await readFile(join(stage, BUNDLE_MANIFEST_FILE), 'utf8'), await readFile(join(secondStage, BUNDLE_MANIFEST_FILE), 'utf8'));
    const text = JSON.stringify(first);
    assert.equal(text.includes(repository), false);
    assert.equal(text.includes('private-config'), false);
    assert.equal(text.includes('binary/node'), false);
    assert.equal((await files(stage)).some(name => name.includes('dump')), false);
    assert.deepEqual(await verifyRuntimeSourceBundle({ ...options, expectedBundleDigest: first.bundle_sha256 }), first);
  });
});

test('reviewed runtime host source is included only by explicit host selection', async () => {
  await fixture(async ({ repository, stage, options }) => {
    await writeFile(join(repository, RUNTIME_HOST_ENTRY), "import './launcher.mjs'; export const host = true;\n");
    await writeFile(join(repository, FIRST_RUN_INITDB_ENTRY), "export const firstRun = true;\n");
    await writeFile(join(repository, REMOTE_SUPPORT_ENTRY), "import './windows-local-computer-executor.mjs'; export const remoteSupport = true;\n");
    await writeFile(join(repository, 'apps/metaengine-browser/src/windows-local-computer-executor.mjs'), "import './computer-authority-plane.mjs'; export const executor = true;\n");
    await writeFile(join(repository, 'apps/metaengine-browser/src/computer-authority-plane.mjs'), "export const authority = true;\n");
    const manifest = await receipt(repository, { includeRuntimeHost: true });
    const hostOptions = { ...options, startupManifest: manifest, expectedSourceDigest: manifest.source_manifest_sha256 };
    await assert.rejects(stageRuntimeSourceBundle(hostOptions), /reviewed_source_closure_mismatch|bundle_unexpected_source_record/);
    const bundle = await stageRuntimeSourceBundle({ ...hostOptions, includeRuntimeHost: true });
    assert.deepEqual(bundle.entry_points, [...BUNDLE_ENTRY_POINTS, RUNTIME_HOST_ENTRY, FIRST_RUN_INITDB_ENTRY, REMOTE_SUPPORT_ENTRY]);
    assert.ok(bundle.files.some(file => file.path === RUNTIME_HOST_ENTRY));
    assert.ok(bundle.files.some(file => file.path === FIRST_RUN_INITDB_ENTRY));
    assert.ok(bundle.files.some(file => file.path === REMOTE_SUPPORT_ENTRY));
    assert.ok(bundle.files.some(file => file.path === 'apps/metaengine-browser/src/windows-local-computer-executor.mjs'));
    assert.ok(bundle.files.some(file => file.path === 'apps/metaengine-browser/src/computer-authority-plane.mjs'));
    const unreviewed = structuredClone(manifest);
    unreviewed.source.files.push({
      id: 'repository/apps/metaengine-browser/src/unreviewed-control.mjs',
      kind: 'source', bytes: 0, sha256: hash(''),
    });
    assert.throws(() => reviewedBundlePlan(unreviewed, refreshDigest(unreviewed), { includeRuntimeHost: true }),
      /bundle_unexpected_source_record/);
    assert.deepEqual(await verifyRuntimeSourceBundle({ ...hostOptions, includeRuntimeHost: true, expectedBundleDigest: bundle.bundle_sha256 }), bundle);
    await assert.rejects(verifyRuntimeSourceBundle({ ...hostOptions, expectedBundleDigest: bundle.bundle_sha256 }), /expected_digest_mismatch/);
  });
});

test('staged launcher and API import without checkout resolution, process startup or network', async () => {
  await fixture(async ({ root, stage, options }) => {
    await stageRuntimeSourceBundle(options);
    const code = `const launcher=await import(${JSON.stringify(pathToFileURL(join(stage, BUNDLE_ENTRY_POINTS[0])).href)});`
      + `const api=await import(${JSON.stringify(pathToFileURL(join(stage, BUNDLE_ENTRY_POINTS[1])).href)});`
      + `if(typeof launcher.normalizeLauncherConfig!=='function'||typeof api.startDbApi!=='function')throw Error('exports_missing');`
      + `console.log(JSON.stringify({ok:true,launch_executed:false,database_started:false}));`;
    const environment = { ...process.env };
    for (const name of Object.keys(environment)) if (/^(?:NODE_OPTIONS|NODE_PATH|LOCAL_STATE_|SUPABASE_|PG|GH_TOKEN|GITHUB_TOKEN)/i.test(name)) delete environment[name];
    const output = await new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('staged_import_timeout')); }, 10000);
      child.stdout.on('data', bytes => { stdout += bytes; });
      child.stderr.on('data', bytes => { stderr += bytes; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolvePromise(stdout) : reject(new Error('staged_import_failed:' + stderr)); });
    });
    assert.deepEqual(JSON.parse(output), { ok: true, launch_executed: false, database_started: false });
  });
});

test('review identity and frozen non-private startup policy must be explicit', async t => {
  await fixture(async ({ manifest, options, stage }) => {
    for (const [label, mutate, expected] of [
      ['missing pinned digest', () => ({ ...options, expectedSourceDigest: undefined }), /explicit_review_digest/],
      ['different pinned digest', () => ({ ...options, expectedSourceDigest: '0'.repeat(64) }), /review_digest_mismatch/],
      ['changed receipt bytes', () => { const m = structuredClone(manifest); m.source.files[0].bytes++; return { ...options, startupManifest: m }; }, /review_digest_mismatch/],
      ['unstable launch', () => ({ ...options, startupManifest: { ...manifest, stable_during_startup: false } }), /reviewed_startup_receipt/],
      ['private receipt', () => ({ ...options, startupManifest: { ...manifest, private_material_included: true } }), /reviewed_startup_receipt/],
      ['cloud fallback', () => { const m = structuredClone(manifest); m.source.policy.automatic_cloud_fallback = true; return { ...options, startupManifest: m, expectedSourceDigest: refreshDigest(m) }; }, /review_policy_invalid/],
      ['fixture launch policy', () => { const m = structuredClone(manifest); m.source.policy.dependency_policy = 'FIXTURE_COMMANDS'; return { ...options, startupManifest: m, expectedSourceDigest: refreshDigest(m) }; }, /review_policy_invalid/],
    ]) await t.test(label, async () => {
      await assert.rejects(stageRuntimeSourceBundle(mutate()), expected);
      assert.deepEqual(await readdir(stage), []);
    });
  });
});

test('manifest paths, exact closure, duplicate records and unexpected resources fail closed', async t => {
  await fixture(async ({ manifest, options, stage }) => {
    for (const [label, mutate, expected] of [
      ['private source', m => { m.source.files.push({ id: 'repository/infra/client-state-runtime/private.mjs', kind: 'source', bytes: 0, sha256: hash('') }); }, /private_path_forbidden/],
      ['dump resource', m => { m.source.files.push({ id: 'repository/database.dump', kind: 'source', bytes: 0, sha256: hash('') }); }, /unexpected_source_record/],
      ['path traversal', m => { m.source.files[0].id = 'repository/../outside.mjs'; }, /path_invalid/],
      ['absolute path', m => { m.source.files[0].id = '/repository/outside.mjs'; }, /path_invalid/],
      ['duplicate entry', m => { m.source.files.push(m.source.files[0]); }, /duplicate_source_record/],
      ['missing entry point', m => { m.source.files = m.source.files.filter(file => file.id !== 'repository/' + BUNDLE_ENTRY_POINTS[0]); }, /required_resource_missing/],
      ['missing imported module', m => { m.source.files = m.source.files.filter(file => file.id !== 'repository/' + runtimeRoot + 'startup-source-manifest.mjs'); }, /source_closure_mismatch/],
      ['unexpected binary', m => { m.source.files.push({ id: 'binary/unknown', kind: 'binary', bytes: 0, sha256: hash('') }); }, /unexpected_source_record/],
      ['provider bootstrap outside bundle scope', m => { m.source.files.push({ id: 'repository/apps/metaengine-browser/src/local-state-provider-bootstrap.mjs', kind: 'source', bytes: 0, sha256: hash('') }); }, /unexpected_source_record/],
      ['oversized bundle', m => { for (let n = 0; n < 5; n++) m.source.files.push({ id: `node_npm/postgres@3.4.7/large-${n}.js`, kind: 'dependency', bytes: 16 * 1024 * 1024, sha256: hash('') }); }, /total_size_limit/],
    ]) await t.test(label, async () => {
      const m = structuredClone(manifest); mutate(m);
      await assert.rejects(stageRuntimeSourceBundle({ ...options, startupManifest: m, expectedSourceDigest: refreshDigest(m) }), expected);
      assert.deepEqual(await readdir(stage), []);
    });
    const m = structuredClone(manifest);
    m.source.files.push({ id: 'node_npm/postgres@3.4.7/README.MD', kind: 'dependency', bytes: 0, sha256: hash('') });
    assert.throws(() => reviewedBundlePlan(m, refreshDigest(m)), /case_path_collision/);
  });
});

test('stage must be empty, canonical, absolute and outside the checkout', async () => {
  await fixture(async ({ root, repository, stage, options }) => {
    await assert.rejects(stageRuntimeSourceBundle({ ...options, stagingDirectory: 'stage' }), /absolute_directory_required/);
    const internal = join(repository, 'stage'); await mkdir(internal);
    await assert.rejects(stageRuntimeSourceBundle({ ...options, stagingDirectory: internal }), /external_stage_required/);
    await writeFile(join(stage, 'existing.txt'), 'preserve');
    await assert.rejects(stageRuntimeSourceBundle(options), /empty_stage_required/);
    assert.equal(await readFile(join(stage, 'existing.txt'), 'utf8'), 'preserve');
    const alias = join(root, 'repository-alias');
    await symlink(repository, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(stageRuntimeSourceBundle({ ...options, repositoryRoot: alias }), /directory_invalid|alias_path_forbidden/);
  });
});

test('unreviewed dependency bytes and files are rejected before stage writes', async () => {
  await fixture(async ({ repository, stage, options }) => {
    const path = join(repository, packageRoot, 'extra.js');
    await writeFile(path, 'export {};');
    await assert.rejects(stageRuntimeSourceBundle(options), /unreviewed_dependency_file/);
    assert.deepEqual(await readdir(stage), []);
    await rm(path);
    await writeFile(join(repository, runtimeRoot, 'db-api.mjs'), '// changed\n');
    await assert.rejects(stageRuntimeSourceBundle(options), /source_closure_mismatch|reviewed_file_digest_mismatch/);
    assert.deepEqual(await readdir(stage), []);
  });
});

test('dependency contract does not accept another version even with reviewed byte hashes', async () => {
  await fixture(async ({ repository, stage, options }) => {
    const packagePath = join(repository, packageRoot, 'package.json');
    const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
    metadata.version = '3.4.8';
    await writeFile(packagePath, JSON.stringify(metadata));
    const manifest = await receipt(repository);
    await assert.rejects(stageRuntimeSourceBundle({ ...options, startupManifest: manifest, expectedSourceDigest: manifest.source_manifest_sha256 }), /frozen_dependency_contract_invalid/);
    assert.deepEqual(await readdir(stage), []);
  });
});

test('alias source paths, dependency junctions and hardlinks are not copied', async t => {
  await t.test('source hardlink', async () => fixture(async ({ root, repository, options }) => {
    await link(join(repository, BUNDLE_ENTRY_POINTS[0]), join(root, 'linked-launcher.mjs'));
    await assert.rejects(stageRuntimeSourceBundle(options), /regular_file_required/);
  }));
  await t.test('dependency junction', async () => fixture(async ({ root, repository, options }) => {
    const target = join(root, 'external'); await mkdir(target);
    await symlink(target, join(repository, packageRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(stageRuntimeSourceBundle(options), /alias_path_forbidden/);
  }));
});

test('known private literals never enter a reviewed source bundle', async () => {
  await fixture(async ({ repository, stage, options }) => {
    const source = join(repository, runtimeRoot, 'db-api.mjs');
    await writeFile(source, await readFile(source, 'utf8') + `\nexport const accidentallyPrivate = ${JSON.stringify('ghp_' + 'x'.repeat(30))};\n`);
    const manifest = await receipt(repository);
    await assert.rejects(stageRuntimeSourceBundle({ ...options, startupManifest: manifest, expectedSourceDigest: manifest.source_manifest_sha256 }), /private_literal_forbidden/);
    assert.deepEqual(await readdir(stage), []);
  });
});

test('verification rejects drift, injected files, edited manifests and absent pinned digest', async () => {
  await fixture(async ({ stage, options }) => {
    const manifest = await stageRuntimeSourceBundle(options);
    const verifyOptions = { ...options, expectedBundleDigest: manifest.bundle_sha256 };
    await assert.rejects(verifyRuntimeSourceBundle({ ...verifyOptions, expectedBundleDigest: undefined }), /explicit_bundle_digest/);
    await assert.rejects(verifyRuntimeSourceBundle({ ...verifyOptions, expectedBundleDigest: '0'.repeat(64) }), /expected_digest_mismatch/);
    const source = join(stage, BUNDLE_ENTRY_POINTS[0]);
    const original = await readFile(source);
    await writeFile(source, '// altered');
    await assert.rejects(verifyRuntimeSourceBundle(verifyOptions), /staged_file_digest_mismatch/);
    await writeFile(source, original);
    const injected = join(stage, 'private-config.json'); await writeFile(injected, '{}');
    await assert.rejects(verifyRuntimeSourceBundle(verifyOptions), /private_path_forbidden|unexpected_staged_file/);
    await rm(injected);
    const receiptPath = join(stage, BUNDLE_MANIFEST_FILE);
    const changed = structuredClone(manifest); changed.policy.installed_client_qualified = true;
    await writeFile(receiptPath, JSON.stringify(changed));
    await assert.rejects(verifyRuntimeSourceBundle(verifyOptions), /manifest_mismatch/);
  });
});

test('selected runtime bundle includes the full real first-run source closure', async () => {
  const closure = await sourceClosure([...BUNDLE_ENTRY_POINTS, RUNTIME_HOST_ENTRY, FIRST_RUN_INITDB_ENTRY, REMOTE_SUPPORT_ENTRY].map(name => join(repositoryRoot, name)), repositoryRoot);
  const names = new Set(closure.files.map(file => slash(relative(repositoryRoot, file))));
  for (const file of [FIRST_RUN_INITDB_ENTRY, 'infra/client-state-runtime/first-run-preflight.mjs', 'infra/client-state-runtime/local-vault-key.mjs', 'infra/client-state-runtime/offline-runtime-bundle.mjs', REMOTE_SUPPORT_ENTRY, 'apps/metaengine-browser/src/windows-local-computer-executor.mjs', 'apps/metaengine-browser/src/computer-authority-plane.mjs', 'apps/metaengine-browser/src/local-state-provider-policy.mjs', 'apps/metaengine-browser/src/local-runtime-host-controller.mjs', 'infra/client-state-runtime/restored-client-provider-cli.mjs', 'infra/client-state-runtime/restored-client-provider.mjs']) assert.ok(names.has(file), 'missing first-run dependency: ' + file);
  assert.ok(closure.npm.includes('npm:postgres@3.4.7'));
});
