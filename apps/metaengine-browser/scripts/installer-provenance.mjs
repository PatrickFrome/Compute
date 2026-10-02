#!/usr/bin/env node
// ME2 build-once installer provenance (R86).
//
// Contract: the Windows NSIS candidate installer is built EXACTLY ONCE per
// exact head by Browser Windows Package Smoke. Every downstream gate (Installed
// Chat Qualification, Final Runtime Activation, Autonomous Soak) acquires those
// exact bytes plus an immutable provenance record and verifies them before use.
// No downstream workflow builds NSIS anymore; the byte identity is enforced
// here, not trusted.
//
// Modes:
//   write    - produce installer-provenance.json for a freshly built installer
//   verify   - re-hash installer bytes against provenance + expected head
//   resolve  - poll GitHub for the Package Smoke run of an exact head
//   download - fetch the provenanced artifact zip of a resolved run
//   acquire  - resolve + download in one step (optionally before producer completion)
//   wait     - require the exact bound producer run to finish successfully
//
// Zero runtime dependencies; runs on plain node >= 18 (runner has node 24).
// All diagnostics go to stderr as one JSON line; machine codes are stable.

import {
  createHash,
  randomUUID,
} from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const {
  loadDependencyResolutionProof,
  validateBuildIdentity,
} = require('./build-identity.cjs');

const PROVENANCE_SCHEMA_V1 = 'metaengine.browser.installer-provenance.v1';
const PROVENANCE_SCHEMA_V2 = 'metaengine.browser.installer-provenance.v2';
const ACQUIRED_SCHEMA = 'metaengine.browser.installer-provenance-acquired.v1';
const RESOLVED_SCHEMA = 'metaengine.browser.installer-run-resolved.v1';
const DOWNLOADED_SCHEMA = 'metaengine.browser.installer-artifact-downloaded.v1';
const ERROR_SCHEMA = 'metaengine.browser.installer-provenance-error.v1';
const API_VERSION = '2022-11-28';

class ProvenanceError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        parsed[key] = true;
      } else {
        parsed[key] = next;
        i += 1;
      }
    } else {
      parsed._.push(token);
    }
  }
  return parsed;
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProvenanceError('option_missing', { option: name });
  }
  return value;
}

function sha256File(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function fail(error) {
  const code = error instanceof ProvenanceError ? error.code : 'internal_error';
  const details = error instanceof ProvenanceError ? error.details : { message: String(error && error.message ? error.message : error) };
  process.stderr.write(`${JSON.stringify({ schema: ERROR_SCHEMA, code, ...details })}\n`);
  process.exitCode = 1;
}

function requireHeadShape(head) {
  if (!/^[0-9a-f]{40}$/i.test(head)) {
    throw new ProvenanceError('head_shape_invalid', { head });
  }
  return head.toLowerCase();
}

function tokenFrom(options) {
  const token = options.token
    || process.env.ME2_GITHUB_TOKEN
    || process.env.GITHUB_TOKEN
    || process.env.GH_TOKEN;
  if (!token) {
    throw new ProvenanceError('token_missing', {});
  }
  return token;
}

function repositoryFrom(options) {
  const repository = options.repository || process.env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes('/')) {
    throw new ProvenanceError('repository_missing', { repository: repository || null });
  }
  return repository;
}

function apiBaseFrom(options) {
  return (options['api-base'] || 'https://api.github.com').replace(/\/+$/, '');
}

async function githubJson(path, token, apiBase) {
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'user-agent': 'metaengine-installer-provenance',
      },
      redirect: 'follow',
    });
  } catch (error) {
    throw new ProvenanceError('api_fetch_failed', { message: String(error && error.message ? error.message : error) });
  }
  if (!response.ok) {
    throw new ProvenanceError('api_status_unexpected', { status: response.status, path });
  }
  return response.json();
}

