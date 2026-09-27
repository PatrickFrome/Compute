import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

export const PROVENANCE_SCHEMA = 'metaengine.browser.installer-provenance.v1';
export const RESOLUTION_SCHEMA = 'metaengine.browser.installer-provenance-resolution.v1';
export const ACQUIRE_SCHEMA = 'metaengine.browser.installer-provenance-acquire.v1';

const SHA40_RE = /^[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export class InstallerProvenanceError extends Error {
  constructor(code, details = null) {
    super(code);
    this.name = 'InstallerProvenanceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details = null) {
  throw new InstallerProvenanceError(code, details);
}

function boundedInteger(value, { min, max, code }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(code, { value });
  return n;
}

function requireText(value, code, max = 512) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) fail(code);
  return text;
}

function normalizeHead(value) {
  const head = requireText(value, 'installer_provenance_head_missing', 64).toLowerCase();
  if (!SHA40_RE.test(head)) fail('installer_provenance_head_invalid', { head });
  return head;
}

function normalizeRepository(value) {
  const repository = requireText(value, 'installer_provenance_repository_missing', 256);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    fail('installer_provenance_repository_invalid', { repository });
  }
  return repository;
}

async function hashFile(filePath) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) fail('installer_provenance_asset_missing', { file: filePath });
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return Object.freeze({
    name: path.basename(filePath),
    sha256: hash.digest('hex'),
    bytes: info.size,
  });
}

function validateAsset(asset, label) {
  if (!asset || typeof asset !== 'object') fail('installer_provenance_asset_invalid', { label });
  const name = requireText(asset.name, 'installer_provenance_asset_name_invalid', 260);
  if (name !== path.basename(name) || name.includes('/') || name.includes('\\')) {
    fail('installer_provenance_asset_name_unsafe', { label, name });
  }
  const sha256 = String(asset.sha256 ?? '').toLowerCase();
  if (!SHA256_RE.test(sha256)) fail('installer_provenance_asset_sha_invalid', { label });
  const bytes = boundedInteger(asset.bytes, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    code: 'installer_provenance_asset_size_invalid',
  });
  return Object.freeze({ name, sha256, bytes });
}

export function validateProvenance(raw, { expectedHead = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('installer_provenance_invalid');
  if (raw.schema !== PROVENANCE_SCHEMA) fail('installer_provenance_schema_invalid');
  const sourceHead = normalizeHead(raw.source_head);
  if (expectedHead != null && sourceHead !== normalizeHead(expectedHead)) {
    fail('installer_provenance_head_mismatch', { expected: normalizeHead(expectedHead), actual: sourceHead });
  }
  const repository = normalizeRepository(raw.repository);
  const producerRunId = boundedInteger(raw.producer_run_id, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    code: 'installer_provenance_run_id_invalid',
  });
  const artifactName = requireText(raw.artifact_name, 'installer_provenance_artifact_name_invalid', 260);
  const packageVersion = requireText(raw.package_version, 'installer_provenance_package_version_invalid', 128);
  if (!/^[0-9A-Za-z.+-]+$/.test(packageVersion)) fail('installer_provenance_package_version_invalid');
  if (raw.signed !== false || raw.published !== false || raw.promotion_authorized !== false || raw.authority_effect !== false) {
    fail('installer_provenance_authority_invalid');
  }
  return Object.freeze({
    schema: PROVENANCE_SCHEMA,
    source_head: sourceHead,
    producer_run_id: producerRunId,
    repository,
    artifact_name: artifactName,
    package_version: packageVersion,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : null,
    files: Object.freeze({
      installer: validateAsset(raw.files?.installer, 'installer'),
      blockmap: validateAsset(raw.files?.blockmap, 'blockmap'),
      config: validateAsset(raw.files?.config, 'config'),
    }),
    signed: false,
    published: false,
    promotion_authorized: false,
    authority_effect: false,
  });
}

