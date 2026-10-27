import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  POLICY, contextFromEnv, createGitHubReader, observeIdentity, readCompleteCatalog,
  runPlannerCli, sanitizeArtifact, sanitizeRun, validatePlan, verifyObserverRun, writeReports, observationCounts,
} from '../scripts/observe-package-identity.mjs';

// All contexts and responses below are isolated test fixtures. Production only
// reaches live GitHub GETs and the unchanged CLI; no offline input exists there.
const SOURCE = 'b'.repeat(40), RUN = 99000000001;
const CONTEXT = { repository: POLICY.repository, sourceHead: SOURCE, ref: POLICY.refs[0], runId: RUN, runAttempt: 1 };
const BASE = `/repos/${POLICY.repository}/actions/`;
const RESERVATION = 'metaengine-browser-package-version-';
const CANDIDATE = 'metaengine-browser-windows-candidate-';

test('public observation diagnostics contain bounded counts only, never response strings', () => {
  const url='https://api.github.com'+BASE+'artifacts?per_page=100&page=';
  const counts=observationCounts([
    {url:url+'1',status:200,response:{total_count:18000,artifacts:[],secret:'DO_NOT_PRINT'}},
    {url:url+'2',status:200,response:{total_count:18001,artifacts:[{}]}},
  ]);
  assert.deepEqual(counts,{requests:2,catalog_pages_read:2,first_total:18000,last_total:18001,last_page_items:1,last_http_status:200});
  const invalid=observationCounts([{url:url+'1',status:'DO_NOT_PRINT',response:{total_count:'DO_NOT_PRINT'}}]);
  assert.equal(invalid.last_http_status,null);assert.equal(invalid.first_total,null);
  assert.doesNotMatch(JSON.stringify([counts,invalid]),/DO_NOT_PRINT|https|secret/);
});
const repo = { id: POLICY.repositoryId, full_name: POLICY.repository };
const ENV = {
  GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: POLICY.repository,
  GITHUB_REPOSITORY_ID: String(POLICY.repositoryId), GITHUB_EVENT_NAME: 'push', GITHUB_REF: CONTEXT.ref,
  GITHUB_SHA: SOURCE, EXPECTED_HEAD: SOURCE, GITHUB_WORKFLOW_SHA: SOURCE,
  GITHUB_WORKFLOW_REF: `${POLICY.repository}/${POLICY.workflow}@${CONTEXT.ref}`,
  GITHUB_RUN_ID: String(RUN), GITHUB_RUN_ATTEMPT: '1',
};

