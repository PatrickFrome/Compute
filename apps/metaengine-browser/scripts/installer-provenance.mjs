import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const PROVENANCE_SCHEMA = 'metaengine.browser.installer-provenance.v1';
export const VERIFY_SCHEMA = 'metaengine.browser.installer-provenance-verification.v1';
export const RESOLUTION_SCHEMA = 'metaengine.browser.installer-provenance-resolution.v1';
export const DOWNLOAD_SCHEMA = 'metaengine.browser.installer-provenance-download.v1';
export const ACQUIRE_SCHEMA = 'metaengine.browser.installer-provenance-acquire.v1';
export const PRODUCER_WAIT_SCHEMA = 'metaengine.browser.installer-provenance-producer-wait.v1';
export const PRODUCER_WORKFLOW = 'Browser Windows Package Smoke';

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function requireString(value, code) {
  const text = String(value ?? '').trim();
  if (!text) fail(code);
  return text;
}

function normalizeHead(value) {
  const head = requireString(value, 'head_missing').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(head)) fail('head_invalid', { head });
  return head;
}

function normalizePositiveInt(value, code) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(code, { value });
  return n;
}

function normalizeTimeout(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fileEvidence(filePath) {
  const absolute = path.resolve(requireString(filePath, 'file_path_missing'));
  const bytes = await fs.readFile(absolute);
  return Object.freeze({
    name: path.basename(absolute),
    size_bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
}

async function readJson(filePath, code = 'json_read_failed') {
  try {
    return JSON.parse(await fs.readFile(path.resolve(filePath), 'utf8'));
  } catch (error) {
    fail(code, { message: String(error?.message || error) });
  }
}

async function writeJson(filePath, value) {
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return absolute;
}

function assertEvidence(actual, expected, prefix) {
  if (!actual || typeof actual !== 'object') fail(`${prefix}_missing`);
  if (actual.name !== expected.name) fail(`${prefix}_name_mismatch`, { expected: expected.name, actual: actual.name });
  if (Number(actual.size_bytes) !== Number(expected.size_bytes)) {
    fail('size_mismatch', { asset: prefix, expected: expected.size_bytes, actual: actual.size_bytes });
  }
  if (String(actual.sha256) !== String(expected.sha256)) {
    fail('sha_mismatch', { asset: prefix, expected: expected.sha256, actual: actual.sha256 });
  }
}

export async function writeProvenance({
  sourceHead,
  runId,
  runAttempt = 1,
  artifactName,
  installerPath,
  blockmapPath,
  configPath,
  outputPath,
} = {}) {
  const head = normalizeHead(sourceHead);
  const producerRunId = normalizePositiveInt(runId, 'run_id_invalid');
  const producerAttempt = normalizePositiveInt(runAttempt, 'run_attempt_invalid');
  const artifact = requireString(artifactName, 'artifact_name_missing');
  const output = requireString(outputPath, 'output_path_missing');

  const [installer, blockmap, builderConfig] = await Promise.all([
    fileEvidence(installerPath),
    fileEvidence(blockmapPath),
    fileEvidence(configPath),
  ]);

  const provenance = Object.freeze({
    schema: PROVENANCE_SCHEMA,
    source_head: head,
    artifact_name: artifact,
    producer: Object.freeze({
      workflow: PRODUCER_WORKFLOW,
      run_id: producerRunId,
      run_attempt: producerAttempt,
    }),
    assets: Object.freeze({
      installer,
      blockmap,
      builder_config: builderConfig,
    }),
    signed: false,
    published: false,
    promotion_authorized: false,
    authority_effect: false,
  });
  await writeJson(output, provenance);
  return provenance;
}

export async function verifyProvenance({
  provenancePath,
  expectedHead,
  installerPath,
  blockmapPath,
  configPath,
  expectedRunId = null,
  expectedRunAttempt = null,
} = {}) {
  const head = normalizeHead(expectedHead);
  const provenance = await readJson(requireString(provenancePath, 'provenance_path_missing'), 'provenance_invalid_json');
  if (provenance?.schema !== PROVENANCE_SCHEMA) fail('provenance_schema_invalid');
  if (String(provenance.source_head).toLowerCase() !== head) {
    fail('head_mismatch', { expected: head, actual: provenance.source_head });
  }
  if (provenance?.producer?.workflow !== PRODUCER_WORKFLOW) fail('producer_workflow_mismatch');
  if (expectedRunId != null && Number(provenance?.producer?.run_id) !== normalizePositiveInt(expectedRunId, 'expected_run_id_invalid')) {
    fail('producer_run_mismatch', { expected: Number(expectedRunId), actual: provenance?.producer?.run_id ?? null });
  }
  if (expectedRunAttempt != null && Number(provenance?.producer?.run_attempt) !== normalizePositiveInt(expectedRunAttempt, 'expected_run_attempt_invalid')) {
    fail('producer_run_attempt_mismatch', { expected: Number(expectedRunAttempt), actual: provenance?.producer?.run_attempt ?? null });
  }
  if (provenance?.authority_effect !== false || provenance?.promotion_authorized !== false) {
    fail('provenance_authority_invalid');
  }

  const [installer, blockmap, builderConfig] = await Promise.all([
    fileEvidence(installerPath),
    fileEvidence(blockmapPath),
    fileEvidence(configPath),
  ]);
  assertEvidence(provenance?.assets?.installer, installer, 'installer');
  assertEvidence(provenance?.assets?.blockmap, blockmap, 'blockmap');
  assertEvidence(provenance?.assets?.builder_config, builderConfig, 'builder_config');

  return Object.freeze({
    schema: VERIFY_SCHEMA,
    source_head: head,
    producer_run_id: Number(provenance.producer.run_id),
    artifact_name: String(provenance.artifact_name),
    installer_sha256: installer.sha256,
    installer_size_bytes: installer.size_bytes,
    verified: true,
    authority_effect: false,
  });
}

async function fetchJson(url, { token, fetchImpl = fetch, requestTimeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-github-api-version': '2022-11-28',
        'user-agent': 'metaengine-installer-provenance',
      },
    });
    if (!response.ok) fail('github_api_http_error', { status: response.status, url: String(url) });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveProducerRun({
  repo,
  head,
  token,
  artifactName,
  apiBase = 'https://api.github.com',
  timeoutMs = 45 * 60 * 1000,
  pollMs = 5000,
  fetchImpl = fetch,
  allowInProgressArtifact = false,
} = {}) {
  const repository = requireString(repo, 'repo_missing');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) fail('repo_invalid');
  const exactHead = normalizeHead(head);
  const artifact = requireString(artifactName, 'artifact_name_missing');
  const boundedTimeout = normalizeTimeout(timeoutMs, 45 * 60 * 1000);
  const boundedPoll = Math.max(10, normalizeTimeout(pollMs, 5000));
  const started = Date.now();
  let sawMatchingRun = false;
  let lastReadError = null;

  while (Date.now() - started <= boundedTimeout) {
    try {
      const runsUrl = new URL(`/repos/${repository}/actions/runs`, apiBase);
      runsUrl.searchParams.set('head_sha', exactHead);
      runsUrl.searchParams.set('per_page', '100');
      const payload = await fetchJson(runsUrl, { token, fetchImpl });
      const matches = (Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [])
        .filter((run) => String(run?.head_sha || '').toLowerCase() === exactHead && run?.name === PRODUCER_WORKFLOW)
        .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));

      if (matches.length) {
        sawMatchingRun = true;
        const run = matches[0];
        if (run.status === 'completed' && run.conclusion !== 'success') {
          fail('installer_provenance_producer_failed', {
            run_id: run.id,
            conclusion: run.conclusion ?? null,
          });
        }
        if (run.status === 'completed' || allowInProgressArtifact === true) {
          const artifactsUrl = new URL(`/repos/${repository}/actions/runs/${run.id}/artifacts`, apiBase);
          artifactsUrl.searchParams.set('per_page', '100');
          const artifactsPayload = await fetchJson(artifactsUrl, { token, fetchImpl });
          const found = (Array.isArray(artifactsPayload?.artifacts) ? artifactsPayload.artifacts : [])
            .find((row) => row?.name === artifact && row?.expired !== true);
          if (found) {
            return Object.freeze({
              schema: RESOLUTION_SCHEMA,
              source_head: exactHead,
              producer_run_id: Number(run.id),
              producer_run_attempt: Number(run.run_attempt || 1),
              producer_completed: run.status === 'completed',
              producer_conclusion: run.conclusion ?? null,
              artifact_id: Number(found.id),
              artifact_name: artifact,
              archive_download_url: String(found.archive_download_url),
              authority_effect: false,
            });
          }
          if (run.status === 'completed') {
            fail('installer_provenance_artifact_absent', { run_id: run.id, artifact_name: artifact });
          }
        }
      }
      lastReadError = null;
    } catch (error) {
      if (String(error?.code || '').startsWith('installer_provenance_')) throw error;
      const status = Number(error?.details?.status);
      if (error?.code === 'github_api_http_error' && status >= 400 && status < 500) {
        fail('installer_provenance_github_api_rejected', {
          status,
          url: error?.details?.url ?? null,
        });
      }
      lastReadError = String(error?.code || error?.message || error);
    }
    if (Date.now() - started + boundedPoll > boundedTimeout) break;
    await sleep(boundedPoll);
  }

  if (!sawMatchingRun) {
    fail('installer_provenance_producer_run_absent', { source_head: exactHead, last_read_error: lastReadError });
  }
  fail('installer_provenance_producer_timeout', { source_head: exactHead, last_read_error: lastReadError });
}