export async function writeProvenance({
  output,
  sourceHead,
  producerRunId,
  repository,
  artifactName,
  packageVersion,
  installer,
  blockmap,
  config,
}) {
  const normalizedHead = normalizeHead(sourceHead);
  const normalizedRepo = normalizeRepository(repository);
  const runId = boundedInteger(producerRunId, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    code: 'installer_provenance_run_id_invalid',
  });
  const normalizedArtifact = requireText(artifactName, 'installer_provenance_artifact_name_invalid', 260);
  const normalizedPackageVersion = requireText(packageVersion, 'installer_provenance_package_version_invalid', 128);
  if (!/^[0-9A-Za-z.+-]+$/.test(normalizedPackageVersion)) fail('installer_provenance_package_version_invalid');
  const [installerAsset, blockmapAsset, configAsset] = await Promise.all([
    hashFile(installer),
    hashFile(blockmap),
    hashFile(config),
  ]);
  const row = Object.freeze({
    schema: PROVENANCE_SCHEMA,
    source_head: normalizedHead,
    producer_run_id: runId,
    repository: normalizedRepo,
    artifact_name: normalizedArtifact,
    package_version: normalizedPackageVersion,
    created_at: new Date().toISOString(),
    files: Object.freeze({
      installer: installerAsset,
      blockmap: blockmapAsset,
      config: configAsset,
    }),
    signed: false,
    published: false,
    promotion_authorized: false,
    authority_effect: false,
  });
  const outputPath = path.resolve(requireText(output, 'installer_provenance_output_missing', 4096));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  return row;
}

export async function readProvenance(filePath, options = {}) {
  const raw = JSON.parse(await readFile(filePath, 'utf8'));
  return validateProvenance(raw, options);
}

export async function verifyProvenance({ provenance, root, expectedHead = null }) {
  const row = await readProvenance(provenance, { expectedHead });
  const rootPath = path.resolve(requireText(root, 'installer_provenance_root_missing', 4096));
  const verified = {};
  for (const [label, asset] of Object.entries(row.files)) {
    const actual = await hashFile(path.join(rootPath, asset.name));
    if (actual.bytes !== asset.bytes) {
      fail('size_mismatch', { label, expected: asset.bytes, actual: actual.bytes });
    }
    if (actual.sha256 !== asset.sha256) {
      fail('sha_mismatch', { label, expected: asset.sha256, actual: actual.sha256 });
    }
    verified[label] = actual;
  }
  return Object.freeze({
    schema: 'metaengine.browser.installer-provenance-verification.v1',
    source_head: row.source_head,
    producer_run_id: row.producer_run_id,
    repository: row.repository,
    artifact_name: row.artifact_name,
    package_version: row.package_version,
    files: Object.freeze(verified),
    exact_bytes_verified: true,
    authority_effect: false,
  });
}

function githubHeaders(token) {
  const value = requireText(token, 'installer_provenance_github_token_missing', 4096);
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${value}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'metaengine-installer-provenance-v1',
  };
}

async function fetchJson(url, { token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: githubHeaders(token), redirect: 'follow' });
  if (!response?.ok) {
    fail('installer_provenance_github_http_error', { status: response?.status ?? null, url: String(url) });
  }
  return response.json();
}