function observer(overrides = {}) {
  return sanitizeRun({ id: RUN, workflow_id: 12345, path: POLICY.workflow, head_sha: SOURCE,
    head_branch: CONTEXT.ref.slice('refs/heads/'.length), run_attempt: 1, event: 'push',
    status: 'in_progress', conclusion: null, repository: repo, head_repository: repo, ...overrides });
}
function producer(overrides = {}) {
  return sanitizeRun({ id: POLICY.originalRun, workflow_id: POLICY.producerWorkflowId,
    path: POLICY.producerWorkflow, head_sha: POLICY.originalHead, head_branch: 'work/autonomy-continuation-20261026',
    run_attempt: 1, event: 'pull_request', status: 'completed', conclusion: 'success',
    repository: repo, head_repository: repo, ...overrides });
}
function artifact(id, name, overrides = {}) {
  return sanitizeArtifact({ id, name, expired: false, size_in_bytes: 865,
    created_at: '2026-10-26T19:03:04Z', expires_at: '2027-01-24T18:55:35Z',
    digest: POLICY.reservationDigest, workflow_run: { id: POLICY.originalRun,
      repository_id: POLICY.repositoryId, head_repository_id: POLICY.repositoryId, head_sha: POLICY.originalHead }, ...overrides });
}
const originalReservation = () => artifact(POLICY.reservationId, RESERVATION + POLICY.knownFloor);
const originalCandidate = () => artifact(POLICY.candidateId, CANDIDATE + POLICY.originalHead, { digest: POLICY.candidateDigest });
function plan(floor = POLICY.knownFloor, overrides = {}) {
  return { schema: 'metaengine.browser.package-identity-candidate-plan.v1', source_head: SOURCE,
    manifest_package_version: POLICY.knownFloor, minimum_package_version: floor, minimum_package_version_exclusive: true,
    candidate_package_version: '0.7.0-dev.1900000000000.1', candidate_slot: 0,
    rejected_reserved_candidate_versions: [], manifest_update_required: true,
    physical_package_build_allowed: false, promotion_authorized: false, authority_effect: false, ...overrides };
}
function fixture() {
  const state = { current: observer(), original: producer(), artifacts: [originalReservation(), originalCandidate()],
    producers: new Map(), calls: [], plannerCalls: [], mutation: null, evidence: { queries: [] } };
  state.get = async (route, kind) => {
    state.calls.push({ route, kind });
    const overridden = state.mutation?.(route, kind, state.calls);
    if (overridden !== undefined) return overridden;
    if (route === `${BASE}runs/${RUN}`) return state.current;
    if (route === `${BASE}runs/${POLICY.originalRun}`) return state.original;
    const run = /^.*\/runs\/(\d+)$/.exec(route);
    if (run && state.producers.has(Number(run[1]))) return state.producers.get(Number(run[1]));
    const byId = /^.*\/artifacts\/(\d+)$/.exec(route);
    if (byId) return state.artifacts.find(row => row.id === Number(byId[1]));
    const url = new URL(route, 'https://api.github.com');
    const name = url.searchParams.get('name');
    if (name) {
      assert.equal(url.searchParams.get('per_page'), '100');
      const rows = state.artifacts.filter(row => row.name === name);
      return { total_count: rows.length, artifacts: rows };
    }
    const page = Number(url.searchParams.get('page'));
    assert.ok(page >= 1);
    assert.equal(url.searchParams.get('per_page'), '100');
    return { total_count: state.artifacts.length, artifacts: state.artifacts.slice((page - 1) * 100, page * 100) };
  };
  state.runPlanner = async floor => { state.plannerCalls.push(floor); return plan(floor); };
  state.observe = () => observeIdentity({ context: CONTEXT, packageVersion: POLICY.knownFloor,
    get: state.get, runPlanner: state.runPlanner, evidence: state.evidence });
  return state;
}

test('only the actual hosted push context on the two exact refs is accepted', () => {
  assert.deepEqual(contextFromEnv(ENV), CONTEXT);
  const other = { ...ENV, GITHUB_REF: POLICY.refs[1],
    GITHUB_WORKFLOW_REF: `${POLICY.repository}/${POLICY.workflow}@${POLICY.refs[1]}` };
  assert.equal(contextFromEnv(other).ref, POLICY.refs[1]);
  for (const changes of [
    { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_RUN_ID: '0' }, { GITHUB_RUN_ID: '9007199254740992' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_SHA: 'a'.repeat(40) }, { GITHUB_WORKFLOW_SHA: 'a'.repeat(40) },
    { GITHUB_WORKFLOW_REF: `foreign/${POLICY.workflow}@${CONTEXT.ref}` },
    { GITHUB_REPOSITORY: 'foreign/Compute' }, { GITHUB_REPOSITORY_ID: '1' },
    { RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_ACTIONS: 'false' },
  ]) assert.throws(() => contextFromEnv({ ...ENV, ...changes }), /OBSERVATION_/);
});

test('live in-progress observer is valid; another head, workflow, rerun or terminal run is refused', () => {
  verifyObserverRun(observer(), CONTEXT);
  for (const overrides of [{ head_sha: 'c'.repeat(40) }, { path: POLICY.producerWorkflow }, { run_attempt: 2 },
    { head_branch: 'main' }, { status: 'completed', conclusion: 'success' },
    { repository: { id: 1, full_name: POLICY.repository } }]) {
    assert.throws(() => verifyObserverRun(observer(overrides), CONTEXT), /OBSERVATION_CURRENT_RUN_MISMATCH/);
  }
});

test('catalog traverses every required page and retains all 201 unique artifacts', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => artifact(index + 1, `unrelated-${index}`));
  const pages = [];
  const result = await readCompleteCatalog(async route => {
    const url = new URL(route, 'https://api.github.com');
    assert.equal(url.searchParams.get('per_page'), '100');
    const page = Number(url.searchParams.get('page')); pages.push(page);
    return { total_count: rows.length, artifacts: rows.slice((page - 1) * 100, page * 100) };
  });
  assert.deepEqual(pages, [1, 2, 3]); assert.equal(result.artifacts.length, 201);
});

