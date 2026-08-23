# W1 DEV-CYCLE-001 — Linux Admission Contract

Status: IMPLEMENTED / NON-AUTHORITY

## Goal

Build the first clean W1 development slice on the common `main` world state: a deterministic, fail-closed decision contract that distinguishes:

1. `REJECTED_CAPABILITY`
2. `SAFETY_ELIGIBLE_NON_PERSISTENT`
3. `ADMISSION_CANDIDATE`

The contract never admits a worker and never marks W1 verified.

## Why this slice first

Historical W1 work contained probes, provider workflows and persistence evidence, but the branch diverged substantially from current `main`. Before reusing provider-specific paths, the project needs a small policy surface that can consume host observations consistently and reject old failure modes such as hybrid/v1 cgroups.

## Current Linux primitives used by policy

- **cgroup v2**: the kernel documents a single unified hierarchy. `cgroup.kill` kills the target cgroup and descendants with SIGKILL and handles concurrent forks, making it a useful fail-closed cleanup primitive for isolated execution.
- **pidfd**: a PID file descriptor is a stable reference to a process and avoids PID-reuse races associated with traditional numeric-PID signalling.
- **openat2 + RESOLVE_BENEATH**: intended for constraining path resolution beneath a trusted directory when handling untrusted paths.
- **seccomp + no_new_privs**: retained as mandatory runtime safety conditions from the existing W1 safety model.

## New policy invariant

A host with all safety primitives but without independent persistent-host / provider-reboot / identity-binding evidence is only:

`SAFETY_ELIGIBLE_NON_PERSISTENT`

It must not become a W1 admission candidate.

A candidate additionally requires:

- persistent worker proof;
- independent provider reboot proof;
- before/after boot-id change;
- same-worker identity binding;
- provider event identity from independent provider API bytes;
- host identity from persisted host-observation bytes.

Even then the output remains non-authoritative:

- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

## Historical lesson enforced

A structurally correct JSON payload or successful CI VM probe is not evidence that a host is a compliant persistent worker.

The former hybrid cgroup failure is encoded as a permanent negative test: cgroup v1 or non-unified hierarchy produces `REJECTED_CAPABILITY`.

## Next step

Connect a real host-observation collector to this decision contract, then bind the resulting `ADMISSION_CANDIDATE` to the existing enrollment/persistence witness path. Actual admission remains an authority-bearing step after persisted readback and peer review.