export async function resolveProducerArtifact({
  repository,
  sourceHead,
  token,
  workflow = 'browser-windows-package-smoke.yml',
  artifactName = null,
  apiBase = 'https://api.github.com',
  fetchImpl = fetch,
}) {
  const normalizedRepo = normalizeRepository(repository);
  const head = normalizeHead(sourceHead);
  const workflowName = requireText(workflow, 'installer_provenance_workflow_invalid', 260);
  const expectedArtifact = artifactName || `metaengine-browser-windows-candidate-${head}`;
  const base = requireText(apiBase, 'installer_provenance_api_base_invalid', 2048).replace(/\/$/, '');
  const runsUrl = new URL(`${base}/repos/${normalizedRepo}/actions/workflows/${encodeURIComponent(workflowName)}/runs`);
  runsUrl.searchParams.set('head_sha', head);
  runsUrl.searchParams.set('per_page', '100');
  const body = await fetchJson(runsUrl, { token, fetchImpl });
  const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
  const candidates = runs
    .filter((run) => String(run?.head_sha || '').toLowerCase() === head)
    .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
  if (candidates.length === 0) {
    return Object.freeze({ schema: RESOLUTION_SCHEMA, state: 'ABSENT', source_head: head, authority_effect: false });
  }
  // The first successful exact-head producer is canonical. Choosing the
  // newest success would allow late reruns to make different consumers qualify
  // different installer bytes for the same source head.
  const successful = candidates
    .filter((run) => run?.status === 'completed' && run?.conclusion === 'success')
    .sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0))[0] ?? null;
  const active = candidates.find((run) => run?.status !== 'completed');
  const run = successful || active || candidates[0];
  const runId = boundedInteger(run.id, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    code: 'installer_provenance_run_id_invalid',
  });
  if (!successful && active) {
    return Object.freeze({
      schema: RESOLUTION_SCHEMA,
      state: 'PENDING',
      source_head: head,
      run_id: runId,
      run_status: run.status ?? null,
      authority_effect: false,
    });
  }
  if (!successful) {
    fail('installer_provenance_producer_failed', { run_id: runId, conclusion: run.conclusion ?? null });
  }
  const artifacts = await fetchJson(
    `${base}/repos/${normalizedRepo}/actions/runs/${runId}/artifacts?per_page=100`,
    { token, fetchImpl },
  );
  const matches = (Array.isArray(artifacts?.artifacts) ? artifacts.artifacts : [])
    .filter((artifact) => artifact?.name === expectedArtifact && artifact?.expired !== true);
  if (matches.length > 1) {
    fail('installer_provenance_artifact_ambiguous', {
      run_id: runId,
      artifact_name: expectedArtifact,
      matches: matches.length,
    });
  }
  if (matches.length === 0) {
    return Object.freeze({
      schema: RESOLUTION_SCHEMA,
      state: 'ARTIFACT_PENDING',
      source_head: head,
      run_id: runId,
      artifact_name: expectedArtifact,
      authority_effect: false,
    });
  }
  const artifactId = boundedInteger(matches[0].id, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    code: 'installer_provenance_artifact_id_invalid',
  });
  return Object.freeze({
    schema: RESOLUTION_SCHEMA,
    state: 'READY',
    source_head: head,
    run_id: runId,
    artifact_id: artifactId,
    artifact_name: expectedArtifact,
    authority_effect: false,
  });
}

export async function downloadArtifact({
  repository,
  artifactId,
  token,
  output,
  apiBase = 'https://api.github.com',
  fetchImpl = fetch,
}) {
  const normalizedRepo = normalizeRepository(repository);
  const id = boundedInteger(artifactId, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    code: 'installer_provenance_artifact_id_invalid',
  });
  const target = path.resolve(requireText(output, 'installer_provenance_output_missing', 4096));
  const base = requireText(apiBase, 'installer_provenance_api_base_invalid', 2048).replace(/\/$/, '');
  const response = await fetchImpl(`${base}/repos/${normalizedRepo}/actions/artifacts/${id}/zip`, {
    headers: githubHeaders(token),
    redirect: 'follow',
  });
  if (!response?.ok || !response.body) {
    fail('installer_provenance_artifact_download_failed', { artifact_id: id, status: response?.status ?? null });
  }
  await mkdir(path.dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  const info = await stat(target);
  if (!info.isFile() || info.size < 1) fail('installer_provenance_artifact_download_empty');
  return Object.freeze({
    schema: 'metaengine.browser.installer-provenance-download.v1',
    artifact_id: id,
    output: target,
    bytes: info.size,
    authority_effect: false,
  });
}