test('partial catalog, changed totals, duplicate IDs and the finite page bound fail closed', async () => {
  const first = Array.from({ length: 100 }, (_, index) => artifact(index + 1, `row-${index}`));
  for (const second of [
    { total_count: 101, artifacts: [] },
    { total_count: 102, artifacts: [artifact(101, 'new')] },
    { total_count: 101, artifacts: [first[99]] },
  ]) {
    let calls = 0;
    await assert.rejects(() => readCompleteCatalog(async () => ++calls === 1
      ? { total_count: 101, artifacts: first } : second), /OBSERVATION_CATALOG_/);
    assert.equal(calls, 2);
  }
  let calls = 0;
  await assert.rejects(() => readCompleteCatalog(async () => { calls++; return {
    total_count: POLICY.maxCatalogPages * 100 + 1, artifacts: first }; }), /OBSERVATION_CATALOG_BOUND_EXCEEDED/);
  assert.equal(calls, 1);
});

test('100-item catalog pages preserve the same 19,500-artifact completeness bound', async () => {
  assert.equal(POLICY.catalogPageSize, 100);
  assert.equal(POLICY.maxCatalogPages, 195);
  assert.equal(POLICY.maxRequests, 700);
  assert.equal(POLICY.catalogPageSize * POLICY.maxCatalogPages, 19500);
  for (const [total, expectedPages] of [[0, 1], [100, 1], [101, 2], [200, 2], [15000, 150], [17990, 180], [19500, 195]]) {
    let calls = 0;
    const result = await readCompleteCatalog(async route => {
      const url = new URL(route, 'https://api.github.com');
      assert.equal(url.searchParams.get('per_page'), '100');
      assert.equal(Number(url.searchParams.get('page')), ++calls);
      const start = (calls - 1) * 100;
      return { total_count: total, artifacts: Array.from({ length: Math.min(100, total - start) },
        (_, index) => artifact(start + index + 1, `row-${start + index}`)) };
    });
    assert.equal(calls, expectedPages);
    assert.equal(result.pages, expectedPages);
    assert.equal(result.artifacts.length, total);
    assert.equal(new Set(result.artifacts.map(row => row.id)).size, total);
  }
  let calls = 0;
  await assert.rejects(() => readCompleteCatalog(async () => {
    calls++;
    return { total_count: 101, artifacts: Array.from({ length: 101 }, (_, index) => artifact(index + 1, `row-${index}`)) };
  }), /OBSERVATION_CATALOG_INCOMPLETE/);
  assert.equal(calls, 1);
});

test('real-boundary fixture calls planner once with confirmed floor and retains post-plan live readbacks', async () => {
  const state = fixture(), result = await state.observe();
  assert.equal(result.candidate_slot, 0); assert.deepEqual(state.plannerCalls, [POLICY.knownFloor]);
  assert.equal(state.evidence.catalog.complete, true);
  assert.equal(state.evidence.catalog.global_absence_claim, false);
  assert.equal(state.evidence.post_plan_complete_name_readbacks, true);
  assert.equal(state.calls.filter(row => row.route === `${BASE}runs/${RUN}`).length, 2);
  assert.equal(state.calls.filter(row => row.route === `${BASE}artifacts?page=1&per_page=100`).length, 2);
});

test('original producer must be completed success before any planner execution', async () => {
  for (const overrides of [{ conclusion: 'failure' }, { status: 'in_progress', conclusion: null }, { run_attempt: 2 }]) {
    const state = fixture(); state.original = producer(overrides);
    await assert.rejects(state.observe, /OBSERVATION_(ORIGINAL_PRODUCER_NOT_SUCCESS|CONSUMED_PRODUCER_MISMATCH)/);
    assert.equal(state.plannerCalls.length, 0);
  }
});

test('original reservation digest and same-producer candidate binding cannot be substituted', async () => {
  for (const mutate of [
    state => { state.artifacts[0].digest = `sha256:${'0'.repeat(64)}`; },
    state => { state.artifacts[1].workflow_run.id++; },
    state => { state.artifacts[1].workflow_run.head_sha = SOURCE; },
  ]) {
    const state = fixture(); mutate(state);
    await assert.rejects(state.observe, /OBSERVATION_ORIGINAL_ARTIFACT_MISMATCH/);
    assert.equal(state.plannerCalls.length, 0);
  }
});

