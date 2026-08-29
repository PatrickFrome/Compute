# A2 Browser R14 — A2 Browser Bench — Post-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R13 `6e113ec7eaa85c1c689d40874b7c52c2c5f4305e`
Initial candidate: `12d063f4b059efe119bb62ada7ab9fd6fa83433e`
Initial workflow: `33237872346`
Initial job: `99061932885` SUCCESS

## Result

R14 implements a safety-first benchmark harness and a representative pure Browser Operator suite covering R10 context compilation, R12 trust/taint sink assessment, and R13 ambiguous trace replay.

Every case must pass an explicit correctness callback before warmup or timing begins. Failed correctness receives no latency metrics and makes the entire suite `eligible=false`. There is deliberately no aggregate score that could let a fast unsafe implementation compensate for a failed safety property.

Eligible cases report min/p50/p95/p99/max latency using a high-resolution monotonic process clock. Source commit, fixture version, iteration counts and runtime/platform metadata are retained with the result.

## Research re-check

Speedometer 3 reinforces representative workload design and holistic timing of work that affects responsiveness rather than isolated micro-operations. A2 applies the same structural lesson to its control-plane components, while keeping physical browser-effect canaries separate so benchmarks do not become effect replayers.

Speedometer's execution guidance highlights environment control because background load and profile state can materially affect scores. R14 therefore treats timings as environment-scoped evidence and does not encode universal pass/fail latency thresholds in the canonical safety contract.

Node's stable Performance API supplies the high-resolution process-relative clock. OpenTelemetry benchmark guidance similarly emphasizes recording benchmark configuration and separating throughput/instrumentation costs rather than collapsing every property into one number.

## Verification result

The initial R14 job passed all substantive gates:
- exact R13 ancestry and zero new source dependencies;
- static zero-authority checks;
- adversarial benchmark-harness tests;
- representative R10/R12/R13 benchmark workloads;
- R13 through R8 regression fence;
- deterministic evidence envelope;
- provenance attestation;
- artifact upload.

The benchmark explicitly proves that a failed correctness case is never timed, a mixed safe/unsafe suite is globally ineligible, a non-monotonic clock fails closed, and the result cannot claim browser authority, actuation eligibility or effect replay.

## Confirmed invariants

- `BENCHMARK_CORRECTNESS_PRECEDES_PERFORMANCE`.
- `FAILED_CORRECTNESS_CANNOT_BE_RANKED_AS_ELIGIBLE`.
- `SOURCE_COMMIT_AND_FIXTURE_VERSION_ARE_BOUND`.
- `PERCENTILES_REPORTED_NOT_ONLY_AVERAGE`.
- `BENCHMARK_RESULTS_ARE_ENVIRONMENT_SCOPED`.
- `BENCHMARK_HAS_ZERO_BROWSER_NETWORK_PROCESS_MODEL_AUTHORITY`.
- `BENCHMARK_DOES_NOT_REPLAY_EXTERNAL_EFFECTS`.
- `NO_USER_SECRETS_OR_RAW_PAGE_BODIES_IN_BENCHMARK_ARTIFACTS`.

## R15 handoff

R15 should reuse the existing browser protocol and Compute Browser context/target contracts rather than inventing a new remote-CDP abstraction. The pool should schedule only among typed, healthy browser nodes with exact node/process-incarnation binding; context/session isolation is mandatory; raw engine transport remains internal to each node; one resource receives one actuation lease; node loss invalidates ephemeral bindings and never triggers blind replay of an ambiguous external effect.
