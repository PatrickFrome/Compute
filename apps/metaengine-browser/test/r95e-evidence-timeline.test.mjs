import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const observe = await readFile(
  new URL('../../me2-ui/src/components/me2/pages/observability.tsx', import.meta.url),
  'utf8',
);
const evidenceContracts = await readFile(
  new URL('../../me2-ui/src/lib/r95e-evidence-contracts.mjs', import.meta.url),
  'utf8',
);

const visualHarness = await readFile(
  new URL('./me2-r85-visual-evidence.mjs', import.meta.url),
  'utf8',
);
const packageSmoke = await readFile(
  new URL('../../../.github/workflows/browser-windows-package-smoke.yml', import.meta.url),
  'utf8',
);
const shell = await readFile(
  new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url),
  'utf8',
);

test('R95E evidence timeline binds causal rows only by exact task identity', () => {
  assert.match(observe, /data-testid="evidence-timeline"/);
  assert.match(observe, /data-binding-mode=\{inspectedTaskId \? "EXACT_TASK_ID" : "UNBOUND"\}/);
  assert.match(observe, /mergeExactTaskEvidenceEvents\(\{/);
  assert.match(observe, /taskId: inspectedTaskId/);
  assert.match(evidenceContracts, /String\(event\?\.task_id \?\? ""\) !== id/);
  assert.match(observe, /verdicts\?\.verdicts \?\? \[\]\)\.filter\(\(row\) => row\.task_id === inspectedTaskId\)/);
  assert.match(observe, /causal rows require exact task_id equality/);
});

test('R95E explicitly refuses heuristic causal attribution for global chain, CI and aggregate OTel', () => {
  assert.match(observe, /Evidence-chain verification is global ambient evidence/);
  assert.match(observe, /\{chainLabel\} ambient/);
  assert.match(observe, /CI status is ambient evidence and is not joined to the selected task without an explicit identity binding/);
  assert.match(observe, /OTel aggregate is ambient evidence and is not treated as task-causal/);
  assert.match(observe, /global evidence-chain, CI and aggregate OTel stay ambient/);
  assert.match(observe, /CI .* ambient/);
  assert.match(observe, /const otelLabel = otel == null \? "spans \?" : `spans \$\{otel\.spans\} · drop \$\{otel\.dropped\}`/);
  assert.match(observe, /OTel aggregate is ambient evidence and is not treated as task-causal/);
  assert.doesNotMatch(observe, /ci.*task_id\s*===/i);
});

test('R95E can drill the exact selected task back into PLAN without creating authority', () => {
  assert.match(observe, /const openExactTask = useCallback\(\(\) => \{/);
  assert.match(observe, /openTask\(inspectedTaskId\)/);
  assert.match(observe, /setPage\("tasks"\)/);
  assert.match(observe, /data-testid="evidence-open-plan"/);
  assert.doesNotMatch(observe, /sendCommand\("EVIDENCE_/);
  assert.doesNotMatch(observe, /automatic.*retry/i);
});

test('R95E timeline is bounded and merges task snapshot, exact events and exact verdicts', () => {
  assert.match(observe, /kind: "TASK"/);
  assert.match(observe, /kind: "EVENT"/);
  assert.match(observe, /kind: "VERDICT"/);
  assert.match(observe, /limit: 40/);
  assert.match(evidenceContracts, /\.slice\(0, boundedLimit\)/);
  assert.match(observe, /\.slice\(0, 24\)/);
  assert.match(observe, /\.slice\(0, 48\)/);
});


test('R97 keeps exact Evidence Timeline as an advanced module instead of persistent main chrome', () => {
  assert.match(shell, /case "observability": return <ObservabilityPage \/>/);
  assert.doesNotMatch(shell, /workflow-stage-observe|evidence-timeline/);
  assert.match(visualHarness, /advanced_surfaces_settings_only/);
  assert.match(visualHarness, /r97-settings-advanced-surface-1440x960/);
  assert.match(visualHarness, /r97-command-search-1440x960/);
  assert.match(packageSmoke, /advanced_surfaces_settings_only -ne \$true/);
  assert.match(packageSmoke, /r97-settings-advanced-surface-1440x960/);
  assert.match(packageSmoke, /r97-command-search-1440x960/);
});