export async function acquireArtifact({
  repository,
  sourceHead,
  token,
  output,
  workflow = 'browser-windows-package-smoke.yml',
  artifactName = null,
  apiBase = 'https://api.github.com',
  timeoutMs = 45 * 60 * 1000,
  pollMs = 15 * 1000,
  fetchImpl = fetch,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const timeout = boundedInteger(timeoutMs, {
    min: 1000,
    max: 2 * 60 * 60 * 1000,
    code: 'installer_provenance_timeout_invalid',
  });
  const poll = boundedInteger(pollMs, {
    min: 100,
    max: 60 * 1000,
    code: 'installer_provenance_poll_invalid',
  });
  const started = Date.now();
  let sawRun = false;
  while (Date.now() - started <= timeout) {
    const resolution = await resolveProducerArtifact({
      repository,
      sourceHead,
      token,
      workflow,
      artifactName,
      apiBase,
      fetchImpl,
    });
    if (resolution.state !== 'ABSENT') sawRun = true;
    if (resolution.state === 'READY') {
      const download = await downloadArtifact({
        repository,
        artifactId: resolution.artifact_id,
        token,
        output,
        apiBase,
        fetchImpl,
      });
      return Object.freeze({
        schema: ACQUIRE_SCHEMA,
        source_head: resolution.source_head,
        producer_run_id: resolution.run_id,
        artifact_id: resolution.artifact_id,
        artifact_name: resolution.artifact_name,
        output: download.output,
        bytes: download.bytes,
        exact_head_bound: true,
        authority_effect: false,
      });
    }
    if (Date.now() - started >= timeout) break;
    await sleepImpl(poll);
  }
  if (!sawRun) fail('installer_provenance_producer_run_absent');
  fail('installer_provenance_timeout');
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (!mode) fail('installer_provenance_mode_missing');
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) fail('installer_provenance_cli_argument_invalid', { token });
    const key = token.slice(2).replace(/-/g, '_');
    const value = rest[i + 1];
    if (value == null || String(value).startsWith('--')) fail('installer_provenance_cli_value_missing', { key });
    args[key] = value;
    i += 1;
  }
  return { mode, args };
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const { mode, args } = parseArgs(argv);
  if (mode === 'write') {
    return writeProvenance({
      output: args.output,
      sourceHead: args.source_head,
      producerRunId: args.run_id,
      repository: args.repository,
      artifactName: args.artifact_name,
      packageVersion: args.package_version,
      installer: args.installer,
      blockmap: args.blockmap,
      config: args.config,
    });
  }
  if (mode === 'verify') {
    return verifyProvenance({
      provenance: args.provenance,
      root: args.root,
      expectedHead: args.expected_head ?? null,
    });
  }
  if (mode === 'resolve') {
    return resolveProducerArtifact({
      repository: args.repository,
      sourceHead: args.source_head,
      token: env.GITHUB_TOKEN,
      workflow: args.workflow,
      artifactName: args.artifact_name,
      apiBase: args.api_base,
    });
  }
  if (mode === 'download') {
    return downloadArtifact({
      repository: args.repository,
      artifactId: args.artifact_id,
      token: env.GITHUB_TOKEN,
      output: args.output,
      apiBase: args.api_base,
    });
  }
  if (mode === 'acquire') {
    return acquireArtifact({
      repository: args.repository,
      sourceHead: args.source_head,
      token: env.GITHUB_TOKEN,
      output: args.output,
      workflow: args.workflow,
      artifactName: args.artifact_name,
      apiBase: args.api_base,
      timeoutMs: args.timeout_seconds ? Number(args.timeout_seconds) * 1000 : undefined,
      pollMs: args.poll_ms ? Number(args.poll_ms) : undefined,
    });
  }
  fail('installer_provenance_mode_unknown', { mode });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    const row = {
      schema: 'metaengine.browser.installer-provenance-error.v1',
      ok: false,
      code: error?.code || 'installer_provenance_unhandled',
      details: error?.details ?? null,
      authority_effect: false,
    };
    process.stderr.write(`${JSON.stringify(row)}\n`);
    process.exitCode = 1;
  });
}
