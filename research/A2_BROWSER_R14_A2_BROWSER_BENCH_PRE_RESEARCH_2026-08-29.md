# A2 Browser R14 — A2 Browser Bench — Pre-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R13 `6e113ec7eaa85c1c689d40874b7c52c2c5f4305e`
Roadmap milestone: `R14_A2_BROWSER_BENCH_V1`

## Goal

Create a safety-first benchmark harness for deterministic Browser Operator components. R14 measures performance only after correctness gates pass and cannot grant browser authority or promotion by itself.

## Research findings

Speedometer 3 measures realistic user-oriented workloads and includes asynchronous work that affects responsiveness rather than timing only an isolated synchronous call. Its methodology reinforces using representative workloads and multiple iterations instead of a single micro-operation.

Speedometer's run instructions also emphasize environment control: clean profile, no competing workloads and stable execution conditions. A2 therefore records runtime/platform metadata and treats absolute timing as environment-bound evidence rather than universal constants.

Node's stable `perf_hooks.performance.now()` provides a high-resolution monotonic process-relative clock suitable for local latency sampling.

OpenTelemetry's performance benchmark guidance separates throughput, CPU and memory concerns and explicitly records benchmark configuration. A2 similarly binds source commit, fixture version, iteration counts and case identity into every result.

## Architecture decision

A2 Bench has two planes:

1. **Correctness plane** — mandatory, deterministic and fail-closed.
2. **Measurement plane** — p50/p95/p99/min/max latency samples collected only for cases whose correctness assertion passes.

There is no single aggregate score capable of hiding a failed safety property. A result with any correctness failure is `eligible=false` regardless of speed.

Canonical benchmark cases should cover representative pure control-plane workloads from R10-R13, with adverse/ambiguous fixtures included in correctness tests. Browser physical-effect canaries remain separate evidence and are not repeated by this benchmark.

## Invariants

- `BENCHMARK_CORRECTNESS_PRECEDES_PERFORMANCE`.
- `FAILED_CORRECTNESS_CANNOT_BE_RANKED_AS_ELIGIBLE`.
- `SOURCE_COMMIT_AND_FIXTURE_VERSION_ARE_BOUND`.
- `PERCENTILES_REPORTED_NOT_ONLY_AVERAGE`.
- `BENCHMARK_RESULTS_ARE_ENVIRONMENT_SCOPED`.
- `BENCHMARK_HAS_ZERO_BROWSER_NETWORK_PROCESS_MODEL_AUTHORITY`.
- `BENCHMARK_DOES_NOT_REPLAY_EXTERNAL_EFFECTS`.
- `NO_USER_SECRETS_OR_RAW_PAGE_BODIES_IN_BENCHMARK_ARTIFACTS`.