function pickNewestRun(runs, head) {
  const mine = (Array.isArray(runs) ? runs : []).filter((run) => String(run.head_sha || '').toLowerCase() === head);
  if (mine.length === 0) {
    return null;
  }
  return mine.reduce((newest, run) => (Number(run.run_number) > Number(newest.run_number) ? run : newest));
}

function pickNewestArtifact(artifacts, artifactName) {
  const matches = (Array.isArray(artifacts) ? artifacts : [])
    .filter((artifact) => artifact?.name === artifactName);
  if (matches.length === 0) return null;
  return matches.reduce((newest, artifact) => {
    const newestCreated = Date.parse(String(newest?.created_at || ''));
    const artifactCreated = Date.parse(String(artifact?.created_at || ''));
    if (Number.isFinite(artifactCreated) && Number.isFinite(newestCreated) && artifactCreated !== newestCreated) {
      return artifactCreated > newestCreated ? artifact : newest;
    }
    if (Number.isFinite(artifactCreated) && !Number.isFinite(newestCreated)) return artifact;
    if (!Number.isFinite(artifactCreated) && Number.isFinite(newestCreated)) return newest;
    const newestId = Number(newest?.id || 0);
    const artifactId = Number(artifact?.id || 0);
    return artifactId > newestId ? artifact : newest;
  });
}

function artifactBelongsToCurrentRunAttempt(artifact, run) {
  const attempt = Number(run?.run_attempt || 1);
  if (!Number.isSafeInteger(attempt) || attempt < 1) return false;
  if (attempt === 1) return true;
  const runStartedAt = Date.parse(String(run?.run_started_at || ''));
  const artifactCreatedAt = Date.parse(String(artifact?.created_at || ''));
  if (!Number.isFinite(runStartedAt) || !Number.isFinite(artifactCreatedAt)) return false;
  return artifactCreatedAt >= runStartedAt;
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, Math.max(0, ms));
  });
}

function permanentApiError(error) {
  return error instanceof ProvenanceError
    && error.code === 'api_status_unexpected'
    && Number(error.details?.status) >= 400
    && Number(error.details?.status) < 500;
}