export async function waitProducerSuccess({
  repo,
  head,
  runId,
  runAttempt = null,
  token,
  apiBase = 'https://api.github.com',
  timeoutMs = 45 * 60 * 1000,
  pollMs = 5000,
  fetchImpl = fetch,
} = {}) {
  const repository = requireString(repo, 'repo_missing');
  if (!/^[^/\\s]+\\/[^/\\s]+$/.test(repository)) fail('repo_invalid');
  const exactHead = normalizeHead(head);
  const exactRunId = normalizePositiveInt(runId, 'run_id_invalid');
  const exactAttempt = runAttempt == null ? null : normalizePositiveInt(runAttempt, 'run_attempt_invalid');
  const boundedTimeout = normalizeTimeout(timeoutMs, 45 * 60 * 1000);
  const boundedPoll = Math.max(10, normalizeTimeout(pollMs, 5000));
  const started = Date.now();

  while (Date.now() - started <= boundedTimeout) {
    let run;
    try {
      const runUrl = new URL(`/repos/${repository}/actions/runs/${exactRunId}`, apiBase);
      run = await fetchJson(runUrl, { token, fetchImpl });
    } catch (error) {
      const status = Number(error?.details?.status);
      if (error?.code === 'github_api_http_error' && status >= 400 && status < 500) {
        fail('installer_provenance_github_api_rejected', {
          status,
          url: error?.details?.url ?? null,
        });
      }
      if (Date.now() - started + boundedPoll > boundedTimeout) break;
      await sleep(boundedPoll);
      continue;
    }

    if (String(run?.head_sha || '').toLowerCase() !== exactHead) {
      fail('producer_head_mismatch', { expected: exactHead, actual: run?.head_sha ?? null });
    }
    if (run?.name !== PRODUCER_WORKFLOW) {
      fail('producer_workflow_mismatch', { expected: PRODUCER_WORKFLOW, actual: run?.name ?? null });
    }
    if (exactAttempt != null && Number(run?.run_attempt || 1) !== exactAttempt) {
      fail('producer_run_attempt_mismatch', { expected: exactAttempt, actual: Number(run?.run_attempt || 1) });
    }
    if (run?.status === 'completed') {
      if (run?.conclusion !== 'success') {
        fail('installer_provenance_producer_failed', {
          run_id: exactRunId,
          conclusion: run?.conclusion ?? null,
        });
      }
      return Object.freeze({
        schema: PRODUCER_WAIT_SCHEMA,
        source_head: exactHead,
        producer_run_id: exactRunId,
        producer_run_attempt: Number(run?.run_attempt || 1),
        producer_conclusion: 'success',
        verified: true,
        authority_effect: false,
      });
    }

    if (Date.now() - started + boundedPoll > boundedTimeout) break;
    await sleep(boundedPoll);
  }

  fail('installer_provenance_producer_timeout', {
    source_head: exactHead,
    run_id: exactRunId,
  });
}

