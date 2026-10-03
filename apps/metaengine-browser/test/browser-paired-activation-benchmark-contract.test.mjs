import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../scripts/windows-paired-activation-benchmark.ps1', import.meta.url), 'utf8');

test('paired activation benchmark is CI-only and cannot target an arbitrary local root', () => {
  assert.match(source, /GITHUB_ACTIONS.*true/);
  assert.match(source, /paired_activation_benchmark_ci_only/);
  assert.match(source, /RUNNER_TEMP/);
  assert.match(source, /paired_activation_benchmark_runner_temp_outside_ci_root/);
  assert.doesNotMatch(source, /promotion_authorized\s*=\s*\$true/);
});

test('paired benchmark uses immutable installed snapshots in ABBA order on one runner', () => {
  assert.match(source, /baseline-app/);
  assert.match(source, /candidate-app/);
  assert.match(source, /Install-And-Snapshot/);
  const a1 = source.indexOf("side='baseline';round=1");
  const b1 = source.indexOf("side='candidate';round=1", a1);
  const b2 = source.indexOf("side='candidate';round=2", b1);
  const a2 = source.indexOf("side='baseline';round=2", b2);
  assert.ok(a1 >= 0 && b1 > a1 && b2 > b1 && a2 > b2);
  assert.match(source, /paired_activation_runner_fingerprint_drift/);
  assert.match(source, /same_runner=\$true/);
});

test('paired benchmark compares the same launch-to-durable-ACK boundary using raw samples', () => {
  assert.match(source, /windows-autonomous-session-soak\.ps1/);
  assert.match(source, /activation_latency_samples_ms/);
  assert.match(source, /SECONDARY_PROCESS_LAUNCH_TO_VALID_DURABLE_ACK_EXIT/);
  assert.match(source, /candidate_minus_baseline_p95_percent/);
  assert.match(source, /candidate_minus_baseline_mean_percent/);
  assert.match(source, /samples_per_side/);
});

test('paired benchmark binds exact source identities and installer digests without release authority', () => {
  assert.match(source, /BaselineSourceHead/);
  assert.match(source, /CandidateSourceHead/);
  assert.match(source, /Get-FileHash.*SHA256/);
  assert.match(source, /installer_sha256/);
  assert.match(source, /promotion_authorized=\$false/);
  assert.match(source, /automatic_retry_allowed=\$false/);
  assert.match(source, /authority_effect=\$false/);
});


test('paired benchmark requires provenance-bound installer digests and package versions', () => {
  assert.match(source, /BaselineExpectedInstallerSha256/);
  assert.match(source, /CandidateExpectedInstallerSha256/);
  assert.match(source, /BaselineExpectedPackageVersion/);
  assert.match(source, /CandidateExpectedPackageVersion/);
  assert.match(source, /paired_activation_baseline_installer_digest_mismatch/);
  assert.match(source, /paired_activation_candidate_installer_digest_mismatch/);
  assert.match(source, /paired_activation_baseline_package_version_mismatch/);
  assert.match(source, /paired_activation_candidate_package_version_mismatch/);
});
