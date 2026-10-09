import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../../.github/workflows/client-v1-supabase-edge-live-probe.yml', import.meta.url), 'utf8');
const producerGuard = "github.event_name != 'pull_request' || github.head_ref != 'work/client-owned-state-runtime-v1'";
const guard = "github.event_name != 'pull_request' || (github.head_ref != 'work/client-owned-state-runtime-v1' && github.head_ref != 'work/client-runtime-restart-singleton-v1' && github.head_ref != 'work/client-restored-pg17-runtime-repair-v1' && github.head_ref != 'work/client-mcp-offline-installer-qualification-v1' && github.head_ref != 'work/client-mcp-db-connect-operator-v1' && github.head_ref != 'work/client-installed-pg17-setup-wizard-v1' && github.head_ref != 'work/client-github-chat-control-v1' && github.head_ref != 'work/client-github-chat-egress-redaction-v1' && github.head_ref != 'work/client-pg17-auto-prepare-durable-v1')";
const guardedJobs = [
  ['client-v1-supabase-edge-live-probe.yml', 'public-health'],
  ['browser-windows-installed-chat-qualification.yml', 'windows-installed-chat-qualification'],
  ['browser-windows-package-smoke.yml', 'windows-nsis-package-smoke'],
  ['browser-final-runtime-activation-v1.yml', 'windows-final-runtime-activation'],
  ['browser-windows-autonomous-soak-v1.yml', 'package-session-soak'],
  ['metaengine-browser-self-update-e2e.yml', 'windows-published-n-to-one-build-target'],
  ['browser-shell-first-dirty-profile-v1.yml', 'windows-shell-first-dirty-profile'],
];

for (const [file, job] of guardedJobs) {
  test(`local-only PR holds hosted/default-cloud physical job ${file}:${job}`, () => {
    const source = readFileSync(new URL(`../../../.github/workflows/${file}`, import.meta.url), 'utf8');
    const escaped = (file === 'browser-windows-package-smoke.yml' ? producerGuard : guard).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(source, new RegExp(`^  ${job}:\\r?\\n(?:    #[^\\n]*\\r?\\n)?    if: ${escaped}\\r?\\n`, 'm'));
    assert.match(source, /^on:\r?\n/m);
    assert.match(source, /^  pull_request:\r?\n/m);
  });
}

test('client-owned state PR skips every historical hosted live-probe step at the job boundary', () => {
  assert.match(workflow, new RegExp(`  public-health:\\r?\\n(?:    #[^\\n]*\\r?\\n)?    if: ${guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n    runs-on:`));
  assert.equal((workflow.match(/^  [a-zA-Z0-9_-]+:\s*$/gm) ?? []).filter(line => !['  push:', '  pull_request:', '  workflow_dispatch:', '  contents:'].includes(line.trimEnd())).length, 1);
  assert.match(workflow, /- name: Probe stable and canary health without credentials/);
  assert.match(workflow, /- name: Prove ticket-only redemption rejects unissued tickets on stable and canary/);
});

test('guard preserves other PRs, historical push and explicit dispatch without adding write permissions', () => {
  const permits = new Function('github', `return ${guard};`);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/client-owned-state-runtime-v1' }), false);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/client-runtime-restart-singleton-v1' }), false);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/client-restored-pg17-runtime-repair-v1' }), false);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/client-mcp-offline-installer-qualification-v1' }), false);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/client-mcp-db-connect-operator-v1' }), false);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/client-installed-pg17-setup-wizard-v1' }), false);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/client-github-chat-control-v1' }), false);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/client-github-chat-egress-redaction-v1' }), false);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/client-pg17-auto-prepare-durable-v1' }), false);
  assert.equal(permits({ event_name: 'pull_request', head_ref: 'work/another-candidate' }), true);
  assert.equal(permits({ event_name: 'push', head_ref: '' }), true);
  assert.equal(permits({ event_name: 'workflow_dispatch', head_ref: 'work/client-owned-state-runtime-v1' }), true);
  assert.match(workflow, /push:\r?\n    branches:\r?\n      - work\/client-v1-c2-new-supabase-rehome-v1/);
  assert.match(workflow, /pull_request:\r?\n    paths:/);
  assert.match(workflow, /  workflow_dispatch:/);
  assert.match(workflow, /permissions:\r?\n  contents: read\r?\n\r?\njobs:/);
  assert.doesNotMatch(workflow, /^\s+[\w-]+:\s*write\s*$/m);
});

test('offline successor builds a physical package without qualifying historical hosted normal boot', () => {
  const source = readFileSync(new URL('../../../.github/workflows/browser-windows-package-smoke.yml', import.meta.url), 'utf8');
  const produces = new Function('github', `return ${producerGuard};`);
  assert.equal(produces({ event_name: 'pull_request', head_ref: 'work/client-runtime-restart-singleton-v1' }), true);
  assert.match(source, /- name: Prove exact packaged profile with an offline diagnostic/);
  const normalStep = source.split('- name: Prove normal packaged UI boot and second-instance activation')[1].split('\n      - name:')[0];
  const condition = normalStep.match(/\n\s*if: ([^\r\n]+)/)?.[1];
  assert.ok(condition, 'normal boot has a separate admission condition');
  const qualifiesNormalBoot = new Function('github', `return ${condition};`);
  for (const branch of ['work/client-runtime-restart-singleton-v1', 'work/client-restored-pg17-runtime-repair-v1', 'work/client-mcp-offline-installer-qualification-v1', 'work/client-mcp-db-connect-operator-v1', 'work/client-installed-pg17-setup-wizard-v1', 'work/client-github-chat-control-v1', 'work/client-github-chat-egress-redaction-v1', 'work/client-pg17-auto-prepare-durable-v1']) {
    assert.equal(produces({ event_name: 'pull_request', head_ref: branch }), true);
    assert.equal(qualifiesNormalBoot({ event_name: 'pull_request', head_ref: branch }), false);
  }
  assert.equal(qualifiesNormalBoot({ event_name: 'pull_request', head_ref: 'work/another-candidate' }), true);
  assert.match(source, /normal_ui_boot_verified=\$false/);
  assert.match(source, /client_state_runtime_packaged_resources_verified=\$true/);
});

test('offline contract and source jobs are not held by the branch-specific physical guard', () => {
  for (const [file, job] of [
    ['browser-windows-package-smoke.yml', 'package_identity_preflight'],
    ['metaengine-browser-self-update-e2e.yml', 'contract'],
    ['browser-windows-autonomous-soak-v1.yml', 'continuous-brain'],
    ['browser-windows-autonomous-soak-v1.yml', 'brain-endurance'],
    ['browser-windows-autonomous-soak-v1.yml', 'seeded-fleet-chaos'],
    ['browser-windows-autonomous-soak-v1.yml', 'fleet-scale'],
  ]) {
    const source = readFileSync(new URL(`../../../.github/workflows/${file}`, import.meta.url), 'utf8');
    const block = source.split(`  ${job}:`)[1]?.split(/^  [a-zA-Z0-9_-]+:\s*$/m)[0];
    assert.ok(block, `missing retained offline job ${job}`);
    assert.ok(!block.includes(guard), `offline job ${job} must remain enabled`);
  }
});