test('a higher expired reservation from a failed original producer is consumed and raises the floor', async () => {
  const state = fixture(), higher = '0.7.0-dev.1800000000000.1', runId = POLICY.originalRun + 1;
  state.artifacts.push(artifact(90000001, RESERVATION + higher, { expired: true,
    workflow_run: { id: runId, repository_id: POLICY.repositoryId, head_repository_id: POLICY.repositoryId, head_sha: 'd'.repeat(40) } }));
  state.producers.set(runId, producer({ id: runId, head_sha: 'd'.repeat(40), conclusion: 'failure' }));
  await state.observe();
  assert.deepEqual(state.plannerCalls, [higher]);
  assert.equal(state.evidence.confirmed_consumed_reservations.at(-1).expired, true);
});

test('a higher marker from another workflow produces HOLD instead of a lower inferred floor', async () => {
  const state = fixture(), runId = POLICY.originalRun + 1;
  state.artifacts.push(artifact(90000001, RESERVATION + '0.7.0-dev.1800000000000.1', {
    workflow_run: { id: runId, repository_id: POLICY.repositoryId, head_repository_id: POLICY.repositoryId, head_sha: SOURCE } }));
  state.producers.set(runId, producer({ id: runId, head_sha: SOURCE, path: POLICY.workflow }));
  await assert.rejects(state.observe, /OBSERVATION_CONSUMED_PRODUCER_MISMATCH/);
  assert.equal(state.plannerCalls.length, 0);
});

test('observer run cannot exploit the existing planner same-run artifact exclusion', async () => {
  const state = fixture();
  state.artifacts.push(artifact(90000002, CANDIDATE + SOURCE, { workflow_run: { id: RUN,
    repository_id: POLICY.repositoryId, head_repository_id: POLICY.repositoryId, head_sha: SOURCE } }));
  await assert.rejects(state.observe, /OBSERVATION_CURRENT_RUN_HAS_PRODUCER_ARTIFACT/);
  assert.equal(state.plannerCalls.length, 0);
});

test('a source previously built by another run is refused from positive catalog evidence before CLI', async () => {
  const state = fixture();
  state.artifacts.push(artifact(90000002, CANDIDATE + SOURCE, { expired: true }));
  // A later empty named lookup must not erase the positive observation.
  state.mutation = route => route.includes('name=' + CANDIDATE + SOURCE) ? { total_count: 0, artifacts: [] } : undefined;
  await assert.rejects(state.observe, /OBSERVATION_SOURCE_ALREADY_BUILT/);
  assert.equal(state.plannerCalls.length, 0);
});

test('four-candidate exhaustion is terminal; observer never retries the CLI or invents a fifth candidate', async () => {
  const state = fixture(); let calls = 0;
  state.runPlanner = async () => { calls++; throw Object.assign(new Error('test exhaustion'), { code: 'PACKAGE_IDENTITY_CANDIDATES_EXHAUSTED' }); };
  await assert.rejects(state.observe, { code: 'PACKAGE_IDENTITY_CANDIDATES_EXHAUSTED' });
  assert.equal(calls, 1);
  assert.throws(() => validatePlan(plan(POLICY.knownFloor, { candidate_slot: 4,
    rejected_reserved_candidate_versions: Array.from({ length: 4 }, (_, i) => `0.7.0-dev.180000000000${i}.1`) }), CONTEXT, POLICY.knownFloor, POLICY.knownFloor), /OBSERVATION_PLAN_BOUND_INVALID/);
});

test('a fresh collision during post-plan readback invalidates the proposal', async () => {
  const state = fixture();
  state.mutation = route => route.includes('name=' + RESERVATION + plan().candidate_package_version)
    ? { total_count: 1, artifacts: [artifact(90000003, RESERVATION + plan().candidate_package_version)] } : undefined;
  await assert.rejects(state.observe, /OBSERVATION_POST_PLAN_COLLISION/);
  assert.equal(state.plannerCalls.length, 1);
});

test('an incomplete per-name response after the CLI is not interpreted as absence', async () => {
  const state = fixture();
  state.mutation = route => route.includes('name=' + CANDIDATE + SOURCE) ? { total_count: 1, artifacts: [] } : undefined;
  await assert.rejects(state.observe, /OBSERVATION_EXACT_NAME_INCOMPLETE/);
});

