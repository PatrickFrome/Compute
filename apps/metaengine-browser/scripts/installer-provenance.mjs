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
//   acquire  - resolve + download in one step
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
import { pathToFileURL } from 'node:url';

const PROVENANCE_SCHEMA = 'metaengine.browser.installer-provenance.v1';
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

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, Math.max(0, ms));
  });
}

async function resolveRun(options) {
  const head = requireHeadShape(requireOption(options, 'head'));
  const workflow = requireOption(options, 'workflow');
  const token = tokenFrom(options);
  const repository = repositoryFrom(options);
  const apiBase = apiBaseFrom(options);
  const timeoutMin = Number(options['timeout-min'] === undefined ? 45 : options['timeout-min']);
  const intervalSec = Number(options['interval-sec'] === undefined ? 30 : options['interval-sec']);
  const absentGraceMin = Number(options['absent-grace-min'] === undefined ? 10 : options['absent-grace-min']);
  if (!Number.isFinite(timeoutMin) || timeoutMin < 0 || !Number.isFinite(intervalSec) || intervalSec < 0 || !Number.isFinite(absentGraceMin) || absentGraceMin < 0) {
    throw new ProvenanceError('option_invalid', { timeoutMin, intervalSec, absentGraceMin });
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
    } catch (error) {
      consecutiveApiErrors += 1;
      if (consecutiveApiErrors > 10) {
        throw error;
      }
      newest = undefined;
    }

    if (newest !== null && newest !== undefined) {
      if (newest.status === 'completed') {
        if (newest.conclusion === 'success') {
          return {
            schema: RESOLVED_SCHEMA,
            repository,
            workflow,
            head_sha: head,
            run_id: String(newest.id),
            run_number: Number(newest.run_number),
            resolved_at: new Date().toISOString(),
          };
        }
        throw new ProvenanceError('installer_provenance_producer_failed', {
          run_id: String(newest.id),
          run_number: Number(newest.run_number),
          conclusion: newest.conclusion,
        });
      }
      absentSince = null;
    } else if (newest === null) {
      if (absentSince === null) {
        absentSince = Date.now();
      }
      if (Date.now() - absentSince > absentGraceMin * 60000) {
        throw new ProvenanceError('installer_provenance_run_absent', { head, workflow });
      }
    }

    if (Date.now() >= deadline) {
      throw new ProvenanceError('installer_provenance_timeout', { head, workflow, timeout_min: timeoutMin });
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
  const match = artifacts.find((artifact) => artifact.name === artifactName);
  if (!match) {
    throw new ProvenanceError('artifact_not_found', { artifact: artifactName, run_id: runId });
  }
  if (match.expired) {
    throw new ProvenanceError('artifact_expired', { artifact: artifactName, run_id: runId });
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
  const stats = statSync(installerPath);
  if (Number(provenance.installer_bytes) !== stats.size) {
    throw new ProvenanceError('size_mismatch', { provenance_bytes: Number(provenance.installer_bytes), actual_bytes: stats.size });
  }
  const actualSha256 = await sha256File(installerPath);
  if (String(provenance.installer_sha256) !== actualSha256) {
    throw new ProvenanceError('sha_mismatch', { provenance_sha256: provenance.installer_sha256, actual_sha256: actualSha256 });
  }

  const acquired = {
    schema: ACQUIRED_SCHEMA,
    installer_path: isAbsolute(installerPath) ? installerPath : resolve(installerPath),
    installer_name: installerName,
    installer_sha256: actualSha256,
    installer_bytes: stats.size,
    source_head: provenance.source_head || null,
    provenance_run_id: provenance.run_id || null,
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
  downloadArtifact,
  acquireInstaller,
};