export async function downloadArtifact({
  url,
  token,
  outputPath,
  fetchImpl = fetch,
  requestTimeoutMs = 120000,
} = {}) {
  const downloadUrl = requireString(url, 'artifact_download_url_missing');
  const output = path.resolve(requireString(outputPath, 'output_path_missing'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchImpl(downloadUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // GitHub Actions artifact download is a REST endpoint that returns a
        // short-lived 302. Unlike release assets, it expects the GitHub JSON
        // media type; application/octet-stream is rejected with HTTP 415.
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-github-api-version': '2022-11-28',
        'user-agent': 'metaengine-installer-provenance',
      },
    });
    if (!response.ok) fail('artifact_download_http_error', { status: response.status });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) fail('artifact_download_empty');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, bytes);
    return Object.freeze({
      schema: DOWNLOAD_SCHEMA,
      output_path: output,
      size_bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      authority_effect: false,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function acquireArtifact(options = {}) {
  const resolved = await resolveProducerRun(options);
  const downloaded = await downloadArtifact({
    url: resolved.archive_download_url,
    token: options.token,
    outputPath: options.outputPath,
    fetchImpl: options.fetchImpl,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  return Object.freeze({
    schema: ACQUIRE_SCHEMA,
    source_head: resolved.source_head,
    producer_run_id: resolved.producer_run_id,
    producer_run_attempt: resolved.producer_run_attempt,
    artifact_id: resolved.artifact_id,
    artifact_name: resolved.artifact_name,
    archive_sha256: downloaded.sha256,
    archive_size_bytes: downloaded.size_bytes,
    archive_path: downloaded.output_path,
    authority_effect: false,
  });
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const raw = rest[i];
    if (!raw.startsWith('--')) fail('cli_argument_invalid', { argument: raw });
    const key = raw.slice(2).replaceAll('-', '_');
    const value = rest[i + 1];
    if (value == null || value.startsWith('--')) fail('cli_argument_value_missing', { argument: raw });
    args[key] = value;
    i += 1;
  }
  return { command, args };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const { command, args } = parseArgs(argv);
  if (command === 'write') {
    print(await writeProvenance({
      sourceHead: args.source_head,
      runId: args.run_id,
      runAttempt: args.run_attempt || '1',
      artifactName: args.artifact_name,
      installerPath: args.installer,
      blockmapPath: args.blockmap,
      configPath: args.config,
      outputPath: args.output,
    }));
    return;
  }
  if (command === 'verify') {
    print(await verifyProvenance({
      provenancePath: args.provenance,
      expectedHead: args.expected_head,
      installerPath: args.installer,
      blockmapPath: args.blockmap,
      configPath: args.config,
      expectedRunId: args.expected_run_id ?? null,
      expectedRunAttempt: args.expected_run_attempt ?? null,
    }));
    return;
  }
  if (command === 'resolve') {
    print(await resolveProducerRun({
      repo: args.repo || process.env.GITHUB_REPOSITORY,
      head: args.head,
      token: args.token || process.env.GITHUB_TOKEN,
      artifactName: args.artifact_name,
      apiBase: args.api_base || process.env.GITHUB_API_URL || 'https://api.github.com',
      timeoutMs: args.timeout_ms,
      pollMs: args.poll_ms,
      allowInProgressArtifact: args.allow_in_progress === 'true',
    }));
    return;
  }
  if (command === 'download') {
    print(await downloadArtifact({
      url: args.url,
      token: args.token || process.env.GITHUB_TOKEN,
      outputPath: args.output,
    }));
    return;
  }
  if (command === 'wait') {
    print(await waitProducerSuccess({
      repo: args.repo || process.env.GITHUB_REPOSITORY,
      head: args.head,
      runId: args.run_id,
      runAttempt: args.run_attempt ?? null,
      token: args.token || process.env.GITHUB_TOKEN,
      apiBase: args.api_base || process.env.GITHUB_API_URL || 'https://api.github.com',
      timeoutMs: args.timeout_ms,
      pollMs: args.poll_ms,
    }));
    return;
  }
  if (command === 'acquire') {
    print(await acquireArtifact({
      repo: args.repo || process.env.GITHUB_REPOSITORY,
      head: args.head,
      token: args.token || process.env.GITHUB_TOKEN,
      artifactName: args.artifact_name,
      apiBase: args.api_base || process.env.GITHUB_API_URL || 'https://api.github.com',
      timeoutMs: args.timeout_ms,
      pollMs: args.poll_ms,
      outputPath: args.output,
      allowInProgressArtifact: args.allow_in_progress === 'true',
    }));
    return;
  }
  fail('cli_command_invalid', { command: command ?? null });
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schema: 'metaengine.browser.installer-provenance-error.v1',
      ok: false,
      code: String(error?.code || 'installer_provenance_error'),
      details: error?.details ?? null,
      message: String(error?.message || error),
      authority_effect: false,
    })}\n`);
    process.exitCode = 1;
  });
}
