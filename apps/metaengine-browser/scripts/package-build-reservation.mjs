#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/;
const DEV_VERSION = /^0\.7\.0-dev\.[0-9]+\.1$/;
const DIGITS = /^[0-9]+$/;

function required(value, code) {
  const text = String(value || '').trim();
  if (!text) throw new Error(code);
  return text;
}

function positiveInt(value, code) {
  const text = required(value, code);
  if (!DIGITS.test(text)) throw new Error(code);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(code);
  return parsed;
}

export function reservationArtifactName(packageVersion) {
  const version = required(packageVersion, 'package_build_reservation_version_missing');
  if (!DEV_VERSION.test(version)) throw new Error('package_build_reservation_version_invalid');
  return `metaengine-browser-package-version-${version}`;
}

export function candidateArtifactName(sourceHead) {
  const head = required(sourceHead, 'package_build_reservation_source_head_missing').toLowerCase();
  if (!SHA40.test(head)) throw new Error('package_build_reservation_source_head_invalid');
  return `metaengine-browser-windows-candidate-${head}`;
}

function normalizeArtifact(row) {
  if (!row || typeof row !== 'object') return null;
  const runId = Number(row.workflow_run?.id || 0);
  const head = String(row.workflow_run?.head_sha || '').toLowerCase();
  return {
    id: Number(row.id || 0),
    name: String(row.name || ''),
    expired: row.expired === true,
    run_id: Number.isSafeInteger(runId) && runId > 0 ? runId : null,
    head_sha: SHA40.test(head) ? head : null,
    created_at: String(row.created_at || '') || null,
    digest: String(row.digest || '') || null,
  };
}