test('catalog drift or cancelled observing run at final readback is HOLD', async () => {
  const catalog = fixture(); let catalogReads = 0;
  catalog.mutation = route => route === `${BASE}artifacts?page=1&per_page=100` && ++catalogReads === 2
    ? { total_count: 3, artifacts: [...catalog.artifacts, artifact(42, 'new-upload')] } : undefined;
  await assert.rejects(catalog.observe, /OBSERVATION_CATALOG_CHANGED/);
  assert.equal(catalog.evidence.catalog.complete, false);
  const stopped = fixture(); let runReads = 0;
  stopped.mutation = route => route === `${BASE}runs/${RUN}` && ++runReads === 2
    ? observer({ status: 'completed', conclusion: 'cancelled' }) : undefined;
  await assert.rejects(stopped.observe, /OBSERVATION_CURRENT_RUN_MISMATCH/);
});

test('planner authority, source drift, equal floor and fabricated retention are rejected', () => {
  for (const overrides of [{ authority_effect: true }, { physical_package_build_allowed: true },
    { promotion_authorized: true }, { source_head: 'a'.repeat(40) },
    { candidate_package_version: POLICY.knownFloor }, { minimum_package_version_exclusive: false },
    { manifest_update_required: false }]) {
    assert.throws(() => validatePlan(plan(POLICY.knownFloor, overrides), CONTEXT, POLICY.knownFloor, POLICY.knownFloor), /OBSERVATION_PLAN_/);
  }
});

test('CLI transport uses original script and live API, with real context arguments and env-only token', () => {
  const token = 'test-only-secret-not-real', env = { ME2_GITHUB_TOKEN: token, NODE_OPTIONS: '--import fake-input.mjs', NODE_PATH: '/fake' };
  let calls = 0;
  const result = runPlannerCli({ root: '/isolated-fixture', context: CONTEXT, packageVersion: POLICY.knownFloor,
    floor: POLICY.knownFloor, env, spawn: (exe, args, options) => {
      calls++; assert.equal(exe, process.execPath); assert.equal(args[0], join('/isolated-fixture', POLICY.planner));
      assert.equal(args.filter(arg => arg === '--plan-distinct').length, 1);
      assert.equal(args[args.indexOf('--run-id') + 1], String(RUN));
      assert.equal(args[args.indexOf('--run-attempt') + 1], '1');
      assert.equal(args[args.indexOf('--api-base') + 1], 'https://api.github.com');
      assert.equal(args.includes('--out'), false); assert.equal(args.includes('--token'), false);
      assert.equal(JSON.stringify(args).includes(token), false);
      assert.equal(options.env.ME2_GITHUB_TOKEN, token); assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.equal(options.env.NODE_PATH, undefined); assert.equal(options.shell, false);
      return { status: 0, stdout: JSON.stringify({ ...plan(), arbitrary_untrusted: token }), stderr: '' };
    } });
  assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes(token), false);
});

test('malformed child output and secret-bearing stderr are not published or retried', () => {
  for (const child of [{ status: 0, stdout: 'not json', stderr: 'secret' },
    { status: 1, stdout: '', stderr: JSON.stringify({ code: 'SECRET_TOKEN', message: 'secret' }) },
    { status: null, signal: 'SIGTERM', stdout: '', stderr: 'secret' }]) {
    let calls = 0;
    assert.throws(() => runPlannerCli({ root: '/isolated-fixture', context: CONTEXT,
      packageVersion: POLICY.knownFloor, floor: POLICY.knownFloor, spawn: () => { calls++; return child; } }),
    error => /^OBSERVATION_PLANNER_/.test(error.code) && !error.message.includes('secret'));
    assert.equal(calls, 1);
  }
});

test('actual unchanged CLI child rejects invalid fixture source before any network request', () => {
  let childObserved = false;
  assert.throws(() => runPlannerCli({ root: fileURLToPath(new URL('../../../', import.meta.url)),
    context: { ...CONTEXT, sourceHead: 'invalid-fixture-source' }, packageVersion: POLICY.knownFloor,
    floor: POLICY.knownFloor, env: {}, spawn: (exe, args, options) => {
      const result = spawnSync(exe, args, options);
      assert.equal(result.error, undefined); assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stderr).code, 'package_build_reservation_source_head_invalid');
      childObserved = true;
      return result;
    } }), { code: 'OBSERVATION_PLANNER_PROCESS_FAILED' });
  assert.equal(childObserved, true);
});

