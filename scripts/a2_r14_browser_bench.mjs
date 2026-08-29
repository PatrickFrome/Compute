import fs from 'node:fs/promises';
import process from 'node:process';
import crypto from 'node:crypto';
import { runA2BrowserBenchV1 } from '../coordination/browser-shared/a2-browser-bench-v1.mjs';
import { compileRoleContext, digestContextBody } from '../coordination/browser-shared/context-compiler-v1.mjs';
import { TrustTaintGraphV1 } from '../coordination/browser-shared/trust-taint-graph-v1.mjs';
import { createTraceRecorderV1, verifyTraceReplayV1 } from '../coordination/browser-shared/trace-replay-v1.mjs';

const sourceCommit = process.env.GITHUB_SHA || process.argv[2];
if (!/^[0-9a-f]{40}$/.test(String(sourceCommit || ''))) throw new Error('r14_source_commit_required');
const output = process.argv[3] || null;
const sha = (value) => `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;

const contextSources = Array.from({ length: 64 }, (_, i) => {
  const kind = i === 0 ? 'DIRECTIVE' : i % 3 === 0 ? 'OBSERVATION' : 'EVIDENCE';
  const body = `${kind.toLowerCase()}-${i}-` + 'x'.repeat(96 + (i % 16));
  return {
    source_id: `source.${String(i).padStart(3, '0')}`,
    point_id: 'point.r14',
    kind,
    body,
    content_digest: digestContextBody(body),
    tainted: kind === 'OBSERVATION',
    priority: 100 - i,
    refs: [],
  };
});

function contextWork() {
  return compileRoleContext({ point_id: 'point.r14', role: 'SECURITY', sources: contextSources, max_chars: 16000 });
}
function taintWork() {
  const graph = new TrustTaintGraphV1();
  graph.addSource({ node_id: 'node.policy', source_class: 'LOCAL_POLICY', content_digest: sha('policy'), authority_capabilities: ['BROWSER_ACTUATION'] });
  for (let i = 0; i < 16; i += 1) graph.addSource({ node_id: `node.page.${i}`, source_class: 'PAGE_DATA', content_digest: sha(`page-${i}`), authority_capabilities: [] });
  const data = graph.derive({ node_id: 'node.args', parent_ids: Array.from({ length: 16 }, (_, i) => `node.page.${i}`), transform_kind: 'ACTION_ARGUMENTS', content_digest: sha('args') });
  return graph.assessPrivilegedSink({ authority_node_id: 'node.policy', data_node_ids: [data.node_id], sink_kind: 'BROWSER_ACTUATION', requested_capabilities: ['BROWSER_ACTUATION'] });
}
function replayWork(outcome = 'AMBIGUOUS') {
  const recorder = createTraceRecorderV1({ traceId: 'trace.r14.fixture', sourceCommit });
  recorder.record({ event_id: 'evt.decision', event_type: 'DECISION_RECORDED', subject_id: 'action.r14', parent_event_ids: [], evidence_digest: sha('decision'), outcome: null });
  recorder.record({ event_id: 'evt.intent', event_type: 'EFFECT_INTENT_RECORDED', subject_id: 'action.r14', parent_event_ids: ['evt.decision'], evidence_digest: sha('intent'), outcome: null });
  for (let i = 0; i < 16; i += 1) recorder.record({ event_id: `evt.obs.${i}`, event_type: 'EFFECT_OBSERVATION_RECORDED', subject_id: 'action.r14', parent_event_ids: [i ? `evt.obs.${i-1}` : 'evt.intent'], evidence_digest: sha(`obs-${i}`), outcome: null });
  recorder.record({ event_id: 'evt.terminal', event_type: 'TERMINAL_RECORDED', subject_id: 'action.r14', parent_event_ids: ['evt.obs.15'], evidence_digest: sha('terminal'), outcome });
  return verifyTraceReplayV1(recorder.snapshot());
}

const bench = await runA2BrowserBenchV1({
  sourceCommit,
  fixtureVersion: 'fixture.r14.browser-core.001',
  iterations: 100,
  warmupIterations: 10,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ci: process.env.CI === 'true',
  },
  cases: [
    {
      case_id: 'r10.context.compile64',
      correctness: async () => {
        const x = contextWork();
        return x.authority_effect === false && x.actuation_eligible === false && x.source_of_truth_rewritten === false && x.manifest.length > 0;
      },
      run: async () => { contextWork(); },
    },
    {
      case_id: 'r12.taint.browser16',
      correctness: async () => {
        const x = taintWork();
        return x.allowed === true && x.data_granted_authority === false && x.live_revalidation_required === true && x.taint_source_ids.length === 16;
      },
      run: async () => { taintWork(); },
    },
    {
      case_id: 'r13.replay.ambiguous16',
      correctness: async () => {
        const x = replayWork('AMBIGUOUS');
        return x.replay_executes_effects === false && x.ambiguous_subject_ids.length === 1 && x.terminal_outcomes[0]?.outcome === 'AMBIGUOUS';
      },
      run: async () => { replayWork('AMBIGUOUS'); },
    },
  ],
});

if (!bench.eligible) throw new Error('r14_benchmark_correctness_failed');
const serialized = `${JSON.stringify(bench, null, 2)}\n`;
if (output) await fs.writeFile(output, serialized, 'utf8');
else process.stdout.write(serialized);
