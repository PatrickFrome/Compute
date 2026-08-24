# W1 DEV-CYCLE-001 — Linux Host Safety Gate

Status: IMPLEMENTED / NON-AUTHORITY

## Goal

Build the first clean W1 development slice on the common `main` world state: a deterministic, fail-closed host-safety gate with only two outcomes:

1. `REJECTED_CAPABILITY`
2. `SAFETY_ELIGIBLE_NON_PERSISTENT`

This layer deliberately cannot produce `ADMISSION_CANDIDATE`, admit a worker, or mark W1 verified.

## Why this slice first

Historical W1 work contained probes, provider workflows and persistence evidence, but the branch diverged substantially from current `main`. Before reusing provider-specific paths, the project needs a small policy surface that can consume local host observations consistently and reject old failure modes such as hybrid/v1 cgroups.

A second design review found a critical provenance boundary: if a host-observation JSON is allowed to carry booleans such as `provider_reboot_proof=true` or labels such as `identity_source=INDEPENDENT_PROVIDER_API_BYTES`, a caller can self-assert persistence facts. Even though the decision is non-authoritative, calling such a result an admission candidate is semantically too strong.

Therefore host observations contain **no persistence section at all**. Any attempt to add one fails the exact-schema check.

## Linux primitives enforced

- **cgroup v2**: require version 2, unified hierarchy, `cpu`/`memory`/`pids` controllers, and `cgroup.kill` support.
- **pidfd**: require a successful pidfd lifecycle canary in the upstream collector, avoiding numeric-PID reuse races.
- **openat2 + RESOLVE_BENEATH**: require the upstream path-confinement canary.
- **seccomp + no_new_privs**: require seccomp filter mode and no-new-privileges.
- **mount namespace isolation**: require the collector to demonstrate isolation from init.
- **rootless execution**: effective UID must be nonzero.

## Fail-closed input contract

- exact top-level/nested keys only;
- source Git/tree digests are strict canonical lowercase hex strings;
- Python bool values cannot pass numeric fields such as EUID or cgroup version;
- arbitrary CLI filesystem paths are absent: stdin JSON → stdout JSON only;
- policy digest must match the compiled policy.

## New admission ladder

```text
raw host facts
    ↓
W1 host safety gate
    ├─ REJECTED_CAPABILITY
    └─ SAFETY_ELIGIBLE_NON_PERSISTENT
                ↓
     independent provider reboot verifier
     + persisted host identity verifier
                ↓
       future receipt compositor
                ↓
         ADMISSION_CANDIDATE
                ↓
       authority-bearing admission
```

The future compositor must consume independently verified receipts, not self-reported booleans or source labels from the host.

## Historical lessons enforced

- Correct JSON != compliant host.
- Hybrid/non-unified cgroup hosts fail closed.
- Ephemeral GitHub/AppVeyor execution never constitutes persistent worker proof.
- A source label saying “independent provider bytes” is not itself proof of provenance.

## Current scope

Output authority is always:

- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

## Next step

Implement a host-observation collector that can emit only raw local safety facts. Separately restore/harden the provider-reboot and persisted host-identity verifiers. Only after their persisted outputs are independently read back should a new compositor be allowed to form an `ADMISSION_CANDIDATE`.