test('HTTP capture allows only GET to GitHub and records sanitized actual response fields, never auth', async () => {
  const records = [], token = 'test-only-token'; let request;
  const get = createGitHubReader({ token, records, fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ...observer(), unneeded_private_text: token }), {
      status: 200, headers: { 'x-github-request-id': 'fixture-request', authorization: token } });
  } });
  await get(`${BASE}runs/${RUN}`, 'run');
  assert.equal(request.options.method, 'GET'); assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.authorization, `Bearer ${token}`);
  assert.equal(records[0].status, 200); assert.match(records[0].response_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(records).includes(token), false);
  await assert.rejects(() => get('https://attacker.invalid/', 'run'), /OBSERVATION_API_ROUTE_INVALID/);
});

test('API failure and truncated JSON leave bounded failure observations, never synthetic empty lists', async () => {
  for (const response of [new Response('private error token', { status: 503 }), new Response('{', { status: 200 })]) {
    const records = [], get = createGitHubReader({ token: 'test', records, fetchImpl: async () => response });
    await assert.rejects(() => get(`${BASE}artifacts?page=1&per_page=100`, 'list'), /OBSERVATION_(API_UNAVAILABLE|RESPONSE_JSON_INVALID)/);
    assert.equal(records.length, response.status === 503 ? 3 : 1); assert.equal(records[0].response, undefined);
    assert.equal(JSON.stringify(records).includes('private error token'), false);
  }
});

test('persistent HTTP 500 stays HOLD after bounded GET attempts without fallback or planner execution', async () => {
  const state = fixture(), records = [];
  let httpCalls = 0;
  const get = createGitHubReader({ token: 'test-only-token', records, fetchImpl: async url => {
    httpCalls++;
    assert.equal(url, 'https://api.github.com' + BASE + 'artifacts?page=1&per_page=100');
    return new Response('private error token', { status: 500 });
  } });
  const originalGet = state.get;
  state.get = (route, kind) => route === `${BASE}artifacts?page=1&per_page=100` ? get(route, kind) : originalGet(route, kind);
  await assert.rejects(state.observe, { code: 'OBSERVATION_API_UNAVAILABLE' });
  assert.equal(httpCalls, 3);
  assert.equal(state.plannerCalls.length, 0);
  assert.equal(state.evidence.catalog, undefined);
  assert.equal(records.length, 3);
  assert.equal(records[0].status, 500);
  assert.equal(records[0].response, undefined);
  assert.equal(JSON.stringify(records).includes('private error token'), false);
});

test('transient metadata 5xx can recover without changing route or method', async () => {
  for(const status of [500,502,503,504]) {
    const records=[],calls=[];
    const get=createGitHubReader({token:'fixture-only',records,fetchImpl:async (url,options)=>{
      calls.push({url,method:options.method});
      return calls.length===1?new Response('untrusted server failure',{status})
        :new Response(JSON.stringify({total_count:0,artifacts:[]}));
    }});
    assert.deepEqual(await get(`${BASE}artifacts?page=1&per_page=100`,'list'),{total_count:0,artifacts:[]});
    assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
    assert.deepEqual(records.map(x=>x.status),[status,200]);
    assert.deepEqual(records.map(x=>x.metadata_attempt),[1,2]);
    assert.equal(records[0].response,undefined);
  }
});

test('access refusals, throttling, redirects and malformed success never retry',async()=>{
  for(const status of [301,400,401,403,404,429]) {
    let calls=0;const records=[];
    const get=createGitHubReader({token:'fixture-only',records,fetchImpl:async()=>{
      calls++;return new Response('refused',{status});
    }});
    await assert.rejects(get(`${BASE}artifacts?page=1&per_page=100`,'list'),{code:'OBSERVATION_API_UNAVAILABLE'});
    assert.equal(calls,1);
  }
});

test('metadata retries consume the shared 700 request budget rather than resetting it',async()=>{
  let calls=0;const records=[];
  const get=createGitHubReader({token:'fixture-only',records,fetchImpl:async()=>{
    calls++;return calls<700?new Response(JSON.stringify({total_count:0,artifacts:[]})):new Response('busy',{status:503});
  }});
  for(let i=0;i<699;i++)await get(`${BASE}artifacts?page=1&per_page=100`,'list');
  await assert.rejects(get(`${BASE}artifacts?page=1&per_page=100`,'list'),{code:'OBSERVATION_REQUEST_BOUND_EXCEEDED'});
  assert.equal(calls,700);assert.equal(records.length,700);
});

