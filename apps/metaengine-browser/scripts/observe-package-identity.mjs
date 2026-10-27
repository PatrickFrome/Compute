#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const POLICY = Object.freeze({
  repository: 'PatrickFrome/Compute', repositoryId: 1341371143,
  workflow: '.github/workflows/browser-package-identity-observation.yml',
  refs: Object.freeze(['refs/heads/work/preinstall-shared-inputs-20261027', 'refs/heads/work/preinstall-closure-20261027']),
  producerWorkflow: '.github/workflows/browser-windows-package-smoke.yml', producerWorkflowId: 347795280,
  planner: 'apps/metaengine-browser/scripts/package-build-reservation.mjs',
  plannerBlob: '1aee544ed7b99898cbde34494bd80a4620b63d34',
  knownFloor: '0.7.0-dev.1784381341133.1',
  originalRun: 40382079975, originalHead: '601532ca50db02aa9089783dde157a93f484adf2',
  reservationId: 12678978941,
  reservationDigest: 'sha256:9a1084542301e68ac333860fa810d59cbf790294774b181e053a85dccea27024',
  candidateId: 12679249312,
  candidateDigest: 'sha256:28126ee94d99c59040b1e2f5f215556d148da3f1933198ced5919323ce0881f4',
  maxCatalogPages: 500, maxProducerRuns: 128, maxRequests: 700, maxObservationMs: 12 * 60_000,
  maxResponseBytes: 2 * 1024 * 1024, maxReadBytes: 96 * 1024 * 1024,
  maxEvidenceBytes: 48 * 1024 * 1024,
});

const API = 'https://api.github.com';
const PREFIX = `/repos/${POLICY.repository}/actions/`;
const VERSION_PREFIX = 'metaengine-browser-package-version-';
const CANDIDATE_PREFIX = 'metaengine-browser-windows-candidate-';
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^0\.7\.0-dev\.([0-9]+)\.1$/;
const FALSE_AUTHORITY = Object.freeze({
  selected_version: false, reservation_created: false, package_built: false,
  physical_package_build_allowed: false, promotion_authorized: false, authority_effect: false,
  automatic_retry_allowed: false,
});
const PLANNER_FAILURES = new Set([
  'PACKAGE_IDENTITY_RERUN_REQUIRES_NEW_SOURCE_AND_VERSION',
  'PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED', 'PACKAGE_IDENTITY_SOURCE_ALREADY_BUILT',
  'PACKAGE_IDENTITY_CANDIDATES_EXHAUSTED', 'PACKAGE_IDENTITY_CANDIDATE_SEQUENCE_COLLISION',
  'PACKAGE_BUILD_RESERVATION_API_UNAVAILABLE', 'PACKAGE_BUILD_RESERVATION_API_SHAPE_INVALID',
]);

