# W1 PREPARE_ONLY acceleration slice — 2026-08-24

Canonical Level-1 owner: **C1 — First Real Linux Worker**  
Level-2 claim: `W1_PERSISTENT_LINUX_WORKER_SAFETY`  
Future owner after C1/C2: **C3 / `ACC1_BASE_ACCELERATORS`**

## Decision

Adopt two local, reversible accelerators now for W1 verification:

1. a uv lock for exact development-test dependencies;
2. a CPU-budget-aware pytest-xdist `worksteal` runner.

This is `PREPARE_ONLY`. It speeds the evidence loop but does not change the
roadmap gate, establish T1 parity, admit a worker, enable shared-cache reuse,
or mark ACC1/C3 complete.

## Measured baseline in the ChatGPT execution environment

Environment observed on 2026-08-24:

- Python 3.12.13;
- uv 0.11.33;
- cgroup CPU quota: 8 CPUs (`800000 / 100000`);
- 15,032,385,536-byte memory limit;
- repository source: `0d6bfd3fc54d2d0ebdcd8194f98c9becd067a4df`.

Warm full-suite measurements before implementation:

| Mode | Result | Wall time |
| --- | --- | ---: |
| Sequential pytest | 386 passed, 1 skipped | 4.415 s |
| pytest-xdist `-n auto --dist worksteal` | 386 passed, 1 skipped | 2.054 s |

Observed speedup: **2.15×**. The measurement is local development evidence,
not a production performance guarantee. CI evidence is emitted by
`tooling/accelerated_tests.py` with source/lock identity and explicit
non-authority fields.

After adding the locked runner, three interleaved warm repetitions produced a
3.625 s serial median and a 2.057 s parallel median (**1.76×**). One parallel
run took 5.776 s while three other development lanes were active, so scheduling
contention remains visible rather than being hidden. C8 promotion still
requires a later isolated scheduler tournament with a larger sample.

## Safety and reproducibility boundaries

- The runner detects CPU affinity and cgroup-v2 quota, then rejects an explicit
  worker count above that budget.
- Worker restart is disabled so a crashing worker fails closed.
- Commands are passed as argv with `shell=False`.
- `PYTHONHASHSEED=0` is set unless the caller already supplied a value.
- The uv lock is required by CI through `uv sync --locked` and `uv run --locked`.
- No remote/shared build or dependency cache is granted project trust.
- GitHub dependency caches contain no credentials or project authority; cache
  contents are treated as replaceable acceleration, never evidence.

## Research disposition

| Candidate | Decision now | Reason |
| --- | --- | --- |
| uv lock/sync | `ADOPT_NOW_PREPARE_ONLY` | Exact dependency graph and aggressive local reuse without a service dependency. |
| pytest-xdist worksteal | `ADOPT_NOW_PREPARE_ONLY` | Demonstrated 2.15× local speedup with the complete suite still green. |
| GitHub-hosted public-repo CI | `ADOPT_NOW` | Standard runners are free for public repositories; CI remains evidence, not runtime authority. |
| GitHub dependency cache | `LIMITED` | Safe only for public dependencies, no secrets, and never trusted as provenance. |
| sccache | `DEFER_UNTIL_COMPILED_WORKLOAD` | The current critical suite is Python; there is no measured compile workload to accelerate. |
| shared remote read-write cache | `REJECT_NOW` | T1/C4 equivalence and poisoning controls are not yet satisfied. |
| Bazel/REAPI, Ray, Kubernetes/Kueue | `DEFER` | They are downstream of serial correctness and would add control-plane work before C1/C2. |

Primary references:

- pytest-xdist distribution: https://pytest-xdist.readthedocs.io/en/stable/distribution.html
- uv locking and syncing: https://docs.astral.sh/uv/concepts/projects/sync/
- uv cache semantics: https://docs.astral.sh/uv/concepts/cache/
- GitHub Actions billing/usage: https://docs.github.com/en/actions/concepts/billing-and-usage
- GitHub cache security: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