test('the fixed 700-request budget refuses before a 701st GET with the larger catalog cap', async () => {
  const records = [];
  let httpCalls = 0;
  const get = createGitHubReader({ token: 'test-only-token', records, fetchImpl: async () => {
    httpCalls++;
    return new Response(JSON.stringify({ total_count: 0, artifacts: [] }), { status: 200 });
  } });
  for (let request = 1; request <= 700; request++) await get(`${BASE}artifacts?page=1&per_page=100`, 'list');
  await assert.rejects(() => get(`${BASE}artifacts?page=1&per_page=100`, 'list'),
    { code: 'OBSERVATION_REQUEST_BOUND_EXCEEDED' });
  assert.equal(httpCalls, 700);
  assert.equal(records.length, 700);
  assert.ok(records.every(record => record.status === 200));
});

test('even an allowed metadata field reflecting the job token produces HOLD without retaining that field', async () => {
  const records = [], token = 'fixture-secret-value';
  const get = createGitHubReader({ token, records, fetchImpl: async () => new Response(JSON.stringify({
    total_count: 1, artifacts: [{ id: 1, name: token }],
  }), { headers: { 'x-github-request-id': token } }) });
  await assert.rejects(() => get(`${BASE}artifacts?page=1&per_page=100`, 'list'), /OBSERVATION_SECRET_IN_RESPONSE/);
  assert.equal(records[0].response, undefined); assert.equal(records[0].headers['x-github-request-id'], null);
  assert.equal(JSON.stringify(records).includes(token), false);
});

test('response body limit refuses oversized API data before adding a payload to evidence', async () => {
  const records = [], get = createGitHubReader({ token: 'test', records,
    fetchImpl: async () => new Response('x'.repeat(POLICY.maxResponseBytes + 1)) });
  await assert.rejects(() => get(`${BASE}artifacts?page=1&per_page=100`, 'list'), /OBSERVATION_RESPONSE_BOUND_EXCEEDED/);
  assert.equal(records[0].response, undefined);
});

test('HOLD report has no plan file and always denies all authority', () => {
  const directory = mkdtempSync(join(tmpdir(), 'identity-observer-report-'));
  try {
    const status = writeReports(directory, { queries: [] }, plan(), 'OBSERVATION_POST_PLAN_COLLISION');
    assert.equal(status.disposition, 'HOLD'); assert.deepEqual(readdirSync(directory).sort(), ['observation.json', 'status.json']);
    for (const key of ['selected_version', 'reservation_created', 'package_built', 'physical_package_build_allowed',
      'promotion_authorized', 'authority_effect', 'automatic_retry_allowed']) assert.equal(status[key], false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('evidence size overflow publishes explicit HOLD metadata and omits the proposal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'identity-observer-report-bound-'));
  try {
    const status = writeReports(directory, { queries: [{ huge: 'x'.repeat(5000) }] }, plan(), null, 2000);
    assert.equal(status.disposition, 'HOLD'); assert.equal(status.code, 'OBSERVATION_EVIDENCE_BOUND_EXCEEDED');
    assert.equal(readdirSync(directory).includes('plan.json'), false);
    assert.equal(JSON.parse(readFileSync(join(directory, 'observation.json'))).response_payloads_omitted_due_bound, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('source workflow has exactly the approved push refs, read permissions and separate observation artifacts', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/browser-package-identity-observation.yml', import.meta.url), 'utf8');
  assert.deepEqual([...workflow.matchAll(/^      - (work\/[^\r\n]+)$/gm)].map(match => match[1]), POLICY.refs.map(ref => ref.slice('refs/heads/'.length)));
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/); assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /^  contents: read$/m); assert.match(workflow, /^  actions: read$/m);
  assert.match(workflow, /ME2_GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /if: always\(\)/); assert.match(workflow, /overwrite: false/);
  assert.match(workflow, /name: metaengine-browser-package-identity-observation-/);
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request:|npm |npx |bun |electron-builder|id-token:|attestations:|actions: write|contents: write/);
  assert.doesNotMatch(workflow, /name: metaengine-browser-(?:package-version|windows-candidate)-/);
});