function booleanOption(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

async function resolveRun(options) {
  const head = requireHeadShape(requireOption(options, 'head'));
  const workflow = requireOption(options, 'workflow');
  const artifactName = options.artifact && options.artifact !== true ? String(options.artifact) : null;
  const allowInProgress = booleanOption(options['allow-in-progress']);
  const token = tokenFrom(options);
  const repository = repositoryFrom(options);
  const apiBase = apiBaseFrom(options);
  const timeoutMin = Number(options['timeout-min'] === undefined ? 45 : options['timeout-min']);
  const intervalSec = Number(options['interval-sec'] === undefined ? 30 : options['interval-sec']);
  const absentGraceMin = Number(options['absent-grace-min'] === undefined ? 10 : options['absent-grace-min']);
  if (!Number.isFinite(timeoutMin) || timeoutMin < 0 || !Number.isFinite(intervalSec) || intervalSec < 0 || !Number.isFinite(absentGraceMin) || absentGraceMin < 0) {
    throw new ProvenanceError('option_invalid', { timeoutMin, intervalSec, absentGraceMin });
  }
  if (allowInProgress && !artifactName) {
    throw new ProvenanceError('option_missing', { option: 'artifact' });
  }

  const deadline = Date.now() + timeoutMin * 60000;
  const intervalMs = intervalSec * 1000;
  let absentSince = null;
  let consecutiveApiErrors = 0;

  for (;;) {
    let newest = null;
    try {
      const payload = await githubJson(
        `/repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${head}&per_page=30`,
        token,
        apiBase,
      );
      newest = pickNewestRun(payload.workflow_runs, head);
      consecutiveApiErrors = 0;

      if (newest) {
        if (newest.status === 'completed') {
          if (newest.conclusion !== 'success') {
            throw new ProvenanceError('installer_provenance_producer_failed', {
              run_id: String(newest.id),
              run_number: Number(newest.run_number),
              run_attempt: Number(newest.run_attempt || 1),
              conclusion: newest.conclusion,
            });
          }
          return {
            schema: RESOLVED_SCHEMA,
            repository,
            workflow,
            head_sha: head,
            run_id: String(newest.id),
            run_number: Number(newest.run_number),
            run_attempt: Number(newest.run_attempt || 1),
            producer_completed: true,
            producer_conclusion: 'success',
            resolved_at: new Date().toISOString(),
          };
        }

        absentSince = null;
        if (allowInProgress) {
          const listed = await githubJson(
            `/repos/${repository}/actions/runs/${newest.id}/artifacts?per_page=100`,
            token,
            apiBase,
          );
          const artifacts = Array.isArray(listed.artifacts) ? listed.artifacts : [];
          const artifact = pickNewestArtifact(artifacts, artifactName);
          if (
            artifact
            && artifact.expired !== true
            && artifactBelongsToCurrentRunAttempt(artifact, newest)
          ) {
            return {
              schema: RESOLVED_SCHEMA,
              repository,
              workflow,
              head_sha: head,
              run_id: String(newest.id),
              run_number: Number(newest.run_number),
              run_attempt: Number(newest.run_attempt || 1),
              producer_completed: false,
              producer_conclusion: null,
              artifact_id: String(artifact.id),
              artifact_name: artifactName,
              resolved_at: new Date().toISOString(),
            };
          }
        }
      } else {
        if (absentSince === null) absentSince = Date.now();
        if (Date.now() - absentSince > absentGraceMin * 60000) {
          throw new ProvenanceError('installer_provenance_run_absent', { head, workflow });
        }
      }
    } catch (error) {
      if (error instanceof ProvenanceError && (
        error.code === 'installer_provenance_producer_failed'
        || error.code === 'installer_provenance_run_absent'
        || permanentApiError(error)
      )) {
        throw error;
      }
      consecutiveApiErrors += 1;
      if (consecutiveApiErrors > 10) throw error;
    }

    if (Date.now() >= deadline) {
      throw new ProvenanceError('installer_provenance_timeout', { head, workflow, timeout_min: timeoutMin });
    }
    await sleep(intervalMs);
  }
}

async function waitRun(options) {
  const head = requireHeadShape(requireOption(options, 'head'));
  const workflow = requireOption(options, 'workflow');
  const runId = requireOption(options, 'run-id');
  const expectedRunNumber = options['run-number'] !== undefined && options['run-number'] !== true
    ? Number(options['run-number'])
    : null;
  const expectedRunAttempt = options['run-attempt'] !== undefined && options['run-attempt'] !== true
    ? Number(options['run-attempt'])
    : null;
  const token = tokenFrom(options);
  const repository = repositoryFrom(options);
  const apiBase = apiBaseFrom(options);
  const timeoutMin = Number(options['timeout-min'] === undefined ? 45 : options['timeout-min']);
  const intervalSec = Number(options['interval-sec'] === undefined ? 30 : options['interval-sec']);
  if (!Number.isFinite(timeoutMin) || timeoutMin < 0 || !Number.isFinite(intervalSec) || intervalSec < 0) {
    throw new ProvenanceError('option_invalid', { timeoutMin, intervalSec });
  }
  const deadline = Date.now() + timeoutMin * 60000;
  const intervalMs = intervalSec * 1000;
  let consecutiveApiErrors = 0;

  for (;;) {
    try {
      const run = await githubJson(`/repos/${repository}/actions/runs/${runId}`, token, apiBase);
      consecutiveApiErrors = 0;
      if (String(run.head_sha || '').toLowerCase() !== head) {
        throw new ProvenanceError('producer_head_mismatch', { expected_head: head, actual_head: run.head_sha || null });
      }
      if (String(run.path || '').split('/').pop() !== workflow && String(run.name || '') !== 'Browser Windows Package Smoke') {
        throw new ProvenanceError('producer_workflow_mismatch', { workflow, actual_path: run.path || null, actual_name: run.name || null });
      }
      if (expectedRunNumber !== null && Number(run.run_number) !== expectedRunNumber) {
        throw new ProvenanceError('producer_run_number_mismatch', { expected: expectedRunNumber, actual: Number(run.run_number) });
      }
      if (expectedRunAttempt !== null && Number(run.run_attempt || 1) !== expectedRunAttempt) {
        throw new ProvenanceError('producer_run_attempt_mismatch', { expected: expectedRunAttempt, actual: Number(run.run_attempt || 1) });
      }
      if (run.status === 'completed') {
        if (run.conclusion !== 'success') {
          throw new ProvenanceError('installer_provenance_producer_failed', {
            run_id: String(run.id),
            run_number: Number(run.run_number),
            run_attempt: Number(run.run_attempt || 1),
            conclusion: run.conclusion,
          });
        }
        return {
          schema: 'metaengine.browser.installer-producer-qualified.v1',
          repository,
          workflow,
          head_sha: head,
          run_id: String(run.id),
          run_number: Number(run.run_number),
          run_attempt: Number(run.run_attempt || 1),
          conclusion: 'success',
          qualified_at: new Date().toISOString(),
        };
      }
    } catch (error) {
      if (error instanceof ProvenanceError && (
        error.code.startsWith('producer_')
        || error.code === 'installer_provenance_producer_failed'
        || permanentApiError(error)
      )) {
        throw error;
      }
      consecutiveApiErrors += 1;
      if (consecutiveApiErrors > 10) throw error;
    }

    if (Date.now() >= deadline) {
      throw new ProvenanceError('installer_provenance_timeout', { head, workflow, run_id: runId, timeout_min: timeoutMin });
    }
    await sleep(intervalMs);
  }
}

async function downloadArtifact(options) {
  const token = tokenFrom(options);
  const repository = repositoryFrom(options);
  const apiBase = apiBaseFrom(options);
  const runId = requireOption(options, 'run-id');
  const artifactName = requireOption(options, 'artifact');
  const outDir = resolve(requireOption(options, 'out'));
  mkdirSync(outDir, { recursive: true });

  const list = await githubJson(`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`, token, apiBase);
  const artifacts = Array.isArray(list.artifacts) ? list.artifacts : [];
  const exactArtifactId = options['artifact-id'] === undefined || options['artifact-id'] === true
    ? null
    : String(options['artifact-id']);
  const match = exactArtifactId
    ? artifacts.find((artifact) => artifact.name === artifactName && String(artifact.id) === exactArtifactId)
    : pickNewestArtifact(artifacts, artifactName);
  if (!match) {
    throw new ProvenanceError(exactArtifactId ? 'artifact_id_not_found' : 'artifact_not_found', {
      artifact: artifactName,
      artifact_id: exactArtifactId,
      run_id: runId,
    });
  }
  if (match.expired) {
    throw new ProvenanceError('artifact_expired', {
      artifact: artifactName,
      artifact_id: String(match.id),
      run_id: runId,
    });
  }

  const response = await fetch(`${apiBase}/repos/${repository}/actions/artifacts/${match.id}/zip`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'user-agent': 'metaengine-installer-provenance',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new ProvenanceError('artifact_download_failed', { status: response.status, artifact: artifactName });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (Number.isFinite(match.size_in_bytes) && buffer.length !== Number(match.size_in_bytes)) {
    throw new ProvenanceError('artifact_size_mismatch', {
      expected: Number(match.size_in_bytes),
      actual: buffer.length,
    });
  }
  const zipPath = join(outDir, 'artifact.zip');
  writeFileSync(zipPath, buffer);
  return {
    schema: DOWNLOADED_SCHEMA,
    repository,
    run_id: runId,
    artifact_id: String(match.id),
    artifact_name: artifactName,
    zip_path: zipPath,
    zip_bytes: buffer.length,
    downloaded_at: new Date().toISOString(),
  };
}

async function writeProvenance(options) {
  const installerPath = resolve(requireOption(options, 'installer'));
  const outPath = resolve(requireOption(options, 'out'));
  if (!existsSync(installerPath) || !statSync(installerPath).isFile()) {
    throw new ProvenanceError('installer_missing', { installer: installerPath });
  }
  const sourceHead = options['source-head'] ? requireHeadShape(options['source-head']) : null;
  const stats = statSync(installerPath);
  const installerSha256 = await sha256File(installerPath);
  const configPath = options.config ? resolve(options.config) : null;
  let configSha256 = null;
  if (configPath) {
    if (!existsSync(configPath) || !statSync(configPath).isFile()) {
      throw new ProvenanceError('config_missing', { config: configPath });
    }
    configSha256 = await sha256File(configPath);
  }
  const blockmapPath = options.blockmap ? resolve(options.blockmap) : null;
  let blockmapName = null;
  let blockmapSha256 = null;
  if (blockmapPath) {
    if (!existsSync(blockmapPath) || !statSync(blockmapPath).isFile()) {
      throw new ProvenanceError('blockmap_missing', { blockmap: blockmapPath });
    }
    blockmapName = basename(blockmapPath);
    blockmapSha256 = await sha256File(blockmapPath);
  }

  const provenance = {
    schema: PROVENANCE_SCHEMA,
    provenance_id: randomUUID(),
    source_head: sourceHead,
    workflow: options.workflow || null,
    run_id: options['run-id'] || null,
    run_number: options['run-number'] !== undefined && options['run-number'] !== true ? Number(options['run-number']) : null,
    run_attempt: options['run-attempt'] !== undefined && options['run-attempt'] !== true ? Number(options['run-attempt']) : null,
    package_version: options['package-version'] || null,
    installer_name: basename(installerPath),
    installer_sha256: installerSha256,
    installer_bytes: stats.size,
    blockmap_name: blockmapName,
    blockmap_sha256: blockmapSha256,
    config_path: options.config || null,
    config_sha256: configSha256,
    builder_version: options.builder || null,
    built_at: options['built-at'] || new Date().toISOString(),
    signed: false,
    promotion_authorized: false,
  };
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  return provenance;
}

function readProvenance(provenancePath) {
  if (!existsSync(provenancePath) || !statSync(provenancePath).isFile()) {
    throw new ProvenanceError('provenance_missing', { provenance: provenancePath });
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(provenancePath, 'utf8'));
  } catch (error) {
    throw new ProvenanceError('provenance_schema_invalid', { provenance: provenancePath, message: String(error && error.message ? error.message : error) });
  }
  if (!parsed || parsed.schema !== PROVENANCE_SCHEMA) {
    throw new ProvenanceError('provenance_schema_invalid', { provenance: provenancePath, schema: parsed ? parsed.schema : null });
  }
  for (const field of ['installer_name', 'installer_sha256', 'installer_bytes']) {
    if (typeof parsed[field] !== 'string' && typeof parsed[field] !== 'number') {
      throw new ProvenanceError('provenance_field_invalid', { field });
    }
  }
  if (!/^[0-9a-f]{64}$/.test(String(parsed.installer_sha256))) {
    throw new ProvenanceError('provenance_field_invalid', { field: 'installer_sha256' });
  }
  return parsed;
}

async function verifyInstaller(options) {
  const expectHead = requireHeadShape(requireOption(options, 'expect-head'));
  let payloadDir = null;
  let installerPath;
  let provenancePath;
  let statePath;
  if (options.dir) {
    payloadDir = resolve(options.dir);
    provenancePath = join(payloadDir, 'installer-provenance.json');
    statePath = resolve(options.state || join(payloadDir, 'acquired.json'));
    const provenance = readProvenance(provenancePath);
    installerPath = join(payloadDir, String(provenance.installer_name));
  } else {
    installerPath = resolve(requireOption(options, 'installer'));
    provenancePath = resolve(requireOption(options, 'provenance'));
    statePath = resolve(options.state || join(resolve(provenancePath, '..'), 'acquired.json'));
  }

  const provenance = readProvenance(provenancePath);
  if (!existsSync(installerPath) || !statSync(installerPath).isFile()) {
    throw new ProvenanceError('installer_missing', { installer: installerPath });
  }
  const installerName = basename(installerPath);
  if (String(provenance.installer_name) !== installerName) {
    throw new ProvenanceError('name_mismatch', { provenance_name: provenance.installer_name, actual_name: installerName });
  }
  if (provenance.source_head && String(provenance.source_head).toLowerCase() !== expectHead) {
    throw new ProvenanceError('head_mismatch', { provenance_head: provenance.source_head, expected_head: expectHead });
  }
  if (options['expect-run-id'] && String(provenance.run_id || '') !== String(options['expect-run-id'])) {
    throw new ProvenanceError('producer_run_mismatch', { provenance_run_id: provenance.run_id || null, expected_run_id: String(options['expect-run-id']) });
  }
  if (options['expect-run-number'] !== undefined && options['expect-run-number'] !== true
      && Number(provenance.run_number) !== Number(options['expect-run-number'])) {
    throw new ProvenanceError('producer_run_number_mismatch', { provenance_run_number: provenance.run_number, expected_run_number: Number(options['expect-run-number']) });
  }
  if (options['expect-run-attempt'] !== undefined && options['expect-run-attempt'] !== true
      && Number(provenance.run_attempt || 1) !== Number(options['expect-run-attempt'])) {
    throw new ProvenanceError('producer_run_attempt_mismatch', { provenance_run_attempt: provenance.run_attempt || 1, expected_run_attempt: Number(options['expect-run-attempt']) });
  }
  if (options['expect-workflow'] && String(provenance.workflow || '') !== String(options['expect-workflow'])) {
    throw new ProvenanceError('producer_workflow_mismatch', { provenance_workflow: provenance.workflow || null, expected_workflow: String(options['expect-workflow']) });
  }
  const stats = statSync(installerPath);
  if (Number(provenance.installer_bytes) !== stats.size) {
    throw new ProvenanceError('size_mismatch', { provenance_bytes: Number(provenance.installer_bytes), actual_bytes: stats.size });
  }
  const actualSha256 = await sha256File(installerPath);
  if (String(provenance.installer_sha256) !== actualSha256) {
    throw new ProvenanceError('sha_mismatch', { provenance_sha256: provenance.installer_sha256, actual_sha256: actualSha256 });
  }

  let blockmapVerified = false;
  let verifiedBlockmapPath = null;
  if (provenance.blockmap_name || provenance.blockmap_sha256) {
    const blockmapPath = options.blockmap
      ? resolve(options.blockmap)
      : payloadDir
        ? join(payloadDir, String(provenance.blockmap_name || ''))
        : null;
    if (!blockmapPath || !existsSync(blockmapPath) || !statSync(blockmapPath).isFile()) {
      throw new ProvenanceError('blockmap_missing', { blockmap: blockmapPath });
    }
    if (basename(blockmapPath) !== String(provenance.blockmap_name)) {
      throw new ProvenanceError('blockmap_name_mismatch', { provenance_name: provenance.blockmap_name, actual_name: basename(blockmapPath) });
    }
    const blockmapSha256 = await sha256File(blockmapPath);
    if (blockmapSha256 !== String(provenance.blockmap_sha256)) {
      throw new ProvenanceError('blockmap_sha_mismatch', { provenance_sha256: provenance.blockmap_sha256, actual_sha256: blockmapSha256 });
    }
    blockmapVerified = true;
    verifiedBlockmapPath = resolve(blockmapPath);
  }

  let configVerified = false;
  if (provenance.config_sha256) {
    const configPath = options.config ? resolve(options.config) : null;
    if (!configPath || !existsSync(configPath) || !statSync(configPath).isFile()) {
      throw new ProvenanceError('config_missing', { config: configPath });
    }
    const configSha256 = await sha256File(configPath);
    if (configSha256 !== String(provenance.config_sha256)) {
      throw new ProvenanceError('config_sha_mismatch', { provenance_sha256: provenance.config_sha256, actual_sha256: configSha256 });
    }
    configVerified = true;
  }

  const acquired = {
    schema: ACQUIRED_SCHEMA,
    installer_path: isAbsolute(installerPath) ? installerPath : resolve(installerPath),
    installer_name: installerName,
    installer_sha256: actualSha256,
    installer_bytes: stats.size,
    package_version: provenance.package_version || null,
    blockmap_path: verifiedBlockmapPath,
    source_head: provenance.source_head || null,
    provenance_run_id: provenance.run_id || null,
    provenance_run_number: provenance.run_number || null,
    provenance_run_attempt: provenance.run_attempt || 1,
    provenance_workflow: provenance.workflow || null,
    blockmap_verified: blockmapVerified,
    config_verified: configVerified,
    provenance_path: resolve(provenancePath),
    verified_at: new Date().toISOString(),
  };
  mkdirSync(resolve(statePath, '..'), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(acquired, null, 2)}\n`, 'utf8');
  return acquired;
}

async function acquireInstaller(options) {
  const resolved = await resolveRun(options);
  const outDir = resolve(requireOption(options, 'out'));
  mkdirSync(outDir, { recursive: true });
  const resolvedPath = join(outDir, 'resolved.json');
  writeFileSync(resolvedPath, `${JSON.stringify(resolved, null, 2)}\n`, 'utf8');
  const downloaded = await downloadArtifact({
    ...options,
    repository: resolved.repository,
    token: options.token || process.env.ME2_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    'run-id': resolved.run_id,
    ...(resolved.artifact_id ? { 'artifact-id': resolved.artifact_id } : {}),
  });
  return { ...downloaded, resolved_path: resolvedPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = options._[0];
  if (mode === 'write') {
    const provenance = await writeProvenance(options);
    process.stdout.write(`${JSON.stringify(provenance)}\n`);
    return;
  }
  if (mode === 'verify') {
    const acquired = await verifyInstaller(options);
    process.stdout.write(`${JSON.stringify(acquired)}\n`);
    return;
  }
  if (mode === 'resolve') {
    const resolved = await resolveRun(options);
    if (options.state) {
      const statePath = resolve(options.state);
      mkdirSync(resolve(statePath, '..'), { recursive: true });
      writeFileSync(statePath, `${JSON.stringify(resolved, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(resolved)}\n`);
    return;
  }
  if (mode === 'download') {
    const downloaded = await downloadArtifact(options);
    process.stdout.write(`${JSON.stringify(downloaded)}\n`);
    return;
  }
  if (mode === 'wait') {
    const qualified = await waitRun(options);
    if (options.state) {
      const statePath = resolve(options.state);
      mkdirSync(resolve(statePath, '..'), { recursive: true });
      writeFileSync(statePath, `${JSON.stringify(qualified, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(qualified)}\n`);
    return;
  }
  if (mode === 'acquire') {
    const acquired = await acquireInstaller(options);
    process.stdout.write(`${JSON.stringify(acquired)}\n`);
    return;
  }
  throw new ProvenanceError('mode_unknown', { mode: mode || null });
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    fail(error);
  });
}

export {
  ProvenanceError,
  parseArgs,
  writeProvenance,
  verifyInstaller,
  resolveRun,
  waitRun,
  downloadArtifact,
  acquireInstaller,
};