export function evaluatePackageBuildReservation({
  repository,
  sourceHead,
  packageVersion,
  runId,
  runAttempt,
  versionArtifacts = [],
  sourceArtifacts = [],
} = {}) {
  const repo = required(repository, 'package_build_reservation_repository_missing');
  if (!repo.includes('/')) throw new Error('package_build_reservation_repository_invalid');
  const head = required(sourceHead, 'package_build_reservation_source_head_missing').toLowerCase();
  if (!SHA40.test(head)) throw new Error('package_build_reservation_source_head_invalid');
  const version = required(packageVersion, 'package_build_reservation_version_missing');
  if (!DEV_VERSION.test(version)) throw new Error('package_build_reservation_version_invalid');
  const currentRunId = positiveInt(runId, 'package_build_reservation_run_id_invalid');
  const attempt = positiveInt(runAttempt, 'package_build_reservation_run_attempt_invalid');

  if (attempt !== 1) {
    throw Object.assign(new Error('package_identity_rerun_requires_new_source_and_version'), {
      code: 'PACKAGE_IDENTITY_RERUN_REQUIRES_NEW_SOURCE_AND_VERSION',
      details: { run_id: currentRunId, run_attempt: attempt, package_version: version, source_head: head },
    });
  }

  const priorVersion = (Array.isArray(versionArtifacts) ? versionArtifacts : [])
    .map(normalizeArtifact)
    .filter(Boolean)
    .filter((artifact) =>
      artifact.name === reservationArtifactName(version)
      && artifact.run_id !== currentRunId
    );

  if (priorVersion.length > 0) {
    const prior = priorVersion[0];
    throw Object.assign(new Error('package_identity_version_already_reserved'), {
      code: 'PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED',
      details: {
        package_version: version,
        source_head: head,
        current_run_id: currentRunId,
        prior_artifact_id: prior.id,
        prior_run_id: prior.run_id,
        prior_source_head: prior.head_sha,
      },
    });
  }

  const priorSource = (Array.isArray(sourceArtifacts) ? sourceArtifacts : [])
    .map(normalizeArtifact)
    .filter(Boolean)
    .filter((artifact) =>
      artifact.name === candidateArtifactName(head)
      && artifact.run_id !== currentRunId
    );

  if (priorSource.length > 0) {
    const prior = priorSource[0];
    throw Object.assign(new Error('package_identity_source_already_built'), {
      code: 'PACKAGE_IDENTITY_SOURCE_ALREADY_BUILT',
      details: {
        package_version: version,
        source_head: head,
        current_run_id: currentRunId,
        prior_artifact_id: prior.id,
        prior_run_id: prior.run_id,
        prior_source_head: prior.head_sha,
      },
    });
  }

  return Object.freeze({
    schema: 'metaengine.browser.package-build-reservation-preflight.v1',
    repository: repo,
    source_head: head,
    package_version: version,
    run_id: currentRunId,
    run_attempt: attempt,
    reservation_artifact_name: reservationArtifactName(version),
    candidate_artifact_name: candidateArtifactName(head),
    prior_version_artifact_count: 0,
    prior_source_candidate_count: 0,
    physical_package_build_allowed: true,
    automatic_retry_allowed: false,
    promotion_authorized: false,
    authority_effect: false,
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function githubJson(url, token) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2026-03-10',
    'user-agent': 'metaengine-package-build-reservation-v1',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await fetch(url, { headers, signal: controller.signal });
  } catch (error) {
    throw Object.assign(new Error('package_build_reservation_api_unavailable'), {
      code: 'PACKAGE_BUILD_RESERVATION_API_UNAVAILABLE',
      details: { message: String(error?.message || error).slice(0, 240) },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw Object.assign(new Error('package_build_reservation_api_unavailable'), {
      code: 'PACKAGE_BUILD_RESERVATION_API_UNAVAILABLE',
      details: { status: response.status },
    });
  }
  return response.json();
}

async function listArtifactsByName({ repository, name, token, apiBase }) {
  const url = new URL(`/repos/${repository}/actions/artifacts`, apiBase);
  url.searchParams.set('name', name);
  url.searchParams.set('per_page', '100');
  const payload = await githubJson(url, token);
  if (!payload || !Array.isArray(payload.artifacts)) {
    throw Object.assign(new Error('package_build_reservation_api_shape_invalid'), {
      code: 'PACKAGE_BUILD_RESERVATION_API_SHAPE_INVALID',
    });
  }
  return payload.artifacts;
}

export async function observeAndEvaluatePackageBuildReservation({
  repository,
  sourceHead,
  packageVersion,
  runId,
  runAttempt,
  token,
  apiBase = 'https://api.github.com',
} = {}) {
  const versionName = reservationArtifactName(packageVersion);
  const sourceName = candidateArtifactName(sourceHead);
  const [versionPayload, sourcePayload] = await Promise.all([
    listArtifactsByName({ repository, name: versionName, token, apiBase }),
    listArtifactsByName({ repository, name: sourceName, token, apiBase }),
  ]);
  return evaluatePackageBuildReservation({
    repository,
    sourceHead,
    packageVersion,
    runId,
    runAttempt,
    versionArtifacts: versionPayload,
    sourceArtifacts: sourcePayload,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const proof = await observeAndEvaluatePackageBuildReservation({
    repository: args.repository || process.env.GITHUB_REPOSITORY,
    sourceHead: args['source-head'] || process.env.ME2_SOURCE_HEAD || process.env.GITHUB_SHA,
    packageVersion: args['package-version'],
    runId: args['run-id'] || process.env.GITHUB_RUN_ID,
    runAttempt: args['run-attempt'] || process.env.GITHUB_RUN_ATTEMPT,
    token: args.token || process.env.ME2_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '',
    apiBase: args['api-base'] || process.env.GITHUB_API_URL || 'https://api.github.com',
  });
  const json = `${JSON.stringify(proof, null, 2)}\n`;
  if (args.out && args.out !== true) writeFileSync(resolve(String(args.out)), json, 'utf8');
  process.stdout.write(`${JSON.stringify(proof)}\n`);
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schema: 'metaengine.browser.package-build-reservation-error.v1',
      code: String(error?.code || error?.message || 'package_build_reservation_failed'),
      message: String(error?.message || error).slice(0, 500),
      details: error?.details || null,
      authority_effect: false,
    })}\n`);
    process.exitCode = 1;
  });
}