function hold(code) { throw Object.assign(new Error(code), { code }); }
function requireThat(value, code) { if (!value) hold(code); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function text(value, max = 512) {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function serial(version) {
  requireThat(text(version, 96) && VERSION.test(version), 'OBSERVATION_VERSION_INVALID');
  return BigInt(VERSION.exec(version)[1]);
}
function iso(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(value) ? value : null; }
const hash = value => createHash('sha256').update(value).digest('hex');

export function contextFromEnv(env) {
  requireThat(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted', 'OBSERVATION_HOSTED_CONTEXT_REQUIRED');
  requireThat(env.GITHUB_REPOSITORY === POLICY.repository && env.GITHUB_REPOSITORY_ID === String(POLICY.repositoryId), 'OBSERVATION_REPOSITORY_MISMATCH');
  requireThat(env.GITHUB_EVENT_NAME === 'push' && POLICY.refs.includes(env.GITHUB_REF), 'OBSERVATION_REF_NOT_ALLOWED');
  requireThat(SHA.test(env.EXPECTED_HEAD || '') && env.GITHUB_SHA === env.EXPECTED_HEAD, 'OBSERVATION_SOURCE_MISMATCH');
  requireThat(env.GITHUB_WORKFLOW_SHA === env.EXPECTED_HEAD
    && env.GITHUB_WORKFLOW_REF === `${POLICY.repository}/${POLICY.workflow}@${env.GITHUB_REF}`, 'OBSERVATION_WORKFLOW_MISMATCH');
  const runId = Number(env.GITHUB_RUN_ID), runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  requireThat(/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') && positive(runId), 'OBSERVATION_RUN_INVALID');
  requireThat(env.GITHUB_RUN_ATTEMPT === '1' && runAttempt === 1, 'OBSERVATION_RERUN_REFUSED');
  return Object.freeze({ repository: POLICY.repository, sourceHead: env.EXPECTED_HEAD,
    ref: env.GITHUB_REF, runId, runAttempt });
}

export function sanitizeArtifact(row) {
  requireThat(row && positive(row.id) && text(row.name) && row.name.length > 0, 'OBSERVATION_ARTIFACT_SHAPE_INVALID');
  const run = row.workflow_run;
  return {
    id: row.id, name: row.name, expired: row.expired === true,
    size_in_bytes: Number.isSafeInteger(row.size_in_bytes) && row.size_in_bytes >= 0 ? row.size_in_bytes : null,
    digest: typeof row.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(row.digest) ? row.digest : null,
    created_at: iso(row.created_at), expires_at: iso(row.expires_at),
    workflow_run: run && positive(run.id) ? {
      id: run.id, repository_id: positive(run.repository_id) ? run.repository_id : null,
      head_repository_id: positive(run.head_repository_id) ? run.head_repository_id : null,
      head_sha: SHA.test(run.head_sha || '') ? run.head_sha : null,
    } : null,
  };
}

export function sanitizeRun(row) {
  requireThat(row && positive(row.id) && positive(row.workflow_id), 'OBSERVATION_RUN_SHAPE_INVALID');
  const repo = value => value && positive(value.id) && text(value.full_name, 256)
    ? { id: value.id, full_name: value.full_name } : null;
  return {
    id: row.id, workflow_id: row.workflow_id,
    path: text(row.path, 256) ? row.path : null,
    head_sha: SHA.test(row.head_sha || '') ? row.head_sha : null,
    head_branch: text(row.head_branch, 256) ? row.head_branch : null,
    run_attempt: positive(row.run_attempt) ? row.run_attempt : null,
    event: ['push', 'pull_request', 'workflow_dispatch'].includes(row.event) ? row.event : null,
    status: ['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(row.status) ? row.status : null,
    conclusion: row.conclusion === null ? null
      : ['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale', 'startup_failure'].includes(row.conclusion) ? row.conclusion : 'UNRECOGNIZED',
    repository: repo(row.repository), head_repository: repo(row.head_repository),
    created_at: iso(row.created_at), updated_at: iso(row.updated_at),
  };
}

function sanitizeResponse(payload, kind) {
  if (kind === 'run') return sanitizeRun(payload);
  if (kind === 'artifact') return sanitizeArtifact(payload);
  requireThat(payload && Number.isSafeInteger(payload.total_count) && payload.total_count >= 0
    && Array.isArray(payload.artifacts) && payload.artifacts.length <= 100, 'OBSERVATION_LIST_SHAPE_INVALID');
  return { total_count: payload.total_count, artifacts: payload.artifacts.map(sanitizeArtifact) };
}

export function createGitHubReader({ token, records, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() }) {
  requireThat(typeof token === 'string' && token.length > 0, 'OBSERVATION_TOKEN_REQUIRED');
  let requests = 0, totalBytes = 0;
  const started = performance.now();
  return async (route, kind) => {
    requireThat(route.startsWith(PREFIX) && !route.includes('#') && !route.includes('\\') && !/[\r\n]/.test(route), 'OBSERVATION_API_ROUTE_INVALID');
    requireThat(++requests <= POLICY.maxRequests, 'OBSERVATION_REQUEST_BOUND_EXCEEDED');
    requireThat(performance.now() - started < POLICY.maxObservationMs, 'OBSERVATION_TIME_BOUND_EXCEEDED');
    const record = { method: 'GET', url: API + route, started_at: now(), completed_at: null, status: null };
    records.push(record);
    try {
      const response = await fetchImpl(API + route, { method: 'GET', redirect: 'error',
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10',
          authorization: `Bearer ${token}`, 'user-agent': 'metaengine-package-identity-observation-v1' },
        signal: AbortSignal.timeout(10_000) });
      record.status = response.status;
      record.headers = Object.fromEntries(['date', 'etag', 'x-github-request-id', 'link'].map(key => {
        const value = response.headers.get(key);
        return [key, value === null || (text(value, 2048) && !value.includes(token)) ? value : null];
      }));
      requireThat(response.status === 200, 'OBSERVATION_API_UNAVAILABLE');
      const parts = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength; totalBytes += chunk.byteLength;
        requireThat(bytes <= POLICY.maxResponseBytes && totalBytes <= POLICY.maxReadBytes, 'OBSERVATION_RESPONSE_BOUND_EXCEEDED');
        parts.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(parts);
      record.response_sha256 = hash(raw); record.response_bytes = raw.length;
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch { hold('OBSERVATION_RESPONSE_JSON_INVALID'); }
      const sanitized = sanitizeResponse(payload, kind);
      requireThat(!JSON.stringify(sanitized).includes(token), 'OBSERVATION_SECRET_IN_RESPONSE');
      record.response = sanitized;
      return sanitized;
    } catch (error) {
      // Never retain network exception text, request headers, tokens or raw bodies.
      if (typeof error?.code === 'string' && /^OBSERVATION_[A-Z_]+$/.test(error.code)) throw error;
      hold('OBSERVATION_API_UNAVAILABLE');
    } finally { record.completed_at = now(); }
  };
}

function sameRepository(run) {
  return run.repository?.id === POLICY.repositoryId && run.repository?.full_name === POLICY.repository
    && run.head_repository?.id === POLICY.repositoryId && run.head_repository?.full_name === POLICY.repository;
}

export function verifyObserverRun(run, context) {
  requireThat(sameRepository(run) && run.id === context.runId && run.run_attempt === 1
    && run.path === POLICY.workflow && run.event === 'push' && run.head_sha === context.sourceHead
    && `refs/heads/${run.head_branch}` === context.ref
    && run.status === 'in_progress' && run.conclusion === null, 'OBSERVATION_CURRENT_RUN_MISMATCH');
}

function verifyProducerRun(run, artifact, original = false) {
  requireThat(sameRepository(run) && run.id === artifact.workflow_run?.id && run.run_attempt === 1
    && run.workflow_id === POLICY.producerWorkflowId && run.path === POLICY.producerWorkflow
    && ['push', 'pull_request'].includes(run.event) && run.head_sha === artifact.workflow_run?.head_sha
    && artifact.workflow_run?.repository_id === POLICY.repositoryId
    && artifact.workflow_run?.head_repository_id === POLICY.repositoryId
    && run.status !== null && run.conclusion !== 'UNRECOGNIZED', 'OBSERVATION_CONSUMED_PRODUCER_MISMATCH');
  if (original) requireThat(run.id === POLICY.originalRun && run.head_sha === POLICY.originalHead
    && run.status === 'completed' && run.conclusion === 'success', 'OBSERVATION_ORIGINAL_PRODUCER_NOT_SUCCESS');
}

function verifyOriginalArtifact(row, kind) {
  const reservation = kind === 'reservation';
  requireThat(row.id === (reservation ? POLICY.reservationId : POLICY.candidateId)
    && row.name === (reservation ? VERSION_PREFIX + POLICY.knownFloor : CANDIDATE_PREFIX + POLICY.originalHead)
    && row.digest === (reservation ? POLICY.reservationDigest : POLICY.candidateDigest)
    && row.workflow_run?.id === POLICY.originalRun && row.workflow_run?.head_sha === POLICY.originalHead
    && row.workflow_run?.repository_id === POLICY.repositoryId
    && row.workflow_run?.head_repository_id === POLICY.repositoryId, 'OBSERVATION_ORIGINAL_ARTIFACT_MISMATCH');
}

export async function readCompleteCatalog(get) {
  const route = page => `${PREFIX}artifacts?per_page=100&page=${page}`;
  const first = await get(route(1), 'list');
  const total = first.total_count;
  const pages = Math.max(1, Math.ceil(total / 100));
  requireThat(pages <= POLICY.maxCatalogPages, 'OBSERVATION_CATALOG_BOUND_EXCEEDED');
  const artifacts = [], ids = new Set();
  for (let page = 1; page <= pages; page++) {
    const body = page === 1 ? first : await get(route(page), 'list');
    requireThat(body.total_count === total && body.artifacts.length === Math.max(0, Math.min(100, total - (page - 1) * 100)), 'OBSERVATION_CATALOG_INCOMPLETE');
    for (const artifact of body.artifacts) {
      requireThat(!ids.has(artifact.id), 'OBSERVATION_CATALOG_DUPLICATE');
      ids.add(artifact.id); artifacts.push(artifact);
    }
  }
  requireThat(artifacts.length === total, 'OBSERVATION_CATALOG_INCOMPLETE');
  return { artifacts, total, pages, first, firstRoute: route(1) };
}

export function validatePlan(plan, context, packageVersion, floor) {
  requireThat(plan && plan.schema === 'metaengine.browser.package-identity-candidate-plan.v1'
    && plan.source_head === context.sourceHead && plan.manifest_package_version === packageVersion
    && plan.minimum_package_version === floor && plan.minimum_package_version_exclusive === true
    && plan.physical_package_build_allowed === false && plan.promotion_authorized === false
    && plan.authority_effect === false && serial(plan.candidate_package_version) > serial(floor), 'OBSERVATION_PLAN_BINDING_INVALID');
  const rejected = plan.rejected_reserved_candidate_versions ?? [];
  requireThat(Array.isArray(rejected) && rejected.length <= 3 && new Set(rejected).size === rejected.length
    && rejected.every(version => serial(version) > serial(floor)), 'OBSERVATION_PLAN_BOUND_INVALID');
  if (plan.manifest_update_required === false) {
    requireThat(plan.candidate_slot === null && plan.candidate_package_version === packageVersion && rejected.length === 0, 'OBSERVATION_PLAN_BOUND_INVALID');
  } else {
    requireThat(plan.manifest_update_required === true && Number.isInteger(plan.candidate_slot)
      && plan.candidate_slot >= 0 && plan.candidate_slot < 4 && rejected.length === plan.candidate_slot
      && !rejected.includes(plan.candidate_package_version) && plan.candidate_package_version !== packageVersion, 'OBSERVATION_PLAN_BOUND_INVALID');
  }
  // Rebuild an explicit allowlist instead of publishing arbitrary child stdout.
  return { schema: plan.schema, source_head: context.sourceHead, manifest_package_version: packageVersion,
    minimum_package_version: floor, minimum_package_version_exclusive: true,
    candidate_package_version: plan.candidate_package_version, candidate_slot: plan.candidate_slot,
    ...(plan.manifest_update_required ? { rejected_reserved_candidate_versions: rejected } : {}),
    manifest_update_required: plan.manifest_update_required,
    physical_package_build_allowed: false, promotion_authorized: false, authority_effect: false };
}

export function runPlannerCli({ root, context, packageVersion, floor, env = process.env, spawn = spawnSync }) {
  const args = [join(root, POLICY.planner), '--plan-distinct', '--repository', POLICY.repository,
    '--source-head', context.sourceHead, '--package-version', packageVersion,
    '--minimum-package-version', floor, '--run-id', String(context.runId), '--run-attempt', '1', '--api-base', API];
  const childEnv = { ...env }; delete childEnv.NODE_OPTIONS; delete childEnv.NODE_PATH;
  const result = spawn(process.execPath, args, { cwd: root, env: childEnv, encoding: 'utf8',
    timeout: 90_000, maxBuffer: 256 * 1024, windowsHide: true, shell: false });
  if (result.error || result.signal || result.status !== 0) {
    let code;
    try { code = JSON.parse(result.stderr.trim()).code; } catch { /* untrusted diagnostics are omitted */ }
    hold(PLANNER_FAILURES.has(code) ? code : 'OBSERVATION_PLANNER_PROCESS_FAILED');
  }
  let plan;
  try { plan = JSON.parse(result.stdout.trim()); } catch { hold('OBSERVATION_PLANNER_OUTPUT_INVALID'); }
  return validatePlan(plan, context, packageVersion, floor);
}

export async function observeIdentity({ context, packageVersion, get, runPlanner, evidence }) {
  serial(packageVersion);
  verifyObserverRun(await get(`${PREFIX}runs/${context.runId}`, 'run'), context);
  const reservation = await get(`${PREFIX}artifacts/${POLICY.reservationId}`, 'artifact');
  const candidate = await get(`${PREFIX}artifacts/${POLICY.candidateId}`, 'artifact');
  verifyOriginalArtifact(reservation, 'reservation'); verifyOriginalArtifact(candidate, 'candidate');
  const originalRun = await get(`${PREFIX}runs/${POLICY.originalRun}`, 'run');
  verifyProducerRun(originalRun, reservation, true); verifyProducerRun(originalRun, candidate, true);
  evidence.original_consumed_identity = { version: POLICY.knownFloor, producer: originalRun, reservation, candidate };

  const catalog = await readCompleteCatalog(get);
  verifyOriginalArtifact(catalog.artifacts.find(row => row.id === POLICY.reservationId) ?? {}, 'reservation');
  verifyOriginalArtifact(catalog.artifacts.find(row => row.id === POLICY.candidateId) ?? {}, 'candidate');
  requireThat(!catalog.artifacts.some(row => row.workflow_run?.id === context.runId
    && (row.name.startsWith(VERSION_PREFIX) || row.name.startsWith(CANDIDATE_PREFIX))), 'OBSERVATION_CURRENT_RUN_HAS_PRODUCER_ARTIFACT');
  // Positive evidence must remain a refusal even if the artifact disappears
  // before the CLI's separate live lookup. Expiry never permits replay.
  requireThat(!catalog.artifacts.some(row => row.name === CANDIDATE_PREFIX + context.sourceHead), 'OBSERVATION_SOURCE_ALREADY_BUILT');
  let floor = POLICY.knownFloor;
  const runs = new Map([[POLICY.originalRun, originalRun]]), confirmed = [reservation];
  for (const artifact of catalog.artifacts) {
    if (!artifact.name.startsWith(VERSION_PREFIX)) continue;
    const version = artifact.name.slice(VERSION_PREFIX.length);
    if (serial(version) <= serial(POLICY.knownFloor)) continue;
    requireThat(positive(artifact.workflow_run?.id) && artifact.digest !== null, 'OBSERVATION_CONSUMED_METADATA_INVALID');
    if (!runs.has(artifact.workflow_run.id)) {
      requireThat(runs.size < POLICY.maxProducerRuns, 'OBSERVATION_PRODUCER_BOUND_EXCEEDED');
      runs.set(artifact.workflow_run.id, await get(`${PREFIX}runs/${artifact.workflow_run.id}`, 'run'));
    }
    verifyProducerRun(runs.get(artifact.workflow_run.id), artifact);
    confirmed.push(artifact);
    if (serial(version) > serial(floor)) floor = version;
  }
  evidence.catalog = { complete: false, pagination_complete: true, total_count: catalog.total, pages: catalog.pages,
    consistency: 'STABLE_TOTAL_UNIQUE_IDS_AND_FIRST_PAGE_RECHECK_REQUIRED',
    global_absence_claim: false, observation_is_time_bound: true };
  evidence.confirmed_consumed_reservations = confirmed;
  evidence.minimum_package_version = floor;
  requireThat(serial(floor) >= serial(POLICY.knownFloor), 'OBSERVATION_FLOOR_UNPROVEN');
  const plan = validatePlan(await runPlanner(floor), context, packageVersion, floor);

  // The unchanged CLI performs its own live per-name GETs. Independently retain
  // complete live readbacks here; none of these responses is injected into it.
  const observations = [
    [CANDIDATE_PREFIX + context.sourceHead, 'absent'],
    [VERSION_PREFIX + packageVersion, 'observed'],
    ...(plan.rejected_reserved_candidate_versions ?? []).map(version => [VERSION_PREFIX + version, 'occupied']),
    [VERSION_PREFIX + plan.candidate_package_version, 'absent'],
  ];
  for (const [name, expectation] of observations) {
    const body = await get(`${PREFIX}artifacts?name=${encodeURIComponent(name)}&per_page=100`, 'list');
    requireThat(body.total_count === body.artifacts.length && body.artifacts.every(row => row.name === name), 'OBSERVATION_EXACT_NAME_INCOMPLETE');
    requireThat(!body.artifacts.some(row => row.workflow_run?.id === context.runId), 'OBSERVATION_CURRENT_RUN_HAS_PRODUCER_ARTIFACT');
    if (expectation === 'absent') requireThat(body.total_count === 0, 'OBSERVATION_POST_PLAN_COLLISION');
    if (expectation === 'occupied') requireThat(body.total_count > 0, 'OBSERVATION_POST_PLAN_COLLISION_DISAPPEARED');
  }
  const endFirst = await get(catalog.firstRoute, 'list');
  requireThat(JSON.stringify(endFirst) === JSON.stringify(catalog.first), 'OBSERVATION_CATALOG_CHANGED');
  verifyObserverRun(await get(`${PREFIX}runs/${context.runId}`, 'run'), context);
  evidence.catalog.complete = true;
  evidence.catalog.consistency = 'STABLE_TOTAL_UNIQUE_IDS_AND_FIRST_PAGE_RECHECK';
  evidence.post_plan_complete_name_readbacks = true;
  return plan;
}

export function checkoutFacts(root, expectedHead) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  requireThat(git('rev-parse', 'HEAD') === expectedHead && git('status', '--porcelain', '--untracked-files=all') === '', 'OBSERVATION_CHECKOUT_NOT_EXACT_CLEAN');
  const plannerBlob = git('rev-parse', `HEAD:${POLICY.planner}`);
  requireThat(plannerBlob === POLICY.plannerBlob && git('hash-object', POLICY.planner) === plannerBlob, 'OBSERVATION_PLANNER_CHANGED');
  const pkg = JSON.parse(readFileSync(join(root, 'apps/metaengine-browser/package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'apps/metaengine-browser/package-lock.json'), 'utf8'));
  serial(pkg.version);
  requireThat(pkg.name === '@metaengine/browser-shell' && pkg.version === lock.version
    && pkg.version === lock.packages?.['']?.version, 'OBSERVATION_PACKAGE_LOCK_MISMATCH');
  return { source_head: expectedHead, source_tree: git('rev-parse', 'HEAD^{tree}'),
    observer_git_blob: git('rev-parse', 'HEAD:apps/metaengine-browser/scripts/observe-package-identity.mjs'),
    planner_git_blob: plannerBlob, planner_sha256: hash(readFileSync(join(root, POLICY.planner))),
    manifest_package_version: pkg.version };
}

export function writeReports(directory, evidence, plan, code, maxBytes = POLICY.maxEvidenceBytes) {
  let status = { schema: 'metaengine.browser.package-identity-observation-status.v1',
    disposition: code ? 'HOLD' : 'PLAN_OBSERVED_NOT_RESERVED', code: code || null,
    ...FALSE_AUTHORITY };
  evidence.status = status;
  let files = { 'status.json': status, 'observation.json': evidence, ...(code ? {} : { 'plan.json': plan }) };
  let bytes = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, JSON.stringify(value, null, 2) + '\n']));
  if (Object.values(bytes).reduce((sum, value) => sum + Buffer.byteLength(value), 0) > maxBytes) {
    status = { ...status, disposition: 'HOLD', code: 'OBSERVATION_EVIDENCE_BOUND_EXCEEDED' };
    // Evidence truncation cannot publish a usable proposal or a successful gate.
    files = { 'status.json': status, 'observation.json': {
      schema: 'metaengine.package-planner-hosted-observation.v1', status,
      started_at: evidence.started_at, completed_at: evidence.completed_at,
      source_head: evidence.source_head, observing_run_id: evidence.observing_run_id,
      response_payloads_omitted_due_bound: true, observed_requests: evidence.queries?.length ?? 0,
      ...FALSE_AUTHORITY,
    } };
    bytes = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, JSON.stringify(value, null, 2) + '\n']));
  }
  for (const [name, body] of Object.entries(bytes)) writeFileSync(join(directory, name), body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return status;
}

async function main() {
  // The only output location is a newly created directory in the hosted runner's
  // ephemeral temp area. No checkout, package identity or reservation is written.
  requireThat(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
    && typeof process.env.RUNNER_TEMP === 'string' && process.env.RUNNER_TEMP.length > 0, 'OBSERVATION_HOSTED_CONTEXT_REQUIRED');
  const directory = join(resolve(process.env.RUNNER_TEMP), 'browser-package-identity-observation');
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const evidence = { schema: 'metaengine.package-planner-hosted-observation.v1',
    observer: 'LIVE_GITHUB_GETS_AND_UNCHANGED_PLANNER_CLI_IN_THIS_HOSTED_RUN',
    started_at: new Date().toISOString(), queries: [], ...FALSE_AUTHORITY };
  let code = null, plan = null;
  try {
    const context = contextFromEnv(process.env);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const facts = checkoutFacts(root, context.sourceHead);
    Object.assign(evidence, facts, { observing_run_id: context.runId, observing_run_attempt: context.runAttempt, source_ref: context.ref });
    const get = createGitHubReader({ token: process.env.ME2_GITHUB_TOKEN, records: evidence.queries });
    plan = await observeIdentity({ context, packageVersion: facts.manifest_package_version, get, evidence,
      runPlanner: floor => runPlannerCli({ root, context, packageVersion: facts.manifest_package_version, floor }) });
    // The observer must not have modified the checked-out source while reading.
    checkoutFacts(root, context.sourceHead);
  } catch (error) {
    code = /^OBSERVATION_[A-Z_]+$/.test(error?.code || '') || PLANNER_FAILURES.has(error?.code)
      ? error.code : 'OBSERVATION_FAILED';
  }
  evidence.completed_at = new Date().toISOString();
  const status = writeReports(directory, evidence, plan, code);
  process.stdout.write(JSON.stringify(status) + '\n');
  if (status.disposition === 'HOLD') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('package_identity_observation_failed_closed\n'); process.exitCode = 1; });
}
